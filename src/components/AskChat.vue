<script setup lang="ts">
import { useChat } from '@ai-sdk/vue';
import { AgentClient } from 'agents/client';
import { WebSocketChatTransport } from 'agents/chat/transport';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Strings } from '../i18n/strings';
import { prophetic } from '../lib/prophetic';

// Ask: a chat with the AskAgent Durable Object over WebSocket. The model's answer may only point at scripture
// (<quran key/>, <hadith key/>); this component fills those blocks from /v1/refs, i.e. from the database,
// and shows a citation only when its id was returned by a tool in that turn.

const props = defineProps<{ t: Strings; lang: 'en' | 'ar'; lectureId?: string | null; lectureTitle?: string | null }>();
const a = computed(() => props.t.ask);
const base = props.lang === 'ar' ? '/ar' : '';

// A conversation has an id in the URL (?c=…) and is kept in this browser's localStorage; the same id names its
// Durable Object, so the server keeps the context too. The sidebar lists saved conversations (see AppShell).
type Saved = { id: string; title: string; lectureId: string | null; updated: number };
const INDEX = 'ask:index';
const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: not saved */ } },
};
const convId = new URLSearchParams(location.search).get('c') ?? crypto.randomUUID();
const saved = store.get<{ messages: unknown[] }>(`ask:conv:${convId}`);

const agent = new AgentClient({ agent: 'AskAgent', name: convId, host: window.location.host });
const chat = useChat({ transport: new WebSocketChatTransport({ agent, cancelOnClientAbort: true }), messages: (saved?.messages ?? []) as never[] });
onBeforeUnmount(() => agent.close());

function persist() {
  const msgs = chat.messages.value;
  if (!msgs.length) return;
  const first = msgs.find((m) => m.role === 'user');
  const title = (first?.parts.find((p) => p.type === 'text') as { text?: string } | undefined)?.text?.slice(0, 80) ?? '…';
  store.set(`ask:conv:${convId}`, { messages: msgs });
  const index = (store.get<Saved[]>(INDEX) ?? []).filter((s) => s.id !== convId);
  index.unshift({ id: convId, title, lectureId: props.lectureId ?? null, updated: Date.now() });
  store.set(INDEX, index.slice(0, 30));
  window.dispatchEvent(new Event('ask-history'));
}
watch(() => chat.status.value, (s) => s === 'ready' && persist());

// A turn can be lost when the socket drops mid-answer (a deploy restarts the Durable Object, the network blips):
// the transport cannot resume it, so after 30 s with nothing new the turn is stopped and a retry is offered.
const STALL_MS = 30_000;
const stalled = ref(false);
let lastActivity = Date.now();
watch(() => JSON.stringify(chat.messages.value.at(-1)?.parts.length ?? 0) + chat.status.value + (answerTextOf(chat.messages.value.at(-1)) ?? '').length, () => (lastActivity = Date.now()));
const watchdog = setInterval(() => {
  if (busy.value && Date.now() - lastActivity > STALL_MS) {
    chat.stop();
    stalled.value = true;
  }
}, 2000);
onBeforeUnmount(() => clearInterval(watchdog));
function answerTextOf(m: { parts: unknown[] } | undefined) {
  return m?.parts.filter((p) => (p as { type: string }).type === 'text').map((p) => (p as { text?: string }).text ?? '').join('');
}
function retry() {
  stalled.value = false;
  chat.regenerate();
}

const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const busy = computed(() => chat.status.value === 'submitted' || chat.status.value === 'streaming');

function send(text?: string) {
  const q = (text ?? input.value).trim();
  if (!q || busy.value) return;
  stalled.value = false;
  input.value = '';
  const url = new URL(location.href);
  if (url.searchParams.get('c') !== convId) {
    url.searchParams.set('c', convId);
    history.replaceState(null, '', url);
  }
  chat.sendMessage({ text: q }, { body: { lang: props.lang, lectureId: props.lectureId ?? undefined } });
}

type Part = { type: string; text?: string; data?: unknown; id?: string; state?: string; output?: unknown; input?: unknown };
type Source = { id: string; label: string; href: string | null; kind: 'quran' | 'hadith' | 'lecture' | 'web' };

