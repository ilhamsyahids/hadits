"""Render eval/golden/lectures.json into transcripts with the Arabic taken from the corpus.

    python3 eval/build_golden.py      # → ../data/eval/golden-v1.json (not committed: it contains corpus text)

Rules (see lectures.json "note"): `phrase` locates an excerpt in the source; the output uses the source's own
tokens. `swap` replaces one located word (a deliberate misquote). `pick` takes source words in the given order
(a paraphrase). `drop` removes one located word. `text` is a literal saying that is not in the corpus. `cite_only` is a reference already in the
segment text. Accepted keys for verbatim items = every unit whose text contains the rendered quote.
"""
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
from arabic import norm  # noqa: E402

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(HERE, "..", ".."))
DB = sqlite3.connect(os.path.join(ROOT, "data", "hadith-db", "hadith.db"))
with open(os.path.join(ROOT, "data", "quran", "search", "text", "arabic.json"), encoding="utf-8") as f:
    QURAN = {r["verse_key"]: r["text"] for r in json.load(f)}
QURAN_NORM = {k: norm(v) for k, v in QURAN.items()}


def source_text(key):
    if key.startswith("quran:"):
        return QURAN[key[6:]]
    row = DB.execute("SELECT ar_matn FROM hadith WHERE key = ?", (key,)).fetchone()
    if not row:
        raise SystemExit(f"unknown key {key}")
    return row[0]


def tokens(text):
    toks = text.split()
    return toks, [norm(t) for t in toks]


def locate(key, phrase):
    toks, tn = tokens(source_text(key))
    p = norm(phrase).split()
    idx = [i for i, w in enumerate(tn) if w]
    for s in range(len(idx) - len(p) + 1):
        if [tn[idx[s + k]] for k in range(len(p))] == p:
            return toks, tn, idx[s], idx[s + len(p) - 1]
    raise SystemExit(f"{key}: phrase not found: {phrase}\n  source: {' '.join(w for w in tn if w)[:300]}")


def strip_quote_marks(s):
    return s.strip().strip("«»\"“”").strip()


def containing(norm_text):
    """Every unit whose normalised text contains norm_text."""
    keys = [r[0] for r in DB.execute("SELECT key FROM hadith WHERE instr(ar_norm_matn, ?) > 0", (norm_text,))]
    keys += [f"quran:{k}" for k, v in QURAN_NORM.items() if norm_text in v]
    return keys


def render(item):
    if "text" in item:
        return item["text"], []
    key = item["key"]
    if "to" in item:
        s, a = key[6:].split(":")
        b = item["to"].split(":")[-1]
        text = " ".join(QURAN[f"{s}:{x}"] for x in range(int(a), int(b) + 1))
        return text, [key]
    if "pick" in item:
        toks, tn, _, _ = None, None, None, None
        toks, tn = tokens(source_text(key))
        used, out = set(), []
        for w in item["pick"]:
            i = next((i for i, t in enumerate(tn) if t == norm(w) and i not in used), None)
            if i is None:
                raise SystemExit(f"{key}: pick word not found: {w}")
            used.add(i)
            out.append(toks[i].strip('؟?«»"“”.,،:;'))
        return strip_quote_marks(" ".join(out)), [key]
    toks, tn, a, b = locate(key, item["phrase"])
    span = toks[a:b + 1]
    if "swap" in item:
        old, new = item["swap"]
        k = next((i for i in range(a, b + 1) if tn[i] == norm(old)), None)
        if k is None:
            raise SystemExit(f"{key}: swap word not found: {old}")
        span[k - a] = new
        return strip_quote_marks(" ".join(span)), [key]
    if "drop" in item:
        k = next((i for i in range(a, b + 1) if tn[i] == norm(item["drop"])), None)
        if k is None:
            raise SystemExit(f"{key}: drop word not found: {item['drop']}")
        del span[k - a]
        return strip_quote_marks(" ".join(span)), [key]
    text = strip_quote_marks(" ".join(span))
    return text, [key]


def main():
    spec = json.load(open(os.path.join(HERE, "golden", "lectures.json"), encoding="utf-8"))
    out = {"version": spec["version"], "lectures": []}
    n_items = 0
    for lec in spec["lectures"]:
        segs, t = [], 0.0
        items = []
        for si, seg in enumerate(lec["segments"]):
            text = seg
            for name, item in lec["items"].items():
                ph = "{{" + name + "}}"
                if ph in text:
                    rendered, src = render(item)
                    text = text.replace(ph, rendered)
                    exp = dict(item["expect"])
                    if "keys" not in exp:
                        same_text = containing(norm(rendered)) if exp["status"] in ("verbatim", "weak_or_disputed") else \
                            containing(norm(item["phrase"])) if "phrase" in item and "key" in item else []
                        # Anthology copies of the source (e.g. nawawi:7 quotes muslim:55a) are the same report.
                        copies = [r[0] for k in src for r in DB.execute(
                            "SELECT key FROM hadith WHERE instr(source_matches_json, ?) > 0", (f'"{k}"',))]
                        exp["keys"] = sorted(set(src + same_text + copies))
                    items.append({"name": name, "segment": si, "quote": rendered, "source": item.get("key"), "expect": exp,
                                  "kind": "quran" if (item.get("key") or "").startswith("quran:") else "hadith"})
            for name, item in lec["items"].items():
                if "cite_only" in item and item["cite_only"] in text:
                    items.append({"name": name, "segment": si, "quote": item["cite_only"], "source": None, "expect": item["expect"],
                                  "kind": "quran" if item["expect"]["keys"][0].startswith("quran:") else "hadith"})
            dur = max(6.0, round(len(text) / 14, 1))  # ~14 characters per second of speech
            segs.append({"start": round(t, 1), "end": round(t + dur, 1), "speaker": "ustadz", "text": text})
            t += dur
        n_items += len(items)
        out["lectures"].append({"id": lec["id"], "title": lec["title"], "lang": lec["lang"], "segments": segs, "items": items})
    path = os.path.join(ROOT, "data", "eval", "golden-v1.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(out['lectures'])} lectures, {n_items} items → {path}")


if __name__ == "__main__":
    main()
