<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { termPieces } from '../lib/glossary';

// The text in another language (GET /v1/lectures/:id/translation). The model translates the speaker's words only:
// verses and hadith quoted word for word come back in their published translation, with the reference; paraphrases
// and misquotes stay as they were said, marked with their finding.
type Quote = { key: string | null; reference: string | null; status: string; text: string; lang: string; translated: boolean };
type Piece = { text: string } | { quote: Quote };
const props = defineProps<{ id: string; textLang: string; t: Strings; lang: 'en' | 'ar' }>();
const r = computed(() => props.t.report);
const base = props.lang === 'ar' ? '/ar' : '';
const targets = computed(() => (['en', 'ar', 'id'] as const).filter((l) => l !== props.textLang));
const to = ref<'en' | 'ar' | 'id' | null>(null);
const state = ref<'idle' | 'loading' | 'done' | 'error'>('idle');
const paragraphs = ref<Piece[][]>([]);

async function load(l: 'en' | 'ar' | 'id') {
  to.value = l;
  state.value = 'loading';
  try {
    const res = await fetch(`/v1/lectures/${props.id}/translation?to=${l}`);
    if (!res.ok) throw new Error(String(res.status));
    paragraphs.value = ((await res.json()) as { paragraphs: Piece[][] }).paragraphs;
    state.value = 'done';
  } catch {
    state.value = 'error';
  }
}
const tone = (s: string) => (['verbatim', 'paraphrase', 'reference'].includes(s) ? 'ok' : ['misquote', 'weak_or_disputed'].includes(s) ? 'warn' : 'none');
// Glossary terms in a Latin-script translation, each tagged where it first appears.
type Shown = { quote: Quote } | { parts: ReturnType<typeof termPieces> };
const shown = computed<Shown[][]>(() => {
  const seen = new Set<string>();
  return paragraphs.value.map((p) => p.map((x) => ('quote' in x ? x : { parts: to.value === 'ar' ? [{ text: x.text }] : termPieces(x.text, seen) })));
});
</script>

<template>
  <section class="translation">
    <div class="pick" role="group" :aria-label="r.translateTo">
      <span class="label">{{ r.translateTo }}</span>
      <button v-for="l in targets" :key="l" type="button" :aria-pressed="to === l" :disabled="state === 'loading'" @click="load(l)">{{ t.lectures.langName[l] }}</button>
    </div>
    <p class="intro">{{ r.translationNote }}</p>
    <p v-if="state === 'loading'" class="status" role="status"><span class="spinner" aria-hidden="true"></span>{{ r.translating }}</p>
    <p v-else-if="state === 'error'" class="status error" role="alert">{{ r.translationError }} <button type="button" class="retry" @click="to && load(to)">{{ t.retry }}</button></p>
    <div v-else-if="state === 'done'" class="text" :dir="to === 'ar' ? 'rtl' : 'ltr'" :lang="to ?? undefined">
      <p v-for="(p, i) in shown" :key="i" class="para">
        <span class="pn">{{ i + 1 }}</span>
        <span class="ptext">
          <template v-for="(x, k) in p" :key="k">
            <template v-if="'quote' in x && x.quote.status === 'reference'">
              <a v-if="x.quote.key" class="tref" :href="`${base}/${x.quote.key}`" target="_blank" rel="noopener">{{ x.quote.reference }}</a>
              <template v-else>{{ x.quote.text }}</template>
            </template>
            <template v-else-if="'quote' in x">
              <span :class="['tq', tone(x.quote.status), { said: !x.quote.translated }]" :lang="x.quote.lang === 'ar' ? 'ar' : undefined" dir="auto">{{ x.quote.text }}</span>
              <a v-if="x.quote.key" class="tref" :href="`${base}/${x.quote.key}`" target="_blank" rel="noopener">{{ x.quote.reference }}</a>
              <span v-if="!x.quote.translated" class="tnote">({{ r.asSaid }}: {{ t.status[x.quote.status] ?? x.quote.status }})</span>
            </template>
            <template v-else><template v-for="(y, j) in x.parts" :key="j"><button v-if="y.term" type="button" class="term" :data-term="y.term.id">{{ y.text }}</button><template v-else>{{ y.text }}</template></template></template>
          </template>
        </span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.translation { padding: 8px 0 40px; }
.pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 10px; }
.label { color: var(--muted); font-size: 0.9rem; margin-inline-end: 4px; }
.pick button { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: 20px; padding: 6px 14px; min-height: 40px; cursor: pointer; font: inherit; }
.pick button:disabled { opacity: 0.5; cursor: progress; }
.pick button[aria-pressed='true'] { background: var(--invert-bg); color: var(--invert-text); border-color: var(--invert-bg); }
.intro { color: var(--muted); font-size: 0.92rem; margin: 0 0 18px; max-width: 70ch; }
.status { color: var(--muted); display: flex; gap: 10px; align-items: center; }
.error { color: var(--warn); }
.retry { border: 1px solid var(--line); background: transparent; border-radius: var(--r-small); padding: 6px 12px; cursor: pointer; color: inherit; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.para { display: grid; grid-template-columns: 2.6em 1fr; gap: 8px; margin: 0 0 14px; line-height: 1.75; }
.pn { color: var(--subtle); font-size: 0.82rem; padding-top: 0.3em; text-align: end; }
.text[dir='rtl'] .ptext { font-size: 1.08rem; }
/* A verse or hadith: published translation (green edge), or the speaker's own words kept as said (amber or grey). */
.tq { padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, var(--ok) 14%, transparent); }
.tq.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); }
.tq.none { background: color-mix(in srgb, var(--none) 18%, transparent); }
.tq[lang='ar'] { font-family: var(--scripture); font-size: 1.12em; }
.tref { margin-inline-start: 6px; font-size: 0.86rem; color: var(--muted); text-underline-offset: 3px; white-space: nowrap; }
.tnote { margin-inline-start: 4px; font-size: 0.82rem; color: var(--subtle); }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
