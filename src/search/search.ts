import type { Bindings } from '../env';
import { hasArabic } from '../lib/arabic';
import { hadithByNumber, quranRange, type UnitRow, unitsByKeys } from '../corpus/units';
import { type Citation, parseCitations } from './refparse';
import { type Fused, type Hit, type Kind, latinHits, rrf, stemHits, trigramHits, vectorHits } from './retrieve';

export type SearchResult = {
  interpretation: 'citation' | 'arabic_quote' | 'meaning';
  results: { row: UnitRow; score: number; via: Record<string, number> }[];
  degraded: string[];
};

/** Units a parsed citation points at (a Quran range gives several ayat). */
export async function resolveCitation(db: D1Database, c: Citation): Promise<UnitRow[]> {
  if (c.kind === 'quran') return quranRange(db, c.surah, c.from, c.to);
  if (!c.number) return [];
  const row = await hadithByNumber(db, c.collection, c.number);
  return row ? [row] : [];
}

const settle = async (name: string, p: Promise<Hit[]>, degraded: string[]) =>
  p.catch((e) => {
    degraded.push(`${name}: ${String(e).slice(0, 120)}`);
    return [] as Hit[];
  });

/** Candidates for one piece of text: Arabic goes to stem + trigram + vector, anything else to translations + vector. */
export async function candidates(env: Bindings, text: string, opts: { kind?: Kind; limit?: number; degraded?: string[] } = {}): Promise<Fused[]> {
  const degraded = opts.degraded ?? [];
  const limit = opts.limit ?? 40;
  const vector = settle('vector', vectorHits(env, [text], 'search result', opts.kind, limit).then((l) => l[0] ?? []), degraded);
  const lists: Record<string, Promise<Hit[]>> = hasArabic(text)
    ? { stem: settle('stem', stemHits(env, text, opts.kind, limit), degraded), tri: settle('tri', trigramHits(env, text, opts.kind, limit), degraded), vector }
    : { latin: settle('latin', latinHits(env, text, opts.kind, limit), degraded), vector };
  const resolved = Object.fromEntries(await Promise.all(Object.entries(lists).map(async ([k, p]) => [k, await p] as const)));
  return rrf(resolved);
}

export async function search(env: Bindings, q: string, opts: { kind?: Kind; limit?: number } = {}): Promise<SearchResult> {
  const limit = Math.min(opts.limit ?? 10, 50);
  const degraded: string[] = [];
  const cites = parseCitations(q).filter((c) => c.kind === 'quran' || c.number);
  if (cites.length) {
    const rows = (await Promise.all(cites.map((c) => resolveCitation(env.CORPUS, c)))).flat();
    if (rows.length) return { interpretation: 'citation', results: rows.map((row) => ({ row, score: 1, via: { citation: 1 } })), degraded };
  }
  const fused = (await candidates(env, q, { kind: opts.kind, degraded })).slice(0, limit);
  const rows = await unitsByKeys(env.CORPUS, fused.map((f) => f.key));
  return {
    interpretation: hasArabic(q) ? 'arabic_quote' : 'meaning',
    results: fused.flatMap((f) => (rows.has(f.key) ? [{ row: rows.get(f.key)!, score: f.score, via: f.via }] : [])),
    degraded,
  };
}
