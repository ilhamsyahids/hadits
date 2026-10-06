<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';

// The sources page's contact form: a dispute, a source to add, or feedback, sent to POST /v1/messages and read on the
// admin page. A link such as /sources?key=bukhari:1#contact (from a hadith page) fills the key and picks "dispute".
const props = defineProps<{ t: Strings }>();
const s = props.t.sources;
const f = s.form;
type Kind = 'dispute' | 'suggest' | 'feedback';
const KINDS: Kind[] = ['dispute', 'suggest', 'feedback'];
const label: Record<Kind, string> = { dispute: s.dispute, suggest: s.suggest, feedback: s.feedback };

const kind = ref<Kind>('dispute');
const key = ref('');
const message = ref('');
const email = ref('');
const state = ref<'idle' | 'sending' | 'sent' | 'error' | 'limit'>('idle');

onMounted(() => {
  const q = new URLSearchParams(location.search);
  const k = q.get('kind');
  if (k && (KINDS as string[]).includes(k)) kind.value = k as Kind;
  if (q.get('key')) key.value = q.get('key')!.slice(0, 300);
});

async function send() {
  if (state.value === 'sending' || message.value.trim().length < 5) return;
  state.value = 'sending';
  try {
    const res = await fetch('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: kind.value, key: key.value, message: message.value, email: email.value }),
    });
    state.value = res.status === 429 ? 'limit' : res.ok ? 'sent' : 'error';
    if (res.ok) message.value = '';
  } catch {
    state.value = 'error';
  }
}
</script>

<template>
  <div v-if="state === 'sent'" class="done" role="status">
    <p>{{ f.sent }}</p>
    <button type="button" class="plain" @click="state = 'idle'">{{ f.another }}</button>
  </div>
  <form v-else class="form" @submit.prevent="send">
    <fieldset>
      <legend>{{ f.kind }}</legend>
      <div class="kinds">
        <label v-for="k in KINDS" :key="k" :class="{ on: kind === k }">
          <input v-model="kind" type="radio" name="kind" :value="k" />{{ label[k] }}
        </label>
      </div>
    </fieldset>
    <label class="field">{{ f.key }}<input v-model="key" type="text" dir="auto" placeholder="bukhari:1" maxlength="300" /></label>
    <label class="field">{{ f.message }}<textarea v-model="message" dir="auto" required minlength="5" maxlength="4000" rows="5"></textarea></label>
    <label class="field">{{ f.email }}<input v-model="email" type="email" autocomplete="email" maxlength="200" /></label>
    <p v-if="state === 'error'" class="error" role="alert">{{ f.error }}</p>
    <p v-if="state === 'limit'" class="error" role="alert">{{ f.limit }}</p>
    <button type="submit" :disabled="state === 'sending' || message.trim().length < 5">{{ state === 'sending' ? f.sending : f.send }}</button>
  </form>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
fieldset { border: 0; margin: 0; padding: 0; }
legend, .field { color: var(--muted); font-size: 0.92rem; }
legend { margin-bottom: 8px; }
.kinds { display: flex; flex-wrap: wrap; gap: 8px; }
.kinds label { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--r-small); color: var(--text); cursor: pointer; font-size: 0.95rem; }
.kinds label.on { border-color: var(--text); }
.kinds label:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.kinds input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.field { display: flex; flex-direction: column; gap: 6px; }
input[type='text'], input[type='email'], textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--line); border-radius: var(--r-small); background: var(--panel); color: var(--text); font: inherit; font-size: 1rem; padding: 10px 14px; }
input[type='text'], input[type='email'] { min-height: 44px; }
textarea { resize: vertical; line-height: 1.6; }
input:focus, textarea:focus { outline: none; border-color: var(--muted); }
button[type='submit'] { align-self: flex-start; border: 0; border-radius: var(--r-small); background: var(--invert-bg); color: var(--invert-text); font: inherit; font-weight: 500; padding: 0 20px; min-height: 44px; cursor: pointer; }
button[type='submit']:disabled { opacity: 0.45; cursor: default; }
.error { color: var(--warn); margin: 0; }
.done p { margin: 0 0 12px; }
.plain { border: 1px solid var(--line); background: none; color: var(--text); border-radius: var(--r-small); font: inherit; padding: 0 14px; min-height: 40px; cursor: pointer; }
</style>
