const mongoose = require("mongoose");

// One saved result of POST /api/ai/analyze-speaking.
// Raw audio is NOT stored, only the analysis.
const speakingAnalysisSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        // Set when the request used storyId. Null for custom storyText.
        story: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Story",
            default: null
        },
        storyTitle: { type: String, default: "Custom text" },
        // Only stored for custom text (a storyId already points to the text).
        storyText: { type: String, default: null },

        transcript: { type: String, default: "" },

        overallScore: { type: Number, required: true },
        level: { type: String },
        pronunciationScore: Number,
        fluencyScore: Number,
        readingAccuracyScore: Number,
        speedScore: Number,
        pauseScore: Number,

        speed: {
            wpm: Number,
            durationSeconds: Number,
            spokenWords: Number,
            classification: String
        },

        pauseStats: {
            totalPauses: Number,
            averagePauseSeconds: Number,
            longestPauseSeconds: Number,
            unnecessaryPauses: Number,
            hesitationCount: Number
        },

        readingAccuracy: { type: mongoose.Schema.Types.Mixed },
        pronunciationMistakes: { type: [mongoose.Schema.Types.Mixed], default: [] },
        feedback: { type: mongoose.Schema.Types.Mixed },

        // The complete analysis object exactly as returned by the API.
        analysis: { type: mongoose.Schema.Types.Mixed },

        audio: {
            durationSeconds: Number,
            originalName: String,
            mimeType: String
        },

        engine: {
            name: String,
            model: String,
            dtype: String
        }
    },
    { timestamps: true }
);

speakingAnalysisSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("SpeakingAnalysis", speakingAnalysisSchema);
