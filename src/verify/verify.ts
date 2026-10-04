import { collection, CORE } from '../corpus/collections';
import { family, type Grade, grades, present, reference, type UnitRow, unitsByKeys } from '../corpus/units';
import type { Bindings } from '../env';
import type { Usage } from '../lib/gemini';
import { type Hit, rrf, stemHits, trigramHits, vectorHits } from '../search/retrieve';
import { resolveCitation } from '../search/search';
import { type Alignment, align, type Op } from './align';
import { detect, type Segment, type Span } from './detect';
import { judge, type JudgeItem } from './judge';

// /v1/verify: transcript → spans → candidates → alignment → verdict (+ grey-band judge) → grades and family.

export type Status = 'verbatim' | 'paraphrase' | 'misquote' | 'weak_or_disputed' | 'not_found_in_corpus' | 'reference';
export type TextStatus = Exclude<Status, 'weak_or_disputed'>;

export const THRESHOLDS = { verbatim: 0.92, verbatimCoverage: 0.9, notFound: 0.55, minCoverage: 0.5 };
const TOP_CANDIDATES = 8;
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
};

const collectionRank = (c: string) => (c === 'quran' ? 0 : CORE.includes(c) ? 1 + CORE.indexOf(c) : 20);
const settle = (p: Promise<Hit[]>) => p.catch(() => [] as Hit[]);
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Quran candidates are re-aligned against a window of neighbouring ayat, so a recitation of 26:88-89 matches both. */
async function quranWindows(db: D1Database, keys: string[]): Promise<Map<string, UnitRow[]>> {
  const want = new Set<string>();
  for (const k of keys) {
    const [, s, a] = k.split(':').map(Number) as [number, number, number];
    for (let x = Math.max(1, a - 4); x <= a + 4; x++) want.add(`quran:${s}:${x}`);
  }
  const rows = await unitsByKeys(db, [...want]);
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

export async function verify(env: Bindings, segments: Segment[], opts: { judge?: boolean; quoteMode?: boolean } = {}) {
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const lap = (name: string) => (timing[name] = Date.now() - t0);
  const spans = detect(segments, { quoteMode: opts.quoteMode });
  const quotes = spans.filter((s) => s.words.length);

  // Candidates: citation said next to the quote, stem FTS, trigram FTS, vectors (one embedding call for all spans).
  const citedRows = new Map<number, UnitRow[]>();
  const [vectors, lexical] = await Promise.all([
    vectorHits(env, quotes.map((s) => s.words.join(' ')), 'fact checking').catch(() => quotes.map(() => [] as Hit[])),
    Promise.all(quotes.map((s) => Promise.all([settle(stemHits(env, s.words.join(' '))), settle(trigramHits(env, s.words.join(' ')))]))),
    Promise.all(spans.filter((s) => s.citation).map(async (s) => citedRows.set(s.id, await resolveCitation(env.CORPUS, s.citation!)))),
  ]);
  lap('candidates');
  const fused = quotes.map((s, i) => {
    const cited = (citedRows.get(s.id) ?? []).map((r, k) => ({ key: r.key, rank: k + 1 }));
    return rrf({ cited, stem: lexical[i][0], tri: lexical[i][1], vector: vectors[i] ?? [] }).slice(0, TOP_CANDIDATES);
  });

  const rows = await unitsByKeys(env.CORPUS, fused.flat().map((f) => f.key));
  const quranKeys = fused.flat().map((f) => f.key).filter((k) => k.startsWith('quran:'));
  const windows = await quranWindows(env.CORPUS, [...new Set(quranKeys)]);

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
    // Short quotes align equally well with many reports: among near-equal scores prefer the cited key,
    // then the core books, then the shortest source (the quote covers more of it).
    const cited = new Set((citedRows.get(s.id) ?? []).map((r) => r.key));
    const pref = (m: Match) => [cited.has(m.key) ? 0 : 1, collectionRank(m.rows[0].collection), m.rows.reduce((n, r) => n + r.ar_norm.length, 0)];
    tried.sort((a, b) => {
      if (Math.abs(b.al.score - a.al.score) > 0.5) return b.al.score - a.al.score;
      const pa = pref(a), pb = pref(b);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
    best.set(s.id, { match: tried[0] ?? null, near: tried.slice(0, 4) });
  });

  lap('aligned');
  const details = new Map<number, Promise<Awaited<ReturnType<typeof detail>>>>();
  for (const s of spans) {
    const m = best.get(s.id)?.match;
    const row = s.words.length ? m?.rows[0] : citedRows.get(s.id)?.[0];
    if (row) details.set(s.id, detail(env, row, s.words.length ? m!.rows : citedRows.get(s.id)!));
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
        reference: reference(m.rows[0]),
        diff: diffText(m.al.ops),
      });
    }
  }
  let usage: Usage = { input: 0, output: 0 };
  let verdicts = new Map<number, { label: string; reason: string; confidence: number }>();
  if (grey.length && opts.judge !== false) {
    try {
      const j = await judge(env, grey);
      verdicts = j.results;
      usage = j.usage;
    } catch (e) {
      console.error('judge failed', e);
    }
  }

  lap('judged');
  const refs: Verdict[] = [];
  for (const s of spans) {
    const base = { id: s.id, spoken: s.spoken, start: s.start, end: s.end, segments: s.segments, cue: s.cue };
    const cited = citedRows.get(s.id) ?? [];
    if (!s.words.length) {
      // A reference said without quoting the text.
      const row = cited[0];
      refs.push(
        row
          ? { ...base, status: 'reference', text_status: 'reference', confidence: 1, decided_by: 'citation', ...(await details.get(s.id)!), citation: { said: s.citation!.text, keys: cited.map((r) => r.key), agrees: true } }
          : { ...base, status: 'not_found_in_corpus', text_status: 'not_found_in_corpus', confidence: 0.9, decided_by: 'citation', reason: 'Rujukan yang disebut tidak ada di korpus.', citation: { said: s.citation!.text, keys: [], agrees: null } },
      );
      continue;
    }
    const { match, near } = best.get(s.id)!;
    const nearList = near.filter((n) => n !== match).map((n) => ({ key: n.key, reference: reference(n.rows[0]), similarity: round(n.al.similarity) }));
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
      ...(s.citation ? { citation: citationCheck(s, cited, match.rows[0], d.family ?? []) } : {}),
    });
  }

  const count = (st: Status) => refs.filter((r) => r.status === st).length;
  return {
    refs,
    summary: {
      total: refs.length,
      quran: refs.filter((r) => r.match?.kind === 'quran').length,
      hadith: refs.filter((r) => r.match?.kind === 'hadith').length,
      verbatim: count('verbatim'), paraphrase: count('paraphrase'), misquote: count('misquote'),
      weak_or_disputed: count('weak_or_disputed'), not_found_in_corpus: count('not_found_in_corpus'), reference: count('reference'),
      judged: grey.length,
    },
    usage,
    timing,
    ms: Date.now() - t0,
  };
}

