"""sunnah.com as the third hadith source (used by build_hadith_db.py).

Inputs: data/sunnah/sunnah.db (their SQL dump, via load_sunnah_dump.py) and data/sunnah/api/** (fetch_sunnah_api.py).

What it adds:
  - to existing records (bukhari … shamail): the marked-up Arabic (`ar.marked`), the Prophet's words (`ar.prophetic`),
    narrators with sunnah.com ids, compiler remarks ([postmatn]) as notes, grades attributed by grader, sunnah links
  - new records for sunnah-only collections: riyadussalihin, mishkat, bulugh, hisn, forty, virtues, thulathiyyat
  - tables: sunnah_book, sunnah_chapter, narrator
"""
import glob, json, os, re, sqlite3
from collections import Counter, defaultdict

JOIN = {"bukhari": "bukhari", "muslim": "muslim", "abudawud": "abudawud", "tirmidhi": "tirmidhi", "nasai": "nasai",
        "ibnmajah": "ibnmajah", "ahmad": "ahmad", "adab": "adab", "shamail": "shamail"}
OWN = ["riyadussalihin", "mishkat", "bulugh", "hisn", "forty", "virtues", "thulathiyyat"]
# grader per collection when the API record has no graded_by (from API samples, see docs/data-sunnah.md)
DEFAULT_GRADER = {"abudawud": "al-Albani", "tirmidhi": "Darussalam", "nasai": "Darussalam", "ibnmajah": "Darussalam", "ahmad": "Darussalam"}
# Darussalam's grades for these books agree 99.8–99.9% with Zubair Ali Zai, whose grading they publish
DARUSSALAM_IS_ZUBAIR = {"tirmidhi", "nasai", "ibnmajah"}
NARRATOR_URL = "https://sunnah.com/narrator/{id}"
TAGS = re.compile(r"\[/?(?:prematn|matn|postmatn|narrator[^\]]*|place[^\]]*|name[^\]]*)\]")
HTML = re.compile(r"<[^>]+>")


def parse_markup(ar, clean):
    ar = clean(ar or "")
    def grab(tag):
        m = re.search(rf"\[{tag}\](.*?)\[/{tag}\]", ar, re.S)
        if not m:
            return None
        t = TAGS.sub("", m.group(1))
        if tag == "matn":
            t = re.sub(r'\s*"\s*', " ", t)   # sunnah.com uses ASCII quotes as quote marks inside the matn
        return re.sub(r"\s+", " ", clean(t)).strip(' "«».')
    narrators = [{"id": int(i), "role": r, "name": t, "text": clean(s), "url": NARRATOR_URL.format(id=i)}
                 for i, r, t, s in re.findall(r'\[narrator id="(\d+)" role="(\w+)" tooltip="([^"]*)"\](.*?)\[/narrator\]', ar, re.S)]
    has_marks = "[matn]" in ar or "[narrator" in ar
    return {"marked": ar if has_marks else None, "isnad": grab("prematn"), "prophetic": grab("matn"), "post": grab("postmatn"),
            "plain": clean(TAGS.sub("", ar)).strip(), "narrators": narrators}


def numbers(n):
    """'1079 a' → ['1079a']; '2711, 2712' → ['2711','2712']; '1697/1698 a' → ['1697a','1698a']; '5709-5712' → 4 numbers."""
    n = (n or "").strip()
    if not n:
        return []
    m = re.fullmatch(r"(?i)introduction\s+(\d+)", n)          # Muslim's introduction: HU numbers it i001…
    if m:
        return [f"i{int(m.group(1)):03d}"]
    m = re.fullmatch(r"(\d+)\s*([a-z])-([a-z])", n)           # letter range "546 b-d" → 546b, 546c, 546d
    if m and ord(m.group(3)) - ord(m.group(2)) <= 10:
        return [f"{m.group(1)}{chr(c)}" for c in range(ord(m.group(2)), ord(m.group(3)) + 1)]
    parts = [p.strip() for p in re.split(r"[,/]", n) if p.strip()]
    letter = re.search(r"\s*([a-z])$", parts[-1])
    out = []
    for p in parts:
        p = re.sub(r"\s+", "", p)
        m = re.fullmatch(r"(\d+)-(\d+)", p)
        if m and 0 < int(m.group(2)) - int(m.group(1)) <= 20:
            out += [str(x) for x in range(int(m.group(1)), int(m.group(2)) + 1)]
        else:
            out.append(p if re.search(r"[a-z]$", p) or not letter else p + letter.group(1))
    return out


