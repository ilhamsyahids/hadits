"""Export data/hadith-db/hadith.db + data/quran into SQL files for the D1 database `hadits-corpus`.

    python3 tools/export_d1.py            # → ../data/d1/*.sql + df maps
    tools/import_d1.sh                    # runs them against D1 in order

Why SQL files and not the .sqlite file: D1 can't import a SQLite file, and every statement must stay under 100 KB.
FTS is never in the dump. `units_fts` (over units) and `units_tri` (over units_tri_src) are external-content FTS5
tables filled afterwards by INSERT … SELECT in id ranges, one statement per file. Rows use INSERT OR REPLACE, so a
file can be re-run after a dropped connection.
"""
import json
import os
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arabic import norm, stems, trigrams  # noqa: E402

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB = os.path.join(ROOT, "data", "hadith-db", "hadith.db")
QURAN = os.path.join(ROOT, "data", "quran")
OUT = os.path.join(ROOT, "data", "d1")

CORE = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "ahmad", "darimi"]
ANTHOLOGY = ["riyadussalihin", "nawawi", "qudsi", "dehlawi", "bulugh", "mishkat", "adab", "shamail", "hisn",
             "forty", "virtues", "thulathiyyat"]
MAX_STMT = 90_000          # bytes; D1 rejects statements over 100 KB
CHUNK_FILE = 30_000_000    # bytes per SQL file (small: a dropped connection only costs one file)
FTS_BATCH = 4000           # rows per INSERT … SELECT into the FTS tables (one statement per file)
TRI_MAX = 40_000           # bytes of trigram text per unit (long sira/history entries are cut)

UNIT_COLS = ["id", "key", "kind", "collection", "number", "number_base", "ord",
             "chapter_en", "chapter_ar", "section_en", "section_ar", "title_en",
             "ar_isnad", "ar_matn", "ar_prophetic", "ar_marked", "en_isnad", "en_text", "id_text",
             "ar_norm", "ar_stem", "grade_status", "grades_json", "notes_json", "narrators_json",
             "family_id", "parallel_of", "same_as_previous_of", "anthologies_json", "source_matches_json",
             "flags_json", "url", "sunnah_url"]
BIG = {"ar_isnad", "ar_matn", "ar_prophetic", "ar_marked", "en_isnad", "en_text", "id_text", "ar_norm", "ar_stem",
       "grades_json", "narrators_json", "notes_json"}

SCHEMA = """
DROP TABLE IF EXISTS units_fts;
DROP TABLE IF EXISTS units_tri;
DROP TABLE IF EXISTS units_tri_src;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS anthology_entry;
DROP TABLE IF EXISTS narrator;
DROP TABLE IF EXISTS sunnah_book;
DROP TABLE IF EXISTS sunnah_chapter;
DROP TABLE IF EXISTS corpus_meta;
CREATE TABLE units (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, collection TEXT NOT NULL,
  number TEXT, number_base INTEGER, ord INTEGER,
  chapter_en TEXT, chapter_ar TEXT, section_en TEXT, section_ar TEXT, title_en TEXT,
  ar_isnad TEXT, ar_matn TEXT, ar_prophetic TEXT, ar_marked TEXT, en_isnad TEXT, en_text TEXT, id_text TEXT,
  ar_norm TEXT, ar_stem TEXT,
  grade_status TEXT, grades_json TEXT, notes_json TEXT, narrators_json TEXT,
  family_id TEXT, parallel_of TEXT, same_as_previous_of TEXT, anthologies_json TEXT, source_matches_json TEXT,
  flags_json TEXT, url TEXT, sunnah_url TEXT);
CREATE INDEX units_coll_num ON units(collection, number_base, number);
CREATE INDEX units_family ON units(family_id);
CREATE INDEX units_parallel ON units(parallel_of);
CREATE TABLE anthology_entry (key TEXT PRIMARY KEY, collection TEXT, number TEXT, source_key TEXT, url TEXT, title_en TEXT);
CREATE INDEX anthology_source ON anthology_entry(source_key);
CREATE TABLE narrator (id INTEGER PRIMARY KEY, name_ar TEXT, url TEXT, mentions INTEGER);
CREATE TABLE sunnah_book (collection TEXT, book_number TEXT, name_en TEXT, name_ar TEXT, hadith_start INTEGER, hadith_end INTEGER, hadith_count INTEGER, PRIMARY KEY (collection, book_number));
CREATE TABLE sunnah_chapter (collection TEXT, book_number TEXT, chapter_id TEXT, chapter_number TEXT, title_en TEXT, title_ar TEXT, intro_en TEXT, intro_ar TEXT, ending_en TEXT, ending_ar TEXT, PRIMARY KEY (collection, book_number, chapter_id));
CREATE TABLE corpus_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE VIRTUAL TABLE units_fts USING fts5(ar_stem, en_text, id_text, content='units', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE units_tri_src (id INTEGER PRIMARY KEY, ar_tri TEXT);
CREATE VIRTUAL TABLE units_tri USING fts5(ar_tri, content='units_tri_src', content_rowid='id', tokenize='unicode61');
"""


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("\x00", "").replace("'", "''") + "'"


