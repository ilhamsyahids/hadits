import { cf } from '@astrojs/cloudflare/hono';
import { i18n, middleware, pages } from 'astro/hono';
import { routeAgentRequest } from 'agents';
import { Hono } from 'hono';
import { api } from './api';
import { arabicRedirect } from './lib/geo';
import type { AppEnv } from './env';

// Worker entry: API routes first, then Astro SSR pages. Durable Objects (Tanya) are exported from here.
const app = new Hono<AppEnv>();
app.route('/', api);

// First visit from an Arabic-speaking country → /ar (see src/lib/geo.ts).
app.get('*', async (c, next) => {
  const to = arabicRedirect(new URL(c.req.url), (c.req.raw as Request & { cf?: { country?: string } }).cf?.country, c.req.header('cookie'));
  if (to) return new Response(null, { status: 302, headers: { location: to, 'set-cookie': 'lang=ar; path=/; max-age=31536000; samesite=lax', vary: 'cookie' } });
  await next();
});
// Ask: WebSocket chats with the AskAgent Durable Object (/agents/ask-agent/:chat), limited per IP.
app.all('/agents/*', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `rl:ask:${ip}:${hour}`;
  const n = Number((await c.env.CACHE.get(key)) ?? 0);
  // Counts connections, reconnects included (the client reconnects whenever a socket drops).
  if (n >= 300) return c.json({ error: 'Too many chats from this address; try again later.' }, 429);
  c.executionCtx.waitUntil(c.env.CACHE.put(key, String(n + 1), { expirationTtl: 7200 }));
  // New conversations live in Eastern Europe, next to the corpus (D1 is EEUR). Left to default, a Durable Object
  // starts near the reader, and Gemini refuses some of those locations ("User location is not supported").
  return (await routeAgentRequest(c.req.raw, c.env, { locationHint: 'eeur' })) ?? c.notFound();
});
app.use(cf());
app.use(middleware());
app.use(i18n());
app.use(pages());

export { AskAgent } from './ask/agent';

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>) {
    // No background jobs yet: the corpus embedding batch runs on the VPS (tools/embed_batch.py).
    batch.ackAll();
  },
} satisfies ExportedHandler<CloudflareBindings>;
