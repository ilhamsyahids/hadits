import { describe, expect, it } from 'vitest';
import { arabicRedirect } from '../src/lib/geo';

const u = (p: string) => new URL(`https://hadits.net${p}`);

describe('arabicRedirect', () => {
  it('sends a first visit from an Arabic-speaking country to /ar', () => {
    expect(arabicRedirect(u('/'), 'SA', undefined)).toBe('/ar/');
    expect(arabicRedirect(u('/bukhari:1?x=1'), 'EG', '')).toBe('/ar/bukhari:1?x=1');
  });
  it('keeps the reader’s own choice', () => {
    expect(arabicRedirect(u('/'), 'SA', 'lang=en')).toBeNull();
    expect(arabicRedirect(u('/'), 'SA', 'theme=dark; lang=ar')).toBeNull();
  });
  it('leaves other countries, Arabic pages, the API and files alone', () => {
    expect(arabicRedirect(u('/'), 'ID', undefined)).toBeNull();
    expect(arabicRedirect(u('/ar/hadith'), 'SA', undefined)).toBeNull();
    expect(arabicRedirect(u('/v1/search'), 'SA', undefined)).toBeNull();
    expect(arabicRedirect(u('/agents/ask-agent/x'), 'SA', undefined)).toBeNull();
    expect(arabicRedirect(u('/fonts/UthmanicHafs.woff2'), 'SA', undefined)).toBeNull();
  });
});
