<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { termPieces, type TermPiece } from '../lib/glossary';
import TranslationView from './TranslationView.vue';
import VerdictCard, { type Verdict } from './VerdictCard.vue';

// Lecture report: GET /v1/lectures/:id/report (cached after the first run) → overview + one stack per dalil, and
// the full text as it was checked, with each quote marked where it was found (span offsets a/b in the joined text).

type Group = { key: string; reference: string; kind: string; refs: number[]; statuses: string[]; count: number };
type Report = { refs: Verdict[]; groups: Group[]; summary: Record<string, number> };
type Filter = 'all' | 'attention' | 'quran' | 'hadith';

type Seg = { text: string; section: string | null; start: number };
const props = defineProps<{ id: string; initial?: Report | null; duration: number; timing: 'audio' | 'position'; segments: Seg[]; textLang: string; t: Strings; lang: 'en' | 'ar' }>();
const state = ref<'loading' | 'done' | 'error'>(props.initial ? 'done' : 'loading');
const report = ref<Report | null>(props.initial ?? null);
const filter = ref<Filter>('all');
const view = ref<'findings' | 'text' | 'translation'>('findings');

// Most serious first: a stack leads with the occurrence that needs the reader's attention.
const SEVERITY: Record<string, number> = { misquote: 0, not_found_in_corpus: 1, weak_or_disputed: 2, paraphrase: 3, reference: 4, verbatim: 5 };
const attention = (r: Verdict) => ['misquote', 'weak_or_disputed', 'not_found_in_corpus'].includes(r.status) || r.citation?.agrees === false;
const tone = (s: string) => ({ verbatim: 'ok', paraphrase: 'ok', reference: 'ok', misquote: 'warn', weak_or_disputed: 'warn' })[s] ?? 'none';
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Where a quote is: its time in a timed transcript, otherwise its paragraph.
const segOf = (r: Verdict) => r.segments?.[0] ?? Math.max(0, props.segments.findIndex((s) => s.start >= r.start));
const para = (i: number) => props.t.report.para.replace('{n}', String(i + 1));
const where = (r: Verdict) => (props.timing === 'audio' ? clock(r.start) : para(segOf(r)));
const place = (r: Verdict) =>
  props.timing === 'audio' ? r.start / Math.max(1, props.duration) : (segOf(r) + 0.5) / Math.max(1, props.segments.length);

// A link to a paragraph (#p12, e.g. from an Ask citation) opens the full text there.
function openHash() {
  const p = /^#p(\d+)$/.exec(location.hash);
  if (p) showInText(Number(p[1]));
}

