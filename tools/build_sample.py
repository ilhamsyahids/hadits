"""Build the small, redistributable sample corpus in sample/ so the engine runs locally without the full data.

    python3 tools/build_sample.py       # maintainers: reads ../data, writes sample/corpus.sql + sample/df.json

What is in it (and why it may be committed):
- hadith text, English, Indonesian and graders from fawazahmed0/hadith-api (Unlicense), for every key used by the
  golden sets and the demo lectures, all of Nawawi 40 and Qudsi 40, and the first chapters of Bukhari and Muslim.
  Keys and numbering are ours (mapped through the merged DB); no Hadith Unlocked or sunnah.com text is included.
- Quran: Arabic text only (no translations) for the surahs those quotes use.
The schema is the production one (tools/export_d1.py), so the same Worker code runs on it.
"""
import glob
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arabic import norm, stems, trigrams  # noqa: E402
from export_d1 import SCHEMA, collection_rank, lit  # noqa: E402

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(HERE, "sample")
FAWAZ = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "nawawi", "qudsi"]
SURAHS = [1, 2, 3, 4, 5, 6, 15, 17, 20, 21, 22, 23, 26, 29, 31, 33, 35, 39, 49, 50, 52, 58, 59, 66, 68, 98, 112, 113, 114]
EXTRA = {"bukhari": range(1, 151), "muslim": range(1, 101)}  # fawaz hadithnumber ranges


def wanted_keys():
    keys = set()
    for f in glob.glob(os.path.join(ROOT, "data", "eval", "golden-v*.json")):
        for lec in json.load(open(f))["lectures"]:
            for it in lec["items"]:
                keys.update(it["expect"].get("keys", []))
                if it.get("source"):
                    keys.add(it["source"])
    for f in glob.glob(os.path.join(ROOT, "data", "demo", "*.verify.json")):
        for r in json.load(open(f))["refs"]:
            if r.get("match"):
                keys.add(r["match"]["key"])
                keys.update(f["key"] for f in r.get("family") or [])
    return keys


def grade_class(g):
    g = (g or "").lower()
    if "maudu" in g or "mawdu" in g or "fabricat" in g:
        return "mawdu"
    if "da'if" in g or "daif" in g or "da`if" in g or "weak" in g or "munkar" in g:
        return "daif"
    if "hasan" in g:
        return "hasan" if "sahih" not in g else "hasan_sahih"
    if "sahih" in g or "sound" in g:
        return "sahih"
    return "other"


def status(collection, grades):
    if collection in ("bukhari", "muslim"):
        return "sahihayn"
    classes = {g["class"] for g in grades}
    if not classes:
        return "ungraded"
    weak = classes & {"daif", "mawdu"}
    if weak and classes - weak - {"other"}:
        return "disputed"
    if weak:
        return "mawdu" if "mawdu" in weak else "daif"
    if classes <= {"sahih"}:
        return "sahih"
    if classes <= {"hasan"}:
        return "hasan"
    return "hasan_or_sahih"


