/*
 * Local speech-to-text with OpenAI's open-source Whisper model, run on your
 * CPU by Transformers.js (ONNX Runtime). No API key, no paid service.
 *
 * The model (~80 MB for the default q8 build) is downloaded once from the
 * Hugging Face Hub into backend/.models and reused offline after that.
 * Pre-download it with:  npm run download-model
 */
const path = require("path");

const DEFAULT_MODEL = "onnx-community/whisper-base_timestamped";

function config() {
    return {
        model: process.env.WHISPER_MODEL || DEFAULT_MODEL,
        dtype: process.env.WHISPER_DTYPE || "q8",
        cacheDir: process.env.MODEL_CACHE_DIR || path.join(__dirname, "..", "..", ".models")
    };
}

const state = {
    status: "idle", // idle | loading | ready | error
    error: null,
    model: null,
    dtype: null,
    pipelinePromise: null
};

let queue = Promise.resolve();

async function loadPipeline() {
    if (state.pipelinePromise) return state.pipelinePromise;

    const { model, dtype, cacheDir } = config();
    state.status = "loading";
    state.error = null;
    state.model = model;

    state.pipelinePromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = cacheDir;

        let lastLogged = 0;
        const progress_callback = (p) => {
            if (p.status === "progress" && p.file && Date.now() - lastLogged > 2000) {
                lastLogged = Date.now();
                console.log(`[speaking] downloading ${p.file}: ${Math.round(p.progress || 0)}%`);
            }
        };

        const create = (type) =>
            pipeline("automatic-speech-recognition", model, { dtype: type, device: "cpu", progress_callback });

        let transcriber;
        try {
            transcriber = await create(dtype);
            state.dtype = dtype;
        } catch (error) {
            if (dtype === "fp32") throw error;
            console.warn(`[speaking] could not load ${model} (${dtype}): ${error.message}. Retrying with fp32…`);
            transcriber = await create("fp32");
            state.dtype = "fp32";
        }

        state.status = "ready";
        console.log(`[speaking] Whisper model ready: ${model} (${state.dtype})`);
        return transcriber;
    })().catch((error) => {
        state.status = "error";
        state.error = error.message;
        state.pipelinePromise = null; // allow a retry on the next request
        throw error;
    });

    return state.pipelinePromise;
}

/*
 * samples: Float32Array, mono, 16 kHz.
 * Returns { text, words: [{ word, start, end }] } from the real model output.
 * Requests are processed one at a time so the laptop isn't overloaded.
 */
function transcribe(samples, durationSec) {
    const job = queue.then(async () => {
        const transcriber = await loadPipeline();
        const { model } = config();
        const options = { return_timestamps: "word" };
        if (!/\.en(\b|_)/.test(model)) {
            options.language = "english";
            options.task = "transcribe";
        }
        if (durationSec > 29) {
            // chunk_length_s must stay below 30 (known Transformers.js issue #1358).
            options.chunk_length_s = 29;
            options.stride_length_s = 5;
        }

        const output = await transcriber(samples, options);
        const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
        return {
            text: String(output?.text || "").trim(),
            words: chunks.map((c) => ({
                word: String(c.text || "").trim(),
                start: Array.isArray(c.timestamp) ? c.timestamp[0] : null,
                end: Array.isArray(c.timestamp) ? c.timestamp[1] : null
            }))
        };
    });
    // Keep the queue alive even if this job fails.
    queue = job.catch(() => {});
    return job;
}

function getEngineStatus() {
    const { model, dtype } = config();
    return {
        name: "Whisper (open source, runs locally)",
        model: state.model || model,
        dtype: state.dtype || dtype,
        status: state.status,
        error: state.error
    };
}

module.exports = { transcribe, loadPipeline, getEngineStatus };
