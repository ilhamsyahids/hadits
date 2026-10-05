<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import VerdictCard, { type Verdict } from './VerdictCard.vue';

// Lecture report: GET /v1/lectures/:id/report (cached after the first run) → timeline + one stack per dalil.

type Group = { key: string; reference: string; kind: string; refs: number[]; statuses: string[]; count: number };
type Report = { refs: Verdict[]; groups: Group[]; summary: Record<string, number> };
type Filter = 'all' | 'attention' | 'quran' | 'hadith';

const props = defineProps<{ id: string; duration: number; t: Strings; lang: 'en' | 'ar' }>();
const state = ref<'loading' | 'done' | 'error'>('loading');
const report = ref<Report | null>(null);
const filter = ref<Filter>('all');

// Most serious first: a stack leads with the occurrence that needs the reader's attention.
const SEVERITY: Record<string, number> = { misquote: 0, not_found_in_corpus: 1, weak_or_disputed: 2, paraphrase: 3, reference: 4, verbatim: 5 };
const attention = (r: Verdict) => ['misquote', 'weak_or_disputed', 'not_found_in_corpus'].includes(r.status) || r.citation?.agrees === false;
const tone = (s: string) => ({ verbatim: 'ok', paraphrase: 'ok', reference: 'ok', misquote: 'warn', weak_or_disputed: 'warn' })[s] ?? 'none';
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function load() {
  state.value = 'loading';
  try {
    const res = await fetch(`/v1/lectures/${props.id}/report?lang=${props.lang}`);
    if (!res.ok) throw new Error(String(res.status));
    report.value = await res.json();
    state.value = 'done';
  } catch {
    state.value = 'error';
  }
}
onMounted(load);

type Stack = { id: string; lead: Verdict; others: Verdict[]; heading?: string; start: number };
const stacks = computed<Stack[]>(() => {
  if (!report.value) return [];
  const byId = new Map(report.value.refs.map((r) => [r.id, r]));
  const grouped = new Set<number>();
  const out: Stack[] = report.value.groups.map((g, i) => {
    const members = g.refs.map((id) => byId.get(id)!).filter(Boolean);
    members.forEach((m) => grouped.add(m.id));
    const lead = [...members].sort((a, b) => (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9) || a.start - b.start)[0];
    return { id: `g${i}`, lead, others: members.filter((m) => m !== lead).sort((a, b) => a.start - b.start), start: Math.min(...members.map((m) => m.start)) };
  });
  for (const r of report.value.refs) if (!grouped.has(r.id)) out.push({ id: `r${r.id}`, lead: r, others: [], start: r.start });
  return out.sort((a, b) => a.start - b.start);
});

const visible = computed(() =>
  stacks.value.filter((s) => {
    const all = [s.lead, ...s.others];
    if (filter.value === 'attention') return all.some(attention);
    if (filter.value === 'quran') return s.lead.match?.kind === 'quran';
    if (filter.value === 'hadith') return s.lead.match?.kind === 'hadith' || (!s.lead.match && s.lead.status !== 'reference');
    return true;
  }),
);
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of report.value?.refs ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});
const stackOf = (refId: number) => stacks.value.find((s) => s.lead.id === refId || s.others.some((o) => o.id === refId));

