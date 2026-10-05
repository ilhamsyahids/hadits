import { norm } from './arabic';

// The Prophet's own words inside a hadith. The source texts mark them with quotation marks: «…» (Hadith Unlocked),
// "…" or “…” (sunnah.com and the English translations). Where the displayed Arabic has lost sunnah.com's quotes,
// saidRanges() finds the quoted words of its marked-up text (ar_marked) in the displayed text.
// Pieces are returned for rendering; nothing is added to or removed from the text.

export type Piece = { text: string; prophetic: boolean };
export type Range = [number, number];

const AR = /«[^«»]+»|“[^“”]+”|"[^"]+"/g;
const EN_CURLY = /“[^“”]+”/g;
const EN = /“[^“”]+”|"[^"]+"/g;

export function prophetic(text: string | null | undefined, lang: 'ar' | 'en', ranges?: Range[] | null): Piece[] {
  if (!text) return [];
  // An odd number of straight quotes means one was never closed (a translation opening the narrator's words):
  // pairing them would mark the wrong stretch, so only curly quotes count then.
  const re = lang === 'ar' ? AR : (text.match(/"/g)?.length ?? 0) % 2 ? EN_CURLY : EN;
  const spans: Range[] = lang === 'ar' && ranges?.length && !/[«»“]/.test(text)
    ? ranges
    : [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length]);
  const out: Piece[] = [];
  let last = 0;
  for (const [a, b] of spans) {
    if (a < last || b > text.length) continue;
    if (a > last) out.push({ text: text.slice(last, a), prophetic: false });
    out.push({ text: text.slice(a, b), prophetic: true });
    last = b;
  }
  if (last < text.length) out.push({ text: text.slice(last), prophetic: false });
  return out;
}

const TAGS = /\[\/?[a-z]+(?:\s[^\]]*)?\]/g;

/** The quoted parts of sunnah.com's [matn], as character ranges of `matn` (the text shown). */
export function saidRanges(matn: string | null | undefined, marked: string | null | undefined): Range[] {
  if (!matn || !marked || /[«»“]/.test(matn)) return [];
  const body = marked.match(/\[matn\]([\s\S]*?)\[\/matn\]/)?.[1];
  if (!body) return [];
  const quotes = body.replace(TAGS, '').match(/"[^"]*"/g);
  if (!quotes) return [];

  // Words of the shown text with their offsets; honorific ligatures and punctuation normalise to nothing.
  const toks: { w: string; a: number; b: number }[] = [];
  for (const m of matn.matchAll(/\S+/g)) {
    const w = norm(m[0]);
    if (w) toks.push({ w, a: m.index!, b: m.index! + m[0].length });
  }
  const out: Range[] = [];
  let from = 0;
  for (const q of quotes) {
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length) continue;
    // Start where the first two words match (one, for a one-word quote), then walk forward word by word,
    // letting a word on either side go unmatched (spelling differences between the two editions).
    let start = -1;
    for (let i = from; i < toks.length && start < 0; i++) {
      if (toks[i].w === words[0] && (words.length < 2 || toks[i + 1]?.w === words[1])) start = i;
    }
    if (start < 0) continue;
    let pos = start, matched = 1;
    for (const w of words.slice(1)) {
      const hit = toks.slice(pos + 1, pos + 4).findIndex((t) => t.w === w);
      if (hit >= 0) { pos += hit + 1; matched++; }
    }
    if (matched / words.length < 0.6) continue;
    out.push([toks[start].a, toks[pos].b]);
    from = pos + 1;
  }
  return out;
}
