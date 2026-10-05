import type { Bindings } from '../env';
import type { Lang } from '../corpus/units';
import { verify } from '../verify/verify';
import type { Doc } from './doc';

// Lecture and article reports, cached in KV per text and language. Bump VERIFY_VERSION when verification changes
// what it returns; then rebuild the sample reports (`bun run warm`, run by `bun run deploy`) so no reader waits.
export const VERIFY_VERSION = 'v8';

export const reportKey = (id: string, lang: Lang) => `report:${VERIFY_VERSION}:${id}:${lang}`;

/** The cached report, or null. Pages read it to render a report without a second request. */
export function cachedReport<T = unknown>(env: Bindings, id: string, lang: Lang) {
  return env.CACHE.get<T>(reportKey(id, lang), 'json').catch(() => null);
}

/**
 * Check the whole text and cache the result. Samples are kept until the next VERIFY_VERSION; a reader's text only
 * as long as the text itself. A degraded run (a model call failed) is returned but not cached.
 */
export async function buildReport(env: Bindings, doc: Doc, lang: Lang, waitUntil: (p: Promise<unknown>) => void) {
  const res = await verify(env, doc.segments.map(({ start, end, text }) => ({ start, end, text })), { lang });
  if (!res.degraded.length) {
    const ttl = doc.submitted ? Math.max(60, Math.floor((doc.submitted.expires - Date.now()) / 1000)) : undefined;
    waitUntil(env.CACHE.put(reportKey(doc.id, lang), JSON.stringify(res), ttl ? { expirationTtl: ttl } : {}));
  }
  return res;
}
