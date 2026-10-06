# Running and deploying

## Requirements

- [Bun](https://bun.sh) (tested with 1.4)
- Python 3 (only for the data tools and `bun run warm`)
- A Gemini API key, optional locally, required in production

## Local

```bash
bun install
cp .env.example .dev.vars     # fill GEMINI_API_KEY to turn on the AI steps
bun run local:setup           # sample corpus into local D1, word frequencies into local KV
bun run local:embed           # optional, needs GEMINI_API_KEY: vectors for the sample
bun run dev                   # http://localhost:4321
```

Local D1 and KV live in `.wrangler/`; delete it to start over.

**Without a Gemini key** the engine still finds and checks Arabic quotes and references by full-text search and word alignment. These need the key: vector search, LLM quote extraction, the judge, Ask, translation, glossary explanations, the quiz.

**Sample lectures** are not loaded locally. Open "Lectures and articles" and paste a text, or try one of these on the home page:

| Try | Expect |
| --- | --- |
| `إنما الأعمال بالنيات وإنما لكل امرئ ما نوى` | Verbatim, Sahih al-Bukhari 1 |
| `صلوا كما سمعتموني أصلي` | Misquote (needs the key for the judge) |
| `HR Muslim 1` | Reference |
| `QS 112:1` | Reference, Al-Ikhlas 1 |

## Commands

| Command | Does |
| --- | --- |
| `bun run dev` | Dev server with local bindings |
| `bun run test` | Unit tests (Vitest) |
| `bun run typecheck` | `astro sync` and `tsc --noEmit` |
| `bun run build` | Production build into `dist/` |
| `bun run preview` | Build, then run it in `wrangler dev` |
| `bun run deploy` | Build, deploy, then warm the samples |
| `bun run warm` | Build every sample's reports, translations, quizzes and terms on the live site |
| `bun run types` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `bun run sample` | Rebuild `sample/` from the full data (maintainers) |
| `bun run golden`, `bun run eval` | Test sets and evaluation, see [Evaluation](evaluation.md) |

## Deploy to Cloudflare

1. Create the resources named in `wrangler.jsonc` and put their ids there:
   - D1 `hadits-corpus`
   - Vectorize `hadits-units`, 1,536 dimensions, cosine
   - a KV namespace for `CACHE`
   - an AI Gateway named `hadits` (optional)
2. Set the secrets listed in [Environment](env.md) with `bunx wrangler secret put NAME`.
3. Load the corpus and vectors ([Data](data.md)).
4. `bun run deploy`.

The live site runs on the Workers paid plan.

## Where things run

```
request ─▶ src/worker.ts
            ├─ Hono API (src/api.ts): /health, /v1/*, /admin/*
            ├─ /agents/*: Ask, a Durable Object per conversation
            └─ Astro SSR pages, Vue islands
```
