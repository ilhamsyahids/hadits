import { cf } from '@astrojs/cloudflare/hono';
import { middleware, pages } from 'astro/hono';
import { Hono } from 'hono';
import { api } from './api';
import type { AppEnv } from './env';

// Worker entry: API routes first, then Astro SSR pages. Durable Objects (Tanya) are exported from here.
const app = new Hono<AppEnv>();
app.route('/', api);
app.use(cf());
app.use(middleware());
app.use(pages());

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>) {
    // No background jobs yet: the corpus embedding batch runs on the VPS (tools/embed_batch.py).
    batch.ackAll();
  },
} satisfies ExportedHandler<CloudflareBindings>;
