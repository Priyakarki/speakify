/*
 * BoloBuddy AI Story Reading & Speaking Analysis
 * ==============================================
 * Input : the original story text + the words (with timestamps) that the local
 *         open-source Whisper model heard in the user's recording.
 * Output: the structured analysis returned by POST /api/ai/analyze-speaking.
 *
 * Everything here is deterministic and explainable. No LLM guesses, no random numbers.
 * Three kinds of evidence are kept separate (see analysisMethod in the result):
 *   1. MEASURED FROM AUDIO      - word timestamps -> duration, WPM, pauses, rhythm
 *   2. DETECTED BY RECOGNITION  - a passage word was heard as a different word;
 *                                 CMU dictionary phonemes explain which sounds differ
 *   3. TRANSCRIPT-BASED INFERENCE - skipped/added/repeated/wrong words, false starts
 *
 * Scoring weights (as requested):
 *   overall = 35% pronunciation + 25% fluency + 20% reading accuracy
 *           + 10% speed + 10% pause control
 * Limitation: word stress, intonation and phoneme-level acoustic scores are NOT
 * available from Whisper, so they are not part of any score.
 */
const { normalize, align, tokenizeReference, tokenizeRecognized, similarity } = require("../speech/analysis");
const {
    comparePhonemesDetailed,
    getPronunciationInfo,
    isAccentVariation,
    describeSoundDifference,
    SOUNDS
} = require("../speech/pronunciation");

const WEIGHTS = { pronunciation: 0.35, fluency: 0.25, readingAccuracy: 0.2, speed: 0.1, pause: 0.1 };

const PAUSE_MIN = 0.3; // gaps shorter than this are just word boundaries
const MICRO_PAUSE = 0.6; // mid-sentence gaps below this are natural (breathing, phrasing)
const MID_SENTENCE_STOP = 1.5; // mid-sentence gap that counts as "stopping"
const CLAUSE_PAUSE_OK = 1.2; // natural pause allowed at , ; :
const SENTENCE_PAUSE_OK = 2.0; // natural pause allowed at . ! ?

const SPEED_BANDS = [
    { max: 80, label: "Too Slow" },
    { max: 100, label: "Slow" },
    { max: 160, label: "Good" },
    { max: 190, label: "Fast" },
    { max: Infinity, label: "Too Fast" }
];

const SEVERITY_CREDIT = { minor: 0.8, moderate: 0.55, major: 0.3 };
const SEVERITY_RANK = { major: 3, moderate: 2, minor: 1 };

const TIPS = {
    TH: 'Put the tip of your tongue lightly between your teeth and blow air: "th" as in think.',
    DH: 'Put your tongue between your teeth and use your voice: "th" as in this.',
    V: 'Touch your top teeth to your bottom lip and use your voice for "v".',
    W: 'Round your lips like "oo" for "w". Your teeth should not touch your lip.',
    R: "Curl your tongue back a little. It should not touch the top of your mouth.",
    L: 'Touch the tip of your tongue behind your top teeth for "l".',
    Z: 'Make a buzzing "z" sound, like a bee.',
    S: 'Keep the "s" sound sharp and quiet, without using your voice.',
    SH: 'Round your lips and push air out: "sh".',
    ZH: 'Like "sh" but with your voice, as in "measure".',
    NG: 'Keep the back of your tongue up for "ng". Don\'t add a "g" sound at the end.',
    IY: 'Make a long "ee" sound, as in "see".',
    IH: 'Make a short, relaxed "i" sound, as in "sit".',
    AE: 'Open your mouth wide for "a", as in "cat".',
    EH: 'Make a short "e" sound, as in "bed".',
    UW: 'Round your lips for a long "oo", as in "food".',
    UH: 'Make a short "oo" sound, as in "book".',
    P: 'Push a small puff of air for "p".',
    B: 'Use your voice for "b". Your lips press together first.',
    F: 'Touch your top teeth to your bottom lip and blow air for "f".',
    T: 'Tap your tongue behind your top teeth for "t".',
    D: 'Tap your tongue behind your top teeth and use your voice for "d".',
    K: 'Make "k" at the back of your mouth.',
    G: 'Make "g" at the back of your mouth, using your voice.'
};

