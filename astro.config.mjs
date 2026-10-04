import cloudflare from '@astrojs/cloudflare';
import vue from '@astrojs/vue';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://hadits.net',
  output: 'server',
  // Reuse the existing KV for sessions; no image processing (no IMAGES binding to provision).
  adapter: cloudflare({ sessionKVBindingName: 'CACHE', imageService: 'passthrough' }),
  integrations: [vue()],
  // English at /, Arabic at /ar/ (right-to-left).
  i18n: { locales: ['en', 'ar'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
});
