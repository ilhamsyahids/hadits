#!/usr/bin/env python3
"""Polite, resumable downloader for hadith records from hadithunlocked.com.

Source views (both allowed by robots.txt):
  /{book}?json      -> chapter/section list with each section's start number and count
  /{book}:{num}?md  -> one hadith: Arabic matn, book + number, primary grade, English (~1 KB)

The per-hadith ?json view is not used for bulk download: it embeds every parallel
narration, so one record can be 10 KB to 9 MB (bukhari:72 is 9 MB). Graders and
narrators come from that view later, only for hadith the verifier actually matches.

Output is JSON (under --out):
  {book}.jsonl          one parsed record per line, appended as sections finish
  raw/{book}/{num}.md   raw page cache (lets the parser be re-run offline, makes resume free)
  {book}.missing.txt    sections that came up short, for a follow-up pass
  progress.json         live counters

The server rate-limits (nginx 429). Default pace is 0.5 req/s with one worker; on a 429
the pace halves (floor 0.1 req/s) and the request waits for Retry-After (default 120 s).

Usage:  python3 fetch_hadith.py [--books bukhari muslim] [--rps 0.5]
"""
import argparse, json, os, re, sys, threading, time, urllib.error, urllib.request

BASE = "https://hadithunlocked.com"
UA = "dalil-fetch/0.2 (open-source hadith verification research)"
DEFAULT_BOOKS = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik"]


class Pacer:
    """Global request pacing that slows down when the server pushes back."""

    def __init__(self, rps, floor=0.1):
        self.rps, self.floor, self.lock, self.next = rps, floor, threading.Lock(), time.monotonic()
        self.throttled = 0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if self.next > now:
                time.sleep(self.next - now)
            self.next = max(now, self.next) + 1.0 / self.rps

    def back_off(self, seconds):
        with self.lock:
            self.throttled += 1
            self.rps = max(self.floor, self.rps / 2)
            self.next = time.monotonic() + seconds
        print(f"  429: pausing {seconds:.0f}s, pace now {self.rps:.2f} req/s", flush=True)


def get(url, pacer, retries=6):
    for attempt in range(retries):
        pacer.wait()
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):  # unknown numbers redirect to a 410
                return 404, ""
            if e.code == 429:
                retry_after = e.headers.get("Retry-After")
                pacer.back_off(float(retry_after) if retry_after and retry_after.isdigit() else 120)
                continue
            if e.code in (500, 502, 503, 504):
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"giving up on {url}")


LINK = re.compile(r"\(\[(?P<label>[^\]]+)\]\((?P<url>https://hadithunlocked\.com/[^)]+)\)\s*(?P<grade>[^)]*)\)~~")


def unescape_md(s):
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!|~>])", r"\1", s)


def parse_md(book, num, md):
    """Returns a record, or None if the page has no hadith body."""
    m = LINK.search(md)
    if not m:
        return None
    body_start = md.find("~~«")
    arabic = unescape_md(md[body_start + 2 : m.start()].strip()) if body_start >= 0 else ""
    if arabic.startswith("«") and arabic.endswith("»"):
        arabic = arabic[1:-1].strip()
    english = "\n".join(l[1:].strip() for l in md[m.end():].splitlines() if l.startswith(">"))
    return {
        "ref": f"{book}:{num}",
        "book": book,
        "num": num,
        "url": m.group("url"),
        "label_ar": m.group("label"),
        "grade_ar": m.group("grade").strip() or None,
        "arabic": arabic,
        "english": unescape_md(english),
        "source": "hadithunlocked.com",
    }


def split_num(num):
    m = re.fullmatch(r"(\d+)([a-z]*)", num)
    return (int(m.group(1)), m.group(2)) if m else (None, None)


def next_candidates(num):
    """After '8a' try '8b', then '9', '9a'. After '9' try '10', '10a', then '9a'."""
    n, suf = split_num(num)
    if n is None:
        return []
    if suf:
        return [f"{n}{chr(ord(suf[-1]) + 1)}", f"{n + 1}", f"{n + 1}a"]
    return [f"{n + 1}", f"{n + 1}a", f"{n}a"]


