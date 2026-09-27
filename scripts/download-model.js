/*
 * Downloads the free Whisper speech model once (~80 MB) into backend/.models
 * so Speaking Practice works offline afterwards.
 * Run from the backend folder:  npm run download-model
 */
const dotenv = require("dotenv");
dotenv.config();

const { loadPipeline, getEngineStatus } = require("../services/speech/transcriber");

loadPipeline()
    .then(() => {
        const engine = getEngineStatus();
        console.log(`Done. ${engine.model} (${engine.dtype}) is downloaded and ready.`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("Model download failed:", error.message);
        process.exit(1);
    });
