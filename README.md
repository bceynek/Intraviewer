# Intraviewer

An integrated AI career preparation workspace: résumé and LinkedIn editing,
elevator pitch practice, and context-aware interview training. The homepage
leads directly into the tools, with shareable links for `#resume`, `#linkedin`,
`#pitch`, and `#interview`.

## Run locally

Use standard CPython 3.11 or newer. MSYS/MinGW Python is not supported by some
native dependencies of the Gemini SDK.

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe Backend/main.py
```

macOS / Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python Backend/main.py
```

Open **http://127.0.0.1:8000**. Python serves both the website and API; opening
`index.html` directly or through a static server will not run the AI tools.
Keep the terminal running; Ctrl+C stops the server.

For the current Windows workspace, an isolated verification runtime was
installed under the ignored `.tools` directory. It can also run the app:

```powershell
.\.tools\python\python.exe Backend/main.py
```

Create `dotenv.env` in the project root:

```dotenv
GEMINI_API_KEY=your_key
# Optional: override the existing default with a model available to your key.
# GEMINI_MODEL=your_available_model
```

The default remains `gemini-3.5-flash-lite`. The backend loads `dotenv.env`
regardless of the working directory. Restart after changing configuration.
Keep credentials in this ignored file, never in frontend JavaScript. Without
a key, the website works but AI requests return an actionable setup error.

## Preparation tools

- **Résumé:** upload a text-based PDF or paste/edit up to 20,000 characters.
  PDF limits are 5 MB and 20 pages. Scanned and password-protected files are not
  supported. Review clarity, contribution, relevance, and readable document
  structure. Inspect source excerpts beside suggested wording and requests for
  missing evidence. Preview the full revision, explicitly apply it, or export
  a plain-text draft. This does not preserve original PDF layout or export PDF.
- **LinkedIn:** paste up to 15,000 characters of headline, About, experience,
  and skills. Optional URL import uses only readable public metadata. Private
  or restricted content is not accessed; use pasted text when import is
  blocked. It uses the same editor and comparisons as résumé review.
- **Pitch:** choose a scenario and a 30-, 60-, or 90-second target. Receive
  wording and structure feedback, a fact-based revision, and a follow-up
  question. Type an expanded answer for further coaching. Length is explicitly
  estimated at 130 words per minute. Optional browser dictation produces a
  transcript; the AI never claims to evaluate vocal delivery from text.
- **Interview:** choose role, seniority, standard/behavioral/technical/high-pressure
  style, and mock or guided practice. Your résumé, profile, practiced pitch,
  and optional job description provide context. Each of five core questions
  can receive up to two adaptive follow-ups. The full conversation is included
  in subsequent questioning and the final review. Guided mode gives coaching
  after each answer. Focus mode can be exited with Escape. Ending early keeps
  your current nonempty response and generates a review of available answers.

The original five-question, single-answer feedback, résumé extraction,
LinkedIn import, and LinkedIn review APIs are retained.

## State and data

Drafts, reviews, interview context, and responses persist in `sessionStorage`
for the current browser tab, including through refresh. Navigation and tab
switching preserve progress. **Clear saved drafts** removes the preparation
content and session, and cancels pending requests. Individual document clear
buttons clear that source. An active interview uses a snapshot of the context
from when it began; restart to use changed materials.

The application does not store uploaded PDFs, professional materials, or
conversations on the server. Submitted content is sent to Gemini for the
requested coaching. Browser speech recognition may send audio to the browser's
speech service; only its transcript reaches the app. Speech support and
microphone permissions vary by browser. Typed input always remains available.

All model content is rendered as text. Reviews are checked so quoted source
excerpts actually occur in the submitted document. Prompts prohibit invented
accomplishments, metrics, qualifications, and arbitrary scores; users should
still inspect AI revisions before using them.

## Implementation

The frontend is semantic HTML, CSS, and vanilla JavaScript. There is no frontend
build step or production JavaScript dependency. Blue `#304DCE`, white surfaces,
locally served Manrope typography, thin rules, and asymmetrical editorial
compositions form the design system. Motion uses native CSS and
`IntersectionObserver`, with reduced-motion support and no scroll interception.
The font is distributed with its [SIL Open Font License](Frontend/fonts/OFL.txt).

The backend is Flask with the existing Google Gemini integration. AI business
logic, content bounds, schemas, and error handling stay on the server; keys are
never exposed to the frontend. There is no authentication system in this local
application. The server listens on loopback and is intended for development.

New endpoints:

| Endpoint                     | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `POST /api/profile-review`   | Structured source-linked résumé/LinkedIn suggestions and revised draft |
| `POST /api/pitch-review`     | Pitch feedback, revision, and follow-up question                       |
| `POST /api/pitch-followup`   | Coach an expanded response in context of the original pitch            |
| `POST /api/interview-turn`   | Evaluate full history and decide whether to ask a follow-up            |
| `POST /api/interview-review` | Review complete or early-ended interview history                       |

Requests show loading and error states; retries keep input intact. Follow-up
limits and input sizes are enforced server-side. Errors avoid exposing raw SDK
request details.

## Verification

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s Backend -p 'test_*.py'
node --check Frontend/script.js
```

On macOS/Linux use `.venv/bin/python`; for the current isolated Windows runtime
use `.\.tools\python\python.exe`.

Backend tests mock Gemini and do not consume API quota. They cover existing
endpoints, PDF extraction, restricted LinkedIn imports, source matching,
conversation history, bounded follow-ups, guided coaching, pitch feedback,
input validation, and safe error responses. Browser QA uses test API responses
to exercise workflows and exports. Actual AI output requires a configured key
and is not validated by mocked tests.
