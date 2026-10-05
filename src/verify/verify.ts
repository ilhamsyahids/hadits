import { collection, CORE } from '../corpus/collections';
import { family, type Grade, grades, type Lang, LIGHT_COLS, present, reference, type UnitRow, unitsByKeys } from '../corpus/units';
import type { Bindings } from '../env';
import type { Usage } from '../lib/gemini';
import { hasArabic } from '../lib/arabic';
import { type Hit, latinHits, rrf, stemHits, trigramHits, vectorHits } from '../search/retrieve';
import { resolveCitation } from '../search/search';
import { type Alignment, align, type Op } from './align';
import { detect, lectureText, makeSpan, type Segment, type Span } from './detect';
import { extract, mergeSpans } from './extract';
import { judge, type JudgeItem, judgeMeaning, type MeaningItem, translateReasons } from './judge';

// /v1/verify: transcript → spans (rules, LLM, or both) → candidates → alignment → verdict (+ grey-band judge)
// → grades and family → groups (the same dalil quoted several times becomes one stack).

export type Detector = 'rules' | 'llm' | 'hybrid';

export type Status = 'verbatim' | 'paraphrase' | 'misquote' | 'weak_or_disputed' | 'not_found_in_corpus' | 'reference';
export type TextStatus = Exclude<Status, 'weak_or_disputed'>;

export const THRESHOLDS = { verbatim: 0.92, verbatimCoverage: 0.9, notFound: 0.55, minCoverage: 0.5 };
const TOP_CANDIDATES = 16;
const WEAK = new Set(['daif', 'mawdu', 'disputed']);

type Match = { rows: UnitRow[]; key: string; al: Alignment };

export type Verdict = {
  id: number;
  status: Status;
  text_status: TextStatus;
  confidence: number;
  spoken: string;
  start: number;
  end: number;
  segments: number[];
  cue: Span['cue'];
  match?: ReturnType<typeof present> & { range?: string[] };
  metrics?: { similarity: number; coverage: number; changed: number; extra: number; missing: number };
  diff?: Op[];
  grades?: Grade[];
  grade_summary?: { status: string; note?: string };
  family_grades?: { via: string; grades: Grade[] };
  family?: Awaited<ReturnType<typeof family>>;
  narrators?: unknown[];
  near?: { key: string; reference: string; similarity: number }[];
  citation?: { said: string; keys: string[]; agrees: boolean | null };
  reason?: string;
  decided_by: 'citation' | 'alignment' | 'judge';
  detector: Span['detector'];
  meaning?: boolean;
};

const collectionRank = (c: string) => (c === 'quran' ? 0 : CORE.includes(c) ? 1 + CORE.indexOf(c) : 20);
const settle = (p: Promise<Hit[]>) => p.catch(() => [] as Hit[]);

// `quran` is a Quran-only stem list: ayat also appear inside hadith (khutbat al-hajah, tafsir reports) and must
// always be in the running, not crowded out of the top candidates by those hadith.
type Lists = { stem: Hit[]; tri: Hit[]; vector: Hit[]; quran: Hit[] };

