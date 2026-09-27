const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authmiddleware");
const { uploadAudio } = require("../middleware/audioUpload");
const {
    getStatus,
    getPassages,
    analyze,
    listAttempts,
    getAttempt
} = require("../controllers/speakingcontroller");

router.get("/status", authMiddleware, getStatus);
router.get("/passages/:storyId", authMiddleware, getPassages);
router.post("/analyze", authMiddleware, uploadAudio, analyze);
router.get("/attempts", authMiddleware, listAttempts);
router.get("/attempts/:id", authMiddleware, getAttempt);

module.exports = router;
