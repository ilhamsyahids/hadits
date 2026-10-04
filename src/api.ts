import { Hono } from 'hono';
import type { AppEnv } from './env';
import { admin } from './routes/admin';

// JSON API: /health, /v1/*, /admin/*. Pages are rendered by Astro after these routes (src/worker.ts).
export const api = new Hono<AppEnv>();

api.get('/health', async (c) => {
  const units = await c.env.CORPUS.prepare("SELECT v FROM corpus_meta WHERE k = 'units'")
    .first<string>('v')
    .catch(() => null);
  return c.json({ ok: true, service: 'hadits', units: units ? Number(units) : 0 });
});

api.route('/admin', admin);
