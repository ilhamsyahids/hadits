# Data

The full corpus is not in this repository: some sources do not allow redistribution, and one needs an API key. The live site has it loaded. To run locally, use the sample; to rebuild the full corpus, follow the steps below.

## What the engine needs

| Store | Content | Built by |
| --- | --- | --- |
| D1 `units` | One row per ayah or hadith: key, Arabic text, normalised and stemmed Arabic, English, Indonesian, grades, chain, chapter | `tools/build_hadith_db.py`, then `tools/export_d1.py` |
| D1 `units_fts`, `units_tri` | FTS5 indexes: stems, English, Indonesian, trigrams | `tools/export_d1.py` |
| D1 `narrator`, `sunnah_book`, `sunnah_chapter`, `anthology_entry` | Narrator names, book and chapter titles, anthology links | same |
| KV `df:v1` | Word frequencies used to weight Arabic search terms | same |
| Vectorize `hadits-units` | One 1,536-d vector per unit | `tools/embed_batch.py` |
| KV `lecture:{id}`, `lectures:index` | The sample lectures and articles | `tools/demo_lectures.py --upload` |

Keys look like `bukhari:1`, `muslim:1631`, `quran:2:255`. Collection names and aliases ("HR Bukhari", "صحيح البخاري") are in `src/corpus/collections.ts`.

## Sample data (`sample/`, committed)

| File | Content |
| --- | --- |
| `corpus.sql` | 2,771 units in the production schema: 2,375 ayat (Arabic only, 29 surahs) and 396 hadith from 9 collections (Arabic, English, Indonesian, graders) |
| `df.json` | Word frequencies for the sample |

The hadith come from fawazahmed0/hadith-api (Unlicense): every key used by the test sets and the sample lectures, all of Nawawi 40 and Qudsi 40, and the first chapters of Bukhari and Muslim. No Hadith Unlocked or sunnah.com text is included. Rebuild it with `bun run sample` (reads the full data).

Sample lectures shown on the live site: `/lectures/sifat-sujud` (Indonesian lesson), `/lectures/wattaqullah` (Arabic khutbah), `/lectures/wiki-sadaqah` and `/lectures/wiki-taqwa` (English Wikipedia, CC BY-SA 4.0, fixed revisions).

## Sources of the full corpus

| Source | What we use | Terms | How to get it |
| --- | --- | --- | --- |
| Hadith Unlocked (hadithunlocked.com) | 33 collections and 4 anthologies: Arabic chain and text, English, grades, footnotes | Their terms of service; low-rate access permitted; every record links back | Each book's JSON export from its contents page → `data/hadithunlocked/hadithunlocked_{book}.json`. `tools/fetch_hadith.py` reads single pages at ≤ 0.5 req/s. |
| fawazahmed0/hadith-api | 10 collections in Arabic, English, Indonesian, with graders | Unlicense | `tools/fetch_fawaz.sh` → `data/fawaz/` |
| sunnah.com | Narrator-marked Arabic, grades with grader, book and chapter names, anthologies | API key on request; cache only; refresh monthly | Ask for a key at github.com/sunnah-com/api. Load their SQL dump with `tools/load_sunnah_dump.py`, then `tools/fetch_sunnah_api.py` (≤ 2 req/s). Optional: the build skips it when `data/sunnah/` is missing. |
| Quran: QUL (Tarteel), quran.com | 6,236 ayat in Uthmani script, English (Saheeh International), Indonesian | Attribution | QUL downloads (SQLite) or the Quran Foundation API, built to static JSON in `data/quran/` |
| Wikipedia | Two English sample articles | CC BY-SA 4.0 | `tools/demo_lectures.py` fetches fixed revisions |

All paths are under a sibling `data/` folder (`../data`, or `HADITS_WORKSPACE`). It is git-ignored.

## Build the full corpus

```bash
python3 tools/build_hadith_db.py        # ≈ 2 min → data/hadith-db/hadith.db
python3 tools/get_hadith.py bukhari:1   # spot-check
```

Result: 317,032 hadith in 40 collections, each with Arabic text; chain and text split; the Prophet's words marked; grades merged per grader with disagreements kept; repeated narrations linked.

## Load into Cloudflare

1. **D1.** Export with `tools/export_d1.py` (no FTS tables, statements under 100 KB) and import with `tools/import_d1.sh`. Build the FTS tables afterwards in batches. D1 cannot import a `.sqlite` file or export a database with virtual tables.
2. **Vectors.** `tools/embed_batch.py` embeds every unit with `gemini-embedding-2` at 1,536 dimensions through the Gemini Batch API, then upserts to Vectorize through `/admin/vectors` (`ADMIN_TOKEN`). It takes hours; run it on a server.
   - Document: `title: {collection} {number} | text: {matn}`
   - Query: `task: search result | query: {text}`

## Refresh

- sunnah.com: monthly, as they ask. Delete `data/sunnah/api/`, fetch again, rebuild.
- Hadith Unlocked and hadith-api: when their editions change.
- Respect every rate limit; never route around one.
