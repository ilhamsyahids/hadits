<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { termById, type Term } from '../lib/glossary';

// Two helpers for any page:
//   - the glossary popover for a tagged term (<button class="term" data-term="…">, see lib/glossary.ts): the
//     meaning at once (curated, or the model's one line for a term it found in the text), then what it means in
//     this passage (AI, /v1/explain, cached), and "Ask about this term";
//   - "Ask about this" on any text the reader selects. Both fill Ask's box without sending: the panel beside a
//     lecture report or the Ask page itself (event 'ask-prefill'), otherwise the Ask page (?q=).
const props = defineProps<{ t: Strings; lang: 'en' | 'ar' }>();
const g = props.t.glossary;
const base = props.lang === 'ar' ? '/ar' : '';
const term = ref<Term | null>(null);
const found = ref(false);
const pos = ref({ top: 0, left: 0 });
const ai = ref<{ state: 'loading' | 'done' | 'error'; text: string }>({ state: 'loading', text: '' });
const box = ref<HTMLElement | null>(null);
const pick = ref<{ text: string; top: number; left: number } | null>(null);
let opener: HTMLElement | null = null;

const place = (r: DOMRect, below = true) => {
  const vw = document.documentElement.clientWidth;
  const width = Math.min(360, window.innerWidth - 24);
  return { top: (below ? r.bottom + 8 : r.top - 46) + window.scrollY, left: Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + vw - width - 12)) };
};

async function open(el: HTMLElement) {
  const id = el.dataset.term ?? '';
  const curated = termById(id);
  const label = el.textContent?.trim() ?? '';
  const t: Term | null = curated ?? (id.startsWith('x:') ? { id, ar: '', forms: [label], en: el.dataset.gloss ?? '', arGloss: el.dataset.gloss ?? '' } : null);
  if (!t) return;
  opener = el;
  term.value = t;
  found.value = !curated;
  pick.value = null;
  pos.value = place(el.getBoundingClientRect());
  ai.value = { state: 'loading', text: '' };
  const context = (el.closest('[data-context], p, li, .para') as HTMLElement | null)?.innerText ?? el.textContent ?? '';
  try {
    const res = await fetch('/v1/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: t.id, label: t.forms[0], gloss: t.en, context, lang: props.lang }),
    });
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

/** Fill Ask's box with a question about `text`; the reader sends it. */
function ask(text: string) {
  const q = g.askPrompt.replace('{text}', text.length > 200 ? `${text.slice(0, 200)}…` : text);
  term.value = null;
  pick.value = null;
  if (document.querySelector('#ask-panel, section.ask')) window.dispatchEvent(new CustomEvent('ask-prefill', { detail: q }));
  else location.href = `${base}/ask?${new URLSearchParams({ q })}`;
}

const onClick = (e: MouseEvent) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
  if (el) {
    e.preventDefault();
    open(el);
  } else if (term.value && !box.value?.contains(e.target as Node)) close();
};
// A selection inside the page's content (not in a form field) offers "Ask about this" just above it.
const onSelect = () => {
  const sel = window.getSelection();
  const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
  const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
  if (!sel || sel.isCollapsed || text.length < 2 || text.length > 400 || !node?.closest('.panel-body, .ask-panel') || node.closest('textarea, input, button, .term-pop')) {
    pick.value = null;
    return;
  }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  pick.value = { text, ...place(r, false) };
};
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  if (term.value) close();
  pick.value = null;
};
onMounted(() => {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('mouseup', onSelect);
  document.addEventListener('keyup', onSelect);
  document.addEventListener('touchend', onSelect);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onClick);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('mouseup', onSelect);
  document.removeEventListener('keyup', onSelect);
  document.removeEventListener('touchend', onSelect);
});
</script>

<template>
  <button
    v-if="pick && !term"
    type="button"
    class="ask-pick"
    :style="{ top: `${pick.top}px`, left: `${pick.left}px` }"
    @mousedown.prevent
    @click="ask(pick.text)"
  >{{ g.askThis }}</button>

  <div v-if="term" ref="box" class="term-pop" role="dialog" :aria-label="term.forms[0]" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
    <p class="head"><strong dir="auto">{{ term.forms[0] }}</strong> <span v-if="term.ar" lang="ar" class="ar">{{ term.ar }}</span></p>
    <p class="gloss" dir="auto">{{ lang === 'ar' ? term.arGloss : term.en }}</p>
    <p v-if="found" class="note">{{ g.foundNote }}</p>
    <p class="label">{{ g.here }}</p>
    <p v-if="ai.state === 'loading'" class="muted">{{ g.loading }}</p>
    <p v-else-if="ai.state === 'error'" class="muted">{{ g.error }}</p>
    <p v-else class="ai" dir="auto">{{ ai.text }}</p>
    <p class="note">{{ g.aiNote }}</p>
    <p class="actions"><button type="button" @click="ask(term.forms[0])">{{ g.askTerm }}</button></p>
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
.note { color: var(--subtle); font-size: 0.78rem; margin: 4px 0 6px; }
.actions { margin: 8px 0 0; }
.actions button, .ask-pick { border: 1px solid var(--line); background: var(--surface-2); color: var(--text); border-radius: var(--r-small); padding: 6px 12px; min-height: 36px; font: inherit; font-size: 0.9rem; cursor: pointer; }
.actions button:hover, .ask-pick:hover { border-color: var(--muted); }
.ask-pick { position: absolute; z-index: 41; box-shadow: 0 6px 20px rgb(0 0 0 / 0.25); }
</style>