def main():
    os.makedirs(OUT, exist_ok=True)
    con = sqlite3.connect(os.path.join(ROOT, "data", "hadith-db", "hadith.db"))
    want = wanted_keys()
    fawaz = {}
    for c in FAWAZ:
        for lang in ("ara", "eng", "ind"):
            p = os.path.join(ROOT, "data", "fawaz", f"{lang}-{c}.json")
            if os.path.exists(p):
                d = json.load(open(p, encoding="utf-8"))
                fawaz[(lang, c)] = {h["hadithnumber"]: h for h in d["hadiths"]}
                if lang == "ara":
                    fawaz[("sections", c)] = d["metadata"].get("sections", {})

    rows = []
    q = f"SELECT key, collection, number, number_base, ord, sources_json, parallel_of, url FROM hadith WHERE collection IN ({','.join('?' * len(FAWAZ))})"
    for key, coll, number, base, ordv, src, parallel_of, url in con.execute(q, FAWAZ):
        fz = (json.loads(src or "{}").get("fawazahmed0") or {})
        hn = fz.get("hadithnumber")
        if hn is None or not (key in want or hn in EXTRA.get(coll, ()) or coll in ("nawawi", "qudsi")):
            continue
        ar = fawaz.get(("ara", coll), {}).get(hn)
        if not ar or not ar.get("text"):
            continue
        en = fawaz.get(("eng", coll), {}).get(hn, {})
        ind = fawaz.get(("ind", coll), {}).get(hn, {})
        grades = [{"grader": g["name"], "grade": g["grade"], "class": grade_class(g["grade"]), "sources": ["fawazahmed0"], "conflict": False}
                  for g in (ar.get("grades") or en.get("grades") or [])]
        book = str((fz.get("reference") or {}).get("book", ""))
        rows.append({
            "key": key, "kind": "hadith", "collection": coll, "number": number, "number_base": base, "ord": ordv,
            "chapter_en": fawaz.get(("sections", coll), {}).get(book), "ar_matn": ar["text"],
            "en_text": en.get("text"), "id_text": ind.get("text"), "grade_status": status(coll, grades),
            "grades_json": json.dumps(grades, ensure_ascii=False) if grades else None, "parallel_of": parallel_of,
            "url": f"https://github.com/fawazahmed0/hadith-api#{coll}:{hn}",
        })
    rows.sort(key=lambda r: (collection_rank(r["collection"]), r["ord"] or 0))

    with open(os.path.join(ROOT, "data", "quran", "search", "text", "arabic.json"), encoding="utf-8") as f:
        ayat = [r for r in json.load(f) if int(r["verse_key"].split(":")[0]) in SURAHS]
    with open(os.path.join(ROOT, "data", "quran", "v1", "meta", "chapters.json"), encoding="utf-8") as f:
        chapters = {c["id"]: c for c in json.load(f)}
    quran = []
    for i, r in enumerate(ayat):
        s, a = map(int, r["verse_key"].split(":"))
        quran.append({"key": f"quran:{r['verse_key']}", "kind": "quran", "collection": "quran", "number": r["verse_key"], "number_base": a,
                      "ord": i, "chapter_en": chapters[s]["name_simple"], "chapter_ar": chapters[s]["name_arabic"], "ar_matn": r["text"],
                      "grade_status": "quran", "url": f"https://quran.com/{s}/{a}"})

    cols = ["id", "key", "kind", "collection", "number", "number_base", "ord", "chapter_en", "chapter_ar", "ar_matn", "en_text",
            "id_text", "ar_norm", "ar_stem", "grade_status", "grades_json", "parallel_of", "url"]
    tri_df, stem_df = {}, {}
    with open(os.path.join(OUT, "corpus.sql"), "w", encoding="utf-8") as out:
        out.write("-- Sample corpus for local runs. Hadith: fawazahmed0/hadith-api (Unlicense). Quran: Arabic text (Uthmani).\n")
        out.write("-- Built by tools/build_sample.py; load with `bun run local:setup`.\n")
        out.write(SCHEMA)
        out.write("CREATE TABLE IF NOT EXISTS local_vectors (id TEXT PRIMARY KEY, kind TEXT, collection TEXT, grade TEXT, v TEXT);\n")
        for n, u in enumerate(quran + rows, start=1):
            u["id"] = n
            u["ar_norm"], u["ar_stem"] = norm(u["ar_matn"]), stems(u["ar_matn"])
            t = trigrams(u["ar_matn"])
            out.write(f"INSERT INTO units ({', '.join(cols)}) VALUES ({', '.join(lit(u.get(c)) for c in cols)});\n")
            out.write(f"INSERT INTO units_tri_src (id, ar_tri) VALUES ({n}, {lit(t)});\n")
            for tok in set(t.split()):
                tri_df[tok] = tri_df.get(tok, 0) + 1
            for tok in set(u["ar_stem"].split()):
                stem_df[tok] = stem_df.get(tok, 0) + 1
        out.write("INSERT INTO units_fts(rowid, ar_stem, en_text, id_text) SELECT id, ar_stem, en_text, id_text FROM units;\n")
        out.write("INSERT INTO units_tri(rowid, ar_tri) SELECT id, ar_tri FROM units_tri_src;\n")
        out.write(f"INSERT INTO corpus_meta (k, v) VALUES ('units', '{len(quran) + len(rows)}'), ('built_from', 'sample');\n")
    n = len(quran) + len(rows)
    json.dump({"n": n, "tri": {k: v for k, v in tri_df.items() if v >= 3}, "stem": {k: v for k, v in stem_df.items() if v >= 5}},
              open(os.path.join(OUT, "df.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"sample: {len(rows)} hadith + {len(quran)} ayat = {n} units → {OUT}")


if __name__ == "__main__":
    main()
