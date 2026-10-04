#!/usr/bin/env python3
"""Mirror what the sunnah.com API serves: books, chapters and hadiths per collection.

Raw responses are cached under data/sunnah/api/ (resume = skip cached files).
Limits from sunnah.com: 5 req/s, 5,000 req/day. We use 2 req/s and stop at --budget (default 4500).
Key: SUNNAH_API_KEY from the workspace .env (never printed).

  python3 tools/fetch_sunnah_api.py --plan      # books only (~27 requests) + request estimate
  python3 tools/fetch_sunnah_api.py             # everything
"""
import argparse, concurrent.futures as cf, json, math, os, sys, threading, time, urllib.error, urllib.request

# Workspace root: the folder that holds data/ (sibling of this repo by default).
ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "sunnah", "api")
BASE = "https://api.sunnah.com/v1"


def load_key():
    for line in open(os.path.join(ROOT, ".env")):
        if line.startswith("SUNNAH_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SUNNAH_API_KEY missing from .env")


class Client:
    def __init__(self, key, rps, budget):
        self.key, self.interval, self.budget, self.used, self.next = key, 1.0 / rps, budget, 0, 0.0
        self.lock = threading.Lock()

    def get(self, path, cache):
        if os.path.exists(cache):
            with open(cache, encoding="utf-8") as f:
                return json.load(f)
        for attempt in range(5):
            with self.lock:   # global pacing across worker threads
                if self.used >= self.budget:
                    raise SystemExit(f"budget of {self.budget} requests reached; rerun tomorrow to resume")
                wait = self.next - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                self.next = time.monotonic() + self.interval
                self.used += 1
            req = urllib.request.Request(BASE + path, headers={"X-API-Key": self.key, "User-Agent": "dalil-sunnah-mirror/0.1"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.loads(r.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    data = {"data": [], "total": 0, "_status": 404}
                    break
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(10 * (attempt + 1))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                time.sleep(10 * (attempt + 1))
        else:
            raise SystemExit(f"giving up on {path}")
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return data

    def paged(self, path, cache_prefix, limit=100):
        items, page = [], 1
        while True:
            sep = "&" if "?" in path else "?"
            d = self.get(f"{path}{sep}limit={limit}&page={page}", f"{cache_prefix}.p{page}.json")
            items += d.get("data") or []
            if not d.get("next") or not d.get("data"):
                return items
            page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--rps", type=float, default=2.0)
    ap.add_argument("--budget", type=int, default=4500)
    ap.add_argument("--collections", nargs="*")
    ap.add_argument("--workers", type=int, default=4, help="books fetched in parallel (the API is slow: 10-25 s per page)")
    a = ap.parse_args()
    c = Client(load_key(), a.rps, a.budget)
    cols = c.get("/collections?limit=100", os.path.join(OUT, "collections.json"))["data"]
    names = a.collections or [x["name"] for x in cols]
    plan, books_by_col = 0, {}
    for name in names:
        books = c.paged(f"/collections/{name}/books", os.path.join(OUT, name, "books"))
        books_by_col[name] = books
        for b in books:
            plan += 1 + math.ceil((b.get("numberOfHadith") or 0) / 100)   # ≥1 chapters page + hadith pages
    print(f"collections {len(names)} · books {sum(len(b) for b in books_by_col.values())} · ≈{plan} more requests · used {c.used}", flush=True)
    if a.plan:
        return
    def one(name, n):
        c.paged(f"/collections/{name}/books/{n}/chapters", os.path.join(OUT, name, "chapters", n))
        hs = c.paged(f"/collections/{name}/books/{n}/hadiths", os.path.join(OUT, name, "hadiths", n))
        print(f"[{name}] book {n}: {len(hs)} hadith · requests used {c.used} · {time.strftime('%H:%M:%S')}", flush=True)

    jobs = [(name, b["bookNumber"]) for name in names for b in books_by_col[name]]
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for f in cf.as_completed([ex.submit(one, *j) for j in jobs]):
            f.result()
    print(f"done · requests used this run {c.used}")


if __name__ == "__main__":
    sys.exit(main())
