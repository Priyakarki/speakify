/*
 * Sound-level hints using the free CMU Pronouncing Dictionary.
 * When the recognizer heard a different word than expected (e.g. "tree" for
 * "three"), we compare the two words' phonemes and describe the difference
 * ("the TH sound was heard as T"). This only explains a detected mismatch; it
 * does NOT measure pronunciation acoustically.
 */
let dictionaryPromise = null;

function loadDictionary() {
    if (!dictionaryPromise) {
        // cmu-pronouncing-dictionary is an ES module, so it's loaded with import().
        dictionaryPromise = import("cmu-pronouncing-dictionary")
            .then((mod) => mod.dictionary || mod.default || {})
            .catch((error) => {
                console.warn("[speaking] CMU dictionary unavailable:", error.message);
                return {};
            });
    }
    return dictionaryPromise;
}

const SOUNDS = {
    AA: '"o" (as in hot)', AE: '"a" (as in cat)', AH: '"u" (as in cup)', AO: '"aw" (as in law)',
    AW: '"ow" (as in now)', AY: '"i" (as in time)', B: '"b"', CH: '"ch" (as in chair)', D: '"d"',
    DH: '"th" (as in this)', EH: '"e" (as in bed)', ER: '"er" (as in bird)', EY: '"ay" (as in day)',
    F: '"f"', G: '"g" (as in go)', HH: '"h"', IH: '"i" (as in sit)', IY: '"ee" (as in see)',
    JH: '"j" (as in jam)', K: '"k"', L: '"l"', M: '"m"', N: '"n"', NG: '"ng" (as in sing)',
    OW: '"o" (as in go)', OY: '"oy" (as in boy)', P: '"p"', R: '"r"', S: '"s"', SH: '"sh" (as in ship)',
    T: '"t"', TH: '"th" (as in think)', UH: '"oo" (as in book)', UW: '"oo" (as in food)', V: '"v"',
    W: '"w"', Y: '"y" (as in yes)', Z: '"z"', ZH: '"s" (as in measure)'
};

function phonemesFor(dictionary, word) {
    const entry = dictionary[String(word || "").toLowerCase()];
    if (!entry) return null;
    return entry.split(" ").map((p) => p.replace(/\d/g, ""));
}

// Levenshtein alignment over phoneme arrays -> list of differences.
function diffPhonemes(expected, heard) {
    const n = expected.length;
    const m = heard.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = expected[i - 1] === heard[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
        }
    }
    const diffs = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (expected[i - 1] === heard[j - 1] ? 0 : 1)) {
            if (expected[i - 1] !== heard[j - 1]) diffs.push({ type: "substitution", expected: expected[i - 1], heard: heard[j - 1] });
            i--; j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            diffs.push({ type: "missing", expected: expected[i - 1] });
            i--;
        } else {
            diffs.push({ type: "extra", heard: heard[j - 1] });
            j--;
        }
    }
    return diffs.reverse();
}

function describe(diff) {
    const e = diff.expected && (SOUNDS[diff.expected] || diff.expected);
    const h = diff.heard && (SOUNDS[diff.heard] || diff.heard);
    if (diff.type === "substitution") return `the ${e} sound was heard as ${h}`;
    if (diff.type === "missing") return `the ${e} sound was not heard`;
    return `an extra ${h} sound was heard`;
}

/*
 * Returns { samePronunciation, soundDifferences, hint } for an expected/heard word pair.
 * samePronunciation = true for homophones (e.g. "there"/"their"), which
 * means the recognizer just chose a different spelling.
 */
async function comparePronunciation(expectedWord, heardWord) {
    const dictionary = await loadDictionary();
    const expected = phonemesFor(dictionary, expectedWord);
    const heard = phonemesFor(dictionary, heardWord);
    if (!expected || !heard) return { samePronunciation: false, soundDifferences: null, hint: null };

    const diffs = diffPhonemes(expected, heard);
    if (diffs.length === 0) return { samePronunciation: true, soundDifferences: 0, hint: null };
    if (diffs.length > 3) {
        return {
            samePronunciation: false,
            soundDifferences: diffs.length,
            hint: `Sounded like a different word ("${heardWord}")`
        };
    }
    const text = diffs.slice(0, 2).map(describe).join("; ");
    return {
        samePronunciation: false,
        soundDifferences: diffs.length,
        hint: text.charAt(0).toUpperCase() + text.slice(1)
    };
}

async function isDictionaryAvailable() {
    const dictionary = await loadDictionary();
    return Object.keys(dictionary).length > 0;
}


/* ------------------------------------------------------------------
 * Added for /api/ai/analyze-speaking: dictionary pronunciations as IPA
 * and a learner-friendly respelling ("KUHM-fer-tuh-buhl").
 * Both come from the CMU Pronouncing Dictionary (General American), so
 * they are reliable citation forms. Words not in the dictionary get null.
 * ------------------------------------------------------------------ */
const IPA = {
    AA: "ɑ", AE: "æ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", EY: "eɪ", IH: "ɪ", IY: "i",
    OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u", B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ",
    HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "r", S: "s",
    SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ"
};

