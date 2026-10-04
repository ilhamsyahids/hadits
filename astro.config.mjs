import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://hadits.net',
  output: 'server',
  // Reuse the existing KV for sessions; no image processing (no IMAGES binding to provision).
  adapter: cloudflare({ sessionKVBindingName: 'CACHE', imageService: 'passthrough' }),
});
