const multer = require("multer");

const MAX_FILE_MB = 10;
const ALLOWED_TYPES = ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];

// Audio is kept in memory only for the length of the request, never on disk.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
        const error = new Error("Please upload the recording as a WAV file.");
        error.status = 415;
        cb(error);
    }
});

// Wraps multer so its errors come back in the usual { success, message } shape.
const uploadAudio = (req, res, next) => {
    upload.single("audio")(req, res, (error) => {
        if (!error) return next();
        let status = error.status || 400;
        let message = error.message;
        if (error.code === "LIMIT_FILE_SIZE") {
            status = 413;
            message = `The recording is too large (max ${MAX_FILE_MB} MB).`;
        } else if (error.code === "LIMIT_UNEXPECTED_FILE") {
            message = 'Send the recording in a form field named "audio".';
        }
        return res.status(status).json({ success: false, message });
    });
};

module.exports = { uploadAudio, MAX_FILE_MB };