/** Candidate lists per quote text, memoised: retrieval for rule spans starts while the LLM extraction runs. */
function retriever(env: Bindings) {
  const memo = new Map<string, Promise<Lists>>();
  const prefetch = (texts: string[]) => {
    const fresh = [...new Set(texts)].filter((t) => !memo.has(t));
    if (!fresh.length) return;
    const vec = vectorHits(env, fresh, 'fact checking').catch(() => fresh.map(() => [] as Hit[]));
    fresh.forEach((t, i) =>
      memo.set(t, Promise.all([settle(stemHits(env, t)), settle(trigramHits(env, t)), vec.then((v) => v[i] ?? []), settle(stemHits(env, t, 'quran', 8))]).then(([stem, tri, vector, quran]) => ({ stem, tri, vector, quran }))),
    );
  };
  return { prefetch, get: (t: string) => (prefetch([t]), memo.get(t)!) };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Quran candidates are re-aligned against a window of neighbouring ayat, so a recitation of 26:88-89 matches both. */
async function quranWindows(db: D1Database, keys: string[]): Promise<Map<string, UnitRow[]>> {
  const want = new Set<string>();
  for (const k of keys) {
    const [, s, a] = k.split(':').map(Number) as [number, number, number];
    for (let x = Math.max(1, a - 4); x <= a + 4; x++) want.add(`quran:${s}:${x}`);
  }
  const rows = await unitsByKeys(db, [...want], LIGHT_COLS);
  const out = new Map<string, UnitRow[]>();
  for (const k of keys) {
    const [, s, a] = k.split(':').map(Number) as [number, number, number];
    const win: UnitRow[] = [];
    for (let x = Math.max(1, a - 4); x <= a + 4; x++) {
      const r = rows.get(`quran:${s}:${x}`);
      if (r) win.push(r);
    }
    out.set(k, win);
  }
  return out;
}

function alignWindow(words: string[], win: UnitRow[]): Match | null {
  const toks: string[] = [];
  const owner: number[] = [];
  win.forEach((r, i) => {
    for (const w of r.ar_norm.split(' ').filter(Boolean)) {
      toks.push(w);
      owner.push(i);
    }
  });
  const al = align(words, toks);
  if (al.srcTo <= al.srcFrom) return null;
  const covered = win.slice(owner[al.srcFrom], owner[al.srcTo - 1] + 1);
  // Ayat partly outside the aligned window are not "missing" from the quote.
  return { rows: covered, key: covered[0].key, al };
}

function classify(al: Alignment): TextStatus | 'grey' {
  if (al.similarity >= THRESHOLDS.verbatim && al.coverage >= THRESHOLDS.verbatimCoverage) return 'verbatim';
  if (al.similarity < THRESHOLDS.notFound || al.coverage < THRESHOLDS.minCoverage) return 'not_found_in_corpus';
  return 'grey';
}

const diffText = (ops: Op[]) =>
  ops
    .filter((o) => o.op !== 'same')
    .map((o) => (o.op === 'extra' ? `+${o.spoken}` : o.op === 'missing' ? `-${o.source}` : `${o.spoken}→${o.source}`))
    .join(' ') || '(no differences)';

const MIN_MEANING_CONFIDENCE = 0.6;

/**
 * What a run decided about a text, so a report in another language shows the same findings: the detected spans
 * (the LLM extraction varies run to run) and each judge decision, with its reason per language.
 */
export type Decisions = {
  spans: Span[];
  grey: Record<number, { label: string; confidence: number; reasons: Partial<Record<Lang, string>> }>;
  meaning: Record<number, { key: string | null; confidence: number; reasons: Partial<Record<Lang, string>> }>;
};
export type DecisionStore = { load(): Promise<Decisions | null>; save(d: Decisions): void };

export async function verify(
  env: Bindings,
  segments: Segment[],
  opts: { judge?: boolean; quoteMode?: boolean; lang?: Lang; detector?: Detector; decisions?: DecisionStore } = {},
) {
  const lang = opts.lang ?? 'en';
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const lap = (name: string) => (timing[name] = Date.now() - t0);
  let usage: Usage = { input: 0, output: 0 };
  const addUsage = (u: Usage) => (usage = { input: usage.input + u.input, output: usage.output + u.output });
  const degraded: string[] = [];
  const saved = opts.decisions ? await opts.decisions.load().catch(() => null) : null;

  // Detection. A typed check in Latin letters (meaning or transliteration) needs the LLM; lectures use both.
  const latinQuote = opts.quoteMode && !segments.some((s) => hasArabic(s.text));
  const detector: Detector = opts.detector ?? (latinQuote ? 'llm' : opts.quoteMode ? 'rules' : 'hybrid');
  const rules = saved ? [] : detect(segments, { quoteMode: opts.quoteMode });
  const lists = retriever(env);
  lists.prefetch(rules.filter((s) => s.words.length).map((s) => s.words.join(' ')));
  let spans = saved?.spans ?? rules;
  if (!saved && detector !== 'rules') {
    try {
      const x = await extract(env, segments);
      addUsage(x.usage);
      spans = detector === 'llm' ? x.spans : mergeSpans(rules, x.spans);
    } catch (e) {
      degraded.push(`extract: ${String(e).slice(0, 120)}`);
    }
  }
  if (latinQuote && !spans.length) {
    // Nothing recognised: treat the whole input as a meaning to look up.
    const text = lectureText(segments);
    spans = [makeSpan(segments, text, { a: 0, b: segments[0].text.length }, { spoken: segments[0].text, words: [], meaning: segments[0].text, cue: null, detector: 'rules' })];
  }
  // Every map below is keyed by span id, so ids must be unique whichever detector produced the spans.
  if (!saved) spans = spans.sort((x, y) => x.a - y.a).map((s, i) => ({ ...s, id: i }));
  lap('detected');
  const quotes = spans.filter((s) => s.words.length);
  const meanings = spans.filter((s) => s.meaning);

  // Candidates: citation said next to the quote, stem FTS, trigram FTS, vectors (one embedding call for all spans).
  const citedRows = new Map<number, UnitRow[]>();
  lists.prefetch(quotes.map((s) => s.words.join(' ')));
  const meaningTexts = meanings.map((s) => s.meaning!);
  const [meaningVectors, lexical, meaningLexical] = await Promise.all([
    meaningTexts.length ? vectorHits(env, meaningTexts, 'fact checking').catch(() => meaningTexts.map(() => [] as Hit[])) : [],
    Promise.all(quotes.map((s) => lists.get(s.words.join(' ')))),
    Promise.all(meanings.map((s) => settle(latinHits(env, s.meaning!)))),
    Promise.all(spans.filter((s) => s.citation).map(async (s) => citedRows.set(s.id, await resolveCitation(env.CORPUS, s.citation!)))),
  ]);
  lap('candidates');
  const meaningFused = meanings.map((_, i) => rrf({ latin: meaningLexical[i], vector: meaningVectors[i] ?? [] }).slice(0, 5));
  const fused = quotes.map((s, i) => {
    const cited = (citedRows.get(s.id) ?? []).map((r, k) => ({ key: r.key, rank: k + 1 }));
    const top = rrf({ cited, ...lexical[i] }).slice(0, TOP_CANDIDATES);
    // The key the speaker named is always aligned, however low it ranked; so are the best ayat, which hadith that
    // quote them word for word (tafsir reports, khutbahs) can push out of the top candidates.
    for (const c of cited) if (!top.some((t) => t.key === c.key)) top.push({ key: c.key, score: 0, via: { cited: c.rank } });
    for (const q of lexical[i].quran.slice(0, 3)) if (!top.some((t) => t.key === q.key)) top.push({ key: q.key, score: 0, via: { quran: 1 } });
    return top;
  });

  const quranKeys = fused.flat().map((f) => f.key).filter((k) => k.startsWith('quran:'));
  const [rows, windows, meaningRows] = await Promise.all([
    unitsByKeys(env.CORPUS, fused.flat().map((f) => f.key), LIGHT_COLS),
    quranWindows(env.CORPUS, [...new Set(quranKeys)]),
    unitsByKeys(env.CORPUS, meaningFused.flat().map((f) => f.key)),
  ]);

  // Align every candidate; keep the best by alignment score, the rest become "near" matches.
  const best = new Map<number, { match: Match | null; near: Match[] }>();
  quotes.forEach((s, i) => {
    const tried: Match[] = [];
    for (const f of fused[i]) {
      const row = rows.get(f.key);
      if (!row) continue;
      if (row.kind === 'quran') {
        const m = alignWindow(s.words, windows.get(row.key) ?? [row]);
        if (m && !tried.some((t) => t.key === m.key)) tried.push(m);
      } else {
        tried.push({ rows: [row], key: row.key, al: align(s.words, row.ar_norm.split(' ').filter(Boolean)) });
      }
    }
    // Short quotes align equally well with many reports: among near-equal scores prefer the cited key, then a
    // graded source over an ungraded copy (a saying graded fabricated must not show as a plain match), then the
    // core books, then the shortest source (the quote covers more of it).
    const cited = new Set((citedRows.get(s.id) ?? []).map((r) => r.key));
    const graded = (m: Match) => (m.rows[0].kind === 'quran' || (m.rows[0].grade_status && m.rows[0].grade_status !== 'ungraded') ? 0 : 1);
    const pref = (m: Match) => [cited.has(m.key) ? 0 : 1, graded(m), collectionRank(m.rows[0].collection), m.rows.reduce((n, r) => n + r.ar_norm.length, 0)];
    // Every verbatim match is the same text, so among them the source decides, not a point of score: the ayah
    // before a hadith quoting it, Tirmidhi 2377 before an ungraded copy whose wording differs by one word.
    const verbatim = (m: Match) => classify(m.al) === 'verbatim';
    tried.sort((a, b) => {
      if (verbatim(a) !== verbatim(b)) return verbatim(a) ? -1 : 1;
      if (!verbatim(a) && Math.abs(b.al.score - a.al.score) > 0.5) return b.al.score - a.al.score;
      const pa = pref(a), pb = pref(b);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2] || pa[3] - pb[3];
    });
    best.set(s.id, { match: tried[0] ?? null, near: tried.slice(0, 4) });
  });

  lap('aligned');
  // Full rows (text, grades, narrators) only for what will be shown; loads while the judge runs.
  const shown = spans.flatMap((s) => (s.words.length ? best.get(s.id)?.match?.rows ?? [] : s.meaning ? [] : citedRows.get(s.id) ?? []));
  const fullRows = unitsByKeys(env.CORPUS, shown.map((r) => r.key));
  const details = new Map<number, Promise<Awaited<ReturnType<typeof detail>>>>();
  for (const s of spans) {
    const m = best.get(s.id)?.match;
    const rs = s.words.length ? m?.rows : s.meaning ? undefined : citedRows.get(s.id);
    if (rs?.length) details.set(s.id, fullRows.then((full) => detail(env, full.get(rs[0].key) ?? rs[0], rs.map((r) => full.get(r.key) ?? r), lang)));
  }

  // Grey band → judge, all spans in one call (runs while the details above load).
  const grey: JudgeItem[] = [];
  for (const s of quotes) {
    const m = best.get(s.id)!.match;
    if (m && classify(m.al) === 'grey') {
      const src = m.rows.map((r) => r.ar_norm).join(' ').split(' ');
      grey.push({
        id: s.id,
        spoken: s.words.join(' '),
        source: src.slice(Math.max(0, m.al.srcFrom - 12), m.al.srcTo + 12).join(' '),
        reference: reference(m.rows[0], lang),
        diff: diffText(m.al.ops),
      });
    }
  }
  const meaningItems: MeaningItem[] = meanings.map((s, i) => ({
    id: s.id,
    said: s.meaning!,
    candidates: meaningFused[i].flatMap((f) => {
      const r = meaningRows.get(f.key);
      return r ? [{ key: r.key, reference: reference(r, lang), ar: r.ar_matn.slice(0, 600), en: (r.en_text ?? '').slice(0, 600) }] : [];
    }),
  }));
  const verdicts = new Map<number, { label: string; reason: string; confidence: number }>();
  const meaningVerdicts = new Map<number, { key: string | null; reason: string; confidence: number }>();
  const decided: Decisions = { spans, grey: { ...saved?.grey }, meaning: { ...saved?.meaning } };
  if (opts.judge !== false) {
    // Judge only what no earlier run decided; reuse the rest in this language.
    const [g, m] = await Promise.allSettled([
      judge(env, grey.filter((x) => !decided.grey[x.id]), lang),
      judgeMeaning(env, meaningItems.filter((x) => !decided.meaning[x.id]), lang),
    ]);
    if (g.status === 'fulfilled') {
      for (const [id, r] of g.value.results) decided.grey[id] = { label: r.label, confidence: r.confidence, reasons: { [lang]: r.reason } };
      addUsage(g.value.usage);
    } else degraded.push(`judge: ${String(g.reason).slice(0, 120)}`);
    if (m.status === 'fulfilled') {
      for (const [id, r] of m.value.results) decided.meaning[id] = { key: r.key, confidence: r.confidence, reasons: { [lang]: r.reason } };
      addUsage(m.value.usage);
    } else degraded.push(`meaning judge: ${String(m.reason).slice(0, 120)}`);

    // Reasons decided in another language are translated in one call.
    const used = [...grey.map((x) => decided.grey[x.id]), ...meaningItems.map((x) => decided.meaning[x.id])].filter(Boolean);
    const missing = used.filter((d) => d.reasons[lang] == null);
    if (missing.length) {
      try {
        const t = await translateReasons(env, missing.map((d) => Object.values(d.reasons)[0] ?? ''), lang);
        missing.forEach((d, i) => (d.reasons[lang] = t.reasons[i]));
        addUsage(t.usage);
      } catch (e) {
        degraded.push(`translate: ${String(e).slice(0, 120)}`);
      }
    }
    const reasonOf = (d: { reasons: Partial<Record<Lang, string>> }) => d.reasons[lang] ?? Object.values(d.reasons)[0] ?? '';
    for (const x of grey) if (decided.grey[x.id]) verdicts.set(x.id, { ...decided.grey[x.id], reason: reasonOf(decided.grey[x.id]) });
    for (const x of meaningItems) if (decided.meaning[x.id]) meaningVerdicts.set(x.id, { ...decided.meaning[x.id], reason: reasonOf(decided.meaning[x.id]) });
  }

  lap('judged');
  const refs: Verdict[] = [];
  for (const s of spans) {
    const base = { id: s.id, spoken: s.spoken, start: s.start, end: s.end, a: s.a, b: s.b, segments: s.segments, cue: s.cue, detector: s.detector };
    const cited = citedRows.get(s.id) ?? [];
    if (s.meaning) {
      const j = meaningVerdicts.get(s.id);
      // A low-confidence pick is treated as not found: a wrong source is worse than none.
      const row = j?.key && j.confidence >= MIN_MEANING_CONFIDENCE ? meaningRows.get(j.key) : undefined;
      const near = meaningItems.find((x) => x.id === s.id)?.candidates.slice(0, 3).map((c) => ({ key: c.key, reference: c.reference, similarity: 0 })) ?? [];
      if (!row) {
        refs.push({ ...base, meaning: true, status: 'not_found_in_corpus', text_status: 'not_found_in_corpus', confidence: j?.confidence ?? 0.5, decided_by: 'judge', reason: j?.reason, near });
        continue;
      }
      const d = await detail(env, row, [row], lang);
      refs.push({
        ...base, meaning: true, status: WEAK.has(row.grade_status ?? '') ? 'weak_or_disputed' : 'paraphrase', text_status: 'paraphrase',
        confidence: j!.confidence, decided_by: 'judge', reason: j!.reason, ...d,
        near: near.filter((n) => n.key !== row.key),
        ...(s.citation ? { citation: citationCheck(s, cited, [row], d.family ?? []) } : {}),
      });
      continue;
    }
    if (!s.words.length) {
      // A reference said without quoting the text.
      const row = cited[0];
      refs.push(
        row
          ? { ...base, status: 'reference', text_status: 'reference', confidence: 1, decided_by: 'citation', ...(await details.get(s.id)!), citation: { said: s.citation!.text, keys: cited.map((r) => r.key), agrees: true } }
          : { ...base, status: 'not_found_in_corpus', text_status: 'not_found_in_corpus', confidence: 0.9, decided_by: 'citation', reason: MESSAGES[lang].missingRef, citation: { said: s.citation!.text, keys: [], agrees: null } },
      );
      continue;
    }
    const { match, near } = best.get(s.id)!;
    const nearList = near.filter((n) => n !== match).map((n) => ({ key: n.key, reference: reference(n.rows[0], lang), similarity: round(n.al.similarity) }));
    let text: TextStatus;
    let decided: Verdict['decided_by'] = 'alignment';
    let reason: string | undefined;
    let confidence: number;
    const cls = match ? classify(match.al) : 'not_found_in_corpus';
    if (cls === 'grey') {
      const j = verdicts.get(s.id);
      if (j) {
        text = j.label === 'different_text' ? 'not_found_in_corpus' : (j.label as TextStatus);
        reason = j.reason;
        confidence = j.confidence;
        decided = 'judge';
      } else {
        // No judge available: lean on the alignment alone.
        text = match!.al.changed > 0 ? 'misquote' : 'paraphrase';
        confidence = 0.5;
      }
    } else {
      text = cls;
      confidence = match ? round(cls === 'verbatim' ? match.al.similarity : 1 - match.al.similarity) : 0.9;
    }

    if (s.optional && (text === 'not_found_in_corpus' || text === 'misquote' || !match)) continue;
    if (text === 'not_found_in_corpus' || !match) {
      refs.push({ ...base, status: 'not_found_in_corpus', text_status: 'not_found_in_corpus', confidence, decided_by: decided, reason, near: nearList.slice(0, 3), ...(s.citation ? { citation: { said: s.citation.text, keys: cited.map((r) => r.key), agrees: null } } : {}) });
      continue;
    }
    const d = await details.get(s.id)!;
    const weak = WEAK.has(match.rows[0].grade_status ?? '');
    refs.push({
      ...base,
      status: weak && text !== 'misquote' ? 'weak_or_disputed' : text,
      text_status: text,
      confidence,
      decided_by: decided,
      reason,
      ...d,
      metrics: { similarity: round(match.al.similarity), coverage: round(match.al.coverage), changed: match.al.changed, extra: match.al.extra, missing: match.al.missing },
      diff: match.al.ops,
      near: nearList.filter((n) => n.key !== match.key).slice(0, 3),
      ...(s.citation ? { citation: citationCheck(s, cited, match.rows, d.family ?? []) } : {}),
    });
  }

  if (opts.decisions && !degraded.length) opts.decisions.save(decided);
  const count = (st: Status) => refs.filter((r) => r.status === st).length;
  return {
    refs,
    groups: groupRefs(refs),
    detector,
    degraded,
    summary: {
      total: refs.length,
      quran: refs.filter((r) => r.match?.kind === 'quran').length,
      hadith: refs.filter((r) => r.match?.kind === 'hadith').length,
      verbatim: count('verbatim'), paraphrase: count('paraphrase'), misquote: count('misquote'),
      weak_or_disputed: count('weak_or_disputed'), not_found_in_corpus: count('not_found_in_corpus'), reference: count('reference'),
      judged: grey.length + meaningItems.length,
    },
    usage,
    timing,
    ms: Date.now() - t0,
  };
}

