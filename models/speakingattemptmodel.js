const mongoose = require("mongoose");

// One saved Speaking Practice attempt. The audio itself is NOT stored,
// only the analysis results.
const wordSchema = new mongoose.Schema(
    {
        text: String,
        norm: String,
        status: {
            type: String,
            enum: ["correct", "close", "unclear", "missed", "not_reached"]
        },
        heard: String,
        start: Number,
        end: Number,
        hint: String
    },
    { _id: false }
);

const speakingAttemptSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        story: { type: mongoose.Schema.Types.ObjectId, ref: "Story", required: true },
        storyTitle: { type: String, required: true },
        passageIndex: { type: Number, required: true },
        passageText: { type: String, required: true },

        transcript: { type: String, default: "" },

        scores: {
            overall: Number,
            pronunciation: Number,
            fluency: Number,
            completeness: Number
        },

        metrics: {
            wordsPerMinute: Number,
            speakingSec: Number,
            audioSec: Number,
            passageWords: Number,
            wordsRead: Number,
            correct: Number,
            close: Number,
            unclear: Number,
            missed: Number,
            notReached: Number,
            extraWords: Number,
            repetitions: Number,
            fillers: Number,
            hesitations: Number,
            longPauses: Number,
            longestPauseSec: Number
        },

        fluencyPenalties: {
            pace: Number,
            hesitations: Number,
            longPauses: Number,
            repetitions: Number,
            fillers: Number
        },

        words: [wordSchema],
        pauses: [
            {
                _id: false,
                afterWord: String,
                beforeWord: String,
                durationSec: Number,
                at: Number,
                type: { type: String, enum: ["hesitation", "long"] }
            }
        ],
        practiceWords: [
            { _id: false, word: String, status: String, heard: String, hint: String }
        ],
        extraWords: [String],
        fillerWords: [String],

        engine: {
            name: String,
            model: String,
            dtype: String
        }
    },
    { timestamps: true }
);

speakingAttemptSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("SpeakingAttempt", speakingAttemptSchema);
