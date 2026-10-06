# Things to know

Read this before changing code.

## Rules that must hold

- **Scripture comes from the database.** Never let a model, a prompt or a hand-written string produce Quran or hadith text. Render it from D1 by key. The judge and Ask may describe text, never write it.
- **Dalil does not grade.** Show grades as the source records them, with the grader. Never compute or summarise a grade.
- **Not found means not in this corpus.** Keep that wording everywhere.
- **Data and secrets stay out of git.** The corpus lives outside the repo; rendered test sets contain corpus text and stay there too. Secrets live in `.dev.vars` and Wrangler secrets, never in the browser.
- **Respect rate limits.** sunnah.com 5 req/s and 5,000 a day, Hadith Unlocked low rate, Gemini and Tavily quotas. No proxies.

## Traps

| If you change | Also do |
| --- | --- |
| Arabic normalisation in `src/lib/arabic.ts` | The same change in `tools/arabic.py`, then keep `test/arabic.test.ts` green. The index was built in Python; a mismatch silently breaks search. |
| Anything that changes what verification returns | Bump `VERIFY_VERSION` in `src/lectures/report.ts`. Old reports stay cached under the old version; `bun run deploy` rebuilds the samples. |
| `wrangler.jsonc` bindings | `bun run types` |
| The embedding model or dimension | Re-embed the whole corpus and recreate the Vectorize index |
| UI text | Both languages in `src/i18n/strings.ts` (English default, Arabic at `/ar/`, right to left) |

## Conventions

- **Keys:** `collection:number` for hadith (`bukhari:1`, `muslim:2548a`), `quran:surah:ayah` for ayat.
- **Languages:** the interface is English or Arabic; the engine and API also take Indonesian (`id`).
- **Positions:** subtitles (`.srt`, `.vtt`) carry real times; everything else is located by paragraph (¶).
- **Caching:** every expensive result is in KV under a versioned key (`report:v16:…`, `translation:v16:…`). Samples never expire; submitted texts expire with the text.
- **Handlers read like a table of contents.** Put a fallback behind one function (gateway, then direct Gemini) instead of branching in the handler.
- **Models:** flash for Ask, translation and quiz; flash-lite for extraction, judging and the glossary. Model names live in `wrangler.jsonc`.

## Layout

```
src/worker.ts        entry: API, Ask WebSocket, then Astro pages
src/api.ts           /health, /v1, /admin
src/routes/          v1.ts (public API), admin.ts
src/verify/          detect, extract, align, judge, verify
src/search/          refparse (citations), retrieve (FTS + vectors, RRF), search
src/corpus/          collections, surahs, units (resolve, present, family), browse
src/lectures/        doc, parse (text and subtitles), report, translate, quiz, forget
src/ask/             agent (Durable Object), tools, prompt, trusted sites
src/lib/             arabic, gemini, glossary, terms, session, chain, prophetic
src/components/      Vue islands
src/views/, pages/   Astro pages (English at /, Arabic at /ar/)
tools/               Python data build, sample, embedding, sample lectures
eval/                test sets and runners
sample/              the committed sample corpus
test/                unit tests
```

## Git

One branch and one pull request per feature, one-line semantic commits (`feat:`, `fix:`).
