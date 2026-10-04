import { norm } from '../lib/arabic';
import { type Citation, parseCitations } from '../search/refparse';

// Step 1 (rules): find what a transcript quotes.
// - Arabic runs inside a non-Arabic lecture are quote candidates (short ones need a cue such as "Rasulullah bersabda").
// - In an Arabic lecture the lecturer's own words are Arabic too, so only these count: text in «» ﴿﴾ {} "",
//   text after a cue and a colon ("قال رسول الله ﷺ: …" up to the end of the sentence), and runs with a citation.
// - Spoken citations ("HR Muslim", "QS 2:255", "[البقرة:203]") attach to their quote or stand alone.

export type Segment = { start: number; end: number; speaker?: string; text: string; lang?: string };

export type Span = {
  id: number;
  spoken: string; // as said (Arabic quote, or the meaning / transliteration as said)
  words: string[]; // norm() Arabic words used for matching (empty for meaning-only and bare citations)
  meaning?: string; // the dalil given only by its meaning, in the lecture's language
  start: number; // seconds
  end: number;
  a: number; // character offsets in the joined transcript (see lectureText)
  b: number;
  segments: number[];
  cue: 'quran' | 'hadith' | null; // what the speaker announced
  citation?: Citation; // a spoken reference next to the quote
  optional?: boolean; // short and unannounced: reported only if it matches the corpus
  detector: 'rules' | 'llm';
};

