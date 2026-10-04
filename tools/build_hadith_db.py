#!/usr/bin/env python3
"""Build one merged hadith database from the Hadith Unlocked book exports and fawazahmed0/hadith-api.

Inputs
  data/hadithunlocked/hadithunlocked_{book}.json   official exports from hadithunlocked.com/books (33 books + 4 anthologies)
  data/fawaz/{ara,eng,ind}-{book}.json        fawazahmed0/hadith-api (10 collections)

Outputs
  data/hadith-db/hadith.jsonl      one record per hadith (shape: see reports/hadith-sources-verdict.md)
  data/hadith-db/anthology.jsonl   anthology entries (Riyad al-Salihin, Mishkat, …) pointing at their source hadith
  data/hadith-db/hadith.db         SQLite: hadith, anthology_entry, hadith_fts (FTS5)
  reports/hadith-compare.md|json   comparison of the two sources
  reports/hadith-leftovers.md      every record still unpaired after all passes, with the reason

Pairing passes for the 7 books both sources have
  1. number        HU "4216" = FZ 4216; Muslim HU "12b" = FZ arabicnumber "12.02"
  2. suffix        HU "391a"/"391b"/"1368-1" = FZ 391 / 391.2 / 1368.2
  3. matn text     HU matn contained in an FZ text (4-gram candidates)
  4. full text     leftover HU (isnad + matn) vs leftover FZ, relaxed
Every pairing is checked by Arabic text similarity before it is accepted.
"""
import difflib, glob, json, os, re, sqlite3, statistics, sys, time, unicodedata
from collections import Counter, defaultdict

# Workspace root: the folder that holds data/ (sibling of this repo by default).
ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HU_DIR = os.path.join(ROOT, "data", "hadithunlocked")
FZ_DIR = os.path.join(ROOT, "data", "fawaz")
OUT_DIR = os.path.join(ROOT, "data", "hadith-db")
REPORT_DIR = os.path.join(ROOT, "reports")
OVERLAP = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik"]
FAWAZ_ONLY = ["nawawi", "qudsi", "dehlawi"]
ANTHOLOGIES = ["riyad", "mishkat", "lulu-marjan", "ibnrajab50"]

# ================================================================ text
# Invisible formatting characters: bidi marks/embeddings/isolates, zero-width space, BOM, soft hyphen.
# U+200F (RLM) alone occurs ~311k times in fawaz. ZWNJ/ZWJ are kept: they can affect shaping.
INVISIBLE = re.compile("[​‎‏؜‪-‮⁦-⁩﻿­]")


def clean(s):
    if not s:
        return s
    s = INVISIBLE.sub("", unicodedata.normalize("NFC", s))
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" +([.,،؛:])", r"\1", s)
    return s.strip()


def plain(s):
    """Strip the light markdown Hadith Unlocked uses (*emphasis*, escaped chars, [^n] footnote refs)."""
    if not s:
        return s
    s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|~>])", r"\1", s)
    s = re.sub(r"\[\^\d+\]", "", s)
    return clean(s.replace("*", ""))


HARAKAT = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]")
ALIF = re.compile("[آأإٱٲٳ]")
NON_LETTER = re.compile("[^ء-ي٠-٩\\s]")


