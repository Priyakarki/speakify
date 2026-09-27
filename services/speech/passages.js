/*
 * Splits a story into short practice passages at sentence boundaries.
 * The backend is the single source of truth: the frontend asks for passages
 * and sends back only { storyId, passageIndex }, so the reference text used
 * for scoring can't be tampered with.
 */
const MAX_WORDS = 40; // ~25 seconds of reading aloud at a learner's pace
const MIN_WORDS = 12;

function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(content) {
    const flat = String(content || "").replace(/\s+/g, " ").trim();
    if (!flat) return [];
    const matches = flat.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) || [flat];
    return matches.map((s) => s.trim()).filter(Boolean);
}

function splitIntoPassages(content, maxWords = MAX_WORDS) {
    const sentences = splitSentences(content);
    const passages = [];
    let current = [];
    let currentWords = 0;

    for (const sentence of sentences) {
        const words = countWords(sentence);
        if (currentWords > 0 && currentWords + words > maxWords && currentWords >= MIN_WORDS) {
            passages.push(current.join(" "));
            current = [];
            currentWords = 0;
        }
        current.push(sentence);
        currentWords += words;
    }
    if (current.length) {
        // Merge a very short tail into the previous passage.
        if (currentWords < MIN_WORDS && passages.length) {
            passages[passages.length - 1] += ` ${current.join(" ")}`;
        } else {
            passages.push(current.join(" "));
        }
    }

    return passages.map((text, index) => ({ index, text, wordCount: countWords(text) }));
}

module.exports = { splitIntoPassages, MAX_WORDS };