def load_api(root):
    """API hadiths keyed by (collection, hadithNumber) + book and chapter tables."""
    api, books, chapters = {}, [], []
    base = os.path.join(root, "data", "sunnah", "api")
    for f in glob.glob(os.path.join(base, "*", "hadiths", "*.json")):
        for h in json.load(open(f, encoding="utf-8")).get("data") or []:
            api[(h["collection"], h["hadithNumber"])] = h
    for f in glob.glob(os.path.join(base, "*", "books.p*.json")):
        col = f.split(os.sep)[-2]
        for b in json.load(open(f, encoding="utf-8")).get("data") or []:
            name = {x["lang"]: x.get("name") for x in b.get("book", [])}
            books.append((col, b["bookNumber"], name.get("en"), name.get("ar"), b.get("hadithStartNumber"), b.get("hadithEndNumber"), b.get("numberOfHadith")))
    for f in glob.glob(os.path.join(base, "*", "chapters", "*.json")):
        col = f.split(os.sep)[-3]
        for c in json.load(open(f, encoding="utf-8")).get("data") or []:
            L = {x["lang"]: x for x in c.get("chapter", [])}
            en, ar = L.get("en", {}), L.get("ar", {})
            chapters.append((col, c["bookNumber"], str(c["chapterId"]), en.get("chapterNumber") or ar.get("chapterNumber"),
                             en.get("chapterTitle"), ar.get("chapterTitle"), en.get("intro"), ar.get("intro"), en.get("ending"), ar.get("ending")))
    return api, books, chapters


def api_grades(h):
    out = []
    for L in (h or {}).get("hadith", []):
        for g in L.get("grades") or []:
            out.append({"lang": L["lang"], "by": g.get("graded_by"), "grade": g.get("grade")})
    return out


def sunnah_grade_entries(col, row_en, row_ar, api_h, canon_grader, grade_class):
    """Grades attributed to their grader. The API names the grader; the dump only has the grade text."""
    if col in ("bukhari", "muslim"):
        return []
    gs = api_grades(api_h)
    en = [g for g in gs if g["lang"] == "en" and g["grade"]]
    ar = [g for g in gs if g["lang"] == "ar" and g["grade"]]
    if not en and row_en:
        en = [{"by": DEFAULT_GRADER.get(col), "grade": row_en}]
    out = []
    for i, g in enumerate(en):
        by = (g.get("by") or "").strip() or DEFAULT_GRADER.get(col)
        if not by:
            continue
        grade = g["grade"].strip().rstrip("]")
        cls = grade_class(grade)
        if cls is None:
            continue
        grader = "Zubair Ali Zai" if (by.lower().startswith("darussalam") and col in DARUSSALAM_IS_ZUBAIR) else canon_grader(by)
        out.append({"grader": grader, "grader_display": by, "grade": grade, "grade_ar": (ar[i]["grade"] if i < len(ar) else row_ar) or None,
                    "class": cls, "source": "sunnah.com", "primary": False})
    return out