/** Grades by grader, the variant family, narrators; grades borrowed from the family when the matched wording has none. */
async function detail(env: Bindings, row: UnitRow, rows: UnitRow[]) {
  const fam = row.kind === 'hadith' ? await family(env.CORPUS, row) : [];
  const g = grades(row);
  let family_grades: Verdict['family_grades'];
  if (row.kind === 'hadith' && !g.length && row.grade_status !== 'sahihayn') {
    const core = fam.find((f) => CORE.includes(f.collection));
    const r = core ? (await unitsByKeys(env.CORPUS, [core.key])).get(core.key) : undefined;
    if (r && grades(r).length) family_grades = { via: r.key, grades: grades(r) };
  }
  const p = present(row, { full: true });
  return {
    match: { ...p, ...(rows.length > 1 ? { range: rows.map((r) => r.key), ar: { ...p.ar, matn: rows.map((r) => r.ar_matn).join(' ') } } : {}) },
    grades: g,
    grade_summary: { status: row.grade_status ?? 'ungraded', note: gradeNote(row) },
    family_grades,
    family: fam,
    narrators: p.narrators,
  };
}

function gradeNote(row: UnitRow): string | undefined {
  if (row.kind === 'quran') return undefined;
  if (row.grade_status === 'sahihayn') return `Dalam ${collection(row.collection)?.id_name ?? row.collection}: diterima sebagai shahih secara keseluruhan.`;
  if (row.grade_status === 'disputed') return 'Para penilai berbeda pendapat; lihat daftar penilai.';
  return undefined;
}

function citationCheck(s: Span, cited: UnitRow[], matched: UnitRow, fam: { key: string; collection: string }[]): Verdict['citation'] {
  const c = s.citation!;
  const keys = cited.map((r) => r.key);
  let agrees: boolean;
  if (c.kind === 'quran') agrees = keys.includes(matched.key) || cited.some((r) => r.key.split(':')[1] === matched.key.split(':')[1]);
  else if (c.number) agrees = keys.includes(matched.key) || cited.some((r) => r.family_id && r.family_id === matched.family_id);
  else agrees = matched.collection === c.collection || fam.some((f) => f.collection === c.collection);
  return { said: c.text, keys, agrees };
}
