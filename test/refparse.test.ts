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
  it('ignores timestamps and plain numbers', () => {
    expect(one('pada menit 12:30 beliau berkata ada 3 hal')).toEqual([]);
    expect(one('tahun 2024 ada 100 orang')).toEqual([]);
  });
});
