<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Strings } from '../i18n/strings';

// Cek Dalil: one quote or citation → POST /v1/verify { text } → verdict cards.
// The Arabic shown under "Source" always comes from the API (the database), never from the browser.

type Grade = { grader: string; grade: string; conflict: boolean };
type Ref = {
  id: number;
  status: string;
  spoken: string;
  reason?: string;
  match?: { key: string; reference: string; url: string; ar: { matn: string }; en?: string | null; range?: string[] };
  grades?: Grade[];
  grade_summary?: { status: string; note?: string };
  family?: { key: string; collection_name: string; number: string }[];
  near?: { key: string; reference: string; similarity: number }[];
  citation?: { said: string; agrees: boolean | null };
};

const props = defineProps<{ t: Strings; lang: 'en' | 'ar' }>();
const text = ref('');
const loading = ref(false);
const error = ref('');
const refs = ref<Ref[] | null>(null);

const examples = ['إنما الأعمال بالنيات', 'أفضل الناس كل مخموم القلب صدوق اللسان', 'حب الوطن من الإيمان', 'QS 2:255'];

async function check(input?: string) {
  if (input) text.value = input;
  if (!text.value.trim()) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.value.trim(), lang: props.lang }),
    });
    if (!res.ok) throw new Error(String(res.status));
    refs.value = ((await res.json()) as { refs: Ref[] }).refs;
  } catch {
    error.value = props.t.error;
    refs.value = null;
  } finally {
    loading.value = false;
  }
}

const tone = (s: string) =>
  ({ verbatim: 'ok', paraphrase: 'ok-outline', reference: 'ok-outline', misquote: 'warn', weak_or_disputed: 'warn', not_found_in_corpus: 'grey' })[s] ?? 'grey';
const empty = computed(() => refs.value !== null && refs.value.length === 0);
</script>

<template>
  <form class="ask" @submit.prevent="check()">
    <textarea v-model="text" :placeholder="t.placeholder" rows="3" dir="auto" @keydown.enter.exact.prevent="check()" />
    <button type="submit" :disabled="loading || !text.trim()">{{ loading ? t.checking : t.check }}</button>
  </form>
  <p class="examples">
    {{ t.examples }}:
    <button v-for="e in examples" :key="e" type="button" class="chip" dir="auto" @click="check(e)">{{ e }}</button>
  </p>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="empty" class="muted">{{ t.noQuote }}</p>

  <article v-for="r in refs ?? []" :key="r.id" class="card" :class="tone(r.status)">
    <header>
      <span class="badge">{{ t.status[r.status] ?? r.status }}</span>
      <span v-if="r.match" class="ref">{{ r.match.reference }}</span>
    </header>

    <dl>
      <dt>{{ t.spoken }}</dt>
      <dd lang="ar" dir="rtl">{{ r.spoken }}</dd>
      <template v-if="r.match">
        <dt>{{ t.source }}</dt>
        <dd lang="ar" dir="rtl">{{ r.match.ar.matn }}</dd>
        <dd v-if="r.match.en" class="en" dir="ltr" lang="en">{{ r.match.en }}</dd>
      </template>
    </dl>

    <p v-if="r.reason" class="reason">{{ r.reason }}</p>
    <p v-if="r.citation && r.citation.agrees === false" class="reason warn-text">{{ t.citationMismatch }} ({{ r.citation.said }})</p>
    <p v-if="r.status === 'not_found_in_corpus'" class="reason">{{ t.notFoundNote }}</p>

    <section v-if="r.match && r.match.key.startsWith('quran:') === false">
      <h3>{{ t.grades }}</h3>
      <ul v-if="r.grades?.length" class="grades">
        <li v-for="g in r.grades" :key="g.grader + g.grade">
          <strong>{{ g.grader }}</strong>: {{ g.grade }}<span v-if="g.conflict" class="warn-text"> ⚠</span>
        </li>
      </ul>
      <p v-else class="muted">{{ r.grade_summary?.note ?? t.noGrade }}</p>
    </section>

    <section v-if="r.family?.length">
      <h3>{{ t.variants }}</h3>
      <p class="muted">
        <a v-for="f in r.family.slice(0, 6)" :key="f.key" :href="`/v1/refs/${f.key}?lang=${lang}`" class="variant">{{ f.collection_name }} {{ f.number }}</a>
      </p>
    </section>

    <section v-if="r.status === 'not_found_in_corpus' && r.near?.length">
      <h3>{{ t.closest }}</h3>
      <p class="muted">
        <a v-for="n in r.near" :key="n.key" :href="`/v1/refs/${n.key}?lang=${lang}`" class="variant">{{ n.reference }}</a>
      </p>
    </section>

    <footer v-if="r.match">
      <a :href="r.match.url" target="_blank" rel="noopener">{{ t.openSource }} ↗</a>
    </footer>
  </article>
</template>

<style scoped>
.ask { display: flex; flex-direction: column; gap: 8px; }
textarea {
  width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface);
  color: var(--text); font: inherit; font-size: 1.05rem; resize: vertical;
}
textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button[type='submit'] {
  align-self: flex-start; padding: 10px 20px; border: 0; border-radius: 8px; background: var(--accent); color: #fff;
  font: inherit; font-weight: 600; cursor: pointer; min-height: 44px;
}
button[disabled] { opacity: 0.55; cursor: default; }
.examples { color: var(--muted); font-size: 0.9rem; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 12px 0 24px; }
.chip { border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 999px; padding: 4px 12px; font: inherit; cursor: pointer; min-height: 32px; }
.error { color: var(--bad); }
.muted { color: var(--muted); }
.card { border: 1px solid var(--line); border-inline-start: 4px solid var(--grey); background: var(--surface); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.card.ok { border-inline-start-color: var(--ok); }
.card.ok-outline { border-inline-start-color: var(--ok); border-inline-start-style: dashed; }
.card.warn { border-inline-start-color: var(--warn); }
.card header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
.badge { font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
.ok .badge, .ok-outline .badge { color: var(--ok); }
.warn .badge { color: var(--warn); }
.grey .badge { color: var(--grey); }
.ref { color: var(--muted); }
dl { margin: 0; }
dt { font-size: 0.8rem; color: var(--muted); margin-top: 8px; }
dd { margin: 0; overflow-wrap: anywhere; }
dd[lang='ar'] { font-family: var(--ar-font); font-size: 1.3rem; line-height: 1.9; }
.en { color: var(--muted); font-size: 0.95rem; }
.reason { margin: 10px 0 0; }
.warn-text { color: var(--warn); }
h3 { font-size: 0.8rem; color: var(--muted); font-weight: 600; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.grades { margin: 0; padding-inline-start: 18px; }
.variant { margin-inline-end: 12px; }
footer { margin-top: 12px; }
</style>
