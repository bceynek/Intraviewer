# Interview Coach

## Run locally

Résumé upload: select a text-based PDF (up to 5 MB and 20 pages), wait for the
ready message, then start practice. Extracted text stays in browser memory and
is not displayed; up to 20,000 characters are used. Scanned and password-protected PDFs are not supported.
The app does not save the uploaded file. Résumé text is included in interview
questions and feedback sent to Gemini. Use Clear résumé to remove it.

From the project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python Backend/main.py
```

Open http://127.0.0.1:8000 in your browser. Use this address rather than opening
the HTML file directly or using Live Server: Python serves both the page and API.
Keep the terminal running; press Ctrl+C to stop it.

Put `GEMINI_API_KEY=your_key` in the project's `dotenv.env` file. The backend
loads this file regardless of your working directory. Never put the key in
frontend JavaScript. `dotenv.env` is ignored by Git.

The default model is `gemini-3.5-flash-lite`. To change it, add
`GEMINI_MODEL=your_available_model` to `dotenv.env` and restart Python.

`POST /api/questions` accepts role, experience, and optional job_description.
`POST /api/feedback` accepts that context plus five question/answer pairs.
The page displays loading and error messages; feedback can be retried without
losing answers. Answers stay in the browser until sent for feedback and are not
saved by the server. Refreshing the page clears the interview.

If Gemini reports a quota error, check your Google AI Studio quota. For an
unavailable model, change GEMINI_MODEL. Timeouts can be retried. This server is
for local development and listens only on your machine.

Run backend tests with `.venv/bin/python -m unittest discover -s Backend -p 'test_*.py'`.
These tests mock Gemini and do not consume API quota.

## Our Goal
Help people prepare for job interviews through personalized
practice across different roles, majors, and professions.

## How It Works
1. Enter your target role and experience level.
2. Optionally provide your résumé and a job description.
3. Choose guided practice or a realistic mock interview.
4. Answer questions by typing or speaking.
5. Receive feedback and suggestions for improvement.



## First Version
- Enter a target role and experience level.
- Answer five interview questions through text.
- Get feedback on your answers.
- See a final summary of strengths and areas to improve.

## Features to Add Later
- Résumé-based questions
- Voice interviews using ElevenLabs
- Hints and answer retries
- Follow-up questions based on user answers
- Elevator pitch
- Professional answer rephrasing
- Realistic Interview experience (presses tf outta u)
# Intraviewer
# Intraviewer

## Feedback narration

Add `ELEVENLABS_API_KEY=your_key` to `dotenv.env` and restart the backend.
Add **Jawhny — Warm, Professional, and Friendly** to My Voices in ElevenLabs.
The backend searches your voices for Jawhny. To select the exact voice (or if your
key lacks voice-list permissions), add `ELEVENLABS_VOICE_ID=the_voice_id` to
`dotenv.env` and restart. Copy the ID from the voice in ElevenLabs.

Guided feedback and the final review include a **Listen to feedback · Jawhny**
button. Final feedback automatically starts narration when ready; guided feedback
starts when you press Listen. Narration sends that feedback text to ElevenLabs
to generate audio
using its text-to-speech API (https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
The player supports pause, seek, and replay without generating audio again.
Moving on or restarting stops playback. Voice errors leave written feedback available.
API keys remain on the server. Audio stays in browser memory until you move on.

## Career preparation studio

The single-page studio now connects résumé review, typed pitch
practice, and adaptive interviews. Navigate directly with `#resume`,
`#pitch`, or `#interview`. Drafts and interview progress stay in memory while you
navigate; refreshing still clears them. There is no authentication or server-side
session storage. All AI actions use the existing server-side Gemini configuration.

- Résumé PDFs populate an editable text source. `/api/resume-review` returns
  grounded suggestions and before/after wording. Download exports the review as
  plain text, not a reformatted résumé PDF.
- `/api/pitch-review` reviews a typed introduction for a selected scenario and
  target duration. It does not record audio or assess vocal delivery.
- `/api/interview-followup` receives the conversation so far and probes incomplete
  answers, with at most two follow-ups per core question. All round responses
  reach guided/final coaching. Standard, behavioral, technical, and constructive
  high-pressure styles are available.
- Focus mode removes surrounding sections. Pause & leave returns to the document
  workspace without clearing the interview; select Interview to return.

