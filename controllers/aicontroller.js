const mongoose = require("mongoose");
const Story = require("../models/storymodel");
const SpeakingAnalysis = require("../models/speakinganalysismodel");
const { decodeAudio, AudioDecodeError } = require("../services/speech/audioDecoder");
const { rms } = require("../services/speech/wav");
const { transcribe, getEngineStatus } = require("../services/speech/transcriber");
const { analyzeSpeaking } = require("../services/ai/speakingAnalysisService");

const MAX_STORY_CHARS = 20000;
const maxSeconds = () => Number(process.env.AI_MAX_AUDIO_SECONDS) || 300;

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// POST /api/ai/analyze-speaking
// form-data: audio (file), storyId OR storyText
// The user always comes from the JWT (req.userId). A userId in the body is ignored.
const analyzeSpeakingReading = async (req, res) => {
    try {
        // ---------- 1. Validate input ----------
        if (!req.file) {
            return fail(res, 400, 'No audio file received. Add it in form-data as a File field named "audio".');
        }

        const storyId = typeof req.body?.storyId === "string" ? req.body.storyId.trim() : "";
        const storyTextInput = typeof req.body?.storyText === "string" ? req.body.storyText.trim() : "";

        let story = null;
        let referenceText = "";

        if (storyId) {
            if (!mongoose.Types.ObjectId.isValid(storyId)) return fail(res, 400, "storyId is not a valid id.");
            story = await Story.findById(storyId);
            if (!story) return fail(res, 404, "Story not found.");
            referenceText = story.content;
        } else if (storyTextInput) {
            if (storyTextInput.length > MAX_STORY_CHARS) {
                return fail(res, 400, `storyText is too long (max ${MAX_STORY_CHARS} characters).`);
            }
            referenceText = storyTextInput;
        } else {
            return fail(res, 400, "Provide either storyId or storyText.");
        }

        // Stories are long; single-word practice sends one word as storyText.
        const referenceWordCount = referenceText.split(/\s+/).filter(Boolean).length;
        if (referenceWordCount < 1) {
            return fail(res, 400, "The story text is empty.");
        }

        // ---------- 2. Decode + validate audio ----------
        let audio;
        try {
            audio = await decodeAudio(req.file.buffer, { maxSeconds: maxSeconds(), originalName: req.file.originalname });
        } catch (error) {
            if (error instanceof AudioDecodeError) return fail(res, 400, error.message);
            console.error("[ai] audio decode error:", error.message);
            return fail(res, 500, error.message);
        }

        if (audio.durationSec < 1) return fail(res, 400, "The recording is too short (under 1 second).");
        if (audio.durationSec > maxSeconds()) {
            const limit = maxSeconds() >= 60 ? `${Math.round(maxSeconds() / 60)} minutes` : `${maxSeconds()} seconds`;
            return fail(res, 400, `The recording is too long (max ${limit}).`);
        }
        if (rms(audio.samples) < 0.003) {
            return fail(res, 422, "The recording is silent. Check the microphone and try again.");
        }

        // ---------- 3. Speech-to-text (local Whisper, raw transcript) ----------
        let transcription;
        try {
            transcription = await transcribe(audio.samples, audio.durationSec);
        } catch (error) {
            console.error("[ai] transcription failed:", error);
            return fail(
                res,
                503,
                "The speech-recognition model couldn't run. On the first request the backend needs internet once to download the model (see backend logs), or run: npm run download-model"
            );
        }

        const heardWords = transcription.words.filter((w) => w.word);
        if (!transcription.text || heardWords.length === 0) {
            return fail(res, 422, "No speech was recognised in the recording. Please read the story aloud clearly.");
        }
        // Need 3 recognised words for stories, but only 1 when the text is 1–2 words.
        const minHeardWords = Math.min(3, referenceWordCount);
        if (heardWords.length < minHeardWords) {
            return fail(res, 422, `Too little speech was recognised (${heardWords.length} word(s)). Please read more of the story.`);
        }

        // ---------- 4. Analysis ----------
        const result = await analyzeSpeaking({
            referenceText,
            recognizedWords: heardWords,
            audioDurationSec: audio.durationSec
        });
        const engine = getEngineStatus();
        const analysis = {
            transcript: transcription.text,
            ...result,
            engine: { name: engine.name, model: engine.model, dtype: engine.dtype }
        };

        // ---------- 5. Save (never lose the result if saving fails) ----------
        let analysisId = null;
        let saveWarning;
        try {
            const saved = await SpeakingAnalysis.create({
                user: req.userId,
                story: story ? story._id : null,
                storyTitle: story ? story.title : "Custom text",
                storyText: story ? null : referenceText,
                transcript: transcription.text,
                overallScore: result.overallScore,
                level: result.level,
                ...result.scores,
                speed: {
                    wpm: result.speed.wpm,
                    durationSeconds: result.speed.durationSeconds,
                    spokenWords: result.speed.spokenWords,
                    classification: result.speed.classification
                },
                pauseStats: {
                    totalPauses: result.pauses.totalPauses,
                    averagePauseSeconds: result.pauses.averagePauseSeconds,
                    longestPauseSeconds: result.pauses.longestPauseSeconds,
                    unnecessaryPauses: result.pauses.unnecessaryPauses,
                    hesitationCount: result.pauses.hesitationCount
                },
                readingAccuracy: result.readingAccuracy,
                pronunciationMistakes: result.pronunciation.mistakes,
                feedback: result.feedback,
                analysis,
                audio: {
                    durationSeconds: Math.round(audio.durationSec * 10) / 10,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype
                },
                engine: analysis.engine
            });
            analysisId = saved._id;
        } catch (error) {
            console.error("[ai] could not save analysis:", error.message);
            saveWarning = "The analysis worked but could not be saved to your history.";
        }

        return res.status(200).json({
            success: true,
            analysisId,
            ...(saveWarning ? { warning: saveWarning } : {}),
            story: story ? { _id: story._id, title: story.title } : null,
            analysis
        });
    } catch (error) {
        console.error("[ai] analyze-speaking error:", error);
        return fail(res, 500, "Something went wrong while analysing the recording.");
    }
};

// GET /api/ai/speaking-analyses?storyId=&page=&limit=
const listSpeakingAnalyses = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
        const filter = { user: req.userId };
        if (req.query.storyId) {
            if (!mongoose.Types.ObjectId.isValid(req.query.storyId)) return fail(res, 400, "storyId is not a valid id.");
            filter.story = req.query.storyId;
        }

        const [analyses, total] = await Promise.all([
            SpeakingAnalysis.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select(
                    "story storyTitle overallScore level pronunciationScore fluencyScore readingAccuracyScore speedScore pauseScore speed createdAt"
                ),
            SpeakingAnalysis.countDocuments(filter)
        ]);

        res.status(200).json({ success: true, page, limit, total, totalPages: Math.ceil(total / limit), analyses });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

// GET /api/ai/speaking-analyses/:id  (only the owner can read it)
const getSpeakingAnalysis = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 404, "Analysis not found.");
        const doc = await SpeakingAnalysis.findOne({ _id: req.params.id, user: req.userId });
        if (!doc) return fail(res, 404, "Analysis not found.");
        res.status(200).json({
            success: true,
            analysisId: doc._id,
            story: doc.story ? { _id: doc.story, title: doc.storyTitle } : null,
            createdAt: doc.createdAt,
            analysis: doc.analysis
        });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

module.exports = { analyzeSpeakingReading, listSpeakingAnalyses, getSpeakingAnalysis };