import { collection, COLLECTIONS, CORE } from './collections';
import { SURAHS } from './surahs';
import { saidRanges, type Range } from '../lib/prophetic';

// Listings for the Quran and hadith browsing pages. Quran units are ids 1..6236 in mushaf order (tools/export_d1.py),
// so a surah is an id range. Hadith listings group a collection by chapter; results are cached in KV (the corpus
// only changes on re-import, which bumps BROWSE_VERSION).

const BROWSE_VERSION = 'v1';
const ANTHOLOGIES = ['riyadussalihin', 'nawawi', 'qudsi', 'bulugh', 'mishkat', 'adab', 'shamail', 'hisn', 'forty', 'virtues', 'thulathiyyat', 'dehlawi'];

const surahStart = SURAHS.reduce<number[]>((acc, [, , , n], i) => (acc.push(i === 0 ? 1 : acc[i - 1] + SURAHS[i - 1][3]), acc), []);

export type Ayah = { key: string; number: string; ar_matn: string; en_text: string | null };

export async function surahAyat(db: D1Database, s: number): Promise<Ayah[]> {
  if (s < 1 || s > 114) return [];
  const from = surahStart[s - 1];
  const to = from + SURAHS[s - 1][3] - 1;
  const { results } = await db.prepare('SELECT key, number, ar_matn, en_text FROM units WHERE id BETWEEN ? AND ? ORDER BY id').bind(from, to).all<Ayah>();
  return results;
}

async function cached<T>(kv: KVNamespace, key: string, make: () => Promise<T>): Promise<T> {
  const k = `browse:${BROWSE_VERSION}:${key}`;
  const hit = await kv.get<T>(k, 'json');
  if (hit) return hit;
  const value = await make();
  await kv.put(k, JSON.stringify(value));
  return value;
}

export type CollectionCount = { id: string; count: number; group: 'core' | 'anthology' | 'other' };

export function collectionsList(db: D1Database, kv: KVNamespace): Promise<CollectionCount[]> {
  return cached(kv, 'collections', async () => {
    const { results } = await db.prepare("SELECT collection AS id, count(*) AS count FROM units WHERE kind = 'hadith' GROUP BY collection").all<{ id: string; count: number }>();
    const order = (id: string) => (CORE.includes(id) ? CORE.indexOf(id) : ANTHOLOGIES.includes(id) ? 100 + ANTHOLOGIES.indexOf(id) : 200 + COLLECTIONS.findIndex((c) => c.id === id));
    return results
      .filter((r) => collection(r.id))
      .map((r) => ({ ...r, group: (CORE.includes(r.id) ? 'core' : ANTHOLOGIES.includes(r.id) ? 'anthology' : 'other') as CollectionCount['group'] }))
      .sort((a, b) => order(a.id) - order(b.id));
  });
}

export type Chapter = { index: number; en: string | null; ar: string | null; count: number };

export function chapters(db: D1Database, kv: KVNamespace, coll: string): Promise<Chapter[]> {
  return cached(kv, `chapters:${coll}`, async () => {
    const { results } = await db
      .prepare('SELECT chapter_en AS en, chapter_ar AS ar, min(ord) AS o, count(*) AS count FROM units WHERE collection = ? GROUP BY chapter_en, chapter_ar ORDER BY o')
      .bind(coll)
      .all<{ en: string | null; ar: string | null; o: number; count: number }>();
    return results.map((r, i) => ({ index: i + 1, en: r.en, ar: r.ar, count: r.count }));
  });
}

export type HadithItem = { key: string; number: string; ar_matn: string; said: Range[]; en_text: string | null; grade_status: string | null; section_en: string | null };

export async function chapterHadith(db: D1Database, coll: string, ch: Chapter): Promise<HadithItem[]> {
  const { results } = await db
    .prepare('SELECT key, number, ar_matn, ar_marked, en_text, grade_status, section_en FROM units WHERE collection = ? AND chapter_en IS ? AND chapter_ar IS ? ORDER BY ord LIMIT 500')
    .bind(coll, ch.en, ch.ar)
    .all<Omit<HadithItem, 'said'> & { ar_marked: string | null }>();
  return results.map(({ ar_marked, ...h }) => ({ ...h, said: saidRanges(h.ar_matn, ar_marked) }));
}
