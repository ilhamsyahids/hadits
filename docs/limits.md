# Limits and next steps

## What it does not do yet

- **Audio.** Dalil takes transcripts, Markdown and subtitle files, not recordings. Transcription stays with the recording app.
- **Transliterated hadith.** A hadith said in Latin letters ("innamal a'malu binniyat") is matched only when the model reads it back into Arabic.
- **Some meaning-only retellings in Indonesian** are still missed.
- **Detection varies a little between runs**, because the model is part of it. The rules catch most Arabic quotes either way.
- **Narrator details.** Latin names cover 4,580 of 6,747 narrators. Biographies, death years and reliability need sunnah.com's permission or a data export.

## Highlighting the Prophet's words

The highlight follows the source's quotation marks: «…» in the Arabic, or sunnah.com's quotes mapped onto the shown text. That covers about 98% of the hadith whose source quotes him. Gaps:

- sunnah.com's `[matn]` is not always only his words (nasai:4 runs on into the narration), so only the quotes are used.
- English quotes follow the translator: some wrap a narrator's whole statement and nest his words inside (nasai:4), some leave a quote unclosed (nasai:5, highlighting turns off). A fix needs to know who speaks in each quote, or to align the English to the Arabic quote.
- About 270 hadith map partly or not at all, because the two editions spell differently.

## Next

- Dalil inside [MajelisNote](https://majelisnote.com): every recorded lecture checked after transcription.
- Live captions during a lecture, with quotes checked as they are said.
- A learning path across a series of lectures, and a teacher view.
- Narrator details, with permission.