const round = (v, d = 0) => {
    const f = 10 ** d;
    return Math.round(v * f) / f;
};
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || `${word}s`}`;

function levelFor(score) {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Good";
    if (score >= 60) return "Developing";
    if (score >= 40) return "Needs Improvement";
    return "Beginner";
}

// ------------------------------------------------------------------
// Substitution classification: pronunciation issue vs different word
// ------------------------------------------------------------------
async function classifySubstitution(expectedNorm, heardNorm) {
    const { expected, heard, diffs } = await comparePhonemesDetailed(expectedNorm, heardNorm);

    if (diffs) {
        if (diffs.length === 0) return { kind: "correct", reason: "homophone", expected, heard };
        if (isAccentVariation(diffs)) return { kind: "accent", expected, heard, diffs };

        const relative = diffs.length / Math.max(expected.phonemes.length, heard.phonemes.length);
        if (diffs.length >= 4 || relative > 0.6) {
            // Too different to be the same word said differently: a reading error.
            return { kind: "wrong", expected, heard, diffs, confidence: relative > 0.8 ? 0.8 : 0.65 };
        }
        const syllableChange = expected.syllableCount !== heard.syllableCount;
        // Severity grows with the number of sounds that differ; a dropped or
        // added syllable ("incorrect syllables") raises it one level.
        const levels = ["minor", "moderate", "major"];
        const severity = levels[Math.min(2, diffs.length - 1 + (syllableChange ? 1 : 0))];
        const confidence = { minor: 0.6, moderate: 0.7, major: 0.75 }[severity] + (syllableChange ? 0.05 : 0);
        return { kind: "pronunciation", severity, confidence: round(confidence, 2), expected, heard, diffs, syllableChange };
    }

    // One of the words isn't in the dictionary: fall back to spelling similarity (lower confidence).
    const sim = similarity(expectedNorm, heardNorm);
    if (sim >= 0.75) return { kind: "pronunciation", severity: "minor", confidence: 0.45, expected, heard, diffs: null };
    if (sim >= 0.5) return { kind: "pronunciation", severity: "moderate", confidence: 0.45, expected, heard, diffs: null };
    return { kind: "wrong", expected, heard, diffs: null, confidence: 0.5 };
}

function pronunciationExplanation(c, heardText) {
    const parts = [];
    if (c.diffs && c.diffs.length) {
        parts.push(
            c.diffs
                .slice(0, 2)
                .map((d) => describeSoundDifference(d))
                .join("; ")
        );
    } else {
        parts.push(`It sounded like "${heardText}"`);
    }
    if (c.syllableChange && c.expected && c.heard) {
        parts.push(
            c.heard.syllableCount < c.expected.syllableCount
                ? `a syllable seems to be missing (${c.expected.syllableCount} expected)`
                : "an extra syllable was heard"
        );
    }
    const text = parts.join(", and ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function practiceTipFor(c) {
    const tips = [];
    const first = c.diffs && c.diffs[0];
    if (first) {
        if (first.type === "missing") tips.push(`Don't drop the ${SOUNDS[first.expected] || first.expected} sound.`);
        else if (first.expected && TIPS[first.expected]) tips.push(TIPS[first.expected]);
    }
    if (c.expected?.respelling) {
        tips.push(
            c.expected.syllableCount > 1
                ? `Say it slowly by syllables (${c.expected.respelling}), then at normal speed.`
                : `Say it slowly (${c.expected.respelling.toUpperCase()}), then at normal speed.`
        );
    } else {
        tips.push("Listen to the word in a dictionary, then repeat it slowly three times.");
    }
    return tips.join(" ");
}

