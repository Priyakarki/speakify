# AI Story Reading & Speaking Analysis API

Free and local: it uses the open-source **Whisper** model already in BoloBuddy (`services/speech/`).
There's **no paid AI provider and no API key**. Nothing about the audio leaves your server.

## Endpoint

| | |
|---|---|
| **URL** | `POST http://localhost:3000/api/ai/analyze-speaking` |
| **Auth** | `Authorization: Bearer <token from /api/auth/login>` |
| **Body** | `multipart/form-data` |

| Field | Type | Required | Notes |
|---|---|---|---|
| `audio` | File | yes | wav, mp3, m4a/mp4, aac, webm, ogg/opus, flac. Max 25 MB and 5 minutes (configurable). |
| `storyId` | Text | one of the two | Id of a story in the database. If sent, the story's text is used. |
| `storyText` | Text | one of the two | Any text to read (3 words to 20,000 characters). Used when no `storyId`. |

The user is **always** taken from the JWT (`req.userId`). A `userId` field in the body is ignored.

### History endpoints

| Method | URL | Response |
|---|---|---|
| GET | `/api/ai/speaking-analyses?storyId=&page=1&limit=10` | `{ analyses: [summary…], total, totalPages }` |
| GET | `/api/ai/speaking-analyses/:id` | `{ analysis }` (the full saved analysis, owner only) |

## Postman setup

1. **Log in:** `POST http://localhost:3000/api/auth/login`, Body → raw → JSON:
   `{ "email": "you@example.com", "password": "yourpassword" }`. Copy `token` from the response.
2. **New request:** `POST http://localhost:3000/api/ai/analyze-speaking`
3. **Authorization** tab → Type **Bearer Token** → paste the token.
4. **Body** tab → **form-data**:
   * key `audio`: change the type from *Text* to **File**, then choose your recording
   * key `storyId`: *Text*, a story `_id` from `GET /api/stories`
     (or key `storyText`: *Text*, paste the story)
5. Don't set `Content-Type` yourself; Postman adds the multipart boundary.
6. **Send.** The first request downloads the speech model once (~80 MB), so it can take a minute.
   Run `npm run download-model` beforehand to avoid that.

Or import `postman/BoloBuddy-AI.postman_collection.json`. Its Login request saves the token automatically.

## Error responses (always `{ "success": false, "message": "…" }`)

| Status | When |
|---|---|
| 400 | no audio, no storyId/storyText, invalid storyId, text too long or short, damaged/unsupported audio, recording < 1 s or too long |
| 401 | missing/invalid/expired JWT |
| 404 | storyId not found |
| 413 | file larger than `AI_MAX_AUDIO_MB` |
| 415 | not an audio file type |
| 422 | silent recording, no speech recognised, fewer than 3 words recognised |
| 503 | speech model could not load (first run needs internet once) |
| 500 | unexpected server error |

## Expected success response (200)

Produced by the test run (stand-in transcription of a reading with a few deliberate mistakes); arrays shortened.

