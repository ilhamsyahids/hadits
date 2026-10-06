# Evaluation

## Test sets

| Set | File | Content |
| --- | --- | --- |
| v1 | `eval/golden/v1.json` | 6 synthetic lectures, 40 planted quotes. Used while building. |
| v2 | `eval/golden/v2.json` | 6 lectures in English and Indonesian, 36 quotes. Held out. |
| v3-ar | `eval/golden/v3-ar.json` | 6 Arabic lessons and khutbahs, 36 quotes. Held out. |
| Ask | `eval/ask/questions.json`, `questions-ar.json` | Questions in English, Indonesian and Arabic, each with checks |

A test set is a template: each quote is a pointer into the corpus (a phrase to locate, a word to swap or drop, words to pick). `eval/build_golden.py` renders it with the source's own words, so no test quote is typed by hand or by a model. Rendered sets contain corpus text and stay in `../data`. Each held-out set was committed before its first run.

Planted cases: verbatim, paraphrase, misquote, weak or disputed, not found, reference alone, meaning only, Latin transliteration.

## Arms

| Arm | What runs |
| --- | --- |
| `dalil` | `POST /v1/verify` |
| `plain` | Gemini asked to find, source, classify and grade every quote, with no retrieval |
| `majelisnote` | MajelisNote's earlier summary prompt |

## Results

Held-out, before any change made after seeing them:

| Set | Measure | Dalil | Plain LLM |
| --- | --- | --- | --- |
| v3-ar (2 runs) | Status correct | 91.7% | 66.7 to 88.9% |
| | Correct source | 94.4% | 47.2 to 55.6% |
| | Invented hadith grade | 0% | 3.7 to 7.4% |
| v2 | Status correct | 91.7% | 72.2 to 86.1% |
| | Correct source | 97.2% | 47.2 to 61.1% |

v3-ar exposed errors in source choice, the judge and extraction, and they were fixed. After the fixes (no longer held out), 3 runs: status 100%, source 97.2 to 100%, invented grades 0%. v2 did not move.

Ask: 96 to 98% of answers pass every check; citations point only at ids a tool returned; abstention and referral pass.

The Arabic runs in detail, with every arm and each fix: [evaluation-arabic.md](evaluation-arabic.md).

## Run it

```bash
bun run golden v3-ar                                          # render the set into ../data/eval
bun run eval --golden v3-ar --arms dalil,plain --runs 2       # → EVALUATION-v3-ar.md
bun eval/ask_eval.ts --set ar --runs 2                         # → EVALUATION-ask.md
```

`HADITS_URL` points the runs at another deployment. Reports are written to the repository root and are not committed; raw runs go to `../data/eval/runs/`.