// ------------------------------------------------------------------
// Main analysis
// ------------------------------------------------------------------
async function analyzeSpeaking({ referenceText, recognizedWords, audioDurationSec }) {
    // ---- Reference tokens with sentence numbers ----
    const refAll = tokenizeReference(referenceText);
    let sentence = 0;
    const ref = [];
    refAll.forEach((t) => {
        if (t.norm) ref.push({ ...t, sentence });
        if (t.endsSentence) sentence += 1;
    });
    if (ref.length === 0) throw new Error("The story text has no readable words.");
    const refNorms = new Set(ref.map((r) => r.norm));

    // ---- Recognized words (raw transcript is never corrected) ----
    const spokenAll = tokenizeRecognized(recognizedWords);
    const fillerSet = new Set(spokenAll.filter((w) => w.filler && !refNorms.has(w.norm)));
    const spoken = spokenAll.filter((w) => !fillerSet.has(w));

    const ops = align(ref, spoken);

    const words = ref.map((t, i) => ({
        position: i,
        text: t.text,
        norm: t.norm,
        sentence: t.sentence,
        status: "skipped",
        heard: null,
        start: null,
        end: null
    }));
    const refForHyp = new Array(spoken.length).fill(null);
    const added = [];
    const repeated = [];
    const falseStarts = [];
    const extraFillers = [];
    const substitutions = [];

    ops.forEach((op, k) => {
        if (op.type === "match" || op.type === "sub") {
            const w = spoken[op.h];
            Object.assign(words[op.r], { heard: w.text, start: w.start, end: w.end, status: op.type === "match" ? "correct" : "pending" });
            refForHyp[op.h] = op.r;
            if (op.type === "sub") substitutions.push(op.r);
            return;
        }
        if (op.type !== "ins") return;
        const w = spoken[op.h];
        const nextRefOp = ops.slice(k + 1).find((o) => o.r !== undefined);
        const prevRefOp = [...ops.slice(0, k)].reverse().find((o) => o.r !== undefined);
        const nearRef = [prevRefOp, nextRefOp].filter(Boolean).map((o) => ref[o.r].norm);
        const position = nextRefOp ? nextRefOp.r : ref.length;
        const prevSpoken = spoken[op.h - 1];

        if ((prevSpoken && prevSpoken.norm === w.norm) || nearRef.includes(w.norm)) {
            repeated.push({ word: w.text, position });
        } else if (nextRefOp && w.norm.length >= 2 && ref[nextRefOp.r].norm.startsWith(w.norm) && ref[nextRefOp.r].norm !== w.norm) {
            falseStarts.push({ heard: w.text, word: ref[nextRefOp.r].text.replace(/^[^\w']+|[^\w']+$/g, ""), position });
        } else if (w.norm === "like" && !refNorms.has("like")) {
            extraFillers.push(w.text);
        } else {
            added.push({ word: w.text, position });
        }
    });

    // ---- Classify substituted words ----
    const pronunciationMistakes = [];
    const accentNotes = [];
    const wrongWords = [];
    await Promise.all(
        substitutions.map(async (r) => {
            const w = words[r];
            const heardNorm = normalize(w.heard);
            const c = await classifySubstitution(w.norm, heardNorm);
            const cleanWord = w.text.replace(/^[^\w']+|[^\w']+$/g, "");
            if (c.kind === "correct") {
                w.status = "correct";
            } else if (c.kind === "accent") {
                w.status = "accent";
                accentNotes.push({
                    word: cleanWord,
                    position: r,
                    heardAs: w.heard,
                    note: `Common accent variation (${describeSoundDifference(c.diffs[0])}). Not counted as a mistake.`
                });
            } else if (c.kind === "wrong") {
                w.status = "wrong";
                wrongWords.push({ expected: cleanWord, heard: w.heard, position: r, confidence: c.confidence });
            } else {
                w.status = "pronunciation";
                w.severity = c.severity;
                pronunciationMistakes.push({
                    word: cleanWord,
                    position: r,
                    userPronunciation: w.heard,
                    userPronunciationRespelling: c.heard?.respelling || null,
                    correctPronunciation: c.expected?.respelling || null,
                    ipa: c.expected?.ipa || null,
                    explanation: pronunciationExplanation(c, w.heard),
                    severity: c.severity,
                    confidence: c.confidence,
                    evidence: "Speech recognizer heard a different word; sound difference from the CMU Pronouncing Dictionary",
                    _classification: c
                });
            }
        })
    );
    pronunciationMistakes.sort((a, b) => a.position - b.position);
    wrongWords.sort((a, b) => a.position - b.position);
    accentNotes.sort((a, b) => a.position - b.position);

    // ---- Skipped vs not read (stopped before the end) ----
    let lastRead = -1;
    words.forEach((w, i) => {
        if (w.status !== "skipped") lastRead = i;
    });
    words.forEach((w, i) => {
        if (w.status === "skipped" && i > lastRead) w.status = "not_read";
    });
    const skippedWords = words.filter((w) => w.status === "skipped").map((w) => ({ word: w.text.replace(/^[^\w']+|[^\w']+$/g, ""), position: w.position }));
    const notRead = words.filter((w) => w.status === "not_read");

    // ================= 3. PRONUNCIATION SCORE =================
    const evaluated = words.filter((w) => ["correct", "accent", "pronunciation"].includes(w.status));
    const credit = evaluated.reduce((sum, w) => sum + (w.status === "pronunciation" ? SEVERITY_CREDIT[w.severity] : 1), 0);
    const mistakeCounts = {};
    pronunciationMistakes.forEach((m) => {
        const key = m.word.toLowerCase();
        mistakeCounts[key] = (mistakeCounts[key] || 0) + 1;
    });
    const repeatedErrorExtra = Object.values(mistakeCounts).reduce((s, n) => s + Math.max(0, n - 1), 0);
    const repeatedErrorPenalty = Math.min(10, repeatedErrorExtra * 2);
    const pronunciationScore = evaluated.length ? round(clamp((100 * credit) / evaluated.length - repeatedErrorPenalty)) : 0;
    const bySeverity = { minor: 0, moderate: 0, major: 0 };
    pronunciationMistakes.forEach((m) => {
        bySeverity[m.severity] += 1;
    });
    const clearCount = evaluated.filter((w) => w.status === "correct").length;
    const pronunciationExplanationText = evaluated.length
        ? `${clearCount} of ${plural(evaluated.length, "word")} you read were recognised clearly` +
          (accentNotes.length ? `, and ${accentNotes.length} had normal accent variation (not penalised)` : "") +
          `. Pronunciation issues found: ${bySeverity.major} major, ${bySeverity.moderate} moderate, ${bySeverity.minor} minor.` +
          (repeatedErrorPenalty ? ` The same word was mispronounced more than once (−${repeatedErrorPenalty}).` : "")
        : "No passage words could be evaluated, so the pronunciation score is 0.";

    // ================= 4. SPEED (measured from audio) =================
    const timed = spokenAll.filter((w) => w.start !== null && w.end !== null).sort((a, b) => a.start - b.start);
    const speakingSec = timed.length ? Math.max(0, timed[timed.length - 1].end - timed[0].start) : 0;
    const spokenWords = spoken.length;
    const wpm = speakingSec >= 1 ? round((spokenWords / speakingSec) * 60) : null;
    const speedClass = wpm === null ? "Not enough speech" : SPEED_BANDS.find((b) => wpm < b.max).label;
    let speedScore = 0;
    if (wpm !== null) {
        if (wpm >= 100 && wpm <= 160) speedScore = 100;
        else if (wpm < 100) speedScore = round(clamp(100 - (100 - wpm) * 1.5));
        else speedScore = round(clamp(100 - (wpm - 160) * 1.5));
    }

    // ================= 5. PAUSES (measured from audio) =================
    const hypIndex = new Map(spoken.map((w, i) => [w, i]));
    const pauses = [];
    for (let i = 1; i < timed.length; i++) {
        const a = timed[i - 1];
        const b = timed[i];
        const gap = round(b.start - a.end, 2);
        if (gap < PAUSE_MIN) continue;
        const refIdx = hypIndex.has(a) ? refForHyp[hypIndex.get(a)] : null;
        const atSentenceEnd = refIdx !== null && ref[refIdx].endsSentence;
        const atClause = refIdx !== null && ref[refIdx].endsClause;
        let type;
        if (atSentenceEnd) type = gap < SENTENCE_PAUSE_OK ? "natural" : "long-at-punctuation";
        else if (atClause) type = gap < CLAUSE_PAUSE_OK ? "natural" : "long-at-punctuation";
        else if (gap < MICRO_PAUSE) type = "natural";
        else type = gap >= MID_SENTENCE_STOP ? "stopped-mid-sentence" : "hesitation";
        pauses.push({ afterWord: a.text, beforeWord: b.text, at: a.end, durationSeconds: gap, type, necessary: type === "natural" });
    }
    const unnecessary = pauses.filter((p) => !p.necessary);
    const midSentenceStops = pauses.filter((p) => p.type === "stopped-mid-sentence").length;
    const hesitationPauses = pauses.filter((p) => p.type === "hesitation").length;
    const fillerWords = [...[...fillerSet].map((f) => f.text), ...extraFillers];
    const speakingMin = speakingSec / 60;
    const pausesPerMinute = speakingMin > 0 ? round(pauses.length / speakingMin, 1) : 0;
    const frequentPauses = pausesPerMinute > 25;
    const hesitationCount = hesitationPauses + midSentenceStops + fillerWords.length + falseStarts.length + repeated.length;

    const pausePenalties = {
        unnecessaryPauses: Math.min(49, unnecessary.length * 7),
        fillers: Math.min(20, fillerWords.length * 4),
        restarts: Math.min(15, (falseStarts.length + repeated.length) * 3),
        frequentPauses: frequentPauses ? Math.min(10, round(pausesPerMinute - 25)) : 0
    };
    const pauseScore = spokenWords >= 3 ? round(clamp(100 - Object.values(pausePenalties).reduce((a, b) => a + b, 0))) : 0;

    // ================= 7. READING ACCURACY (transcript-based) =================
    const refTotal = ref.length;
    const readingAccuracyScore = round(
        clamp(
            (100 * (refTotal - skippedWords.length - notRead.length - wrongWords.length - 0.5 * added.length - 0.25 * repeated.length)) /
                refTotal
        )
    );
    const sentenceIds = [...new Set(ref.map((r) => r.sentence))];
    const sentenceText = (id) => ref.filter((r) => r.sentence === id).map((r) => r.text).join(" ");
    const startedSentences = sentenceIds.filter((id) => words.some((w) => w.sentence === id && !["skipped", "not_read"].includes(w.status)));
    const incompleteSentences = startedSentences
        .map((id) => {
            const sw = words.filter((w) => w.sentence === id);
            const missing = sw.filter((w) => ["skipped", "not_read"].includes(w.status)).length;
            return missing ? { sentence: id + 1, text: sentenceText(id).slice(0, 160), missingWords: missing, of: sw.length } : null;
        })
        .filter(Boolean);
    const unreadSentences = sentenceIds.length - startedSentences.length;

    const differences = [
        ...skippedWords.map((s) => ({ type: "skipped", expected: s.word, position: s.position })),
        ...wrongWords.map((w) => ({ type: "wrong", expected: w.expected, heard: w.heard, position: w.position, confidence: w.confidence })),
        ...added.map((a) => ({ type: "added", heard: a.word, position: a.position })),
        ...repeated.map((a) => ({ type: "repeated", heard: a.word, position: a.position })),
        ...falseStarts.map((f) => ({ type: "false-start", heard: f.heard, expected: f.word, position: f.position }))
    ].sort((a, b) => a.position - b.position);
    if (notRead.length) {
        differences.push({
            type: "not-read",
            fromPosition: notRead[0].position,
            toPosition: notRead[notRead.length - 1].position,
            count: notRead.length,
            startsWith: notRead.slice(0, 8).map((w) => w.text).join(" ")
        });
    }

    // ================= 6. FLUENCY =================
    // Rhythm: how steady the speaking rate is from sentence to sentence.
    const rates = startedSentences
        .map((id) => {
            const tw = words.filter((w) => w.sentence === id && w.start !== null && w.end !== null);
            if (tw.length < 3) return null;
            const dur = tw[tw.length - 1].end - tw[0].start;
            return dur >= 1 ? tw.length / dur : null;
        })
        .filter((r) => r !== null);
    let rhythmVariation = null;
    if (rates.length >= 2) {
        const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
        const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
        rhythmVariation = round(sd / mean, 2);
    }
    const incompleteStarted = incompleteSentences.length;
    const fluencyPenalties = {
        unnecessaryPauses: Math.min(25, unnecessary.length * 5),
        fillers: Math.min(12, fillerWords.length * 3),
        repetitionsAndFalseStarts: Math.min(16, repeated.length * 3 + falseStarts.length * 4),
        incompleteSentences: startedSentences.length ? round((20 * incompleteStarted) / startedSentences.length) : 0,
        unevenRhythm: rhythmVariation === null ? 0 : round(Math.min(12, Math.max(0, rhythmVariation - 0.25) * 30)),
        extremeSpeed: ["Too Slow", "Too Fast"].includes(speedClass) ? 8 : 0
    };
    const fluencyScore = spokenWords >= 3 ? round(clamp(100 - Object.values(fluencyPenalties).reduce((a, b) => a + b, 0))) : 0;

    // ================= 8. OVERALL + 9. LEVEL =================
    const componentScores = {
        pronunciationScore,
        fluencyScore,
        readingAccuracyScore,
        speedScore,
        pauseScore
    };
    const overallScore = round(
        WEIGHTS.pronunciation * pronunciationScore +
            WEIGHTS.fluency * fluencyScore +
            WEIGHTS.readingAccuracy * readingAccuracyScore +
            WEIGHTS.speed * speedScore +
            WEIGHTS.pause * pauseScore
    );
    const level = levelFor(overallScore);

    // ================= 11. PRACTICE WORDS =================
    const practiceWords = [];
    const seen = new Set();
    [...pronunciationMistakes]
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence)
        .forEach((m) => {
            const key = m.word.toLowerCase();
            if (seen.has(key) || practiceWords.length >= 10) return;
            seen.add(key);
            practiceWords.push({
                word: m.word,
                correctPronunciation: m.correctPronunciation,
                ipa: m.ipa,
                practiceTip: practiceTipFor(m._classification),
                severity: m.severity,
                repeatPractice: true
            });
        });
    // Skipped words are worth practising too (they may have been unclear).
    for (const s of skippedWords) {
        const key = s.word.toLowerCase();
        if (seen.has(key) || practiceWords.length >= 10 || !s.word) continue;
        const info = await getPronunciationInfo(normalize(s.word));
        seen.add(key);
        practiceWords.push({
            word: s.word,
            correctPronunciation: info?.respelling || null,
            ipa: info?.ipa || null,
            practiceTip: "This word wasn't heard. Say it clearly and don't skip it.",
            severity: "minor",
            repeatPractice: true
        });
    }

    // ================= 10. PERSONALIZED FEEDBACK =================
    const feedback = buildFeedback({
        componentScores,
        pronunciationMistakes,
        accentNotes,
        wpm,
        speedClass,
        pauses,
        unnecessary,
        midSentenceStops,
        fillerWords,
        repeated,
        falseStarts,
        skippedWords,
        wrongWords,
        added,
        notRead,
        incompleteSentences,
        fluencyPenalties,
        rhythmVariation,
        practiceWords,
        refTotal
    });

    return {
        overallScore,
        level,
        levelNote: "A learning indicator, not a formal English certification.",
        scores: { overallScore, ...componentScores },
        weights: WEIGHTS,

        pronunciation: {
            score: pronunciationScore,
            explanation: pronunciationExplanationText,
            wordsEvaluated: evaluated.length,
            clearWords: clearCount,
            mistakes: pronunciationMistakes.map(({ _classification, ...m }) => m),
            accentVariations: accentNotes,
            stressAnalysis: "Not available: the speech model does not measure word stress."
        },

        fluency: {
            score: fluencyScore,
            feedback: feedback.fluencySummary,
            hesitations: hesitationCount,
            repetitions: repeated.length,
            falseStarts: falseStarts.length,
            fillers: fillerWords.length,
            incompleteSentences: incompleteStarted,
            rhythmVariation,
            penalties: fluencyPenalties,
            strengths: feedback.fluencyStrengths,
            weaknesses: feedback.fluencyWeaknesses,
            suggestions: feedback.fluencySuggestions
        },

        speed: {
            score: speedScore,
            durationSeconds: round(speakingSec, 1),
            recordingSeconds: round(audioDurationSec || 0, 1),
            spokenWords,
            wpm,
            classification: speedClass,
            targetRange: "100–160 WPM for reading aloud"
        },

        pauses: {
            score: pauseScore,
            totalPauses: pauses.length,
            averagePauseSeconds: pauses.length ? round(pauses.reduce((s, p) => s + p.durationSeconds, 0) / pauses.length, 2) : 0,
            longestPauseSeconds: pauses.length ? Math.max(...pauses.map((p) => p.durationSeconds)) : 0,
            unnecessaryPauses: unnecessary.length,
            naturalPauses: pauses.length - unnecessary.length,
            midSentenceStops,
            hesitationCount,
            pausesPerMinute,
            frequentPauses,
            fillerWords,
            penalties: pausePenalties,
            details: pauses
        },

        readingAccuracy: {
            score: readingAccuracyScore,
            totalWords: refTotal,
            wordsRead: refTotal - skippedWords.length - notRead.length,
            skippedWords,
            addedWords: added,
            wrongWords,
            repeatedWords: repeated,
            falseStarts,
            notReadCount: notRead.length,
            incompleteSentences,
            unreadSentences,
            differences
        },

        feedback: {
            strengths: feedback.strengths,
            weaknesses: feedback.weaknesses,
            topImprovements: feedback.topImprovements,
            topPronunciationProblems: feedback.topPronunciationProblems,
            topFluencyProblems: feedback.topFluencyProblems,
            speedFeedback: feedback.speedFeedback,
            pauseFeedback: feedback.pauseFeedback,
            readingAccuracyFeedback: feedback.readingAccuracyFeedback,
            practiceNext: feedback.practiceNext
        },

        practiceWords,

        // Per-word result for highlighting the story in the frontend.
        words: words.map(({ norm, sentence: s, ...w }) => w),

        analysisMethod: {
            measuredFromAudio: [
                "word start/end timestamps (Whisper)",
                "speaking duration and words per minute",
                "pause lengths, mid-sentence stops, rhythm"
            ],
            detectedFromRecognition: [
                "pronunciation issues: passage words the recognizer heard as a different, similar-sounding word",
                "sound-level explanation, IPA and respelling from the CMU Pronouncing Dictionary"
            ],
            transcriptBasedInference: [
                "skipped, added, repeated and wrong words",
                "false starts and incomplete sentences",
                "whether a mismatch is a pronunciation issue or a different word (by how many sounds differ)"
            ],
            notAvailable: [
                "phoneme-by-phoneme acoustic scoring",
                "word stress and intonation",
                "confidence from the acoustic model (confidence values are rule-based evidence strength)"
            ],
            accentPolicy:
                "Words recognised correctly are never flagged. Single-sound differences typical of Indian/regional accents (th→t, th→d, v↔w, v↔b, z→s) are listed as accent variation and not penalised.",
            weights: WEIGHTS
        }
    };
}

