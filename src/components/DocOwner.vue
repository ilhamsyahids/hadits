<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Strings } from '../i18n/strings';
import { deleteText, myDocs } from '../lib/documents';

// On a submitted text's report: how long it is kept, and Delete for the browser that submitted it.
const props = defineProps<{ id: string; expires: number; t: Strings; lang: 'en' | 'ar' }>();
const mine = ref(false);
const failed = ref(false);
onMounted(() => (mine.value = !!myDocs().find((d) => d.id === props.id)?.token));
const date = new Date(props.expires).toLocaleDateString(props.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function remove() {
  if (!confirm(props.t.submit.deleteConfirm)) return;
  failed.value = false;
  if (await deleteText(props.id)) location.href = `${props.lang === 'ar' ? '/ar' : ''}/lectures`;
  else failed.value = true;
}
</script>

<template>
  <span class="owner">
    {{ t.submit.keptUntil.replace('{date}', date) }}
    <button v-if="mine" type="button" @click="remove">{{ t.submit.delete }}</button>
    <span v-if="failed" class="error" role="alert">{{ t.submit.deleteFailed }}</span>
  </span>
</template>

<style scoped>
.owner { display: inline-flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
button { border: 0; background: none; color: var(--warn); font: inherit; padding: 4px 0; min-height: 32px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.error { color: var(--warn); }
</style>
