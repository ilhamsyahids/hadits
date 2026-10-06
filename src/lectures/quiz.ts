import type { Lang } from '../corpus/units';
import type { Bindings } from '../env';
import { generateJSON } from '../lib/gemini';
import type { Doc } from './doc';
import { buildReport, cachedReport, VERIFY_VERSION } from './report';

// A quiz on a lecture or article. Two kinds of question:
//   - about the content: written by the model from the text, each pointing at the paragraph that answers it
//     (checked: the paragraph must exist), never quoting scripture;
//   - "where is this from?": built from the report's checked findings, no model involved: the source of a quote,
//     with other sources found in the same text as the wrong options.

export type Question = { q: string; options: string[]; answer: number; paragraph: number; kind: 'content' | 'dalil'; key?: string };
export type Quiz = { lang: Lang; questions: Question[] };

const LANGUAGE = { en: 'English', ar: 'Arabic', id: 'Bahasa Indonesia' } as const;
const SYSTEM = `You write a short quiz in {LANGUAGE} on an Islamic lecture or article, to help a listener remember it.
- Write {N} multiple-choice questions about the main points the speaker or author makes, in the order they come.
- Each question has 4 short options and exactly one correct answer, supported by the paragraph you give (its number, as shown in [n]).
- Ask about the ideas, rulings mentioned, reasons and examples. Do not quote or ask for the words of any verse or hadith, and do not add facts the text does not contain.`;

export const quizKey = (id: string, lang: Lang) => `quiz:${VERIFY_VERSION}:${id}:${lang}`;

type Ref = { status: string; spoken: string; segments?: number[]; match?: { key: string; reference: string } };

export async function makeQuiz(env: Bindings, doc: Doc, lang: Lang, waitUntil: (p: Promise<unknown>) => void): Promise<Quiz> {
  // Content questions from the text (long texts: the first ~24,000 characters).
  const numbered: string[] = [];
  let size = 0;
  for (const [i, s] of doc.segments.entries()) {
    if (size > 24_000) break;
    numbered.push(`[${i + 1}] ${s.text}`);
    size += s.text.length;
  }
  const n = Math.min(8, Math.max(3, Math.round(numbered.length / 8)));
  const { data } = await generateJSON<{ questions: { q: string; options: string[]; answer: number; paragraph: number }[] }>(env, {
    model: env.LLM_MODEL,
    system: SYSTEM.replace('{LANGUAGE}', LANGUAGE[lang]).replace('{N}', String(n)),
    prompt: numbered.join('\n'),
    schema: {
      type: 'OBJECT',
      properties: {
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { q: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } }, answer: { type: 'INTEGER' }, paragraph: { type: 'INTEGER' } },
            required: ['q', 'options', 'answer', 'paragraph'],
          },
        },
      },
      required: ['questions'],
    },
    thinking: 'low',
    timeoutMs: 90_000,
  });
  const content: Question[] = data.questions
    .filter((x) => x.options.length === 4 && x.answer >= 0 && x.answer < 4 && x.paragraph >= 1 && x.paragraph <= doc.segments.length)
    .map((x) => ({ q: x.q, options: x.options, answer: x.answer, paragraph: x.paragraph - 1, kind: 'content' }));

  // "Where is this from?" from the report's findings.
  const report = (await cachedReport<{ refs: Ref[] }>(env, doc.id, lang)) ?? (await buildReport(env, doc, lang, waitUntil));
  const found = (report.refs as Ref[]).filter((r) => r.match && ['verbatim', 'paraphrase', 'weak_or_disputed'].includes(r.status));
  const refs = [...new Map(found.map((r) => [r.match!.key, r])).values()];
  const others = (key: string) => refs.filter((r) => r.match!.key !== key).map((r) => r.match!.reference);
  const ask = { en: 'Where is this from?', ar: 'من أين هذا؟', id: 'Dari mana ini?' }[lang];
  const dalil: Question[] = refs
    .filter((r) => others(r.match!.key).length >= 2)
    .slice(0, 4)
    .map((r, i) => {
      const wrong = others(r.match!.key).slice(i, i + 3);
      const answer = (r.spoken.length + i) % (wrong.length + 1);
      const options = [...wrong];
      options.splice(answer, 0, r.match!.reference);
      return { q: `${ask} «${r.spoken.length > 160 ? `${r.spoken.slice(0, 160)}…` : r.spoken}»`, options, answer, paragraph: r.segments?.[0] ?? 0, kind: 'dalil', key: r.match!.key };
    });

  // Content first, in the order of the text, then the dalil questions.
  return { lang, questions: [...content.sort((a, b) => a.paragraph - b.paragraph), ...dalil] };
}
