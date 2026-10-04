import type { Bindings } from '../env';
import { stems, trigrams } from '../lib/arabic';
import { embedQueries, type EmbedTask, queryText } from '../lib/gemini';

// Candidate lists over the corpus, fused with reciprocal rank fusion (k = 60):
//   stem    FTS5 on light-stemmed Arabic (prefix/suffix variants meet: مخموم ≈ المخموم)
//   tri     FTS5 on character trigrams (ASR slips, one-letter changes)
//   latin   FTS5 on the English and Indonesian translations
//   vector  Vectorize over gemini-embedding-2 (paraphrase, meaning in another language)

export type Kind = 'quran' | 'hadith';
export type Hit = { key: string; rank: number };
export type Fused = { key: string; score: number; via: Record<string, number> };

type DF = { n: number; tri: Record<string, number>; stem: Record<string, number> };
let dfCache: DF | undefined;

async function df(env: Bindings): Promise<DF> {
  dfCache ??= (await env.CACHE.get<DF>('df:v1', 'json')) ?? { n: 1, tri: {}, stem: {} };
  return dfCache;
}

/** Rarest distinct tokens, skipping near-universal ones (they match most of the corpus and slow FTS down). */
function rarest(tokens: string[], freq: Record<string, number>, n: number, maxShare: number, k: number): string[] {
  const uniq = [...new Set(tokens)].filter((t) => (freq[t] ?? 0) <= n * maxShare);
  return uniq.sort((a, b) => (freq[a] ?? 0) - (freq[b] ?? 0)).slice(0, k);
}

const orQuery = (tokens: string[]) => tokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' OR ');

async function ftsQuery(db: D1Database, table: 'units_fts' | 'units_tri', match: string, kind: Kind | undefined, limit: number): Promise<Hit[]> {
  const sql = `SELECT u.key AS key FROM ${table} JOIN units u ON u.id = ${table}.rowid
    WHERE ${table} MATCH ?${kind ? ' AND u.kind = ?' : ''} ORDER BY ${table}.rank LIMIT ?`;
  const stmt = kind ? db.prepare(sql).bind(match, kind, limit) : db.prepare(sql).bind(match, limit);
  const { results } = await stmt.all<{ key: string }>();
  return results.map((r, i) => ({ key: r.key, rank: i + 1 }));
}

export async function stemHits(env: Bindings, arabic: string, kind?: Kind, limit = 40): Promise<Hit[]> {
  const d = await df(env);
  const toks = rarest(stems(arabic).split(' ').filter((t) => t.length >= 2), d.stem, d.n, 0.05, 12);
  if (!toks.length) return [];
  return ftsQuery(env.CORPUS, 'units_fts', `ar_stem : (${orQuery(toks)})`, kind, limit);
}

export async function trigramHits(env: Bindings, arabic: string, kind?: Kind, limit = 40): Promise<Hit[]> {
  const d = await df(env);
  const toks = rarest(trigrams(arabic).split(' ').filter((t) => t.length === 3), d.tri, d.n, 0.03, 24);
  if (toks.length < 2) return [];
  return ftsQuery(env.CORPUS, 'units_tri', orQuery(toks), kind, limit);
}

const LATIN_STOP = new Set('the and of to a in is that he for it with was as his on be at by i this had not are but from or have an they which you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three yang dan di ke dari ini itu dengan untuk tidak ada pada adalah akan juga atau oleh karena sebagai dalam kami kamu mereka saya kita bahwa telah sudah bisa'.split(' '));

export async function latinHits(env: Bindings, text: string, kind?: Kind, limit = 40): Promise<Hit[]> {
  const toks = [...new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/))]
    .filter((t) => t.length >= 3 && !LATIN_STOP.has(t))
    .slice(0, 16);
  if (!toks.length) return [];
  return ftsQuery(env.CORPUS, 'units_fts', `{en_text id_text} : (${orQuery(toks)})`, kind, limit);
}

/** One embedding call for all queries; each returns its own hit list. Vector ids "{key}#p" are prophetic spans. */
export async function vectorHits(env: Bindings, queries: string[], task: EmbedTask, kind?: Kind, topK = 40): Promise<Hit[][]> {
  if (!queries.length) return [];
  const vectors = await embedQueries(env, queries.map((q) => queryText(q, task)));
  return Promise.all(
    vectors.map(async (values) => {
      const res = await env.UNITS_INDEX.query(values, { topK, ...(kind ? { filter: { kind } } : {}) });
      const seen = new Set<string>();
      const hits: Hit[] = [];
      for (const m of res.matches) {
        const key = m.id.replace(/#p$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ key, rank: hits.length + 1 });
      }
      return hits;
    }),
  );
}

export function rrf(lists: Record<string, Hit[]>, k = 60): Fused[] {
  const acc = new Map<string, Fused>();
  for (const [name, hits] of Object.entries(lists)) {
    for (const h of hits) {
      const f = acc.get(h.key) ?? { key: h.key, score: 0, via: {} };
      f.score += 1 / (k + h.rank);
      f.via[name] = h.rank;
      acc.set(h.key, f);
    }
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}
