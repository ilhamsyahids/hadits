"""Add the English chain of narrators (en_isnad) to an existing D1 corpus without re-importing it.

    python3 tools/patch_en_isnad.py          # → ../data/d1/80_en_isnad_*.sql, then: tools/import_d1.sh "80_en_isnad_*"

File 000 adds the column (run once); the others are UPDATE … WHERE key = …, safe to re-run.
New exports (tools/export_d1.py) carry the column already.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_d1 import DB, OUT, SqlWriter, lit  # noqa: E402


def main():
    for f in os.listdir(OUT):
        if f.startswith("80_en_isnad_"):
            os.remove(os.path.join(OUT, f))
    with open(os.path.join(OUT, "80_en_isnad_000.sql"), "w", encoding="utf-8") as f:
        f.write("ALTER TABLE units ADD COLUMN en_isnad TEXT;\n")
    w = SqlWriter("80_en_isnad")
    w.n = 0  # files 001…
    n = 0
    for key, chain in sqlite3.connect(DB).execute("SELECT key, en_isnad FROM hadith WHERE en_isnad IS NOT NULL AND en_isnad != ''"):
        w.stmt(f"UPDATE units SET en_isnad = {lit(chain[:20000])} WHERE key = {lit(key)};")
        n += 1
    w.close()
    print(f"{n} chains → {w.files}")


if __name__ == "__main__":
    main()
