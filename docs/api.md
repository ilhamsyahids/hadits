# API

JSON over HTTP, same origin as the site. `lang` is `en`, `ar` or `id` and sets the language of references, grade notes and reasons. Routes are in `src/routes/v1.ts` and `src/routes/admin.ts`.

## Public

| Method and path | Body or query | Returns |
| --- | --- | --- |
| `GET /health` | | `{ ok, units }` |
| `GET /v1/refs/:key` | `lang` | One ayah or hadith in full, with its other wordings. `key`: `bukhari:1`, `quran:2:255` |
| `GET /v1/search` | `q`, `kind` (`quran`, `hadith`), `limit`, `lang` | Ranked units and which index found each |
| `POST /v1/verify` | `{ text }` for one quote, or `{ transcript: { segments } }`; `lang`, `nocache` | Findings with status, match, changed words, grades. Cached 7 days. |
| `GET /v1/lectures` | | The sample index |
| `GET /v1/lectures/:id` | | A lecture or article |
| `GET /v1/lectures/:id/report` | `lang` | Its report (built once, then cached) |
| `GET /v1/lectures/:id/translation` | `to` | Translation with scripture from the database |
| `GET /v1/lectures/:id/quiz` | `lang` | Quiz items |
| `GET /v1/lectures/:id/terms` | `lang` | Glossary terms found in the text |
| `POST /v1/documents` | `{ text, title?, filename? }` | `{ id, token }`. Kept 30 days. 10 per address per hour. |
| `DELETE /v1/documents/:id` | `Authorization: Bearer {token}` | Deletes the text and everything built from it |
| `POST /v1/reviews` | `{ said, status, key?, page?, note? }` | Adds a finding to the review queue. 30 per address per hour. |
| `POST /v1/messages` | `{ kind: dispute \| suggest \| feedback, message, key?, email? }` | A message for the admin page. Kept 180 days. 10 per address per hour. |
| `POST /v1/explain` | `{ term, context, lang }`, or `{ label, gloss, context, lang }` for a found term | What the term means in the passage. 120 per address per hour. |
| `POST /v1/terms` | `{ text, lang }` | Glossary terms found in any text (Ask answers). 120 per address per hour. |

Ask is a WebSocket at `/agents/ask-agent/{conversation}` (AI SDK chat protocol), 300 connections per address per hour.

## Admin

Every `/admin/*` route takes either `Authorization: Bearer {ADMIN_TOKEN}` or the admin page's session cookie. With the cookie, changes must come from the site's own origin.

| Method and path | Does |
| --- | --- |
| `POST /admin/login`, `POST /admin/logout` | Sign in and out (form post from `/admin`) |
| `GET /admin/messages` | Messages from the sources page, newest first |
| `DELETE /admin/messages/:id` | Remove one message |
| `GET /admin/reviews` | Review queue, newest first |
| `DELETE /admin/reviews/:id` | Remove one review |
| `GET /admin/documents` | Submitted texts, newest first |
| `DELETE /admin/documents/:id` | Delete a submitted text and everything built from it |
| `POST /admin/vectors` | Upsert up to 1,000 vectors (embedding job) |
| `POST /admin/embed` | Workers AI embeddings for benchmarks |

## Example

```bash
curl -s https://hadits.net/v1/verify -H 'content-type: application/json' \
  -d '{"text":"صلوا كما سمعتموني أصلي","lang":"en"}'
```