function jump(refId: number) {
  const s = stackOf(refId);
  if (!s) return;
  filter.value = 'all';
  // After the filter re-renders: move focus to the stack (keyboard users land on it), then bring it into view.
  nextTick(() => {
    const el = document.getElementById(s.id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}
const filters = computed<{ id: Filter; label: string }[]>(() => [
  { id: 'all', label: props.t.report.filterAll },
  { id: 'attention', label: props.t.report.filterAttention },
  { id: 'quran', label: props.t.report.filterQuran },
  { id: 'hadith', label: props.t.report.filterHadith },
]);
</script>

<template>
  <div v-if="state === 'loading'" class="state" role="status"><span class="spinner" aria-hidden="true"></span>{{ t.report.loading }}</div>
  <div v-else-if="state === 'error'" class="state error" role="alert">
    {{ t.report.error }}
    <button type="button" class="retry" @click="load">{{ t.retry }}</button>
  </div>
  <p v-else-if="!report?.refs.length" class="state">{{ t.report.empty }}</p>

  <template v-else>
    <section class="overview">
      <p class="counts">
        <strong>{{ t.report.summary.replace('{n}', String(report!.refs.length)) }}</strong>
        <span v-for="(n, s) in counts" :key="s" :class="['count', tone(String(s))]"><span class="mark" aria-hidden="true"></span>{{ t.status[s] ?? s }} {{ n }}</span>
      </p>
      <div class="timeline" role="group" :aria-label="t.report.timeline">
        <button
          v-for="r in report!.refs"
          :key="r.id"
          type="button"
          :class="['tick', tone(r.status)]"
          :style="{ insetInlineStart: `${Math.min(99, (r.start / Math.max(1, duration)) * 100)}%` }"
          :aria-label="`${clock(r.start)} ${t.status[r.status]} ${r.match?.reference ?? ''}`"
          :title="`${clock(r.start)} · ${r.match?.reference ?? t.status[r.status]}`"
          @click="jump(r.id)"
        ></button>
      </div>
      <p class="axis"><span>0:00</span><span>{{ clock(duration) }}</span></p>
      <div class="filters" role="group">
        <button v-for="f in filters" :key="f.id" type="button" :aria-pressed="filter === f.id" @click="filter = f.id">{{ f.label }}</button>
      </div>
    </section>

    <p v-if="!visible.length" class="state">{{ t.report.noneInFilter }}</p>
    <section v-for="s in visible" :id="s.id" :key="s.id" class="stack" tabindex="-1">
      <p class="when">
        <span class="time">{{ clock(s.lead.start) }}</span>
        <span v-if="s.others.length" class="times">{{ t.report.quoted }} {{ s.others.length + 1 }} {{ t.report.times }}</span>
      </p>
      <VerdictCard :v="s.lead" :t="t" :lang="lang" />
      <details v-if="s.others.length" class="others">
        <summary>{{ t.report.otherTimes }} {{ s.others.map((o) => clock(o.start)).join(', ') }}</summary>
        <ul>
          <li v-for="o in s.others" :key="o.id">
            <span class="time">{{ clock(o.start) }}</span>
            <span :class="['state-word', tone(o.status)]">{{ t.status[o.status] }}</span>
            <span class="spoken" dir="auto">{{ o.spoken }}</span>
          </li>
        </ul>
      </details>
    </section>
  </template>
</template>

<style scoped>
.state { color: var(--muted); display: flex; align-items: center; gap: 10px; padding: 32px 0; margin: 0; flex-wrap: wrap; }
.error { color: var(--warn); }
.retry { border: 1px solid var(--line); background: transparent; border-radius: var(--r-small); padding: 6px 14px; min-height: 40px; cursor: pointer; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.overview { position: sticky; top: 0; z-index: 2; background: var(--panel); padding: 12px 0 14px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.counts { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin: 0 0 14px; }
.count { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 0.95rem; }
.mark { width: 9px; height: 9px; border-radius: 2px; background: var(--none); }
.ok .mark, .tick.ok { background: var(--ok); } .warn .mark, .tick.warn { background: var(--warn); }
.timeline { position: relative; height: 28px; border-radius: var(--r-small); background: var(--surface); border: 1px solid var(--line); }
/* Centred on its time with a logical margin, so it works in both directions without a dir selector. */
.tick { position: absolute; top: 4px; width: 6px; height: 18px; margin-inline-start: -3px; border-radius: 2px; border: 0; padding: 0; background: var(--none); cursor: pointer; }
.tick:hover { outline: 2px solid var(--text); outline-offset: 1px; }
.tick::after { content: ''; position: absolute; inset: -8px -6px; }
.axis { display: flex; justify-content: space-between; color: var(--subtle); font-size: 0.8rem; margin: 4px 0 12px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.filters button { border: 1px solid var(--line); background: transparent; border-radius: 20px; padding: 6px 14px; min-height: 40px; cursor: pointer; color: var(--text); }
.filters button[aria-pressed='true'] { background: var(--invert-bg); color: var(--invert-text); border-color: var(--invert-bg); }
.stack { margin: 22px 0; outline: none; scroll-margin-top: 190px; }
.stack:focus-visible { outline: 2px solid var(--focus); outline-offset: 6px; border-radius: var(--r-card); }
.when { display: flex; gap: 12px; align-items: baseline; margin: 0 0 8px; color: var(--muted); font-size: 0.92rem; }
.time { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 500; }
.others { margin-top: 8px; padding: 0 4px; }
.others summary { cursor: pointer; color: var(--muted); padding: 8px 0; min-height: 40px; }
.others ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.others li { display: grid; grid-template-columns: auto auto 1fr; gap: 12px; align-items: baseline; }
.state-word { font-size: 0.9rem; } .state-word.ok { color: var(--ok); } .state-word.warn { color: var(--warn); } .state-word.none { color: var(--none); }
.spoken { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
/* On a phone the overview would cover half the screen if it stuck, so it scrolls away. */
@media (max-width: 720px) { .overview { position: static; } .others li { grid-template-columns: auto 1fr; } .spoken { grid-column: 1 / -1; } .stack { scroll-margin-top: 16px; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
