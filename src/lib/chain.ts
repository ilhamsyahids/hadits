// The English chain of narrators as Hadith Unlocked writes it ("A > B > … > Rasūl Allāh ﷺ"), cleaned for display.
// Some of their segments are Arabic words left in transliteration rather than names: verbs and particles of the
// transmission formula (قالوا → "Ūā", كان → "Kān", قرأت → "Qaraʾt"), or words of the text when the chain was cut too
// late. Those are dropped; relatives left in Arabic are translated like "his father" already is. Nothing else changes.

const NOT_A_NAME = new Set([
  'Ūā', 'Ūn', 'Kān', 'Kānat', 'Kunt', 'Kunnā', 'Qaraʾt', 'Quriʾ', 'Qāl', 'Suʾil', 'Raʾayt', 'Dakhal', 'Ashhad',
  'Man', 'Lā', 'Mā', 'Naʿam', 'Lammā', 'Lah', 'Illā', 'Ān', 'Fīh', 'Bīh', 'Byh', 'Innah', 'Baynā', 'Ghayr',
]);
const RELATIVES: Record<string, string> = { ʿAmmih: 'his uncle', Akhīh: 'his brother', Akhī: 'my brother', Abīh: 'his father', Ummih: 'his mother' };

export function chainNames(enIsnad: string | null | undefined): string[] {
  if (!enIsnad) return [];
  return enIsnad
    .split(/\s*>\s*/)
    .map((s) =>
      s
        .replace(/\s+/g, ' ')
        .replace(/\s*\/\s*/g, ' / ')
        .replace(/\bWāb\. /g, 'and Ibn ') // "… Ibn Saʿīd Wāb. Ḥujr": wa-Ibn Ḥujr
        .replace(/ And /g, ' and ')
        .trim(),
    )
    .filter((s) => s && !NOT_A_NAME.has(s))
    .map((s) => RELATIVES[s] ?? s);
}
