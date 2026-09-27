const mongoose = require("mongoose");

const readingProgressSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        story: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Story",
            required: true
        },

        status: {
            type: String,
            enum: ["in-progress", "completed"],
            default: "in-progress"
        },

        // Set when the story is marked as completed.
        completedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// One user + one story = one ReadingProgress document.
// MongoDB enforces this, so duplicates can't be created even by two quick requests.
// If your database already contains duplicates, run: npm run fix:progress
readingProgressSchema.index({ user: 1, story: 1 }, { unique: true });

const ReadingProgress = mongoose.model(
    "ReadingProgress",
    readingProgressSchema
);

module.exports = ReadingProgress;
