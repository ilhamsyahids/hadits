// UI strings. English is the default locale; Arabic pages render right-to-left.
// Scripture is never here: Quran and hadith text always comes from the API.

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const dir = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');

const en = {
  title: 'Dalil — check the ayat and hadith quoted in a lecture',
  tagline: 'Check the ayat and hadith quoted in a lecture',
  intro: 'Paste an Arabic quote, a citation such as "Bukhari 1" or "QS 2:255", or a line from a transcript. Every result is matched against 317,000 hadith and the whole Quran, with grades attributed to each grader.',
  placeholder: 'e.g. إنما الأعمال بالنيات · Bukhari 1 · QS 2:255',
  check: 'Check',
  checking: 'Checking…',
  examples: 'Try',
  noQuote: 'No quote or citation found in this text.',
  error: 'Something went wrong. Please try again.',
  source: 'Source',
  spoken: 'Said',
  grades: 'Grades',
  noGrade: 'No grade recorded for this wording',
  variants: 'Other wordings',
  closest: 'Closest texts in the corpus',
  openSource: 'Open source',
  notFoundNote: 'Not in the 317,000 hadith we index. That does not prove it is fabricated: ask a scholar.',
  citationMismatch: 'The reference said does not match where this text is found.',
  language: 'العربية',
  status: {
    verbatim: 'Verbatim',
    paraphrase: 'Paraphrase',
    misquote: 'Misquote',
    weak_or_disputed: 'Weak or disputed',
    not_found_in_corpus: 'Not found in corpus',
    reference: 'Reference',
  } as Record<string, string>,
};

const ar: typeof en = {
  title: 'دليل — تحقّق من الآيات والأحاديث المذكورة في الدرس',
  tagline: 'تحقّق من الآيات والأحاديث المذكورة في الدرس',
  intro: 'الصق نصًّا عربيًّا، أو إحالة مثل «البخاري 1» أو «QS 2:255»، أو سطرًا من تفريغ الدرس. تُطابَق كل نتيجة مع ٣١٧ ألف حديث والقرآن كاملًا، مع نسبة كل حكم إلى قائله.',
  placeholder: 'مثال: إنما الأعمال بالنيات · Bukhari 1 · QS 2:255',
  check: 'تحقّق',
  checking: 'جارٍ التحقق…',
  examples: 'جرّب',
  noQuote: 'لم يُعثر على نص أو إحالة في هذا المدخل.',
  error: 'حدث خطأ، حاول مرة أخرى.',
  source: 'المصدر',
  spoken: 'المقول',
  grades: 'الحكم',
  noGrade: 'لا يوجد حكم مسجّل لهذا اللفظ',
  variants: 'ألفاظ أخرى',
  closest: 'أقرب النصوص في المدوّنة',
  openSource: 'افتح المصدر',
  notFoundNote: 'غير موجود في ٣١٧ ألف حديث مفهرسة لدينا، ولا يعني ذلك أنه موضوع: اسأل أهل العلم.',
  citationMismatch: 'الإحالة المذكورة لا توافق موضع هذا النص.',
  language: 'English',
  status: {
    verbatim: 'مطابق',
    paraphrase: 'بالمعنى',
    misquote: 'خطأ في النقل',
    weak_or_disputed: 'ضعيف أو مختلف فيه',
    not_found_in_corpus: 'غير موجود',
    reference: 'إحالة',
  },
};

export const STRINGS: Record<Locale, typeof en> = { en, ar };
export type Strings = typeof en;
