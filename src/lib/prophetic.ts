// The Prophet's own words inside a hadith. The source texts mark them with quotation marks: «…» (Hadith Unlocked),
// "…" or “…” (sunnah.com and the English translations).
// Pieces are returned for rendering; nothing is added to or removed from the text.

export type Piece = { text: string; prophetic: boolean };

const AR = /«[^«»]+»|“[^“”]+”|"[^"]+"/g;
const EN = /“[^“”]+”|"[^"]+"/g;

export function prophetic(text: string | null | undefined, lang: 'ar' | 'en'): Piece[] {
  if (!text) return [];
  const re = lang === 'ar' ? AR : EN;
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), prophetic: false });
    out.push({ text: m[0], prophetic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), prophetic: false });
  return out;
}
