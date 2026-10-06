import { describe, expect, it } from 'vitest';
import { extraTerm, termPieces } from '../src/lib/glossary';

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
  it('adds terms the model found in this text; the curated meaning wins', () => {
    const extra = [extraTerm('muttaqin', 'Those who have taqwa.'), extraTerm('taqwa', 'model gloss')];
    const ids = termPieces('The muttaqin have taqwa.', new Set(), extra).filter((p) => p.term).map((p) => [p.term!.id, p.term!.en]);
    expect(ids).toEqual([['x:muttaqin', 'Those who have taqwa.'], ['taqwa', 'Mindfulness of Allah that leads a person to obey Him and avoid what He forbids.']]);
  });
  it('tags model terms in Arabic text without the curated list', () => {
    const extra = [extraTerm('التقوى', 'Taqwa.')];
    expect(termPieces('أوصيكم بالتقوى وبالتقوى', new Set(), extra, false).filter((p) => p.term).length).toBe(0);
    expect(termPieces('أوصيكم ب التقوى في السر', new Set(), extra, false).filter((p) => p.term).map((p) => p.text)).toEqual(['التقوى']);
    expect(termPieces('حسن الخلق', new Set(), [], false).filter((p) => p.term)).toEqual([]);
  });
});
