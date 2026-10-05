"""Turn the demo lecture notes (markdown) into transcript segments and store them for the demo site.

    python3 tools/demo_lectures.py                  # → ../data/demo/{id}.json
    python3 tools/demo_lectures.py --upload         # also writes KV keys lecture:{id} and lectures:index

The notes are not committed (they live in the workspace next to this repo). Each paragraph becomes a segment; a
heading starts a new section. Timestamps are estimated from the text length (speech rate per language), so the
timeline is plausible but not real audio time.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "demo")
KV_ID = "b48590fb38464c8ba36fdd516a67c582"
CHARS_PER_SECOND = {"id": 15.0, "ar": 11.0, "en": 15.0}

DEMOS = [
    {"id": "sifat-sujud", "file": "demo-lecture-id.md", "lang": "id", "speaker": "Ustadz (contoh)"},
    {"id": "wattaqullah", "file": "demo-lecture-ar.md", "lang": "ar", "speaker": "الشيخ (مثال)"},
]


def clean(line):
    line = re.sub(r"\*\*?([^*]+)\*\*?", r"\1", line)
    return re.sub(r"\s+", " ", line).strip()


def segments(md, lang):
    out, t, section, title = [], 0.0, None, None
    for block in re.split(r"\n\s*\n|\n(?=#)", md):
        block = block.strip()
        if not block or block == "---":
            continue
        if block.startswith("#"):
            level = len(block) - len(block.lstrip("#"))
            text = clean(block.lstrip("#"))
            if level == 1 and not title:
                title = text
            else:
                section = text
            continue
        for para in [p for p in block.split("\n") if p.strip()]:
            text = clean(para)
            if not text:
                continue
            dur = max(4.0, round(len(text) / CHARS_PER_SECOND[lang], 1))
            out.append({"start": round(t, 1), "end": round(t + dur, 1), "speaker": None, "section": section, "text": text})
            t += dur
    return title, out


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for d in DEMOS:
        path = os.path.join(ROOT, d["file"])
        md = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        if not md.strip():
            print(f"skip {d['file']} (missing or empty)")
            continue
        title, segs = segments(md, d["lang"])
        for s in segs:
            s["speaker"] = d["speaker"]
        lecture = {"id": d["id"], "title": title or d["id"], "lang": d["lang"], "duration": segs[-1]["end"] if segs else 0,
                   "synthetic_timing": True, "segments": segs}
        out = os.path.join(OUT, f"{d['id']}.json")
        json.dump(lecture, open(out, "w", encoding="utf-8"), ensure_ascii=False)
        index.append({k: lecture[k] for k in ("id", "title", "lang", "duration")} | {"segments": len(segs)})
        print(f"{d['id']}: {len(segs)} segments, {lecture['duration'] / 60:.0f} min → {out}")
        if "--upload" in sys.argv:
            subprocess.run(["npx", "wrangler", "kv", "key", "put", "--remote", "--namespace-id", KV_ID, f"lecture:{d['id']}", "--path", out], check=True)
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False)
    if "--upload" in sys.argv:
        subprocess.run(["npx", "wrangler", "kv", "key", "put", "--remote", "--namespace-id", KV_ID, "lectures:index", "--path", os.path.join(OUT, "index.json")], check=True)


if __name__ == "__main__":
    main()
