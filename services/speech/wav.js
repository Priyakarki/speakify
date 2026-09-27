/*
 * Minimal WAV (RIFF) reader. The browser records 16 kHz mono 16-bit PCM WAV,
 * but this also accepts other PCM/float WAVs and converts them to what Whisper
 * needs: mono Float32 samples at 16 kHz.
 */
const TARGET_RATE = 16000;

class WavError extends Error {}

function parseWav(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
        throw new WavError("The recording is empty or not a valid WAV file.");
    }
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        throw new WavError("The recording is not a WAV file.");
    }

    let offset = 12;
    let fmt = null;
    let data = null;

    while (offset + 8 <= buffer.length) {
        const id = buffer.toString("ascii", offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        if (id === "fmt ") {
            fmt = {
                format: buffer.readUInt16LE(start),
                channels: buffer.readUInt16LE(start + 2),
                sampleRate: buffer.readUInt32LE(start + 4),
                bitsPerSample: buffer.readUInt16LE(start + 14)
            };
        } else if (id === "data") {
            data = buffer.subarray(start, Math.min(start + size, buffer.length));
        }
        offset = start + size + (size % 2);
    }

    if (!fmt || !data) throw new WavError("The WAV file is missing audio data.");

    const { format, channels, sampleRate, bitsPerSample } = fmt;
    const isPcm16 = format === 1 && bitsPerSample === 16;
    const isFloat32 = format === 3 && bitsPerSample === 32;
    if (!isPcm16 && !isFloat32) {
        throw new WavError("Unsupported WAV encoding. Use 16-bit PCM or 32-bit float.");
    }
    if (channels < 1 || channels > 2) throw new WavError("Only mono or stereo audio is supported.");

    const bytesPerSample = bitsPerSample / 8;
    const frames = Math.floor(data.length / (bytesPerSample * channels));
    const mono = new Float32Array(frames);

    for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
            const pos = (i * channels + c) * bytesPerSample;
            sum += isPcm16 ? data.readInt16LE(pos) / 32768 : data.readFloatLE(pos);
        }
        mono[i] = sum / channels;
    }

    const samples = sampleRate === TARGET_RATE ? mono : resample(mono, sampleRate, TARGET_RATE);
    return {
        samples,
        sampleRate: TARGET_RATE,
        originalSampleRate: sampleRate,
        durationSec: samples.length / TARGET_RATE
    };
}

// Linear-interpolation resampler (good enough for speech recognition).
function resample(input, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const pos = i * ratio;
        const left = Math.floor(pos);
        const right = Math.min(left + 1, input.length - 1);
        const frac = pos - left;
        output[i] = input[left] * (1 - frac) + input[right] * frac;
    }
    return output;
}

// Root-mean-square level, used to reject silent recordings.
function rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
}

module.exports = { parseWav, rms, WavError, TARGET_RATE };
