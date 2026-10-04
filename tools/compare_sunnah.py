#!/usr/bin/env python3
"""Compare the sunnah.com dump (data/sunnah/sunnah.db) with our merged DB (data/hadith-db/hadith.db).

Joins by collection + number. Sunnah writes "1079 a" for HU "1079a", and "2711, 2712" for a record
covering two numbers. Each join is checked by Arabic matn similarity.
Writes reports/sunnah-compare.md and reports/sunnah-compare.json.
"""
import json, os, re, sqlite3, statistics, sys
from collections import Counter, defaultdict

# Workspace root: the folder that holds data/ (sibling of this repo by default).
ROOT = os.environ.get("HADITS_WORKSPACE") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from build_hadith_db import norm_ar, sim, containment, grade_class, canon_grader  # noqa: E402

COLLECTION_MAP = {"bukhari": "bukhari", "muslim": "muslim", "abudawud": "abudawud", "tirmidhi": "tirmidhi", "nasai": "nasai",
                  "ibnmajah": "ibnmajah", "ahmad": "ahmad", "adab": "adab", "shamail": "shamail",
                  "riyadussalihin": "riyad", "mishkat": "mishkat"}
TAG = re.compile(r"\[/?(?:prematn|matn|postmatn|narrator[^\]]*|place[^\]]*|name[^\]]*)\]")


def parts(ar):
    """Split sunnah markup into isnad / matn / postmatn and collect narrators."""
    ar = ar or ""
    def grab(tag):
        m = re.search(rf"\[{tag}\](.*?)\[/{tag}\]", ar, re.S)
        return TAG.sub("", m.group(1)).strip() if m else None
    narrators = [{"id": int(i), "role": r, "name": t} for i, r, t in re.findall(r'\[narrator id="(\d+)" role="(\w+)" tooltip="([^"]*)"\]', ar)]
    return {"isnad": grab("prematn"), "matn": grab("matn"), "post": grab("postmatn"), "plain": TAG.sub("", ar).strip(), "narrators": narrators}


def numbers(n):
    """'1079 a' → ['1079a'];  '2711, 2712' → ['2711', '2712']."""
    return [re.sub(r"\s+", "", x) for x in n.split(",") if x.strip()]


def main():
    s = sqlite3.connect(os.path.join(ROOT, "data", "sunnah", "sunnah.db"))
    h = sqlite3.connect(os.path.join(ROOT, "data", "hadith-db", "hadith.db"))
    h.row_factory = sqlite3.Row
    stats, samples = {}, defaultdict(list)
    for scol, hcol in COLLECTION_MAP.items():
        anth = hcol in ("riyad", "mishkat")
        st = Counter()
        sims, gpairs, gagree, narr = [], 0, 0, 0
        for row in s.execute("SELECT hadithNumber, arabicText, englishgrade1, englishText FROM hadith WHERE collection=?", (scol,)):
            st["sunnah"] += 1
            nums = numbers(row[0])
            p = parts(row[1])
            if p["narrators"]:
                narr += 1
            target = None
            for num in nums:
                key = f"{hcol}:{num}"
                if anth:
                    a = h.execute("SELECT source_key FROM anthology_entry WHERE key=?", (key,)).fetchone()
                    key = a[0] if a else None
                if key:
                    target = h.execute("SELECT key, ar_norm_matn, grades_json FROM hadith WHERE key=?", (key,)).fetchone()
                if target:
                    break
            if not target:
                st["unmatched"] += 1
                if len(samples[scol]) < 3:
                    samples[scol].append({"sunnah": row[0], "reason": "no key in our DB", "text": (p["matn"] or p["plain"])[:100]})
                continue
            st["joined"] += 1
            if len(nums) > 1:
                st["combined_numbers"] += 1
            mine = target["ar_norm_matn"] or ""
            theirs = norm_ar(p["matn"] or p["plain"])
            sc = max(sim(theirs, mine), containment(mine, theirs) if mine else 0)
            sims.append(sc)
            if sc < 0.5 and len(samples[scol + ":low"]) < 3:
                samples[scol + ":low"].append({"sunnah": row[0], "ours": target["key"], "score": round(sc, 3), "sunnah_matn": theirs[:90], "our_matn": mine[:90]})
            g = row[2].strip().rstrip("]") if row[2] else ""
            if g and not anth:
                zubair = [x for x in json.loads(target["grades_json"] or "[]") if x["grader"] == "Zubair Ali Zai"]
                if zubair:
                    gpairs += 1
                    gagree += int(any(grade_class(g) == x["class"] for x in zubair))
        stats[scol] = {
            "our_collection": hcol, **st, "with_narrator_markup": narr,
            "matn_sim_median": round(statistics.median(sims), 3) if sims else None,
            "matn_sim_ge_0_9_pct": round(100 * sum(x >= 0.9 for x in sims) / len(sims), 1) if sims else None,
            "darussalam_vs_zubair_pairs": gpairs, "darussalam_vs_zubair_agree_pct": round(100 * gagree / gpairs, 1) if gpairs else None,
        }
        print(scol, stats[scol], flush=True)
    os.makedirs(os.path.join(ROOT, "reports"), exist_ok=True)
    json.dump({"stats": stats, "samples": samples}, open(os.path.join(ROOT, "reports", "sunnah-compare.json"), "w"), ensure_ascii=False, indent=1)
    L = ["# sunnah.com dump vs our hadith DB", "", "| sunnah collection | ours | rows | joined | combined numbers | unmatched | narrator markup | matn sim median | sim ≥ 0.9 % | Darussalam vs Zubair agree % |", "|---|---|---|---|---|---|---|---|---|---|"]
    for c, x in stats.items():
        L.append(f"| {c} | {x['our_collection']} | {x.get('sunnah',0)} | {x.get('joined',0)} | {x.get('combined_numbers',0)} | {x.get('unmatched',0)} | {x['with_narrator_markup']} | {x['matn_sim_median']} | {x['matn_sim_ge_0_9_pct']} | {x['darussalam_vs_zubair_agree_pct']} |")
    L += ["", "## Samples", ""] + [f"- **{k}**: " + "; ".join(f"`{json.dumps(v, ensure_ascii=False)}`" for v in vs) for k, vs in samples.items()]
    open(os.path.join(ROOT, "reports", "sunnah-compare.md"), "w").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
