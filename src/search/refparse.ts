import { collectionByAlias } from '../corpus/collections';
import { SURAHS } from '../corpus/surahs';

// Fast path: spoken or written citations ("QS 2:255", "Al-Baqarah ayat 255", "HR Bukhari no. 1",
// "Riyadhus Shalihin no. 681", "رواه مسلم") resolved to keys without any search.

export type Citation =
  | { kind: 'quran'; surah: number; from: number; to: number; start: number; end: number; text: string }
  | { kind: 'hadith'; collection: string; number: string; start: number; end: number; text: string };

/** Latin surah-name key: Indonesian/English spellings of the same name collapse to one string. */
export function surahKey(s: string): string {
  let k = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  k = k.replace(/sy|sh/g, 's').replace(/dz|dh/g, 'd').replace(/ts|th/g, 't').replace(/kh/g, 'k').replace(/gh/g, 'g');
  k = k.replace(/q/g, 'k').replace(/o/g, 'a').replace(/e/g, 'i').replace(/w/g, 'u').replace(/y/g, 'i');
  k = k.replace(/(.)\1+/g, '$1');
  k = k.replace(/^a[lnstdrz](?=.{3})/, '');
  return k.replace(/h$/, '');
}

const SURAH_BY_KEY = new Map<string, number>();
for (const [n, name] of SURAHS) SURAH_BY_KEY.set(surahKey(name), n);
// Common Indonesian names that differ from the transliteration in the metadata.
for (const [alias, n] of [['Ali Imran', 3], ['Al-Isra', 17], ['Bani Israil', 17], ['Al-Mukmin', 40], ['Ghafir', 40], ['Fussilat', 41], ['Ha Mim Sajdah', 41], ['Al-Insan', 76], ['Ad-Dahr', 76], ['Yasin', 36], ['Taha', 20], ['Al-Lahab', 111], ['Al-Masad', 111], ['Al-Ikhlas', 112], ['Asy-Syuara', 26]] as const)
  SURAH_BY_KEY.set(surahKey(alias), n);

export function surahByName(s: string): number | undefined {
  return SURAH_BY_KEY.get(surahKey(s));
}

const ayahCount = (s: number) => SURAHS[s - 1]?.[3] ?? 0;

const QURAN_CUE = /\b(qs|q\.s|surah|surat|sura|ayat|ayah|verse|firman)\b/i;
const FILLER = new Set(['no', 'nomor', 'nomer', 'number', 'num', 'hadits', 'hadis', 'hadith', 'hadist', 'ayat', 'ayah', 'verse', 'ke', 'hr', 'h', 'r', 'riwayat', 'diriwayatkan', 'oleh', 'imam', 'narrated', 'reported', 'by', 'in', 'dalam', 'di', 'kitab', 'qs', 'q', 's', 'surah', 'surat', 'sura', 'bab']);
const ARABIC_COLLECTIONS: [RegExp, string][] = [
  [/البخاري/, 'bukhari'], [/مسلم/, 'muslim'], [/أبو داود|ابو داود|أبي داود/, 'abudawud'], [/الترمذي/, 'tirmidhi'],
  [/النسائي/, 'nasai'], [/ابن ماجه/, 'ibnmajah'], [/أحمد|احمد/, 'ahmad'], [/مالك/, 'malik'], [/الدارمي/, 'darimi'],
];

