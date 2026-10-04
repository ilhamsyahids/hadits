#!/usr/bin/env python3
"""Look up a hadith in data/hadith-db/hadith.db and resolve the links a lecture citation may need.

  python3 tools/get_hadith.py bukhari:300            # own text + the Hadith Unlocked record that holds it
  python3 tools/get_hadith.py "muslim 8a"
  python3 tools/get_hadith.py riyad:681a             # anthology number → source hadith
  python3 tools/get_hadith.py bukhari:299 --json     # full record as JSON
"""
import json, os, re, sqlite3, sys

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "hadith-db", "hadith.db")


def row(db, key):
    db.row_factory = sqlite3.Row
    r = db.execute("SELECT * FROM hadith WHERE key = ?", (key,)).fetchone()
    return dict(r) if r else None


def resolve(db, ref):
    key = re.sub(r"\s+", ":", ref.strip().lower(), count=1)
    via = None
    if not row(db, key):   # anthology number (HU numbering) → source hadith
        anth = db.execute("SELECT source_key, url FROM anthology_entry WHERE key = ?", (key,)).fetchone()
        if anth:
            via, key = {"anthology": key, "url": anth[1]}, anth[0]
    rec = row(db, key) or row(db, key.replace(":", ":fz", 1))
    if not rec:
        return None
    out = {"key": rec["key"], "via_anthology": via, "collection": rec["collection"], "number": rec["number"],
           "chapter": rec["chapter_en"], "section": rec["section_en"],
           "arabic": {"isnad": rec["ar_isnad"], "matn": rec["ar_matn"]}, "english": rec["en_matn"], "indonesian": rec["ind_full"],
           "grade": {"status": rec["grade_status"], "note": rec["grade_note"], "graders": json.loads(rec["grades_json"] or "[]")},
           "notes": json.loads(rec["notes_json"] or "[]"), "url": rec["url"], "flags": json.loads(rec["flags_json"] or "[]"),
           "prophetic": rec["ar_prophetic"], "marked": rec["ar_marked"], "narrators": json.loads(rec["narrators_json"] or "[]"),
           "sunnah_url": rec["sunnah_url"], "source_matches": json.loads(rec["source_matches_json"] or "[]")}
    for link, label in (("parallel_of", "repeat narration of"), ("same_as_previous_of", "refers to")):
        if rec[link]:
            host = row(db, rec[link])
            out["linked"] = {"relation": label, "key": host["key"], "matn": host["ar_matn"], "english": host["en_matn"],
                             "grade_status": host["grade_status"], "url": host["url"]}
            if not out["url"]:
                out["url"] = host["url"]
    if rec["absorbed_json"]:
        out["also_contains_numbers"] = json.loads(rec["absorbed_json"])
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    db = sqlite3.connect(DB)
    for ref in args:
        r = resolve(db, ref)
        if r is None:
            print(f"{ref}: not found")
            continue
        if "--json" in sys.argv:
            print(json.dumps(r, ensure_ascii=False, indent=1))
            continue
        print(f"== {r['key']}  ({r['chapter']} › {r['section']})")
        if r["via_anthology"]:
            print(f"   via {r['via_anthology']['anthology']}")
        print(f"   isnad: {(r['arabic']['isnad'] or '—')[:110]}")
        print(f"   matn : {(r['arabic']['matn'] or '—')[:160]}")
        print(f"   en   : {(r['english'] or '—')[:140]}")
        print(f"   id   : {(r['indonesian'] or '—')[:110]}")
        print(f"   grade: {r['grade']['status']} {r['grade']['note'] or ''} {[(g['grader'], g['grade'], g['sources']) for g in r['grade']['graders']]}")
        if r.get("linked"):
            print(f"   {r['linked']['relation']} {r['linked']['key']}: {(r['linked']['matn'] or '')[:100]}")
        if r.get("also_contains_numbers"):
            print(f"   also contains numbers: {r['also_contains_numbers']}")
        if r["prophetic"]:
            print(f"   prophetic words: {r['prophetic'][:120]}")
        if r["narrators"]:
            print("   narrators: " + " › ".join(f"{n['name']} [{n['role']}] {n['url']}" for n in r["narrators"][:6]))
        if r["source_matches"]:
            print(f"   quotes: {[m['key'] for m in r['source_matches'][:3]]}")
        print(f"   url  : {r['url']}  sunnah: {r['sunnah_url']}  flags: {r['flags']}")


if __name__ == "__main__":
    main()