class SqlWriter:
    """Writes statements into numbered files, each statement < MAX_STMT bytes, each file < CHUNK_FILE bytes."""

    def __init__(self, prefix):
        self.prefix, self.n, self.size, self.f, self.files = prefix, 0, 0, None, []

    def _roll(self):
        if self.f:
            self.f.close()
        self.n += 1
        path = os.path.join(OUT, f"{self.prefix}_{self.n:03d}.sql")
        self.files.append(path)
        self.f, self.size = open(path, "w", encoding="utf-8"), 0

    def stmt(self, s):
        b = len(s.encode("utf-8"))
        assert b < 100_000, f"statement too large ({b} bytes): {s[:120]}"
        if not self.f or self.size + b > CHUNK_FILE:
            self._roll()
        self.f.write(s + "\n")
        self.size += b + 1

    def close(self):
        if self.f:
            self.f.close()


class Inserter:
    """Groups rows into multi-row INSERTs under MAX_STMT; a single oversized row is inserted lean and then appended."""

    def __init__(self, writer, table, cols, big=frozenset()):
        self.w, self.table, self.cols, self.big = writer, table, cols, big
        self.head = f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES "
        self.rows, self.size = [], 0

    def add(self, row):
        tup = "(" + ",".join(lit(row.get(c)) for c in self.cols) + ")"
        b = len(tup.encode("utf-8"))
        if b + len(self.head) > MAX_STMT:
            self.flush()
            self._oversized(row)
            return
        if self.size + b + len(self.head) > MAX_STMT:
            self.flush()
        self.rows.append(tup)
        self.size += b + 1

    def _oversized(self, row):
        lean = {c: (None if c in self.big else row.get(c)) for c in self.cols}
        self.w.stmt(self.head + "(" + ",".join(lit(lean.get(c)) for c in self.cols) + ");")
        for c in self.big:
            v = row.get(c)
            if not v:
                continue
            for i in range(0, len(v), 25_000):
                self.w.stmt(f"UPDATE {self.table} SET {c} = coalesce({c}, '') || {lit(v[i:i + 25_000])} WHERE id = {row['id']};")

    def flush(self):
        if self.rows:
            self.w.stmt(self.head + ",".join(self.rows) + ";")
        self.rows, self.size = [], 0


def load_quran():
    def by_key(name):
        with open(os.path.join(QURAN, "search", "text", name), encoding="utf-8") as f:
            return {r["verse_key"]: r["text"] for r in json.load(f)}

    ar, en, idn = by_key("arabic.json"), by_key("en.json"), by_key("id.json")
    with open(os.path.join(QURAN, "v1", "meta", "chapters.json"), encoding="utf-8") as f:
        chapters = {c["id"]: c for c in json.load(f)}
    for i, (vk, text) in enumerate(ar.items()):
        s, a = map(int, vk.split(":"))
        ch = chapters[s]
        yield {
            "key": f"quran:{vk}", "kind": "quran", "collection": "quran", "number": vk, "number_base": a,
            "ord": i, "chapter_en": ch["name_simple"], "chapter_ar": ch["name_arabic"],
            "ar_matn": text, "en_text": en.get(vk), "id_text": idn.get(vk),
            "grade_status": "quran", "url": f"https://quran.com/{s}/{a}",
        }


def collection_rank(c):
    if c in CORE:
        return (1, CORE.index(c))
    if c in ANTHOLOGY:
        return (2, ANTHOLOGY.index(c))
    return (3, c)


