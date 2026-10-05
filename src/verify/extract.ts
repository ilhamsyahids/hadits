import type { Bindings } from '../env';
import { generateJSON, type Usage } from '../lib/gemini';
import { parseCitations } from '../search/refparse';
import { lectureText, makeSpan, type Segment, type Span, spokenWords } from './detect';

// Step 1 (LLM): find quotes the rules cannot see: a dalil given only by its meaning ("Nabi bersabda bahwa puasa
// itu perisai"), Latin transliteration ("innamal a'malu binniyat"), and the exact edges of a quote inside an
// Arabic lecture. The model only points at text: every quote must be found verbatim in the transcript or it is
// dropped. It never supplies scripture; matching, status and grades still come from the database.

const MIN_MEANING_WORDS = 4;

const SYSTEM = `You find every place in a lecture transcript where the speaker quotes or cites the Quran, a hadith, or a saying presented as a hadith.
For each one return:
- segment: the number in brackets of the segment where it is said
- quote: copy the quoted words exactly as they appear in that segment, character for character. Arabic quotes: only the quoted words, without the introduction (قال رسول الله ﷺ، Allah berfirman, Rasulullah bersabda) and without the reference after it. Meaning-only: the sentence part that gives the meaning. Do not fix spelling, do not translate, do not add words.
- form: "arabic" (Arabic words are quoted), "meaning" (only the meaning is given in another language, no Arabic), "transliteration" (Arabic words written in Latin letters), "reference" (only a reference such as QS 2:255 or HR Muslim 1, nothing quoted)
- kind: "quran", "hadith" or "unknown"
- reference: the reference said with it, exactly as said (e.g. "HR Bukhari", "[البقرة:203]"), or null
- arabic: only for "transliteration": the same words written in Arabic letters as pronounced; otherwise null
Skip greetings, du'a and the lecturer's own words. Do not judge authenticity.
Only quote the content of a verse or report. Skip: single words or short labels (a definition or translation of a term, such as "God-consciousness"), headings, and the author's paraphrase of a scholar's opinion. When a dialogue is quoted, return the whole exchange as one item, not each line.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          segment: { type: 'INTEGER' },
          quote: { type: 'STRING' },
          form: { type: 'STRING', enum: ['arabic', 'meaning', 'transliteration', 'reference'] },
          kind: { type: 'STRING', enum: ['quran', 'hadith', 'unknown'] },
          reference: { type: 'STRING', nullable: true },
          arabic: { type: 'STRING', nullable: true },
        },
        required: ['segment', 'quote', 'form', 'kind'],
      },
    },
  },
  required: ['items'],
};

type Item = { segment: number; quote: string; form: 'arabic' | 'meaning' | 'transliteration' | 'reference'; kind: 'quran' | 'hadith' | 'unknown'; reference?: string | null; arabic?: string | null };

/** Where `quote` occurs in segment `seg` (exact, then whitespace-insensitive); null if the model made it up. */
function locate(full: string, segStart: number[], seg: number, quote: string): { a: number; b: number } | null {
  const from = segStart[seg] ?? -1;
  if (from < 0 || !quote.trim()) return null;
  const to = segStart[seg + 1] ?? full.length;
  const text = full.slice(from, to);
  const q = quote.trim();
  const i = text.indexOf(q);
  if (i >= 0) return { a: from + i, b: from + i + q.length };
  const parts = q.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const m = text.match(new RegExp(parts.join('\\s+')));
  return m?.index !== undefined ? { a: from + m.index, b: from + m.index + m[0].length } : null;
}

export async function extract(env: Bindings, segments: Segment[]): Promise<{ spans: Span[]; usage: Usage; dropped: number }> {
  const text = lectureText(segments);
  const prompt = segments.map((s, i) => `[${i}] ${s.text}`).join('\n');
  const { data, usage } = await generateJSON<{ items: Item[] }>(env, {
    model: env.EXTRACT_MODEL ?? env.LLM_MODEL_LITE,
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    thinking: 'minimal',
    // Long lectures: the output grows with the number of quotes. Past this, verify falls back to the rules.
    timeoutMs: Math.min(25_000, 6_000 + segments.length * 150),
  });
  const spans: Span[] = [];
  let dropped = 0;
  for (const it of data.items ?? []) {
    const at = locate(text.full, text.segStart, it.segment, it.quote);
    if (!at) {
      dropped++;
      continue;
    }
    const cue = it.kind === 'unknown' ? null : it.kind;
    const citation = it.reference ? parseCitations(it.reference)[0] : undefined;
    const spoken = text.full.slice(at.a, at.b);
    if (it.form === 'reference') {
      const c = parseCitations(spoken)[0] ?? citation;
      if (c && (c.kind === 'quran' || c.number)) spans.push(makeSpan(segments, text, at, { spoken, words: [], cue: c.kind, citation: c, detector: 'llm' }));
      continue;
    }
    if (it.form === 'meaning') {
      // A meaning needs a clause to be checkable: "Yes." or "virtue" would match some report by chance.
      if (spoken.split(/\s+/).filter(Boolean).length < MIN_MEANING_WORDS) {
        dropped++;
        continue;
      }
      spans.push(makeSpan(segments, text, at, { spoken, words: [], meaning: spoken, cue, citation, detector: 'llm' }));
      continue;
    }
    // Arabic quote, or a transliteration read back in Arabic letters (the speaker's words, not scripture from the model).
    const words = spokenWords(it.form === 'transliteration' ? it.arabic ?? '' : spoken);
    if (words.length < 2) {
      dropped++;
      continue;
    }
    spans.push(makeSpan(segments, text, at, { spoken, words, cue, citation, detector: 'llm' }));
  }
  return { spans, usage, dropped };
}

/**
 * Rules + LLM. LLM spans win where they overlap a rule span (tighter edges, meaning-only, transliteration), but a
 * citation the rules attached is kept. Rule spans the model missed are kept as well.
 */
export function mergeSpans(rules: Span[], llm: Span[]): Span[] {
  const out = llm.map((l) => {
    const twin = rules.find((r) => r.a < l.b && l.a < r.b);
    return twin && !l.citation && twin.citation ? { ...l, citation: twin.citation, cue: l.cue ?? twin.cue } : l;
  });
  for (const r of rules) if (!llm.some((l) => r.a < l.b && l.a < r.b)) out.push(r);
  return out.sort((x, y) => x.a - y.a).map((s, i) => ({ ...s, id: i }));
}