/** Grades by grader, the variant family, narrators; grades borrowed from the family when the matched wording has none. */
async function detail(env: Bindings, row: UnitRow, rows: UnitRow[], lang: Lang) {
  const fam = row.kind === 'hadith' ? await family(env.CORPUS, row) : [];
  const g = grades(row);
  let family_grades: Verdict['family_grades'];
  if (row.kind === 'hadith' && !g.length && row.grade_status !== 'sahihayn') {
    const core = fam.find((f) => CORE.includes(f.collection));
    const r = core ? (await unitsByKeys(env.CORPUS, [core.key])).get(core.key) : undefined;
    if (r && grades(r).length) family_grades = { via: r.key, grades: grades(r) };
  }
  const p = present(row, { full: true, lang });
  return {
    match: { ...p, ...(rows.length > 1 ? { range: rows.map((r) => r.key), ar: { ...p.ar, matn: rows.map((r) => r.ar_matn).join(' ') } } : {}) },
    grades: g,
    grade_summary: { status: row.grade_status ?? 'ungraded', note: gradeNote(row, lang) },
    family_grades,
    family: fam,
    narrators: p.narrators,
  };
}

const MESSAGES: Record<Lang, { missingRef: string; sahihayn: (c: string) => string; disputed: string }> = {
  en: { missingRef: 'The reference that was said is not in the corpus.', sahihayn: (c) => `In ${c}: accepted as authentic as a whole.`, disputed: 'Graders disagree; see the list of graders.' },
  ar: { missingRef: 'الإحالة المذكورة غير موجودة في المدوّنة.', sahihayn: (c) => `في ${c}: متلقّى بالقبول.`, disputed: 'اختلف المحدّثون في الحكم عليه؛ انظر قائمة الأحكام.' },
  id: { missingRef: 'Rujukan yang disebut tidak ada di korpus.', sahihayn: (c) => `Dalam ${c}: diterima sebagai shahih secara keseluruhan.`, disputed: 'Para penilai berbeda pendapat; lihat daftar penilai.' },
};

