// Websites Ask may search (Tavily include_domains), listed on /sources. They explain and answer contemporary
// questions; the text and grade of a hadith always come from the corpus, never from these sites.
// In the Arabic descriptions, \u200f (right-to-left mark) keeps punctuation after a Latin name on the Arabic side.

export type SiteLang = 'ar' | 'en' | 'id';
export type SiteKind = 'fatwa' | 'articles' | 'scholar' | 'library' | 'scripture' | 'official' | 'academic' | 'media';
export type Site = { domain: string; name: string; lang: SiteLang; kind: SiteKind; about: { en: string; ar: string } };

const s = (domain: string, name: string, lang: SiteLang, kind: SiteKind, en: string, ar: string): Site => ({ domain, name, lang, kind, about: { en, ar } });

export const SITES: Site[] = [
  // Arabic
  s('dorar.net', 'Dorar (al-Durar al-Saniyyah)', 'ar', 'fatwa', 'Hadith encyclopedia with gradings, abridged tafsir, and encyclopedias of creed and fiqh.', 'موسوعة حديثية بأحكام المحدثين، وتفسير مختصر، وموسوعات في العقيدة والفقه.'),
  s('alifta.gov.sa', 'General Presidency of Scholarly Research and Ifta', 'ar', 'official', 'Fatawa of the Permanent Committee and the Council of Senior Scholars, in several languages.', 'فتاوى اللجنة الدائمة وهيئة كبار العلماء، بعدة لغات.'),
  s('alukah.net', 'Alukah', 'ar', 'articles', 'Scholarly network of Arabic articles across the Islamic sciences, supervised by academics.', 'شبكة علمية لمقالات في العلوم الشرعية بإشراف أكاديميين.'),
  s('saaid.net', "Sayd al-Fawa'id", 'ar', 'articles', 'Articles and e-books on Islamic knowledge.', 'مقالات وكتب إلكترونية في العلوم الشرعية.'),
  s('islamhouse.com', 'IslamHouse', 'ar', 'articles', 'Multilingual library of articles and e-books.', 'مكتبة متعددة اللغات من المقالات والكتب.'),
  s('ajurry.com', 'Al-Ajurry', 'ar', 'articles', 'Articles and recorded lessons of contemporary scholars.', 'مقالات ودروس مسجلة لعلماء معاصرين.'),
  s('ahlelhdeeth.com', 'Ahl al-Hadith Forum', 'ar', 'articles', 'Forum for discussion of the hadith sciences.', 'ملتقى لمدارسة علوم الحديث.'),
  s('islamcontent.com', 'IslamContent', 'ar', 'articles', 'Articles and research on Islamic topics.', 'مقالات وبحوث في الموضوعات الشرعية.'),
  // Not searched yet, pending review of their content:
  // s('midad.com', 'Midad', 'ar', 'articles', 'Arabic articles on Islamic topics.', 'مقالات عربية في الموضوعات الشرعية.'),
  // s('alfiqh.net', 'Al-Fiqh', 'ar', 'articles', 'Articles on fiqh.', 'مقالات في الفقه.'),
  // s('kulalsalafiyeen.com', 'Kull al-Salafiyyin', 'ar', 'articles', 'Compiled articles and translated fatawa of scholars.', 'مقالات وفتاوى مترجمة للعلماء.'),
  s('binbaz.org.sa', 'Sheikh Ibn Baz', 'ar', 'scholar', 'Official site of Sheikh Abdul Aziz Ibn Baz: fatawa, books and lessons.', 'الموقع الرسمي للشيخ عبد العزيز بن باز: فتاوى وكتب ودروس.'),
  s('binothaimeen.com', 'Sheikh Ibn Uthaymeen', 'ar', 'scholar', "Official site of Sheikh Muhammad ibn Salih al-Uthaymeen: complete works, fatawa and lessons.", 'الموقع الرسمي للشيخ محمد بن صالح العثيمين: المؤلفات والفتاوى والدروس.'),
  s('al-badr.net', 'Sheikh Abdurrazzaq al-Badr', 'ar', 'scholar', 'Official site of Sheikh Abdurrazzaq al-Badr: books, articles and transcribed lessons.', 'الموقع الرسمي للشيخ عبد الرزاق البدر: كتب ومقالات ودروس مفرغة.'),
  s('rabee.net', "Sheikh Rabee' ibn Hadi", 'ar', 'scholar', "Official site of Sheikh Rabee' ibn Hadi: books, fatawa and lessons.", 'الموقع الرسمي للشيخ ربيع بن هادي: كتب وفتاوى ودروس.'),
  s('rslan.com', "Sheikh Muhammad Sa'id Raslan", 'ar', 'scholar', "Official site of Sheikh Muhammad Sa'id Raslan: lessons and articles.", 'الموقع الرسمي للشيخ محمد سعيد رسلان: دروس ومقالات.'),
  s('al-albany.com', 'Sheikh al-Albani', 'ar', 'scholar', 'Site of Sheikh Muhammad Nasir al-Din al-Albani: hadith gradings, fatawa and books.', 'موقع الشيخ محمد ناصر الدين الألباني: أحكام حديثية وفتاوى وكتب.'),
  s('muqbel.net', "Sheikh Muqbil al-Wadi'i", 'ar', 'scholar', "Site of Sheikh Muqbil ibn Hadi al-Wadi'i: books and lessons.", 'موقع الشيخ مقبل بن هادي الوادعي: كتب ودروس.'),
  s('sh-imam.com', 'Sheikh Muhammad al-Imam', 'ar', 'scholar', "Official site of Sheikh Muhammad al-Imam (Dar al-Hadith, Ma'bar).", 'الموقع الرسمي للشيخ محمد الإمام (دار الحديث بمعبر)\u200f.'),
  s('sh-albarrak.com', 'Sheikh Abdurrahman al-Barrak', 'ar', 'scholar', 'Site of Sheikh Abdurrahman al-Barrak: fatawa and articles.', 'موقع الشيخ عبد الرحمن البراك: فتاوى ومقالات.'),
  s('shamela.ws', 'Al-Maktabah al-Shamilah', 'ar', 'library', 'Digital library of classical and contemporary Islamic books.', 'مكتبة رقمية لكتب التراث والكتب المعاصرة.'),
  s('waqfeya.net', "Al-Maktabah al-Waqfiyyah", 'ar', 'library', 'Endowed digital library of Islamic books.', 'مكتبة وقفية رقمية للكتب الشرعية.'),
  s('qurancomplex.gov.sa', 'King Fahd Glorious Quran Printing Complex', 'ar', 'scripture', 'The official mushaf, its translations and tafsir.', 'المصحف الرسمي وترجماته وتفاسيره.'),
  s('quran.ksu.edu.sa', 'KSU Electronic Mushaf', 'ar', 'scripture', 'Electronic mushaf of King Saud University, with tafsir and translations.', 'المصحف الإلكتروني لجامعة الملك سعود مع التفاسير والترجمات.'),
  s('gph.gov.sa', 'General Presidency for the Two Holy Mosques', 'ar', 'official', 'Official khutbahs and religious announcements.', 'الخطب الرسمية والإعلانات الدينية.'),
  s('moia.gov.sa', 'Ministry of Islamic Affairs (Saudi Arabia)', 'ar', 'official', 'Official religious publications.', 'المطبوعات الدينية الرسمية.'),
  s('iu.edu.sa', 'Islamic University of Madinah', 'ar', 'academic', 'Academic articles and research.', 'بحوث ومقالات أكاديمية.'),
  s('imamu.edu.sa', 'Imam Muhammad ibn Saud Islamic University', 'ar', 'academic', 'Academic publications in the Islamic sciences.', 'منشورات أكاديمية في العلوم الشرعية.'),
  s('uqu.edu.sa', 'Umm al-Qura University', 'ar', 'academic', 'Academic research in sharia and Islamic studies.', 'بحوث أكاديمية في الشريعة والدراسات الإسلامية.'),
  // English
  s('islamqa.info', 'Islam Question & Answer', 'en', 'fatwa', 'Large question-and-answer fatwa site supervised by Sheikh Muhammad Salih al-Munajjid.', 'موقع كبير للأسئلة والفتاوى بإشراف الشيخ محمد صالح المنجد.'),
  s('islamweb.net', 'Islamweb', 'en', 'fatwa', 'Fatwa centre of the Ministry of Awqaf and Islamic Affairs, Qatar.', 'مركز الفتوى التابع لوزارة الأوقاف والشؤون الإسلامية في قطر.'),
  s('troid.org', 'TROID', 'en', 'articles', 'Articles, recordings and translated works of senior scholars.', 'مقالات وتسجيلات وترجمات لمؤلفات كبار العلماء.'),
  s('abukhadeejah.com', 'Abu Khadeejah', 'en', 'articles', "Articles and lecture series by Abu Khadeejah Abdul-Wahid.", 'مقالات وسلاسل دروس لأبي خديجة عبد الواحد.'),
  s('fatwa-online.com', 'Fatwa-Online', 'en', 'fatwa', 'Translated fatawa and articles, with Hajj and Umrah guides.', 'فتاوى ومقالات مترجمة، مع أدلة للحج والعمرة.'),
  s('madeenah.com', 'Madeenah.com', 'en', 'articles', 'Articles and recorded lectures.', 'مقالات ومحاضرات مسجلة.'),
  s('sunnahonline.com', 'SunnahOnline', 'en', 'articles', 'Articles and a fatwa collection in English.', 'مقالات ومجموعة فتاوى بالإنجليزية.'),
  s('sunnah.com', 'Sunnah.com', 'en', 'scripture', 'Hadith collections in Arabic and English.', 'كتب الحديث بالعربية والإنجليزية.'),
  s('quran.com', 'Quran.com', 'en', 'scripture', 'The Quran with translations and tafsir.', 'القرآن الكريم مع الترجمات والتفاسير.'),
  s('learnaboutislam.co.uk', 'Learn About Islam', 'en', 'articles', 'Introductions to Islam for new Muslims and non-Muslims.', 'تعريف بالإسلام للمسلمين الجدد ولغير المسلمين.'),
  // Indonesian
  s('muslim.or.id', 'Muslim.or.id', 'id', 'articles', 'Articles on creed, fiqh and manners (Yayasan Pendidikan Islam Al-Atsari, Yogyakarta).', 'مقالات في العقيدة والفقه والآداب (Yayasan Pendidikan Islam Al-Atsari، يوغياكارتا)\u200f.'),
  s('muslimah.or.id', 'Muslimah.or.id', 'id', 'articles', "Articles for women: women's fiqh, family and upbringing.", 'مقالات للنساء: فقه المرأة والأسرة والتربية.'),
  s('konsultasisyariah.com', 'Konsultasi Syariah', 'id', 'fatwa', 'Practical fiqh questions and answers, supervised by Ustadz Ammi Nur Baits.', 'أسئلة وأجوبة فقهية عملية بإشراف الأستاذ Ammi Nur Baits\u200f.'),
  s('rumaysho.com', 'Rumaysho', 'id', 'articles', 'Articles on creed, worship and daily fiqh by Ustadz Muhammad Abduh Tuasikal.', 'مقالات في العقيدة والعبادات وفقه الحياة اليومية للأستاذ Muhammad Abduh Tuasikal\u200f.'),
  s('almanhaj.or.id', 'Almanhaj', 'id', 'articles', 'Articles and translated fatawa of senior scholars.', 'مقالات وفتاوى مترجمة لكبار العلماء.'),
  s('muslimafiyah.com', 'Muslim Afiyah', 'id', 'articles', 'Health in the light of sharia, and everyday fiqh, by Ustadz Dr. Raehanul Bahraen.', 'الصحة في ضوء الشريعة وفقه الحياة اليومية، للأستاذ د. Raehanul Bahraen\u200f.'),
  s('pengusahamuslim.com', 'Pengusaha Muslim', 'id', 'articles', 'Fiqh of transactions, halal business and Islamic finance.', 'فقه المعاملات والتجارة الحلال والتمويل الإسلامي.'),
  s('kisahmuslim.com', 'Kisah Muslim', 'id', 'articles', 'Stories of the prophets, the Companions and Islamic history.', 'قصص الأنبياء والصحابة والتاريخ الإسلامي.'),
  s('yufid.com', 'Yufid', 'id', 'media', 'Yufid network portal (Yufid TV, EDU, KIDS) with articles.', 'بوابة شبكة Yufid \u200f(Yufid TV وEDU وKIDS) مع مقالات.'),
  s('nasihatsahabat.com', 'Nasihat Sahabat', 'id', 'articles', 'Articles on creed and religious advice.', 'مقالات في العقيدة والنصيحة.'),
  s('radiorodja.com', 'Radio Rodja', 'id', 'media', 'Radio Rodja 756 AM: articles and lecture transcripts.', 'إذاعة Rodja \u200f756 AM: مقالات وتفريغ محاضرات.'),
  s('firanda.com', 'Firanda Andirja', 'id', 'scholar', 'Articles and lectures by Ustadz Dr. Firanda Andirja.', 'مقالات ومحاضرات للأستاذ د. Firanda Andirja\u200f.'),
  s('syafiqrizabasalamah.com', 'Syafiq Riza Basalamah', 'id', 'scholar', 'Official site of Ustadz Syafiq Riza Basalamah: articles and lectures.', 'الموقع الرسمي للأستاذ Syafiq Riza Basalamah: مقالات ومحاضرات.'),
  s('abiubaidah.com', 'Yusuf Abu Ubaidah As-Sidawi', 'id', 'scholar', 'Official site of Ustadz Yusuf Abu Ubaidah As-Sidawi: articles and lectures.', 'الموقع الرسمي للأستاذ Yusuf Abu Ubaidah As-Sidawi: مقالات ومحاضرات.'),
  s('bimbinganislam.com', 'Bimbingan Islam', 'id', 'articles', 'Structured learning articles from the Bimbingan Islam programme.', 'مقالات تعليمية منظمة من برنامج Bimbingan Islam\u200f.'),
  s('indonesiabertauhid.com', 'Indonesia Bertauhid', 'id', 'articles', 'Articles on tawhid by Ustadz Ahmad Zainuddin Al-Banjary.', 'مقالات في التوحيد للأستاذ Ahmad Zainuddin Al-Banjary\u200f.'),
];

export const domainsFor = (lang: SiteLang | 'all') => SITES.filter((x) => lang === 'all' || x.lang === lang).map((x) => x.domain);
