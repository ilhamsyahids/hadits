import { describe, expect, it } from 'vitest';
import { chainNames } from '../src/lib/chain';

describe('chainNames', () => {
  it('drops Arabic words left in a chain and keeps the names in order', () => {
    // muslim:1631 as Hadith Unlocked writes it
    expect(chainNames('Yaḥyá b. Ayyūb And Qutaybah  /  Ibn Saʿīd Wāb. Ḥujr > Ūā > Ismāʿīl > Ibn Jaʿfar > al-ʿAlāʾ > his father > Abū Hurayrah > Rasūl Allāh ﷺ')).toEqual([
      'Yaḥyá b. Ayyūb and Qutaybah / Ibn Saʿīd and Ibn Ḥujr', 'Ismāʿīl', 'Ibn Jaʿfar', 'al-ʿAlāʾ', 'his father', 'Abū Hurayrah', 'Rasūl Allāh ﷺ',
    ]);
  });
  it('translates relatives left in Arabic', () => {
    expect(chainNames('Mūsá > ʿAmmih > Anas')).toEqual(['Mūsá', 'his uncle', 'Anas']);
  });
  it('keeps short real names', () => {
    expect(chainNames('Shuʿbah > Anas > ʿAlī > Qays')).toEqual(['Shuʿbah', 'Anas', 'ʿAlī', 'Qays']);
  });
});