```json
{
  "success": true,
  "analysisId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "story": {
    "_id": "64b000000000000000000001",
    "title": "The Little Fox"
  },
  "analysis": {
    "transcript": "The little fox felt wery comfortble in his warm house. Tree um birds sang sang beau beautiful songs the window, and he smiled happily.",
    "overallScore": 88,
    "level": "Good",
    "levelNote": "A learning indicator, not a formal English certification.",
    "scores": {
      "overallScore": 88,
      "pronunciationScore": 98,
      "fluencyScore": 80,
      "readingAccuracyScore": 71,
      "speedScore": 100,
      "pauseScore": 90
    },
    "weights": {
      "pronunciation": 0.35,
      "fluency": 0.25,
      "readingAccuracy": 0.2,
      "speed": 0.1,
      "pause": 0.1
    },
    "pronunciation": {
      "score": 98,
      "explanation": "17 of 20 words you read were recognised clearly, and 2 had normal accent variation (not penalised). Pronunciation issues found: 0 major, 1 moderate, 0 minor.",
      "wordsEvaluated": 20,
      "clearWords": 17,
      "mistakes": [
        {
          "word": "comfortable",
          "position": 5,
          "userPronunciation": "comfortble",
          "userPronunciationRespelling": "KUHMF-tuh-buhl",
          "correctPronunciation": "KUHM-fer-tuh-buhl",
          "ipa": "/ˈkʌmfɚtəbəl/",
          "explanation": "The \"er\" (as in bird) sound was not heard, and a syllable seems to be missing (4 expected).",
          "severity": "moderate",
          "confidence": 0.75,
          "evidence": "Speech recognizer heard a different word; sound difference from the CMU Pronouncing Dictionary"
        }
      ],
      "accentVariations": [
        {
          "word": "very",
          "position": 4,
          "heardAs": "wery",
          "note": "Common accent variation (the \"v\" sound was heard as \"w\"). Not counted as a mistake."
        },
        {
          "word": "Three",
          "position": 10,
          "heardAs": "Tree",
          "note": "Common accent variation (the \"th\" (as in think) sound was heard as \"t\"). Not counted as a mistake."
        }
      ],
      "stressAnalysis": "Not available: the speech model does not measure word stress."
    },
    "fluency": {
      "score": 80,
      "feedback": "Your reading was mostly smooth. Main issue: you didn't finish 1 sentence.",
      "hesitations": 3,
      "repetitions": 1,
      "falseStarts": 1,
      "fillers": 1,
      "incompleteSentences": 1,
      "rhythmVariation": 0.12,
      "penalties": {
        "unnecessaryPauses": 0,
        "fillers": 3,
        "repetitionsAndFalseStarts": 7,
        "incompleteSentences": 10,
        "unevenRhythm": 0,
        "extremeSpeed": 0
      },
      "strengths": [
        "You read without unnecessary stops.",
        "Your rhythm was steady."
      ],
      "weaknesses": [
        "You didn't finish 1 sentence.",
        "You repeated or restarted words 2 times.",
        "You used filler words (um)."
      ],
      "suggestions": [
        "When you need time, stay silent for a moment instead of saying \"um\".",
        "If you make a small mistake, keep going. Don't restart the word.",
        "Always finish the sentence you start."
      ]
    },
    "speed": {
      "score": 100,
      "durationSeconds": 11.3,
      "recordingSeconds": 12,
      "spokenWords": 23,
      "wpm": 122,
      "classification": "Good",
      "targetRange": "100–160 WPM for reading aloud"
    },
    "pauses": {
      "score": 90,
      "totalPauses": 0,
      "averagePauseSeconds": 0,
      "longestPauseSeconds": 0,
      "unnecessaryPauses": 0,
      "naturalPauses": 0,
      "midSentenceStops": 0,
      "hesitationCount": 3,
      "pausesPerMinute": 0,
      "frequentPauses": false,
      "fillerWords": [
        "um"
      ],
      "penalties": {
        "unnecessaryPauses": 0,
        "fillers": 4,
        "restarts": 6,
        "frequentPauses": 0
      },
      "details": [
        {
          "...": "one entry per pause"
        }
      ]
    },
    "readingAccuracy": {
      "score": 71,
      "totalWords": 28,
      "wordsRead": 21,
      "skippedWords": [
        {
          "word": "outside",
          "position": 15
        }
      ],
      "addedWords": [],
      "wrongWords": [
        {
          "expected": "home",
          "heard": "house",
          "position": 9,
          "confidence": 0.65
        }
      ],
      "repeatedWords": [
        {
          "word": "sang",
          "position": 12
        }
      ],
      "falseStarts": [
        {
          "heard": "beau",
          "word": "beautiful",
          "position": 13
        }
      ],
      "notReadCount": 6,
      "incompleteSentences": [
        {
          "sentence": 2,
          "text": "Three birds sang beautiful songs outside the window, and he smiled happily.",
          "missingWords": 1,
          "of": 12
        }
      ],
      "unreadSentences": 1,
      "differences": [
        {
          "type": "wrong",
          "expected": "home",
          "heard": "house",
          "position": 9,
          "confidence": 0.65
        },
        {
          "type": "repeated",
          "heard": "sang",
          "position": 12
        },
        {
          "...": "all differences, sorted by position"
        }
      ]
    },
    "feedback": {
      "strengths": [
        "Most of your words were clear and easy to understand.",
        "Your reading speed (122 words per minute) is comfortable to listen to."
      ],
      "weaknesses": [
        "Some words were skipped, changed or not read."
      ],
      "topImprovements": [
        "Practise these words: comfortable, outside.",
        "Read carefully and don't skip or change words.",
        "Replace \"um\" and \"uh\" with a short silent pause."
      ],
      "topPronunciationProblems": [
        "\"comfortable\" sounded like \"comfortble\". The \"er\" (as in bird) sound was not heard, and a syllable seems to be missing (4 expected)."
      ],
      "topFluencyProblems": [
        "You didn't finish 1 sentence.",
        "You repeated or restarted words 2 times.",
        "You used filler words (um)."
      ],
      "speedFeedback": "You read at 122 words per minute. That's a good, natural speed.",
      "pauseFeedback": "Your pauses were natural. You paused at punctuation and kept going in the middle of sentences.",
      "readingAccuracyFeedback": "You read 21 of 28 words. 1 word skipped, 1 word changed, 6 words at the end not read. Follow the text with your finger to stay on track.",
      "practiceNext": [
        "Repeat each practice word 3 times, slowly, then at normal speed.",
        "Read the same story again and try to finish every sentence without stopping.",
        "Practise this story once more, then try a new one."
      ]
    },
    "practiceWords": [
      {
        "word": "comfortable",
        "correctPronunciation": "KUHM-fer-tuh-buhl",
        "ipa": "/ˈkʌmfɚtəbəl/",
        "practiceTip": "Don't drop the \"er\" (as in bird) sound. Say it slowly by syllables (KUHM-fer-tuh-buhl), then at normal speed.",
        "severity": "moderate",
        "repeatPractice": true
      },
      {
        "word": "outside",
        "correctPronunciation": "OWT-SIGHD",
        "ipa": "/ˈaʊtˈsaɪd/",
        "practiceTip": "This word wasn't heard. Say it clearly and don't skip it.",
        "severity": "minor",
        "repeatPractice": true
      }
    ],
    "words": [
      {
        "position": 0,
        "text": "The",
        "status": "correct",
        "heard": "The",
        "start": 0.3,
        "end": 0.68
      },
      {
        "position": 1,
        "text": "little",
        "status": "correct",
        "heard": "little",
        "start": 0.78,
        "end": 1.16
      },
      {
        "position": 2,
        "text": "fox",
        "status": "correct",
        "heard": "fox",
        "start": 1.25,
        "end": 1.63
      },
      {
        "...": "one entry per story word"
      }
    ],
    "analysisMethod": {
      "measuredFromAudio": [
        "word start/end timestamps (Whisper)",
        "speaking duration and words per minute",
        "pause lengths, mid-sentence stops, rhythm"
      ],
      "detectedFromRecognition": [
        "pronunciation issues: passage words the recognizer heard as a different, similar-sounding word",
        "sound-level explanation, IPA and respelling from the CMU Pronouncing Dictionary"
      ],
      "transcriptBasedInference": [
        "skipped, added, repeated and wrong words",
        "false starts and incomplete sentences",
        "whether a mismatch is a pronunciation issue or a different word (by how many sounds differ)"
      ],
      "notAvailable": [
        "phoneme-by-phoneme acoustic scoring",
        "word stress and intonation",
        "confidence from the acoustic model (confidence values are rule-based evidence strength)"
      ],
      "accentPolicy": "Words recognised correctly are never flagged. Single-sound differences typical of Indian/regional accents (th→t, th→d, v↔w, v↔b, z→s) are listed as accent variation and not penalised.",
      "weights": {
        "pronunciation": 0.35,
        "fluency": 0.25,
        "readingAccuracy": 0.2,
        "speed": 0.1,
        "pause": 0.1
      }
    },
    "engine": {
      "name": "Whisper (open source, runs locally)",
      "model": "onnx-community/whisper-base_timestamped",
      "dtype": "q8"
    }
  }
}
```