/** Everything the tools returned in a message: the citation whitelist and the "sources consulted" list. */
function sourcesOf(parts: Part[]) {
  const map = new Map<string, Source>();
  for (const p of parts) {
    if (!p.type.startsWith('tool-') || p.state !== 'output-available' || !Array.isArray(p.output)) continue;
    for (const o of p.output as Record<string, unknown>[]) {
      const id = String(o.id ?? '');
      if (!id || map.has(id)) continue;
      if (id.startsWith('web:')) map.set(id, { id, label: String(o.site ?? o.title ?? id), href: String(o.url ?? ''), kind: 'web' });
      else if (id.startsWith('lecture:')) map.set(id, { id, label: clock(Number(o.start ?? 0)), href: null, kind: 'lecture' });
      else map.set(id, { id, label: String(o.reference ?? id), href: `${base}/${id}`, kind: id.startsWith('quran:') ? 'quran' : 'hadith' });
      // Every source opens in a new tab, so the answer stays where it is.
    }
  }
  const final = parts.find((p) => p.type === 'data-citations')?.data as { ids: string[] } | undefined;
  return { map, valid: final ? new Set(final.ids) : null };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Markdown with our tags turned into placeholders the enhancer fills in. */
function render(text: string) {
  const withTags = text
    .replace(/<(quran|hadith)\s+key="([^"]+)"\s*\/?>(?:<\/\1>)?/g, (_, kind, key) => `\n\n<div class="scripture-ref" data-key="${kind === 'quran' && !key.startsWith('quran:') ? `quran:${key}` : key}"></div>\n\n`)
    .replace(/<cite\s+ids="([^"]+)"\s*\/?>(?:<\/cite>)?/g, (_, ids) => `<sup class="cite" data-ids="${ids}"></sup>`);
  const html = marked.parse(withTags, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-key', 'data-ids'] });
}

