import type { DocSegment } from './doc';

// A reader's text → paragraphs. Subtitles (.srt / .vtt) keep their times; anything else is located by paragraph.
// Markdown headings become the title (# …) and sections (## …), as in tools/demo_lectures.py.

const CUE_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const MAX_PARA = 1200; // longer paragraphs are cut at sentence ends, so a quote's position stays useful
const CHUNK = 800;

const secs = (h: string | undefined, m: string, s: string, ms: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
const clean = (s: string) => s.replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function split(text: string): string[] {
  if (text.length <= MAX_PARA) return [text];
  const out: string[] = [];
  let cur = '';
  for (const sentence of text.match(/[^.!?؟。]+[.!?؟。]*\s*/g) ?? [text]) {
    if (cur && cur.length + sentence.length > CHUNK) {
      out.push(cur.trim());
      cur = '';
    }
    cur += sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function isSubtitles(text: string) {
  return CUE_TIME.test(text.slice(0, 2000));
}

/** Subtitle cues merged into passages of about a paragraph, each starting at its first cue's time. */
function subtitles(text: string): DocSegment[] {
  const out: DocSegment[] = [];
  let cur: DocSegment | null = null;
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => CUE_TIME.test(l));
    if (at < 0) continue;
    const m = CUE_TIME.exec(lines[at])!;
    const start = secs(m[1], m[2], m[3], m[4]), end = secs(m[5], m[6], m[7], m[8]);
    const words = clean(lines.slice(at + 1).join(' '));
    if (!words) continue;
    if (cur && cur.text.length + words.length < 400 && start - cur.end < 4) {
      cur.text += ` ${words}`;
      cur.end = end;
    } else {
      cur = { start, end, text: words };
      out.push(cur);
    }
  }
  return out;
}

function paragraphs(text: string): { title: string | null; segments: DocSegment[] } {
  let title: string | null = null, section: string | null = null;
  const segments: DocSegment[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && !title && !segments.length) title = clean(h[2]);
      else section = clean(h[2]);
      continue;
    }
    for (const part of split(clean(line))) {
      if (part) segments.push({ start: segments.length, end: segments.length + 1, text: part, section });
    }
  }
  return { title, segments };
}

export function parseText(text: string): { title: string | null; segments: DocSegment[]; timing: 'audio' | 'position' } {
  if (isSubtitles(text)) return { title: null, segments: subtitles(text), timing: 'audio' };
  return { ...paragraphs(text), timing: 'position' };
}

/** The language of the text: Arabic by script; Indonesian or English by common words. */
export function guessLang(text: string): 'ar' | 'id' | 'en' {
  const sample = text.slice(0, 20000);
  const ar = sample.match(/[ء-ي]/g)?.length ?? 0;
  const lat = sample.match(/[A-Za-z]/g)?.length ?? 0;
  if (ar > lat) return 'ar';
  const count = (re: RegExp) => sample.match(re)?.length ?? 0;
  const id = count(/\b(yang|dan|itu|dengan|ini|tidak|kita|dari|untuk|adalah)\b/gi);
  const en = count(/\b(the|and|of|to|is|that|with|for|this|are)\b/gi);
  return id > en ? 'id' : 'en';
}
