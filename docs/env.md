# Environment

Locally, values go in `.dev.vars` (copy `.env.example`). In production, secrets are set with `bunx wrangler secret put NAME` and variables live in `wrangler.jsonc`. Neither file with real values is ever committed, and no secret is sent to the browser.

## Secrets

| Name | Needed | Used for |
| --- | --- | --- |
| `GEMINI_API_KEY` | Production; optional locally | Embeddings, quote extraction, judge, Ask, translation, glossary, quiz |
| `ADMIN_USER`, `ADMIN_PASSWORD` | For `/admin` | Sign-in to the admin page. Without both, the page stays closed. Changing either signs everyone out. |
| `ADMIN_TOKEN` | For offline jobs | `Bearer` token for `/admin/*` (vector upserts from `tools/embed_batch.py`) |
| `CF_AIG_TOKEN` | Optional | AI Gateway auth. Without it, Gemini is called directly; on a gateway error it retries directly. |
| `TAVILY_API_KEY` | Optional | Ask's search of trusted websites. Without it, Ask uses only the corpus and the lecture. |

## Variables (`wrangler.jsonc` → `vars`)

| Name | Value | Meaning |
| --- | --- | --- |
| `CF_ACCOUNT_ID`, `AI_GATEWAY_ID` | your account, `hadits` | AI Gateway route |
| `EMBED_MODEL`, `EMBED_DIM` | `gemini-embedding-2`, `1536` | Must match the Vectorize index |
| `LLM_MODEL` | Gemini flash | Ask, translation, quiz |
| `LLM_MODEL_LITE` | Gemini flash-lite | Glossary terms and explanations |
| `JUDGE_MODEL` | Gemini flash-lite | Grey-band judge |
| `EXTRACT_MODEL` | Gemini flash-lite | Quote extraction |

## Local only (`.dev.vars`)

| Name | Value | Meaning |
| --- | --- | --- |
| `LOCAL_VECTORS` | `1` | Vector search reads the local D1 table filled by `bun run local:embed` (Vectorize has no local mode) |
| `EMBED_DIM` | `768` | Smaller vectors for the sample |

## Bindings

| Binding | Type | Holds |
| --- | --- | --- |
| `CORPUS` | D1 `hadits-corpus` | Units (ayat and hadith), FTS5 indexes, narrators, chapters |
| `UNITS_INDEX` | Vectorize `hadits-units` | One vector per unit |
| `CACHE` | KV | Reports, decisions, translations, quizzes, terms, explanations, lectures, reviews, rate limits |
| `AskAgent` | Durable Object | One Ask conversation each |
| `AI` | Workers AI | Embedding benchmarks only (`/admin/embed`) |
| `ASSETS` | Static assets | `dist/` |

`APP`, `LECTURES_INDEX`, `DATA` (R2) and `JOBS` (Queue) are declared for later work; the code does not use them yet.
