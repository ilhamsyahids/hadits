import { describe, expect, it } from 'vitest';
import { parseCitations, surahByName } from '../src/search/refparse';

const one = (t: string) => parseCitations(t).map(({ start, end, text, ...c }) => c);

describe('surah names', () => {
  it('Indonesian and English spellings resolve', () => {
    expect(surahByName('Al-Baqarah')).toBe(2);
    expect(surahByName('al baqoroh')).toBe(2);
    expect(surahByName("Asy-Syu'ara")).toBe(26);
    expect(surahByName("Ash-Shu'ara")).toBe(26);
    expect(surahByName('Ali Imran')).toBe(3);
    expect(surahByName('Al-Hujurat')).toBe(49);
  });
});

describe('parseCitations', () => {
  it('numeric Quran references', () => {
    expect(one('sebagaimana dalam QS 2:255 tentang')).toEqual([{ kind: 'quran', surah: 2, from: 255, to: 255 }]);
    expect(one('(26:88-89)')).toEqual([{ kind: 'quran', surah: 26, from: 88, to: 89 }]);
    expect(one('QS. Al-Baqarah [2]: 183')).toEqual([{ kind: 'quran', surah: 2, from: 183, to: 183 }]);
  });
  it('named Quran references', () => {
    expect(one('Allah berfirman dalam surat Al-Baqarah ayat 255')).toEqual([{ kind: 'quran', surah: 2, from: 255, to: 255 }]);
    expect(one("QS Asy-Syu'ara: 88-89")).toEqual([{ kind: 'quran', surah: 26, from: 88, to: 89 }]);
  });
  it('hadith references', () => {
    expect(one('HR Bukhari no. 1')).toEqual([{ kind: 'hadith', collection: 'bukhari', number: '1' }]);
    expect(one('(HR. Muslim no. 2564)')).toEqual([{ kind: 'hadith', collection: 'muslim', number: '2564' }]);
    expect(one('diriwayatkan oleh Ibnu Majah nomor 4216')).toEqual([{ kind: 'hadith', collection: 'ibnmajah', number: '4216' }]);
    expect(one('Riyadhus Shalihin no. 681')).toEqual([{ kind: 'hadith', collection: 'riyadussalihin', number: '681' }]);
    expect(one('Shahih Bukhari 6018')).toEqual([{ kind: 'hadith', collection: 'bukhari', number: '6018' }]);
    expect(one('HR Abu Dawud no 4031')).toEqual([{ kind: 'hadith', collection: 'abudawud', number: '4031' }]);
    expect(one('رواه البخاري')).toEqual([{ kind: 'hadith', collection: 'bukhari', number: '' }]);
    expect(one('(HR Muslim).')).toEqual([{ kind: 'hadith', collection: 'muslim', number: '' }]);
    expect(one('diriwayatkan oleh Imam Bukhari dan Muslim')).toEqual([{ kind: 'hadith', collection: 'bukhari', number: '' }]);
  });
  it('Arabic bracket citations, with typos', () => {
    expect(one('{وَاتَّقُواْ اللّهَ}[البقرة:203]')).toEqual([{ kind: 'quran', surah: 2, from: 203, to: 203 }]);
    expect(one('[آل عمران:102]')).toEqual([{ kind: 'quran', surah: 3, from: 102, to: 102 }]);
    expect(one('[الطور:26-27]')).toEqual([{ kind: 'quran', surah: 52, from: 26, to: 27 }]);
    expect(one('[البقؤة:197]')).toEqual([{ kind: 'quran', surah: 2, from: 197, to: 197 }]);
    expect(one('سورة البقرة آية 255')).toEqual([{ kind: 'quran', surah: 2, from: 255, to: 255 }]);
  });
  it('surah names that differ only by the article', () => {
    expect(one('Surah At-Talaq ayat 2')).toEqual([{ kind: 'quran', surah: 65, from: 2, to: 2 }]);
    expect(one("Surah Al-'Alaq ayat 1")).toEqual([{ kind: 'quran', surah: 96, from: 1, to: 1 }]);
    expect(one('Sura at-Talaq Q.65:2-3 says')).toEqual([{ kind: 'quran', surah: 65, from: 2, to: 3 }]);
    expect(one('Surat An-Nashr ayat 1')).toEqual([{ kind: 'quran', surah: 110, from: 1, to: 1 }]);
    expect(one("Surat Al-'Ashr ayat 2")).toEqual([{ kind: 'quran', surah: 103, from: 2, to: 2 }]);
  });
  it('two collections in one citation', () => {
    expect(one('(HR. Bukhari No. 812 dan Muslim No. 490)')).toEqual([
      { kind: 'hadith', collection: 'bukhari', number: '812' },
      { kind: 'hadith', collection: 'muslim', number: '490' },
    ]);
    expect(one('HR Bukhari 1 dan Muslim 1907')).toEqual([
      { kind: 'hadith', collection: 'bukhari', number: '1' },
      { kind: 'hadith', collection: 'muslim', number: '1907' },
    ]);
  });
  it('Wikipedia-style [Quran s:a] citations', () => {
    expect(one('bow down (in worship).[Quran 2:43]')).toEqual([{ kind: 'quran', surah: 2, from: 43, to: 43 }]);
    expect(one('[Quran 41:7]')).toEqual([{ kind: 'quran', surah: 41, from: 7, to: 7 }]);
    expect(one("Qur'an 9:79")).toEqual([{ kind: 'quran', surah: 9, from: 79, to: 79 }]);
    expect(one('the Quran 41 times')).toEqual([]);
  });
  it('ignores timestamps and plain numbers', () => {
    expect(one('pada menit 12:30 beliau berkata ada 3 hal')).toEqual([]);
    expect(one('tahun 2024 ada 100 orang')).toEqual([]);
  });
});
