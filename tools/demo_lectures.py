"""Build the sample lectures and articles shown on the site and store them in KV.

    python3 tools/demo_lectures.py                  # → ../data/demo/{id}.json
    python3 tools/demo_lectures.py --upload         # also writes KV keys lecture:{id} and lectures:index
    python3 tools/demo_lectures.py --warm           # only builds every sample report (en, ar) on the site

`bun run deploy` runs --warm, so a VERIFY_VERSION bump never leaves a reader waiting for a sample report.

Two kinds of sample:
  - lecture transcripts in markdown, kept in the workspace next to this repo (not committed)
  - English Wikipedia articles (CC BY-SA 4.0), fetched at a fixed revision and credited on the report page

Each paragraph becomes a segment and a heading starts a new section. None of them has audio, so a quote is located
by paragraph (timing "position"): start/end are the paragraph index, not seconds.
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "demo")
KV_ID = "b48590fb38464c8ba36fdd516a67c582"
UA = "DalilSamples/1.0 (https://hadits.net; ilhamsyahids@gmail.com)"
WIKI_LICENSE = {"license": "CC BY-SA 4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/"}
WIKI_SKIP = {"See also", "References", "Notes", "Further reading", "External links", "Sources", "Bibliography", "Citations"}

DEMOS = [
    {"id": "sifat-sujud", "file": "demo-lecture-id.md", "lang": "id", "speaker": "Ustadz (contoh)"},
    {"id": "wattaqullah", "file": "demo-lecture-ar.md", "lang": "ar", "speaker": "الشيخ (مثال)", "title": "درس: تقوى الله بعد الحج"},
    {"id": "wiki-sadaqah", "wikipedia": "Sadaqah", "revision": 1366109550, "lang": "en"},
    {"id": "wiki-taqwa", "wikipedia": "Taqwa", "revision": 1356571130, "lang": "en"},
]


def clean(line):
    line = re.sub(r"\*\*?([^*]+)\*\*?", r"\1", line)
    return re.sub(r"\s+", " ", line).strip()


def segments(md):
    out, section, title = [], None, None
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
            out.append({"start": len(out), "end": len(out) + 1, "speaker": None, "section": section, "text": text})
    return title, out


def wikipedia(title, revision=None):
    """Plain text of one revision (the latest if none is pinned), as markdown-like text with ## headings."""
    q = {"action": "query", "prop": "extracts|revisions", "rvprop": "ids", "explaintext": 1, "format": "json", "redirects": 1}
    q |= {"revids": revision} if revision else {"titles": title}
    req = urllib.request.Request("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
    page = next(iter(json.load(urllib.request.urlopen(req, timeout=30))["query"]["pages"].values()))
    rev = page["revisions"][0]["revid"]
    if revision and rev != revision:
        sys.exit(f"{title}: asked for revision {revision}, got {rev}")
    text, keep = [f"# {page['title']}\n"], True
    for line in page["extract"].split("\n"):
        m = re.fullmatch(r"(=+)\s*(.*?)\s*=+", line.strip())
        if m:
            keep = m.group(2) not in WIKI_SKIP
            if keep:
                text.append("\n" + "#" * len(m.group(1)) + " " + m.group(2) + "\n")
            continue
        if keep:
            text.append(line)
    source = {"name": f"Wikipedia, “{page['title']}”", "url": f"https://en.wikipedia.org/w/index.php?oldid={rev}", **WIKI_LICENSE,
              "note": f"text of revision {rev}; footnotes and reference lists left out"}
    return "\n".join(text), source


def warm():
    """Build each sample's reports, translations, quizzes and terms once, one at a time (each takes 5-60 s, then it is cached)."""
    base = os.environ.get("HADITS_URL", "https://hadits.net")
    for d in DEMOS:
        paths = [f"report?lang={l}" for l in ("en", "ar")]
        paths += [f"translation?to={l}" for l in ("en", "ar", "id") if l != d["lang"]]
        paths += [f"{k}?lang={l}" for k in ("quiz", "terms") for l in ("en", "ar")]
        for path in paths:
            url = f"{base}/v1/lectures/{d['id']}/{path}"
            lang = path
            for attempt in (1, 2):
                try:
                    body = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=180))
                    print(f"{d['id']} {lang}: ok ({len(body.get('refs') or body.get('paragraphs') or body.get('questions') or [])} items)", flush=True)
                    break
                except Exception as e:  # noqa: BLE001 (report and retry once)
                    print(f"{d['id']} {lang}: attempt {attempt} failed ({e})")


def main():
    if "--warm" in sys.argv:
        return warm()
    os.makedirs(OUT, exist_ok=True)
    index = []
    for d in DEMOS:
        source = None
        if "wikipedia" in d:
            md, source = wikipedia(d["wikipedia"], d.get("revision"))
        else:
            path = os.path.join(ROOT, d["file"])
            md = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        if not md.strip():
            print(f"skip {d['id']} (missing or empty)")
            continue
        title, segs = segments(md)
        for s in segs:
            s["speaker"] = d.get("speaker")
        lecture = {"id": d["id"], "title": title or d.get("title") or d["id"], "lang": d["lang"],
                   "kind": "article" if "wikipedia" in d else "lecture", "timing": "position", "duration": len(segs),
                   "source": source, "segments": segs}
        out = os.path.join(OUT, f"{d['id']}.json")
        json.dump(lecture, open(out, "w", encoding="utf-8"), ensure_ascii=False)
        index.append({k: lecture[k] for k in ("id", "title", "lang", "kind", "timing", "duration")} | {"segments": len(segs)})
        print(f"{d['id']}: {len(segs)} paragraphs → {out}")
        if "--upload" in sys.argv:
            subprocess.run(["npx", "wrangler", "kv", "key", "put", "--remote", "--namespace-id", KV_ID, f"lecture:{d['id']}", "--path", out], check=True)
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False)
    if "--upload" in sys.argv:
        subprocess.run(["npx", "wrangler", "kv", "key", "put", "--remote", "--namespace-id", KV_ID, "lectures:index", "--path", os.path.join(OUT, "index.json")], check=True)


if __name__ == "__main__":
    main()