function words(prefix: string): string[] {
  return prefix.split(/[\s,.;:()[\]"“”'’«»/]+/).filter(Boolean);
}

/** The collection named by the last words before a number, if any. */
function collectionBefore(prefix: string): string | undefined {
  const ws = words(prefix).slice(-6);
  while (ws.length && FILLER.has(ws[ws.length - 1].toLowerCase())) ws.pop();
  for (let k = Math.min(4, ws.length); k >= 1; k--) {
    const window = ws.slice(-k).filter((w) => !FILLER.has(w.toLowerCase()));
    for (const drop of [0, 1]) {
      const id = window.length > drop ? collectionByAlias(window.slice(drop).join('')) : undefined;
      if (id) return id;
    }
  }
  return undefined;
}

/** The surah named by the last words before a number (only when a Quran cue is nearby). */
function surahBefore(prefix: string): number | undefined {
  if (!QURAN_CUE.test(prefix)) return undefined;
  const ws = words(prefix).slice(-6);
  while (ws.length && FILLER.has(ws[ws.length - 1].toLowerCase())) ws.pop();
  for (let k = Math.min(3, ws.length); k >= 1; k--) {
    const window = ws.slice(-k);
    while (window.length && FILLER.has(window[0].toLowerCase())) window.shift();
    if (!window.length) continue;
    const n = surahByName(window.join(' '));
    if (n) return n;
  }
  return undefined;
}

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const add = (c: Citation) => {
    if (!free(c.start, c.end)) return;
    taken.push([c.start, c.end]);
    out.push(c);
  };

  // QS 2:255, QS. Al-Baqarah [2]: 255, (2:255-257)
  for (const m of text.matchAll(/(?:\b(?:QS|Q\.S|surah|surat|sura)\b\.?\s*(?:[A-Za-z'’\- ]{2,25}\s*)?\[?\s*|\()(\d{1,3})\s*\]?\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/gi)) {
    const s = Number(m[1]), a = Number(m[2]), b = Number(m[3] ?? m[2]);
    if (s >= 1 && s <= 114 && a >= 1 && b >= a && b <= ayahCount(s))
      add({ kind: 'quran', surah: s, from: a, to: b, start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }

  // Name + number: "Al-Baqarah ayat 255", "HR Bukhari no. 1", "Sunan Ibnu Majah 4216"
  for (const m of text.matchAll(/(?:no\.?|nomor|nomer|number|#|:|ayat|ayah|verse|\(|\s)\s*(\d{1,5})([a-z])?(?:\s*[-–]\s*(\d{1,3}))?\b/gi)) {
    const numStart = m.index! + m[0].indexOf(m[1]);
    const prefixStart = Math.max(0, m.index! - 60);
    const prefix = text.slice(prefixStart, m.index! + m[0].indexOf(m[1]));
    const end = m.index! + m[0].length;
    const surah = surahBefore(prefix);
    if (surah) {
      const a = Number(m[1]), b = Number(m[3] ?? m[1]);
      if (a >= 1 && b >= a && b <= ayahCount(surah)) {
        const start = cueStart(text, prefixStart, numStart);
        add({ kind: 'quran', surah, from: a, to: b, start, end, text: text.slice(start, end) });
      }
      continue;
    }
    const coll = collectionBefore(prefix);
    if (coll) {
      const start = cueStart(text, prefixStart, numStart);
      add({ kind: 'hadith', collection: coll, number: m[1] + (m[2] ?? ''), start, end, text: text.slice(start, end) });
    }
  }

  // "(HR Muslim)", "diriwayatkan oleh Imam Bukhari", "narrated by Muslim" (no number): collection only.
  for (const m of text.matchAll(/\b(?:HR|H\.R|riwayat|diriwayatkan oleh|narrated by|reported by|recorded by)\.?\s+(?:imam\s+)?([A-Za-z'’-]+(?:\s+[A-Za-z'’-]+){0,2})/gi)) {
    const ws = m[1].split(/\s+/);
    for (let k = ws.length; k >= 1; k--) {
      const coll = collectionByAlias(ws.slice(0, k).join(''));
      if (!coll) continue;
      const end = m.index! + m[0].indexOf(m[1]) + ws.slice(0, k).join(' ').length;
      add({ kind: 'hadith', collection: coll, number: '', start: m.index!, end, text: text.slice(m.index!, end) });
      break;
    }
  }

  // رواه البخاري / رواه مسلم (no number): collection only, resolved later by text match.
  for (const m of text.matchAll(/(?:رواه|أخرجه|اخرجه)\s+([^\s،.]+(?:\s+[^\s،.]+)?)/g)) {
    const hit = ARABIC_COLLECTIONS.find(([re]) => re.test(m[1]));
    if (hit) add({ kind: 'hadith', collection: hit[1], number: '', start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Start of the citation phrase: back up to the cue word ("HR", "QS", collection name) inside the prefix window. */
function cueStart(text: string, from: number, numStart: number): number {
  const window = text.slice(from, numStart);
  const cue = window.search(/\b(HR|H\.R|QS|Q\.S|riwayat|diriwayatkan|surah|surat|shahih|sahih|sunan|musnad|narrated|reported)\b/i);
  if (cue >= 0) return from + cue;
  const lastBreak = Math.max(window.lastIndexOf('.'), window.lastIndexOf(','), window.lastIndexOf('('));
  return from + (lastBreak >= 0 ? lastBreak + 1 : 0) + (window.slice(lastBreak + 1).match(/^\s*/)?.[0].length ?? 0);
}
