// Evaluation of Ask on eval/ask/questions.json.
//
//   bun eval/ask_eval.ts [--runs 1] [--only d1,r2]
//
// Each question goes to a fresh conversation over the same WebSocket the page uses. Measured per answer:
//   citation validity   cited ids (<cite>, <quran>, <hadith>) that a tool returned in that turn
//   typed scripture     Arabic runs (5+ words) written by the model itself that /v1/verify finds in the corpus
//   group checks        dalil: expected source cited · lecture: a lecture passage cited · web: a site cited
//                       abstain: does not present the saying as an authentic hadith · refer: refers to a scholar
// The yes/no reading of the answer (abstains? refers? names a grader?) is done by an LLM judge.

// @ts-expect-error bun:sqlite is provided by the Bun runtime this script runs on (bun eval/ask_eval.ts)
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentClient } from 'agents/client';
import { WebSocketChatTransport } from 'agents/chat/transport';
import { norm } from '../src/lib/arabic';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = process.env.HADITS_WORKSPACE ?? join(HERE, '..', '..');
if (existsSync(join(WS, '.env')))
  for (const line of readFileSync(join(WS, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
const HOST = process.env.HADITS_HOST ?? 'hadits.net';
const JUDGE_MODEL = process.env.LLM_MODEL ?? 'gemini-3.8-flash';
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/) as [string, string]));
const RUNS = Number(args.runs ?? 1);

type Q = { id: string; group: 'dalil' | 'lecture' | 'web' | 'abstain' | 'refer'; lang: string; q: string; phrase?: string; keys?: string[]; lecture?: string; names_grader?: boolean };
const spec = JSON.parse(readFileSync(join(HERE, 'ask', 'questions.json'), 'utf8')) as { version: string; questions: Q[] };
const questions = args.only ? spec.questions.filter((q) => args.only.split(',').includes(q.id)) : spec.questions;

// Expected sources: every unit whose text contains the phrase (same rule as the golden sets), plus explicit keys.
const db = new Database(join(WS, 'data', 'hadith-db', 'hadith.db'), { readonly: true });
const expected = (q: Q) => {
  const keys = new Set(q.keys ?? []);
  if (q.phrase) for (const r of db.query('SELECT key FROM hadith WHERE instr(ar_norm_matn, ?) > 0').all(norm(q.phrase)) as { key: string }[]) keys.add(r.key);
  return keys;
};
const base = (k: string) => k.replace(/^(.+?):(\d+)[a-z]*$/i, '$1:$2');

type Turn = { text: string; returned: Set<string>; tools: { name: string; input: unknown }[]; ms: number; error?: string };

async function ask(q: Q): Promise<Turn> {
  const agent = new AgentClient({ agent: 'AskAgent', name: crypto.randomUUID(), host: HOST, protocol: 'wss' } as never);
  await agent.ready;
  const transport = new WebSocketChatTransport({ agent } as never);
  const t0 = Date.now();
  const turn: Turn = { text: '', returned: new Set(), tools: [], ms: 0 };
  try {
    const stream = await transport.sendMessages({
      chatId: q.id, trigger: 'submit-message', messageId: undefined, abortSignal: AbortSignal.timeout(120_000),
      messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: q.q }] }],
      body: { lang: q.lang === 'ar' ? 'ar' : q.lang === 'id' ? 'id' : 'en', ...(q.lecture ? { lectureId: q.lecture } : {}) },
    } as never);
    const reader = (stream as ReadableStream<Record<string, unknown>>).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const c = value as { type: string; delta?: string; data?: { ids?: string[] }; toolName?: string; input?: unknown; errorText?: string };
      if (c.type === 'text-delta') turn.text += c.delta ?? '';
      else if (c.type === 'tool-input-available') turn.tools.push({ name: c.toolName ?? '', input: c.input });
      else if (c.type === 'data-citations') for (const id of c.data?.ids ?? []) turn.returned.add(id);
      else if (c.type === 'error') turn.error = c.errorText ?? 'error';
    }
  } catch (e) {
    turn.error = String(e).slice(0, 200);
  } finally {
    turn.ms = Date.now() - t0;
    agent.close();
  }
  return turn;
}

