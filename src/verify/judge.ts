import type { Bindings } from '../env';
import { generateJSON, type Usage } from '../lib/gemini';

// Step 5 (grey band only): an LLM judge decides paraphrase vs misquote vs a different text.
// It sees both texts and the word diff; it never writes or corrects scripture.

export type JudgeItem = { id: number; spoken: string; source: string; reference: string; diff: string };
export type JudgeLabel = 'paraphrase' | 'misquote' | 'different_text';
export type JudgeResult = { id: number; label: JudgeLabel; reason: string; confidence: number };

const SYSTEM = `You check quotations in Islamic lectures. For each item you get the Arabic the speaker said, the source text it was matched to (from a hadith or Quran database), and a word diff.
Classify each item:
- "paraphrase": the same verse or report with the same meaning. Wording differs: order, omitted parts, connecting words, a known alternative wording, or a loose retelling. Nothing that changes what is said.
- "misquote": presented as this text, about the same subject, but a changed, added or dropped word changes the meaning: negation, pronoun or person (you/they), a number or amount, who acts, a different legal or ritual term (zakat vs sadaqah, fard vs sunnah, halal vs haram), or words attributed to the Prophet or to Allah that the source does not contain.
- "different_text": not the same verse or report. Typical sign: the main subject differs (e.g. cleanliness vs modesty) and the two share only common words such as من، في، الله، الإيمان.
Give a one-sentence reason in Bahasa Indonesia that names the changed words. Never write out or correct the Quran or hadith yourself; only describe the difference. Confidence is 0..1.`;

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

export async function judge(env: Bindings, items: JudgeItem[]): Promise<{ results: Map<number, JudgeResult>; usage: Usage }> {
  if (!items.length) return { results: new Map(), usage: { input: 0, output: 0 } };
  const prompt = items
    .map((it) => `### item ${it.id}\nreference: ${it.reference}\nspoken: ${it.spoken}\nsource: ${it.source}\ndiff: ${it.diff}`)
    .join('\n\n');
  const { data, usage } = await generateJSON<{ items: JudgeResult[] }>(env, { model: env.JUDGE_MODEL ?? env.LLM_MODEL, system: SYSTEM, prompt, schema: SCHEMA, thinking: 'low' });
  return { results: new Map(data.items.map((r) => [r.id, r])), usage };
}
