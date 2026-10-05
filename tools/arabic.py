"""Arabic text keys used for matching. Mirrored exactly in src/lib/arabic.ts (test/arabic-vectors.json checks parity).

norm(s)      letters and spaces only: no harakat/tatweel, unified alif/ya/ta marbuta/hamza seats, no honorifics.
             Same as norm_ar() in build_hadith_db.py, so it matches hadith.ar_norm_matn.
stem(w)      light stemmer (Light10-style): strip one conjunction + article prefix and one suffix, then drop medial
             alif so Uthmani spelling (العلمين) and imlaei spelling (العالمين) meet.
stems(s)     stem of every word of norm(s).
trigrams(s)  per-word character trigrams of the alif-free skeleton, as space-separated "words" for a plain FTS5 index.
"""
import re
import unicodedata

INVISIBLE = re.compile("[​‎‏؜‪-‮⁦-⁩﻿­]")
HARAKAT = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]")
ALIF = re.compile("[آأإٱٲٳ]")
NON_LETTER = re.compile("[^ء-ي٠-٩\\s]")
HONORIFIC_LIGATURES = re.compile("[ﷺﷻ﵀-﵏]")


# ىٰ is a long a inside a word (تتوفىٰهم → تتوفاهم) but plain alif maqsura at the end (علىٰ → على).
YA_DAGGER_MID = re.compile("ىٰ(?=[ً-ٰٟۖ-ۭ]*[ء-ي])")
LEGACY_YA_DAGGER = False  # True reproduces the 4 Oct index (ىٰ → ا everywhere); tools/reindex_quran.py diffs the two


def _letters(s):
    # Uthmani: waw carrying a dagger alif is read as alif (الصلوٰة → الصلاة).
    s = s.replace("وٰ", "ا")
    s = s.replace("ىٰ", "ا") if LEGACY_YA_DAGGER else YA_DAGGER_MID.sub("ا", s)
    s = HARAKAT.sub("", s).replace("ـ", "")
    s = ALIF.sub("ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return s.replace("ی", "ي").replace("ک", "ك")


HONORIFICS = sorted({" ".join(_letters(h).split()) for h in [
    "صلى الله عليه وسلم", "رضى الله عنه", "رضي الله عنه", "رضى الله عنها", "رضي الله عنها", "رضى الله عنهما",
    "رضي الله عنهما", "رضى الله عنهم", "رضي الله عنهم", "عليه الصلاة والسلام", "عليه السلام"]}, key=len, reverse=True)


def norm(s):
    if not s:
        return ""
    s = INVISIBLE.sub("", unicodedata.normalize("NFC", s))
    s = re.sub(r"\[\^\d+\]", " ", s)
    s = HONORIFIC_LIGATURES.sub(" ", s)
    s = NON_LETTER.sub(" ", _letters(s))
    s = " " + " ".join(s.split()) + " "
    s = s.replace("\u0621\u0627", "\u0627")  # Uthmani ءا = آ (ءامنوا → امنوا, وءاتوا → واتوا)
    for h in HONORIFICS:
        s = s.replace(" " + h + " ", " ")
    return " ".join(s.split())


PREFIXES = ["وال", "فال", "بال", "كال", "لل", "ال"]
SUFFIXES = ["ها", "ان", "ات", "ون", "ين", "وا", "يه", "هم", "هن", "كم", "نا", "ه", "ي"]


def stem(w):
    if len(w) >= 4 and w[0] in "وف" and not w.startswith(("وال", "فال")):
        w = w[1:]
    for p in PREFIXES:
        if w.startswith(p) and len(w) - len(p) >= 2:
            w = w[len(p):]
            break
    for suf in SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            w = w[: -len(suf)]
            break
    return skeleton(w)


def skeleton(w):
    """Drop every alif after the first letter (Uthmani writes many long vowels as dagger alif)."""
    return w[:1] + w[1:].replace("ا", "") if len(w) > 1 else w


def stems(s):
    return " ".join(stem(w) for w in norm(s).split())


def trigrams(s):
    out = []
    for w in norm(s).split():
        k = skeleton(w)
        if len(k) <= 3:
            out.append(k)
        else:
            out.extend(k[i:i + 3] for i in range(len(k) - 2))
    return " ".join(out)


if __name__ == "__main__":
    import json
    import sys
    samples = [
        "كُلُّ مَخْمُومِ الْقَلْبِ صَدُوقِ اللِّسَانِ",
        "ذُو الْقَلْبِ الْمَخْمُومِ",
        "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى",
        "ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ",
        "الحمد لله رب العالمين",
        "وَأَقِيمُواْ ٱلصَّلَوٰةَ وَءَاتُواْ ٱلزَّكَوٰةَ",
        "قال رسول الله صلى الله عليه وسلم: «من غشنا فليس منا»",
        "فَبِأَيِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ",
        "وَالْكَاظِمِينَ الْغَيْظَ وَالْعَافِينَ عَنِ النَّاسِ",
        "ﷺ قَالَ: لاَ تَغْضَبْ",
    ]
    vectors = [{"in": s, "norm": norm(s), "stems": stems(s), "trigrams": trigrams(s)} for s in samples]
    json.dump(vectors, sys.stdout, ensure_ascii=False, indent=1)
