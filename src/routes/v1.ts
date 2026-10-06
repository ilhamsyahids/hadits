import { Hono } from 'hono';
import { asLang, family, present, resolveKey } from '../corpus/units';
import { generateJSON } from '../lib/gemini';
import { termById } from '../lib/glossary';
import { findTerms } from '../lib/terms';
import type { AppEnv } from '../env';
import { search } from '../search/search';
import type { Segment } from '../verify/detect';
import { type Detector, verify } from '../verify/verify';
import type { Doc, DocIndexItem } from '../lectures/doc';
import { forgetDocument } from '../lectures/forget';
import { guessLang, parseText } from '../lectures/parse';
import { translateDoc, translationKey } from '../lectures/translate';
import { makeQuiz, quizKey } from '../lectures/quiz';
import { buildReport, cachedReport, decisionsKey, reportKey, VERIFY_VERSION } from '../lectures/report';

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
    c.env.CACHE.put(`lecture:${id}`, JSON.stringify(doc), { expirationTtl: DOC_TTL, metadata: { title, lang: doc.lang, created, chars: text.length } }),
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
  await forgetDocument(c.env.CACHE, doc);
  return c.json({ deleted: id });
});

// Human review: a reader sends a finding that needs a scholar ("not found", weak or disputed, a misquote) to the
// reviewer's queue. Kept 90 days in KV; read on the admin page (/admin).
const REVIEW_TTL = 60 * 60 * 24 * 90;
v1.post('/reviews', async (c) => {
  const b = await c.req.json<{ said?: string; status?: string; key?: string | null; page?: string; note?: string }>().catch(() => ({}) as Record<string, never>);
  const said = typeof b.said === 'string' ? b.said.trim().slice(0, 2000) : '';
  if (!said || typeof b.status !== 'string') return c.json({ error: 'said and status are required' }, 400);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:review:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (n >= 30) return c.json({ error: 'rate_limited' }, 429);
  await c.env.CACHE.put(rl, String(n + 1), { expirationTtl: 7200 });
  const at = new Date().toISOString();
  const item = { at, said, status: b.status.slice(0, 40), key: typeof b.key === 'string' ? b.key.slice(0, 80) : null, page: typeof b.page === 'string' ? b.page.slice(0, 300) : null, note: typeof b.note === 'string' ? b.note.slice(0, 1000) : null };
  await c.env.CACHE.put(`review:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(item), { expirationTtl: REVIEW_TTL });
  return c.json({ ok: true }, 201);
});

// Messages from the sources page: a dispute, a source to add, or feedback. Read on the admin page; kept 180 days.
const MESSAGE_KINDS = ['dispute', 'suggest', 'feedback'];
const MESSAGE_TTL = 60 * 60 * 24 * 180;
v1.post('/messages', async (c) => {
  const b = await c.req.json<{ kind?: string; key?: string; message?: string; email?: string }>().catch(() => ({}) as Record<string, never>);
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 4000) : '';
  const kind = MESSAGE_KINDS.includes(String(b.kind)) ? String(b.kind) : 'feedback';
  if (message.length < 5) return c.json({ error: 'message is required' }, 400);
  const email = typeof b.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()) ? b.email.trim().slice(0, 200) : null;
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:message:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (n >= 10) return c.json({ error: 'rate_limited' }, 429);
  await c.env.CACHE.put(rl, String(n + 1), { expirationTtl: 7200 });
  const at = new Date().toISOString();
  const item = { at, kind, key: typeof b.key === 'string' && b.key.trim() ? b.key.trim().slice(0, 300) : null, message, email };
  await c.env.CACHE.put(`message:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(item), { expirationTtl: MESSAGE_TTL });
  return c.json({ ok: true }, 201);
});

