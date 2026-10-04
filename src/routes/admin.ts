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
