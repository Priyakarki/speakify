const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },

        content: {
            type: String,
            required: true
        },

        difficulty: {
            type: String,
            enum: ["easy", "medium", "hard"],
            default: "easy"
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Story", storySchema);