def _letters(s):
    s = HARAKAT.sub("", s).replace("ـ", "")
    s = ALIF.sub("ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return s.replace("ی", "ي").replace("ک", "ك")


HONORIFICS = sorted({" ".join(_letters(h).split()) for h in [
    "صلى الله عليه وسلم", "رضى الله عنه", "رضي الله عنه", "رضى الله عنها", "رضي الله عنها", "رضى الله عنهما",
    "رضي الله عنهما", "رضى الله عنهم", "رضي الله عنهم", "عليه الصلاة والسلام", "عليه السلام"]}, key=len, reverse=True)


def norm_ar(s):
    """Normalised Arabic for matching: no diacritics, unified letters, no honorifics, letters and spaces only."""
    if not s:
        return ""
    s = INVISIBLE.sub("", unicodedata.normalize("NFC", s))
    s = re.sub(r"\[\^\d+\]", " ", s)
    s = re.sub("[ﷺﷻ﵀-﵏]", " ", s)  # ﷺ and other honorific ligatures
    s = NON_LETTER.sub(" ", _letters(s))
    s = " ".join(s.split())
    for h in HONORIFICS:
        s = s.replace(h, " ")
    return " ".join(s.split())


def sim(a, b):
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return 0.0
    return difflib.SequenceMatcher(None, ta, tb, autojunk=False).ratio()


def containment(part, whole):
    tp, tw = part.split(), whole.split()
    if not tp or not tw:
        return 0.0
    m = difflib.SequenceMatcher(None, tp, tw, autojunk=False)
    return sum(b.size for b in m.get_matching_blocks()) / len(tp)


def ngrams(tokens, n=4):
    return {" ".join(tokens[i:i + n]) for i in range(max(0, len(tokens) - n + 1))} or ({" ".join(tokens)} if tokens else set())


# ================================================================ splitting fawaz text into isnad / matn / notes
CHAIN = {norm_ar(w) for w in ["حدثنا", "حدثني", "أخبرنا", "أخبرني", "أنبأنا", "عن", "سمعت", "وحدثنا", "وحدثني", "وأخبرنا", "ح"]}
SPEECH = {norm_ar(w) for w in ["قال", "قالت", "يقول", "تقول", "أن", "أنه", "أنها", "أنهم", "قالا", "يحدث"]}
COMPILER_REMARK = {
    "tirmidhi": "قال أبو عيسى",
    "abudawud": "قال أبو داود",
}


def split_fawaz(text, book, host_matn_norm=None):
    """Split a fawaz Arabic text (isnad + matn + compiler remarks in one block).

    Returns (isnad, matn, notes, method). Raw text is preserved (diacritics kept); only the cut points are computed.
    """
    text = clean(text) or ""
    raw = text.split()
    norm = [norm_ar(t) for t in raw]
    notes = []
    remark = COMPILER_REMARK.get(book)
    if remark:
        r = norm_ar(remark).split()
        for i in range(len(norm) - len(r)):
            if norm[i:i + len(r)] == r and i > len(norm) * 0.3:
                notes.append(" ".join(raw[i:]))
                raw, norm = raw[:i], norm[:i]
                break
    start, method = None, None
    if host_matn_norm:
        head = host_matn_norm.split()[:4]
        flat = [t for t in norm]
        for i in range(len(flat)):
            window = " ".join(x for x in flat[i:i + 8] if x).split()[:len(head)]
            if window == head:
                start, method = i, "aligned_to_parallel"
                break
    if start is None:
        quote = next((i for i, t in enumerate(raw[:int(len(raw) * 0.8) + 1]) if t.startswith(('"', "«", "“"))), None)
        if quote is not None and quote > 2:
            start, method = quote, "quote_mark"
    if start is None:
        last_chain = max((i for i, t in enumerate(norm[:int(len(norm) * 0.75) + 1]) if t in CHAIN), default=None)
        if last_chain is not None:
            nxt = next((j for j in range(last_chain + 1, min(len(norm), last_chain + 12)) if norm[j] in SPEECH), None)
            if nxt is not None:
                start, method = nxt + 1, "chain_then_speech"
    if start is None or start >= len(raw):
        return None, " ".join(raw), notes, "unsplit"
    return " ".join(raw[:start]) or None, " ".join(raw[start:]).strip(' "«»“”'), notes, method


# ================================================================ grades
GRADER_ALIASES = [
    ("albani", "al-Albani"), ("الألباني", "al-Albani"), ("zai", "Zubair Ali Zai"), ("zubair", "Zubair Ali Zai"),
    ("zubayr", "Zubair Ali Zai"), ("علی زئی", "Zubair Ali Zai"), ("baqi", "Muhammad Fuad Abd al-Baqi"),
    ("عبد الباقي", "Muhammad Fuad Abd al-Baqi"), ("shakir", "Ahmad Muhammad Shakir"), ("ghuddah", "Abu Ghuddah"),
    ("hilali", "Salim al-Hilali"), ("arna", "Shuayb al-Arnaut"), ("muhyi", "Muhammad Muhyi al-Din Abd al-Hamid"),
    ("dhahabi", "al-Dhahabi"), ("darussalam", "Darussalam"), ("bukhari", "al-Bukhari"), ("tirmidhi", "al-Tirmidhi"), ("muslim", "Muslim"),
]
GRADE_RANK = {"sahih": 5, "hasan_sahih": 4, "hasan": 3, "accepted": 3, "daif": 1, "mawdu": 0}


def canon_grader(name):
    if not name:
        return None
    f = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    for key, canon in GRADER_ALIASES:
        if key in f or key in name:
            return canon
    return name.strip()


def grade_class(g):
    """Coarse class for comparing and summarising.

    sahih | hasan_sahih | hasan | accepted (strong/fair chain, maqbul) | daif | mawdu (fabricated/batil)
    | silent (e.g. Abu Dawud's silence) | same_as_before | None (no grade)
    """
    if not g:
        return None
    f = unicodedata.normalize("NFKD", g).encode("ascii", "ignore").decode().lower()
    if "no grade" in f or "لا نعرف حكم" in g:
        return None
    if "same as before" in f or "مكرر" in g:
        return "same_as_before"
    if "silent" in f or "سكت عنه" in g:
        return "silent"
    if any(w in f for w in ("fabricat", "mawdu", "maudu", "forged", "invalid")) or any(w in g for w in ("موضوع", "باطل")):
        return "mawdu"
    if any(w in f for w in ("da'if", "daif", "da`if", "weak", "munkar", "shadh", "anomal", "rejected", "repudiat", "not accepted")) \
            or any(w in g for w in ("ضعيف", "منكر", "شاذ", "ليس بصحيح")):
        return "daif"
    if "corroborated" in f or "متواتر" in g:
        return "sahih"
    is_sahih = any(w in f for w in ("sahih", "sound", "agreed", "authentic")) or "صحيح" in g or "متفق" in g
    is_hasan = any(w in f for w in ("hasan", "good")) or "حسن" in g
    if is_sahih and is_hasan:
        return "hasan_sahih"
    if is_sahih:
        return "sahih"
    if is_hasan:
        return "hasan"
    if any(w in f for w in ("strong", "fair", "accepted")) or any(w in g for w in ("قوي", "جيد", "مقبول", "محتج به", "محتجّ به")):
        return "accepted"
    return "other"


def combine_grades(entries):
    """One entry per grader. Same class from both sources → merged with both sources listed.
    Different classes from the same grader → kept as separate entries, each marked conflict=True."""
    by_grader = defaultdict(list)
    for e in entries:
        by_grader[e["grader"]].append(e)
    out = []
    for grader, es in by_grader.items():
        classes = defaultdict(list)
        for e in es:
            classes[e["class"]].append(e)
        conflict = len(classes) > 1
        for cls, group in classes.items():
            first = group[0]
            out.append({
                "grader": grader,
                "grader_ar": next((g.get("grader_ar") for g in group if g.get("grader_ar")), None),
                "grade": first.get("grade"),
                "grade_ar": next((g.get("grade_ar") for g in group if g.get("grade_ar")), None),
                "class": cls,
                "wordings": sorted({g["grade"] for g in group if g.get("grade")}),
                "sources": sorted({g["source"] for g in group}),
                "via": first.get("via"),
                "primary": any(g.get("primary") for g in group),
                "conflict": conflict,
            })
    out.sort(key=lambda g: (not g["primary"], g["grader"] or ""))
    return out


def grade_summary(grades, collection):
    if collection in ("bukhari", "muslim"):
        return {"status": "sahihayn", "note": f"In Sahih {'al-Bukhari' if collection == 'bukhari' else 'Muslim'}: accepted as authentic as a whole",
                "graders": len({g['grader'] for g in grades}), "conflict": False, "source_conflict": False}
    if not grades:
        return {"status": "ungraded", "note": None, "graders": 0, "conflict": False, "source_conflict": False}
    classes = {g["class"] for g in grades if g["class"] in GRADE_RANK}
    source_conflict = any(g["conflict"] for g in grades)
    if not classes and any(g["class"] == "same_as_before" for g in grades):
        return {"status": "same_as_before", "note": "Grader: same as the previous hadith", "graders": len({g['grader'] for g in grades}),
                "conflict": False, "source_conflict": source_conflict}
    if not classes and any(g["class"] == "silent" for g in grades):
        return {"status": "silent", "note": "The compiler was silent about it", "graders": len({g['grader'] for g in grades}),
                "conflict": False, "source_conflict": source_conflict}
    accepted, rejected = classes & ACCEPTED, classes & REJECTED
    if accepted and rejected:
        status = "disputed"            # some graders accept it, others reject it
    elif len(accepted) > 1:
        status = "hasan_or_sahih"      # all accept it, wording differs (e.g. hasan vs sahih)
    elif accepted or rejected:
        status = min(classes, key=lambda c: GRADE_RANK[c]) if rejected else next(iter(accepted))
    else:
        status = "other"
    return {"status": status, "note": None, "graders": len({g['grader'] for g in grades}), "conflict": status == "disputed",
            "source_conflict": source_conflict, "classes": sorted(classes, key=lambda c: -GRADE_RANK[c])}


ACCEPTED = {"sahih", "hasan_sahih", "hasan", "accepted"}
REJECTED = {"daif", "mawdu"}


# ================================================================ loaders
def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def hu_items(book):
    doc = load_json(os.path.join(HU_DIR, f"hadithunlocked_{book}.json"))
    out = []

    def walk(node, trail):
        if isinstance(node, dict):
            if "ref" in node and "text" in node:
                out.append((trail, node))
                return
            here = trail
            if "title" in node and any(k in node for k in ("sections", "subsections", "items")):
                here = trail + [{"number": node.get("number"), "en": (node.get("title") or {}).get("en"), "ar": (node.get("title") or {}).get("ar")}]
            for k in ("sections", "subsections", "items", "chapters", "children"):
                if isinstance(node.get(k), list):
                    for child in node[k]:
                        walk(child, here)
        elif isinstance(node, list):
            for child in node:
                walk(child, trail)

    walk(doc.get("chapters", []), [])
    seen, unique = set(), []
    for trail, it in out:  # the Nasa'i export lists nasai:511 and nasai:512 twice (same id, same text)
        if it["ref"] not in seen:
            seen.add(it["ref"])
            unique.append((trail, it))
    return doc.get("book", {}), unique


def anthology_entries(book):
    doc = load_json(os.path.join(HU_DIR, f"hadithunlocked_{book}.json"))
    out = []

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("source"), dict) and "number" in node:
                out.append({"key": f"{book}:{node['number']}", "collection": book, "number": str(node["number"]),
                            "source_key": node["source"].get("ref"), "url": f"https://hadithunlocked.com/{book}:{node['number']}",
                            "title_en": (node.get("title") or {}).get("en")})
                return
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(doc.get("chapters", []))
    return out


