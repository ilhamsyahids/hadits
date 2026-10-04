"""Embed the corpus with gemini-embedding-2 @1536 through the Gemini Batch API, then upsert into Vectorize `hadits-units`.

Runs on a long-lived machine (our VPS); the batch takes hours and survives a laptop going to sleep.

    python3 tools/embed_batch.py prepare           # local: data/embed/requests_NN.jsonl + manifest.json
    python3 tools/embed_batch.py submit            # upload each file (File API) and create one batch job per file
    python3 tools/embed_batch.py status            # poll the jobs
    python3 tools/embed_batch.py upsert            # download finished results → POST /admin/vectors on hadits.net
    python3 tools/embed_batch.py run               # loop: submit while quota allows, poll, upsert; until all done
    python3 tools/embed_batch.py sync              # files without a batch job: synchronous batchEmbedContents (100/call,
                                                   # throttled), for when the tier's batch queue stays full

Units: the 9 core books' matn, every ar_prophetic span (the Prophet's words, id "{key}#p"), and the Quran.
Document format (keep identical at query time): "title: {collection} {number} | text: {matn}".
Env: GEMINI_API_KEY, ADMIN_TOKEN, HADITS_URL (default https://hadits.net).
"""
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "embed")
STATE = os.path.join(OUT, "jobs.json")
MODEL = "gemini-embedding-2"
DIM = 1536
PER_FILE = 5_000  # small jobs: the tier caps tokens enqueued at once (429 RESOURCE_EXHAUSTED)
MAX_CHARS = 6000
CORE = ["bukhari", "muslim", "abudawud", "tirmidhi", "nasai", "ibnmajah", "malik", "ahmad", "darimi"]
API = "https://generativelanguage.googleapis.com"


def doc(collection, number, text):
    return f"title: {collection} {number} | text: {text[:MAX_CHARS]}"


def units():
    with open(os.path.join(ROOT, "data", "quran", "search", "text", "arabic.json"), encoding="utf-8") as f:
        for r in json.load(f):
            yield {"id": f"quran:{r['verse_key']}", "text": doc("quran", r["verse_key"], r["text"]),
                   "meta": {"kind": "quran", "collection": "quran", "grade": "quran"}}
    con = sqlite3.connect(os.path.join(ROOT, "data", "hadith-db", "hadith.db"))
    q = f"SELECT key, collection, number, ar_matn, ar_prophetic, grade_status FROM hadith WHERE collection IN ({','.join('?' * len(CORE))}) ORDER BY collection, ord"
    for key, coll, num, matn, proph, grade in con.execute(q, CORE):
        meta = {"kind": "hadith", "collection": coll, "grade": grade or "ungraded"}
        if matn:
            yield {"id": key, "text": doc(coll, num, matn), "meta": meta}
        if proph:
            yield {"id": key + "#p", "text": doc(coll, num, proph), "meta": {**meta, "part": "prophetic"}}


def prepare():
    os.makedirs(OUT, exist_ok=True)
    manifest, files, f, n = {}, [], None, 0
    for u in units():
        if n % PER_FILE == 0:
            if f:
                f.close()
            path = os.path.join(OUT, f"requests_{len(files) + 1:02d}.jsonl")
            files.append(os.path.basename(path))
            f = open(path, "w", encoding="utf-8")
        req = {"key": u["id"], "request": {"content": {"parts": [{"text": u["text"]}]}, "outputDimensionality": DIM}}
        f.write(json.dumps(req, ensure_ascii=False) + "\n")
        manifest[u["id"]] = u["meta"]
        n += 1
    f.close()
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(manifest, mf)
    print(f"{n} requests in {len(files)} files → {OUT}")


def _req(method, url, body=None, headers=None, raw=False):
    h = {"x-goog-api-key": os.environ["GEMINI_API_KEY"], **(headers or {})}
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    if body is not None and not isinstance(body, bytes):
        h.setdefault("content-type", "application/json")
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method), timeout=600)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url.split('?')[0]} → {e.code}: {e.read()[:600].decode(errors='replace')}") from None
    return r if raw else json.loads(r.read() or b"{}")


