# How it works

```
text ──▶ detect ───▶ retrieve ───▶ align ───────▶ judge ──▶ report
         rules +     FTS +         word           grey band
         LLM         vectors       alignment only
```

## 1. Detect (`src/verify/detect.ts`, `extract.ts`)

Finds what the text quotes.

- **Rules.** Arabic runs inside a non-Arabic text are quote candidates. In an Arabic text, only marked runs count: text in «» ﴿﴾ "", text after a cue such as "قال رسول الله ﷺ:", and runs with a citation. Spoken citations ("HR Muslim 1631", "QS 2:255", "[البقرة:203]") attach to their quote or stand alone.
- **LLM extraction.** Gemini flash-lite marks quotes the rules miss: meanings ("the Prophet said fasting is a shield"), retellings, and quote edges. Every quote it returns must exist verbatim in the input, or it is dropped.

## 2. Retrieve (`src/search/`)

Four candidate lists, fused by reciprocal rank fusion (k = 60):

| List | Index | Catches |
| --- | --- | --- |
| stem | FTS5 on light-stemmed Arabic | prefix and suffix variants |
| tri | FTS5 on character trigrams | one-letter slips, transcription errors |
| latin | FTS5 on English and Indonesian | quotes said in translation |
| vector | Vectorize, gemini-embedding-2 | paraphrases, meaning in another language |

A citation ("Bukhari 1") resolves directly (`refparse.ts`). Ayat are always added as candidates. Arabic is normalised the same way in TypeScript (`src/lib/arabic.ts`) and Python (`tools/arabic.py`), because the index was built in Python.

## 3. Align (`src/verify/align.ts`)

Smith-Waterman word alignment of the quote against each candidate gives a similarity and a coverage.

| Result | Rule |
| --- | --- |
| Verbatim | similarity ≥ 0.92 and coverage ≥ 0.9 |
| Not found | similarity < 0.55 against every candidate |
| Grey band | anything between: goes to the judge |

Among verbatim matches the cited source wins, then a graded one, then a core collection, then the shortest text.

## 4. Judge (`src/verify/judge.ts`)

Only the grey band reaches the model. It sees both texts and the word diff and decides paraphrase, misquote or a different text. A misquote is a change of meaning: negation, person, number, a different act (seeing vs hearing), a different legal term. The judge describes the difference; it never writes or corrects scripture.

## 5. Report (`src/verify/verify.ts`, `src/lectures/report.ts`)

Each finding carries a status, the source key, the changed words, grades by grader, and other sources with the same text ("Also found in").

| Status | Meaning |
| --- | --- |
| Verbatim | The words match the source |
| Paraphrase | Same report, other wording |
| Misquote | Presented as the source, but a word changes the meaning |
| Weak or disputed | Found, and a named grader graded it weak, fabricated or disputed |
| Reference | A reference said without the text |
| Not found | Not in this corpus. Not proof of fabrication |

A quote said with a reference ("… (HR. Al-Bukhari 6464)") is checked against that reference. When the cited source has the report in other wording, the card names it and shows the closest text.

## Reports and caching

- A report is built once per text and cached in KV: `report:{VERIFY_VERSION}:{id}:{lang}`.
- The decisions (quotes found, judge results) are saved per text (`decisions:{v}:{id}`), so every interface language shows the same findings; only the reasons are translated.
- Samples never expire. Submitted texts expire after 30 days, with everything built from them.
- `bun run deploy` rebuilds the sample reports, translations, quizzes and terms (`bun run warm`).

## Ask (`src/ask/`)

A tool-using agent (AI SDK `streamText`, Gemini flash) in a Durable Object, one per conversation, streamed over WebSocket.

| Tool | Returns |
| --- | --- |
| `search_dalil` | Ayat and hadith for a query |
| `expand_dalil` | A unit's full record: text, chain, grades |
| `search_lecture` | Passages of the lecture beside it, with the ayat and hadith they cite |
| `lecture_report` | The report's findings |
| `web_search_trusted` | Pages from 51 listed sites (`src/ask/sites.ts`), for explanation only |

Scripture appears in answers only as tags the page fills from the database. Citations to ids no tool returned are hidden. The asker picks a level (new to Islam, or student of knowledge) and the wording follows it. The last step runs with `toolChoice: 'none'`, so it always writes an answer.

## Translation (`src/lectures/translate.ts`)

Quotes are cut out before the model sees the text and put back afterwards:

- verbatim and weak quotes: the published translation from the database, with the reference
- paraphrases and misquotes: the speaker's own words, untranslated, so no words are put in the source's mouth

Islamic terms stay transliterated.

## Glossary (`src/lib/glossary.ts`, `src/lib/terms.ts`)

Two sources of underlined terms: a curated list of 48 terms, and terms Gemini finds in each text or answer. A found term must appear in the text as written; names, titles and group labels are dropped. A click shows the meaning and what the term means in this passage (`POST /v1/explain`), with a button that fills Ask. Selecting any words offers the same.

## Learn (`src/lectures/quiz.ts`, `src/components/LearnView.vue`)

Dalil cards from the checked findings on a Leitner schedule (kept in the browser), and a quiz. Dalil questions are built from findings without a model; content questions must point at an existing paragraph and may not quote scripture.

## Admin (`/admin`)

Sign in with `ADMIN_USER` and `ADMIN_PASSWORD`. The page lists the review queue and the submitted texts; an admin can clear a review or delete a text and everything built from it.