def fz_book(book):
    eds = {lang: load_json(p) for lang in ("ara", "eng", "ind") if os.path.exists(p := os.path.join(FZ_DIR, f"{lang}-{book}.json"))}
    meta = eds["ara"]["metadata"]
    by_lang = {lang: {h["hadithnumber"]: h for h in d["hadiths"]} for lang, d in eds.items()}
    recs = []
    for h in eds["ara"]["hadiths"]:
        n = h["hadithnumber"]
        recs.append({"hadithnumber": n, "arabicnumber": h.get("arabicnumber"), "reference": h.get("reference"),
                     "ar": clean(h.get("text", "")), "en": clean(by_lang.get("eng", {}).get(n, {}).get("text")),
                     "ind": clean(by_lang.get("ind", {}).get(n, {}).get("text")), "grades": h.get("grades") or [],
                     "section": (meta.get("sections") or {}).get(str((h.get("reference") or {}).get("book")))})
    return meta, recs


def fz_number(rec):
    n = rec["hadithnumber"]
    return str(int(n)) if float(n).is_integer() else str(n)


# ================================================================ records
def new_record(key, collection, collection_name, number, order):
    m = re.fullmatch(r"(\d+)(.*)", number)
    return {
        "key": key, "collection": collection, "collection_name": collection_name, "number": number,
        "number_base": int(m.group(1)) if m else None, "number_variant": (m.group(2).strip("-. ") or None) if m else None,
        "order": order, "chapter": None, "section": None, "title_en": None,
        "ar": {"isnad": None, "matn": None}, "en": {"isnad": None, "matn": None}, "ind": None,
        "notes": [], "grades_raw": [], "parallel_of": None, "absorbed_numbers": [], "same_as_previous_of": None,
        "anthologies": [], "source_matches": [], "flags": [], "sources": {},
    }


def hu_record(book_meta, trail, it, order):
    t, c = it.get("text") or {}, it.get("chain") or {}
    rec = new_record(it["ref"], book_meta.get("alias"),
                     {"en": (book_meta.get("title") or {}).get("en"), "ar": (book_meta.get("title") or {}).get("ar")},
                     str(it["number"]), order)
    rec["chapter"] = trail[0] if trail else None
    rec["section"] = trail[1] if len(trail) > 1 else None
    rec["title_en"] = (it.get("title") or {}).get("en")
    rec["ar"] = {"isnad": plain(c.get("ar")), "matn": plain(t.get("ar"))}
    rec["en"] = {"isnad": plain(c.get("en")), "matn": plain(t.get("en"))}
    for lang, notes in (it.get("footnotes") or {}).items():
        for n in notes or []:
            rec["notes"].append({"lang": lang, "text": plain(n.get("text") if isinstance(n, dict) else n), "source": "hadithunlocked"})
    g, gr = it.get("grade") or {}, it.get("grader") or {}
    if (g.get("en") or g.get("ar")) and grade_class(g.get("en") or g.get("ar")) is not None:
        rec["grades_raw"].append({"grader": canon_grader(gr.get("en") or gr.get("ar")), "grader_ar": gr.get("ar"), "grade": g.get("en"),
                                  "grade_ar": g.get("ar"), "class": grade_class(g.get("en") or g.get("ar")), "source": "hadithunlocked", "primary": True})
    rec["sources"]["hadithunlocked"] = {"id": it.get("id"), "url": f"https://hadithunlocked.com/{it['ref']}", "section_url": it.get("path")}
    return rec


