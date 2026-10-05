<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { myDocs, submitText, type MyDoc } from '../lib/documents';

// Check your own lecture or article: paste or open a text file → POST /v1/documents → its report page.
const props = defineProps<{ t: Strings; lang: 'en' | 'ar' }>();
const s = computed(() => props.t.submit);
const base = props.lang === 'ar' ? '/ar' : '';
const text = ref('');
const title = ref('');
const filename = ref<string | undefined>();
const state = ref<'idle' | 'saving'>('idle');
const error = ref<string | null>(null);
const mine = ref<MyDoc[]>([]);
onMounted(() => (mine.value = myDocs()));

const MAX = 100_000;
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(props.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'long' }) : '');

async function open(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = null;
  try {
    if (file.size > MAX * 4) throw new Error('too big');
    text.value = await file.text();
    filename.value = file.name;
  } catch {
    error.value = s.value.errors.file;
  }
}

async function submit() {
  const body = text.value.trim();
  if (!body || state.value === 'saving') return;
  if (body.length > MAX) return void (error.value = s.value.errors.too_long);
  state.value = 'saving';
  error.value = null;
  const res = await submitText(body, { title: title.value.trim() || undefined, filename: filename.value });
  if ('id' in res) return void (location.href = `${base}/lectures/${res.id}`);
  error.value = s.value.errors[res.error];
  state.value = 'idle';
}
</script>

<template>
  <section class="submit">
    <h2>{{ s.heading }}</h2>
    <p class="muted">{{ s.intro }}</p>
    <form @submit.prevent="submit">
      <label class="sr-only" for="doc-text">{{ s.placeholder }}</label>
      <textarea id="doc-text" v-model="text" :placeholder="s.placeholder" rows="7" dir="auto" @input="filename = undefined" />
      <div class="row">
        <label class="sr-only" for="doc-title">{{ s.title }}</label>
        <input id="doc-title" v-model="title" type="text" :placeholder="s.title" dir="auto" maxlength="160" />
        <label class="file">
          <input type="file" accept=".txt,.md,.markdown,.srt,.vtt,text/plain,text/markdown" @change="open" />
          {{ s.file }}
        </label>
        <button type="submit" :disabled="!text.trim() || state === 'saving'">{{ state === 'saving' ? s.submitting : s.submit }}</button>
      </div>
      <p class="hint">{{ s.fileTypes }} · {{ text.length.toLocaleString() }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="hint">{{ s.privacy }}</p>
    </form>

    <template v-if="mine.length">
      <h3>{{ s.mine }}</h3>
      <ul class="mine">
        <li v-for="d in mine" :key="d.id">
          <a :href="`${base}/lectures/${d.id}`" dir="auto">{{ d.title }}</a>
          <span v-if="d.expires" class="hint">{{ s.keptUntil.replace('{date}', date(d.expires)) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.submit { margin: 0 0 36px; }
h2 { font-size: 1.15rem; font-weight: 500; margin: 0 0 6px; }
h3 { font-size: 0.9rem; font-weight: 500; color: var(--muted); margin: 24px 0 6px; }
.muted { color: var(--muted); margin: 0 0 14px; max-width: 64ch; }
form { display: flex; flex-direction: column; gap: 10px; }
textarea, input[type='text'] { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: var(--r-small); background: var(--surface); color: var(--text); font: inherit; padding: 12px 14px; }
textarea { resize: vertical; min-height: 160px; line-height: 1.6; }
textarea:focus, input:focus { outline: none; border-color: var(--muted); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; }
.row input[type='text'] { flex: 1 1 220px; width: auto; min-height: 44px; padding: 0 14px; }
.file { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--r-small); cursor: pointer; color: var(--text); }
.file:hover { border-color: var(--muted); }
.file:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
button[type='submit'] { border: 0; border-radius: var(--r-small); background: var(--invert-bg); color: var(--invert-text); font: inherit; font-weight: 500; padding: 0 20px; min-height: 44px; cursor: pointer; }
button[type='submit']:disabled { opacity: 0.45; cursor: default; }
.hint { color: var(--subtle); font-size: 0.86rem; margin: 0; }
.error { color: var(--warn); margin: 0; }
.mine { list-style: none; margin: 0; padding: 0; }
.mine li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--line); }
.mine a { text-underline-offset: 3px; }
</style>
