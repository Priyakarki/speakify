const mongoose = require("mongoose");
const ReadingProgress = require("../models/readingprogressmodel");
const Story = require("../models/storymodel");

// Start Reading
// One user + one story = one progress record.
// - First time: creates the record (201).
// - Already started or completed: returns the existing record unchanged (200).
const startReading = async (req, res) => {
    try {
        const { storyId } = req.body || {};

        if (!storyId || !mongoose.Types.ObjectId.isValid(storyId)) {
            return res.status(400).json({
                success: false,
                message: "A valid storyId is required"
            });
        }

        const storyExists = await Story.exists({ _id: storyId });
        if (!storyExists) {
            return res.status(404).json({
                success: false,
                message: "Story not found"
            });
        }

        const existing = await ReadingProgress.findOne({
            user: req.userId,
            story: storyId
        });

        if (existing) {
            return res.status(200).json({
                success: true,
                message:
                    existing.status === "completed"
                        ? "Story already completed"
                        : "Reading already started",
                alreadyExists: true,
                progress: existing
            });
        }

        try {
            const progress = await ReadingProgress.create({
                user: req.userId,
                story: storyId,
                status: "in-progress"
            });

            return res.status(201).json({
                success: true,
                message: "Reading started",
                alreadyExists: false,
                progress
            });
        } catch (error) {
            // Two requests at the same time: the unique index rejects the second one.
            if (error.code === 11000) {
                const progress = await ReadingProgress.findOne({
                    user: req.userId,
                    story: storyId
                });
                return res.status(200).json({
                    success: true,
                    message: "Reading already started",
                    alreadyExists: true,
                    progress
                });
            }
            throw error;
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Complete Reading
// ":id" is the progress record id. Only the owner can complete it.
const completeReading = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({
                success: false,
                message: "Reading progress not found"
            });
        }

        const existing = await ReadingProgress.findOne({
            _id: req.params.id,
            user: req.userId
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Reading progress not found"
            });
        }

        // Completing twice keeps the original completion date.
        if (existing.status !== "completed") {
            existing.status = "completed";
            existing.completedAt = new Date();
            await existing.save();
        }

        res.status(200).json({
            success: true,
            message: "Reading completed",
            progress: existing
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Reading History (newest activity first, story details included)
const getProgress = async (req, res) => {
    try {
        const progress = await ReadingProgress.find({
            user: req.userId
        })
            .sort({ updatedAt: -1 })
            .populate("story");

        res.status(200).json({
            success: true,
            progress
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Dashboard
// With one record per user+story, these are counts of unique stories.
const getDashboard = async (req, res) => {
    try {
        const totalStoriesRead = await ReadingProgress.countDocuments({
            user: req.userId
        });

        const completedStories = await ReadingProgress.countDocuments({
            user: req.userId,
            status: "completed"
        });

        const inProgressStories = await ReadingProgress.countDocuments({
            user: req.userId,
            status: "in-progress"
        });

        res.status(200).json({
            success: true,
            dashboard: {
                totalStoriesRead,
                completedStories,
                inProgressStories
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    startReading,
    completeReading,
    getProgress,
    getDashboard
};
