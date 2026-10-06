import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { Doc } from '../lectures/doc';
import { forgetDocument } from '../lectures/forget';
import { checkLogin, clearedCookie, hasSession, sameSecret, sessionCookie } from '../lib/session';

// /admin/*: the admin page's data (a session cookie from ADMIN_USER / ADMIN_PASSWORD, see src/pages/admin.astro)
// and the write side for offline jobs (tools/embed_batch.py on the VPS, Bearer ADMIN_TOKEN).
export const admin = new Hono<AppEnv>();
const LOGIN_TRIES_PER_HOUR = 10;

admin.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/\/$/, '');
  // The page itself (Astro) checks the session; signing in and out needs none.
  if ((path === '/admin' && c.req.method === 'GET') || path === '/admin/login' || path === '/admin/logout') return next();
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
  if (token && c.env.ADMIN_TOKEN && (await sameSecret(token, c.env.ADMIN_TOKEN))) return next();
  if (await hasSession(c.env, c.req.header('cookie'))) {
    // The cookie is SameSite=Strict; changes must also come from this site's own page.
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403);
    return next();
  }
  return c.json({ error: 'unauthorized' }, 401);
});

// The sign-in form posts here; failed tries are limited per address.
admin.post('/login', async (c) => {
  const secure = new URL(c.req.url).protocol === 'https:';
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, string>);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = `rl:login:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const tries = Number((await c.env.CACHE.get(rl)) ?? 0);
  if (tries >= LOGIN_TRIES_PER_HOUR) return c.redirect('/admin?error=limit', 303);
  if (!(await checkLogin(c.env, String(form.user ?? ''), String(form.password ?? '')))) {
    await c.env.CACHE.put(rl, String(tries + 1), { expirationTtl: 7200 });
    return c.redirect('/admin?error=login', 303);
  }
  c.header('set-cookie', await sessionCookie(c.env, secure));
  return c.redirect('/admin', 303);
});

admin.post('/logout', (c) => {
  c.header('set-cookie', clearedCookie(new URL(c.req.url).protocol === 'https:'));
  return c.redirect('/admin', 303);
});

type VectorIn = { id: string; values: number[]; metadata?: Record<string, string> };

admin.post('/vectors', async (c) => {
  const { vectors } = await c.req.json<{ vectors: VectorIn[] }>();
  const dim = Number(c.env.EMBED_DIM);
  if (!Array.isArray(vectors) || vectors.length === 0 || vectors.length > 1000) return c.json({ error: '1..1000 vectors' }, 400);
  const bad = vectors.find((v) => !v.id || v.id.length > 64 || v.values?.length !== dim);
  if (bad) return c.json({ error: `bad vector ${bad.id}` }, 400);
  const res = await c.env.UNITS_INDEX.upsert(vectors);
  return c.json({ count: vectors.length, result: res });
});

// Embeddings from Workers AI for offline jobs (benchmarks, re-indexing). Body: { model, texts } → { vectors }.
const WORKERS_AI_EMBEDDERS = ['@cf/baai/bge-m3', '@cf/google/embeddinggemma-300m', '@cf/qwen/qwen3-embedding-0.6b'] as const;
type Embedder = (typeof WORKERS_AI_EMBEDDERS)[number];

admin.post('/embed', async (c) => {
  const { model, texts } = await c.req.json<{ model: Embedder; texts: string[] }>();
  if (!WORKERS_AI_EMBEDDERS.includes(model)) return c.json({ error: `model must be one of ${WORKERS_AI_EMBEDDERS.join(', ')}` }, 400);
  if (!Array.isArray(texts) || !texts.length || texts.length > 100) return c.json({ error: '1..100 texts' }, 400);
  let out: { data: number[][] | { embedding: number[] }[] };
  try {
    out = (await c.env.AI.run(model as never, { text: texts } as never)) as unknown as typeof out;
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
  const vectors = out.data.map((d) => (Array.isArray(d) ? d : d.embedding));
  return c.json({ model, dim: vectors[0]?.length ?? 0, vectors });
});

// The human review queue (POST /v1/reviews), newest first. `id` is the KV key without its prefix.
admin.get('/reviews', async (c) => {
  const { keys } = await c.env.CACHE.list({ prefix: 'review:' });
  const items = await Promise.all(keys.map(async (k) => {
    const item = await c.env.CACHE.get<Record<string, unknown>>(k.name, 'json');
    return item && { id: k.name.slice('review:'.length), ...item };
  }));
  return c.json(items.filter(Boolean).reverse());
});

admin.delete('/reviews/:id', async (c) => {
  await c.env.CACHE.delete(`review:${c.req.param('id')}`);
  return c.json({ deleted: c.req.param('id') });
});

// Messages from the sources page (POST /v1/messages), newest first.
admin.get('/messages', async (c) => {
  const { keys } = await c.env.CACHE.list({ prefix: 'message:' });
  const items = await Promise.all(keys.map(async (k) => {
    const item = await c.env.CACHE.get<Record<string, unknown>>(k.name, 'json');
    return item && { id: k.name.slice('message:'.length), ...item };
  }));
  return c.json(items.filter(Boolean).reverse());
});

admin.delete('/messages/:id', async (c) => {
  await c.env.CACHE.delete(`message:${c.req.param('id')}`);
  return c.json({ deleted: c.req.param('id') });
});

// Texts readers submitted (ids start with "u"), newest first. Older ones carry no list metadata and are read.
type DocMeta = { title: string; lang: string; created: number; chars?: number };
admin.get('/documents', async (c) => {
  const { keys } = await c.env.CACHE.list<DocMeta>({ prefix: 'lecture:u', limit: 1000 });
  const items = await Promise.all(keys.map(async (k) => {
    let meta = k.metadata;
    if (!meta) {
      const doc = await c.env.CACHE.get<Doc>(k.name, 'json');
      if (!doc?.submitted) return null;
      meta = { title: doc.title, lang: doc.lang, created: doc.submitted.created, chars: doc.segments.reduce((n, s) => n + s.text.length, 0) };
    }
    return { id: k.name.slice('lecture:'.length), ...meta, expires: k.expiration ? k.expiration * 1000 : null };
  }));
  return c.json(items.filter(Boolean).sort((a, b) => b!.created - a!.created));
});

admin.delete('/documents/:id', async (c) => {
  const doc = await c.env.CACHE.get<Doc>(`lecture:${c.req.param('id')}`, 'json');
  if (!doc?.submitted) return c.json({ error: 'not_found' }, 404);
  await forgetDocument(c.env.CACHE, doc);
  return c.json({ deleted: doc.id });
});
