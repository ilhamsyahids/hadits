"""Patch the D1 rows whose match keys changed after a normaliser fix in tools/arabic.py.

    python3 tools/reindex_quran.py vocative   # or ya_dagger; then: tools/import_d1.sh "70_reindex_*"

Fixes: "ya_dagger" (word-final ىٰ stays alif maqsura), "vocative" (Uthmani يَٰٓأَيُّهَا → يا أيها).

External-content FTS keeps the old tokens until told otherwise, so each changed row gets: FTS 'delete' with the
row's current values → UPDATE → INSERT the new values (units_fts and units_tri) → mark it in reindex_done_{fix}. Every
step skips rows already marked, so a re-run after a dropped connection doesn't touch finished rows.
Unit ids follow the same order as tools/export_d1.py (Quran first, then collections by rank and ord).
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arabic  # noqa: E402
from export_d1 import DB, OUT, QURAN, TRI_MAX, SqlWriter, collection_rank, lit  # noqa: E402


def keys_for(text):
    def cut(t):
        return t.encode("utf-8")[:TRI_MAX].decode("utf-8", "ignore").rsplit(" ", 1)[0] if len(t.encode("utf-8")) > TRI_MAX else t
    return arabic.norm(text), arabic.stems(text), cut(arabic.trigrams(text))


CHANGE = sys.argv[1] if len(sys.argv) > 1 else "vocative"
FLAG = {"ya_dagger": "LEGACY_YA_DAGGER", "vocative": "LEGACY_VOCATIVE"}[CHANGE]
MARKER = {"ya_dagger": "\u0649\u0670", "vocative": "\u0670"}[CHANGE]


def both(text):
    setattr(arabic, FLAG, True)
    old = keys_for(text)
    setattr(arabic, FLAG, False)
    return old, keys_for(text)


def units():
    """(id, ar_matn, en_text, id_text) in export order."""
    def by_key(name):
        with open(os.path.join(QURAN, "search", "text", name), encoding="utf-8") as f:
            return {r["verse_key"]: r["text"] for r in json.load(f)}
    ar, en, idn = by_key("arabic.json"), by_key("en.json"), by_key("id.json")
    n = 0
    for vk, text in ar.items():
        n += 1
        yield n, text, en.get(vk), idn.get(vk)
    con = sqlite3.connect(DB)
    colls = sorted((r[0] for r in con.execute("SELECT DISTINCT collection FROM hadith")), key=collection_rank)
    for c in colls:
        for matn, full, en_m, ind in con.execute("SELECT ar_matn, ar_full_fawaz, en_matn, ind_full FROM hadith WHERE collection = ? ORDER BY ord", (c,)):
            n += 1
            yield n, matn or full, en_m, ind


def main():
    for f in os.listdir(OUT):
        if f.startswith("70_reindex_"):
            os.remove(os.path.join(OUT, f))
    w = SqlWriter("70_reindex")
    # One marker table per fix (a row may be re-keyed by more than one fix); never dropped, so re-runs stay safe.
    done = "reindex_done" if CHANGE == "ya_dagger" else f"reindex_done_{CHANGE}"
    w.stmt(f"CREATE TABLE IF NOT EXISTS {done} (id INTEGER PRIMARY KEY);")
    changed = 0
    for uid, text, en, idt in units():
        if not text or MARKER not in text:
            continue
        (on, os_, ot), (nn, ns, nt) = both(text)
        if (on, os_, ot) == (nn, ns, nt):
            continue
        changed += 1
        todo = f"id = {uid} AND id NOT IN (SELECT id FROM {done})"
        # Delete the indexed tokens using the row's current (old) values, swap in the new keys, index them, mark done.
        w.stmt(f"INSERT INTO units_fts(units_fts, rowid, ar_stem, en_text, id_text) SELECT 'delete', id, ar_stem, en_text, id_text FROM units WHERE {todo};")
        w.stmt(f"INSERT INTO units_tri(units_tri, rowid, ar_tri) SELECT 'delete', id, ar_tri FROM units_tri_src WHERE {todo};")
        w.stmt(f"UPDATE units SET ar_norm = {lit(nn)}, ar_stem = {lit(ns)} WHERE {todo};")
        w.stmt(f"UPDATE units_tri_src SET ar_tri = {lit(nt)} WHERE {todo};")
        w.stmt(f"INSERT INTO units_fts(rowid, ar_stem, en_text, id_text) SELECT id, ar_stem, en_text, id_text FROM units WHERE {todo};")
        w.stmt(f"INSERT INTO units_tri(rowid, ar_tri) SELECT id, ar_tri FROM units_tri_src WHERE {todo};")
        w.stmt(f"INSERT OR IGNORE INTO {done}(id) VALUES ({uid});")
    w.close()
    print(f"{changed} units re-keyed → {w.files}")


if __name__ == "__main__":
    main()
