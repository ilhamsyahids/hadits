#!/usr/bin/env python3
"""Load the sunnah.com MariaDB dump (HadithTable.sql) into SQLite: data/sunnah/sunnah.db.

The dump is MySQL syntax (backslash escapes, multi-row INSERTs), so it is parsed here
instead of being piped into sqlite3.
"""
import os, re, sqlite3, sys

# Workspace root: the folder that holds data/ (sibling of this repo by default).
ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "sunnah", "HadithTable.sql")
DST = os.path.join(ROOT, "data", "sunnah", "sunnah.db")

COLS = ["collection", "bookNumber", "babID", "englishBabNumber", "arabicBabNumber", "hadithNumber", "ourHadithNumber",
        "arabicURN", "arabicBabName", "arabicText", "arabicgrade1", "englishURN", "englishBabName", "englishText",
        "englishgrade1", "last_updated", "xrefs"]
ESC = {"0": "\0", "'": "'", '"': '"', "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a", "\\": "\\", "%": "\\%", "_": "\\_"}


def rows(values):
    """Yield tuples from a MySQL `VALUES (...),(...);` body."""
    i, n = 0, len(values)
    while i < n:
        while i < n and values[i] != "(":
            i += 1
        if i >= n:
            return
        i += 1
        row, cur, in_str, field_is_str = [], [], False, False
        while i < n:
            c = values[i]
            if in_str:
                if c == "\\":
                    cur.append(ESC.get(values[i + 1], values[i + 1]))
                    i += 2
                    continue
                if c == "'":
                    if i + 1 < n and values[i + 1] == "'":
                        cur.append("'")
                        i += 2
                        continue
                    in_str = False
                    i += 1
                    continue
                cur.append(c)
                i += 1
                continue
            if c == "'":
                in_str, field_is_str = True, True
            elif c in ",)":
                tok = "".join(cur)
                if field_is_str:
                    row.append(tok)
                else:
                    t = tok.strip()
                    row.append(None if t.upper() == "NULL" else (float(t) if "." in t else int(t)) if re.fullmatch(r"-?\d+(\.\d+)?", t) else t)
                cur, field_is_str = [], False
                if c == ")":
                    i += 1
                    yield tuple(row)
                    while i < n and values[i] in " \t\r\n":
                        i += 1
                    if i < n and values[i] == ";":   # end of this INSERT statement
                        return
                    break
            else:
                cur.append(c)
            i += 1


def main():
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    if os.path.exists(DST):
        os.remove(DST)
    db = sqlite3.connect(DST)
    db.execute(f"CREATE TABLE hadith ({', '.join(c + ' TEXT' for c in COLS)}, PRIMARY KEY (arabicURN))")
    total = 0
    marker = "INSERT INTO `HadithTable` VALUES"
    with open(SRC, encoding="utf-8", errors="replace") as f:
        content = f.read()
    for chunk in content.split(marker)[1:]:
            batch = list(rows(chunk))
            bad = [r for r in batch if len(r) != len(COLS)]
            if bad:
                raise SystemExit(f"column count mismatch, e.g. {bad[0][:6]}")
            db.executemany(f"INSERT INTO hadith VALUES ({','.join('?' * len(COLS))})", batch)
            total += len(batch)
    db.execute("CREATE INDEX hadith_col_num ON hadith(collection, hadithNumber)")
    db.commit()
    print(f"loaded {total} rows into {DST}")


if __name__ == "__main__":
    main()
