<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { looksLikeDocument, submitText } from '../lib/documents';
import VerdictCard, { type Verdict } from './VerdictCard.vue';

// Cek Dalil: one quote, reference or remembered meaning → POST /v1/verify { text } → verdict cards.
// A whole lecture or article pasted here is saved as a text (POST /v1/documents) and opened as a full report.
// A checked quote is kept in the address (?q=…), so the result can be shared and reopened.

const props = defineProps<{ t: Strings; lang: 'en' | 'ar' }>();
const text = ref('');
const state = ref<'idle' | 'loading' | 'done' | 'error'>('idle');
const refs = ref<Verdict[]>([]);
const results = ref<HTMLElement | null>(null);
const whole = computed(() => looksLikeDocument(text.value));
const docError = ref<string | null>(null);
const base = props.lang === 'ar' ? '/ar' : '';

const examples = computed(() => [
  { label: props.t.exampleLabels.niyyah, text: 'إنما الأعمال بالنيات' },
  { label: props.t.exampleLabels.makhmum, text: 'أفضل الناس كل مخموم القلب صدوق اللسان' },
  { label: props.t.exampleLabels.watan, text: 'حب الوطن من الإيمان' },
  { label: props.t.exampleLabels.kursi, text: 'QS 2:255' },
]);

async function check(input?: string) {
  if (input) text.value = input;
  const q = text.value.trim();
  if (!q || state.value === 'loading') return;
  state.value = 'loading';
  docError.value = null;
  if (looksLikeDocument(q)) {
    const res = await submitText(q);
    if ('id' in res) return void (location.href = `${base}/lectures/${res.id}`);
    docError.value = props.t.submit.errors[res.error];
    state.value = 'error';
    return;
  }
  try {
    const res = await fetch('/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q, lang: props.lang }) });
    if (!res.ok) throw new Error(String(res.status));
    refs.value = ((await res.json()) as { refs: Verdict[] }).refs;
    state.value = 'done';
    history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ q })}`);
    await nextTick();
    results.value?.focus();
  } catch {
    state.value = 'error';
  }
}
onMounted(() => {
  const q = new URLSearchParams(location.search).get('q');
  if (q) check(q);
});
</script>

<template>
  <section class="ask" :class="{ top: state !== 'idle' }">
    <h1>{{ t.tagline }}</h1>
    <p class="intro">{{ t.intro }}</p>
    <form @submit.prevent="check()">
      <label class="sr-only" for="q">{{ t.placeholder }}</label>
      <textarea id="q" v-model="text" :placeholder="t.placeholder" rows="1" dir="auto" @keydown.enter.exact.prevent="check()" />
      <button type="submit" :disabled="!text.trim() || state === 'loading'">{{ state === 'loading' ? t.checking : t.check }}</button>
    </form>
    <p v-if="whole" class="whole">{{ t.submit.longHint }}</p>
    <div class="chips" :aria-label="t.examples">
      <button v-for="e in examples" :key="e.text" type="button" @click="check(e.text)">{{ e.label }}</button>
    </div>
    <p class="more"><a :href="`${base}/lectures`">{{ t.submit.heading }}</a></p>
  </section>

  <section ref="results" class="results" tabindex="-1" aria-live="polite">
    <p v-if="state === 'loading'" class="status-line"><span class="spinner" aria-hidden="true"></span>{{ t.checking }}</p>
    <div v-else-if="state === 'error'" class="status-line error">
      <span>{{ docError ?? t.error }}</span>
      <button type="button" class="retry" @click="check()">{{ t.retry }}</button>
    </div>
    <p v-else-if="state === 'done' && !refs.length" class="status-line">{{ t.noQuote }}</p>
    <template v-else-if="state === 'done'">
      <p class="share-row">
        <button type="button" class="share-btn" data-share :data-title="text.slice(0, 80)" :data-copied="t.share.copied">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{{ t.share.label }}</span>
        </button>
      </p>
      <VerdictCard v-for="r in refs" :key="r.id" :v="r" :t="t" :lang="lang" />
    </template>
  </section>
</template>

<style scoped>
.ask { max-width: 760px; margin: 0 auto; padding-top: clamp(40px, 18vh, 200px); text-align: center; transition: padding 0.2s ease; }
.ask.top { padding-top: 24px; }
h1 { font-size: clamp(1.7rem, 3.4vw, 2.3rem); font-weight: 500; letter-spacing: -0.015em; margin: 0 0 10px; }
.intro { color: var(--muted); margin: 0 auto 28px; max-width: 600px; }
form { display: flex; align-items: flex-end; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-input); padding: 8px; padding-inline-start: 22px; text-align: start; }
form:focus-within { border-color: var(--muted); }
textarea { flex: 1; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 1.1rem; resize: none; padding: 10px 0; min-height: 44px; max-height: 40vh; field-sizing: content; }
textarea:focus { outline: none; }
textarea::placeholder { color: var(--subtle); }
button[type='submit'] { border: 0; border-radius: 22px; background: var(--invert-bg); color: var(--invert-text); font-weight: 500; padding: 0 20px; min-height: 44px; cursor: pointer; }
button[type='submit']:disabled { opacity: 0.45; cursor: default; }
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 18px; }
.chips button { border: 1px solid var(--line); background: transparent; border-radius: 20px; padding: 8px 16px; min-height: 40px; cursor: pointer; color: var(--text); }
.chips button:hover { background: var(--surface-2); }
.results { max-width: 900px; margin: 32px auto 0; display: flex; flex-direction: column; gap: 16px; outline: none; }
.status-line { color: var(--muted); display: flex; align-items: center; gap: 10px; justify-content: center; margin: 0; }
.error { color: var(--warn); }
.retry { border: 1px solid var(--line); background: transparent; border-radius: var(--r-small); padding: 6px 14px; min-height: 40px; cursor: pointer; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; }
.share-row { display: flex; justify-content: flex-end; margin: 0; }
.whole { color: var(--muted); margin: 10px 0 0; font-size: 0.93rem; }
.more { margin: 18px 0 0; font-size: 0.93rem; }
.more a { color: var(--muted); text-underline-offset: 3px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .ask { transition: none; } }
</style>
