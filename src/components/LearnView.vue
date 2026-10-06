<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import type { Verdict } from './VerdictCard.vue';

// Learn from a lecture or article:
//   - dalil cards from the report's checked findings (front: what was said; back: the source, status and grade),
//     reviewed on a Leitner schedule kept in this browser;
//   - a quiz (GET /v1/lectures/:id/quiz): content questions point at the paragraph that answers them.
const props = defineProps<{ id: string; refs: Verdict[]; t: Strings; lang: 'en' | 'ar' }>();
const l = computed(() => props.t.learn);
const base = props.lang === 'ar' ? '/ar' : '';
const showParagraph = (i: number) => window.dispatchEvent(new CustomEvent('show-paragraph', { detail: i }));

// ── Dalil cards ───────────────────────────────────────────────────────────────────────────────
const cards = computed(() => [...new Map(props.refs.filter((r) => r.match && r.status !== 'not_found_in_corpus').map((r) => [r.match!.key, r])).values()]);
type Box = { box: number; due: number };
const DAY = 86_400_000;
const INTERVAL = [0, 0, DAY, 3 * DAY, 7 * DAY, 16 * DAY]; // box 1 again today … box 5 in 16 days
const storeKey = `learn:cards:${props.id}`;
const boxes = ref<Record<string, Box>>((() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? '{}'); } catch { return {}; } })());
const save = () => { try { localStorage.setItem(storeKey, JSON.stringify(boxes.value)); } catch { /* not kept */ } };
const due = computed(() => cards.value.filter((c) => (boxes.value[c.match!.key]?.due ?? 0) <= Date.now()));
const current = computed(() => due.value[0] ?? null);
const flipped = ref(false);
function grade(ok: boolean) {
  const key = current.value!.match!.key;
  const box = ok ? Math.min(5, (boxes.value[key]?.box ?? 1) + 1) : 1;
  // "Again" comes back after the other due cards; "Got it" waits for its box's interval.
  boxes.value = { ...boxes.value, [key]: { box, due: ok ? Date.now() + INTERVAL[box] : Date.now() + 1 } };
  save();
  flipped.value = false;
}
const learned = computed(() => cards.value.filter((c) => (boxes.value[c.match!.key]?.box ?? 1) >= 3).length);
const tone = (s: string) => ({ verbatim: 'ok', paraphrase: 'ok', reference: 'ok', misquote: 'warn', weak_or_disputed: 'warn' })[s] ?? 'none';

// ── Quiz ──────────────────────────────────────────────────────────────────────────────────────
type Question = { q: string; options: string[]; answer: number; paragraph: number; kind: 'content' | 'dalil'; key?: string };
const quiz = ref<Question[]>([]);
const qState = ref<'idle' | 'loading' | 'done' | 'error'>('idle');
const picked = ref<Record<number, number>>({});
async function startQuiz() {
  if (qState.value === 'loading') return;
  qState.value = 'loading';
  try {
    const res = await fetch(`/v1/lectures/${props.id}/quiz?lang=${props.lang}`);
    if (!res.ok) throw new Error(String(res.status));
    quiz.value = ((await res.json()) as { questions: Question[] }).questions;
    picked.value = {};
    qState.value = 'done';
  } catch {
    qState.value = 'error';
  }
}
const score = computed(() => Object.entries(picked.value).filter(([i, a]) => quiz.value[Number(i)]?.answer === a).length);
</script>

