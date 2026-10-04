// Collection ids as stored in D1, their display names, and the spellings people say or type for them
// (Indonesian, English, Arabic transliteration). Aliases are compared after `aliasKey()`.

export type Collection = { id: string; en: string; id_name: string; ar: string; aliases: string[] };

export const COLLECTIONS: Collection[] = [
  { id: 'bukhari', en: 'Sahih al-Bukhari', id_name: 'Shahih al-Bukhari', ar: 'صحيح البخاري', aliases: ['bukhari', 'bukhori', 'albukhari', 'albukhori', 'shahihbukhari', 'sahihbukhari', 'imambukhari'] },
  { id: 'muslim', en: 'Sahih Muslim', id_name: 'Shahih Muslim', ar: 'صحيح مسلم', aliases: ['muslim', 'shahihmuslim', 'sahihmuslim', 'imammuslim'] },
  { id: 'abudawud', en: 'Sunan Abi Dawud', id_name: 'Sunan Abu Dawud', ar: 'سنن أبي داود', aliases: ['abudawud', 'abudaud', 'abudawood', 'abidawud', 'abidaud', 'sunanabudawud', 'sunanabudaud'] },
  { id: 'tirmidhi', en: "Jami' at-Tirmidhi", id_name: 'Jami at-Tirmidzi', ar: 'جامع الترمذي', aliases: ['tirmidhi', 'tirmidzi', 'tirmizi', 'attirmidhi', 'attirmidzi', 'tirmizy', 'sunantirmidzi', 'jamiattirmidzi'] },
  { id: 'nasai', en: "Sunan an-Nasa'i", id_name: "Sunan an-Nasa'i", ar: 'سنن النسائي', aliases: ['nasai', 'annasai', 'nasaai', 'sunannasai', 'sunanannasai'] },
  { id: 'ibnmajah', en: 'Sunan Ibn Majah', id_name: 'Sunan Ibnu Majah', ar: 'سنن ابن ماجه', aliases: ['ibnmajah', 'ibnumajah', 'ibnimajah', 'ibnmaja', 'ibnumaja', 'sunanibnumajah', 'sunanibnmajah'] },
  { id: 'malik', en: "Muwatta' Malik", id_name: "Muwaththa' Malik", ar: 'موطأ مالك', aliases: ['malik', 'muwatta', 'muwattha', 'muwaththa', 'muwatha', 'muwattamalik', 'imammalik'] },
  { id: 'ahmad', en: 'Musnad Ahmad', id_name: 'Musnad Ahmad', ar: 'مسند أحمد', aliases: ['ahmad', 'musnadahmad', 'imamahmad'] },
  { id: 'darimi', en: 'Sunan ad-Darimi', id_name: 'Sunan ad-Darimi', ar: 'سنن الدارمي', aliases: ['darimi', 'addarimi', 'sunandarimi'] },
  { id: 'riyadussalihin', en: 'Riyad as-Salihin', id_name: 'Riyadhus Shalihin', ar: 'رياض الصالحين', aliases: ['riyadussalihin', 'riyadhusshalihin', 'riyadhussalihin', 'riyadusshalihin', 'riyadassalihin', 'riyadhasshalihin', 'riyadh', 'riyad', 'riyadhushshalihin'] },
  { id: 'nawawi', en: "An-Nawawi's Forty", id_name: "Arba'in Nawawi", ar: 'الأربعون النووية', aliases: ['nawawi', 'arbainnawawi', 'arbain', 'arbaunannawawiyah', 'hadistarbain', 'haditsarbain'] },
  { id: 'qudsi', en: 'Forty Hadith Qudsi', id_name: 'Hadits Qudsi', ar: 'الأحاديث القدسية', aliases: ['qudsi', 'haditsqudsi'] },
  { id: 'bulugh', en: 'Bulugh al-Maram', id_name: 'Bulughul Maram', ar: 'بلوغ المرام', aliases: ['bulugh', 'bulughulmaram', 'bulughalmaram'] },
  { id: 'mishkat', en: 'Mishkat al-Masabih', id_name: 'Misykatul Mashabih', ar: 'مشكاة المصابيح', aliases: ['mishkat', 'misykat', 'mishkatalmasabih', 'misykatulmashabih'] },
  { id: 'adab', en: 'Al-Adab Al-Mufrad', id_name: 'Al-Adab al-Mufrad', ar: 'الأدب المفرد', aliases: ['adab', 'adabulmufrad', 'aladabalmufrad'] },
  { id: 'shamail', en: "Ash-Shama'il al-Muhammadiyah", id_name: "Syama'il Muhammadiyah", ar: 'الشمائل المحمدية', aliases: ['shamail', 'syamail'] },
  { id: 'hakim', en: 'al-Mustadrak (al-Hakim)', id_name: 'Al-Mustadrak al-Hakim', ar: 'المستدرك', aliases: ['hakim', 'alhakim', 'mustadrak'] },
  { id: 'ibnhibban', en: 'Sahih Ibn Hibban', id_name: 'Shahih Ibnu Hibban', ar: 'صحيح ابن حبان', aliases: ['ibnhibban', 'ibnuhibban'] },
  { id: 'ibnkhuzaymah', en: 'Sahih Ibn Khuzaymah', id_name: 'Shahih Ibnu Khuzaimah', ar: 'صحيح ابن خزيمة', aliases: ['ibnkhuzaymah', 'ibnukhuzaimah', 'ibnukhuzaymah'] },
  { id: 'bayhaqi', en: 'al-Sunan al-Kubra (al-Bayhaqi)', id_name: 'As-Sunan al-Kubra al-Baihaqi', ar: 'السنن الكبرى للبيهقي', aliases: ['bayhaqi', 'baihaqi', 'albaihaqi'] },
  { id: 'shuab', en: "Shu'ab al-Iman (al-Bayhaqi)", id_name: "Syu'abul Iman", ar: 'شعب الإيمان', aliases: ['shuab', 'syuabuliman', 'shuabaliman'] },
  { id: 'tabarani', en: "al-Mu'jam al-Kabir (al-Tabarani)", id_name: "Al-Mu'jam al-Kabir ath-Thabrani", ar: 'المعجم الكبير', aliases: ['tabarani', 'thabrani', 'atthabrani'] },
  { id: 'tabarani-awsat', en: "al-Mu'jam al-Awsat", id_name: "Al-Mu'jam al-Ausath", ar: 'المعجم الأوسط', aliases: ['tabaraniawsat', 'thabraniausath'] },
  { id: 'tabarani-saghir', en: "al-Mu'jam al-Saghir", id_name: "Al-Mu'jam ash-Shaghir", ar: 'المعجم الصغير', aliases: ['tabaranisaghir'] },
  { id: 'daraqutni', en: 'Sunan al-Daraqutni', id_name: 'Sunan ad-Daruquthni', ar: 'سنن الدارقطني', aliases: ['daraqutni', 'daruquthni', 'daruqutni'] },
  { id: 'ibnabishaybah', en: 'Musannaf Ibn Abi Shaybah', id_name: 'Mushannaf Ibnu Abi Syaibah', ar: 'مصنف ابن أبي شيبة', aliases: ['ibnabishaybah', 'ibnuabisyaibah'] },
  { id: 'abdalrazzaq', en: "Musannaf 'Abd al-Razzaq", id_name: 'Mushannaf Abdurrazzaq', ar: 'مصنف عبد الرزاق', aliases: ['abdalrazzaq', 'abdurrazzaq', 'abdurrazaq'] },
  { id: 'nasai-kubra', en: "al-Sunan al-Kubra (al-Nasa'i)", id_name: "As-Sunan al-Kubra an-Nasa'i", ar: 'السنن الكبرى للنسائي', aliases: ['nasaikubra'] },
  { id: 'suyuti', en: "Jami' al-Saghir / Jam' al-Jawami' (al-Suyuti)", id_name: 'Jami ash-Shaghir as-Suyuthi', ar: 'جمع الجوامع', aliases: ['suyuti', 'suyuthi', 'jamiusshaghir'] },
  { id: 'bazzar', en: 'Musnad al-Bazzar', id_name: 'Musnad al-Bazzar', ar: 'مسند البزار', aliases: ['bazzar'] },
  { id: 'abuyaala', en: "Musnad Abi Ya'la", id_name: "Musnad Abu Ya'la", ar: 'مسند أبي يعلى', aliases: ['abuyaala', 'abuyala'] },
  { id: 'tayalisi', en: 'Musnad al-Tayalisi', id_name: 'Musnad ath-Thayalisi', ar: 'مسند الطيالسي', aliases: ['tayalisi', 'thayalisi'] },
  { id: 'matalib', en: "al-Matalib al-'Aliyah", id_name: "Al-Mathalib al-'Aliyah", ar: 'المطالب العالية', aliases: ['matalib'] },
  { id: 'history', en: "Tarikh (al-Tabari)", id_name: 'Tarikh', ar: 'التاريخ', aliases: [] },
  { id: 'ibnhisham', en: 'Sirat Ibn Hisham', id_name: 'Sirah Ibnu Hisyam', ar: 'سيرة ابن هشام', aliases: ['ibnhisham', 'ibnuhisyam'] },
  { id: 'hisn', en: 'Hisn al-Muslim', id_name: 'Hisnul Muslim', ar: 'حصن المسلم', aliases: ['hisn', 'hisnulmuslim'] },
  { id: 'forty', en: 'Forty Hadith (collections)', id_name: "Arba'in", ar: 'الأربعون', aliases: [] },
  { id: 'virtues', en: "Virtues of the Qur'an", id_name: "Keutamaan Al-Qur'an", ar: 'فضائل القرآن', aliases: [] },
  { id: 'thulathiyyat', en: 'Thulathiyyat (Musnad Ahmad)', id_name: 'Tsulatsiyyat', ar: 'الثلاثيات', aliases: ['thulathiyyat'] },
  { id: 'dehlawi', en: 'Forty Hadith of Shah Waliullah', id_name: "Arba'in Dahlawi", ar: 'الأربعون للدهلوي', aliases: ['dehlawi'] },
  { id: 'quran', en: "The Qur'an", id_name: "Al-Qur'an", ar: 'القرآن الكريم', aliases: [] },
];

export const CORE = ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah', 'malik', 'ahmad', 'darimi'];

const BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));
export const collection = (id: string) => BY_ID.get(id);

/** Lowercase ASCII letters only: "Abu Dawud" / "Abū Dāwūd" / "abu-daud" → "abudawud" / "abudaud". */
export const aliasKey = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const ALIAS = new Map<string, string>();
for (const c of COLLECTIONS) for (const a of [c.id.replace(/-/g, ''), ...c.aliases]) ALIAS.set(a, c.id);
export const ALIASES = [...ALIAS.keys()].sort((a, b) => b.length - a.length);
export const collectionByAlias = (s: string) => ALIAS.get(aliasKey(s));
