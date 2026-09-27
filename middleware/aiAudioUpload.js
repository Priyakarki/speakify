const path = require("path");
const multer = require("multer");

// Upload rules for POST /api/ai/analyze-speaking.
// (The existing /api/speaking upload rules in audioUpload.js are unchanged.)
const maxFileMb = () => Number(process.env.AI_MAX_AUDIO_MB) || 25;

const ALLOWED_MIME = new Set([
    "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
    "audio/mpeg", "audio/mp3",
    "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/x-aac",
    "audio/webm", "video/webm", "audio/ogg", "audio/opus",
    "audio/flac", "audio/x-flac"
]);
const ALLOWED_EXT = new Set([".wav", ".mp3", ".m4a", ".mp4", ".aac", ".webm", ".ogg", ".oga", ".opus", ".flac"]);

function buildUpload() {
    return multer({
        storage: multer.memoryStorage(), // never written to the uploads folder
        limits: { fileSize: maxFileMb() * 1024 * 1024, files: 1, fields: 10, fieldSize: 200 * 1024 },
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname || "").toLowerCase();
            const mimeOk = ALLOWED_MIME.has(file.mimetype);
            // Postman and some phones send "application/octet-stream". Then the extension decides.
            const extOk = ALLOWED_EXT.has(ext);
            if (mimeOk || (extOk && ["application/octet-stream", ""].includes(file.mimetype || ""))) return cb(null, true);
            const error = new Error(
                "Unsupported audio type. Upload wav, mp3, m4a, aac, webm, ogg, opus or flac."
            );
            error.status = 415;
            return cb(error);
        }
    });
}

const aiAudioUpload = (req, res, next) => {
    buildUpload().single("audio")(req, res, (error) => {
        if (!error) return next();
        let status = error.status || 400;
        let message = error.message;
        if (error.code === "LIMIT_FILE_SIZE") {
            status = 413;
            message = `The audio file is too large (max ${maxFileMb()} MB).`;
        } else if (error.code === "LIMIT_UNEXPECTED_FILE") {
            message = 'Send exactly one audio file in the form-data field named "audio".';
        } else if (error.code === "LIMIT_FIELD_VALUE") {
            message = "storyText is too long (max 200 KB).";
        }
        return res.status(status).json({ success: false, message });
    });
};

module.exports = { aiAudioUpload, maxFileMb };