The interface uses IBM Plex Sans with system fallbacks, CSS-only scroll motion,
reduced-motion support, keyboard navigation, and responsive stacked
workspaces. No frontend build step is needed.

## Immersive Mock Interview

Guided Practice returns immediate feedback in four sections: strongest point,
biggest improvement, an exact quote from the answer, and a suggested rewrite.
Select **Try this answer again** to edit your original response while referring
to the feedback. The revised attempt replaces that round in the final review.
`/api/answer-feedback` returns `strongest_point`, `biggest_improvement`,
`quoted_example`, and `suggested_rewrite`; other review endpoints retain their
existing response formats.

Select **Mock interview**, set the role and experience, and use **Join Interview**.
The pre-call panel offers a microphone input meter, a speaker test through the
existing ElevenLabs endpoint, and an optional local camera preview. The call uses
`Frontend/images/ivanthegoat.png` as the still Intra Ivan interviewer image.

Questions play automatically using the existing `createNarrator` service. Only
actual playback animates the image; captions use phrase estimates against the
MP3 playhead because the narration endpoint supplies no word alignment. Delivered
questions cannot replay. Failed or interrupted playback has a recovery action.

Answers use the existing browser SpeechRecognition implementation. Select
**Done Answering** to finalize and submit: pauses do not automatically submit.
Mute stops recognition; speech errors preserve finalized text and offer retry.
Text entry remains available in browsers without speech recognition. Camera
tracks are local, optional, and released when disabled, when the tab is hidden,
or when the call ends. This application does not record camera video.

End Interview preserves recorded turns and requests feedback, including for an
incomplete interview. `/api/feedback` accepts 1–15 turns with `mode: "mock"`;
the original five-answer contract and prompt remain unchanged for Guided Practice.
State is kept in browser memory, so reloading still clears the session.

The mock controller is isolated in `Frontend/mock-interview.js`. It reuses the
existing speech services and AI endpoints; no new provider or key is required.

Browser regression checks are in `tests/mock_browser.py`. They connect to a local
Chrome instance on debugging port 9223 and use a temporary local HTTP server,
fixture audio, simulated speech recognition, and Chrome fake camera/microphone
flags. They cover complete and early-ended interviews, contextual follow-ups,
failed submissions, audio recovery, no replay, cleanup, Guided Practice,
responsive layouts, and reduced motion. They do not verify live provider output
or real hardware. Manual verification should cover actual microphone dictation,
ElevenLabs audio, browser permissions and autoplay behavior on the target browser.

## Camera coaching (Mock Interview only)

Enable **Camera coaching · live tips + a review** and turn on the camera in
pre-call setup, or use **Camera tips on** in the call toolbar. Select **Calibrate**
and look comfortably toward the lens for three seconds. Calibration is personal
to that camera position; turning the camera or coaching off clears it.

The optional on-device coach looks for sustained framing problems, an absent
face, changes in calibrated head/iris direction, and repeated wrist/shoulder
movement. Short glances and gestures do not immediately prompt tips. Live cues
have a cooldown, and the post-interview review summarizes observed episodes.
Look-away estimates are not validated eye tracking. Movement may be deliberate
gesturing or camera movement, not necessarily fidgeting. No confidence, attention,
emotion, identity, or interview-ability score is inferred.

Pinned MediaPipe Tasks Vision 0.10.18 and versioned face/pose models are bundled
under `Frontend/vendor/mediapipe` (about 28 MB, including SIMD and non-SIMD WASM).
They load only when coaching and the camera are enabled. All frame inference
runs in a local worker; frames are released after processing and are never sent
to an API or saved. Only in-memory cue counts are retained for the review, kept
separate from Gemini answer feedback. Camera-off and hidden-tab intervals are
excluded. Model failure leaves the interview usable with an explicit retry hint.

`camera-signals.js` contains the calibrated heuristics, `camera-coach-worker.js`
runs the local models, and `camera-coach.js` manages the opt-in UI and summary.
Guided Practice retains its original workflow. `tests/camera_browser.py` checks
calibration, persistence thresholds, cue counts, actual local model loading and
frame inference, camera cleanup, and review/reset behavior. Use the same Chrome
fake-device and debugging setup as the other browser tests. Real-user gaze and
movement accuracy still require validation across cameras, lighting, glasses,
and individual movement patterns; these are optional rehearsal suggestions.