def add_fawaz(rec, fz, book, host_matn_norm=None):
    """Attach fawaz content. Text fields are only filled where HU has none."""
    isnad, matn, notes, method = split_fawaz(fz["ar"], book, host_matn_norm or norm_ar(rec["ar"]["matn"] or "") or None)
    rec["ar"]["full_fawaz"] = fz["ar"]
    if not rec["ar"]["matn"]:
        rec["ar"]["isnad"], rec["ar"]["matn"] = isnad, matn
        rec["ar"]["split_method"] = method
    if not rec["en"]["matn"] and fz.get("en"):
        rec["en"]["matn"] = fz["en"]
    if fz.get("ind"):
        rec["ind"] = {"full": fz["ind"]}
    have = {(n["lang"], norm_ar(n["text"])[:80]) for n in rec["notes"]}
    for n in notes:
        if ("ar", norm_ar(n)[:80]) not in have:
            rec["notes"].append({"lang": "ar", "text": n, "source": "fawazahmed0", "kind": "compiler_remark"})
    for g in fz["grades"]:
        if grade_class(g.get("grade")) is None:
            continue
        rec["grades_raw"].append({"grader": canon_grader(g.get("name")), "grade": g.get("grade"),
                                  "class": grade_class(g.get("grade")), "source": "fawazahmed0", "primary": False})
    rec["sources"]["fawazahmed0"] = {"hadithnumber": fz["hadithnumber"], "arabicnumber": fz["arabicnumber"], "reference": fz["reference"]}
    if not rec["chapter"] and fz.get("section"):
        rec["chapter"] = {"number": (fz.get("reference") or {}).get("book"), "en": fz["section"], "ar": None}


def fawaz_record(book, fz, order, meta, key=None):
    num = fz_number(fz)
    rec = new_record(key or f"{book}:{num}", book, {"en": meta.get("name"), "ar": None}, num, order)
    rec["number_variant"] = num.split(".")[1] if "." in num else None
    add_fawaz(rec, fz, book)
    return rec


# ================================================================ pairing
def hu_number_key(book, num):
    if book == "muslim":
        m = re.fullmatch(r"(\d+)([a-z]?)", num)
        return f"{int(m.group(1))}.{(ord(m.group(2)) - 96) if m.group(2) else 1:02d}" if m else None
    return num if re.fullmatch(r"\d+", num) else None


def fz_number_key(book, rec):
    if book == "muslim":
        an = rec["arabicnumber"]
        if an is None:
            return None
        base, _, var = str(an).partition(".")
        return f"{int(base)}.{int(var or 1):02d}"
    n = rec["hadithnumber"]
    return str(int(n)) if float(n).is_integer() else None


def suffix_candidates(num):
    """HU '391a' → FZ '391', '391b' → '391.2'; HU '1368-1' → '1368', '1368.2'."""
    m = re.fullmatch(r"(\d+)(?:([a-z])|-(\d+))", num)
    if not m:
        return []
    base = m.group(1)
    idx = (ord(m.group(2)) - 96) if m.group(2) else int(m.group(3))
    out = [f"{base}.{idx}"] if idx > 1 else [base]
    out += [f"{base}.{idx + 1}", base]
    return out


def full_norm(rec):
    return norm_ar(f"{rec['ar']['isnad'] or ''} {rec['ar']['matn'] or ''}")


def pair_book(book, st, samples):
    meta_hu, items = hu_items(book)
    meta_fz, fz = fz_book(book)
    hu = [hu_record(meta_hu, trail, it, i) for i, (trail, it) in enumerate(items)]
    st.update(hu_count=len(hu), fz_count=len(fz), fz_empty=sum(1 for r in fz if not r["ar"]), pairs=Counter(), rejected_number=0,
              sims=[], matn_in_fz=[], en_sims=[], chapter_checked=0, chapter_agree=0, grade_pairs=0, grade_agree=0)
    fz_live = [r for r in fz if r["ar"]]                       # 203 Muslim entries are empty in every language
    used, pending = set(), []
    by_num = {k: r for r in fz_live if (k := fz_number_key(book, r))}
    by_raw = {fz_number(r): r for r in fz_live}

    def accept(rec, cand, method, threshold):
        if id(cand) in used:
            return False
        s = sim(full_norm(rec), norm_ar(cand["ar"]))
        c = containment(norm_ar(rec["ar"]["matn"] or ""), norm_ar(cand["ar"])) if rec["ar"]["matn"] else 0
        if s < threshold and c < 0.85:
            return False
        used.add(id(cand))
        st["pairs"][method] += 1
        st["sims"].append(s)
        st["matn_in_fz"].append(c)
        if rec["en"]["matn"] and cand.get("en"):
            st["en_sims"].append(difflib.SequenceMatcher(None, rec["en"]["matn"].lower().split(), cand["en"].lower().split(), autojunk=False).ratio())
        ch, fb = (rec.get("chapter") or {}).get("number"), (cand.get("reference") or {}).get("book")
        if ch is not None and fb is not None:
            st["chapter_checked"] += 1
            st["chapter_agree"] += int(str(ch) == str(fb))
        hu_g = {(g["grader"], g["class"]) for g in rec["grades_raw"]}
        for g in cand["grades"]:
            cg, cc = canon_grader(g.get("name")), grade_class(g.get("grade"))
            for hg, hc in hu_g:
                if hg == cg:
                    st["grade_pairs"] += 1
                    st["grade_agree"] += int(hc == cc)
        if method != "number" and len(samples[book][method]) < 3:
            samples[book][method].append({"hu": rec["key"], "fz": fz_number(cand), "sim": round(s, 3), "matn_contained": round(c, 3)})
        add_fawaz(rec, cand, book)
        return True

    # pass 1: number
    for rec in hu:
        k = hu_number_key(book, rec["number"])
        cand = by_num.get(k) if k else None
        if cand and accept(rec, cand, "number", 0.5):
            continue
        if cand:
            st["rejected_number"] += 1
        pending.append(rec)
    # pass 2: suffix numbering
    still = []
    for rec in pending:
        if not any(accept(rec, by_raw[c], "suffix", 0.5) for c in suffix_candidates(rec["number"]) if c in by_raw):
            still.append(rec)
    pending = still

    # passes 3 and 4: text
    def text_pass(pending, method, use_full, min_score):
        left = [r for r in fz_live if id(r) not in used]
        index, norms = defaultdict(set), {}
        for i, r in enumerate(left):
            toks = norm_ar(r["ar"]).split()
            norms[i] = " ".join(toks)
            for g in ngrams(toks):
                index[g].add(i)
        rest = []
        for rec in pending:
            probe = full_norm(rec) if use_full else norm_ar(rec["ar"]["matn"] or "")
            votes = Counter(i for g in ngrams(probe.split()) for i in index.get(g, ()))
            best = None
            for i, _ in votes.most_common(5):
                score = sim(probe, norms[i]) if use_full else containment(probe, norms[i])
                if score >= min_score and (best is None or score > best[1]):
                    best = (i, score)
            if not (best and accept(rec, left[best[0]], method, 0.0)):
                rest.append(rec)
        return rest

    pending = text_pass(pending, "matn_text", False, 0.8)
    pending = text_pass(pending, "full_text", True, 0.55)

    # pass 5: same number, editorial differences in the matn → confirm on the isnad instead
    still = []
    for rec in pending:
        keys = [hu_number_key(book, rec["number"])] + suffix_candidates(rec["number"])
        cands = [c for k in keys if k and (c := by_num.get(k) or by_raw.get(k)) and id(c) not in used]
        isn = norm_ar(rec["ar"]["isnad"] or "")
        ok = False
        for cand in cands:
            f = norm_ar(cand["ar"])
            if (isn and containment(isn, f) >= 0.7) or containment(norm_ar(rec["ar"]["matn"] or ""), f) >= 0.5:
                ok = accept(rec, cand, "number_isnad", 0.0)
                if ok:
                    break
        if not ok:
            still.append(rec)
    pending = still
    st["hu_unpaired"] = [r["key"] for r in pending]
    fz_left = [r for r in fz_live if id(r) not in used]
    st["_fz_corpus"] = "\n".join(norm_ar(r["ar"]) for r in fz_live)
    st["_hu_corpus"] = "\n".join(full_norm(r) for r in hu)
    return meta_fz, hu, fz_left


