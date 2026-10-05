import type { Bindings } from '../env';
import type { Lang } from '../corpus/units';
import { type Decisions, verify } from '../verify/verify';
import type { Doc } from './doc';

// Lecture and article reports, cached in KV per text and language; every language shows the same findings. Bump VERIFY_VERSION when verification changes
// what it returns; then rebuild the sample reports (`bun run warm`, run by `bun run deploy`) so no reader waits.
export const VERIFY_VERSION = 'v12';

export const reportKey = (id: string, lang: Lang) => `report:${VERIFY_VERSION}:${id}:${lang}`;
// What the first report of a text found and decided; the other languages reuse it (see Decisions in verify.ts).
export const decisionsKey = (id: string) => `decisions:${VERIFY_VERSION}:${id}`;

/** The cached report, or null. Pages read it to render a report without a second request. */
export function cachedReport<T = unknown>(env: Bindings, id: string, lang: Lang) {
  return env.CACHE.get<T>(reportKey(id, lang), 'json').catch(() => null);
}

/**
 * Check the whole text and cache the result. Samples are kept until the next VERIFY_VERSION; a reader's text only
 * as long as the text itself. A degraded run (a model call failed) is returned but not cached.
 */
export async function buildReport(env: Bindings, doc: Doc, lang: Lang, waitUntil: (p: Promise<unknown>) => void) {
  const ttl = doc.submitted ? Math.max(60, Math.floor((doc.submitted.expires - Date.now()) / 1000)) : undefined;
  const keep = ttl ? { expirationTtl: ttl } : {};
  const decisions = {
    load: () => env.CACHE.get<Decisions>(decisionsKey(doc.id), 'json'),
    save: (d: Decisions) => waitUntil(env.CACHE.put(decisionsKey(doc.id), JSON.stringify(d), keep)),
  };
  const res = await verify(env, doc.segments.map(({ start, end, text }) => ({ start, end, text })), { lang, decisions });
  if (!res.degraded.length) waitUntil(env.CACHE.put(reportKey(doc.id, lang), JSON.stringify(res), keep));
  return res;
}
