import { type Lang, reference, unitsByKeys } from '../corpus/units';
import type { Bindings } from '../env';
import { generateJSON } from '../lib/gemini';
import { TERMS } from '../lib/glossary';
import type { Doc } from './doc';
import { buildReport, cachedReport, VERIFY_VERSION } from './report';

// Translation of a lecture or article with the scripture left to its sources. Every quote the report found is cut
// out before the model sees the text (a placeholder ⟦n⟧ stays in its place) and put back afterwards:
//   - verbatim (and weak or disputed, which is verbatim too): the published translation from the database
//     (ayat: the Quran translation; hadith: the source's translation), or the original Arabic when there is none;
//   - paraphrase or misquote: the speaker's own words, untranslated, marked with the finding. Translating them
//     would put words in the source's mouth.
// Islamic terms from the glossary stay transliterated, with a short gloss the first time.

export type TPiece = { text: string } | { quote: { key: string | null; reference: string | null; status: string; text: string; lang: string; translated: boolean } };
export type Translation = { to: Lang; paragraphs: TPiece[][]; usage: { input: number; output: number } };

type Ref = { status: string; spoken: string; a?: number; b?: number; segments?: number[]; match?: { key: string } };

const BATCH_CHARS = 6000;
const LANGUAGE = { en: 'English', ar: 'Arabic', id: 'Bahasa Indonesia' } as const;
const SYSTEM = `You translate an Islamic lecture or article into {LANGUAGE}, paragraph by paragraph, faithfully and in natural {LANGUAGE}.
- Return exactly one translated string per input paragraph, in the same order.
- Keep every placeholder like ⟦3⟧ exactly where it belongs in the sentence; never translate, remove or add placeholders. They stand for verses and hadith inserted later.
- Translate everything else in the paragraph, including any quotation the author wrote out, and never leave out a sentence. Do not add verses, hadith or anything of your own.
- Keep these Islamic terms transliterated, not replaced by a loose equivalent; the first time each appears add a short gloss in parentheses: {TERMS}.
- Keep names of people and books as they are. Do not add commentary.`;

export const translationKey = (id: string, to: Lang) => `translation:${VERIFY_VERSION}:${id}:${to}`;

export async function translateDoc(env: Bindings, doc: Doc, to: Lang, waitUntil: (p: Promise<unknown>) => void): Promise<Translation> {
  const report = (await cachedReport<{ refs: Ref[] }>(env, doc.id, to)) ?? (await buildReport(env, doc, to, waitUntil));
  const refs = (report.refs as Ref[]).filter((r) => r.a != null && r.b != null).sort((x, y) => x.a! - y.a!);
  const rows = await unitsByKeys(env.CORPUS, refs.flatMap((r) => (r.match ? [r.match.key] : [])));

  // Cut the quotes out of each paragraph (offsets follow lectureText(): paragraphs joined with "\n").
  const quotes: Extract<TPiece, { quote: unknown }>['quote'][] = [];
  const masked: string[] = [];
  let from = 0;
  for (const seg of doc.segments) {
    const to_ = from + seg.text.length;
    let text = '', last = 0;
    for (const r of refs.filter((r) => r.a! >= from && r.a! < to_)) {
      const a = r.a! - from, b = Math.min(r.b!, to_) - from;
      if (a < last) continue;
      text += seg.text.slice(last, a) + `⟦${quotes.length}⟧`;
      quotes.push(quoteFor(r, seg.text.slice(a, b), rows, to));
      last = b;
    }
    masked.push(text + seg.text.slice(last));
    from = to_ + 1;
  }

  // Translate in batches of paragraphs, in parallel.
  const batches: number[][] = [];
  let cur: number[] = [], size = 0;
  masked.forEach((p, i) => {
    if (cur.length && size + p.length > BATCH_CHARS) (batches.push(cur), (cur = []), (size = 0));
    cur.push(i);
    size += p.length;
  });
  if (cur.length) batches.push(cur);
  const system = SYSTEM.replaceAll('{LANGUAGE}', LANGUAGE[to]).replace('{TERMS}', TERMS.map((t) => t.forms[0]).join(', '));
  const usage = { input: 0, output: 0 };
  const out: string[] = [...masked];
  await Promise.all(
    batches.map(async (idx) => {
      const { data, usage: u } = await generateJSON<{ paragraphs: string[] }>(env, {
        model: env.LLM_MODEL,
        system,
        prompt: JSON.stringify({ paragraphs: idx.map((i) => masked[i]) }),
        schema: { type: 'OBJECT', properties: { paragraphs: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['paragraphs'] },
        thinking: 'low',
        timeoutMs: 90_000,
      });
      usage.input += u.input;
      usage.output += u.output;
      // A batch that comes back the wrong length is kept untranslated rather than misaligned.
      if (data.paragraphs.length === idx.length) idx.forEach((i, k) => (out[i] = data.paragraphs[k]));
    }),
  );

  // Put the quotes back.
  const paragraphs = out.map((p) =>
    p.split(/(⟦\d+⟧)/).flatMap((part): TPiece[] => {
      const m = /^⟦(\d+)⟧$/.exec(part);
      if (m && quotes[Number(m[1])]) return [{ quote: quotes[Number(m[1])] }];
      return part ? [{ text: part.replace(/⟦\d+⟧/g, '') }] : [];
    }),
  );
  return { to, paragraphs, usage };
}

function quoteFor(r: Ref, said: string, rows: Awaited<ReturnType<typeof unitsByKeys>>, to: Lang) {
  const row = r.match ? rows.get(r.match.key) : undefined;
  const ref = row ? reference(row, to) : null;
  const exact = r.status === 'verbatim' || r.status === 'weak_or_disputed';
  if (row && exact) {
    const published = to === 'en' ? row.en_text : to === 'id' ? row.id_text : row.ar_matn;
    if (published) return { key: row.key, reference: ref, status: r.status, text: published, lang: to, translated: to !== 'ar' };
    return { key: row.key, reference: ref, status: r.status, text: row.ar_matn, lang: 'ar', translated: false };
  }
  // Paraphrase, misquote, not found or a bare reference: what was said, as it was said.
  return { key: row?.key ?? null, reference: ref, status: r.status, text: said, lang: /[؀-ۿ]/.test(said) ? 'ar' : 'und', translated: false };
}