def merge_sunnah(root, records, new_record, clean, norm_ar, containment, sim, canon_grader, grade_class, link_to_sources, core_ctx, ngrams):
    db = sqlite3.connect(os.path.join(root, "data", "sunnah", "sunnah.db"))
    db.row_factory = sqlite3.Row
    api, books, chapters = load_api(root)
    by_key = {r["key"]: r for r in records}
    stats, leftovers, narrators = defaultdict(Counter), [], {}
    book_names = {(c, b): (en, ar) for c, b, en, ar, *_ in books}

    def full_norm(r):
        return norm_ar(f"{r['ar'].get('isnad') or ''} {r['ar'].get('matn') or r['ar'].get('full_fawaz') or ''}")

    def attach(rec, row, p, scol, nums):
        rec["ar"]["marked"] = p["marked"]
        rec["ar"]["prophetic"] = p["prophetic"]
        if p["narrators"]:
            rec["narrators"] = p["narrators"]
            for n in p["narrators"]:
                narrators.setdefault(n["id"], {"name": n["name"], "mentions": 0})["mentions"] += 1
        if p["post"] and not any(norm_ar(x["text"])[:60] == norm_ar(p["post"])[:60] for x in rec["notes"]):
            rec["notes"].append({"lang": "ar", "text": p["post"], "source": "sunnah.com", "kind": "compiler_remark"})
        if not rec["en"].get("matn") and row["englishText"]:
            rec["en"]["matn"] = clean(HTML.sub(" ", row["englishText"]))
        api_h = api.get((scol, row["hadithNumber"]))
        rec["grades_raw"] += sunnah_grade_entries(scol, row["englishgrade1"], row["arabicgrade1"], api_h, canon_grader, grade_class)
        rec["sources"]["sunnah"] = {"collection": scol, "number": row["hadithNumber"], "numbers": nums, "book": row["bookNumber"],
                                    "chapter_id": row["babID"], "in_book": row["ourHadithNumber"], "urn_ar": row["arabicURN"],
                                    "urn_en": row["englishURN"], "url": f"https://sunnah.com/{scol}:{nums[0] if nums else row['ourHadithNumber']}"}

    def score(p, c):
        """Same hadith? Either text inside the other (A: sunnah rows are often longer), or the same isnad."""
        theirs, ours = norm_ar(p["plain"]), full_norm(c)
        a = containment(norm_ar(p["prophetic"] or p["plain"]), ours)
        b = containment(ours, theirs) if len(ours.split()) >= 8 else 0
        isn = norm_ar(c["ar"].get("isnad") or "")
        i = containment(isn, theirs) if len(isn.split()) >= 6 else 0
        return max(a, b, 0.9 if i >= 0.9 else 0)

    core_index, core_norms, _ = core_ctx
    def best_match(row, p, nums, ocol):
        cands = [by_key.get(f"{ocol}:{n}") for n in nums]
        m = re.match(r"\d+", nums[0]) if nums else None
        if m:
            base = int(m.group())
            cands += [by_key.get(f"{ocol}:{b}{x}") for b in range(base - 3, base + 4) for x in ("", "a", "b", "c", "d", "e")]
        elif nums and nums[0].startswith("i"):          # Muslim introduction neighbours
            b = int(nums[0][1:])
            cands += [by_key.get(f"{ocol}:i{x:03d}") for x in range(b - 3, b + 4)]
        best = pick(p, cands)
        if best is None:   # D (blank number) and anything numbering can't place: text search within this collection
            probe = norm_ar(p["prophetic"] or p["plain"]).split()
            votes = Counter(k for g in ngrams(probe) for k in core_index.get(g, ()) if k.startswith(ocol + ":"))
            best = pick(p, [by_key.get(k) for k, _ in votes.most_common(8)])
        return best

    def pick(p, cands):
        best, seen_keys = None, set()
        for c in filter(None, cands):
            if c["key"] in seen_keys:
                continue
            seen_keys.add(c["key"])
            sc = score(p, c)
            # prefer a free record over one already taken, at equal score
            rank = (sc, "sunnah" not in c["sources"])
            if sc >= 0.6 and (best is None or rank > best[2]):
                best = (c, sc, rank)
        return best

    extra = []
    # 1) enrich records we already have
    for scol, ocol in JOIN.items():
        for row in db.execute("SELECT * FROM hadith WHERE collection=?", (scol,)):
            st = stats[scol]
            st["rows"] += 1
            p = parse_markup(row["arabicText"], clean)
            nums = numbers(row["hadithNumber"])
            best = best_match(row, p, nums, ocol)
            if best and "sunnah" not in best[0]["sources"]:
                attach(best[0], row, p, scol, nums)
                st["joined" if best[0]["key"] in {f"{ocol}:{n}" for n in nums} else "joined_by_neighbour"] += 1
            elif best:
                # C: a second sunnah row for a record that already has one = another narration (different chain).
                # Keep it as its own record, linked like the repeat narrations HU folds (bukhari:300 → 299).
                host = best[0]
                k, i = f"{host['key']}.s2", 2
                while k in by_key:
                    i += 1
                    k = f"{host['key']}.s{i}"
                rec = new_record(k, ocol, host["collection_name"], f"{host['number']}.s{i}", host["order"])
                rec["chapter"], rec["section"] = host["chapter"], host["section"]
                rec["ar"] = {"isnad": p["isnad"], "matn": p["prophetic"] or p["plain"]}
                rec["en"] = {"isnad": None, "matn": None}
                rec["parallel_of"] = host["key"]
                rec["flags"].append("sunnah_extra_narration")
                attach(rec, row, p, scol, nums)
                by_key[k] = rec
                extra.append(rec)
                st["extra_narration"] += 1
            else:
                st["unmatched"] += 1
                leftovers.append({"key": f"{scol}:{row['hadithNumber'] or row['arabicURN']}", "side": "sunnah.com",
                                  "reason": "no record with this number or text", "text": (p["prophetic"] or p["plain"])[:120]})

    # 2) sunnah-only collections become records
    new = []
    seen = set()
    for scol in OWN:
        rows = [dict(r) for r in db.execute("SELECT * FROM hadith WHERE collection=? ORDER BY CAST(bookNumber AS REAL), CAST(babID AS REAL), CAST(ourHadithNumber AS INT)", (scol,))]
        if not rows:  # API-only (thulathiyyat)
            for (c, num), h in api.items():
                if c != scol:
                    continue
                L = {x["lang"]: x for x in h.get("hadith", [])}
                rows.append({"collection": c, "bookNumber": h.get("bookNumber"), "babID": h.get("chapterId"), "hadithNumber": num,
                             "ourHadithNumber": num, "arabicText": HTML.sub(" ", (L.get("ar") or {}).get("body") or ""),
                             "englishText": (L.get("en") or {}).get("body"), "englishgrade1": "", "arabicgrade1": "",
                             "arabicURN": (L.get("ar") or {}).get("urn"), "englishURN": (L.get("en") or {}).get("urn"),
                             "arabicBabName": (L.get("ar") or {}).get("chapterTitle"), "englishBabName": (L.get("en") or {}).get("chapterTitle")})
        for i, row in enumerate(rows):
            nums = numbers(row["hadithNumber"]) or [str(row["ourHadithNumber"])]
            key = f"{scol}:{nums[0]}"
            if key in seen or key in by_key:
                key = f"{scol}:{nums[0]}~{row['arabicURN']}"
            seen.add(key)
            p = parse_markup(row["arabicText"], clean)
            bn = book_names.get((scol, str(row["bookNumber"])), (None, None))
            rec = new_record(key, scol, {"en": scol, "ar": None}, nums[0], i)
            rec["chapter"] = {"number": row["bookNumber"], "en": bn[0], "ar": bn[1]}
            rec["section"] = {"number": row["babID"], "en": clean(row.get("englishBabName") or "") or None, "ar": clean(row.get("arabicBabName") or "") or None}
            rec["ar"] = {"isnad": p["isnad"], "matn": p["prophetic"] or p["plain"], "marked": p["marked"], "prophetic": p["prophetic"]}
            rec["en"] = {"isnad": None, "matn": clean(HTML.sub(" ", row.get("englishText") or "")) or None}
            attach(rec, row, p, scol, nums)
            rec["ar"]["matn"] = p["prophetic"] or p["plain"]
            rec["flags"].append("sunnah_only_collection")
            new.append(rec)
        stats[scol]["records"] = len([r for r in new if r["collection"] == scol])
    link_to_sources(new, *core_ctx)
    new = extra + new
    narrator_rows = [(i, v["name"], NARRATOR_URL.format(id=i), v["mentions"]) for i, v in narrators.items()]
    return new, {k: dict(v) for k, v in stats.items()}, leftovers, books, chapters, narrator_rows