// A glossary term explained in its passage (the curated definition is on the page already). Cached per term,
// passage and language; never quotes scripture.
const EXPLAIN_SYSTEM = `You explain one Islamic term to a reader, as it is used in the passage given. Write {LANGUAGE}, two or three short sentences, plain words.
Say what the term means and what it means here in this passage. Do not quote the Quran or hadith, do not give a ruling, and do not add anything the passage does not support.`;
v1.post('/explain', async (c) => {
  const b = await c.req.json<{ term?: string; label?: string; gloss?: string; context?: string; lang?: string }>().catch(() => ({}) as Record<string, never>);
  const curated = termById(String(b.term ?? ''));
  // A term the model found in the text (POST /v1/terms) comes with its own label and one-line meaning.
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 60) : '';
  const term = curated ?? (label ? { id: `x:${label}`, forms: [label], ar: '', en: typeof b.gloss === 'string' ? b.gloss.slice(0, 240) : '' } : null);
  const context = typeof b.context === 'string' ? b.context.slice(0, 1500) : '';
  if (!term || !context) return c.json({ error: 'term and context are required' }, 400);
  const lang = asLang(b.lang);
  const key = `explain:v1:${await hash(JSON.stringify([term.id, context, lang]))}`;
  const cached = await c.env.CACHE.get<{ text: string }>(key, 'json');
  if (cached) return c.json(cached);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:explain:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (n >= 120) return c.json({ error: 'rate_limited' }, 429);
  c.executionCtx.waitUntil(c.env.CACHE.put(rl, String(n + 1), { expirationTtl: 7200 }));
  const language = { en: 'in English', ar: 'in Arabic', id: 'in Bahasa Indonesia' }[lang];
  const { data } = await generateJSON<{ text: string }>(c.env, {
    model: c.env.LLM_MODEL_LITE,
    system: EXPLAIN_SYSTEM.replace('{LANGUAGE}', language),
    prompt: `Term: ${term.forms[0]}${term.ar ? ` (${term.ar})` : ''}: ${term.en}\nPassage: ${context}`,
    schema: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
    thinking: 'minimal',
  });
  const out = { text: data.text };
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 30 }));
  return c.json(out);
});

// Translation of a text with its scripture left to the sources (src/lectures/translate.ts). Cached like reports.
v1.get('/lectures/:id/translation', async (c) => {
  const id = c.req.param('id');
  const to = asLang(c.req.query('to'));
  const key = translationKey(id, to);
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);
  const doc = await c.env.CACHE.get<Doc>(`lecture:${id}`, 'json');
  if (!doc) return c.json({ error: 'not_found' }, 404);
  const t = await translateDoc(c.env, doc, to, (p) => c.executionCtx.waitUntil(p));
  const ttl = doc.submitted ? Math.max(60, Math.floor((doc.submitted.expires - Date.now()) / 1000)) : undefined;
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(t), ttl ? { expirationTtl: ttl } : {}));
  return c.json(t);
});

// A quiz on a text (src/lectures/quiz.ts): content questions with the paragraph that answers them, and
// "where is this from?" questions from the report's findings. Cached like reports.
v1.get('/lectures/:id/quiz', async (c) => {
  const id = c.req.param('id');
  const lang = asLang(c.req.query('lang'));
  const key = quizKey(id, lang);
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);
  const doc = await c.env.CACHE.get<Doc>(`lecture:${id}`, 'json');
  if (!doc) return c.json({ error: 'not_found' }, 404);
  const quiz = await makeQuiz(c.env, doc, lang, (p) => c.executionCtx.waitUntil(p));
  const ttl = doc.submitted ? Math.max(60, Math.floor((doc.submitted.expires - Date.now()) / 1000)) : undefined;
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(quiz), ttl ? { expirationTtl: ttl } : {}));
  return c.json(quiz);
});

// Glossary terms the model finds in a text (src/lib/terms.ts): for a lecture or article, and for any short text
// such as an Ask answer. Cached per text and language.
v1.get('/lectures/:id/terms', async (c) => {
  const id = c.req.param('id');
  const lang = asLang(c.req.query('lang'));
  const key = `terms:v1:${id}:${lang}`;
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);
  const doc = await c.env.CACHE.get<Doc>(`lecture:${id}`, 'json');
  if (!doc) return c.json({ error: 'not_found' }, 404);
  const terms = await findTerms(c.env, doc.segments.map((s) => s.text).join('\n'), lang);
  const ttl = doc.submitted ? Math.max(60, Math.floor((doc.submitted.expires - Date.now()) / 1000)) : undefined;
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify({ terms }), ttl ? { expirationTtl: ttl } : {}));
  return c.json({ terms });
});

v1.post('/terms', async (c) => {
  const b = await c.req.json<{ text?: string; lang?: string }>().catch(() => ({}) as Record<string, never>);
  const text = typeof b.text === 'string' ? b.text.slice(0, 8000) : '';
  if (text.length < 40) return c.json({ terms: [] });
  const lang = asLang(b.lang);
  const key = `terms:text:${await hash(JSON.stringify([text, lang]))}`;
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:terms:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (n >= 120) return c.json({ terms: [] });
  c.executionCtx.waitUntil(c.env.CACHE.put(rl, String(n + 1), { expirationTtl: 7200 }));
  const out = { terms: await findTerms(c.env, text, lang) };
  c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 30 }));
  return c.json(out);
});
