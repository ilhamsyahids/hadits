// Three-arm evaluation on the synthetic golden set (eval/golden/lectures.json → ../data/eval/golden-v1.json).
//
//   bun run eval --golden v2 --arms dalil,plain,majelisnote --runs 3 [--lectures id,id]
//
// Arms:
//   dalil        POST /v1/verify on hadits.net (or HADITS_URL)
//   plain        Gemini asked directly to find, source, classify and grade every quote (no retrieval)
//   majelisnote  the MajelisNote summary prompt as of the baseline (references "from the model's own knowledge"),
//                then a second call extracts what the note claims for each quote
// Both LLM arms use the same model as Dalil's judge (LLM_MODEL). Results: ../data/eval/runs/*.json + EVALUATION.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionByAlias } from '../src/corpus/collections';
import { stems } from '../src/lib/arabic';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = process.env.HADITS_WORKSPACE ?? join(HERE, '..', '..');
// Secrets from the workspace .env (Bun only auto-loads ./.env).
if (existsSync(join(WS, '.env')))
  for (const line of readFileSync(join(WS, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
const HADITS = process.env.HADITS_URL ?? 'https://hadits.net';
const MODEL = process.env.LLM_MODEL ?? 'gemini-3.8-flash';
const EXTRACT_MODEL = process.env.LLM_MODEL_LITE ?? 'gemini-3.5-flash-lite';
const KEY = process.env.GEMINI_API_KEY!;

type Status = 'verbatim' | 'paraphrase' | 'misquote' | 'weak_or_disputed' | 'not_found_in_corpus' | 'reference';
type Item = { name: string; segment: number; quote: string; source: string | null; kind: 'quran' | 'hadith'; expect: { status: Status; status_any?: Status[]; keys: string[]; citation_agrees?: boolean } };
type Lecture = { id: string; title: string; lang: string; segments: { start: number; end: number; speaker: string; text: string }[]; items: Item[] };
type Pred = { snippet: string; key: string | null; status: Status | 'none'; grade: string | null; citation_agrees?: boolean | null };
type ArmOut = { preds: Pred[]; ms: number; tokens: { input: number; output: number } };

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/) as [string, string]));
const ARMS = (args.arms ?? 'dalil,plain,majelisnote').split(',');
const RUNS = Number(args.runs ?? 1);
const GOLDEN = args.golden ?? 'v1';
const golden: { version: string; lectures: Lecture[] } = JSON.parse(readFileSync(join(WS, 'data', 'eval', `golden-${GOLDEN}.json`), 'utf8'));
const lectures = args.lectures ? golden.lectures.filter((l) => args.lectures.split(',').includes(l.id)) : golden.lectures;

