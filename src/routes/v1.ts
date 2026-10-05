import { Hono } from 'hono';
import { asLang, family, present, resolveKey } from '../corpus/units';
import type { AppEnv } from '../env';
import { search } from '../search/search';
import type { Segment } from '../verify/detect';
import { type Detector, verify } from '../verify/verify';

export const v1 = new Hono<AppEnv>();

v1.get('/refs/:key{.+}', async (c) => {
  const row = await resolveKey(c.env.CORPUS, c.req.param('key'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...present(row, { full: true, lang: asLang(c.req.query('lang')) }), family: await family(c.env.CORPUS, row) });
});

v1.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ error: 'q is required' }, 400);
  const kind = c.req.query('kind');
  const t0 = Date.now();
  const res = await search(c.env, q.slice(0, 2000), {
    kind: kind === 'quran' || kind === 'hadith' ? kind : undefined,
    limit: Number(c.req.query('limit') ?? 10),
  });
  return c.json({
    q,
    interpretation: res.interpretation,
    results: res.results.map((r) => ({ ...present(r.row, { lang: asLang(c.req.query('lang')) }), score: Number(r.score.toFixed(4)), via: r.via })),
    degraded: res.degraded,
    ms: Date.now() - t0,
  });
});

const VERIFY_VERSION = 'v3';
const MAX_SEGMENTS = 2000;

async function hash(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Body: { transcript: { segments: [{ start, end, speaker?, text }] } } for a lecture, or { text } for one quote.
// lang (en | ar | id, default en) sets the language of references, grade notes and the judge's reason.
// detector: rules | llm | hybrid (default: hybrid for lectures, rules for an Arabic quote, llm for Latin text).
v1.post('/verify', async (c) => {
  const body = await c.req.json<{ transcript?: { segments: Segment[] }; text?: string; judge?: boolean; nocache?: boolean; lang?: string; detector?: Detector }>();
  const detector = body.detector && ['rules', 'llm', 'hybrid'].includes(body.detector) ? body.detector : undefined;
  const lang = asLang(body.lang);
  const quoteMode = !body.transcript && typeof body.text === 'string';
  const segments: Segment[] = body.transcript?.segments ?? (quoteMode ? [{ start: 0, end: 0, text: body.text!.slice(0, 4000) }] : []);
  if (!segments.length || segments.length > MAX_SEGMENTS) return c.json({ error: `1..${MAX_SEGMENTS} segments or a text` }, 400);
  const key = `verify:${VERIFY_VERSION}:${await hash(JSON.stringify([segments, quoteMode, body.judge !== false, lang, detector]))}`;
  if (!body.nocache) {
    const hit = await c.env.CACHE.get(key, 'json');
    if (hit) return c.json({ ...(hit as object), cached: true });
  }
  const res = await verify(c.env, segments, { judge: body.judge, quoteMode, lang, detector });
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(res), { expirationTtl: 60 * 60 * 24 * 7 }));
  return c.json(res);
});
