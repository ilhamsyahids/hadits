# MajelisNote Dalil (hadits.net)

Checks the ayat and hadith quoted in lectures and articles against their sources. Start with `README.md`; the details are in `docs/`.

- How the engine works: `docs/how-it-works.md`
- Rules, traps and layout: `docs/things-to-know.md` (read before changing code)
- Running, env, data, API, evaluation, design: `docs/running.md`, `docs/env.md`, `docs/data.md`, `docs/api.md`, `docs/evaluation.md`, `docs/design.md`

## Stack

Cloudflare Worker with a custom entry `src/worker.ts`: the Hono API (`src/api.ts`) answers first, then Ask (`/agents/*`, a Durable Object), then Astro SSR pages with Vue 3 islands. D1, Vectorize, KV, AI Gateway, Gemini, AI SDK. Bun runs everything.

## Commands

```bash
bun install && bun run local:setup && bun run dev    # local, sample corpus
bunx tsc --noEmit && bun run test                    # before every commit
bun run deploy                                       # build, deploy, warm the samples
```

## Rules

- Scripture is never written by a model or by hand: render Quran and hadith from D1 by key.
- Dalil never grades; show each grader's grade.
- Data (`../data`) and secrets (`.dev.vars`, Wrangler secrets) are never committed or sent to the browser.
- `src/lib/arabic.ts` and `tools/arabic.py` change together.
- Bump `VERIFY_VERSION` when verification output changes.
- Respect every rate limit; no proxies.
- No writes to MajelisNote production databases without the owner's approval.
- Git: one stacked branch and one PR per feature, one-line semantic commits.
