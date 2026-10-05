<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Strings } from '../i18n/strings';

// One checked quote: what was said, the source it matched (text from the API, never typed here), the verdict,
// grades by grader, and the other wordings. Status colour marks meaning, not decoration.

export type Grade = { grader: string; grade: string; conflict: boolean };
export type Op = { op: 'same' | 'variant' | 'changed' | 'extra' | 'missing'; spoken?: string; source?: string };
export type Verdict = {
  id: number;
  status: string;
  spoken: string;
  start: number;
  reason?: string;
  meaning?: boolean;
  match?: { key: string; reference: string; url: string; kind: string; ar: { matn: string }; en?: string | null; en_isnad?: string | null; range?: string[] };
  diff?: Op[];
  grades?: Grade[];
  grade_summary?: { status: string; note?: string };
  family_grades?: { via: string; grades: Grade[] };
  family?: { key: string; collection_name: string; number: string }[];
  near?: { key: string; reference: string }[];
  citation?: { said: string; agrees: boolean | null };
};

const props = defineProps<{ v: Verdict; t: Strings; lang: 'en' | 'ar'; heading?: string; anchor?: string }>();
const full = ref(false);
const base = computed(() => (props.lang === 'ar' ? '/ar' : ''));
const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const tone = computed(() => ({ verbatim: 'ok', paraphrase: 'ok', reference: 'ok', misquote: 'warn', weak_or_disputed: 'warn' })[props.v.status] ?? 'none');
// Only for a misquote: on a paraphrase, reordered words show up as noise rather than as the change that matters.
const changes = computed(() => (props.v.status === 'misquote' ? (props.v.diff ?? []).filter((o) => o.op !== 'same' && o.op !== 'variant') : []).slice(0, 6));
const long = computed(() => (props.v.match?.ar.matn.length ?? 0) > 420);
</script>

<template>
  <article class="card" :class="tone" :id="anchor">
    <header>
      <p class="status">
        <span class="mark" aria-hidden="true"></span>
        <strong>{{ t.status[v.status] ?? v.status }}</strong>
        <span class="note">{{ t.statusNote[v.status] }}</span>
      </p>
      <a v-if="v.match" class="ref" :href="`${base}/${v.match.key}`">{{ heading ?? v.match.reference }}</a>
    </header>

    <div class="pair">
      <div>
        <h3>{{ v.meaning ? t.meaningOnly : t.said }}</h3>
        <p :class="isArabic(v.spoken) ? 'scripture' : 'plain'" :dir="isArabic(v.spoken) ? 'rtl' : 'auto'">{{ v.spoken }}</p>
      </div>
      <div v-if="v.match">
        <h3>{{ t.source }}</h3>
        <p class="scripture" lang="ar" :class="{ clamp: long && !full }">{{ v.match.ar.matn }}</p>
        <button v-if="long" type="button" class="link" @click="full = !full">{{ full ? '−' : '+' }} {{ v.match.reference }}</button>
        <template v-if="v.match.en && lang === 'en'">
          <p v-if="v.match.en_isnad" class="chain">{{ v.match.en_isnad.split(/\s*>\s*/).join(' › ') }}</p>
          <p class="translation">{{ v.match.en }}</p>
        </template>
      </div>
    </div>

    <p v-if="changes.length" class="changes">
      <span class="label">{{ t.diffLegend }}:</span>
      <span v-for="(c, i) in changes" :key="i" class="change" lang="ar" dir="rtl">
        <template v-if="c.op === 'changed'"><del>{{ c.spoken }}</del> → <ins>{{ c.source }}</ins></template>
        <template v-else-if="c.op === 'extra'"><del>{{ c.spoken }}</del></template>
        <template v-else><ins>{{ c.source }}</ins></template>
      </span>
    </p>
    <p v-if="v.reason" class="reason"><span class="label">{{ t.why }}:</span> {{ v.reason }}</p>
    <p v-if="v.citation && v.citation.agrees === false" class="citation warn-text">{{ t.citationMismatch }}: «{{ v.citation.said }}»</p>
    <p v-else-if="v.citation && v.citation.agrees" class="citation">{{ t.citationOk }}: «{{ v.citation.said }}»</p>
    <p v-if="v.status === 'not_found_in_corpus'" class="reason">{{ t.notFoundNote }}</p>

    <section v-if="v.match && v.match.kind === 'hadith'" class="grades">
      <h3>{{ t.gradedBy }}</h3>
      <ul v-if="v.grades?.length">
        <li v-for="g in v.grades" :key="g.grader + g.grade"><span>{{ g.grader }}</span> <strong>{{ g.grade }}</strong><span v-if="g.conflict" class="warn-text"> ⚠</span></li>
      </ul>
      <template v-else-if="v.family_grades">
        <p class="muted">{{ t.noGrade }} {{ t.familyGrades }} <a :href="`${base}/${v.family_grades.via}`">{{ v.family_grades.via }}</a>:</p>
        <ul><li v-for="g in v.family_grades.grades" :key="g.grader + g.grade"><span>{{ g.grader }}</span> <strong>{{ g.grade }}</strong></li></ul>
      </template>
      <p v-else class="muted">{{ v.grade_summary?.note ?? t.noGrade }}</p>
    </section>

    <section v-if="v.family?.length" class="links">
      <h3>{{ t.variants }}</h3>
      <p><a v-for="f in v.family.slice(0, 8)" :key="f.key" :href="`${base}/${f.key}`">{{ f.collection_name }} {{ f.number }}</a></p>
    </section>
    <section v-if="v.status === 'not_found_in_corpus' && v.near?.length" class="links">
      <h3>{{ t.closest }}</h3>
      <p><a v-for="n in v.near" :key="n.key" :href="`${base}/${n.key}`">{{ n.reference }}</a></p>
    </section>
  </article>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 16px; }
.status { margin: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.mark { width: 9px; height: 9px; border-radius: 2px; background: var(--none); align-self: center; flex: none; }
.ok .mark { background: var(--ok); } .warn .mark { background: var(--warn); }
.ok .status strong { color: var(--ok); } .warn .status strong { color: var(--warn); } .none .status strong { color: var(--none); }
.note { color: var(--muted); font-size: 0.92rem; }
.ref { color: var(--text); font-weight: 500; text-underline-offset: 3px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }
h3 { margin: 0 0 4px; font-size: 0.82rem; font-weight: 500; color: var(--muted); }
p { margin: 0; overflow-wrap: anywhere; }
.plain { color: var(--text); }
.clamp { display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.translation { color: var(--muted); font-size: 0.95rem; margin-top: 6px; }
.chain { color: var(--subtle); font-size: 0.85rem; margin-top: 8px; }
.changes { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.change { font-family: var(--scripture); font-size: 1.15rem; }
del { color: var(--warn); } ins { text-decoration: none; color: var(--ok); }
.label { color: var(--muted); font-size: 0.88rem; margin-inline-end: 4px; }
.reason, .citation { font-size: 0.95rem; }
.warn-text { color: var(--warn); }
.muted { color: var(--muted); font-size: 0.95rem; }
.grades ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.grades li span { color: var(--muted); }
.links p { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.links a { text-underline-offset: 3px; }
.link { background: none; border: 0; padding: 6px 0; cursor: pointer; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; min-height: 32px; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } .card { padding: 16px; } }
</style>
