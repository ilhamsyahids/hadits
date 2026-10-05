import { describe, expect, it } from 'vitest';
import { guessLang, parseText } from '../src/lectures/parse';

describe('parseText', () => {
  it('paragraphs with a title and sections', () => {
    const r = parseText('# Title here\n\nFirst paragraph.\n\n## Part two\nSecond line.\nThird line.');
    expect(r.title).toBe('Title here');
    expect(r.timing).toBe('position');
    expect(r.segments.map((s) => [s.start, s.section, s.text])).toEqual([
      [0, null, 'First paragraph.'],
      [1, 'Part two', 'Second line.'],
      [2, 'Part two', 'Third line.'],
    ]);
  });

  it('cuts a very long paragraph at sentence ends', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const r = parseText(long);
    expect(r.segments.length).toBeGreaterThan(1);
    expect(r.segments.every((s) => s.text.length <= 900)).toBe(true);
    expect(r.segments.map((s) => s.text).join(' ')).toBe(long);
  });

  it('subtitles keep their times and merge short cues', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:03,600 --> 00:00:05,000\nand welcome\n\n3\n00:01:10,000 --> 00:01:12,000\n<i>Later</i> words';
    const r = parseText(srt);
    expect(r.timing).toBe('audio');
    expect(r.segments).toEqual([
      { start: 1, end: 5, text: 'Hello there and welcome' },
      { start: 70, end: 72, text: 'Later words' },
    ]);
  });

  it('guesses the language', () => {
    expect(guessLang('قال رسول الله في هذا الحديث')).toBe('ar');
    expect(guessLang('Ini adalah kajian yang kita bahas dengan dalil dari hadits')).toBe('id');
    expect(guessLang('This is the lecture and the evidence for it')).toBe('en');
  });
});
