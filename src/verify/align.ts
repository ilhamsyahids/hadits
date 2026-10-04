import { skeleton, stem } from '../lib/arabic';

// Step 3: local alignment (Smith-Waterman) of the spoken words against a source text, both as norm() words.
// A pair scores by how close the words are:
//   same     identical skeleton (Uthmani vs imlaei spelling counts as same)          +2
//   variant  same light stem, different surface (مخموم / المخموم, but also كم / هم!)   +1
//   near     character similarity ≥ 0.75 (ASR slip, one-letter change)               +0.5
//   other    mismatch −1, gap −1
// Pronoun suffixes change meaning, so a stem-only match is a "variant", not "same": a quote that swaps
// خيركم for خيرهم is no longer verbatim and goes to the judge.

export type Op = { op: 'same' | 'variant' | 'changed' | 'extra' | 'missing'; spoken?: string; source?: string };

export type Alignment = {
  score: number;
  similarity: number; // 0..1, penalises changed, extra and skipped words
  coverage: number; // share of spoken words found in the source (same/variant/near)
  same: number;
  variant: number;
  near: number;
  changed: number;
  extra: number;
  missing: number;
  srcFrom: number; // aligned window in the source, word indexes
  srcTo: number;
  ops: Op[];
};

type Tok = { w: string; sk: string; st: string };
const tok = (w: string): Tok => ({ w, sk: skeleton(w), st: stem(w) });

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

type Rel = 'same' | 'variant' | 'near' | 'other';
function relate(a: Tok, b: Tok): Rel {
  if (a.sk === b.sk) return 'same';
  if (a.st === b.st && a.st.length >= 2) return 'variant';
  const m = Math.max(a.sk.length, b.sk.length);
  if (m >= 4 && 1 - lev(a.sk, b.sk) / m >= 0.75) return 'near';
  return 'other';
}
const SCORE: Record<Rel, number> = { same: 2, variant: 1, near: 0.5, other: -1 };
const GAP = -1;
const MAX_SOURCE = 4000;

export function align(spokenWords: string[], sourceWords: string[]): Alignment {
  const S = spokenWords.map(tok);
  const T = sourceWords.slice(0, MAX_SOURCE).map(tok);
  const n = S.length, m = T.length;
  const W = m + 1;
  const H = new Float32Array((n + 1) * W);
  const back = new Uint8Array((n + 1) * W); // 0 stop, 1 diag, 2 up (extra spoken), 3 left (missing source)
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = H[(i - 1) * W + j - 1] + SCORE[relate(S[i - 1], T[j - 1])];
      const u = H[(i - 1) * W + j] + GAP;
      const l = H[i * W + j - 1] + GAP;
      let v = 0, b = 0;
      if (d > v) { v = d; b = 1; }
      if (u > v) { v = u; b = 2; }
      if (l > v) { v = l; b = 3; }
      H[i * W + j] = v;
      back[i * W + j] = b;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }

  const ops: Op[] = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && back[i * W + j] !== 0) {
    const b = back[i * W + j];
    if (b === 1) {
      const r = relate(S[i - 1], T[j - 1]);
      ops.push({ op: r === 'same' ? 'same' : r === 'variant' ? 'variant' : 'changed', spoken: S[i - 1].w, source: T[j - 1].w });
      i--; j--;
    } else if (b === 2) {
      ops.push({ op: 'extra', spoken: S[i - 1].w });
      i--;
    } else {
      ops.push({ op: 'missing', source: T[j - 1].w });
      j--;
    }
  }
  ops.reverse();
  const srcFrom = j, srcTo = bj;
  // Spoken words outside the aligned window are extra too.
  const head: Op[] = S.slice(0, i).map((t) => ({ op: 'extra', spoken: t.w }));
  const tail: Op[] = S.slice(bi).map((t) => ({ op: 'extra', spoken: t.w }));
  const all = [...head, ...ops, ...tail];

  let same = 0, variant = 0, near = 0, changed = 0, extra = 0, missing = 0;
  for (const o of all) {
    if (o.op === 'same') same++;
    else if (o.op === 'variant') variant++;
    else if (o.op === 'extra') extra++;
    else if (o.op === 'missing') missing++;
    else if (o.op === 'changed') {
      if (relate(tok(o.spoken!), tok(o.source!)) === 'near') near++;
      else changed++;
    }
  }
  const similarity = n === 0 ? 0 : (same + 0.75 * variant + 0.5 * near) / (n + missing);
  const coverage = n === 0 ? 0 : (same + variant + near) / n;
  return { score: best, similarity, coverage, same, variant, near, changed, extra, missing, srcFrom, srcTo, ops: all };
}