def fetch_one(book, num, out, pacer):
    path = os.path.join(out, "raw", book, f"{num}.md")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            md = f.read()
        return parse_md(book, num, md) if md else None
    status, md = get(f"{BASE}/{book}:{num}?md", pacer)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(md if status == 200 else "")
    return parse_md(book, num, md) if status == 200 else None


def walk_section(book, start, count, out, pacer):
    records, num, misses = [], start, 0
    rec = fetch_one(book, num, out, pacer)
    if rec:
        records.append(rec)
    while len(records) < count and misses < 6:
        for cand in next_candidates(num):
            rec = fetch_one(book, cand, out, pacer)
            if rec:
                records.append(rec)
                num, misses = cand, 0
                break
        else:
            n, _ = split_num(num)
            if n is None:
                break
            num, misses = f"{n + 1}", misses + 1  # gap in numbering: step over it
    return records


def sections_of(book, out, pacer):
    cache = os.path.join(out, "raw", f"{book}.sections.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            chapters = json.load(f)
    else:
        _, body = get(f"{BASE}/{book}?json", pacer)
        chapters = json.loads(body)
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(chapters, f, ensure_ascii=False)
    secs = []
    for ch in chapters:
        if str(ch.get("h1")) == "0":  # book introductions use non-standard numbering
            continue
        subs = ch.get("sections") or []
        for s in subs or [ch]:
            start = s.get("h2_start") or s.get("start")
            count = s.get("h2_count") or s.get("count")
            if start and count:
                secs.append({"h1": ch.get("h1"), "h2": s.get("h2"), "chapter_en": ch.get("title_en"),
                             "section_en": s.get("title_en") if subs else None, "start": str(start), "count": int(count)})
    return secs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--books", nargs="+", default=DEFAULT_BOOKS)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "hadithunlocked-md-crawl"))
    ap.add_argument("--rps", type=float, default=0.5)
    ap.add_argument("--limit-sections", type=int, default=0, help="pilot mode: only N sections per book")
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    pacer = Pacer(a.rps)
    progress = {"started": time.strftime("%Y-%m-%dT%H:%M:%S"), "books": {}}

    for book in a.books:
        secs = sections_of(book, out, pacer)
        if a.limit_sections:
            secs = secs[: a.limit_sections]
        expected = sum(s["count"] for s in secs)
        print(f"[{book}] {len(secs)} sections, {expected} hadith expected", flush=True)
        seen, short = set(), []
        jsonl = os.path.join(out, f"{book}.jsonl")
        with open(jsonl, "w", encoding="utf-8") as f:
            for i, s in enumerate(secs, 1):
                recs = walk_section(book, s["start"], s["count"], out, pacer)
                for r in recs:
                    if r["ref"] in seen:
                        continue
                    seen.add(r["ref"])
                    r.update({"h1": s["h1"], "h2": s["h2"], "chapter_en": s["chapter_en"], "section_en": s["section_en"]})
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
                f.flush()
                if len(recs) < s["count"]:
                    short.append(f"{s['h1']}/{s['h2']} start={s['start']} expected={s['count']} got={len(recs)}")
                if i % 50 == 0 or i == len(secs):
                    progress["books"][book] = {"sections": f"{i}/{len(secs)}", "records": len(seen),
                                               "expected": expected, "throttled": pacer.throttled,
                                               "pace_rps": round(pacer.rps, 2), "at": time.strftime("%H:%M:%S")}
                    with open(os.path.join(out, "progress.json"), "w") as pf:
                        json.dump(progress, pf, indent=2)
                    print(f"[{book}] {i}/{len(secs)} sections, {len(seen)} records, pace {pacer.rps:.2f} req/s", flush=True)
        with open(os.path.join(out, f"{book}.missing.txt"), "w") as f:
            f.write("\n".join(short))
        print(f"[{book}] done: {len(seen)}/{expected} records, {len(short)} short sections", flush=True)


if __name__ == "__main__":
    sys.exit(main())
