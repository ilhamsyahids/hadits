import { norm } from '../lib/arabic';
import { type Citation, parseCitations } from '../search/refparse';

// Step 1: find what a transcript quotes. Arabic runs of 4+ words are quote candidates; spoken citations
// ("HR Muslim", "QS 2:255") are attached to the nearest run or reported on their own.

export type Segment = { start: number; end: number; speaker?: string; text: string; lang?: string };

export type Span = {
  id: number;
  spoken: string; // as said, trimmed of opening/closing formulas
  words: string[]; // norm() words used for matching
  start: number; // seconds
  end: number;
  segments: number[];
  cue: 'quran' | 'hadith' | null; // what the speaker announced ("Allah berfirman", "Rasulullah bersabda")
  citation?: Citation; // a spoken reference next to the quote
  optional?: boolean; // short and unannounced: reported only if it matches the corpus
};

const AR_WORD = /[ء-ي٠-٩ٰ-ۓە-ۿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g;
const MIN_WORDS = 3; // runs under 6 words also need a cue (see below)
const QURAN_CUE = /(berfirman|firman allah|firman-nya|allah ta'?ala|ayat|surat|surah|qs\b|al-?qur'?an|قال الله|قال تعالى|يقول الله|تعالى)/i;
const HADITH_CUE = /(bersabda|sabda|berkata|he said|said:|says:|rasulullah|rasul|nabi|hadits|hadis|hadith|the prophet|messenger|ﷺ|قال رسول|قال النبي|عن النبي|رواه|أخرجه)/i;

// Formulas trimmed from the edges of a run (compared on norm() text).
const LEADING = ['اعوذ بالله من الشيطان الرجيم', 'قال رسول الله', 'قال النبي', 'ان رسول الله قال', 'عن النبي انه قال', 'عن النبي قال',
  'قال الله تعالي', 'يقول الله تعالي', 'قال الله عز وجل', 'قال تعالي', 'قال الله', 'وقال', 'قال', 'وقوله تعالي', 'قوله تعالي', 'كما قال'].map(norm);
const TRAILING = ['صدق الله العظيم', 'او كما قال', 'رواه البخاري ومسلم', 'متفق عليه', 'رواه البخاري', 'رواه مسلم', 'رواه الترمذي', 'رواه ابو داود',
  'رواه النسائي', 'رواه ابن ماجه', 'رواه احمد', 'رواه'].map(norm);
const IGNORE = ['السلام عليكم ورحمه الله وبركاته', 'وعليكم السلام ورحمه الله وبركاته', 'بارك الله فيكم', 'جزاكم الله خيرا', 'والله اعلم بالصواب'].map(norm);

/** Text between a quote and a reference that still ties them together: "… (HR Muslim)", "…, QS 2:255". */
const attached = (gap: string) => gap.length <= 40 && !/[\n!?]|\.\s/.test(gap);

function trimFormulas(words: string[]): { words: string[]; dropStart: number; dropEnd: number } {
  let s = 0, e = words.length;
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of LEADING) {
      const fw = f.split(' ');
      if (e - s > fw.length && fw.every((w, i) => words[s + i] === w)) {
        s += fw.length;
        changed = true;
        break;
      }
    }
  }
  for (const f of TRAILING) {
    const fw = f.split(' ');
    if (e - s > fw.length && fw.every((w, i) => words[e - fw.length + i] === w)) {
      e -= fw.length;
      break;
    }
  }
  return { words: words.slice(s, e), dropStart: s, dropEnd: words.length - e };
}

/** quoteMode: the input is itself a quote (Cek Dalil), so short runs count and no cue is needed. */
export function detect(segments: Segment[], opts: { quoteMode?: boolean } = {}): Span[] {
  const minWords = opts.quoteMode ? 2 : MIN_WORDS;
  // One string for the whole lecture, with a map from character offset to segment.
  let full = '';
  const segAt: number[] = [];
  segments.forEach((seg, i) => {
    const t = seg.text + '\n';
    full += t;
    for (let k = 0; k < t.length; k++) segAt.push(i);
  });

  // Arabic runs: consecutive Arabic words separated only by spaces/punctuation (no Latin letters or digits).
  const runs: { a: number; b: number; words: { w: string; a: number; b: number }[] }[] = [];
  let cur: (typeof runs)[number] | null = null;
  for (const m of full.matchAll(AR_WORD)) {
    const a = m.index!, b = a + m[0].length;
    if (cur && !/[A-Za-z0-9]/.test(full.slice(cur.b, a))) {
      cur.words.push({ w: m[0], a, b });
      cur.b = b;
    } else {
      cur = { a, b, words: [{ w: m[0], a, b }] };
      runs.push(cur);
    }
  }

  const citations = parseCitations(full);
  const used = new Set<Citation>();
  const spans: Span[] = [];

  for (const [ri, r] of runs.entries()) {
    const raw = full.slice(r.a, r.b);
    const nextA = runs[ri + 1]?.a ?? full.length;
    const prevB = runs[ri - 1]?.b ?? 0;
    const all = norm(raw).split(' ').filter(Boolean);
    if (all.length < minWords || IGNORE.includes(all.join(' '))) continue;
    const { words } = trimFormulas(all);
    if (words.length < (opts.quoteMode ? 2 : 3)) continue;
    const before = full.slice(Math.max(0, r.a - 80), r.a + Math.min(40, r.b - r.a));
    const after = full.slice(r.b, Math.min(full.length, r.b + 120));
    // A reference belongs to the quote it follows ("… (HR Muslim)") or, right before it, introduces ("HR Muslim: …").
    const cite =
      citations.find((c) => !used.has(c) && c.start >= r.a && c.start < nextA && (c.start <= r.b || attached(full.slice(r.b, c.start)))) ??
      citations.find((c) => !used.has(c) && c.end <= r.a && c.start >= prevB && r.a - c.end < 25);
    if (cite) used.add(cite);
    const cue: Span['cue'] = cite ? cite.kind : QURAN_CUE.test(before) ? 'quran' : HADITH_CUE.test(before) || /رواه|متفق عليه/.test(after.slice(0, 40)) ? 'hadith' : null;
    // Short unannounced Arabic (greetings, du'a fragments) is checked, but only reported when it matches.
    const optional = !cue && words.length < 6 && !opts.quoteMode;
    const segIds = [...new Set([segAt[r.a], segAt[r.b - 1]])];
    for (let s = segIds[0]; s <= segIds[segIds.length - 1]; s++) if (!segIds.includes(s)) segIds.push(s);
    segIds.sort((x, y) => x - y);
    spans.push({
      id: spans.length,
      spoken: raw.trim(),
      words,
      start: segments[segAt[r.a]].start,
      end: segments[segAt[r.b - 1]].end,
      segments: segIds,
      cue,
      citation: cite,
      ...(optional ? { optional } : {}),
    });
  }

  // Citations said without an Arabic quote next to them ("sebagaimana dalam HR Bukhari no. 1").
  for (const c of citations) {
    if (used.has(c) || (c.kind === 'hadith' && !c.number)) continue;
    spans.push({ id: spans.length, spoken: c.text, words: [], start: segments[segAt[c.start]].start, end: segments[segAt[c.end - 1]].end, segments: [segAt[c.start]], cue: c.kind, citation: c });
  }
  return spans.sort((a, b) => a.start - b.start || a.id - b.id).map((s, i) => ({ ...s, id: i }));
}
