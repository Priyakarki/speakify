const mongoose = require("mongoose");
const Story = require("../models/storymodel");
const SpeakingAttempt = require("../models/speakingattemptmodel");
const { parseWav, rms, WavError } = require("../services/speech/wav");
const { splitIntoPassages } = require("../services/speech/passages");
const { transcribe, getEngineStatus } = require("../services/speech/transcriber");
const { analyzeReading } = require("../services/speech/analysis");
const { isDictionaryAvailable } = require("../services/speech/pronunciation");
const { MAX_FILE_MB } = require("../middleware/audioUpload");

const MIN_SECONDS = 1;
const maxSeconds = () => Number(process.env.SPEAKING_MAX_SECONDS) || 60;

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// GET /api/speaking/status
// Tells the frontend which engine is used and whether the model is loaded.
const getStatus = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            engine: getEngineStatus(),
            pronunciationDictionary: await isDictionaryAvailable(),
            limits: { minSeconds: MIN_SECONDS, maxSeconds: maxSeconds(), maxFileMb: MAX_FILE_MB }
        });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

// GET /api/speaking/passages/:storyId
// Short passages (sentence boundaries, ~40 words) cut from a story.
const getPassages = async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(storyId)) return fail(res, 404, "Story not found");
        const story = await Story.findById(storyId);
        if (!story) return fail(res, 404, "Story not found");

        res.status(200).json({
            success: true,
            story: { _id: story._id, title: story.title, difficulty: story.difficulty },
            passages: splitIntoPassages(story.content)
        });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

// POST /api/speaking/analyze   (multipart/form-data)
// fields: audio (WAV file), storyId, passageIndex
const analyze = async (req, res) => {
    try {
        const { storyId } = req.body || {};
        const passageIndex = Number(req.body?.passageIndex);

        if (!req.file) return fail(res, 400, 'No recording received. Send it in a form field named "audio".');
        if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) return fail(res, 400, "A valid storyId is required.");
        if (!Number.isInteger(passageIndex) || passageIndex < 0) return fail(res, 400, "A valid passageIndex is required.");

        const story = await Story.findById(storyId);
        if (!story) return fail(res, 404, "Story not found");

        const passage = splitIntoPassages(story.content)[passageIndex];
        if (!passage) return fail(res, 400, "That passage doesn't exist for this story.");

        // ---- Validate the audio ----
        let audio;
        try {
            audio = parseWav(req.file.buffer);
        } catch (error) {
            if (error instanceof WavError) return fail(res, 400, error.message);
            throw error;
        }
        if (audio.durationSec < MIN_SECONDS) return fail(res, 400, "The recording is too short. Please read the passage aloud.");
        if (audio.durationSec > maxSeconds() + 1) {
            return fail(res, 400, `The recording is too long (max ${maxSeconds()} seconds).`);
        }
        if (rms(audio.samples) < 0.003) {
            return fail(res, 422, "The recording is silent. Check that the right microphone is selected and try again.");
        }

        // ---- Real speech-to-text (local Whisper) ----
        let transcription;
        try {
            transcription = await transcribe(audio.samples, audio.durationSec);
        } catch (error) {
            console.error("[speaking] transcription failed:", error);
            return fail(
                res,
                503,
                "The speech model couldn't run. If this is the first analysis, the backend needs internet once to download the model (see backend logs)."
            );
        }

        const heardWords = transcription.words.filter((w) => w.word);
        if (!transcription.text || heardWords.length === 0) {
            return fail(res, 422, "No speech was recognised. Speak clearly, closer to the microphone, and try again.");
        }

        // ---- Scoring (deterministic, based on the transcript) ----
        const result = await analyzeReading({
            referenceText: passage.text,
            recognizedWords: heardWords,
            audioDurationSec: audio.durationSec
        });

        const engine = getEngineStatus();
        const attempt = await SpeakingAttempt.create({
            user: req.userId,
            story: story._id,
            storyTitle: story.title,
            passageIndex,
            passageText: passage.text,
            transcript: transcription.text,
            ...result,
            engine: { name: engine.name, model: engine.model, dtype: engine.dtype }
        });

        res.status(201).json({
            success: true,
            message: "Speech analysed",
            attempt
        });
    } catch (error) {
        console.error("[speaking] analyze error:", error);
        fail(res, 500, error.message);
    }
};

// GET /api/speaking/attempts?storyId=&page=&limit=
const listAttempts = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
        const filter = { user: new mongoose.Types.ObjectId(req.userId) };
        if (req.query.storyId) {
            if (!mongoose.Types.ObjectId.isValid(req.query.storyId)) return fail(res, 400, "Invalid storyId");
            filter.story = new mongoose.Types.ObjectId(req.query.storyId);
        }

        const [attempts, total, summaryRows] = await Promise.all([
            SpeakingAttempt.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select("story storyTitle passageIndex scores metrics.wordsPerMinute metrics.wordsRead metrics.passageWords createdAt"),
            SpeakingAttempt.countDocuments(filter),
            SpeakingAttempt.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        attempts: { $sum: 1 },
                        averageOverall: { $avg: "$scores.overall" },
                        averagePronunciation: { $avg: "$scores.pronunciation" },
                        averageFluency: { $avg: "$scores.fluency" },
                        averageWpm: { $avg: "$metrics.wordsPerMinute" },
                        bestOverall: { $max: "$scores.overall" }
                    }
                }
            ])
        ]);

        const s = summaryRows[0];
        const r = (v) => (v === null || v === undefined ? null : Math.round(v));

        res.status(200).json({
            success: true,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            summary: {
                attempts: s?.attempts || 0,
                averageOverall: r(s?.averageOverall),
                averagePronunciation: r(s?.averagePronunciation),
                averageFluency: r(s?.averageFluency),
                averageWpm: r(s?.averageWpm),
                bestOverall: r(s?.bestOverall)
            },
            attempts
        });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

// GET /api/speaking/attempts/:id
const getAttempt = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 404, "Attempt not found");
        const attempt = await SpeakingAttempt.findOne({ _id: req.params.id, user: req.userId });
        if (!attempt) return fail(res, 404, "Attempt not found");
        res.status(200).json({ success: true, attempt });
    } catch (error) {
        fail(res, 500, error.message);
    }
};

module.exports = { getStatus, getPassages, analyze, listAttempts, getAttempt };
