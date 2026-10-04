import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { norm, stems, trigrams } from '../src/lib/arabic';

type Vector = { in: string; norm: string; stems: string; trigrams: string };
const load = (p: string): Vector[] => JSON.parse(readFileSync(new URL(p, import.meta.url).pathname, 'utf8'));

// Parity with tools/arabic.py, which built the corpus index.
const sets: [string, Vector[]][] = [['samples', load('./arabic-vectors.json')]];
const corpus = '../../data/test/arabic-vectors-corpus.json';
if (existsSync(new URL(corpus, import.meta.url).pathname)) sets.push(['corpus sample (local data)', load(corpus)]);

describe.each(sets)('arabic parity: %s', (_, vectors) => {
  it('norm / stems / trigrams match Python', () => {
    for (const v of vectors) {
      expect(norm(v.in)).toBe(v.norm);
      expect(stems(v.in)).toBe(v.stems);
      expect(trigrams(v.in)).toBe(v.trigrams);
    }
  });
});

describe('variant wordings meet', () => {
  it('مخموم and المخموم share a stem', () => {
    expect(stems('كُلُّ مَخْمُومِ الْقَلْبِ')).toContain('مخموم');
    expect(stems('ذُو الْقَلْبِ الْمَخْمُومِ')).toContain('مخموم');
  });
  it('Uthmani and imlaei spellings meet', () => {
    expect(stems('ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ')).toBe(stems('الحمد لله رب العالمين'));
  });
});
