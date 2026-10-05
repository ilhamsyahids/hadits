"""Compare embedding models for retrieval over our own corpus.

    python3 eval/bench_embeddings.py            # needs GEMINI_API_KEY + ADMIN_TOKEN in ../.env, HADITS_URL optional

Pool: every unit used by the golden sets plus random distractors (core hadith + Quran ayat).
Queries:
  arabic   quotes from the golden sets (verbatim, paraphrase, misquote): find the source
  en / id  English or Indonesian translation of a hadith: find the Arabic hadith (cross-lingual, what Ask needs)
Metrics: recall@1, recall@10, MRR. Workers AI models are called through POST /admin/embed on the Worker.
"""
import json
import os
import random
import sqlite3
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(HERE, "..", ".."))
for line in open(os.path.join(ROOT, ".env")):
    if "=" in line:
        k, v = line.strip().split("=", 1)
        os.environ.setdefault(k, v)
HADITS = os.environ.get("HADITS_URL", "https://hadits.net")
CORE = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "ahmad", "darimi"]
random.seed(7)

MODELS = {
    # name: (provider, doc format, query format)
    "gemini-embedding-2@1536": ("gemini", "title: {title} | text: {text}", "task: search result | query: {q}"),
    "@cf/baai/bge-m3": ("workers", "{text}", "{q}"),
    "@cf/google/embeddinggemma-300m": ("workers", "title: none | text: {text}", "task: search result | query: {q}"),
    "@cf/qwen/qwen3-embedding-0.6b": ("workers", "{text}", "Instruct: Given a quote or a description, retrieve the hadith or Quran verse it refers to\nQuery: {q}"),
}


def post(url, body, headers):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", "user-agent": "hadits-bench/1.0", **headers})
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except Exception as e:  # rate limits, transient errors
            time.sleep(3 * (attempt + 1))
            last = e
    raise RuntimeError(last)


def embed(model, texts):
    provider = MODELS[model][0]
    out = []
    step = 100 if provider == "gemini" else 20  # Workers AI rejects large batches of long Arabic texts
    for i in range(0, len(texts), step):
        part = texts[i:i + step]
        if provider == "gemini":
            m = "models/gemini-embedding-2"
            r = post(f"https://generativelanguage.googleapis.com/v1beta/{m}:batchEmbedContents",
                     {"requests": [{"model": m, "content": {"parts": [{"text": t}]}, "outputDimensionality": 1536} for t in part]},
                     {"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
            out += [e["values"] for e in r["embeddings"]]
            time.sleep(1.5)
        else:
            r = post(f"{HADITS}/admin/embed", {"model": model, "texts": part}, {"authorization": f"Bearer {os.environ['ADMIN_TOKEN']}"})
            out += r["vectors"]
    a = np.array(out, dtype=np.float32)
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)


def build():
    db = sqlite3.connect(os.path.join(ROOT, "data", "hadith-db", "hadith.db"))
    quran = {f"quran:{r['verse_key']}": r["text"] for r in json.load(open(os.path.join(ROOT, "data", "quran", "search", "text", "arabic.json"), encoding="utf-8"))}
    want, arabic_q = set(), []
    for v in ("v1", "v2"):
        for lec in json.load(open(os.path.join(ROOT, "data", "eval", f"golden-{v}.json"), encoding="utf-8"))["lectures"]:
            for it in lec["items"]:
                keys = it["expect"].get("keys") or []
                want.update(keys)
                if keys and it["expect"]["status"] in ("verbatim", "paraphrase", "misquote", "weak_or_disputed") and any("؀" <= ch <= "ۿ" for ch in it["quote"]):
                    arabic_q.append((it["quote"], set(keys)))
    rows = {}
    for k in [k for k in want if not k.startswith("quran:")]:
        r = db.execute("SELECT collection, number, ar_matn, en_matn, ind_full FROM hadith WHERE key = ?", (k,)).fetchone()
        if r and r[2]:
            rows[k] = r
    distract = db.execute(f"SELECT key, collection, number, ar_matn, en_matn, ind_full FROM hadith WHERE collection IN ({','.join('?' * len(CORE))}) AND length(ar_matn) > 60 ORDER BY random() LIMIT 3000", CORE).fetchall()
    for k, *r in distract:
        rows.setdefault(k, tuple(r))
    docs = [(k, f"{c} {n}", m[:1500]) for k, (c, n, m, *_) in rows.items()]
    qkeys = [k for k in want if k in quran] + random.sample(sorted(quran), 700)
    docs += [(k, f"quran {k[6:]}", quran[k]) for k in dict.fromkeys(qkeys)]
    pool = {k for k, *_ in docs}
    arabic_q = [(q, keys & pool) for q, keys in arabic_q if keys & pool]
    cross = [k for k, (c, n, m, en, ind) in rows.items() if c in CORE and en and 80 < len(en) < 600]
    en_q = [((rows[k][3])[:400], {k}) for k in random.sample(cross, 75)]
    with_id = [k for k in cross if rows[k][4]]
    id_q = []
    for k in random.sample(with_id, 75):
        t = rows[k][4]
        t = t[t.rfind("]") + 1:] if "]" in t else t  # drop the bracketed chain of narrators
        id_q.append((t.strip(" ,.:")[:400], {k}))
    return docs, {"arabic": arabic_q, "en": en_q, "id": id_q}


def score(D, Q, keys, queries):
    sims = Q @ D.T
    r1 = r10 = mrr = 0.0
    for i, (_, targets) in enumerate(queries):
        order = np.argsort(-sims[i])[:50]
        ranks = [j for j, d in enumerate(order) if keys[d] in targets]
        if ranks:
            r1 += ranks[0] == 0
            r10 += ranks[0] < 10
            mrr += 1 / (ranks[0] + 1)
    n = len(queries)
    return {"r@1": round(100 * r1 / n, 1), "r@10": round(100 * r10 / n, 1), "mrr": round(mrr / n, 3), "n": n}


def main():
    docs, sets = build()
    keys = [k for k, *_ in docs]
    print(f"pool {len(docs)} units; queries: " + ", ".join(f"{s} {len(q)}" for s, q in sets.items()))
    results = {}
    only = sys.argv[1:] or list(MODELS)
    for model in only:
        _, dfmt, qfmt = MODELS[model]
        t0 = time.time()
        D = embed(model, [dfmt.format(title=t, text=x) for _, t, x in docs])
        t_docs = time.time() - t0
        results[model] = {"index_seconds": round(t_docs)}
        for name, qs in sets.items():
            Q = embed(model, [qfmt.format(q=q) for q, _ in qs])
            results[model][name] = score(D, Q, keys, qs)
        print(model, json.dumps(results[model]))
    out = os.path.join(ROOT, "data", "eval", "bench-embeddings.json")
    json.dump(results, open(out, "w"), indent=1)
    print("→", out)


if __name__ == "__main__":
    main()
