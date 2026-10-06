<script setup lang="ts">
import { onMounted, ref } from 'vue';

// The admin page's lists (src/pages/admin.astro): messages from the sources page (POST /v1/messages), findings readers
// sent for review (POST /v1/reviews) and the texts they submitted (POST /v1/documents). Removing an item is the only
// action; nothing else changes.
type Message = { id: string; at: string; kind: string; key: string | null; message: string; email: string | null };
type Review = { id: string; at: string; said: string; status: string; key: string | null; page: string | null; note: string | null };
type Submitted = { id: string; title: string; lang: string; created: number; chars?: number; expires: number | null };
type List<T> = { state: 'loading' | 'done' | 'error'; items: T[] };

const messages = ref<List<Message>>({ state: 'loading', items: [] });
const reviews = ref<List<Review>>({ state: 'loading', items: [] });
const docs = ref<List<Submitted>>({ state: 'loading', items: [] });
const busy = ref<string | null>(null);

const STATUS: Record<string, string> = { not_found_in_corpus: 'Not found', weak_or_disputed: 'Weak or disputed', misquote: 'Misquote', paraphrase: 'Paraphrase', verbatim: 'Verbatim', reference: 'Reference' };
const when = (t: string | number) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { dateStyle: 'medium' });
const LANG: Record<string, string> = { ar: 'Arabic', en: 'English', id: 'Indonesian' };
const KIND: Record<string, string> = { dispute: 'Dispute', suggest: 'Suggested source', feedback: 'Feedback' };
// What the reader typed as "page or key": a site path, a full URL, or a key such as bukhari:1.
const keyHref = (k: string) => (/^https?:\/\//.test(k) || k.startsWith('/') ? k : /^[a-z0-9_]+:[0-9a-z:]+$/i.test(k) ? `/${k}` : null);

async function call(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  // The session ran out: the page shows the sign-in form again.
  if (res.status === 401) location.reload();
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
async function load<T>(list: typeof messages | typeof reviews | typeof docs, path: string) {
  try {
    (list.value as List<T>) = { state: 'done', items: await call(path) };
  } catch {
    list.value = { state: 'error', items: [] };
  }
}
async function remove(kind: 'messages' | 'reviews' | 'documents', id: string, ask: string | null) {
  if (ask && !confirm(ask)) return;
  busy.value = id;
  try {
    await call(`/admin/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const list = kind === 'messages' ? messages : kind === 'reviews' ? reviews : docs;
    (list.value.items as { id: string }[]) = list.value.items.filter((x) => x.id !== id);
  } catch {
    alert('Could not remove it. Try again.');
  } finally {
    busy.value = null;
  }
}
onMounted(() => {
  load<Message>(messages, '/admin/messages');
  load<Review>(reviews, '/admin/reviews');
  load<Submitted>(docs, '/admin/documents');
});
</script>

<template>
  <section aria-labelledby="h-messages">
    <h2 id="h-messages">Messages <span v-if="messages.state === 'done'" class="count">{{ messages.items.length }}</span></h2>
    <p class="muted">Disputes, suggested sources and feedback from the sources page. Kept 180 days; "Done" removes one.</p>
    <p v-if="messages.state === 'loading'" class="muted">Loading…</p>
    <p v-else-if="messages.state === 'error'" class="error">Could not load the messages.</p>
    <p v-else-if="!messages.items.length" class="empty">No messages.</p>
    <ul v-else class="rows">
      <li v-for="m in messages.items" :key="m.id">
        <div class="meta">
          <span class="status">{{ KIND[m.kind] ?? m.kind }}</span>
          <span>{{ when(m.at) }}</span>
          <template v-if="m.key">
            <a v-if="keyHref(m.key)" :href="keyHref(m.key)!" target="_blank" rel="noopener" dir="auto">{{ m.key }}</a>
            <span v-else dir="auto">{{ m.key }}</span>
          </template>
          <a v-if="m.email" :href="`mailto:${m.email}`">{{ m.email }}</a>
        </div>
        <p class="said msg" dir="auto">{{ m.message }}</p>
        <button type="button" :disabled="busy === m.id" @click="remove('messages', m.id, null)">Done</button>
      </li>
    </ul>
  </section>

  <section aria-labelledby="h-reviews">
    <h2 id="h-reviews">Review queue <span v-if="reviews.state === 'done'" class="count">{{ reviews.items.length }}</span></h2>
    <p class="muted">Findings readers sent to a person with knowledge. Kept 90 days; "Done" removes one from the queue.</p>
    <p v-if="reviews.state === 'loading'" class="muted">Loading…</p>
    <p v-else-if="reviews.state === 'error'" class="error">Could not load the queue.</p>
    <p v-else-if="!reviews.items.length" class="empty">Nothing waiting.</p>
    <ul v-else class="rows">
      <li v-for="r in reviews.items" :key="r.id">
        <div class="meta">
          <span class="status">{{ STATUS[r.status] ?? r.status }}</span>
          <span>{{ when(r.at) }}</span>
          <a v-if="r.key" :href="`/${r.key}`" target="_blank" rel="noopener">{{ r.key }}</a>
          <a v-if="r.page" :href="r.page" target="_blank" rel="noopener">Page it came from</a>
        </div>
        <p class="said" dir="auto">{{ r.said }}</p>
        <p v-if="r.note" class="note" dir="auto">{{ r.note }}</p>
        <button type="button" :disabled="busy === r.id" @click="remove('reviews', r.id, null)">Done</button>
      </li>
    </ul>
  </section>

  <section aria-labelledby="h-docs">
    <h2 id="h-docs">Submitted texts <span v-if="docs.state === 'done'" class="count">{{ docs.items.length }}</span></h2>
    <p class="muted">Lectures and articles readers checked. Each expires 30 days after it was sent; deleting removes its report, translations, quiz and terms too.</p>
    <p v-if="docs.state === 'loading'" class="muted">Loading…</p>
    <p v-else-if="docs.state === 'error'" class="error">Could not load the texts.</p>
    <p v-else-if="!docs.items.length" class="empty">No submitted texts.</p>
    <ul v-else class="rows">
      <li v-for="d in docs.items" :key="d.id">
        <a class="title" :href="`/lectures/${d.id}`" target="_blank" rel="noopener" dir="auto">{{ d.title }}</a>
        <div class="meta">
          <span>{{ LANG[d.lang] ?? d.lang }}</span>
          <span v-if="d.chars">{{ d.chars.toLocaleString('en') }} characters</span>
          <span>Sent {{ when(d.created) }}</span>
          <span v-if="d.expires">Expires {{ day(d.expires) }}</span>
        </div>
        <button type="button" :disabled="busy === d.id" @click="remove('documents', d.id, `Delete “${d.title}” and everything built from it?`)">Delete</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
section { margin-top: 28px; }
h2 { font-size: 1.15rem; font-weight: 500; margin: 0 0 6px; display: flex; align-items: baseline; gap: 10px; }
.count { color: var(--muted); font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); margin: 0 0 12px; max-width: 70ch; }
.empty { color: var(--subtle); margin: 0; padding: 14px 0; border-top: 1px solid var(--line); }
.error { color: var(--warn); }
.rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.rows li { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.rows li > :not(button) { grid-column: 1; }
.rows button { grid-column: 2; grid-row: 1 / span 3; align-self: start; border: 1px solid var(--line); background: none; color: var(--text); border-radius: var(--r-small); font: inherit; font-size: 0.9rem; padding: 0 14px; min-height: 36px; cursor: pointer; }
.rows button:hover { border-color: var(--muted); }
.rows button:disabled { opacity: 0.45; cursor: default; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--muted); font-size: 0.88rem; }
.meta a, .title { color: var(--text); text-underline-offset: 3px; }
.status { color: var(--text); font-weight: 500; }
.said { margin: 0; line-height: 1.7; font-size: 1.05rem; }
.note { margin: 0; color: var(--muted); }
.msg { white-space: pre-wrap; font-size: 1rem; }
</style>