## How the scores work

| Score | Source | How |
|---|---|---|
| **pronunciationScore** | recognition + dictionary | Credit per word read: clear or accent variation = 1, minor issue = 0.8, moderate = 0.55, major = 0.3. Average × 100, minus 2 per repeated mistake on the same word (max −10). |
| **fluencyScore** | audio timing + transcript | 100 − penalties: unnecessary pauses (5 each, max 25), fillers (3, max 12), repeats/false starts (3/4, max 16), unfinished sentences (up to 20), uneven rhythm between sentences (max 12), too slow/fast (8). |
| **readingAccuracyScore** | transcript vs story | (words − skipped − not read − wrong − 0.5 × added − 0.25 × repeated) ÷ words × 100 |
| **speedScore** | audio timing | 100 inside 100–160 WPM; −1.5 per WPM outside. WPM = spoken words ÷ speaking minutes (first word start → last word end). |
| **pauseScore** | audio timing | 100 − 7 per unnecessary pause (max 49) − 4 per filler (max 20) − 3 per repeat/false start (max 15) − frequent-pause penalty (over 25/min). |
| **overallScore** | all | 35% pronunciation + 25% fluency + 20% reading accuracy + 10% speed + 10% pauses (the weighting you requested) |

**Level:** 90–100 Excellent, 75–89 Good, 60–74 Developing, 40–59 Needs Improvement, 0–39 Beginner.
This is a learning indicator, not a certification.