const refCache = new Map<string, Promise<{ reference: string; ar: { matn: string }; en?: string | null; url: string } | null>>();
const fetchRef = (key: string) => {
  if (!refCache.has(key)) refCache.set(key, fetch(`/v1/refs/${key}?lang=${props.lang}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return refCache.get(key)!;
};

/** Fill scripture blocks and citation chips inside one rendered answer. */
async function enhance(root: HTMLElement, parts: Part[]) {
  const { map, valid } = sourcesOf(parts);
  const ok = (id: string) => (valid ? valid.has(id) : map.has(id));
  let n = 0;
  const numbers = new Map<string, number>();
  for (const sup of root.querySelectorAll<HTMLElement>('sup.cite')) {
    const ids = (sup.dataset.ids ?? '').split(',').map((s) => s.trim()).filter(ok);
    sup.replaceChildren();
    sup.hidden = !ids.length;
    for (const id of ids) {
      if (!numbers.has(id)) numbers.set(id, ++n);
      const s = map.get(id);
      const el = document.createElement(s?.href ? 'a' : 'span');
      el.textContent = String(numbers.get(id));
      el.title = s?.label ?? id;
      if (s?.href) Object.assign(el as HTMLAnchorElement, { href: s.href, target: '_blank', rel: 'noopener' });
      sup.append(el);
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>('.scripture-ref')) {
    const key = box.dataset.key ?? '';
    if (box.dataset.filled === key) continue;
    if (valid && !valid.has(key)) {
      box.hidden = true; // a key no tool returned: never shown as scripture
      continue;
    }
    box.dataset.filled = key;
    const u = await fetchRef(key);
    if (!u) {
      box.hidden = true;
      continue;
    }
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = key.startsWith('quran:') ? 'scripture quran' : 'scripture';
    p.lang = 'ar';
    for (const piece of prophetic(u.ar.matn.length > 900 ? `${u.ar.matn.slice(0, 900)}…` : u.ar.matn, 'ar')) {
      if (!piece.prophetic) p.append(piece.text);
      else Object.assign(p.appendChild(document.createElement('span')), { className: 'prophetic', textContent: piece.text });
    }
    const link = document.createElement('a');
    Object.assign(link, { href: `${base}/${key}`, target: '_blank', rel: 'noopener', textContent: u.reference });
    box.append(p, link);
  }
}

const bodies = ref<Record<string, HTMLElement | null>>({});
watch(
  () => chat.messages.value.map((m) => `${m.id}:${m.parts.length}:${m.parts.map((p) => (p as Part).text?.length ?? (p as Part).state ?? '').join(',')}`).join('|'),
  () => enhanceAll(true),
);
// A conversation restored from localStorage renders once without a change, so fill it on mount too.
onMounted(() => enhanceAll(false));

async function enhanceAll(scroll: boolean) {
  await nextTick();
  for (const m of chat.messages.value) {
    const el = bodies.value[m.id];
    if (el && m.role === 'assistant') enhance(el, m.parts as Part[]);
  }
  if (scroll) scroller.value?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

const progress = (parts: Part[]) => {
  const last = [...parts].reverse().find((p) => p.type === 'data-progress')?.data as { label: string; kind: string } | undefined;
  return last ? `${a.value.doing[last.kind as 'search' | 'read' | 'web'] ?? ''} ${last.label}` : a.value.thinking;
};
const answerText = (parts: Part[]) => parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
const consulted = (parts: Part[]) => [...sourcesOf(parts).map.values()];

function reset() {
  chat.stop();
  const url = new URL(location.href);
  url.searchParams.delete('c');
  location.href = url.toString();
}
</script>

<template>
  <section class="ask">
    <header v-if="!chat.messages.value.length" class="intro">
      <h1>{{ lectureTitle ? a.lectureHeading : a.heading }}</h1>
      <p v-if="lectureTitle" class="lecture" dir="auto">{{ lectureTitle }}</p>
      <p class="lede">{{ a.intro }}</p>
    </header>

    <ol class="thread" aria-live="polite">
      <li v-for="m in chat.messages.value" :key="m.id" :class="m.role">
        <p v-if="m.role === 'user'" class="question" dir="auto">{{ answerText(m.parts as Part[]) }}</p>
        <template v-else>
          <p v-if="busy && m.id === chat.messages.value.at(-1)?.id && !answerText(m.parts as Part[])" class="progress">
            <span class="spinner" aria-hidden="true"></span>{{ progress(m.parts as Part[]) }}
          </p>
          <div :ref="(el) => (bodies[m.id] = el as HTMLElement)" class="answer" dir="auto" v-html="render(answerText(m.parts as Part[]))"></div>
          <details v-if="consulted(m.parts as Part[]).length" class="sources">
            <summary>{{ a.sources }} ({{ consulted(m.parts as Part[]).length }})</summary>
            <ul>
              <li v-for="s in consulted(m.parts as Part[])" :key="s.id">
                <a v-if="s.href" :href="s.href" target="_blank" rel="noopener">{{ s.label }}</a>
                <span v-else>{{ s.label }}</span>
                <span class="kind">{{ a.kinds[s.kind] }}</span>
              </li>
            </ul>
          </details>
        </template>
      </li>
    </ol>
    <p v-if="chat.status.value === 'submitted'" class="progress"><span class="spinner" aria-hidden="true"></span>{{ a.thinking }}</p>
    <p v-if="chat.error.value || stalled" class="error" role="alert">{{ stalled ? a.stalled : a.error }} <button type="button" class="link" @click="retry">{{ t.retry }}</button></p>
    <div ref="scroller"></div>

    <form class="composer" @submit.prevent="send()">
      <label class="sr-only" for="ask-input">{{ a.placeholder }}</label>
      <textarea id="ask-input" v-model="input" :placeholder="a.placeholder" rows="1" dir="auto" @keydown.enter.exact.prevent="send()" />
      <button v-if="busy" type="button" class="secondary" @click="chat.stop()">{{ a.stop }}</button>
      <button v-else type="submit" :disabled="!input.trim()">{{ a.send }}</button>
    </form>
    <div class="chips">
      <template v-if="!chat.messages.value.length">
        <button v-for="e in (lectureTitle ? a.lectureExamples : a.examples)" :key="e" type="button" @click="send(e)">{{ e }}</button>
      </template>
      <button v-else type="button" @click="reset">{{ a.newChat }}</button>
    </div>
    <p class="note">{{ a.note }}</p>
  </section>
</template>

<style scoped>
.ask { max-width: 780px; margin: 0 auto; padding-top: 24px; display: flex; flex-direction: column; min-height: calc(100dvh - 120px); }
.intro { text-align: center; padding-top: clamp(24px, 12vh, 140px); }
h1 { font-size: clamp(1.6rem, 3.2vw, 2.2rem); font-weight: 500; margin: 0 0 8px; letter-spacing: -0.015em; }
.lecture { margin: 0 0 6px; font-weight: 500; }
.lede { color: var(--muted); margin: 0 auto 24px; max-width: 580px; }
.thread { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; flex: 1; }
.question { margin: 0; align-self: flex-end; background: var(--surface-2); border-radius: var(--r-card); padding: 10px 16px; max-width: 85%; margin-inline-start: auto; width: fit-content; }
.user { display: flex; }
.answer { line-height: 1.7; overflow-wrap: anywhere; }
.answer :deep(h3) { font-size: 1.05rem; font-weight: 600; margin: 18px 0 6px; }
.answer :deep(p) { margin: 0 0 12px; }
.answer :deep(ul), .answer :deep(ol) { padding-inline-start: 22px; margin: 0 0 12px; }
.answer :deep(.scripture-ref) { border: 1px solid var(--line); border-radius: var(--r-card); padding: 12px 16px; margin: 14px 0; background: var(--surface); }
.answer :deep(.scripture-ref:empty) { min-height: 64px; }
.answer :deep(.scripture-ref a) { color: var(--muted); font-size: 0.9rem; text-underline-offset: 3px; }
.answer :deep(.scripture-ref .scripture) { margin: 0 0 4px; }
.answer :deep(sup.cite) { font-size: 0.72rem; margin-inline-start: 2px; }
.answer :deep(sup.cite a), .answer :deep(sup.cite span) { display: inline-block; min-width: 1.4em; padding: 0 4px; margin-inline-end: 2px; text-align: center; border: 1px solid var(--line); border-radius: 6px; text-decoration: none; color: var(--muted); }
.answer :deep(sup.cite a:hover) { color: var(--text); border-color: var(--muted); }
.progress { color: var(--muted); display: flex; gap: 10px; align-items: center; margin: 0 0 8px; }
.error { color: var(--warn); }
.link { background: none; border: 0; text-decoration: underline; cursor: pointer; padding: 6px; color: inherit; }
.sources { margin-top: 6px; }
.sources summary { color: var(--muted); cursor: pointer; padding: 6px 0; min-height: 36px; font-size: 0.92rem; }
.sources ul { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 4px; }
.sources li { display: flex; gap: 10px; align-items: baseline; font-size: 0.94rem; }
.kind { color: var(--subtle); font-size: 0.85rem; }
.composer { position: sticky; bottom: 12px; margin-top: 24px; display: flex; align-items: flex-end; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-input); padding: 8px; padding-inline-start: 22px; }
.composer:focus-within { border-color: var(--muted); }
textarea { flex: 1; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 1.05rem; resize: none; padding: 10px 0; min-height: 44px; max-height: 30vh; field-sizing: content; }
textarea:focus { outline: none; }
textarea::placeholder { color: var(--subtle); }
.composer button { border: 0; border-radius: 22px; background: var(--invert-bg); color: var(--invert-text); font-weight: 500; padding: 0 20px; min-height: 44px; cursor: pointer; }
.composer button:disabled { opacity: 0.45; cursor: default; }
.composer .secondary { background: transparent; color: var(--text); border: 1px solid var(--line); }
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 14px; }
.chips button { border: 1px solid var(--line); background: transparent; border-radius: 20px; padding: 8px 16px; min-height: 40px; cursor: pointer; color: var(--text); }
.chips button:hover { background: var(--surface-2); }
.note { color: var(--subtle); font-size: 0.85rem; text-align: center; margin: 14px 0 0; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
