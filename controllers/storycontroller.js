const Story = require("../models/storymodel");

// Create Story
const createStory = async (req, res) => {
    try {
        const { title, content, difficulty } = req.body;

        const story = await Story.create({
            title,
            content,
            difficulty
        });

        res.status(201).json({
            success: true,
            message: "Story created successfully",
            story
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All Stories
const getStories = async (req, res) => {
    try {
        const {
            difficulty,
            search,
            page = 1,
            limit = 5
        } = req.query;

        console.log("Search:", search);
        console.log("Difficulty:", difficulty);
        console.log("Page:", page);
        console.log("Limit:", limit);

        let filter = {};

        if (difficulty) {
            filter.difficulty = difficulty;
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: "i" } },
                { content: { $regex: search, $options: "i" } }
            ];
        }

        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        const skip = (pageNumber - 1) * limitNumber;

        const stories = await Story.find(filter)
            .skip(skip)
            .limit(limitNumber);

        const totalStories = await Story.countDocuments(filter);

        res.status(200).json({
            success: true,
            page: pageNumber,
            limit: limitNumber,
            totalStories,
            totalPages: Math.ceil(totalStories / limitNumber),
            stories
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Story By ID
const getStoryById = async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);

        if (!story) {
            return res.status(404).json({
                success: false,
                message: "Story not found"
            });
        }

        res.status(200).json({
            success: true,
            story
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update story
const updateStory = async (req, res) => {
    try {
        const story = await Story.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!story) {
            return res.status(404).json({
                success: false,
                message: "Story not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Story updated successfully",
            story
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// Delete story
const deleteStory = async (req, res) => {
    try {
        const story = await Story.findByIdAndDelete(req.params.id);

        if (!story) {
            return res.status(404).json({
                success: false,
                message: "Story not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Story deleted successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
module.exports = {
    createStory,
    getStories,
    getStoryById,
    updateStory,
    deleteStory
};