def families(con):
    """Union-find over the links the build already found: repeat narrations, "like the previous", anthology ↔ source."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    for key, par, prev, sm, an in con.execute(
            "SELECT key, parallel_of, same_as_previous_of, source_matches_json, anthologies_json FROM hadith"):
        if par:
            union(key, par)
        if prev:
            union(key, prev)
        for m in json.loads(sm or "[]"):
            if m.get("score", 1) >= 0.85:
                union(key, m["key"])
        for a in json.loads(an or "[]"):
            union(key, f"{a['collection']}:{a['number']}")
    groups = {}
    for k in list(parent):
        groups.setdefault(find(k), []).append(k)
    fam = {}
    for members in groups.values():
        if len(members) > 1:
            fid = "f:" + min(members, key=lambda k: (collection_rank(k.split(":")[0]), k))
            for k in members:
                fam[k] = fid
    return fam


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".sql"):
            os.remove(os.path.join(OUT, f))
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    fam = families(con)
    print(f"families: {len(set(fam.values()))} clusters over {len(fam)} units")

    with open(os.path.join(OUT, "00_schema.sql"), "w", encoding="utf-8") as f:
        f.write(SCHEMA)

    units_w, tri_w = SqlWriter("10_units"), SqlWriter("40_tri")
    units = Inserter(units_w, "units", UNIT_COLS, BIG)
    tri = Inserter(tri_w, "units_tri_src", ["id", "ar_tri"])
    tri_df, stem_df, n = Counter(), Counter(), 0

    def emit(u):
        nonlocal n
        n += 1
        u["id"] = n
        u["ar_norm"] = norm(u["ar_matn"])
        u["ar_stem"] = stems(u["ar_matn"])
        units.add(u)
        t = trigrams(u["ar_matn"])
        if len(t.encode("utf-8")) > TRI_MAX:
            t = t.encode("utf-8")[:TRI_MAX].decode("utf-8", "ignore").rsplit(" ", 1)[0]
        tri.add({"id": n, "ar_tri": t})
        tri_df.update(set(t.split()))
        stem_df.update(set(u["ar_stem"].split()))

    for u in load_quran():
        emit(u)
    print(f"quran: {n}")

    colls = sorted((r[0] for r in con.execute("SELECT DISTINCT collection FROM hadith")), key=collection_rank)
    for c in colls:
        for r in con.execute("SELECT * FROM hadith WHERE collection = ? ORDER BY ord", (c,)):
            emit({
                "key": r["key"], "kind": "hadith", "collection": c, "number": r["number"],
                "number_base": r["number_base"], "ord": r["ord"],
                "chapter_en": r["chapter_en"], "chapter_ar": r["chapter_ar"],
                "section_en": r["section_en"], "section_ar": r["section_ar"], "title_en": r["title_en"],
                "ar_isnad": r["ar_isnad"], "ar_matn": r["ar_matn"] or r["ar_full_fawaz"],
                "ar_prophetic": r["ar_prophetic"], "ar_marked": r["ar_marked"],
                "en_isnad": r["en_isnad"], "en_text": r["en_matn"], "id_text": r["ind_full"],
                "grade_status": r["grade_status"], "grades_json": r["grades_json"], "notes_json": r["notes_json"],
                "narrators_json": r["narrators_json"], "family_id": fam.get(r["key"]),
                "parallel_of": r["parallel_of"], "same_as_previous_of": r["same_as_previous_of"],
                "anthologies_json": r["anthologies_json"], "source_matches_json": r["source_matches_json"],
                "flags_json": r["flags_json"], "url": r["url"], "sunnah_url": r["sunnah_url"],
            })
        print(f"{c}: total {n}")
    units.flush()
    tri.flush()
    units_w.close()
    tri_w.close()

    aux_w = SqlWriter("20_aux")
    for table, cols in [("anthology_entry", ["key", "collection", "number", "source_key", "url", "title_en"]),
                        ("narrator", ["id", "name_ar", "url", "mentions"]),
                        ("sunnah_book", ["collection", "book_number", "name_en", "name_ar", "hadith_start", "hadith_end", "hadith_count"]),
                        ("sunnah_chapter", ["collection", "book_number", "chapter_id", "chapter_number", "title_en", "title_ar", "intro_en", "intro_ar", "ending_en", "ending_ar"])]:
        ins = Inserter(aux_w, table, cols)
        for r in con.execute(f"SELECT {', '.join(cols)} FROM {table}"):
            ins.add(dict(r))
        ins.flush()
    ins = Inserter(aux_w, "corpus_meta", ["k", "v"])
    ins.add({"k": "units", "v": str(n)})
    ins.add({"k": "built_from", "v": os.path.basename(DB)})
    ins.flush()
    aux_w.close()

    # One statement per file: each file is atomic, so a resumed import never indexes a row twice.
    for i, a in enumerate(range(1, n + 1, FTS_BATCH)):
        b = min(n, a + FTS_BATCH - 1)
        with open(os.path.join(OUT, f"50_fts_{i:03d}.sql"), "w", encoding="utf-8") as f:
            f.write(f"INSERT INTO units_fts(rowid, ar_stem, en_text, id_text) SELECT id, ar_stem, en_text, id_text "
                    f"FROM units WHERE id BETWEEN {a} AND {b};\n")
        with open(os.path.join(OUT, f"60_tri_{i:03d}.sql"), "w", encoding="utf-8") as f:
            f.write(f"INSERT INTO units_tri(rowid, ar_tri) SELECT id, ar_tri FROM units_tri_src WHERE id BETWEEN {a} AND {b};\n")

    # Document frequencies let the Worker drop near-universal trigrams/stems from queries and keep the rarest.
    with open(os.path.join(OUT, "df.json"), "w", encoding="utf-8") as f:
        json.dump({"n": n, "tri": {k: v for k, v in tri_df.items() if v >= 30},
                   "stem": {k: v for k, v in stem_df.items() if v >= 200}}, f, ensure_ascii=False)
    print(f"done: {n} units → {OUT}")


if __name__ == "__main__":
    main()
