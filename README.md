# BoloBuddy Backend

Express 5 + MongoDB (Mongoose 9) API with JWT authentication.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # then set MONGO_URI and JWT_SECRET
npm run fix:progress        # one time: removes old duplicate progress records
npm run download-model      # optional, one time: downloads the free Whisper model (~80 MB)
npm run dev                 # or: npm start
```

Requires Node 18+. No Python, ffmpeg, GPU or paid API keys.

## Reading progress: one record per user + story

* `POST /api/progress` creates a record the first time. If the story was already
  started or completed, it returns the existing record (`200`, `alreadyExists: true`).
* A unique MongoDB index on `{ user, story }` enforces this at the database level.
* `npm run fix:progress` merges duplicates created before this fix ("completed" wins)
  and builds the index. Use `npm run fix:progress -- --dry-run` to preview.

## Speaking Practice (free, local)

| Step | What happens | Where |
|---|---|---|
| Upload | Multer receives a WAV (max 10 MB) in memory, never written to disk | `middleware/audioUpload.js` |
| Validate | WAV header, 1–60 s duration, not silent | `services/speech/wav.js` |
| Passage | Story split into ~40-word passages at sentence boundaries | `services/speech/passages.js` |
| Speech-to-text | Open-source Whisper (`onnx-community/whisper-base_timestamped`) run locally by Transformers.js: transcript + word timestamps | `services/speech/transcriber.js` |
| Pronunciation hints | CMU Pronouncing Dictionary compares the sounds of expected vs heard words | `services/speech/pronunciation.js` |
| Scoring | Word alignment, WPM, hesitations, long pauses, repeats, fillers, scores | `services/speech/analysis.js` |
| Storage | Results saved as `SpeakingAttempt` (audio is not stored) | `models/speakingattemptmodel.js` |

### Endpoints (all require `Authorization: Bearer <token>`)

| Method | Endpoint | Body / query | Response |
|---|---|---|---|
| GET | `/api/speaking/status` | – | `{ engine, pronunciationDictionary, limits }` |
| GET | `/api/speaking/passages/:storyId` | – | `{ story, passages: [{ index, text, wordCount }] }` |
| POST | `/api/speaking/analyze` | multipart: `audio` (WAV), `storyId`, `passageIndex` | `201 { attempt }` |
| GET | `/api/speaking/attempts` | `?storyId&page&limit` | `{ attempts, total, totalPages, summary }` |
| GET | `/api/speaking/attempts/:id` | – | `{ attempt }` |

### Scores (all calculated from the real transcript)

* **Pronunciation (clarity)**: % of words read that Whisper recognised as the intended word.
  "Close" words (only one sound different) count half.
* **Fluency**: 100 minus penalties for pace outside 90–170 WPM, hesitations (gaps ≥ 0.6 s
  mid-phrase), long pauses (≥ 1.5 s), repeated words and fillers.
* **Completeness**: % of passage words read.
* **Overall** = (55% pronunciation + 45% fluency) × completeness.

**Limitation:** this is recognition-based clarity, not phoneme-level acoustic scoring.
Whisper can "auto-correct" a slightly mispronounced word, so small mistakes may be missed.
Words flagged as unclear or close were genuinely heard differently.

### Optional `.env` settings

`WHISPER_MODEL`, `WHISPER_DTYPE` (`q8` default, or `fp32`), `MODEL_CACHE_DIR`, `SPEAKING_MAX_SECONDS`.

## AI Story Reading & Speaking Analysis

`POST /api/ai/analyze-speaking` (JWT, multipart: `audio` + `storyId` or `storyText`) returns pronunciation mistakes
(with IPA), speed, pauses, fluency, reading accuracy, an overall score and level, feedback and practice words.
It runs on the same free local Whisper engine. See **[docs/AI_SPEAKING_API.md](docs/AI_SPEAKING_API.md)** and the
Postman collection in `postman/`.