<template>
  <section class="learn">
    <h3>{{ l.cards }}</h3>
    <p class="intro">{{ l.cardsIntro }}</p>
    <p v-if="!cards.length" class="muted">{{ l.noCards }}</p>
    <template v-else>
      <p class="progress">{{ l.progress.replace('{learned}', String(learned)).replace('{total}', String(cards.length)).replace('{due}', String(due.length)) }}</p>
      <div v-if="current" class="card" :class="tone(current.status)">
        <p class="side-label">{{ flipped ? l.back : l.front }}</p>
        <p class="said" dir="auto" :lang="/[؀-ۿ]/.test(current.spoken) ? 'ar' : undefined">{{ current.spoken }}</p>
        <template v-if="flipped">
          <p class="ref"><a :href="`${base}/${current.match!.key}`" target="_blank" rel="noopener">{{ current.match!.reference }}</a></p>
          <p class="status"><span class="mark" aria-hidden="true"></span>{{ t.status[current.status] ?? current.status }}<template v-if="current.grade_summary?.note"> · {{ current.grade_summary.note }}</template></p>
          <p class="source scripture" lang="ar">{{ current.match!.ar.matn.length > 360 ? `${current.match!.ar.matn.slice(0, 360)}…` : current.match!.ar.matn }}</p>
          <p><button type="button" class="link" @click="showParagraph(current.segments?.[0] ?? 0)">{{ l.where.replace('{n}', String((current.segments?.[0] ?? 0) + 1)) }}</button></p>
        </template>
        <div class="actions">
          <button v-if="!flipped" type="button" class="primary" @click="flipped = true">{{ l.show }}</button>
          <template v-else>
            <button type="button" @click="grade(false)">{{ l.again }}</button>
            <button type="button" class="primary" @click="grade(true)">{{ l.good }}</button>
          </template>
        </div>
      </div>
      <p v-else class="done">{{ l.allDone }}</p>
    </template>

    <h3>{{ l.quiz }}</h3>
    <p class="intro">{{ l.quizIntro }}</p>
    <p v-if="qState === 'idle'"><button type="button" class="start" @click="startQuiz">{{ l.start }}</button></p>
    <p v-else-if="qState === 'loading'" class="muted" role="status">{{ l.making }}</p>
    <p v-else-if="qState === 'error'" class="muted" role="alert">{{ l.error }} <button type="button" class="link" @click="startQuiz">{{ t.retry }}</button></p>
    <template v-else>
      <ol class="questions">
        <li v-for="(q, i) in quiz" :key="i">
          <p class="q" dir="auto">{{ q.q }}</p>
          <div class="options">
            <button
              v-for="(o, k) in q.options"
              :key="k"
              type="button"
              dir="auto"
              :disabled="picked[i] !== undefined"
              :class="{ right: picked[i] !== undefined && k === q.answer, wrong: picked[i] === k && k !== q.answer }"
              @click="picked = { ...picked, [i]: k }"
            >{{ o }}</button>
          </div>
          <p v-if="picked[i] !== undefined" class="answer">
            {{ picked[i] === q.answer ? l.right : l.wrong }}
            <button type="button" class="link" @click="showParagraph(q.paragraph)">{{ l.where.replace('{n}', String(q.paragraph + 1)) }}</button>
            <a v-if="q.key" :href="`${base}/${q.key}`" target="_blank" rel="noopener">{{ l.openSource }}</a>
          </p>
        </li>
      </ol>
      <p class="score">{{ l.score.replace('{n}', String(score)).replace('{total}', String(quiz.length)) }}</p>
      <p class="note">{{ l.aiNote }}</p>
    </template>
  </section>
</template>

<style scoped>
.learn { padding: 8px 0 40px; max-width: 760px; }
h3 { font-size: 1.05rem; font-weight: 500; margin: 22px 0 4px; }
.intro, .muted, .progress, .note { color: var(--muted); font-size: 0.92rem; margin: 0 0 12px; }
.note { color: var(--subtle); font-size: 0.82rem; }
.card { border: 1px solid var(--line); border-radius: var(--r-card); background: var(--surface); padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
.card p { margin: 0; }
.side-label { color: var(--subtle); font-size: 0.8rem; }
.said { font-size: 1.05rem; line-height: 1.7; }
.said[lang='ar'] { font-family: var(--scripture); font-size: 1.35rem; line-height: 2; }
.ref a { font-weight: 500; text-underline-offset: 3px; }
.status { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 0.9rem; }
.source { color: var(--muted); font-size: 1.15rem; line-height: 1.9; }
.actions { display: flex; gap: 8px; margin-top: 6px; }
.actions button, .start { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: var(--r-small); padding: 0 16px; min-height: 40px; font: inherit; cursor: pointer; }
.actions .primary, .start { background: var(--invert-bg); color: var(--invert-text); border-color: var(--invert-bg); }
.done { color: var(--ok); }
.link { background: none; border: 0; color: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 4px 0; font: inherit; }
.questions { padding-inline-start: 22px; margin: 0; display: flex; flex-direction: column; gap: 18px; }
.q { margin: 0 0 8px; font-weight: 500; }
.options { display: flex; flex-direction: column; gap: 6px; }
.options button { text-align: start; border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: var(--r-small); padding: 8px 12px; min-height: 40px; font: inherit; cursor: pointer; }
.options button:disabled { cursor: default; }
.options .right { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, var(--surface)); }
.options .wrong { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, var(--surface)); }
.answer { margin: 6px 0 0; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; font-size: 0.92rem; }
.answer a { color: var(--muted); text-underline-offset: 3px; }
.score { font-weight: 500; margin: 18px 0 4px; }
</style>
