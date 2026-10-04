import { collection, collectionByAlias } from './collections';

// Read side of the D1 corpus: key resolution, row hydration, and the JSON shape every route returns.

export type UnitRow = {
  id: number; key: string; kind: 'quran' | 'hadith'; collection: string; number: string; number_base: number | null;
  chapter_en: string | null; chapter_ar: string | null; section_en: string | null; section_ar: string | null; title_en: string | null;
  ar_isnad: string | null; ar_matn: string; ar_prophetic: string | null; en_text: string | null; id_text: string | null;
  ar_norm: string; ar_stem: string; grade_status: string | null; grades_json: string | null; notes_json: string | null;
  narrators_json: string | null; family_id: string | null; parallel_of: string | null; same_as_previous_of: string | null;
  anthologies_json: string | null; url: string | null; sunnah_url: string | null;
};

const COLS = `id, key, kind, collection, number, number_base, chapter_en, chapter_ar, section_en, section_ar, title_en,
  ar_isnad, ar_matn, ar_prophetic, en_text, id_text, ar_norm, ar_stem, grade_status, grades_json, notes_json,
  narrators_json, family_id, parallel_of, same_as_previous_of, anthologies_json, url, sunnah_url`;

export async function unitsByKeys(db: D1Database, keys: string[]): Promise<Map<string, UnitRow>> {
  const out = new Map<string, UnitRow>();
  const uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT ${COLS} FROM units WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part).all<UnitRow>();
    for (const r of results) out.set(r.key, r);
  }
  return out;
}

export async function unitsByIds(db: D1Database, ids: number[]): Promise<Map<number, UnitRow>> {
  const out = new Map<number, UnitRow>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT ${COLS} FROM units WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all<UnitRow>();
    for (const r of results) out.set(r.id, r);
  }
  return out;
}

export async function quranRange(db: D1Database, surah: number, from: number, to: number): Promise<UnitRow[]> {
  const keys = Array.from({ length: to - from + 1 }, (_, i) => `quran:${surah}:${from + i}`);
  const rows = await unitsByKeys(db, keys);
  return keys.map((k) => rows.get(k)).filter((r): r is UnitRow => !!r);
}

/** A hadith by collection + spoken number: exact number first ("2564a"), else the first variant of that base number. */
export async function hadithByNumber(db: D1Database, coll: string, number: string): Promise<UnitRow | null> {
  const base = parseInt(number, 10);
  const row = await db
    .prepare(`SELECT ${COLS} FROM units WHERE collection = ? AND (number = ? OR number_base = ?) ORDER BY number = ? DESC, ord LIMIT 1`)
    .bind(coll, number, Number.isNaN(base) ? -1 : base, number)
    .first<UnitRow>();
  if (row) return row;
  // Anthology numbering (e.g. Hadith Unlocked's Riyad numbers) → the source hadith.
  const a = await db.prepare('SELECT source_key FROM anthology_entry WHERE collection = ? AND number = ?').bind(coll, number).first<string>('source_key');
  return a ? (await unitsByKeys(db, [a])).get(a) ?? null : null;
}

/** Accepts "bukhari:1", "quran:2:255", "2:255", "abu dawud:4031", anthology keys ("riyad:681a"). */
export async function resolveKey(db: D1Database, raw: string): Promise<UnitRow | null> {
  const key = decodeURIComponent(raw).trim();
  const quran = key.match(/^(?:quran:)?(\d{1,3}):(\d{1,3})$/);
  if (quran) return (await unitsByKeys(db, [`quran:${quran[1]}:${quran[2]}`])).get(`quran:${quran[1]}:${quran[2]}`) ?? null;
  const direct = (await unitsByKeys(db, [key.toLowerCase()])).get(key.toLowerCase());
  if (direct) return direct;
  const m = key.match(/^([^:]+):(.+)$/);
  if (!m) return null;
  const coll = collectionByAlias(m[1]) ?? m[1].toLowerCase();
  const anth = await db.prepare('SELECT source_key FROM anthology_entry WHERE key = ?').bind(`${m[1].toLowerCase()}:${m[2]}`).first<string>('source_key');
  if (anth) return (await unitsByKeys(db, [anth])).get(anth) ?? null;
  return hadithByNumber(db, coll, m[2]);
}

export type Grade = { grader: string; grade: string; class: string; sources: string[]; conflict: boolean; via?: string | null };

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function grades(row: UnitRow): Grade[] {
  return parse<Grade[]>(row.grades_json, []).map((g) => ({
    grader: g.grader, grade: g.grade, class: g.class, sources: g.sources ?? [], conflict: !!g.conflict, via: g.via ?? null,
  }));
}

export function sourceUrl(row: UnitRow): string {
  return row.url ?? `https://hadits.net/${row.key}`;
}

export function reference(row: UnitRow): string {
  if (row.kind === 'quran') return `QS ${row.chapter_en} ${row.number}`;
  return `${collection(row.collection)?.id_name ?? row.collection} ${row.number}`;
}

export function present(row: UnitRow, opts: { full?: boolean } = {}) {
  const c = collection(row.collection);
  return {
    key: row.key,
    kind: row.kind,
    collection: row.collection,
    collection_name: c ? { en: c.en, id: c.id_name, ar: c.ar } : null,
    number: row.number,
    reference: reference(row),
    chapter: row.chapter_en || row.chapter_ar ? { en: row.chapter_en, ar: row.chapter_ar } : null,
    section: row.section_en || row.section_ar ? { en: row.section_en, ar: row.section_ar } : null,
    ar: { matn: row.ar_matn, prophetic: row.ar_prophetic, ...(opts.full ? { isnad: row.ar_isnad } : {}) },
    en: row.en_text,
    id: row.id_text,
    grade_status: row.grade_status,
    grades: grades(row),
    parallel_of: row.parallel_of,
    same_as_previous_of: row.same_as_previous_of,
    url: sourceUrl(row),
    sunnah_url: row.sunnah_url,
    ...(opts.full
      ? {
          narrators: parse<unknown[]>(row.narrators_json, []),
          notes: parse<unknown[]>(row.notes_json, []),
          anthologies: parse<unknown[]>(row.anthologies_json, []),
        }
      : {}),
  };
}

/** Other wordings of the same report (repeat narrations, anthology copies, "like the previous"). */
export async function family(db: D1Database, row: UnitRow, limit = 12) {
  if (!row.family_id) return [];
  const { results } = await db
    .prepare('SELECT key, collection, number, substr(ar_matn, 1, 240) AS ar, grade_status FROM units WHERE family_id = ? AND key != ? ORDER BY ord LIMIT ?')
    .bind(row.family_id, row.key, limit)
    .all<{ key: string; collection: string; number: string; ar: string; grade_status: string }>();
  return results.map((r) => ({ ...r, collection_name: collection(r.collection)?.id_name ?? r.collection }));
}