// ---------------------------------------------------------------- Gemini (direct; the eval runs offline)
async function gemini(model: string, system: string, prompt: string, schema?: unknown) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}), thinkingConfig: { thinkingLevel: 'low' } },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`gemini ${res.status}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: Record<string, number> };
    const text = j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
    const u = j.usageMetadata ?? {};
    return { text, tokens: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
  }
}

const transcriptText = (l: Lecture) => l.segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n');
const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** "Muslim" + "2564" / surah 26 ayah 88 → a corpus key. */
function toKey(kind: string, collection: string | null, number: string | null, surah: number | null, ayah: number | null): string | null {
  if (kind === 'quran' && surah && ayah) return `quran:${surah}:${ayah}`;
  if (!collection || !number) return null;
  // "Sahih al-Bukhari", "Jami' at-Tirmidhi", "Sunan Ibn Majah": try the name, then without its title words.
  const words = collection.split(/[\s'’-]+/).filter(Boolean);
  const TITLE = /^(sahih|shahih|sunan|jami|jamiat|musnad|imam|al|at|an|as|ad|ar|ash|the)$/i;
  const c = collectionByAlias(collection) ?? collectionByAlias(words.filter((w) => !TITLE.test(w)).join('')) ?? collection.toLowerCase().replace(/[^a-z-]/g, '');
  const n = String(number).match(/\d+[a-z]?/i)?.[0];
  return n ? `${c}:${n.toLowerCase()}` : null;
}

const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          quote: { type: 'STRING', description: 'the Arabic exactly as it appears, or the spoken reference if no Arabic was quoted' },
          kind: { type: 'STRING', enum: ['quran', 'hadith'] },
          collection: { type: 'STRING', nullable: true },
          number: { type: 'STRING', nullable: true },
          surah: { type: 'INTEGER', nullable: true },
          ayah: { type: 'INTEGER', nullable: true },
          status: { type: 'STRING', enum: ['verbatim', 'paraphrase', 'misquote', 'weak_or_disputed', 'not_found_in_corpus', 'reference', 'none'] },
          grade: { type: 'STRING', nullable: true, description: 'sahih / hasan / daif / mawdu / null when no grade is claimed' },
        },
        required: ['quote', 'kind', 'status'],
      },
    },
  },
  required: ['items'],
};

type LlmItem = { quote: string; kind: string; collection?: string | null; number?: string | null; surah?: number | null; ayah?: number | null; status: Status | 'none'; grade?: string | null };
/** Structured call with one retry; a second malformed answer counts as "found nothing" (recorded in failures). */
const failures: string[] = [];
async function geminiItems(model: string, system: string, prompt: string, label: string) {
  let tokens = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await gemini(model, system, prompt, ITEM_SCHEMA);
    tokens = { input: tokens.input + r.tokens.input, output: tokens.output + r.tokens.output };
    try {
      return { items: JSON.parse(r.text).items as LlmItem[], tokens };
    } catch {
      failures.push(`${label}: malformed JSON (attempt ${attempt + 1})`);
    }
  }
  return { items: [] as LlmItem[], tokens };
}

const toPreds = (items: LlmItem[]): Pred[] =>
  items.map((i) => ({ snippet: i.quote, key: toKey(i.kind, i.collection ?? null, i.number ?? null, i.surah ?? null, i.ayah ?? null), status: i.status, grade: i.grade ?? null }));

// ---------------------------------------------------------------- arms
const armDalil = (detector?: 'rules' | 'llm' | 'hybrid') => async (l: Lecture): Promise<ArmOut> => {
  const t0 = Date.now();
  const res = await fetch(`${HADITS}/v1/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'hadits-eval/1.0' },
    body: JSON.stringify({ transcript: { segments: l.segments }, nocache: true, ...(detector ? { detector } : {}) }),
  });
  if (!res.ok) throw new Error(`verify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { refs: { spoken: string; status: Status; match?: { key: string; range?: string[] }; grade_summary?: { status: string }; citation?: { agrees: boolean | null } }[]; usage: { input: number; output: number } };
  return {
    preds: j.refs.map((r) => ({ snippet: r.spoken, key: r.match?.key ?? null, status: r.status, grade: r.match ? r.grade_summary?.status ?? null : null, citation_agrees: r.citation?.agrees ?? undefined })),
    ms: Date.now() - t0,
    tokens: j.usage,
  };
};

const PLAIN_SYSTEM = `You are an expert in hadith sciences and the Quran. Read the lecture transcript and list every Quran verse and every hadith (or saying presented as a hadith) that the speaker quotes or cites.
For each: copy the Arabic exactly as the speaker said it; give the source (Quran: surah and ayah number; hadith: collection and hadith number); classify the quote as verbatim (matches the source text), paraphrase (same meaning, different wording), misquote (a word changes the meaning), weak_or_disputed (a weak or disputed hadith), not_found_in_corpus (not a real verse or hadith / no known source), or reference (only a citation without quoting); and give the hadith grade.`;

async function armPlain(l: Lecture): Promise<ArmOut> {
  const t0 = Date.now();
  const { items, tokens } = await geminiItems(MODEL, PLAIN_SYSTEM, `Title: ${l.title}\n\nTranscript:\n${transcriptText(l)}`, `plain/${l.id}`);
  return { preds: toPreds(items), ms: Date.now() - t0, tokens };
}

const EXTRACT_SYSTEM = `You read a formatted lecture note and report, for each Quran verse and hadith shown in it, exactly what the note claims. Do not use your own knowledge and do not judge whether the note is right.
For each item: the Arabic as written in the note (or the reference if no Arabic is shown); the reference the note gives (collection + number, or surah + ayah); the grade the note states (null if none). status: "not_found_in_corpus" if the note says it has no source or is not a hadith; "weak_or_disputed" if the note says it is weak/da'if/disputed; "misquote" if the note says the speaker quoted it wrongly; otherwise "verbatim".`;

async function armMajelisNote(l: Lecture): Promise<ArmOut> {
  const t0 = Date.now();
  const tpl = readFileSync(join(WS, 'data', 'eval', `majelisnote-summary-prompt-${l.lang === 'en' ? 'en' : 'id'}.txt`), 'utf8');
  const prompt = tpl.replace('{{title}}', l.title).replace('{{transcript}}', l.segments.map((s) => s.text).join('\n'));
  const note = await gemini(MODEL, '', prompt);
  if (!note.text.trim()) {
    // The baseline sometimes returns an empty note: it then claims nothing about any quote.
    failures.push(`majelisnote/${l.id}: empty note`);
    return { preds: [], ms: Date.now() - t0, tokens: note.tokens };
  }
  const ex = await geminiItems(EXTRACT_MODEL, EXTRACT_SYSTEM, note.text, `majelisnote/${l.id}`);
  return {
    preds: toPreds(ex.items),
    ms: Date.now() - t0,
    tokens: { input: note.tokens.input + ex.tokens.input, output: note.tokens.output + ex.tokens.output },
  };
}

const ARM_FNS: Record<string, (l: Lecture) => Promise<ArmOut>> = {
  dalil: armDalil(), 'dalil-rules': armDalil('rules'), 'dalil-llm': armDalil('llm'), plain: armPlain, majelisnote: armMajelisNote,
};

// ---------------------------------------------------------------- scoring
const stemSet = (s: string) => new Set(stems(s).split(' ').filter((t) => t.length >= 2));
// Arabic quotes pair by stem overlap; meaning-only and transliterated items (no Arabic) pair by Latin words.
const latinSet = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3));
function overlap(a: string, b: string): number {
  const arabic = /[\u0600-\u06ff]/.test(a);
  const A = arabic ? stemSet(a) : latinSet(a), B = arabic ? stemSet(b) : latinSet(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}
const base = (k: string) => k.replace(/^(.+?):(\d+)[a-z]*(?:[-~].*)?$/i, '$1:$2').toLowerCase();
const sameKey = (pred: string | null, keys: string[]) => !!pred && keys.some((k) => k === pred || base(k) === base(pred));
const REAL_GRADE = /sahih|shahih|hasan|daif|da'if|dhaif|weak|mawdu|maudhu|fabricat|sound|good|authentic/i;

/** One-to-one assignment of predictions to planted items: Arabic overlap, or the key for reference-only items. */
function assign(items: Item[], preds: Pred[]) {
  const pairs: { i: number; p: number; s: number }[] = [];
  items.forEach((it, i) =>
    preds.forEach((pr, p) => {
      let s = overlap(it.quote, pr.snippet);
      if (it.expect.status === 'reference' && sameKey(pr.key, it.expect.keys)) s = Math.max(s, 0.9);
      if (s >= 0.4) pairs.push({ i, p, s });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);
  const byItem = new Map<number, number>(), usedP = new Set<number>();
  for (const x of pairs) if (!byItem.has(x.i) && !usedP.has(x.p)) (byItem.set(x.i, x.p), usedP.add(x.p));
  return { byItem, extra: preds.length - usedP.size };
}

type Row = { lecture: string; item: string; expected: Status; got: Status | 'none' | 'missed'; status_ok: boolean; source_ok: boolean; invented_grade: boolean; citation_ok?: boolean; pred_key: string | null; keys: string[] };

function score(l: Lecture, out: ArmOut) {
  const { byItem, extra } = assign(l.items, out.preds);
  const rows: Row[] = l.items.map((it, i) => {
    const p = byItem.has(i) ? out.preds[byItem.get(i)!] : null;
    const got = p?.status ?? 'missed';
    const nf = it.expect.status === 'not_found_in_corpus';
    const statusOk = got === it.expect.status || (it.expect.status_any ?? []).includes(got as Status) || (nf && got === 'missed');
    const sourceOk = nf ? !p || !p.key || p.status === 'not_found_in_corpus' : sameKey(p?.key ?? null, it.expect.keys);
    const asserted = !!p?.grade && REAL_GRADE.test(p.grade) && !/ungraded|quran/.test(p.grade);
    const invented = it.kind === 'hadith' && asserted && (nf || (it.expect.status === 'weak_or_disputed' && /^(sahih|shahih|sound|authentic|hasan)/i.test(p!.grade!)));
    return {
      lecture: l.id, item: it.name, expected: it.expect.status, got, status_ok: statusOk, source_ok: sourceOk, invented_grade: invented,
      // Only Dalil checks spoken citations; the LLM arms have no such output (n/a, not 0).
      ...(it.expect.citation_agrees !== undefined && out.preds.some((x) => x.citation_agrees !== undefined) ? { citation_ok: p?.citation_agrees === it.expect.citation_agrees } : {}),
      pred_key: p?.key ?? null, keys: it.expect.keys.slice(0, 5),
    };
  });
  return { rows, extra };
}

function summarise(rows: Row[], extra: number, outs: ArmOut[]) {
  const pct = (xs: boolean[]) => (xs.length ? Math.round((1000 * xs.filter(Boolean).length) / xs.length) / 10 : null);
  const vn = rows.filter((r) => r.expected === 'verbatim' || r.expected === 'not_found_in_corpus');
  const byStatus: Record<string, number | null> = {};
  for (const s of ['verbatim', 'paraphrase', 'misquote', 'weak_or_disputed', 'not_found_in_corpus', 'reference'])
    byStatus[s] = pct(rows.filter((r) => r.expected === s).map((r) => r.status_ok));
  const cit = rows.filter((r) => r.citation_ok !== undefined);
  const hadith = rows.filter((r) => !r.keys.some((k) => k.startsWith('quran:')));
  return {
    items: rows.length,
    detected: pct(rows.map((r) => r.got !== 'missed' || r.expected === 'not_found_in_corpus')),
    extra_predictions: extra,
    status_accuracy: pct(rows.map((r) => r.status_ok)),
    verbatim_notfound_accuracy: pct(vn.map((r) => r.status_ok)),
    status_by_expected: byStatus,
    source_accuracy: pct(rows.map((r) => r.source_ok)),
    invented_grade_rate: pct(hadith.map((r) => r.invented_grade)),
    abstention_accuracy: byStatus.not_found_in_corpus,
    citation_check_accuracy: cit.length ? pct(cit.map((r) => r.citation_ok!)) : null,
    avg_ms_per_lecture: Math.round(outs.reduce((a, o) => a + o.ms, 0) / outs.length),
    tokens: outs.reduce((a, o) => ({ input: a.input + o.tokens.input, output: a.output + o.tokens.output }), { input: 0, output: 0 }),
  };
}

// ---------------------------------------------------------------- main
const started = new Date().toISOString();

// --rescore <results.json>: score the saved predictions of an earlier run again (no arm is called).
if (args.rescore) {
  const prev = JSON.parse(readFileSync(args.rescore, 'utf8')) as { arms: Record<string, { preds: Record<string, Pred[]>[] }> };
  for (const arm of Object.keys(prev.arms)) ARM_FNS[arm] = async () => { throw new Error('rescore only'); };
  (globalThis as { RESCORE?: typeof prev }).RESCORE = prev;
}
const results: Record<string, { runs: ReturnType<typeof summarise>[]; rows: Row[]; preds: Record<string, Pred[]>[] }> = {};
for (const arm of ARMS) {
  results[arm] = { runs: [], rows: [], preds: [] };
  for (let run = 0; run < RUNS; run++) {
    const rows: Row[] = [];
    const outs: ArmOut[] = [];
    const preds: Record<string, Pred[]> = {};
    let extra = 0;
    for (const l of lectures) {
      const saved = (globalThis as { RESCORE?: { arms: Record<string, { preds: Record<string, Pred[]>[] }> } }).RESCORE?.arms[arm]?.preds[run]?.[l.id];
      const out = saved ? { preds: saved, ms: 0, tokens: { input: 0, output: 0 } } : await ARM_FNS[arm](l);
      const s = score(l, out);
      rows.push(...s.rows);
      outs.push(out);
      preds[l.id] = out.preds;
      extra += s.extra;
      process.stdout.write(`${arm} run ${run + 1} ${l.id}: ${s.rows.filter((r) => r.status_ok).length}/${s.rows.length} (${out.ms} ms)\n`);
    }
    results[arm].runs.push(summarise(rows, extra, outs));
    results[arm].preds.push(preds);
    if (run === 0) results[arm].rows = rows;
  }
}

mkdirSync(join(WS, 'data', 'eval', 'runs'), { recursive: true });
const file = join(WS, 'data', 'eval', 'runs', `${started.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ started, golden: golden.version, hadits: HADITS, model: MODEL, arms: results, failures }, null, 1));

const table = (key: keyof ReturnType<typeof summarise>) =>
  ARMS.map((a) => {
    const v = results[a].runs.map((r) => r[key]);
    const nums = v.filter((x): x is number => typeof x === 'number');
    if (!nums.length) return '–';
    const lo = Math.min(...nums), hi = Math.max(...nums);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  });
const metrics: [string, keyof ReturnType<typeof summarise>][] = [
  ['Status correct (all items), %', 'status_accuracy'],
  ['Status correct (verbatim + not found), %', 'verbatim_notfound_accuracy'],
  ['Correct source, %', 'source_accuracy'],
  ['Invented grade (hadith items), %', 'invented_grade_rate'],
  ['Not-found correctly flagged, %', 'abstention_accuracy'],
  ['Citation check correct, %', 'citation_check_accuracy'],
  ['Detected, %', 'detected'],
  ['Extra predictions', 'extra_predictions'],
  ['Avg ms per lecture', 'avg_ms_per_lecture'],
];
const names: Record<string, string> = { dalil: 'Dalil (hybrid)', 'dalil-rules': 'Dalil (rules only)', 'dalil-llm': 'Dalil (LLM extraction only)', plain: 'Plain LLM', majelisnote: 'MajelisNote (baseline prompt)' };
let md = `# Evaluation\n\nRun ${started} · golden set ${golden.version} (${lectures.length} synthetic lectures, ${lectures.reduce((n, l) => n + l.items.length, 0)} planted items) · ${RUNS} run(s) per arm · model ${MODEL}\n\n`;
md += `| Metric | ${ARMS.map((a) => names[a] ?? a).join(' | ')} |\n|---|${ARMS.map(() => '---').join('|')}|\n`;
for (const [label, key] of metrics) md += `| ${label} | ${table(key).join(' | ')} |\n`;
md += `\nRanges show min–max across runs.\n\n## Status accuracy by expected status (%)\n\n| Expected | ${ARMS.map((a) => names[a] ?? a).join(' | ')} |\n|---|${ARMS.map(() => '---').join('|')}|\n`;
for (const s of ['verbatim', 'paraphrase', 'misquote', 'weak_or_disputed', 'not_found_in_corpus', 'reference'])
  md += `| ${s} | ${ARMS.map((a) => results[a].runs[0].status_by_expected[s] ?? '–').join(' | ')} |\n`;
md += `\n## Failures (first run)\n\n| Arm | Lecture | Item | Expected | Got | Predicted key | Accepted keys |\n|---|---|---|---|---|---|---|\n`;
for (const a of ARMS) for (const r of results[a].rows.filter((r) => !r.status_ok || !r.source_ok)) md += `| ${names[a] ?? a} | ${r.lecture} | ${r.item} | ${r.expected} | ${r.got} | ${r.pred_key ?? ''} | ${r.keys.join(', ')} |\n`;
if (failures.length) md += `\n## Arm failures\n\n${failures.map((f) => `- ${f}`).join('\n')}\n`;
writeFileSync(join(HERE, '..', GOLDEN === 'v1' ? 'EVALUATION.md' : `EVALUATION-${GOLDEN}.md`), md);
console.log(`\n${md}\nresults → ${file}`);