def absence_reason(rec, other_corpus, other_name):
    """Verify against the other source's full text: is this narration there at all?"""
    toks = norm_ar(rec["ar"]["matn"] or rec["ar"].get("full_fawaz") or "").split()
    probes = [" ".join(toks[i:i + 5]) for i in range(0, max(1, len(toks) - 4), max(1, len(toks) // 4))][:4]
    found = sum(1 for p in probes if p and p in other_corpus)
    if found == 0:
        return f"text not in {other_name} edition"
    if found < len(probes):
        return f"only partly in {other_name} (variant wording)"
    return f"in {other_name} but merged into another record"


def link_parallels(book, hu, fz_left, meta_fz, base_order, leftovers, hu_corpus):
    """FZ records HU has no row for: keep them, and link to the HU record that absorbed them (repeat narrations)."""
    hu_by_num = {r["number"]: r for r in hu}
    out = []
    for i, fz in enumerate(fz_left):
        num = fz_number(fz)
        key = f"{book}:{num}" if (num not in hu_by_num and book != "muslim") else f"{book}:fz{num}"
        base = int(float(fz["hadithnumber"]))
        f_norm = norm_ar(fz["ar"])
        host, best = None, 0
        for n in list(range(base - 4, base + 3)):
            for cand in [hu_by_num.get(str(n))] + [hu_by_num.get(f"{n}{s}") for s in "abc"]:
                if cand and cand["ar"]["matn"]:
                    c = containment(norm_ar(cand["ar"]["matn"]), f_norm)
                    if c >= 0.6 and c > best:
                        host, best = cand, c
        rec = fawaz_record(book, fz, base_order + i, meta_fz, key)
        if host:
            rec["parallel_of"] = host["key"]
            rec["chapter"], rec["section"] = host["chapter"], host["section"]
            isnad, matn, notes, method = split_fawaz(fz["ar"], book, norm_ar(host["ar"]["matn"]))
            rec["ar"].update(isnad=isnad, matn=matn, split_method=method)
            host["absorbed_numbers"].append(num)
            rec["flags"].append("repeat_narration")
        else:
            rec["flags"].append("fawaz_only")
            leftovers.append({"key": rec["key"], "side": "fawaz", "reason": absence_reason(rec, hu_corpus, "Hadith Unlocked"),
                              "text": (rec["ar"]["matn"] or "")[:120]})
        out.append(rec)
    return out


MITHLAHU = {norm_ar(w) for w in ["مثله", "نحوه", "بمثله", "بنحوه", "بهذا الاسناد", "بهذا الإسناد", "معناه", "بمعناه"]}


def mark_same_as_previous(records):
    """Short entries like 'عن النبي ﷺ مثله' ('like it') point at the preceding full hadith."""
    prev = None
    for r in records:
        m = norm_ar(r["ar"]["matn"] or "")
        toks = m.split()
        if toks and len(toks) <= 12 and any(w in m for w in MITHLAHU) and prev:
            r["same_as_previous_of"] = prev["key"]
            r["flags"].append("refers_to_previous")
        elif len(toks) > 12:
            prev = r


# ================================================================ fawaz-only collections
def link_to_sources(records, core_index, core_norms, core_by_key):
    """Nawawi/Qudsi/Dehlawi: find the hadith they quote in the core books and inherit those grades (marked 'via')."""
    for r in records:
        probe = norm_ar(r["ar"]["matn"] or r["ar"].get("full_fawaz") or "")
        votes = Counter(k for g in ngrams(probe.split()) for k in core_index.get(g, ()))
        hits = []
        for k, _ in votes.most_common(20):
            c = containment(core_norms[k], probe) if len(core_norms[k].split()) <= len(probe.split()) else containment(probe, core_norms[k])
            if c >= 0.7:
                hits.append((k, round(c, 3)))
        rank = {"bukhari": 0, "muslim": 1, "abudawud": 2, "tirmidhi": 3, "nasai": 4, "ibnmajah": 5, "malik": 6}
        hits.sort(key=lambda x: (-round(x[1], 2), rank.get(x[0].split(":")[0], 9)))
        r["source_matches"] = [{"key": k, "score": s} for k, s in hits[:5]]
        for k, _ in hits[:3]:
            for g in core_by_key[k]["grades_raw"]:
                r["grades_raw"].append({**g, "primary": False, "via": k})
            if core_by_key[k]["collection"] in ("bukhari", "muslim"):
                r["flags"].append(f"found_in_{core_by_key[k]['collection']}")


# ================================================================ finalise / output
def split_remark(text, book, min_pos=0.0):
    """Cut a compiler remark ('قال أبو عيسى …') off the end of a text. Returns (text, remark|None)."""
    remark = COMPILER_REMARK.get(book)
    if not remark or not text:
        return text, None
    raw, r = text.split(), norm_ar(remark).split()
    norm = [norm_ar(t) for t in raw]
    for i in range(len(norm) - len(r) + 1):
        if norm[i:i + len(r)] == r and i >= len(norm) * min_pos and i > 0:
            return " ".join(raw[:i]).rstrip(" .،"), " ".join(raw[i:])
    return text, None


def finalize(r):
    matn, remark = split_remark(r["ar"]["matn"], r["collection"])
    if remark:
        r["ar"]["matn"] = matn
        r["notes"].append({"lang": "ar", "text": remark, "source": r["ar"].get("split_method") and "fawazahmed0" or "hadithunlocked",
                           "kind": "compiler_remark"})
    r["grades"] = combine_grades(r.pop("grades_raw"))
    r["grade_summary"] = grade_summary(r["grades"], r["collection"])
    if any(f.startswith("found_in_") for f in r["flags"]):
        where = " and ".join(sorted({f[len('found_in_'):] for f in r["flags"] if f.startswith('found_in_')}))
        r["grade_summary"].update(status="sahihayn", note=f"Text found in Sahih {where}")
    r["ar_norm"] = {"matn": norm_ar(r["ar"]["matn"] or r["ar"].get("full_fawaz") or ""), "isnad": norm_ar(r["ar"]["isnad"] or ""),
                    "prophetic": norm_ar(r["ar"].get("prophetic") or "")}
    return r


SCHEMA = """CREATE TABLE hadith (
  key TEXT PRIMARY KEY, collection TEXT NOT NULL, number TEXT NOT NULL, number_base INTEGER, number_variant TEXT, ord INTEGER,
  chapter_number TEXT, chapter_en TEXT, chapter_ar TEXT, section_number TEXT, section_en TEXT, section_ar TEXT, title_en TEXT,
  ar_isnad TEXT, ar_matn TEXT, ar_full_fawaz TEXT, en_isnad TEXT, en_matn TEXT, ind_full TEXT, notes_json TEXT,
  ar_norm_matn TEXT, grades_json TEXT, grade_status TEXT, grade_note TEXT, grade_conflict INTEGER,
  parallel_of TEXT, same_as_previous_of TEXT, absorbed_json TEXT, anthologies_json TEXT, source_matches_json TEXT,
  flags_json TEXT, url TEXT, sources_json TEXT,
  ar_prophetic TEXT, ar_prophetic_norm TEXT, ar_marked TEXT, narrators_json TEXT, sunnah_url TEXT);
CREATE INDEX hadith_collection_num ON hadith(collection, number_base, number_variant);
CREATE INDEX hadith_parallel ON hadith(parallel_of);
CREATE TABLE anthology_entry (key TEXT PRIMARY KEY, collection TEXT, number TEXT, source_key TEXT, url TEXT, title_en TEXT);
CREATE INDEX anthology_source ON anthology_entry(source_key);
CREATE TABLE sunnah_book (collection TEXT, book_number TEXT, name_en TEXT, name_ar TEXT, hadith_start INTEGER, hadith_end INTEGER, hadith_count INTEGER, PRIMARY KEY (collection, book_number));
CREATE TABLE sunnah_chapter (collection TEXT, book_number TEXT, chapter_id TEXT, chapter_number TEXT, title_en TEXT, title_ar TEXT, intro_en TEXT, intro_ar TEXT, ending_en TEXT, ending_ar TEXT, PRIMARY KEY (collection, book_number, chapter_id));
CREATE TABLE narrator (id INTEGER PRIMARY KEY, name_ar TEXT, url TEXT, mentions INTEGER);
CREATE VIRTUAL TABLE hadith_fts USING fts5(key UNINDEXED, ar_norm_matn, ar_prophetic_norm, en_matn, ind_full, tokenize='unicode61 remove_diacritics 2');"""


def j(x):
    return json.dumps(x, ensure_ascii=False) if x else None


def write_outputs(records, anth, sunnah_tables=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "hadith.jsonl"), "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT_DIR, "anthology.jsonl"), "w", encoding="utf-8") as f:
        for e in anth:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    dbp = os.path.join(OUT_DIR, "hadith.db")
    if os.path.exists(dbp):
        os.remove(dbp)
    db = sqlite3.connect(dbp)
    db.executescript(SCHEMA)
    rows = []
    for r in records:
        ch, se, gs = r.get("chapter") or {}, r.get("section") or {}, r["grade_summary"]
        en = r["en"]["matn"]
        rows.append((r["key"], r["collection"], r["number"], r["number_base"], r["number_variant"], r["order"],
                     None if ch.get("number") is None else str(ch["number"]), ch.get("en"), ch.get("ar"),
                     None if se.get("number") is None else str(se["number"]), se.get("en"), se.get("ar"), r["title_en"],
                     r["ar"]["isnad"], r["ar"]["matn"], r["ar"].get("full_fawaz"), r["en"]["isnad"], en, (r["ind"] or {}).get("full"),
                     j(r["notes"]), r["ar_norm"]["matn"], j(r["grades"]), gs["status"], gs.get("note"), int(gs["conflict"]),
                     r["parallel_of"], r["same_as_previous_of"], j(r["absorbed_numbers"]), j(r["anthologies"]), j(r["source_matches"]),
                     j(r["flags"]), (r["sources"].get("hadithunlocked") or {}).get("url"), j(r["sources"]),
                     r["ar"].get("prophetic"), r["ar_norm"]["prophetic"] or None, r["ar"].get("marked"), j(r.get("narrators")),
                     (r["sources"].get("sunnah") or {}).get("url")))
    db.executemany(f"INSERT INTO hadith VALUES ({','.join('?' * 38)})", rows)
    db.executemany("INSERT INTO hadith_fts VALUES (?,?,?,?,?)",
                   [(r["key"], r["ar_norm"]["matn"], r["ar_norm"]["prophetic"] or None, r["en"]["matn"], (r["ind"] or {}).get("full")) for r in records])
    if sunnah_tables:
        books, chapters, narrators = sunnah_tables
        db.executemany("INSERT OR REPLACE INTO sunnah_book VALUES (?,?,?,?,?,?,?)", books)
        db.executemany("INSERT OR REPLACE INTO sunnah_chapter VALUES (?,?,?,?,?,?,?,?,?,?)", chapters)
        db.executemany("INSERT OR REPLACE INTO narrator VALUES (?,?,?,?)", narrators)
    db.executemany("INSERT OR REPLACE INTO anthology_entry VALUES (?,?,?,?,?,?)",
                   [(e["key"], e["collection"], e["number"], e["source_key"], e["url"], e["title_en"]) for e in anth])
    db.commit()
    db.close()


def pct(a, b):
    return round(100 * a / b, 1) if b else None


def summarize(st):
    sims, mc, en = st.pop("sims"), st.pop("matn_in_fz"), st.pop("en_sims")
    st["pairs"] = dict(st["pairs"])
    paired = sum(st["pairs"].values())
    st.update(paired=paired, hu_paired_pct=pct(paired, st["hu_count"]), fz_paired_pct=pct(paired, st["fz_count"] - st["fz_empty"]),
              text_sim_median=round(statistics.median(sims), 3) if sims else None,
              text_sim_ge_0_9_pct=pct(sum(s >= 0.9 for s in sims), len(sims)),
              matn_contained_ge_0_95_pct=pct(sum(c >= 0.95 for c in mc), len(mc)),
              same_english_translation_pct=pct(sum(e >= 0.8 for e in en), len(en)),
              chapter_agree_pct=pct(st["chapter_agree"], st["chapter_checked"]),
              same_grader_agree_pct=pct(st["grade_agree"], st["grade_pairs"]),
              hu_unpaired_count=len(st["hu_unpaired"]))
    return st


def write_reports(stats, samples, totals, leftovers):
    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(os.path.join(REPORT_DIR, "hadith-compare.json"), "w", encoding="utf-8") as f:
        json.dump({"stats": stats, "samples": samples, "totals": totals}, f, ensure_ascii=False, indent=1)
    L = ["# Hadith sources compared: Hadith Unlocked exports vs fawazahmed0/hadith-api", "",
         f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `tools/build_hadith_db.py`.", "", "## Pairing", "",
         "| Book | HU | FZ | FZ empty | by number | by suffix | by matn text | by full text | by number + isnad | HU unpaired | FZ left (repeat narrations / unlinked) |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for b, s in stats.items():
        p = s["pairs"]
        L.append(f"| {b} | {s['hu_count']} | {s['fz_count']} | {s['fz_empty']} | {p.get('number', 0)} | {p.get('suffix', 0)} | "
                 f"{p.get('matn_text', 0)} | {p.get('full_text', 0)} | {p.get('number_isnad', 0)} | {s['hu_unpaired_count']} | {s['fz_repeat']} / {s['fz_unlinked']} |")
    L += ["", "## Agreement on paired records", "",
          "| Book | Arabic sim median | sim ≥ 0.9 % | HU matn inside FZ ≥ 95% | same English % | same chapter % | same-grader agreement % |",
          "|---|---|---|---|---|---|---|"]
    for b, s in stats.items():
        L.append(f"| {b} | {s['text_sim_median']} | {s['text_sim_ge_0_9_pct']} | {s['matn_contained_ge_0_95_pct']} | "
                 f"{s['same_english_translation_pct']} | {s['chapter_agree_pct']} | {s['same_grader_agree_pct']} |")
    L += ["", "## Database totals", "", "```", json.dumps(totals, indent=1, ensure_ascii=False), "```", "", "## Samples", ""]
    for b, s in samples.items():
        for kind, xs in s.items():
            if xs:
                L.append(f"- **{b} / {kind}**: " + "; ".join(f"`{json.dumps(x, ensure_ascii=False)}`" for x in xs))
    with open(os.path.join(REPORT_DIR, "hadith-compare.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    by_reason = Counter((x["side"], x["reason"]) for x in leftovers)
    M = ["# Leftovers: records still without a counterpart", "",
         "Every record below is in the database. It only lacks a counterpart in the other source.", "", "| Side | Reason | Count |", "|---|---|---|"]
    M += [f"| {s} | {r} | {n} |" for (s, r), n in by_reason.most_common()]
    M += ["", "## Records", "", "| Key | Side | Reason | Text |", "|---|---|---|---|"]
    M += [f"| {x['key']} | {x['side']} | {x['reason']} | {x['text'].replace('|', ' ')} |" for x in leftovers]
    with open(os.path.join(REPORT_DIR, "hadith-leftovers.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(M) + "\n")


def classify_hu_leftover(rec):
    m = norm_ar(rec["ar"]["matn"] or "")
    if rec["number"].startswith("i"):
        return "Muslim's introduction (not in fawaz)"
    if rec["same_as_previous_of"]:
        return "short 'like the previous' entry (linked to previous hadith)"
    if rec["collection"] == "malik" and any(w in m for w in (norm_ar("مالك"), norm_ar("قال يحيى"))):
        return "Malik's or Yahya's own statement (not a hadith; fawaz omits)"
    return "no fawaz row found by number, suffix or text"


def main():
    t0 = time.time()
    stats, samples, records, leftovers = {}, defaultdict(lambda: defaultdict(list)), [], []
    for book in OVERLAP:
        st = {}
        meta_fz, hu, fz_left = pair_book(book, st, samples)
        mark_same_as_previous(hu)
        extra = link_parallels(book, hu, fz_left, meta_fz, len(hu), leftovers, st.pop("_hu_corpus"))
        fz_corpus = st.pop("_fz_corpus")
        st["fz_repeat"] = sum(1 for r in extra if r["parallel_of"])
        st["fz_unlinked"] = len(extra) - st["fz_repeat"]
        unpaired = set(st["hu_unpaired"])
        for r in hu:
            if r["key"] in unpaired:
                r["flags"].append("hadithunlocked_only")
                reason = classify_hu_leftover(r)
                if reason.startswith("no fawaz row"):
                    reason = absence_reason(r, fz_corpus, "fawaz")
                leftovers.append({"key": r["key"], "side": "hadithunlocked", "reason": reason, "text": (r["ar"]["matn"] or "")[:120]})
        records += hu + extra
        stats[book] = summarize(st)
        print(f"[{book}] paired {stats[book]['paired']}/{len(hu)} HU, repeat narrations {st['fz_repeat']}, unlinked FZ {st['fz_unlinked']}", flush=True)

    others = sorted({os.path.basename(p)[len("hadithunlocked_"):-5] for p in glob.glob(os.path.join(HU_DIR, "hadithunlocked_*.json"))} - set(OVERLAP) - set(ANTHOLOGIES))
    for book in others:
        meta_hu, items = hu_items(book)
        recs = [hu_record(meta_hu, trail, it, i) for i, (trail, it) in enumerate(items)]
        mark_same_as_previous(recs)
        records += recs

    core = [r for r in records if r["collection"] in OVERLAP and r["ar"]["matn"]]
    core_norms = {r["key"]: norm_ar(r["ar"]["matn"]) for r in core}
    core_index = defaultdict(set)
    for k, n in core_norms.items():
        for g in ngrams(n.split()):
            core_index[g].add(k)
    core_by_key = {r["key"]: r for r in core}
    for book in FAWAZ_ONLY:
        meta_fz, fz = fz_book(book)
        recs = [fawaz_record(book, r, i, meta_fz) for i, r in enumerate(fz) if r["ar"]]
        link_to_sources(recs, core_index, core_norms, core_by_key)
        records += recs
        print(f"[{book}] {len(recs)} records, {sum(1 for r in recs if r['source_matches'])} linked to their source hadith", flush=True)

    from sunnah_source import merge_sunnah
    if not os.path.exists(os.path.join(ROOT, "data", "sunnah", "sunnah.db")):   # optional source (needs an API key)
        print("[sunnah.com] data/sunnah/sunnah.db not found: skipping", flush=True)
        merge_sunnah = lambda *a, **k: ([], {}, [], [], [], [])
    sn_new, sn_stats, sn_left, sn_books, sn_chapters, sn_narr = merge_sunnah(
        ROOT, records, new_record, clean, norm_ar, containment, sim, canon_grader, grade_class, link_to_sources,
        (core_index, core_norms, core_by_key), ngrams)
    records += sn_new
    leftovers += sn_left
    print(f"[sunnah.com] {json.dumps(sn_stats)}", flush=True)

    by_key = {r["key"]: r for r in records}
    anth = [e for book in ANTHOLOGIES for e in anthology_entries(book)]
    for e in anth:
        if e["source_key"] in by_key:
            by_key[e["source_key"]]["anthologies"].append({"collection": e["collection"], "number": e["number"], "url": e["url"]})
    # sunnah.com Mishkat uses the same numbering as HU's Mishkat pointers: put that source first
    hu_mishkat = {e["number"]: e["source_key"] for e in anth if e["collection"] == "mishkat"}
    for r in records:
        if r["collection"] == "mishkat" and r["number"] in hu_mishkat and hu_mishkat[r["number"]] in by_key:
            src = hu_mishkat[r["number"]]
            r["source_matches"] = [{"key": src, "score": 1.0, "via": "hadithunlocked_mishkat"}] + [m for m in r["source_matches"] if m["key"] != src]
    records = [finalize(r) for r in records]

    empty = [r["key"] for r in records if not (r["ar"]["matn"] or r["ar"].get("full_fawaz"))]
    gs = Counter(r["grade_summary"]["status"] for r in records)
    totals = {"records": len(records), "collections": len({r["collection"] for r in records}), "empty_arabic": len(empty),
              "isnad_matn_split": sum(1 for r in records if r["ar"]["isnad"] and r["ar"]["matn"]),
              "with_indonesian": sum(1 for r in records if r["ind"]),
              "with_named_grade": sum(1 for r in records if r["grades"]),
              "with_2plus_graders": sum(1 for r in records if len({g["grader"] for g in r["grades"]}) >= 2),
              "grade_status": dict(gs.most_common()), "grade_disputed": sum(1 for r in records if r["grade_summary"]["conflict"]),
              "same_grader_source_conflict": sum(1 for r in records if r["grade_summary"].get("source_conflict")),
              "repeat_narrations_linked": sum(1 for r in records if r["parallel_of"]),
              "refers_to_previous_linked": sum(1 for r in records if r["same_as_previous_of"]),
              "anthology_entries": len(anth), "anthology_linked": sum(1 for e in anth if e["source_key"] in by_key),
              "with_sunnah": sum(1 for r in records if "sunnah" in r["sources"]),
              "with_prophetic_span": sum(1 for r in records if r["ar"].get("prophetic")),
              "with_narrators": sum(1 for r in records if r.get("narrators")),
              "narrators": len(sn_narr), "sunnah_books": len(sn_books), "sunnah_chapters": len(sn_chapters),
              "sunnah_merge": sn_stats,
              "leftovers": len(leftovers), "by_collection": dict(Counter(r["collection"] for r in records).most_common())}
    write_outputs(records, anth, (sn_books, sn_chapters, sn_narr))
    write_reports(stats, {b: dict(v) for b, v in samples.items()}, totals, leftovers)
    print(json.dumps({k: v for k, v in totals.items() if k != "by_collection"}, indent=1, ensure_ascii=False))
    if empty:
        print("EMPTY ARABIC:", empty[:20])
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
