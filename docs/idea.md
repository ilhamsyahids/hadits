# Idea

## The problem

Ayat and hadith reach most people through lectures, khutbahs, articles and posts, quoted from memory. Three things go wrong:

- **A word changes.** "Pray as you saw me pray" becomes "as you heard me pray". One word, a different meaning.
- **The grade is lost.** A narration graded weak or fabricated is passed on as sound.
- **It is not a hadith.** A proverb or a scholar's saying gets attributed to the Prophet ﷺ.

Checking takes knowledge, time and books most listeners do not have. A general chatbot does not help: it writes text that looks like a hadith and gives grades nobody gave.

## Who it is for

- Listeners and readers who want to know whether what they heard is in the sources.
- Students of knowledge and teachers who prepare or review a lesson.
- Writers and editors who publish articles with dalil.

## What Dalil does

It finds every quote in a text, looks it up in the Quran and 317,032 hadith, and says what the source has: the same words, other words, a changed meaning, a weak grade, or nothing. Each finding links to the source page and to the original site.

## Rules the product keeps

| Rule | How it is enforced |
|---|---|
| The model never writes scripture | Quran and hadith text is read from the database by key. The model only points at text. |
| Dalil never grades | Grades are shown as each source records them, with the grader named. Disagreements are all shown. |
| Not found is not fabricated | A quote missing from the corpus is reported as missing from this corpus, with advice to ask someone with knowledge. |
| No personal rulings | Ask refers personal fiqh questions to a scholar. |
| Every claim is cited | Ask hides any citation to an id its tools did not return. |
| A person reviews, not the machine | Readers can send a finding to a review queue; nothing changes automatically. |

## Where it is going

Dalil is built to sit inside [MajelisNote](https://majelisnote.com), where lectures are recorded and transcribed, so every recorded lecture can be checked. That integration is not built yet; see [Limits and next steps](limits.md).