def upload(path):
    size = os.path.getsize(path)
    start = _req("POST", f"{API}/upload/v1beta/files", {"file": {"display_name": os.path.basename(path)}}, {
        "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(size), "X-Goog-Upload-Header-Content-Type": "application/jsonl"}, raw=True)
    upload_url = start.headers["X-Goog-Upload-URL"]
    with open(path, "rb") as f:
        res = _req("POST", upload_url, f.read(), {"X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0"})
    return res["file"]["name"]


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save_state(s):
    json.dump(s, open(STATE, "w"), indent=1)


def submit():
    """Submit pending files in order; stop at the first quota refusal (the loop retries later)."""
    state = load_state()
    for name in sorted(x for x in os.listdir(OUT) if x.startswith("requests_")):
        s = state.get(name, {})
        if s.get("job") and s.get("state") not in ("BATCH_STATE_FAILED", "JOB_STATE_FAILED", "BATCH_STATE_EXPIRED"):
            continue
        file_name = s.get("file") or upload(os.path.join(OUT, name))
        state[name] = {"file": file_name, "upserted": False}
        save_state(state)
        try:
            job = _req("POST", f"{API}/v1beta/models/{MODEL}:asyncBatchEmbedContent", {
                "batch": {"display_name": f"hadits-{name}", "input_config": {"file_name": file_name}}})
        except RuntimeError as e:
            if "429" in str(e):
                print(f"{name}: quota full, later")
                return
            raise
        state[name]["job"] = job["name"]
        save_state(state)
        print(f"{name}: {file_name} → {job['name']}")


SYNC_PER_CALL = 100
SYNC_CALLS_PER_MIN = 40


def sync():
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    state = load_state()
    model = f"models/{MODEL}"
    for name in sorted(x for x in os.listdir(OUT) if x.startswith("requests_")):
        s = state.get(name, {})
        if s.get("upserted") or s.get("job"):
            continue
        with open(os.path.join(OUT, name), encoding="utf-8") as f:
            reqs = [json.loads(line) for line in f]
        pending, done = [], 0
        for i in range(0, len(reqs), SYNC_PER_CALL):
            part = reqs[i:i + SYNC_PER_CALL]
            body = {"requests": [{"model": model, **r["request"]} for r in part]}
            for attempt in range(8):
                t = time.time()
                try:
                    res = _req("POST", f"{API}/v1beta/{model}:batchEmbedContents", body)
                    break
                except RuntimeError as e:
                    if "429" not in str(e) and "503" not in str(e):
                        raise
                    wait = 30 * (attempt + 1)
                    print(f"  {name}: rate limited, waiting {wait}s", flush=True)
                    time.sleep(wait)
            else:
                raise RuntimeError("gave up after repeated 429s")
            for r, emb in zip(part, res["embeddings"]):
                pending.append({"id": r["key"], "values": emb["values"], "metadata": manifest[r["key"]]})
            if len(pending) >= 500:
                post_vectors(pending)
                done += len(pending)
                pending = []
            time.sleep(max(0.0, 60 / SYNC_CALLS_PER_MIN - (time.time() - t)))
        if pending:
            post_vectors(pending)
            done += len(pending)
        state[name] = {"mode": "sync", "upserted": True, "vectors": done}
        save_state(state)
        print(time.strftime("%H:%M:%S"), f"{name}: upserted {done} (sync)", flush=True)


def run():
    while True:
        submit()
        upsert()
        state = load_state()
        total = len([x for x in os.listdir(OUT) if x.startswith("requests_")])
        done = sum(1 for s in state.values() if s.get("upserted"))
        print(time.strftime("%H:%M:%S"), f"upserted {done}/{total}", flush=True)
        if done == total:
            return
        time.sleep(120)


def status():
    state = load_state()
    for name, s in sorted(state.items()):
        if not s.get("job") or s.get("upserted"):
            continue
        j = _req("GET", f"{API}/v1beta/{s['job']}")
        meta = j.get("metadata", {})
        s["state"] = meta.get("state")
        s["responses_file"] = (j.get("response") or {}).get("responsesFile") or (meta.get("output") or {}).get("responsesFile")
        print(name, s["state"], meta.get("batchStats"), "upserted" if s.get("upserted") else "")
    save_state(state)
    return state


def post_vectors(vectors):
    url = os.environ.get("HADITS_URL", "https://hadits.net") + "/admin/vectors"
    body = json.dumps({"vectors": vectors}).encode()
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=body, method="POST", headers={
                "authorization": f"Bearer {os.environ['ADMIN_TOKEN']}", "content-type": "application/json",
                "user-agent": "hadits-embed/1.0 (+https://github.com/ilhamsyahids/hadits)"}), timeout=120)
            return json.loads(r.read())
        except Exception as e:  # transient network / 5xx
            print("  retry", attempt + 1, e)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("upsert failed")


def upsert():
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    state = status()
    for name, s in sorted(state.items()):
        if s.get("upserted") or s.get("state") not in ("JOB_STATE_SUCCEEDED", "BATCH_STATE_SUCCEEDED") or not s.get("responses_file"):
            continue
        path = os.path.join(OUT, name.replace("requests_", "results_"))
        if not os.path.exists(path):
            with _req("GET", f"{API}/download/v1beta/{s['responses_file']}:download?alt=media", raw=True) as r, open(path, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
        batch, done, failed = [], 0, 0
        with open(path, encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                key = r.get("key")
                emb = ((r.get("response") or {}).get("embedding") or {}).get("values")
                if not emb or key not in manifest:
                    failed += 1
                    continue
                batch.append({"id": key, "values": emb, "metadata": manifest[key]})
                if len(batch) == 500:
                    post_vectors(batch)
                    done += len(batch)
                    batch = []
                    print(f"  {name}: {done}")
        if batch:
            post_vectors(batch)
            done += len(batch)
        s["upserted"], s["vectors"], s["failed"] = True, done, failed
        save_state(state)
        print(f"{name}: upserted {done}, failed {failed}")


if __name__ == "__main__":
    {"prepare": prepare, "submit": submit, "status": status, "upsert": upsert, "run": run, "sync": sync}[sys.argv[1]]()