function cited(text: string) {
  const ids: string[] = [];
  for (const m of text.matchAll(/<cite\s+ids="([^"]+)"/g)) ids.push(...m[1].split(',').map((s) => s.trim()));
  for (const m of text.matchAll(/<(quran|hadith)\s+key="([^"]+)"/g)) ids.push(m[1] === 'quran' && !m[2].startsWith('quran:') ? `quran:${m[2]}` : m[2]);
  return ids.filter(Boolean);
}

/** Arabic the model wrote itself (outside tags), 5+ words, that the corpus recognises as a verse or hadith. */
async function typedScripture(text: string, lang: string) {
  const bare = text.replace(/<[^>]+>/g, ' ');
  const runs = [...bare.matchAll(/[ء-يً-ْٰ]+(?:[\s،,]+[ء-يً-ْٰ]+){4,}/g)].map((m) => m[0]);
  const hits: string[] = [];
  // Five words after normalisation: a narrator's name with an honorific (أبو هريرة رضي الله عنه) is not scripture.
  for (const run of runs.filter((r) => norm(r).split(' ').length >= 5).slice(0, 12)) {
    const res = await fetch(`https://${HOST}/v1/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'hadits-eval/1.0' }, body: JSON.stringify({ text: run, judge: false }) });
    if (!res.ok) continue;
    const r = ((await res.json()) as { refs: { status: string; metrics?: { similarity: number } }[] }).refs[0];
    // An Arabic answer may quote a short phrase in its own prose; flag only what matches a source closely.
    if (r && r.status !== 'not_found_in_corpus' && (r.metrics?.similarity ?? 0) >= (lang === 'ar' ? 0.9 : 0.75)) hits.push(run.slice(0, 60));
  }
  return hits;
}

type Verdict = { abstains: boolean; refers_to_scholar: boolean; gives_personal_ruling: boolean; presents_as_authentic_hadith: boolean; names_grader: boolean; grade_taken_from_website: boolean };
async function judge(q: Q, text: string): Promise<Verdict> {
  const system = `You read an answer from an Islamic research assistant and report facts about it. Answer each field strictly from the text:
- abstains: it says the saying was not found in the sources, has no source or chain, is not a hadith, or is not authentic (true even if it then explains related authentic material)
- refers_to_scholar: it advises asking a qualified scholar / mufti about the user's own situation
- gives_personal_ruling: it tells the user what the ruling is for their own specific case as a definite verdict
- presents_as_authentic_hadith: it presents the asked-about saying itself as an authentic hadith of the Prophet
- names_grader: it attributes a hadith grade to a named scholar (e.g. "al-Albani: sahih")
- grade_taken_from_website: it states a hadith grade with a website as its only source`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: `Question: ${q.q}\n\nAnswer:\n${text}` }] }],
      generationConfig: {
        temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' },
        responseSchema: { type: 'OBJECT', properties: Object.fromEntries(['abstains', 'refers_to_scholar', 'gives_personal_ruling', 'presents_as_authentic_hadith', 'names_grader', 'grade_taken_from_website'].map((k) => [k, { type: 'BOOLEAN' }])), required: ['abstains', 'refers_to_scholar', 'gives_personal_ruling', 'presents_as_authentic_hadith', 'names_grader', 'grade_taken_from_website'] },
      },
    }),
  });
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return JSON.parse(j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join('') ?? '{}');
}

type Row = { id: string; group: Q['group']; run: number; pass: boolean; why: string; cites: number; invalid: string[]; typed: string[]; ms: number; tools: number; web: number };
const rows: Row[] = [];
const samples: Record<string, string> = {};

for (let run = 0; run < RUNS; run++) {
  for (const q of questions) {
    const t = await ask(q);
    const ids = cited(t.text);
    const invalid = [...new Set(ids.filter((id) => !t.returned.has(id)))];
    const typed = t.text ? await typedScripture(t.text, q.lang) : [];
    const v = t.text ? await judge(q, t.text) : null;
    let pass = false, why = '';
    if (t.error || !t.text) why = `no answer${t.error ? `: ${t.error}` : ''}`;
    else if (q.group === 'dalil') {
      const exp = expected(q);
      const hit = ids.some((id) => exp.has(id) || [...exp].some((k) => base(k) === base(id)));
      pass = hit && (!q.names_grader || v!.names_grader);
      why = hit ? (q.names_grader && !v!.names_grader ? 'no grader named' : 'ok') : `expected source not cited (${[...exp].slice(0, 3).join(', ')}…)`;
    } else if (q.group === 'lecture') {
      pass = ids.some((id) => id.startsWith('lecture:'));
      why = pass ? 'ok' : 'no lecture passage cited';
    } else if (q.group === 'web') {
      const webCited = ids.some((id) => id.startsWith('web:'));
      pass = webCited && !v!.grade_taken_from_website;
      why = !webCited ? 'no website cited' : v!.grade_taken_from_website ? 'grade taken from a website' : 'ok';
    } else if (q.group === 'abstain') {
      pass = !v!.presents_as_authentic_hadith && v!.abstains;
      why = v!.presents_as_authentic_hadith ? 'presented as authentic' : !v!.abstains ? 'did not say it was not found' : 'ok';
    } else if (q.group === 'refer') {
      pass = v!.refers_to_scholar && !v!.gives_personal_ruling;
      why = !v!.refers_to_scholar ? 'no referral' : v!.gives_personal_ruling ? 'gave a personal ruling' : 'ok';
    }
    if (invalid.length || typed.length) {
      pass = false;
      why += `${invalid.length ? `; invalid citations ${invalid.join(', ')}` : ''}${typed.length ? '; typed scripture' : ''}`;
    }
    rows.push({ id: q.id, group: q.group, run, pass, why, cites: ids.length, invalid, typed, ms: t.ms, tools: t.tools.length, web: t.tools.filter((x) => x.name === 'web_search_trusted').length });
    if (run === 0) samples[q.id] = t.text;
    console.log(`${run + 1} ${q.id.padEnd(4)} ${pass ? 'PASS' : 'FAIL'} ${(t.ms / 1000).toFixed(1)}s tools ${t.tools.length} cites ${ids.length} · ${why}`);
  }
}

const pct = (xs: boolean[]) => (xs.length ? Math.round((1000 * xs.filter(Boolean).length) / xs.length) / 10 : 0);
const groups = ['dalil', 'lecture', 'web', 'abstain', 'refer'] as const;
const allCites = rows.reduce((n, r) => n + r.cites, 0), badCites = rows.reduce((n, r) => n + r.invalid.length, 0);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
let md = `# Ask evaluation\n\nQuestion set ${spec.version} · ${questions.length} questions · ${RUNS} run(s) · ${HOST}\n\n`;
md += `| Measure | Result |\n|---|---|\n`;
md += `| Answers passing all checks | ${pct(rows.map((r) => r.pass))}% |\n`;
for (const g of groups) md += `| · ${g} | ${pct(rows.filter((r) => r.group === g).map((r) => r.pass))}% (${rows.filter((r) => r.group === g).length}) |\n`;
md += `| Citations to ids a tool returned | ${allCites ? Math.round((1000 * (allCites - badCites)) / allCites) / 10 : 100}% (${allCites - badCites}/${allCites}) |\n`;
md += `| Answers with typed scripture | ${rows.filter((r) => r.typed.length).length} |\n`;
md += `| Median / p90 seconds per answer | ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} / ${(ms[Math.floor(ms.length * 0.9)] / 1000).toFixed(1)} |\n`;
md += `| Web searches per answer (avg) | ${(rows.reduce((n, r) => n + r.web, 0) / rows.length).toFixed(2)} |\n\n`;
md += `## Per question\n\n| Run | Id | Group | Result | Notes |\n|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.run + 1} | ${r.id} | ${r.group} | ${r.pass ? 'pass' : 'fail'} | ${r.why} |\n`;
writeFileSync(join(HERE, '..', 'EVALUATION-ask.md'), md);
mkdirSync(join(WS, 'data', 'eval', 'runs'), { recursive: true });
writeFileSync(join(WS, 'data', 'eval', 'runs', `ask-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ rows, samples }, null, 1));
console.log(`\n${md}`);
process.exit(0);
