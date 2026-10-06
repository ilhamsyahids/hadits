# Arabic evaluation (details)

Two Arabic test sets, both committed before any run: `eval/golden/v3-ar.json` for checking (6 synthetic Arabic lessons and khutbahs, 36 planted items, rendered from the database by key) and `eval/ask/questions-ar.json` for Ask (18 questions).

## Checking quotes (v3-ar, 2 runs per arm)

Held-out result, before any change made after seeing it:

| Metric | Dalil (hybrid) | Dalil (rules only) | Dalil (LLM extraction only) | Plain LLM |
|---|---|---|---|---|
| Status correct (all items), % | 91.7 | 72.2 | 80.6 to 94.4 | 66.7 to 88.9 |
| Status correct (verbatim + not found), % | 100 | 83.3 | 91.7 to 100 | 75 to 91.7 |
| Correct source, % | 94.4 | 66.7 | 80.6 to 97.2 | 47.2 to 55.6 |
| Invented grade (hadith items), % | 0 | 0 | 0 | 3.7 to 7.4 |
| Not-found correctly flagged, % | 100 | 100 | 100 | 100 |
| Citation check correct, % | 100 | 55.6 | 62.5 to 100 | n/a |
| Detected, % | 97.2 | 80.6 | 83.3 to 100 | 66.7 to 88.9 |

What it found, and what changed:
- "أنا مدينة العلم وعلي بابها" matched an ungraded copy (al-Suyuti) instead of al-Hakim's, graded fabricated. Among verbatim matches the source now decides (graded first, then the core books). The same rule fixes reader reports: An-Nahl 16:90 reported as a weak hadith that quotes it, and "ما لي وللدنيا" reported from al-Suyuti instead of Tirmidhi 2377.
- After the fix (no longer held-out): status 94.4%, source 94.4%, invented grades 0. Golden v2 is unchanged (91.7% status, 97.2% source).
- Then two more fixes: the judge treated سمعتموني for رأيتموني as a synonym (now a different way of knowing is a misquote), and extraction took an Arabic retelling in the speaker's own words for a quote to align (now it is a meaning). After all fixes, 3 runs: status 100%, source 97.2 to 100%, detected 100%, invented grades 0. Golden v2 stays at 91.7% status, 97.2% source.
- Still scored as a source miss in some runs: the Muslim 2548a retelling matches Bukhari 5971, the same report in Bukhari's wording, which the scorer does not accept.

## Ask in Arabic (18 questions, 2 runs)

| Measure | Before fixes | After fixes (failing questions re-run) |
|---|---|---|
| Answers passing all checks | 83.3% | 12/12 re-run answers (one scorer miss: the grader names were in Arabic) |
| Citations to ids a tool returned | 91% | 100% |
| Answers with typed scripture | 1 | 0 |

Fixes: lecture passages now bring the ayat and hadith they cite as sources (the answer could not show them before), and the prompt forbids personal rulings ("لا يجب عليك …") and scripture typed in braces.
