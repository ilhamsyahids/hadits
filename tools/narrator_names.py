"""Latin names for sunnah.com narrator ids, from Hadith Unlocked's transliterated chains.

    python3 tools/narrator_names.py            # → ../data/d1/narrator_names.sql (+ a report of what was found)
    wrangler d1 execute hadits-corpus --remote --file ../data/d1/narrator_names.sql    # after each import

Both sources give the chain of a hadith in the same order (the compiler's teacher first, the Companion last).
sunnah.com marks each narrator with an id (in Arabic); Hadith Unlocked writes the chain in Latin letters
("Musaddad b. Musarhad > ʿĪsá b. Yūnus > … > al-Nabī ﷺ"). Where both chains have the same length, the names pair up
by position. A narrator's Latin name is the spelling most chains agree with (a shorter spelling that starts the same,
"Yaḥyá" for "Yaḥyá b. Saʿīd", agrees), kept only when at least 60% of his chains agree.
Nothing is transliterated by us: every name is written as Hadith Unlocked wrote it.
"""
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB = os.path.join(ROOT, "data", "hadith-db", "hadith.db")
OUT = os.path.join(ROOT, "data", "d1", "narrator_names.sql")
MIN_SHARE = 0.6
MAX_WORDS = 8  # longer segments carry the hadith's text ("… Bihadhā al-Isnād …"), not a name

PROPHET = re.compile(r"(?i)^(al-)?nab[iī]\b|^rasūl|ﷺ")
# Not a name: relatives ("his father"), and Arabic verbs Hadith Unlocked sometimes leaves in a chain segment.
NOT_A_NAME = re.compile(r"^[a-z]|\b(Saʾalt|Ḥaddath|Akhbar|Samiʿt|Qāl|Bihadhā|Isnād|Qawl|Mithl|Naḥw|And)\b", re.U)


def agrees(a, b):
    """One spelling is the other's first words: the same name, more or less fully given."""
    ta, tb = a.split(), b.split()
    short, long = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return long[: len(short)] == short


def main():
    db = sqlite3.connect(DB)
    votes = defaultdict(Counter)
    paired = 0
    for nj, en in db.execute("SELECT narrators_json, en_isnad FROM hadith WHERE narrators_json IS NOT NULL AND en_isnad IS NOT NULL"):
        narrators = json.loads(nj)
        names = [p.strip() for p in re.split(r"\s*>\s*", en) if p.strip() and not PROPHET.search(p)]
        if len(names) != len(narrators):
            continue
        paired += 1
        for n, name in zip(narrators, names):
            if "/" not in name and len(name.split()) <= MAX_WORDS and not NOT_A_NAME.search(name):
                votes[n["id"]][name] += 1

    rows, weak = [], 0
    for nid, c in votes.items():
        support = lambda name: sum(v for other, v in c.items() if agrees(name, other))  # noqa: E731
        name = max(c, key=lambda n: (support(n), c[n]))  # among the best supported, the spelling written most often
        if support(name) / sum(c.values()) >= MIN_SHARE:
            rows.append((nid, name, sum(c.values())))
        else:
            weak += 1
    total = db.execute("SELECT count(*) FROM narrator").fetchone()[0]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("UPDATE narrator SET name_en = NULL, name_en_chains = NULL;\n")
        for nid, name, n in sorted(rows):
            f.write(f"UPDATE narrator SET name_en = '{name.replace(chr(39), chr(39) * 2)}', name_en_chains = {n} WHERE id = {nid};\n")
    print(f"chains paired: {paired}; narrators: {total}; named: {len(rows)}; no clear majority: {weak} → {OUT}")


if __name__ == "__main__":
    main()
