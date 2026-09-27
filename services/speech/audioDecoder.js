/*
 * Converts any common audio upload (wav, mp3, m4a/mp4, aac, webm, ogg, flac)
 * into mono 16 kHz Float32 samples for Whisper.
 *
 * Uses the free "ffmpeg-static" npm package (a bundled ffmpeg binary). No system
 * install needed. Set FFMPEG_PATH in .env to use your own ffmpeg instead.
 *
 * The upload is written to a temporary file only while ffmpeg reads it and is
 * deleted immediately afterwards (some formats, like m4a, can't be streamed).
 */
const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { parseWav, WavError, TARGET_RATE } = require("./wav");

class AudioDecodeError extends Error {}

function getFfmpegPath() {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
        // eslint-disable-next-line global-require
        const bundled = require("ffmpeg-static");
        if (bundled) return bundled;
    } catch {
        // package not installed. Fall back to an ffmpeg on the PATH.
    }
    return "ffmpeg";
}

function runFfmpeg(inputFile, maxSeconds) {
    return new Promise((resolve, reject) => {
        const args = [
            "-hide_banner", "-loglevel", "error", "-nostdin",
            "-i", inputFile,
            "-t", String(maxSeconds + 1), // stop reading after the limit (+1 s to detect "too long")
            "-vn", "-ac", "1", "-ar", String(TARGET_RATE),
            "-f", "f32le", "pipe:1"
        ];
        let child;
        try {
            child = spawn(getFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
            reject(error);
            return;
        }
        const out = [];
        let err = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
        child.stdout.on("data", (chunk) => out.push(chunk));
        child.stderr.on("data", (chunk) => {
            err += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(Buffer.concat(out));
            else reject(new AudioDecodeError(err.trim().split("\n").pop() || `ffmpeg exited with code ${code}`));
        });
    });
}

/*
 * Returns { samples: Float32Array, sampleRate: 16000, durationSec, decodedWith }.
 * Throws AudioDecodeError for malformed/unsupported files.
 */
async function decodeAudio(buffer, { maxSeconds = 300, originalName = "" } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
        throw new AudioDecodeError("The audio file is empty.");
    }

    // Fast path: plain PCM WAV (what the BoloBuddy web app records).
    if (buffer.toString("ascii", 0, 4) === "RIFF") {
        try {
            const wav = parseWav(buffer);
            return { samples: wav.samples, sampleRate: TARGET_RATE, durationSec: wav.durationSec, decodedWith: "wav" };
        } catch (error) {
            if (!(error instanceof WavError)) throw error;
            // e.g. compressed WAV: let ffmpeg try.
        }
    }

    const ext = path.extname(originalName).replace(/[^.a-z0-9]/gi, "").slice(0, 6) || ".audio";
    const tmpFile = path.join(os.tmpdir(), `bolobuddy-${crypto.randomUUID()}${ext}`);
    try {
        await fs.writeFile(tmpFile, buffer);
        let pcm;
        try {
            pcm = await runFfmpeg(tmpFile, maxSeconds);
        } catch (error) {
            if (error.code === "ENOENT") {
                throw new Error("ffmpeg is not available. Run npm install in the backend (installs ffmpeg-static).");
            }
            if (error instanceof AudioDecodeError) {
                throw new AudioDecodeError("The audio file is damaged or in an unsupported format.");
            }
            throw error;
        }
        const aligned = new Uint8Array(pcm.length - (pcm.length % 4));
        aligned.set(pcm.subarray(0, aligned.length));
        const samples = new Float32Array(aligned.buffer);
        if (samples.length === 0) throw new AudioDecodeError("The audio file contains no sound.");
        return { samples, sampleRate: TARGET_RATE, durationSec: samples.length / TARGET_RATE, decodedWith: "ffmpeg" };
    } finally {
        fs.unlink(tmpFile).catch(() => {});
    }
}

module.exports = { decodeAudio, AudioDecodeError };
