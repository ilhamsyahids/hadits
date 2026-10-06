<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { termById, type Term } from '../lib/glossary';

// One popover for every glossary term on the page (<button class="term" data-term="…">, see lib/glossary.ts):
// the curated definition at once, then what it means in this passage (AI, from /v1/explain, cached).
const props = defineProps<{ t: Strings; lang: 'en' | 'ar' }>();
const term = ref<Term | null>(null);
const pos = ref({ top: 0, left: 0 });
const ai = ref<{ state: 'loading' | 'done' | 'error'; text: string }>({ state: 'loading', text: '' });
const box = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

async function open(el: HTMLElement) {
  const t = termById(el.dataset.term ?? '');
  if (!t) return;
  opener = el;
  term.value = t;
  const r = el.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  pos.value = { top: r.bottom + window.scrollY + 8, left: Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 12)) };
  ai.value = { state: 'loading', text: '' };
  const context = (el.closest('[data-context], p, li, .para') as HTMLElement | null)?.innerText ?? el.textContent ?? '';
  try {
    const res = await fetch('/v1/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ term: t.id, context, lang: props.lang }) });
    if (!res.ok) throw new Error(String(res.status));
    if (term.value?.id === t.id) ai.value = { state: 'done', text: ((await res.json()) as { text: string }).text };
  } catch {
    if (term.value?.id === t.id) ai.value = { state: 'error', text: '' };
  }
}
function close() {
  term.value = null;
  opener?.focus({ preventScroll: true });
  opener = null;
}
const onClick = (e: MouseEvent) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
  if (el) {
    e.preventDefault();
    open(el);
  } else if (term.value && !box.value?.contains(e.target as Node)) close();
};
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && term.value && close();
onMounted(() => {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="term" ref="box" class="term-pop" role="dialog" :aria-label="term.forms[0]" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
    <p class="head"><strong>{{ term.forms[0] }}</strong> <span lang="ar" class="ar">{{ term.ar }}</span></p>
    <p class="gloss" :dir="lang === 'ar' ? 'rtl' : 'ltr'">{{ lang === 'ar' ? term.arGloss : term.en }}</p>
    <p class="label">{{ t.glossary.here }}</p>
    <p v-if="ai.state === 'loading'" class="muted">{{ t.glossary.loading }}</p>
    <p v-else-if="ai.state === 'error'" class="muted">{{ t.glossary.error }}</p>
    <p v-else class="ai" dir="auto">{{ ai.text }}</p>
    <p class="note">{{ t.glossary.aiNote }}</p>
  </div>
</template>

<style scoped>
.term-pop { position: absolute; z-index: 40; width: min(360px, calc(100vw - 24px)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); padding: 14px 16px; box-shadow: 0 8px 28px rgb(0 0 0 / 0.28); }
p { margin: 0 0 8px; }
.head { display: flex; align-items: baseline; gap: 10px; }
.ar { font-family: var(--scripture); font-size: 1.25rem; color: var(--muted); }
.gloss { line-height: 1.55; }
.label { color: var(--muted); font-size: 0.82rem; margin-top: 4px; margin-bottom: 4px; }
.ai { line-height: 1.55; }
.muted { color: var(--muted); }
.note { color: var(--subtle); font-size: 0.78rem; margin: 6px 0 0; }
</style>
