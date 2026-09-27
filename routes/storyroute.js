const authMiddleware = require("../middleware/authmiddleware");
const express = require("express");

const {createStory,getStories,getStoryById,updateStory,deleteStory} = require("../controllers/storycontroller");

const router = express.Router();



router.post("/", authMiddleware, createStory);
router.get("/", getStories);
router.get("/:id", getStoryById);
router.put("/:id", authMiddleware, updateStory);

router.delete("/:id", authMiddleware, deleteStory);


module.exports = router;