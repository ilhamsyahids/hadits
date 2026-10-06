import { Hono } from 'hono';
import type { AppEnv } from '../env';

// Write side for offline jobs (tools/embed_batch.py on the VPS). Bearer ADMIN_TOKEN; never linked from the UI.
export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!c.env.ADMIN_TOKEN || !(await sameSecret(token, c.env.ADMIN_TOKEN))) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

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

// The human review queue (POST /v1/reviews), newest first.
admin.get('/reviews', async (c) => {
  const { keys } = await c.env.CACHE.list({ prefix: 'review:' });
  const items = await Promise.all(keys.map((k) => c.env.CACHE.get(k.name, 'json')));
  return c.json(items.filter(Boolean).reverse());
});