// ------------------------------------------------------------------
// Simple-English feedback built from the measured results
// ------------------------------------------------------------------
function buildFeedback(d) {
    const s = d.componentScores;
    const strengths = [];
    const weaknesses = [];

    if (s.pronunciationScore >= 85) strengths.push("Most of your words were clear and easy to understand.");
    else if (s.pronunciationScore < 70) weaknesses.push("Several words were hard to understand. Practise the words listed below.");

    if (d.speedClass === "Good") strengths.push(`Your reading speed (${d.wpm} words per minute) is comfortable to listen to.`);
    else if (d.wpm !== null) weaknesses.push(`Your reading speed was ${d.speedClass.toLowerCase()} (${d.wpm} words per minute).`);

    if (d.unnecessary.length === 0 && d.pauses.length > 0) strengths.push("You paused naturally at full stops and commas and kept going.");
    else if (d.unnecessary.length >= 3) weaknesses.push(`You stopped ${plural(d.unnecessary.length, "time")} where no pause was needed.`);

    if (s.readingAccuracyScore >= 90) strengths.push("You read the story accurately, word for word.");
    else if (s.readingAccuracyScore < 75) weaknesses.push("Some words were skipped, changed or not read.");

    if (d.fillerWords.length === 0 && d.repeated.length === 0) strengths.push("You didn't use filler words like \"um\" or repeat words.");
    else if (d.fillerWords.length + d.repeated.length >= 3) weaknesses.push("You used filler words or repeated words several times.");

    if (strengths.length === 0) strengths.push("You completed a full reading practice. Every attempt helps you improve.");

    // Top pronunciation problems
    const topPronunciationProblems = [...d.pronunciationMistakes]
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence)
        .slice(0, 3)
        .map((m) => `"${m.word}" sounded like "${m.userPronunciation}". ${m.explanation}`);

    // Top fluency problems (largest penalties first)
    const fluencyText = {
        unnecessaryPauses: `You paused ${plural(d.unnecessary.length, "time")} in the middle of sentences.`,
        fillers: `You used filler words (${d.fillerWords.slice(0, 3).join(", ")}).`,
        repetitionsAndFalseStarts: `You repeated or restarted words ${plural(d.repeated.length + d.falseStarts.length, "time")}.`,
        incompleteSentences: `You didn't finish ${plural(d.incompleteSentences.length, "sentence")}.`,
        unevenRhythm: "Your speed changed a lot between sentences. Try to keep a steady rhythm.",
        extremeSpeed: `Your speed was ${d.speedClass.toLowerCase()}.`
    };
    const topFluencyProblems = Object.entries(d.fluencyPenalties)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => fluencyText[k]);

    const speedFeedback =
        d.wpm === null
            ? "There wasn't enough speech to measure your speed."
            : {
                  "Too Slow": `You read at ${d.wpm} words per minute, which is too slow. Try reading whole phrases together instead of word by word.`,
                  Slow: `You read at ${d.wpm} words per minute, a little slow. Aim for 100–160 words per minute.`,
                  Good: `You read at ${d.wpm} words per minute. That's a good, natural speed.`,
                  Fast: `You read at ${d.wpm} words per minute, a little fast. Slow down slightly so every word is clear.`,
                  "Too Fast": `You read at ${d.wpm} words per minute, which is too fast. Slow down and pause at full stops.`
              }[d.speedClass];

    const pauseFeedback =
        d.unnecessary.length === 0
            ? "Your pauses were natural. You paused at punctuation and kept going in the middle of sentences."
            : `You had ${plural(d.unnecessary.length, "unnecessary pause")}` +
              (d.midSentenceStops ? `, including ${plural(d.midSentenceStops, "long stop")} in the middle of a sentence` : "") +
              ". Try reading the sentence once silently first, then read it aloud without stopping.";

    const accuracyBits = [];
    if (d.skippedWords.length) accuracyBits.push(plural(d.skippedWords.length, "word") + " skipped");
    if (d.wrongWords.length) accuracyBits.push(plural(d.wrongWords.length, "word") + " changed");
    if (d.added.length) accuracyBits.push(plural(d.added.length, "extra word"));
    if (d.notRead.length) accuracyBits.push(`${plural(d.notRead.length, "word")} at the end not read`);
    const readingAccuracyFeedback = accuracyBits.length
        ? `You read ${d.refTotal - d.skippedWords.length - d.notRead.length} of ${d.refTotal} words. ${accuracyBits.join(", ")}. Follow the text with your finger to stay on track.`
        : "You read every word of the story correctly.";

    const topImprovements = [];
    if (d.practiceWords.length) topImprovements.push(`Practise these words: ${d.practiceWords.slice(0, 3).map((p) => p.word).join(", ")}.`);
    if (d.unnecessary.length) topImprovements.push("Keep going in the middle of sentences. Pause only at commas and full stops.");
    if (d.speedClass !== "Good" && d.wpm !== null) topImprovements.push(d.speedClass.includes("Slow") ? "Read a little faster by grouping words into phrases." : "Slow down a little so each word is clear.");
    if (d.skippedWords.length || d.wrongWords.length) topImprovements.push("Read carefully and don't skip or change words.");
    if (d.fillerWords.length) topImprovements.push('Replace "um" and "uh" with a short silent pause.');
    if (topImprovements.length === 0) topImprovements.push("Try a harder story to keep improving.");

    const practiceNext = [];
    if (d.practiceWords.length) practiceNext.push("Repeat each practice word 3 times, slowly, then at normal speed.");
    if (d.incompleteSentences.length || d.unnecessary.length) practiceNext.push("Read the same story again and try to finish every sentence without stopping.");
    practiceNext.push(d.componentScores.readingAccuracyScore >= 90 && d.componentScores.pronunciationScore >= 85 ? "Move on to a harder story." : "Practise this story once more, then try a new one.");

    const fluencyStrengths = [];
    const fluencyWeaknesses = topFluencyProblems;
    if (d.fluencyPenalties.unnecessaryPauses === 0) fluencyStrengths.push("You read without unnecessary stops.");
    if (d.fluencyPenalties.fillers === 0) fluencyStrengths.push("No filler words.");
    if (d.fluencyPenalties.repetitionsAndFalseStarts === 0) fluencyStrengths.push("No repeated words or restarts.");
    if (d.fluencyPenalties.unevenRhythm === 0 && d.rhythmVariation !== null) fluencyStrengths.push("Your rhythm was steady.");
    const fluencySuggestions = [];
    if (d.fluencyPenalties.unnecessaryPauses) fluencySuggestions.push("Look ahead to the next few words while you read so you don't need to stop.");
    if (d.fluencyPenalties.fillers) fluencySuggestions.push('When you need time, stay silent for a moment instead of saying "um".');
    if (d.fluencyPenalties.repetitionsAndFalseStarts) fluencySuggestions.push("If you make a small mistake, keep going. Don't restart the word.");
    if (d.fluencyPenalties.incompleteSentences) fluencySuggestions.push("Always finish the sentence you start.");
    if (d.fluencyPenalties.unevenRhythm) fluencySuggestions.push("Read at the same speed from the first sentence to the last.");
    if (fluencySuggestions.length === 0) fluencySuggestions.push("Keep practising with longer stories to build stamina.");

    const fluencySummary =
        topFluencyProblems.length === 0
            ? "You read smoothly and continuously."
            : `Your reading was ${d.componentScores.fluencyScore >= 75 ? "mostly smooth" : "not yet smooth"}. Main issue: ${topFluencyProblems[0].charAt(0).toLowerCase()}${topFluencyProblems[0].slice(1)}`;

    return {
        strengths,
        weaknesses,
        topImprovements: topImprovements.slice(0, 3),
        topPronunciationProblems,
        topFluencyProblems,
        speedFeedback,
        pauseFeedback,
        readingAccuracyFeedback,
        practiceNext,
        fluencyStrengths,
        fluencyWeaknesses,
        fluencySuggestions,
        fluencySummary
    };
}

module.exports = { analyzeSpeaking, levelFor, WEIGHTS };
