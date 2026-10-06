// Islamic terms readers may not know, tagged in Latin-script text (English, Indonesian) so a click can explain them.
// The list and the short definitions are curated, not generated; the contextual explanation comes from /v1/explain.
// Arabic-script text is not tagged: words like حسن or سنة have everyday meanings there.

export type Term = { id: string; ar: string; forms: string[]; en: string; arGloss: string; lowerOnly?: boolean };

export const TERMS: Term[] = [
  { id: 'taqwa', ar: 'تقوى', forms: ['taqwa', 'takwa', 'taqwā'], en: 'Mindfulness of Allah that leads a person to obey Him and avoid what He forbids.', arGloss: 'أن تجعل بينك وبين عذاب الله وقاية بفعل أوامره واجتناب نواهيه.' },
  { id: 'ihsan', ar: 'إحسان', forms: ['ihsan', 'iḥsān'], en: 'Excellence: worshipping Allah as though you see Him, and doing deeds well.', arGloss: 'أن تعبد الله كأنك تراه، وإتقان العمل.' },
  { id: 'iman', ar: 'إيمان', forms: ['iman', 'īmān'], en: 'Faith: belief in the heart, words on the tongue and deeds of the limbs.', arGloss: 'قول باللسان واعتقاد بالقلب وعمل بالجوارح.', lowerOnly: true },
  { id: 'tawhid', ar: 'توحيد', forms: ['tawhid', 'tauhid', 'tawḥīd'], en: 'Affirming that Allah is One in His lordship, His worship, and His names and attributes.', arGloss: 'إفراد الله بالربوبية والألوهية والأسماء والصفات.' },
  { id: 'shirk', ar: 'شرك', forms: ['shirk', 'syirik', 'syirk'], en: 'Associating partners with Allah in what is His alone.', arGloss: 'جعل شريك لله فيما يختص به.' },
  { id: 'ikhlas', ar: 'إخلاص', forms: ['ikhlas', 'ikhlāṣ'], en: 'Doing a deed for Allah alone, not for people\'s praise.', arGloss: 'إرادة وجه الله وحده بالعمل.' },
  { id: 'tawakkul', ar: 'توكل', forms: ['tawakkul', 'tawakal', 'tawakkal'], en: 'Relying on Allah while taking the means.', arGloss: 'صدق اعتماد القلب على الله مع الأخذ بالأسباب.' },
  { id: 'dhikr', ar: 'ذكر', forms: ['dhikr', 'zikir', 'zikr', 'dzikir'], en: 'Remembrance of Allah, by the tongue and the heart.', arGloss: 'ذكر الله باللسان والقلب.' },
  { id: 'dua', ar: 'دعاء', forms: ["du'a", 'duʿāʾ', 'doa'], en: 'Supplication: calling on Allah and asking Him.', arGloss: 'سؤال الله والتضرع إليه.', lowerOnly: true },
  { id: 'sunnah', ar: 'سنة', forms: ['sunnah', 'sunah'], en: 'The way of the Prophet ﷺ (his sayings, deeds and approvals); in fiqh, a recommended act.', arGloss: 'ما أُثر عن النبي ﷺ من قول أو فعل أو تقرير، وفي الفقه: المستحب.' },
  { id: 'bidah', ar: 'بدعة', forms: ["bid'ah", 'bidʿah', 'bidah', "bid'ah"], en: 'An innovation in religion that has no basis in the Quran or Sunnah.', arGloss: 'ما أُحدث في الدين مما ليس له أصل في الشرع.' },
  { id: 'hadith', ar: 'حديث', forms: ['hadith', 'hadits', 'hadis', 'ḥadīth'], en: 'A report of what the Prophet ﷺ said, did or approved.', arGloss: 'ما أُضيف إلى النبي ﷺ من قول أو فعل أو تقرير.' },
  { id: 'sahih', ar: 'صحيح', forms: ['sahih', 'shahih', 'ṣaḥīḥ'], en: 'Authentic: an unbroken chain of trustworthy, precise narrators, with no hidden defect or irregularity.', arGloss: 'ما اتصل سنده بنقل العدل الضابط من غير شذوذ ولا علة.', lowerOnly: true },
  { id: 'hasan', ar: 'حسن', forms: ['hasan', 'ḥasan'], en: 'Good: an acceptable hadith whose narrators are slightly less precise than in a sahih one.', arGloss: 'ما خفّ ضبط رواته عن الصحيح مع بقية شروطه، وهو مقبول.', lowerOnly: true },
  { id: 'daif', ar: 'ضعيف', forms: ["da'if", 'daʿīf', 'daif', 'dhaif', "dha'if", 'ḍaʿīf'], en: 'Weak: a hadith that lacks a condition of acceptance, in its chain or its text.', arGloss: 'ما فقد شرطًا من شروط القبول.', lowerOnly: true },
  { id: 'mawdu', ar: 'موضوع', forms: ["mawdu'", 'mawḍūʿ', 'mawdu', 'maudhu', "maudhu'"], en: 'Fabricated: falsely attributed to the Prophet ﷺ.', arGloss: 'المكذوب المختلق المنسوب إلى النبي ﷺ.' },
  { id: 'isnad', ar: 'إسناد', forms: ['isnad', 'isnād', 'sanad'], en: 'The chain of narrators who passed a report on.', arGloss: 'سلسلة الرواة الموصلة إلى المتن.', lowerOnly: true },
  { id: 'matn', ar: 'متن', forms: ['matn', 'matan'], en: 'The text of a hadith, after its chain.', arGloss: 'ما ينتهي إليه السند من الكلام.' },
  { id: 'fiqh', ar: 'فقه', forms: ['fiqh', 'fikih', 'fiqih'], en: 'Islamic jurisprudence: the rulings on acts, with their evidence.', arGloss: 'العلم بالأحكام الشرعية العملية من أدلتها التفصيلية.' },
  { id: 'aqidah', ar: 'عقيدة', forms: ['aqidah', 'akidah', "'aqidah", 'ʿaqīdah'], en: 'Creed: what a Muslim believes about Allah and the unseen.', arGloss: 'ما يعقد عليه القلب من أمور الإيمان.' },
  { id: 'ijtihad', ar: 'اجتهاد', forms: ['ijtihad', 'ijtihād'], en: 'A qualified scholar\'s effort to derive a ruling from the evidence.', arGloss: 'بذل الوسع في استنباط الحكم الشرعي من دليله.' },
  { id: 'khilaf', ar: 'خلاف', forms: ['khilaf', 'khilāf', 'khilafiyah'], en: 'A difference of opinion among scholars on a question.', arGloss: 'اختلاف العلماء في مسألة.' },
  { id: 'ijma', ar: 'إجماع', forms: ["ijma'", 'ijmāʿ', 'ijma'], en: 'Consensus of the scholars on a ruling.', arGloss: 'اتفاق مجتهدي الأمة على حكم شرعي.' },
  { id: 'fard', ar: 'فرض', forms: ['fard', 'fardh', 'fardhu', 'fardu', 'farḍ'], en: 'Obligatory: rewarded if done, sinful if left.', arGloss: 'ما يُثاب فاعله ويأثم تاركه.' },
  { id: 'wajib', ar: 'واجب', forms: ['wajib', 'wājib'], en: 'Obligatory (most scholars use it as a synonym of fard).', arGloss: 'ما طلب الشارع فعله طلبًا جازمًا.' },
  { id: 'mustahab', ar: 'مستحب', forms: ['mustahab', 'mustahabb', 'mustaḥabb'], en: 'Recommended: rewarded if done, not sinful if left.', arGloss: 'ما يُثاب فاعله ولا يأثم تاركه.' },
  { id: 'makruh', ar: 'مكروه', forms: ['makruh', 'makrūh'], en: 'Disliked: rewarded if avoided, not sinful if done.', arGloss: 'ما يُثاب تاركه امتثالًا ولا يأثم فاعله.' },
  { id: 'haram', ar: 'حرام', forms: ['haram', 'ḥarām'], en: 'Forbidden: sinful if done.', arGloss: 'ما يأثم فاعله ويُثاب تاركه امتثالًا.', lowerOnly: true },
  { id: 'halal', ar: 'حلال', forms: ['halal', 'ḥalāl'], en: 'Permitted.', arGloss: 'المباح الذي أذن الشرع فيه.', lowerOnly: true },
  { id: 'zakat', ar: 'زكاة', forms: ['zakat', 'zakah', 'zakāh'], en: 'The obligatory alms on wealth that reaches a set amount, given to set categories of people.', arGloss: 'حق واجب في مال مخصوص لطائفة مخصوصة في وقت مخصوص.' },
  { id: 'sadaqah', ar: 'صدقة', forms: ['sadaqah', 'sadaqa', 'sedekah', 'shadaqah', 'ṣadaqah'], en: 'Voluntary charity, given for Allah\'s sake.', arGloss: 'ما يُعطى تطوعًا ابتغاء وجه الله.' },
  { id: 'salah', ar: 'صلاة', forms: ['salah', 'salat', 'shalat', 'ṣalāh'], en: 'The prayer, with its set movements and words.', arGloss: 'أقوال وأفعال مخصوصة مفتتحة بالتكبير مختتمة بالتسليم.', lowerOnly: true },
  { id: 'sujud', ar: 'سجود', forms: ['sujud', 'sujūd', 'sajdah'], en: 'Prostration in prayer: forehead, nose, hands, knees and toes on the ground.', arGloss: 'وضع الجبهة على الأرض تعبدًا.' },
  { id: 'ruku', ar: 'ركوع', forms: ["ruku'", 'rukūʿ', 'ruku', 'rukuk'], en: 'Bowing in prayer.', arGloss: 'الانحناء في الصلاة.' },
  { id: 'itidal', ar: 'اعتدال', forms: ["i'tidal", 'iʿtidāl', 'itidal', 'iktidal'], en: 'Standing straight up again after bowing in prayer.', arGloss: 'الرفع من الركوع والاستواء قائمًا.' },
  { id: 'wudu', ar: 'وضوء', forms: ['wudu', "wudu'", 'wudhu', 'wuḍūʾ'], en: 'Ablution: washing set parts of the body before prayer.', arGloss: 'استعمال الماء في أعضاء مخصوصة بنية.' },
  { id: 'khutbah', ar: 'خطبة', forms: ['khutbah', 'khotbah', 'khuṭbah'], en: 'A sermon, especially before the Friday prayer.', arGloss: 'الموعظة التي تُلقى في الجمعة والعيدين ونحوهما.' },
  { id: 'hajj', ar: 'حج', forms: ['hajj', 'haji', 'ḥajj'], en: 'The pilgrimage to Makkah, once in a lifetime for those able.', arGloss: 'قصد مكة لأداء المناسك في وقت مخصوص.', lowerOnly: true },
  { id: 'umrah', ar: 'عمرة', forms: ['umrah', "'umrah", 'ʿumrah'], en: 'The lesser pilgrimage, possible at any time of the year.', arGloss: 'زيارة البيت الحرام للطواف والسعي والحلق أو التقصير.' },
  { id: 'akhirah', ar: 'آخرة', forms: ['akhirah', 'akhirat', 'ākhirah'], en: 'The Hereafter: life after death, the Day of Judgement and its outcome.', arGloss: 'الدار الآخرة وما فيها من بعث وحساب وجزاء.' },
  { id: 'jannah', ar: 'جنة', forms: ['jannah', 'jannat'], en: 'Paradise.', arGloss: 'دار النعيم التي أعدها الله للمتقين.' },
  { id: 'manhaj', ar: 'منهج', forms: ['manhaj', 'manhaj'], en: 'Methodology: the way a person learns and practises the religion.', arGloss: 'الطريق والمسلك في فهم الدين والعمل به.' },
  { id: 'murajaah', ar: 'مراجعة', forms: ["muraja'ah", 'murajaah', "muroja'ah", 'murojaah'], en: 'Revision: reviewing what was learned or memorised.', arGloss: 'مراجعة المحفوظ والمتعلَّم.' },
  { id: 'tazkiyah', ar: 'تزكية', forms: ['tazkiyah', 'tazkiyatun', 'tazkiyyah'], en: 'Purifying the soul and growing it in good.', arGloss: 'تطهير النفس وتنميتها بالخير.' },
  { id: 'ummah', ar: 'أمة', forms: ['ummah', 'umat', 'ummat'], en: 'The community of Muslims.', arGloss: 'جماعة المسلمين.', lowerOnly: true },
  { id: 'sahabah', ar: 'صحابة', forms: ['sahabah', 'ṣaḥābah', 'shahabat'], en: 'The Companions: those who met the Prophet ﷺ as believers and died upon Islam.', arGloss: 'من لقي النبي ﷺ مؤمنًا به ومات على الإسلام.' },
  { id: 'tasmi', ar: 'تسميع', forms: ['tasmih', "tasmi'", 'tasmi'], en: 'Saying "Samiʿa Allāhu li-man ḥamidah" when rising from bowing.', arGloss: 'قول: سمع الله لمن حمده عند الرفع من الركوع.' },
  { id: 'tahmid', ar: 'تحميد', forms: ['tahmid', 'taḥmīd'], en: 'Praising Allah: "Rabbanā wa laka al-ḥamd".', arGloss: 'قول: ربنا ولك الحمد.' },
];

const BY_FORM = new Map<string, Term>();
for (const t of TERMS) for (const f of t.forms) BY_FORM.set(f.toLowerCase(), t);
const FORMS = [...BY_FORM.keys()].sort((a, b) => b.length - a.length).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
// Whole words only; a letter (Latin or Arabic) on either side means it is part of another word.
const RE = new RegExp(`(?<![\\p{L}\\p{M}'ʿ])(${FORMS.join('|')})(?![\\p{L}\\p{M}])`, 'giu');

export type TermPiece = { text: string; term?: Term };

/** Split Latin-script text into plain pieces and glossary terms (first occurrence of each term per call only). */
export function termPieces(text: string, seen = new Set<string>()): TermPiece[] {
  const out: TermPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const word = m[0];
    const term = BY_FORM.get(word.toLowerCase());
    if (!term || seen.has(term.id) || (term.lowerOnly && word !== word.toLowerCase())) continue;
    seen.add(term.id);
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: word, term });
    last = m.index! + word.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const termById = (id: string) => TERMS.find((t) => t.id === id);
