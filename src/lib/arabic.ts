// Arabic text keys for matching. Mirror of tools/arabic.py: the corpus is indexed in Python, transcripts are
// matched here, so both must produce identical output (test/arabic.test.ts checks parity).

const INVISIBLE = /[​‎‏؜‪-‮⁦-⁩﻿­]/g;
const HARAKAT = /[ؐ-ًؚ-ٰۖ-ۭ࣓-ࣿ]/g;
const ALIF = /[آأإٱٲٳ]/g;
const NON_LETTER = /[^ء-ي٠-٩\s]/g;
const HONORIFIC_LIGATURES = /[ﷺﷻ﵀-﵏]/g;
const FOOTNOTE = /\[\^\d+\]/g;

// ىٰ is a long a inside a word (تتوفىٰهم → تتوفاهم) but plain alif maqsura at the end (علىٰ → على).
const YA_DAGGER_MID = /ىٰ(?=[ً-ٰٟۖ-ۭ]*[ء-ي])/g;

function letters(s: string): string {
  s = s.replaceAll('وٰ', 'ا').replace(YA_DAGGER_MID, 'ا');
  s = s.replace(HARAKAT, '').replaceAll('ـ', '');
  s = s.replace(ALIF, 'ا');
  s = s.replaceAll('ى', 'ي').replaceAll('ة', 'ه').replaceAll('ؤ', 'و').replaceAll('ئ', 'ي');
  return s.replaceAll('ی', 'ي').replaceAll('ک', 'ك');
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const HONORIFICS = [...new Set([
  'صلى الله عليه وسلم', 'رضى الله عنه', 'رضي الله عنه', 'رضى الله عنها', 'رضي الله عنها', 'رضى الله عنهما',
  'رضي الله عنهما', 'رضى الله عنهم', 'رضي الله عنهم', 'عليه الصلاة والسلام', 'عليه السلام',
].map((h) => words(letters(h)).join(' ')))].sort((a, b) => b.length - a.length);

export function norm(s: string | null | undefined): string {
  if (!s) return '';
  s = s.normalize('NFC').replace(INVISIBLE, '');
  s = s.replace(FOOTNOTE, ' ').replace(HONORIFIC_LIGATURES, ' ');
  s = letters(s).replace(NON_LETTER, ' ');
  s = ' ' + words(s).join(' ') + ' ';
  s = s.replaceAll('ءا', 'ا');
  for (const h of HONORIFICS) s = s.replaceAll(' ' + h + ' ', ' ');
  return words(s).join(' ');
}

const PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال'];
const SUFFIXES = ['ها', 'ان', 'ات', 'ون', 'ين', 'وا', 'يه', 'هم', 'هن', 'كم', 'نا', 'ه', 'ي'];

/** Drop every alif after the first letter (Uthmani writes many long vowels as dagger alif). */
export function skeleton(w: string): string {
  return w.length > 1 ? w[0] + w.slice(1).replaceAll('ا', '') : w;
}

export function stem(w: string): string {
  if (w.length >= 4 && (w[0] === 'و' || w[0] === 'ف') && !w.startsWith('وال') && !w.startsWith('فال')) w = w.slice(1);
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 2) {
      w = w.slice(p.length);
      break;
    }
  }
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 2) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return skeleton(w);
}

export function stems(s: string): string {
  return words(norm(s)).map(stem).join(' ');
}

export function trigrams(s: string): string {
  const out: string[] = [];
  for (const w of words(norm(s))) {
    const k = skeleton(w);
    if (k.length <= 3) out.push(k);
    else for (let i = 0; i < k.length - 2; i++) out.push(k.slice(i, i + 3));
  }
  return out.join(' ');
}

const ARABIC_LETTER = /[ء-ي]/;
export const hasArabic = (s: string) => ARABIC_LETTER.test(s);
