import type { Bindings } from '../env';
import { generateJSON, type Usage } from '../lib/gemini';

// Step 5 (grey band only): an LLM judge decides paraphrase vs misquote vs a different text.
// It sees both texts and the word diff; it never writes or corrects scripture.

export type JudgeItem = { id: number; spoken: string; source: string; reference: string; diff: string };
export type JudgeLabel = 'paraphrase' | 'misquote' | 'different_text';
export type JudgeResult = { id: number; label: JudgeLabel; reason: string; confidence: number };

const SYSTEM = `You check quotations in Islamic lectures. For each item you get the Arabic the speaker said, the source text it was matched to (from a hadith or Quran database), and a word diff.
Classify each item:
- "paraphrase": the same verse or report with the same meaning. Wording differs: order, omitted parts, connecting words, a known alternative wording, a synonym or a more specific/general word for the same people or thing (الناس / أصحاب رسول الله), or a loose retelling. Nothing that changes what is said.
- "misquote": presented as this text, about the same subject, but a changed, added or dropped word changes the meaning: negation, pronoun or person (you/they), a number or amount, who acts, a different legal or ritual term (zakat vs sadaqah, fard vs sunnah, halal vs haram), or words attributed to the Prophet or to Allah that the source does not contain.
- "different_text": not the same verse or report. Typical sign: the main subject differs (e.g. cleanliness vs modesty) and the two share only common words such as من، في، الله، الإيمان.
Give a one-sentence reason in {LANGUAGE} that names the changed words. Never write out or correct the Quran or hadith yourself; only describe the difference. Confidence is 0..1.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          label: { type: 'STRING', enum: ['paraphrase', 'misquote', 'different_text'] },
          reason: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['id', 'label', 'reason', 'confidence'],
      },
    },
  },
  required: ['items'],
};

const LANGUAGE = { en: 'English', ar: 'Arabic', id: 'Bahasa Indonesia' } as const;

// Meaning-only mentions ("Nabi bersabda bahwa puasa itu perisai"): pick the source that says the same thing, or none.
const MEANING_SYSTEM = `A lecturer mentions a verse or hadith only by its meaning, in their own language. For each item you get what was said and up to 5 candidate sources (Arabic with an English translation).
Return the key of the candidate that the speaker is referring to: the same verse or report, saying the same thing. If none of them says it, return null. A candidate on the same topic that says something else is not a match, and neither is one that merely contains the same word or a short reply ("yes", "virtue"): the said text must carry that candidate's specific content.
Give a one-sentence reason in {LANGUAGE}. Never write out or correct the Quran or hadith yourself. Confidence is 0..1.`;

const MEANING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'INTEGER' }, key: { type: 'STRING', nullable: true }, reason: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
        required: ['id', 'reason', 'confidence'],
      },
    },
  },
  required: ['items'],
};

export type MeaningItem = { id: number; said: string; candidates: { key: string; reference: string; ar: string; en: string }[] };
export type MeaningResult = { id: number; key: string | null; reason: string; confidence: number };

export async function judgeMeaning(env: Bindings, items: MeaningItem[], lang: keyof typeof LANGUAGE = 'en'): Promise<{ results: Map<number, MeaningResult>; usage: Usage }> {
  if (!items.length) return { results: new Map(), usage: { input: 0, output: 0 } };
  const prompt = items
    .map((it) => `### item ${it.id}\nsaid: ${it.said}\n${it.candidates.map((c) => `- key ${c.key} (${c.reference})\n  ar: ${c.ar}\n  en: ${c.en}`).join('\n')}`)
    .join('\n\n');
  const { data, usage } = await generateJSON<{ items: MeaningResult[] }>(env, { model: env.JUDGE_MODEL ?? env.LLM_MODEL, system: MEANING_SYSTEM.replace('{LANGUAGE}', LANGUAGE[lang]), prompt, schema: MEANING_SCHEMA, thinking: 'low' });
  const allowed = new Map(items.map((it) => [it.id, new Set(it.candidates.map((c) => c.key))]));
  // A key outside the candidates offered is treated as "none".
  return { results: new Map(data.items.map((r) => [r.id, { ...r, key: r.key && allowed.get(r.id)?.has(r.key) ? r.key : null }])), usage };
}

export async function judge(env: Bindings, items: JudgeItem[], lang: keyof typeof LANGUAGE = 'en'): Promise<{ results: Map<number, JudgeResult>; usage: Usage }> {
  if (!items.length) return { results: new Map(), usage: { input: 0, output: 0 } };
  const prompt = items
    .map((it) => `### item ${it.id}\nreference: ${it.reference}\nspoken: ${it.spoken}\nsource: ${it.source}\ndiff: ${it.diff}`)
    .join('\n\n');
  const { data, usage } = await generateJSON<{ items: JudgeResult[] }>(env, { model: env.JUDGE_MODEL ?? env.LLM_MODEL, system: SYSTEM.replace('{LANGUAGE}', LANGUAGE[lang]), prompt, schema: SCHEMA, thinking: 'low' });
  return { results: new Map(data.items.map((r) => [r.id, r])), usage };
}