const RESPELL = {
    AA: "ah", AE: "a", AH: "uh", AO: "aw", AW: "ow", AY: "igh", EH: "e", ER: "er", EY: "ay",
    IH: "i", IY: "ee", OW: "oh", OY: "oy", UH: "uu", UW: "oo", B: "b", CH: "ch", D: "d",
    DH: "th", F: "f", G: "g", HH: "h", JH: "j", K: "k", L: "l", M: "m", N: "n", NG: "ng",
    P: "p", R: "r", S: "s", SH: "sh", T: "t", TH: "th", V: "v", W: "w", Y: "y", Z: "z", ZH: "zh"
};

// Two-consonant clusters that can start an English syllable (e.g. "tr", "st").
const ONSETS = new Set([
    "P R", "B R", "T R", "D R", "K R", "G R", "F R", "TH R", "SH R",
    "P L", "B L", "K L", "G L", "F L", "S L",
    "T W", "D W", "K W", "S W", "S P", "S T", "S K", "S M", "S N"
]);

const isVowel = (p) => /\d$/.test(p);
const base = (p) => p.replace(/\d/g, "");

// Split "K AH1 M F ER0 T AH0 B AH0 L" into syllables of phonemes.
function syllabify(phonemes) {
    const vowels = phonemes.map((p, i) => (isVowel(p) ? i : -1)).filter((i) => i >= 0);
    if (vowels.length <= 1) return [phonemes];
    const syllables = [];
    let start = 0;
    for (let k = 0; k < vowels.length - 1; k++) {
        const v = vowels[k];
        const next = vowels[k + 1];
        const cluster = phonemes.slice(v + 1, next);
        let toNext = cluster.length === 0 ? 0 : 1;
        if (cluster.length >= 2 && ONSETS.has(cluster.slice(-2).map(base).join(" "))) toNext = 2;
        const boundary = next - toNext;
        syllables.push(phonemes.slice(start, boundary));
        start = boundary;
    }
    syllables.push(phonemes.slice(start));
    return syllables;
}

function toIpa(phonemes) {
    const syllables = syllabify(phonemes);
    const parts = syllables.map((syl) => {
        const stress = syl.find(isVowel)?.slice(-1);
        const mark = syllables.length > 1 ? (stress === "1" ? "ˈ" : stress === "2" ? "ˌ" : "") : "";
        return (
            mark +
            syl
                .map((p) => {
                    const b = base(p);
                    if (b === "AH") return p.endsWith("0") ? "ə" : "ʌ";
                    if (b === "ER") return p.endsWith("0") ? "ɚ" : "ɝ";
                    return IPA[b] || b.toLowerCase();
                })
                .join("")
        );
    });
    return `/${parts.join(syllables.length > 1 ? "" : "")}/`;
}

function toRespelling(phonemes) {
    const syllables = syllabify(phonemes);
    return syllables
        .map((syl) => {
            const stressed = syllables.length > 1 && syl.some((p) => p.endsWith("1"));
            const text = syl.map((p) => RESPELL[base(p)] || base(p).toLowerCase()).join("");
            return stressed ? text.toUpperCase() : text;
        })
        .join("-");
}

/*
 * Returns { phonemes, ipa, respelling, syllableCount } for a word, or null
 * when the word is not in the dictionary.
 */
async function getPronunciationInfo(word) {
    const dictionary = await loadDictionary();
    const entry = dictionary[String(word || "").toLowerCase()];
    if (!entry) return null;
    const phonemes = entry.split(" ");
    return {
        phonemes: phonemes.map(base),
        ipa: toIpa(phonemes),
        respelling: toRespelling(phonemes),
        syllableCount: phonemes.filter(isVowel).length
    };
}

// Sound differences that are normal in Indian and other regional English
// accents. A word that differs ONLY by one of these is not a pronunciation
// mistake (the rules ask us not to penalise accent).
const ACCENT_VARIATIONS = new Set([
    "TH>T", "DH>D", "TH>D", "V>W", "W>V", "V>B", "B>V", "Z>S", "AA>AO", "AO>AA"
]);

function isAccentVariation(diffs) {
    return (
        diffs.length === 1 &&
        diffs[0].type === "substitution" &&
        ACCENT_VARIATIONS.has(`${diffs[0].expected}>${diffs[0].heard}`)
    );
}

async function comparePhonemesDetailed(expectedWord, heardWord) {
    const [expected, heard] = await Promise.all([getPronunciationInfo(expectedWord), getPronunciationInfo(heardWord)]);
    if (!expected || !heard) return { expected, heard, diffs: null };
    return { expected, heard, diffs: diffPhonemes(expected.phonemes, heard.phonemes) };
}

module.exports = {
    comparePronunciation,
    diffPhonemes,
    isDictionaryAvailable,
    getPronunciationInfo,
    comparePhonemesDetailed,
    isAccentVariation,
    describeSoundDifference: describe,
    SOUNDS
};
