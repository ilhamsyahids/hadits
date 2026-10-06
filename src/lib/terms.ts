import type { Lang } from '../corpus/units';
import type { Bindings } from '../env';
import { generateJSON } from './gemini';

// Islamic terms in a text, found by the model, for the glossary (lib/glossary.ts tags them, TermPopover explains
// them). Each term must appear in the text exactly as returned, or it is dropped.

export type FoundTerm = { form: string; gloss: string };

const LANGUAGE = { en: 'English', ar: 'Arabic', id: 'Bahasa Indonesia' } as const;
const SYSTEM = `List the Islamic or Arabic religious terms in this text that a general reader may not know: concepts, acts of worship, rulings, sciences, places and events of the religion (e.g. taqwa, i'tidal, tasmi', iktidal, sanad, ihram, miqat, 'Arafah).
- Copy each term exactly as it is written in the text (same spelling, same script).
- Leave out people's names, book titles, ordinary words, and names of groups, movements or schools of thought.
- Give a one-line meaning in {LANGUAGE}, plain and neutral. Do not quote the Quran or hadith.
- At most 40 terms, most useful first.`;

// Labels of groups and movements are not defined by the site, whoever uses them.
const GROUP_LABEL = /^(al-)?(salaf|wahhab|sufi|shi'?[ai]|syi'?ah|sunni|ahl[ui]?s?[- ]?sunnah|ikhwan|khawarij|asy'?ari|ash'?ari|maturidi|mu'?tazil)/i;

export async function findTerms(env: Bindings, text: string, lang: Lang): Promise<FoundTerm[]> {
  const sample = text.slice(0, 30_000);
  const { data } = await generateJSON<{ terms: FoundTerm[] }>(env, {
    model: env.LLM_MODEL_LITE,
    system: SYSTEM.replace('{LANGUAGE}', LANGUAGE[lang]),
    prompt: sample,
    schema: { type: 'OBJECT', properties: { terms: { type: 'ARRAY', items: { type: 'OBJECT', properties: { form: { type: 'STRING' }, gloss: { type: 'STRING' } }, required: ['form', 'gloss'] } } }, required: ['terms'] },
    thinking: 'minimal',
    timeoutMs: 60_000,
  });
  const seen = new Set<string>();
  return data.terms
    .map((t) => ({ form: t.form.trim(), gloss: t.gloss.trim().slice(0, 240) }))
    .filter((t) => !GROUP_LABEL.test(t.form) && !/(سلف|وهاب|صوف|شيع|إخوان|خوارج|أشعر|ماتريد|معتزل)/.test(t.form))
    .filter((t) => t.form.length >= 2 && t.form.length <= 40 && sample.includes(t.form) && !seen.has(t.form.toLowerCase()) && seen.add(t.form.toLowerCase()))
    .slice(0, 40);
}
