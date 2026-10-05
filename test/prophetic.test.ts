import { describe, expect, it } from 'vitest';
import { prophetic, saidRanges } from '../src/lib/prophetic';
import cases from './prophetic-cases.json';

// Real rows (nasai:4, nasai:5): the shown Arabic has no quote marks; sunnah.com's marked-up text has them.
const said = (key: keyof typeof cases) => {
  const c = cases[key];
  return prophetic(c.ar_matn, 'ar', saidRanges(c.ar_matn, c.ar_marked)).filter((p) => p.prophetic).map((p) => p.text);
};

describe('prophetic', () => {
  it('maps sunnah.com quotes onto the shown Arabic', () => {
    expect(said('nasai:4')).toEqual(['إِنَّا لاَ أَوْ لَنْ نَسْتَعِينَ عَلَى الْعَمَلِ مَنْ أَرَادَهُ وَلَكِنِ اذْهَبْ أَنْتَ']);
    expect(said('nasai:5')).toEqual([cases['nasai:5'].ar_matn]);
  });

  it('keeps «…» from the text itself', () => {
    expect(prophetic('قال «الدين النصيحة» ثلاثا', 'ar', [[0, 3]]).filter((p) => p.prophetic).map((p) => p.text)).toEqual(['«الدين النصيحة»']);
  });

  it('leaves English unmarked when a straight quote is never closed', () => {
    expect(prophetic(cases['nasai:5'].en_text, 'en').some((p) => p.prophetic)).toBe(false);
    expect(prophetic('He said: "Pray as you have seen me praying."', 'en').filter((p) => p.prophetic).map((p) => p.text)).toEqual(['"Pray as you have seen me praying."']);
  });

  it('never changes the text', () => {
    for (const c of Object.values(cases)) expect(prophetic(c.ar_matn, 'ar', saidRanges(c.ar_matn, c.ar_marked)).map((p) => p.text).join('')).toBe(c.ar_matn);
  });
});