async function load() {
  state.value = 'loading';
  try {
    const res = await fetch(`/v1/lectures/${props.id}/report?lang=${props.lang}`);
    if (!res.ok) throw new Error(String(res.status));
    report.value = await res.json();
    state.value = 'done';
    openHash();
  } catch {
    state.value = 'error';
  }
}
// The page passes the cached report when there is one; otherwise the text is checked now.
onMounted(() => (props.initial ? openHash() : load()));
// The Ask panel beside the report shows a cited passage here.
const onParagraph = (e: Event) => showInText((e as CustomEvent<number>).detail);
onMounted(() => window.addEventListener('show-paragraph', onParagraph));
onBeforeUnmount(() => window.removeEventListener('show-paragraph', onParagraph));

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
  view.value = 'findings';
  // After the filter re-renders: move focus to the stack (keyboard users land on it), then bring it into view.
  nextTick(() => {
    const el = document.getElementById(s.id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}
function showInText(i: number) {
  view.value = 'text';
  nextTick(() => {
    const el = document.getElementById(`p${i}`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  });
}

// The full text in paragraphs, split into plain pieces and marked quotes. Offsets follow lectureText() on the
// server: each segment's text joined with a newline.
type Piece = { text: string; ref?: Verdict; terms?: TermPiece[] };
// Islamic terms in a Latin-script text are tagged for the glossary (where each first appears).
const tagTerms = props.textLang !== 'ar';
const plain = (text: string, seen: Set<string>): Piece => (tagTerms ? { text, terms: termPieces(text, seen) } : { text });
const paragraphs = computed(() => {
  const refs = (report.value?.refs ?? []).filter((r) => r.a != null && r.b != null);
  let from = 0;
  const seen = new Set<string>(); // each term tagged once, where it first appears
  return props.segments.map((seg, i) => {
    const to = from + seg.text.length;
    const marks = refs
      .filter((r) => r.a! < to && r.b! > from)
      .map((r) => ({ a: Math.max(r.a!, from) - from, b: Math.min(r.b!, to) - from, r }))
      .sort((x, y) => x.a - y.a);
    const pieces: Piece[] = [];
    let last = 0;
    for (const m of marks) {
      if (m.a < last) continue;
      if (m.a > last) pieces.push(plain(seg.text.slice(last, m.a), seen));
      pieces.push({ text: seg.text.slice(m.a, m.b), ref: m.r });
      last = m.b;
    }
    if (last < seg.text.length) pieces.push(plain(seg.text.slice(last), seen));
    const heading = seg.section && seg.section !== props.segments[i - 1]?.section ? seg.section : null;
    from = to + 1;
    return { i, pieces, heading };
  });
});

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
          :style="{ insetInlineStart: `${Math.min(99, place(r) * 100)}%` }"
          :aria-label="`${where(r)} ${t.status[r.status]} ${r.match?.reference ?? ''}`"
          :title="`${where(r)} · ${r.match?.reference ?? t.status[r.status]}`"
          @click="jump(r.id)"
        ></button>
      </div>
      <p v-if="timing === 'audio'" class="axis"><span>0:00</span><span>{{ clock(duration) }}</span></p>
      <p v-else class="axis"><span>{{ para(0) }}</span><span>{{ para(segments.length - 1) }}</span></p>
      <div class="bar">
        <div class="views" role="group">
          <button type="button" :aria-pressed="view === 'findings'" @click="view = 'findings'">{{ t.report.findings }}</button>
          <button type="button" :aria-pressed="view === 'text'" @click="view = 'text'">{{ t.report.fullText }}</button>
          <button type="button" :aria-pressed="view === 'translation'" @click="view = 'translation'">{{ t.report.translation }}</button>
        </div>
        <div v-if="view === 'findings'" class="filters" role="group">
          <button v-for="f in filters" :key="f.id" type="button" :aria-pressed="filter === f.id" @click="filter = f.id">{{ f.label }}</button>
        </div>
      </div>
    </section>

    <template v-if="view === 'findings'">
    <p v-if="!visible.length" class="state">{{ t.report.noneInFilter }}</p>
    <section v-for="s in visible" :id="s.id" :key="s.id" class="stack" tabindex="-1">
      <p class="when">
        <button type="button" class="time" :aria-label="t.report.showInText.replace('{n}', String(segOf(s.lead) + 1))" @click="showInText(segOf(s.lead))">{{ where(s.lead) }}</button>
        <span v-if="s.others.length" class="times">{{ t.report.quoted }} {{ s.others.length + 1 }} {{ t.report.times }}</span>
      </p>
      <VerdictCard :v="s.lead" :t="t" :lang="lang" />
      <details v-if="s.others.length" class="others">
        <summary>{{ t.report.otherTimes }} {{ s.others.map((o) => where(o)).join(', ') }}</summary>
        <ul>
          <li v-for="o in s.others" :key="o.id">
            <button type="button" class="time" :aria-label="t.report.showInText.replace('{n}', String(segOf(o) + 1))" @click="showInText(segOf(o))">{{ where(o) }}</button>
            <span :class="['state-word', tone(o.status)]">{{ t.status[o.status] }}</span>
            <span class="spoken" dir="auto">{{ o.spoken }}</span>
          </li>
        </ul>
      </details>
    </section>
    </template>
  </template>

  <!-- The text is readable while the report is built, and when nothing was found. -->
  <TranslationView v-if="state === 'done' && view === 'translation'" :id="id" :text-lang="textLang" :t="t" :lang="lang" />
  <section v-if="state === 'loading' || (state === 'done' && (view === 'text' || !report?.refs.length))" class="fulltext">
    <p class="text-intro">{{ t.report.textIntro }}</p>
    <template v-for="p in paragraphs" :key="p.i">
      <h3 v-if="p.heading" dir="auto" :lang="textLang">{{ p.heading }}</h3>
      <p :id="`p${p.i}`" class="para" tabindex="-1">
        <span class="pn" :aria-label="t.report.paraLabel.replace('{n}', String(p.i + 1))">{{ p.i + 1 }}</span>
        <span class="ptext" dir="auto" :lang="textLang"><template v-for="(x, k) in p.pieces" :key="k"><a
          v-if="x.ref"
          :href="`#${stackOf(x.ref.id)?.id ?? ''}`"
          :class="['hl', tone(x.ref.status)]"
          :title="`${x.ref.match?.reference ?? ''} · ${t.status[x.ref.status]}`"
          @click.prevent="jump(x.ref.id)"
        >{{ x.text }}</a><template v-else-if="x.terms"><template v-for="(y, j) in x.terms" :key="j"><button v-if="y.term" type="button" class="term" :data-term="y.term.id">{{ y.text }}</button><template v-else>{{ y.text }}</template></template></template><template v-else>{{ x.text }}</template></template></span>
      </p>
    </template>
  </section>
</template>

<style scoped>
.state { color: var(--muted); display: flex; align-items: center; gap: 10px; padding: 32px 0; margin: 0; flex-wrap: wrap; }
.state[role='status'] { display: grid; grid-template-columns: auto 1fr; align-items: start; }
.state[role='status'] .spinner { margin-top: 4px; }
.error { color: var(--warn); }
.retry { border: 1px solid var(--line); background: transparent; border-radius: var(--r-small); padding: 6px 14px; min-height: 40px; cursor: pointer; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--text); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.overview { position: sticky; top: 0; z-index: 2; background: var(--panel); padding: 12px 0 14px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.counts { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin: 0 0 14px; }
.count { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 0.95rem; }
.tick.ok { background: var(--ok); } .tick.warn { background: var(--warn); }
.timeline { position: relative; height: 28px; border-radius: var(--r-small); background: var(--surface); border: 1px solid var(--line); }
/* Centred on its time with a logical margin, so it works in both directions without a dir selector. */
.tick { position: absolute; top: 4px; width: 6px; height: 18px; margin-inline-start: -3px; border-radius: 2px; border: 0; padding: 0; background: var(--none); cursor: pointer; }
.tick:hover { outline: 2px solid var(--text); outline-offset: 1px; }
.tick::after { content: ''; position: absolute; inset: -8px -6px; }
.axis { display: flex; justify-content: space-between; color: var(--subtle); font-size: 0.8rem; margin: 4px 0 12px; }
.bar { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; justify-content: space-between; }
.views, .filters { display: flex; flex-wrap: wrap; gap: 8px; }
.views { padding: 3px; border: 1px solid var(--line); border-radius: 22px; }
.views button { border: 0; background: transparent; border-radius: 18px; padding: 6px 16px; min-height: 36px; cursor: pointer; color: var(--muted); }
.views button[aria-pressed='true'] { background: var(--surface-2); color: var(--text); font-weight: 500; }
.filters button { border: 1px solid var(--line); background: transparent; border-radius: 20px; padding: 6px 14px; min-height: 40px; cursor: pointer; color: var(--text); }
.filters button[aria-pressed='true'] { background: var(--invert-bg); color: var(--invert-text); border-color: var(--invert-bg); }
.stack { margin: 22px 0; outline: none; scroll-margin-top: 190px; }
.stack:focus-visible { outline: 2px solid var(--focus); outline-offset: 6px; border-radius: var(--r-card); }
.when { display: flex; gap: 12px; align-items: baseline; margin: 0 0 8px; color: var(--muted); font-size: 0.92rem; }
.time { font: inherit; font-variant-numeric: tabular-nums; color: var(--text); font-weight: 500; background: none; border: 0; padding: 4px 0; min-height: 32px; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 4px; }
.time:hover { text-decoration-color: currentColor; }
.fulltext { padding: 8px 0 40px; }
.text-intro { color: var(--muted); margin: 8px 0 20px; font-size: 0.93rem; }
.fulltext h3 { font-size: 1rem; font-weight: 500; margin: 28px 0 8px; }
.para { display: grid; grid-template-columns: 2.6em 1fr; gap: 8px; margin: 0 0 14px; line-height: 1.75; outline: none; scroll-margin-top: 200px; border-radius: var(--r-small); }
.para:focus-visible, .para:target { background: var(--surface); }
.pn { color: var(--subtle); font-size: 0.82rem; font-variant-numeric: tabular-nums; padding-top: 0.3em; text-align: end; }
.ptext:lang(ar) { font-family: var(--scripture); font-size: 1.18rem; line-height: 2; }
.hl { color: inherit; text-decoration: none; border-radius: 3px; padding: 1px 2px; background: color-mix(in srgb, var(--none) 22%, transparent); box-shadow: inset 0 -2px 0 var(--none); }
.hl.ok { background: color-mix(in srgb, var(--ok) 18%, transparent); box-shadow: inset 0 -2px 0 var(--ok); }
.hl.warn { background: color-mix(in srgb, var(--warn) 22%, transparent); box-shadow: inset 0 -2px 0 var(--warn); }
.hl:hover, .hl:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.others { margin-top: 8px; padding: 0 4px; }
.others summary { cursor: pointer; color: var(--muted); padding: 8px 0; min-height: 40px; }
.others ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.others li { display: grid; grid-template-columns: auto auto 1fr; gap: 12px; align-items: baseline; }
.state-word { font-size: 0.9rem; } .state-word.ok { color: var(--ok); } .state-word.warn { color: var(--warn); } .state-word.none { color: var(--none); }
.spoken { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
/* On a phone the overview would cover half the screen if it stuck, so it scrolls away. */
@media (max-width: 720px) { .overview { position: static; } .para { scroll-margin-top: 16px; } .others li { grid-template-columns: auto 1fr; } .spoken { grid-column: 1 / -1; } .stack { scroll-margin-top: 16px; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