**Pauses:** gaps under 0.3 s are ignored. At `. ! ?`, pauses under 2 s are natural; at `, ; :`, under 1.2 s.
In the middle of a sentence, gaps under 0.6 s (breathing, phrasing) are natural; 0.6–1.5 s is a hesitation; 1.5 s or more is a stop.

**Pronunciation severity:** based on how many sounds differ (CMU dictionary): 1 = minor, 2 = moderate, 3 = major.
A dropped or added syllable raises it one level. With 4 or more differences (or over 60% of the word), it counts as a different
(wrong) word instead. That's a reading-accuracy error, not pronunciation.

**Confidence:** rule-based evidence strength (0.45–0.8), **not** an acoustic-model probability. It's lower when a word isn't in the dictionary.

## Accent policy

* A word Whisper recognised correctly is **never** flagged, whatever the accent.
* A word that differs by exactly one sound typical of Indian/regional English
  (th→t, th→d, v↔w, v↔b, z→s, ɑ↔ɔ) goes to `pronunciation.accentVariations` and is **not penalised**.
* Natural pauses at punctuation and short breathing pauses are not penalised.

## Limitations (please read)

* **This is not phoneme-level acoustic pronunciation assessment.** Pronunciation issues are detected when the
  speech recognizer hears a *different word* than the story word. The sound-level explanation, IPA and
  respelling come from the CMU Pronouncing Dictionary (General American).
* Whisper uses language context and may "auto-correct" a slightly mispronounced word, so some small errors are missed.
  Flagged words, though, were genuinely heard differently.
* Word **stress and intonation are not measured.** Whisper doesn't provide them, so they're not in any score.
* Whisper often drops fillers ("um", "uh"). Hesitation detection relies mostly on pause timing.
* Deciding "pronunciation issue" vs "wrong word" is inference from the transcript (see confidence).
* Processing runs on the server CPU: roughly 5–30 s for a 1-minute recording, slower on the first request.

## Frontend call (React + axios)

`bolobuddy-frontend/src/services/aiService.js`:

```js
import { analyzeStoryReading } from "../services/aiService";

// audioBlob: from the recorder (the Speaking page already produces a WAV Blob)
const result = await analyzeStoryReading({ audio: audioBlob, storyId: story._id });
console.log(result.analysis.overallScore, result.analysis.level);
```
