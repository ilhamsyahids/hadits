<script setup lang="ts">
import { norm } from '../lib/arabic';
import { chainNames } from '../lib/chain';
import { computed, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { prophetic } from '../lib/prophetic';

// One checked quote: what was said, the source it matched (text from the API, never typed here), the verdict,
// grades by grader, and the other wordings. Status colour marks meaning, not decoration.

export type Grade = { grader: string; grade: string; conflict: boolean; via?: string | null; others?: { grade: string; sources: string[]; via?: string | null }[] };
export type Op = { op: 'same' | 'variant' | 'changed' | 'extra' | 'missing'; spoken?: string; source?: string };
export type Verdict = {
  id: number;
  status: string;
  spoken: string;
  start: number;
  a?: number; // span in the joined transcript (lecture reports)
  b?: number;
  segments?: number[];
  reason?: string;
  meaning?: boolean;
  match?: { key: string; reference: string; url: string; kind: string; ar: { matn: string; said?: [number, number][] }; en?: string | null; en_isnad?: string | null; range?: string[] };
  diff?: Op[];
  grades?: Grade[];
  grade_summary?: { status: string; note?: string };
  family_grades?: { via: string; grades: Grade[] };
  family?: { key: string; collection_name: string; number: string }[];
  near?: { key: string; reference: string }[];
  also?: { key: string; reference: string; similarity: number; same: boolean; grade_status: string | null }[];
  citation?: { said: string; agrees: boolean | null };
  closest?: { key: string; reference: string; similarity: number; grade_status: string | null };
  metrics?: { similarity: number };
};

const props = defineProps<{ v: Verdict; t: Strings; lang: 'en' | 'ar'; heading?: string; anchor?: string }>();
const full = ref(false);
const base = computed(() => (props.lang === 'ar' ? '/ar' : ''));
const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const tone = computed(() => ({ verbatim: 'ok', paraphrase: 'ok', reference: 'ok', misquote: 'warn', weak_or_disputed: 'warn' })[props.v.status] ?? 'none');
// Only for a misquote: on a paraphrase, reordered words show up as noise rather than as the change that matters.
// Also when the cited source has the report in other wording (closest): the reader sees what differs from it.
const showDiff = computed(() => props.v.status === 'misquote' || !!props.v.closest);
const changes = computed(() => (showDiff.value ? (props.v.diff ?? []).filter((o) => o.op !== 'same' && o.op !== 'variant') : []).slice(0, 6));
// The said words that are not in the source, marked in place.
const saidPieces = computed(() => {
  const odd = new Set(changes.value.filter((c) => c.op !== 'missing').flatMap((c) => norm(c.spoken ?? '').split(' ')).filter(Boolean));
  return props.v.spoken.split(/(\s+)/).map((w) => ({ w, odd: odd.size > 0 && odd.has(norm(w)) }));
});
// A grade's tone, as on the chapter lists: sound grades green, weak ones amber, none grey.
const gradeTone = (g: string | null) => (g === 'quran' || ['sahihayn', 'sahih', 'hasan', 'hasan_sahih', 'hasan_or_sahih', 'accepted'].includes(g ?? '') ? 'ok' : ['daif', 'mawdu', 'disputed'].includes(g ?? '') ? 'warn' : 'none');
// Findings a scholar should look at go to the human review queue (POST /v1/reviews).
const reviewable = computed(() => ['not_found_in_corpus', 'weak_or_disputed', 'misquote'].includes(props.v.status));
const review = ref<'idle' | 'sending' | 'sent' | 'failed'>('idle');
async function sendReview() {
  review.value = 'sending';
  const res = await fetch('/v1/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ said: props.v.spoken, status: props.v.status, key: props.v.match?.key ?? null, page: location.href }),
  }).catch(() => null);
  review.value = res?.ok ? 'sent' : 'failed';
}
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
        <p :class="isArabic(v.spoken) ? 'scripture' : 'plain'" :dir="isArabic(v.spoken) ? 'rtl' : 'auto'"><template v-for="(p, i) in saidPieces" :key="i"><mark v-if="p.odd" class="odd">{{ p.w }}</mark><template v-else>{{ p.w }}</template></template></p>
      </div>
      <div v-if="v.match">
        <h3>{{ t.source }}</h3>
        <p class="scripture" lang="ar" :class="{ clamp: long && !full, quran: v.match.kind === 'quran' }">
          <template v-for="(p, i) in prophetic(v.match.ar.matn, 'ar', v.match.ar.said)" :key="i"><span v-if="p.prophetic" class="prophetic">{{ p.text }}</span><template v-else>{{ p.text }}</template></template>
        </p>
        <button v-if="long" type="button" class="link" @click="full = !full">{{ full ? '−' : '+' }} {{ v.match.reference }}</button>
        <template v-if="v.match.en && lang === 'en'">
          <p v-if="v.match.en_isnad" class="chain">{{ chainNames(v.match.en_isnad).join(' › ') }}</p>
          <p class="translation"><template v-for="(p, i) in prophetic(v.match.en, 'en')" :key="i"><span v-if="p.prophetic" class="prophetic">{{ p.text }}</span><template v-else>{{ p.text }}</template></template></p>
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
    <p v-if="v.closest" class="reason closest">
      {{ t.citedWording.split('{closest}')[0].replace('{n}', String(Math.round((v.metrics?.similarity ?? 0) * 100))) }}<a :href="`${base}/${v.closest.key}`">{{ v.closest.reference }}</a>{{ t.citedWording.split('{closest}')[1] }}
    </p>
    <p v-if="v.reason" class="reason"><span class="label">{{ t.why }}:</span> {{ v.reason }}</p>
    <p v-if="v.citation && v.citation.agrees === false" class="citation warn-text">{{ t.citationMismatch }}: «{{ v.citation.said }}»</p>
    <p v-else-if="v.citation && v.citation.agrees" class="citation">{{ t.citationOk }}: «{{ v.citation.said }}»</p>
    <p v-if="v.status === 'not_found_in_corpus'" class="reason">{{ t.notFoundNote }}</p>
    <p v-if="reviewable" class="review">
      <button type="button" :disabled="review !== 'idle'" @click="sendReview">{{ review === 'sent' ? t.review.sent : review === 'failed' ? t.review.failed : t.review.send }}</button>
      <span class="muted-small">{{ t.review.note }}</span>
    </p>

    <section v-if="v.match && v.match.kind === 'hadith'" class="grades">
      <h3>{{ t.gradedBy }}</h3>
      <ul v-if="v.grades?.length">
        <li v-for="g in v.grades" :key="g.grader + g.grade">
          <span>{{ g.grader }}</span> <strong>{{ g.grade }}</strong>
          <small v-for="o in g.others ?? []" :key="o.grade" class="warn-text"> · {{ o.via && o.via !== g.via ? t.sourcePage.otherGradeVia.replace('{via}', o.via).replace('{grade}', o.grade) : t.sourcePage.otherGrade.replace('{grade}', o.grade).replace('{sources}', o.sources.join(', ')) }}</small>
        </li>
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
    <section v-if="v.also?.length" class="links also">
      <h3>{{ t.alsoIn }}</h3>
      <p class="note">{{ t.alsoInNote }}</p>
      <ul>
        <li v-for="a in v.also" :key="a.key" :class="gradeTone(a.grade_status)">
          <a :href="`${base}/${a.key}`">{{ a.reference }}</a>
          <span class="g"><span class="mark" aria-hidden="true"></span>{{ a.grade_status === 'quran' ? '' : t.gradeStatus[a.grade_status ?? 'ungraded'] ?? a.grade_status }}</span>
          <span v-if="!a.same" class="sim">{{ t.otherWording.replace('{n}', String(Math.round(a.similarity * 100))) }}</span>
        </li>
      </ul>
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
.mark { align-self: center; }
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
.review { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0; }
.review button { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: var(--r-small); padding: 6px 12px; min-height: 36px; font: inherit; font-size: 0.9rem; cursor: pointer; }
.review button:disabled { color: var(--muted); cursor: default; }
.muted-small { color: var(--subtle); font-size: 0.82rem; }
.odd { background: color-mix(in srgb, var(--warn) 22%, transparent); color: inherit; border-radius: 3px; padding: 0 2px; }
.closest a { text-underline-offset: 3px; }
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
.also .note { color: var(--muted); font-size: 0.88rem; margin: 0 0 6px; }
.also ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 4px 18px; }
.also li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 4px 0; }
.also .sim { color: var(--subtle); font-size: 0.85rem; }
.also .g { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 0.85rem; }
/* Each source's own grade, not the card's status. */
.also li .mark { width: 9px; border-radius: 50%; clip-path: none; background: transparent; box-shadow: inset 0 0 0 1.6px var(--none); }
.also li.ok .mark { background: var(--ok); box-shadow: none; border-radius: 2px; }
.also li.warn .mark { background: var(--warn); box-shadow: none; border-radius: 0; width: 10px; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.link { background: none; border: 0; padding: 6px 0; cursor: pointer; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; min-height: 32px; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } .card { padding: 16px; } }
</style>
