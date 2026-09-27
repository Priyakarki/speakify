const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authmiddleware");

const { startReading,completeReading,getProgress,getDashboard
} = require("../controllers/progresscontroller");

router.post("/", authMiddleware, startReading);
router.get("/dashboard", authMiddleware, getDashboard);
router.put("/:id", authMiddleware, completeReading);
router.get("/", authMiddleware, getProgress);


module.exports = router;