// Local dev, optional: embed the sample corpus into the local D1 table local_vectors (Vectorize has no local mode).
//
//   bun run local:embed        # needs GEMINI_API_KEY in .dev.vars; uses EMBED_DIM from .dev.vars (768 by default)
//
// Same document format as tools/embed_batch.py: "title: {collection} {number} | text: {matn}".

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vars: Record<string, string> = {};
if (existsSync('.dev.vars'))
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
const KEY = process.env.GEMINI_API_KEY ?? vars.GEMINI_API_KEY;
const DIM = Number(vars.EMBED_DIM ?? 768);
if (!KEY) throw new Error('GEMINI_API_KEY missing: add it to .dev.vars (see .env.example)');

const wrangler = (...args: string[]) => execFileSync('bunx', ['wrangler', 'd1', 'execute', 'hadits-corpus', '--local', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
type Row = { key: string; kind: string; collection: string; number: string; ar_matn: string; grade_status: string };
const rows: Row[] = JSON.parse(wrangler('--json', '--command', 'SELECT key, kind, collection, number, ar_matn, grade_status FROM units'))[0].results;
console.log(`embedding ${rows.length} units at ${DIM} dimensions`);

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
const sql: string[] = ['DELETE FROM local_vectors;'];
for (let i = 0; i < rows.length; i += 100) {
  const part = rows.slice(i, i + 100);
  const model = 'models/gemini-embedding-2';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      requests: part.map((r) => ({ model, content: { parts: [{ text: `title: ${r.collection} ${r.number} | text: ${r.ar_matn.slice(0, 6000)}` }] }, outputDimensionality: DIM })),
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { embeddings } = (await res.json()) as { embeddings: { values: number[] }[] };
  part.forEach((r, k) => sql.push(`INSERT INTO local_vectors (id, kind, collection, grade, v) VALUES (${lit(r.key)}, ${lit(r.kind)}, ${lit(r.collection)}, ${lit(r.grade_status ?? '')}, ${lit(JSON.stringify(embeddings[k].values.map((x) => Math.round(x * 1e5) / 1e5)))});`));
  process.stdout.write(`\r${Math.min(i + 100, rows.length)}/${rows.length}`);
  await new Promise((r) => setTimeout(r, 1500)); // ≤ 40 calls a minute
}
const file = join(mkdtempSync(join(tmpdir(), 'hadits-')), 'vectors.sql');
writeFileSync(file, sql.join('\n'));
wrangler('--file', file);
console.log(`\nlocal_vectors filled; set LOCAL_VECTORS=1 in .dev.vars`);
