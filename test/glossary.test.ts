import { describe, expect, it } from 'vitest';
import { termPieces } from '../src/lib/glossary';

const terms = (s: string) => termPieces(s).filter((p) => p.term).map((p) => p.term!.id);

describe('termPieces', () => {
  it('finds English and Indonesian spellings, first occurrence only', () => {
    expect(terms('Taqwa is the aim of fasting; taqwa grows with zikir and sedekah.')).toEqual(['taqwa', 'dhikr', 'sadaqah']);
    expect(terms('Jadi patokan iktidal sempurna, lalu tasmih dan tahmid.')).toEqual(['itidal', 'tasmi', 'tahmid']);
  });
  it('skips names, parts of words and same-spelled words', () => {
    expect(terms('Dua-duanya boleh, lalu doa.')).toEqual(['dua']);
    expect(terms('Al-Hasan narrated it from Haji Ahmad.')).toEqual([]);
    expect(terms('The sunnahs, a hadithic style.')).toEqual([]);
    expect(terms("Graded hasan by al-Albani; da'if per others.")).toEqual(['hasan', 'daif']);
  });
  it('keeps the text unchanged', () => {
    const s = 'Ikhlas, iman and ihsan.';
    expect(termPieces(s).map((p) => p.text).join('')).toBe(s);
  });
});
