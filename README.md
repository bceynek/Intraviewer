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
- Linked in checker
- Elevator pitch
- Professional answer rephrasing
- Realistic Interview experience (presses tf outta u)
- Teaches Linkedin Speak
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