function gradeNote(row: UnitRow, lang: Lang): string | undefined {
  if (row.kind === 'quran') return undefined;
  const c = collection(row.collection);
  if (row.grade_status === 'sahihayn') return MESSAGES[lang].sahihayn(c ? (lang === 'ar' ? c.ar : lang === 'id' ? c.id_name : c.en) : row.collection);
  if (row.grade_status === 'disputed') return MESSAGES[lang].disputed;
  return undefined;
}

/**
 * One stack per dalil: refs that matched the same unit, the same Quran passage, or the same variant family.
 * Order follows the first time each was said; refs without a match are not stacked.
 */
export function groupRefs(refs: Verdict[]) {
  const groups = new Map<string, { key: string; reference: string; kind: string; refs: number[]; statuses: Status[]; first: number }>();
  for (const r of refs) {
    if (!r.match) continue;
    const id = r.match.kind === 'quran' ? `quran:${r.match.key.split(':')[1]}:${r.match.key.split(':')[2]}` : (r.match.family_id ?? r.match.key);
    const g = groups.get(id) ?? { key: r.match.key, reference: r.match.reference, kind: r.match.kind, refs: [], statuses: [], first: r.start };
    g.refs.push(r.id);
    g.statuses.push(r.status);
    groups.set(id, g);
  }
  return [...groups.values()].map((g) => ({ ...g, count: g.refs.length })).sort((a, b) => a.first - b.first);
}

function citationCheck(s: Span, cited: UnitRow[], matchedRows: UnitRow[], fam: { key: string; collection: string }[]): Verdict['citation'] {
  const c = s.citation!;
  const keys = cited.map((r) => r.key);
  const matched = matchedRows[0];
  let agrees: boolean;
  // Quran: the cited ayat must overlap the matched passage (same surah is not enough: [آل عمران:131] for 3:102 is wrong).
  if (c.kind === 'quran') agrees = keys.some((k) => matchedRows.some((r) => r.key === k));
  else if (c.number) agrees = keys.includes(matched.key) || cited.some((r) => r.family_id && r.family_id === matched.family_id);
  else agrees = matched.collection === c.collection || fam.some((f) => f.collection === c.collection);
  return { said: c.text, keys, agrees };
}
