/*
 * Turns a real Whisper transcript (with word timestamps) + the reference
 * passage into speaking results. Everything here is deterministic and
 * explainable. No random numbers, no invented scores.
 *
 *  Pronunciation (clarity) = share of the words you read that the speech
 *    recognizer understood as the intended word ("close" words, where only one
 *    sound differed, count half).
 *  Completeness = share of passage words that were read.
 *  Fluency = 100 minus penalties for pace outside 90–170 WPM, hesitations,
 *    long pauses, repeated words and filler words.
 *  Overall = (55% pronunciation + 45% fluency) × completeness.
 */
const { comparePronunciation } = require("./pronunciation");

const FILLERS = new Set(["um", "uh", "umm", "uhm", "uhh", "er", "erm", "ah", "hmm", "hm", "mm", "mhm"]);
const HESITATION_GAP = 0.6; // seconds, in the middle of a phrase
const LONG_PAUSE_GAP = 1.5; // seconds, anywhere
const PACE_MIN = 90;
const PACE_MAX = 170;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberToWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : "");
    if (n < 1000) return ONES[Math.floor(n / 100)] + "hundred" + (n % 100 ? numberToWords(n % 100) : "");
    return String(n);
}

function normalize(token) {
    const clean = String(token || "")
        .toLowerCase()
        .replace(/[’‘`]/g, "'")
        .replace(/[^a-z0-9']/g, "")
        .replace(/'/g, "");
    if (/^\d+$/.test(clean) && Number(clean) < 1000) return numberToWords(Number(clean));
    return clean;
}

function similarity(a, b) {
    if (a === b) return 1;
    const n = a.length;
    const m = b.length;
    if (!n || !m) return 0;
    let prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
        const cur = [i];
        for (let j = 1; j <= m; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return 1 - prev[m] / Math.max(n, m);
}

function round(value, digits = 0) {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
}

function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, value));
}

// Reference passage -> tokens that keep the original text for display.
function tokenizeReference(text) {
    return String(text)
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => ({
            text: raw,
            norm: normalize(raw),
            endsSentence: /[.!?]["'”’)]*$/.test(raw),
            endsClause: /[,;:—–-]["'”’)]*$/.test(raw)
        }));
}

// Whisper word chunks -> flat list of spoken words with timings.
function tokenizeRecognized(words) {
    const out = [];
    for (const w of words || []) {
        const parts = String(w.word || "").split(/[\s-]+/).filter(Boolean);
        if (!parts.length) continue;
        const start = Number.isFinite(w.start) ? w.start : null;
        const end = Number.isFinite(w.end) ? w.end : start;
        const step = start !== null && end !== null ? (end - start) / parts.length : 0;
        parts.forEach((part, k) => {
            const norm = normalize(part);
            if (!norm) return;
            out.push({
                text: part.replace(/^[^\w']+|[^\w']+$/g, ""),
                norm,
                start: start !== null ? round(start + step * k, 2) : null,
                end: start !== null ? round(start + step * (k + 1), 2) : null,
                filler: FILLERS.has(norm)
            });
        });
    }
    return out;
}

// Word-level Levenshtein alignment: reference vs recognized.
function align(ref, hyp) {
    const n = ref.length;
    const m = hyp.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const sub = dp[i - 1][j - 1] + (ref[i - 1].norm === hyp[j - 1].norm ? 0 : 1);
            dp[i][j] = Math.min(sub, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
        }
    }
    const ops = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (ref[i - 1].norm === hyp[j - 1].norm ? 0 : 1)) {
            ops.push({ type: ref[i - 1].norm === hyp[j - 1].norm ? "match" : "sub", r: i - 1, h: j - 1 });
            i--; j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            ops.push({ type: "del", r: i - 1 });
            i--;
        } else {
            ops.push({ type: "ins", h: j - 1 });
            j--;
        }
    }
    return ops.reverse();
}

async function analyzeReading({ referenceText, recognizedWords, audioDurationSec }) {
    const refAll = tokenizeReference(referenceText);
    const ref = refAll.filter((t) => t.norm);
    const spokenAll = tokenizeRecognized(recognizedWords);
    const fillers = spokenAll.filter((w) => w.filler && !ref.some((r) => r.norm === w.norm));
    const spoken = spokenAll.filter((w) => !fillers.includes(w));

    const ops = align(ref, spoken);

    // Per reference word result.
    const results = ref.map((t) => ({
        text: t.text,
        norm: t.norm,
        status: "missed",
        heard: null,
        start: null,
        end: null,
        hint: null,
        endsSentence: t.endsSentence,
        endsClause: t.endsClause
    }));
    const refForHyp = new Array(spoken.length).fill(null);
    let repetitions = 0;
    const extraWords = [];

    for (let k = 0; k < ops.length; k++) {
        const op = ops[k];
        if (op.type === "match" || op.type === "sub") {
            const w = spoken[op.h];
            Object.assign(results[op.r], { heard: w.text, start: w.start, end: w.end });
            refForHyp[op.h] = op.r;
            results[op.r].status = op.type === "match" ? "correct" : "pending";
        } else if (op.type === "ins") {
            const w = spoken[op.h];
            const prevHyp = spoken[op.h - 1];
            const nearRef = [ops[k - 1], ops[k + 1]].filter((o) => o && o.r !== undefined).map((o) => ref[o.r].norm);
            if ((prevHyp && prevHyp.norm === w.norm) || nearRef.includes(w.norm)) repetitions++;
            else extraWords.push(w.text);
        }
    }

    // Classify substitutions: same sounds (homophone) / close / unclear.
    await Promise.all(
        results.map(async (r) => {
            if (r.status !== "pending") return;
            const heardNorm = normalize(r.heard);
            const { samePronunciation, soundDifferences, hint } = await comparePronunciation(r.norm, heardNorm);
            if (samePronunciation) {
                r.status = "correct"; // homophone, e.g. "their" heard as "there"
                return;
            }
            // "close" = only one sound differs (per the CMU dictionary), or, for
            // words not in the dictionary, a very similar spelling.
            const close = soundDifferences !== null ? soundDifferences === 1 : similarity(r.norm, heardNorm) >= 0.75;
            r.status = close ? "close" : "unclear";
            r.hint = hint;
        })
    );

    // Words after the last word we heard were simply not reached.
    let lastRead = -1;
    results.forEach((r, idx) => {
        if (r.status !== "missed") lastRead = idx;
    });
    results.forEach((r, idx) => {
        if (r.status === "missed" && idx > lastRead) r.status = "not_reached";
    });

    // ---- Timing: WPM, hesitations, long pauses ----
    const timed = spokenAll.filter((w) => w.start !== null && w.end !== null);
    const speakingSec = timed.length ? Math.max(0, timed[timed.length - 1].end - timed[0].start) : 0;
    const pauses = [];
    for (let k = 1; k < spoken.length; k++) {
        const prev = spoken[k - 1];
        const next = spoken[k];
        if (prev.end === null || next.start === null) continue;
        const gap = round(next.start - prev.end, 2);
        if (gap < HESITATION_GAP) continue;
        const refIdx = refForHyp[k - 1];
        const atPunctuation = refIdx !== null && (ref[refIdx].endsSentence || ref[refIdx].endsClause);
        if (gap >= LONG_PAUSE_GAP) {
            pauses.push({ afterWord: prev.text, beforeWord: next.text, durationSec: gap, at: prev.end, type: "long" });
        } else if (!atPunctuation) {
            pauses.push({ afterWord: prev.text, beforeWord: next.text, durationSec: gap, at: prev.end, type: "hesitation" });
        }
    }

    const counts = { correct: 0, close: 0, unclear: 0, missed: 0, not_reached: 0 };
    results.forEach((r) => { counts[r.status] += 1; });
    const attempted = counts.correct + counts.close + counts.unclear;
    const hesitations = pauses.filter((p) => p.type === "hesitation").length;
    const longPauses = pauses.filter((p) => p.type === "long").length;
    const wpm = speakingSec >= 1 ? round((spoken.length / speakingSec) * 60) : null;

    // ---- Scores ----
    const pronunciation = attempted ? round((100 * (counts.correct + 0.5 * counts.close)) / attempted) : 0;
    const completeness = ref.length ? round((100 * attempted) / ref.length) : 0;

    const penalties = {
        pace: 0,
        hesitations: Math.min(30, hesitations * 6),
        longPauses: Math.min(32, longPauses * 8),
        repetitions: Math.min(20, repetitions * 5),
        fillers: Math.min(20, fillers.length * 4)
    };
    if (wpm !== null && wpm < PACE_MIN) penalties.pace = Math.min(40, round((PACE_MIN - wpm) * 0.8));
    if (wpm !== null && wpm > PACE_MAX) penalties.pace = Math.min(30, round((wpm - PACE_MAX) * 0.8));
    const fluency = attempted >= 3
        ? round(clamp(100 - Object.values(penalties).reduce((a, b) => a + b, 0)))
        : 0;

    const overall = round((0.55 * pronunciation + 0.45 * fluency) * (completeness / 100));

    // ---- Words to practise ----
    const seen = new Set();
    const practiceWords = [];
    for (const r of results) {
        if (!["unclear", "close", "missed"].includes(r.status) || seen.has(r.norm)) continue;
        seen.add(r.norm);
        practiceWords.push({
            word: r.text.replace(/^[^\w']+|[^\w']+$/g, ""),
            status: r.status,
            heard: r.status === "missed" ? null : r.heard,
            hint: r.hint
        });
        if (practiceWords.length >= 8) break;
    }

    return {
        words: results.map(({ endsSentence, endsClause, ...rest }) => rest),
        pauses,
        practiceWords,
        extraWords,
        fillerWords: fillers.map((f) => f.text),
        scores: { overall, pronunciation, fluency, completeness },
        metrics: {
            wordsPerMinute: wpm,
            speakingSec: round(speakingSec, 1),
            audioSec: round(audioDurationSec || 0, 1),
            passageWords: ref.length,
            wordsRead: attempted,
            correct: counts.correct,
            close: counts.close,
            unclear: counts.unclear,
            missed: counts.missed,
            notReached: counts.not_reached,
            extraWords: extraWords.length,
            repetitions,
            fillers: fillers.length,
            hesitations,
            longPauses,
            longestPauseSec: pauses.length ? Math.max(...pauses.map((p) => p.durationSec)) : 0
        },
        fluencyPenalties: penalties
    };
}

module.exports = { analyzeReading, normalize, align, tokenizeReference, tokenizeRecognized, similarity };
