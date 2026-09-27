const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authmiddleware");
const { aiAudioUpload } = require("../middleware/aiAudioUpload");
const {
    analyzeSpeakingReading,
    listSpeakingAnalyses,
    getSpeakingAnalysis
} = require("../controllers/aicontroller");

// JWT is checked first, so unauthenticated uploads are rejected immediately.
router.post("/analyze-speaking", authMiddleware, aiAudioUpload, analyzeSpeakingReading);
router.get("/speaking-analyses", authMiddleware, listSpeakingAnalyses);
router.get("/speaking-analyses/:id", authMiddleware, getSpeakingAnalysis);

module.exports = router;
