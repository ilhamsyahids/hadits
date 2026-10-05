import { Hono } from 'hono';
import { asLang, family, present, resolveKey } from '../corpus/units';
import type { AppEnv } from '../env';
import { search } from '../search/search';
import type { Segment } from '../verify/detect';
import { type Detector, verify } from '../verify/verify';
import type { Doc, DocIndexItem } from '../lectures/doc';
import { guessLang, parseText } from '../lectures/parse';
import { buildReport, cachedReport, reportKey, VERIFY_VERSION } from '../lectures/report';

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

// Sample lectures (tools/demo_lectures.py → KV). The report is a cached /v1/verify run per language.
type LectureIndex = DocIndexItem[];

v1.get('/lectures', async (c) => c.json((await c.env.CACHE.get<LectureIndex>('lectures:index', 'json')) ?? []));

v1.get('/lectures/:id', async (c) => {
  const lecture = await c.env.CACHE.get<Doc>(`lecture:${c.req.param('id')}`, 'json');
  if (!lecture) return c.json({ error: 'not_found' }, 404);
  const { submitted, ...rest } = lecture;
  return c.json({ ...rest, ...(submitted ? { expires: submitted.expires } : {}) });
});

v1.get('/lectures/:id/report', async (c) => {
  const id = c.req.param('id');
  const lang = asLang(c.req.query('lang'));
  const cached = await cachedReport<object>(c.env, id, lang);
  if (cached) return c.json({ ...cached, cached: true });
  const lecture = await c.env.CACHE.get<Doc>(`lecture:${id}`, 'json');
  if (!lecture) return c.json({ error: 'not_found' }, 404);
  return c.json(await buildReport(c.env, lecture, lang, (p) => c.executionCtx.waitUntil(p)));
});

// A reader's own lecture or article: stored for 30 days under an unlisted id, then reported like a sample.
// Only the submitter holds the token that deletes it (only its hash is stored). The same text maps to the same id.
const DOC_TTL = 60 * 60 * 24 * 30;
const DOC_MAX_CHARS = 100_000;
const DOC_PER_HOUR = 10;
const randomId = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((x) => x.toString(36).padStart(2, '0').slice(-2)).join('');

v1.post('/documents', async (c) => {
  const body = await c.req.json<{ text?: string; title?: string; filename?: string }>().catch(() => ({}) as { text?: string; title?: string; filename?: string });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 40) return c.json({ error: 'too_short' }, 400);
  if (text.length > DOC_MAX_CHARS) return c.json({ error: 'too_long', max: DOC_MAX_CHARS }, 413);

  const textHash = await hash(text);
  const existing = await c.env.CACHE.get<{ id: string }>(`doc:hash:${textHash}`, 'json');
  if (existing && (await c.env.CACHE.get(`lecture:${existing.id}`))) return c.json({ id: existing.id, token: null });

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:doc:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (n >= DOC_PER_HOUR) return c.json({ error: 'rate_limited' }, 429);
  await c.env.CACHE.put(rl, String(n + 1), { expirationTtl: 7200 });

  const parsed = parseText(text);
  if (!parsed.segments.length) return c.json({ error: 'too_short' }, 400);
  if (parsed.segments.length > MAX_SEGMENTS) return c.json({ error: 'too_long', max: DOC_MAX_CHARS }, 413);
  const fromFile = body.filename?.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  const first = parsed.segments[0].text;
  const opening = first.length <= 70 ? first : `${first.slice(0, 70).replace(/\s+\S*$/, '')}…`;
  const title = (body.title?.trim() || parsed.title || fromFile || opening).slice(0, 160);
  const id = `u${randomId(8)}`;
  const token = randomId(24);
  const created = Date.now();
  const doc: Doc = {
    id, title, lang: guessLang(text), kind: parsed.timing === 'audio' ? 'lecture' : 'text', timing: parsed.timing,
    duration: parsed.timing === 'audio' ? parsed.segments.at(-1)!.end : parsed.segments.length,
    source: null, submitted: { created, expires: created + DOC_TTL * 1000, token_hash: await hash(token), text_hash: textHash }, segments: parsed.segments,
  };
  await Promise.all([
    c.env.CACHE.put(`lecture:${id}`, JSON.stringify(doc), { expirationTtl: DOC_TTL }),
    c.env.CACHE.put(`doc:hash:${textHash}`, JSON.stringify({ id }), { expirationTtl: DOC_TTL }),
  ]);
  return c.json({ id, token, title, expires: doc.submitted!.expires }, 201);
});

v1.delete('/documents/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const doc = await c.env.CACHE.get<Doc>(`lecture:${id}`, 'json');
  if (!doc?.submitted) return c.json({ error: 'not_found' }, 404);
  if (!token || (await hash(token)) !== doc.submitted.token_hash) return c.json({ error: 'forbidden' }, 403);
  await Promise.all([
    c.env.CACHE.delete(`lecture:${id}`),
    c.env.CACHE.delete(`doc:hash:${doc.submitted.text_hash}`),
    ...(['en', 'ar'] as const).map((l) => c.env.CACHE.delete(reportKey(id, l))),
  ]);
  return c.json({ deleted: id });
});