const AR_WORD = /[ء-ي٠-٩ٰ-ۓە-ۿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g;
const MIN_WORDS = 3; // runs under 6 words also need a cue (see below)
const OPEN = '«﴿{"“';
const CLOSE = '»﴾}"”';
const QURAN_CUE = /(berfirman|firman allah|firman-nya|allah ta'?ala|ayat|surat|surah|qs\b|al-?qur'?an|قال الله|قال تعالى|يقول الله|تعالى|سبحانه)/i;
const HADITH_CUE = /(bersabda|sabda|berkata|he said|said:|says:|rasulullah|rasul|nabi|hadits|hadis|hadith|the prophet|messenger|ﷺ|قال رسول|قال النبي|عن النبي|رواه|أخرجه|عليه الصلاة والسلام)/i;
// "قال رسول الله ﷺ:", "وقال تعالى:", "فقال ما معناه:" … up to the colon.
const AR_CUE_COLON = /(?:^|[\s،.؛])(?:و|ف)?(?:قال|يقول|قوله|قولُه)[^:\n«»{}]{0,70}?:\s*/g;

// Formulas trimmed from the edges of a quote (compared on norm() text).
const LEADING = ['اعوذ بالله من الشيطان الرجيم', 'قال رسول الله', 'قال النبي', 'ان رسول الله قال', 'عن النبي انه قال', 'عن النبي قال',
  'قال الله تعالي', 'يقول الله تعالي', 'قال الله عز وجل', 'قال تعالي', 'قال الله', 'وقال', 'قال', 'وقوله تعالي', 'قوله تعالي', 'كما قال'].map(norm);
const TRAILING = ['صدق الله العظيم', 'او كما قال', 'رواه البخاري ومسلم', 'متفق عليه', 'رواه البخاري', 'رواه مسلم', 'رواه الترمذي', 'رواه ابو داود',
  'رواه النسائي', 'رواه ابن ماجه', 'رواه احمد', 'رواه'].map(norm);
const IGNORE = ['السلام عليكم ورحمه الله وبركاته', 'وعليكم السلام ورحمه الله وبركاته', 'بارك الله فيكم', 'جزاكم الله خيرا', 'والله اعلم بالصواب'].map(norm);

/** Text between a quote and a reference that still ties them together: "… (HR Muslim)", "…}[البقرة:203]". */
const attached = (gap: string) => gap.length <= 40 && !/[\n!?]|\.\s/.test(gap);

/** Transcript-side spelling fixes before matching: imlaei sometimes joins the vocative (ياأيها → يا ايها). */
export const spokenWords = (s: string) => norm(s).split(' ').filter(Boolean).flatMap((w) => (w.startsWith('ياا') && w.length > 4 ? ['يا', w.slice(2)] : [w]));

function trimFormulas(words: string[]): string[] {
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
  return words.slice(s, e);
}

/** The whole lecture as one string, plus the segment of every character. */
export function lectureText(segments: Segment[]) {
  let full = '';
  const segStart: number[] = [];
  for (const seg of segments) {
    segStart.push(full.length);
    full += seg.text + '\n';
  }
  const segOf = (i: number) => {
    let lo = 0, hi = segStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segStart[mid] <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { full, segStart, segOf };
}

const arabicShare = (s: string) => {
  const ar = s.match(/[ء-ي]/g)?.length ?? 0;
  const lat = s.match(/[A-Za-z]/g)?.length ?? 0;
  return ar / Math.max(1, ar + lat);
};

type Run = { a: number; b: number; kind: 'run' | 'delimited' | 'cue' };

export function makeSpan(
  segments: Segment[], text: ReturnType<typeof lectureText>, r: { a: number; b: number },
  fields: Omit<Span, 'id' | 'start' | 'end' | 'a' | 'b' | 'segments'>,
): Span {
  const s0 = text.segOf(r.a), s1 = text.segOf(Math.max(r.a, r.b - 1));
  return {
    id: 0, ...fields, a: r.a, b: r.b,
    start: segments[s0].start, end: segments[s1].end,
    segments: Array.from({ length: s1 - s0 + 1 }, (_, k) => s0 + k),
  };
}

/** quoteMode: the input is itself a quote (Cek Dalil), so short runs count and no cue is needed. */
export function detect(segments: Segment[], opts: { quoteMode?: boolean } = {}): Span[] {
  const minWords = opts.quoteMode ? 2 : MIN_WORDS;
  const text = lectureText(segments);
  const { full } = text;
  const arabicLecture = !opts.quoteMode && arabicShare(full) >= 0.6;

  // Arabic runs: consecutive Arabic words separated only by spaces/punctuation; a quote delimiter or a Latin
  // letter/digit ends the run.
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (const m of full.matchAll(AR_WORD)) {
    const a = m.index!, b = a + m[0].length;
    const gap = cur ? full.slice(cur.b, a) : '';
    if (cur && !/[A-Za-z0-9[\]]/.test(gap) && ![...gap].some((ch) => OPEN.includes(ch) || CLOSE.includes(ch))) cur.b = b;
    else runs.push((cur = { a, b, kind: 'run' }));
  }
  for (const r of runs) {
    const before = full.slice(0, r.a).trimEnd().slice(-1), after = full.slice(r.b).trimStart().slice(0, 1);
    if (before && OPEN.includes(before) && after && CLOSE.includes(after)) r.kind = 'delimited';
  }

  let candidates: Run[] = runs;
  if (arabicLecture) {
    // Quotes after "قال …:" up to the end of the sentence (unless a delimited quote starts right there).
    const cued: Run[] = [];
    for (const m of full.matchAll(AR_CUE_COLON)) {
      const a = m.index! + m[0].length;
      if (OPEN.includes(full[a] ?? '')) continue;
      const rest = full.slice(a);
      const end = rest.search(/[.؛!؟\n]|\s+(?=(?:رواه|أخرجه|متفق عليه))/);
      const b = a + (end < 0 ? rest.length : end);
      if (b > a) cued.push({ a, b, kind: 'cue' });
    }
    const cited = new Set(parseCitations(full).map((c) => c.start));
    candidates = [
      ...cued,
      ...runs.filter((r) => r.kind === 'delimited' && !cued.some((c) => c.a < r.b && r.a < c.b)),
      // Undelimited runs only when a citation follows directly ("… [البقرة:203]").
      ...runs.filter((r) => r.kind === 'run' && !cued.some((c) => c.a < r.b && r.a < c.b) && [...cited].some((s) => s >= r.b && attached(full.slice(r.b, s)))),
    ].sort((x, y) => x.a - y.a);
  }

  const citations = parseCitations(full);
  const used = new Set<Citation>();
  const spans: Span[] = [];

  for (const [ri, r] of candidates.entries()) {
    const raw = full.slice(r.a, r.b);
    const nextA = candidates[ri + 1]?.a ?? full.length;
    const prevB = candidates[ri - 1]?.b ?? 0;
    const all = spokenWords(raw);
    if (all.length < minWords || IGNORE.includes(all.join(' '))) continue;
    const words = trimFormulas(all);
    if (words.length < (opts.quoteMode ? 2 : 3) && r.kind === 'run') continue;
    if (words.length < 2) continue;
    const before = full.slice(Math.max(0, r.a - 80), r.a + Math.min(40, r.b - r.a));
    const after = full.slice(r.b, Math.min(full.length, r.b + 120));
    // A reference belongs to the quote it follows ("… (HR Muslim)") or, right before it, introduces ("HR Muslim: …").
    const cite =
      citations.find((c) => !used.has(c) && c.start >= r.a && c.start < nextA && (c.start <= r.b || attached(full.slice(r.b, c.start)))) ??
      citations.find((c) => !used.has(c) && c.end <= r.a && c.start >= prevB && r.a - c.end < 25);
    if (cite) used.add(cite);
    const cue: Span['cue'] = cite ? cite.kind : QURAN_CUE.test(before) ? 'quran' : HADITH_CUE.test(before) || /رواه|متفق عليه/.test(after.slice(0, 40)) ? 'hadith' : null;
    // Short unannounced Arabic (greetings, du'a fragments) is checked, but only reported when it matches.
    const optional = !cue && words.length < 6 && !opts.quoteMode && r.kind === 'run';
    spans.push(makeSpan(segments, text, r, { spoken: raw.trim(), words, cue, citation: cite, detector: 'rules', ...(optional ? { optional } : {}) }));
  }

  // Citations said without a quote next to them ("sebagaimana dalam HR Bukhari no. 1").
  for (const c of citations) {
    if (used.has(c) || (c.kind === 'hadith' && !c.number)) continue;
    spans.push(makeSpan(segments, text, { a: c.start, b: c.end }, { spoken: c.text, words: [], cue: c.kind, citation: c, detector: 'rules' }));
  }
  return spans.sort((x, y) => x.a - y.a).map((s, i) => ({ ...s, id: i }));
}
