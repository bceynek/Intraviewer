"use strict";

const setupForm = document.getElementById("setup-form");
const interviewScreen = document.getElementById("interview-screen");
const questionText = document.getElementById("question-text");
const answerBox = document.getElementById("answer");
const submitButton = document.getElementById("submit-answer");
const resultsScreen = document.getElementById("results-screen");
const answersList = document.getElementById("answers-list");
const restartButton = document.getElementById("restart-button");
const modeSelect = document.getElementById("interview-mode");
const startButton = setupForm.querySelector('button[type="submit"]');
const resumeFile = document.getElementById("resume-file");
let resumeText = "";
const resumeStatus = document.getElementById("resume-status");
const clearResume = document.getElementById("clear-resume");
let uploadingResume = false;
let resumeReviewVersion = 0;

function invalidateResumeReview() {
  resumeReviewVersion++;
  document.getElementById("resume-review").textContent = "";
  document.getElementById("download-resume").hidden = true;
  document.getElementById("resume-empty").hidden = false;
  document.getElementById("resume-review-status").textContent = "";
  document.getElementById("review-resume").disabled = uploadingResume;
}

resumeFile.addEventListener("change", async () => {
  const file = resumeFile.files[0];
  if (!file || uploadingResume) return;
  if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 5000000) {
    resumeStatus.textContent = "Choose a PDF smaller than 5 MB. Your previous résumé was kept.";
    resumeFile.value = "";
    return;
  }
  uploadingResume = true;
  invalidateResumeReview();
  resumeFile.disabled = clearResume.disabled = true;
  startButton.disabled = true;
  resumeStatus.textContent = "Extracting résumé text…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const data = new FormData();
    data.append("resume", file);
    const response = await fetch("/api/resume", { method: "POST", body: data, signal: controller.signal });
    if (response.status === 404 || response.status === 405) {
      throw new Error("Restart the Python backend to enable résumé uploads.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not extract this PDF.");
    resumeText = result.resume_text;
    document.getElementById("resume-text").value = resumeText;
    resumeStatus.textContent = result.truncated
      ? "Résumé ready. Only the first 20,000 characters will be used."
      : "Résumé ready. It will be used to personalize your interview.";
  } catch (error) {
    resumeStatus.textContent = error.name === "AbortError"
      ? "Upload timed out. Try uploading your PDF again."
      : (error instanceof TypeError || error instanceof SyntaxError)
        ? "Could not reach the upload endpoint. Open http://127.0.0.1:8000 with Python running."
        : error.message;
    resumeFile.value = "";
  } finally {
    clearTimeout(timeout);
    uploadingResume = false;
    document.getElementById("review-resume").disabled = false;
    resumeFile.disabled = clearResume.disabled = false;
    startButton.disabled = loadingQuestions;
  }
});
clearResume.addEventListener("click", () => {
  resumeFile.value = resumeText = resumeStatus.textContent = "";
  document.getElementById("resume-text").value = "";
  invalidateResumeReview();
});
// Create feedback areas.
function createMessage(parent) {
  const element = document.createElement("p");
  element.setAttribute("role", "status");
  element.style.whiteSpace = "pre-wrap";
  parent.appendChild(element);
  return element;
}

const setupStatus = createMessage(setupForm);
const guidedFeedback = createMessage(interviewScreen);
const guidedSections = document.createElement("div");
guidedSections.className = "answer-feedback";
guidedSections.hidden = true;
guidedSections.setAttribute("aria-live", "polite");
guidedFeedback.after(guidedSections);

const answerFeedbackFields = [
  ["strongest_point", "Strongest point"],
  ["biggest_improvement", "Biggest improvement"],
  ["quoted_example", "Example from your answer"],
  ["suggested_rewrite", "Suggested rewrite"]
];

function renderAnswerFeedback(container, result) {
  container.replaceChildren();
  for (const [key, label] of answerFeedbackFields) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = label;
    const text = document.createElement(key === "quoted_example" ? "blockquote" : "p");
    text.textContent = result[key];
    section.append(heading, text);
    container.appendChild(section);
  }
  container.hidden = false;
}

const tryAnswerAgain = document.createElement("button");
tryAnswerAgain.type = "button";
tryAnswerAgain.className = "quiet";
tryAnswerAgain.textContent = "Try this answer again";
tryAnswerAgain.hidden = true;
interviewScreen.appendChild(tryAnswerAgain);

const nextButton = document.createElement("button");
nextButton.type = "button";
nextButton.hidden = true;
interviewScreen.appendChild(nextButton);

const feedbackHeading = document.createElement("h3");
feedbackHeading.textContent = "Your AI Feedback";

const feedbackText = document.createElement("p");
feedbackText.setAttribute("role", "status");
feedbackText.style.whiteSpace = "pre-wrap";

const retryButton = document.createElement("button");
retryButton.type = "button";
retryButton.textContent = "Retry Feedback";
retryButton.hidden = true;

resultsScreen.insertBefore(feedbackHeading, answersList);
resultsScreen.insertBefore(feedbackText, answersList);
resultsScreen.insertBefore(retryButton, answersList);

// Generated audio is reused for replay.
const narrators = [];
function createNarrator(feedback, kind = "feedback") {
  const panel = document.createElement("div");
  panel.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Listen to ${kind} · Jawhny`;
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.hidden = true;
  audio.setAttribute("aria-label", `${kind === "question" ? "Question" : "Feedback"} narration by Jawhny`);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const note = document.createElement("p");
  note.textContent = kind === "question"
    ? "Question text is sent to ElevenLabs for narration."
    : "Listen with Jawhny’s warm, professional, friendly voice. Feedback text is sent to ElevenLabs when you press Listen.";
  panel.append(button, audio, status, note);
  feedback.after(panel);
  let text = "", url = null, controller = null;
  const narrator = {
    audio, panel, status, button,
    start() { button.click(); },
    stop() {
      if (controller) controller.abort();
      controller = null;
      audio.pause();
      button.disabled = false;
      status.textContent = "";
    },
    set(value = "") {
      if (controller) controller.abort();
      controller = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (url) URL.revokeObjectURL(url);
      url = null;
      text = value;
      panel.hidden = !value;
      note.hidden = false;
      audio.hidden = true;
      button.hidden = false;
      button.disabled = false;
      status.textContent = "";
    }
  };
  narrators.push(narrator);
  audio.addEventListener("play", () => {
    narrators.forEach(other => { if (other !== narrator) other.audio.pause(); });
  });
  button.addEventListener("click", async () => {
    if (controller || !text) return;
    note.hidden = true;
    const pending = new AbortController();
    controller = pending;
    const timer = setTimeout(() => pending.abort(), 90000);
    button.disabled = true;
    status.textContent = "Preparing Jawhny’s narration…";
    try {
      const response = await fetch("/api/narrate", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text}), signal: pending.signal
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Narration unavailable. Restart the backend and try again.");
      }
      const blob = await response.blob();
      if (controller !== pending) return;
      if (!blob.type.startsWith("audio/")) throw new Error("No audio received. Try again.");
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.hidden = false;
      button.hidden = true;
      status.textContent = "";
      try { await audio.play(); }
      catch { if (controller === pending) status.textContent = `Press Play to hear the ${kind}.`; }
    } catch (error) {
      if (controller === pending) status.textContent = error.name === "AbortError"
        ? "Narration timed out. Please try again." : error.message;
    } finally {
      clearTimeout(timer);
      if (controller === pending) { controller = null; button.disabled = false; }
    }
  });
  return narrator;
}
const guidedNarrator = createNarrator(guidedFeedback);
const finalNarrator = createNarrator(feedbackText);
const questionNarrator = createNarrator(questionText, "question");
let questionVoicePaused = false;
const voiceLabel = document.createElement("label");
const questionVoice = document.createElement("input");
questionVoice.type = "checkbox";
questionVoice.checked = true;
questionVoice.style.width = "auto";
questionVoice.style.marginRight = "10px";
voiceLabel.append(questionVoice, "Read mock interview questions aloud · ElevenLabs");
questionText.before(voiceLabel);
questionVoice.addEventListener("change", () => {
  if (!questionVoice.checked) questionNarrator.stop();
  else { questionVoicePaused = false; narrateQuestion(); }
});
function narrateQuestion() {
  questionNarrator.set(mode === "mock" ? activePrompt : "");
  voiceLabel.hidden = mode !== "mock";
  if (mode === "mock" && questionVoice.checked && !questionVoicePaused) questionNarrator.start();
}

let questions = [];
let answers = [];
let currentQuestion = 0;
let interviewContext = {};
let mode = "mock";
let loadingQuestions = false;
let loadingAnswer = false;
let loadingFeedback = false;
let answerAccepted = false;
let conversation = [];
let roundTurns = [];
let activePrompt = "";

// Record audio and transcribe it through our server with Scribe v2.
const speechPanel = document.createElement("div");
speechPanel.className = "speech-controls";
const speechButton = document.createElement("button");
speechButton.type = "button";
speechButton.className = "quiet";
speechButton.textContent = "Start speaking";
speechButton.setAttribute("aria-pressed", "false");
const speechStatus = createMessage(speechPanel);
speechStatus.className = "help";
const speechPreview = document.createElement("p");
speechPreview.className = "help";
const speechNote = document.createElement("p");
speechNote.className = "help";
speechNote.textContent = "Live text uses browser speech recognition where supported and may be sent to its service. When recording stops, ElevenLabs Scribe v2 provides the final transcript. Maximum recording: 5 minutes.";
speechPanel.prepend(speechButton);
speechPanel.append(speechPreview, speechNote);
answerBox.after(speechPanel);
let recognition = null;
let speechStopping = false;
const speechAvailable = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
const speechReady = speechAvailable
  ? "Use your microphone or type your response."
  : "Speech-to-text is unavailable here. Try a supported browser on HTTPS or localhost, or type your response.";
speechStatus.textContent = speechReady;
speechNote.hidden = !speechAvailable;

function notifyDictation(type, error = "") {
  window.dispatchEvent(new CustomEvent("interview-dictation", {detail: {type, error}}));
}

function syncSpeechControls() {
  speechButton.disabled = !speechAvailable || speechStopping || answerBox.disabled || answerAccepted;
  submitButton.disabled = Boolean(recognition) || loadingAnswer || answerAccepted || !answerBox.value.trim();
}
function cancelDictation() {
  const previous = recognition;
  recognition = null; // Ignore late results from a previous question or session.
  speechStopping = false;
  if (previous) previous.abort();
  speechButton.textContent = "Start speaking";
  speechButton.setAttribute("aria-pressed", "false");
  speechPreview.textContent = "";
  speechStatus.textContent = speechReady;
  syncSpeechControls();
}
speechButton.addEventListener("click", async () => {
  if (recognition) { recognition.stop(); return; }
  if (!speechAvailable || loadingAnswer || answerAccepted || answerBox.disabled) return;
  narrators.forEach(narrator => narrator.stop());
  let stream, recorder, timer, timeout, liveRecognition;
  const originalAnswer = answerBox.value;
  let liveValue = originalAnswer, liveShown = false, liveCommitted = "";
  const stopLive = () => {
    const previous = liveRecognition;
    liveRecognition = null;
    if (previous) previous.abort();
  };
  const startLive = () => {
    const BrowserRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!BrowserRecognition) return;
    const live = new BrowserRecognition();
    liveRecognition = live;
    live.lang = "en-US";
    live.continuous = true;
    live.interimResults = true;
    live.onresult = event => {
      if (recognition !== session || liveRecognition !== live || speechStopping) return;
      // Stop updating the field if the user has edited it themselves.
      if (answerBox.value !== liveValue) { stopLive(); return; }
      const words = Array.from(event.results, result => result[0].transcript.trim()).join(" ");
      liveValue = [originalAnswer.trimEnd(), liveCommitted, words].filter(Boolean).join(" ").slice(0, answerBox.maxLength);
      answerBox.value = liveValue;
      liveShown = true;
      speechPreview.textContent = "Live draft · Scribe will finalize this when you stop.";
      notifyDictation("preview");
    };
    live.onerror = () => {
      stopLive();
      speechPreview.textContent = "Live preview unavailable. Your recording will still be transcribed when you stop.";
      notifyDictation("preview");
    };
    live.onend = () => {
      if (recognition !== session || liveRecognition !== live || speechStopping) return;
      liveCommitted = liveValue.slice(originalAnswer.trimEnd().length).trim();
      try { live.start(); } catch { stopLive(); }
    };
    try { live.start(); } catch { stopLive(); }
  };
  let cancelled = false, size = 0;
  const chunks = [];
  const controller = new AbortController();
  const release = () => {
    clearTimeout(timer);
    stopLive();
    stream?.getTracks().forEach(track => track.stop());
  };
  const session = {
    abort() {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      if (recorder?.state === "recording") recorder.stop();
      release();
    },
    stop() {
      if (speechStopping) return;
      speechStopping = true;
      stopLive();
      speechButton.textContent = "Transcribing…";
      speechStatus.textContent = "Scribe v2 is transcribing your recording…";
      syncSpeechControls();
      if (recorder?.state === "recording") recorder.stop();
    }
  };
  const finish = () => {
    release();
    clearTimeout(timeout);
    if (recognition !== session) return;
    recognition = null;
    speechStopping = false;
    speechButton.textContent = "Start speaking";
    speechButton.setAttribute("aria-pressed", "false");
    speechPreview.textContent = "";
    syncSpeechControls();
    notifyDictation("end");
  };
  const fail = error => {
    if (recognition !== session) return;
    speechStatus.textContent = error.name === "NotAllowedError"
      ? "Microphone access was denied. Allow access or type your answer."
      : error.name === "AbortError" ? "Transcription timed out. Please try again or type your answer."
      : error.message || "Recording failed. Please try again or type your answer.";
    notifyDictation("error", "transcription");
  };
  recognition = session;
  speechButton.textContent = "Stop recording";
  speechButton.setAttribute("aria-pressed", "true");
  speechStatus.textContent = "Requesting microphone access…";
  syncSpeechControls();
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }});
    if (cancelled || recognition !== session) { release(); return; }
    if (speechStopping) { finish(); return; }
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, {...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 64000});
    recorder.ondataavailable = event => {
      if (event.data.size) { chunks.push(event.data); size += event.data.size; }
      if (size >= 4500000 && !speechStopping) session.stop();
    };
    recorder.onerror = () => {
      session.abort();
      fail(new Error("Microphone recording failed. Please try again."));
      finish();
    };
    recorder.onstop = async () => {
      release();
      if (cancelled || recognition !== session) return;
      try {
        const blob = new Blob(chunks, {type: recorder.mimeType});
        if (!blob.size) throw new Error("No audio captured. Please try again.");
        if (blob.size > 5000000) throw new Error("Recording is too large. Please record a shorter answer.");
        const data = new FormData();
        const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
        data.append("audio", blob, `answer.${extension}`);
        timeout = setTimeout(() => controller.abort(), 90000);
        const response = await fetch("/api/transcribe", {method: "POST", body: data, signal: controller.signal});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Transcription failed. Please try again.");
        if (recognition !== session) return;
        if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech detected. Please try again.");
        const editedLiveDraft = liveShown && answerBox.value !== liveValue;
        const base = liveShown ? originalAnswer : answerBox.value;
        const combined = editedLiveDraft ? answerBox.value
          : [base.trimEnd(), result.text.trim()].filter(Boolean).join(" ");
        answerBox.value = combined.slice(0, answerBox.maxLength);
        speechStatus.textContent = editedLiveDraft ? "Your edited draft was preserved. Review it before submitting." : combined.length > answerBox.maxLength
          ? "Answer reached the character limit. Review your text before submitting."
          : "Transcription ready. Review your answer before submitting.";
        notifyDictation("result");
      } catch (error) { fail(error); }
      finally { finish(); }
    };
    recorder.start(1000);
    startLive();
    timer = setTimeout(() => session.stop(), 300000);
    speechStatus.textContent = "Recording… Stop when finished to transcribe your answer.";
    notifyDictation("start");
  } catch (error) { fail(error); finish(); }
});
new MutationObserver(syncSpeechControls).observe(answerBox, {attributes: true, attributeFilter: ["disabled"]});
window.addEventListener("pagehide", cancelDictation);
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelDictation(); });
narrators.forEach(narrator => narrator.audio.addEventListener("play", cancelDictation));
syncSpeechControls();

// Call the Python backend.
async function postJSON(url, data) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The request timed out. Your text is still here; please try again.");
    throw new Error(
      "Could not reach the server. Make sure the Python server is running."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (
    url.startsWith("/api/") &&
    (response.status === 404 || response.status === 405)
  ) {
    throw new Error(
      "This feature is not available on the running server. " +
      "Have the host save the updated Backend/main.py and restart " +
      "the Python server, then try again."
    );
  }

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Unexpected server response. Open this website through " +
      "the Python server on port 8000."
    );
  }

  if (!response.ok) {
    throw new Error(
      result.error || "The request failed. Please try again."
    );
  }

  return result;
}

function readFeedback(result) {
  if (
    typeof result.feedback !== "string" ||
    !result.feedback.trim()
  ) {
    throw new Error("No feedback received. Please try again.");
  }

  return result.feedback;
}

// Start an interview.
setupForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  if (loadingQuestions || uploadingResume) return;

  const roleInput = document.getElementById("role");
  const role = roleInput.value.trim();

  if (!role) {
    setupStatus.textContent = "Please enter a target role.";
    roleInput.focus();
    return;
  }

  interviewContext = {
    role: role,
    resume_text: resumeText.trim(),
    experience: document.getElementById("experience").value,
    style: document.getElementById("interview-style").value,
    job_description: document
      .getElementById("job-description")
      .value.trim()
  };

  mode = modeSelect.value;
  if (mode === "mock") {
    window.mockInterview.join(interviewContext);
    return;
  }

  loadingQuestions = true;
  startButton.disabled = true;
  startButton.textContent = "Creating Questions...";
  setupStatus.textContent = "Gemini is preparing your interview.";

  try {
    const result = await postJSON(
      "/api/questions",
      interviewContext
    );

    if (
      !Array.isArray(result.questions) ||
      result.questions.length !== 5 ||
      result.questions.some(function (question) {
        return (
          typeof question !== "string" ||
          !question.trim()
        );
      })
    ) {
      throw new Error(
        "Invalid questions received. Please try again."
      );
    }

    questionVoicePaused = false;
    questions = result.questions;
    answers = [];
    conversation = [];
    roundTurns = [];
    document.getElementById("transcript-copy").textContent = "";
    currentQuestion = 0;

    answersList.replaceChildren();
    feedbackText.textContent = "";
    retryButton.hidden = true;
    setupStatus.textContent = "";

    setupForm.hidden = true;
    resultsScreen.hidden = true;
    interviewScreen.hidden = false;

    interviewScreen.querySelector("h2").textContent =
      mode === "guided" ? "Guided Practice" : "Mock Interview";

    showQuestion();
  } catch (error) {
    setupStatus.textContent = error.message;
  } finally {
    loadingQuestions = false;
    startButton.disabled = false;
    startButton.textContent = "Start Practice";
  }
});

// Display one question.
function showQuestion() {
  guidedSections.hidden = true;
  guidedSections.replaceChildren();
  tryAnswerAgain.hidden = true;
  cancelDictation();
  guidedNarrator.set();
  answerAccepted = false;
  roundTurns = [];
  activePrompt = questions[currentQuestion];
  narrateQuestion();
  document.getElementById("transcript-copy").textContent = conversation.map(t => `INTERVIEWER\n${t.question}\n\nYOU\n${t.answer}`).join("\n\n—\n\n");
  document.getElementById("session-progress").textContent = `QUESTION ${currentQuestion + 1} / 5 · ${interviewContext.style.toUpperCase()}`;

  questionText.textContent =
    `Question ${currentQuestion + 1} of ${questions.length}: ` +
    questions[currentQuestion];

  answerBox.value = "";
  answerBox.hidden = false;
  answerBox.disabled = false;

  guidedFeedback.textContent = "";
  nextButton.hidden = true;
  submitButton.hidden = false;
  submitButton.disabled = true;

  if (mode === "guided") {
    submitButton.textContent = "Get Feedback";
  } else if (currentQuestion === questions.length - 1) {
    submitButton.textContent = "Finish Interview";
  } else {
    submitButton.textContent = "Submit Answer";
  }

  answerBox.focus();
}

answerBox.addEventListener("input", function () {
  submitButton.disabled =
    Boolean(recognition) ||
    loadingAnswer ||
    answerAccepted ||
    answerBox.value.trim() === "";
});

// Submit an answer.
submitButton.addEventListener("click", async function () {
  const answer = answerBox.value.trim();

  if (
    recognition ||
    loadingAnswer ||
    answerAccepted ||
    !answer ||
    currentQuestion >= questions.length
  ) {
    return;
  }

  if (answer.length > 10000) {
    guidedFeedback.textContent =
      "Please keep your answer to 10,000 characters or fewer.";
    return;
  }

  questionNarrator.stop();
  const turn = {question: activePrompt, answer};
  if (mode === "mock" && roundTurns.length < 2) {
    loadingAnswer = true;
    submitButton.disabled = answerBox.disabled = true;
    guidedFeedback.textContent = "Considering your response…";
    try {
      const result = await postJSON("/api/interview-followup", {
        ...interviewContext, history: [...conversation, turn]
      });
      if (typeof result.question !== "string") throw new Error("No valid follow-up received. Try again.");
      if (result.question.trim()) {
        conversation.push(turn);
        roundTurns.push(turn);
        activePrompt = result.question;
        narrateQuestion();
        questionText.textContent = result.question;
        document.getElementById("session-progress").textContent = `QUESTION ${currentQuestion + 1} / 5 · FOLLOW-UP ${roundTurns.length}`;
        document.getElementById("transcript-copy").textContent = conversation.map(t => `INTERVIEWER\n${t.question}\n\nYOU\n${t.answer}`).join("\n\n—\n\n");
        answerBox.value = "";
        guidedFeedback.textContent = "";
        return;
      }
    } catch (error) {
      guidedFeedback.textContent = error.message;
      return;
    } finally {
      loadingAnswer = false;
      answerBox.disabled = false;
      submitButton.disabled = !answerBox.value.trim();
      if (!interviewScreen.hidden) answerBox.focus();
    }
  }
  const entry = {
    question: questions[currentQuestion],
    answer: mode === "guided" ? answer : [...roundTurns, turn].map(t => `${t.question}\n${t.answer}`).join("\n\n")
  };

  if (mode === "mock") {
    conversation.push(turn);
    answers.push(entry);
    advanceQuestion();
    return;
  }

  loadingAnswer = true;
  submitButton.disabled = true;
  answerBox.disabled = true;
  guidedSections.hidden = true;
  guidedFeedback.textContent =
    "Gemini is reviewing your answer...";

  try {
    const result = await postJSON("/api/answer-feedback", {
      ...interviewContext,
      ...entry
    });

    if (answerFeedbackFields.some(([key]) => typeof result[key] !== "string" || !result[key].trim())) {
      throw new Error("Incomplete feedback received. Please try again.");
    }
    const feedback = answerFeedbackFields.map(([key, label]) => `${label}\n${result[key]}`).join("\n\n");
    conversation.push(turn);

    answers.push({
      ...entry,
      feedback: feedback,
      structuredFeedback: result
    });

    answerAccepted = true;
    guidedFeedback.textContent = "Feedback ready. Revise your answer or continue to the next question.";
    renderAnswerFeedback(guidedSections, result);
    guidedNarrator.set(feedback);
    submitButton.hidden = true;

    nextButton.textContent =
      currentQuestion === questions.length - 1
        ? "See Final Review"
        : "Next Question";

    nextButton.hidden = false;
    tryAnswerAgain.hidden = false;
    nextButton.focus();
  } catch (error) {
    guidedFeedback.textContent = error.message;
    submitButton.textContent = "Retry Feedback";
    answerBox.disabled = false;
  } finally {
    loadingAnswer = false;
    submitButton.disabled =
      answerAccepted || answerBox.value.trim() === "";
  }
});

tryAnswerAgain.addEventListener("click", () => {
  if (mode !== "guided" || !answerAccepted || loadingAnswer) return;
  // The revised attempt replaces this round in the final review.
  answers.pop();
  conversation.pop();
  answerAccepted = false;
  nextButton.hidden = tryAnswerAgain.hidden = true;
  guidedNarrator.set();
  guidedFeedback.textContent = "Edit your answer below using the feedback, then get a fresh review.";
  answerBox.disabled = false;
  submitButton.hidden = false;
  submitButton.textContent = "Get Feedback";
  syncSpeechControls();
  answerBox.focus();
});

nextButton.addEventListener("click", function () {
  if (!answerAccepted || loadingAnswer) return;
  advanceQuestion();
});

// Continue to the next question or results.
function advanceQuestion() {
  answerAccepted = false;
  nextButton.hidden = true;
  currentQuestion++;

  if (currentQuestion < questions.length) {
    showQuestion();
  } else {
    showResults();
    getFeedback();
  }
}

// Display the saved answers.
function showResults() {
  cancelDictation();
  questionNarrator.set();
  guidedNarrator.set();
  interviewScreen.hidden = true;
  resultsScreen.hidden = false;
  answersList.replaceChildren();

  answers.forEach(function (item, index) {
    const card = document.createElement("article");

    const heading = document.createElement("h3");
    heading.textContent = `Question ${index + 1}`;

    const question = document.createElement("p");
    question.textContent = item.question;

    const response = document.createElement("p");
    response.textContent = `Your answer: ${item.answer}`;
    response.style.whiteSpace = "pre-wrap";

    card.append(heading, question, response);

    if (item.structuredFeedback) {
      const feedback = document.createElement("div");
      feedback.className = "answer-feedback";
      renderAnswerFeedback(feedback, item.structuredFeedback);
      card.appendChild(feedback);
    } else if (item.feedback) {
      const feedback = document.createElement("p");
      feedback.textContent = item.feedback;
      feedback.style.whiteSpace = "pre-wrap";
      card.appendChild(feedback);
    }

    answersList.appendChild(card);
  });

  const heading = resultsScreen.querySelector("h2");
  heading.setAttribute("tabindex", "-1");
  heading.focus();
}

// Generate the final review.
async function getFeedback() {
  if (loadingFeedback) return;

  finalNarrator.set();
  loadingFeedback = true;
  retryButton.hidden = true;
  restartButton.disabled = true;
  feedbackText.textContent =
    "Gemini is preparing your final review...";

  try {
    const result = await postJSON("/api/feedback", {
      ...interviewContext,
      ...(mode === "mock" ? {mode: "mock"} : {}),
      answers: answers.map(function (item) {
        return {
          question: item.question,
          answer: item.answer
        };
      })
    });

    feedbackText.textContent = readFeedback(result);
    finalNarrator.set(feedbackText.textContent);
    finalNarrator.start();
  } catch (error) {
    feedbackText.textContent = error.message;
    retryButton.hidden = false;
  } finally {
    loadingFeedback = false;
    restartButton.disabled = false;
  }
}

retryButton.addEventListener("click", getFeedback);

// Start over.
restartButton.addEventListener("click", function () {
  if (loadingFeedback || loadingAnswer) return;

  cancelDictation();
  narrators.forEach(narrator => narrator.set());
  questions = [];
  answers = [];
  currentQuestion = 0;
  interviewContext = {};
  answerAccepted = false;

  answerBox.value = "";
  answerBox.disabled = false;
  answersList.replaceChildren();

  feedbackText.textContent = "";
  guidedFeedback.textContent = "";
  setupStatus.textContent = "";

  retryButton.hidden = true;
  nextButton.hidden = true;
  resultsScreen.hidden = true;
  interviewScreen.hidden = true;
  setupForm.hidden = false;

  document.getElementById("role").focus();
});

// Navigation changes visibility, never the contents of a workflow.
function routeToTool() {
  const name = location.hash.slice(1);
  if (name === "resume") {
    document.getElementById("profile").scrollIntoView();
  }
  document.querySelectorAll("nav a").forEach(link => {
    if (link.hash === location.hash) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", routeToTool);
routeToTool();
document.getElementById("resume-text").addEventListener("input", event => {
  resumeText = event.target.value;
  invalidateResumeReview();
});

function attachReview(formOrButton, endpoint, payload, statusId, resultId) {
  const trigger = document.getElementById(formOrButton);
  const isForm = trigger.tagName === "FORM";
  trigger.addEventListener(isForm ? "submit" : "click", async event => {
    event.preventDefault();
    const button = isForm ? trigger.querySelector('button[type="submit"]') : trigger;
    if (button.disabled) return;
    const status = document.getElementById(statusId);
    const output = document.getElementById(resultId);
    const data = payload();
    if (!(data.resume_text || data.pitch || "").trim()) {
      status.textContent = resultId === "resume-review"
        ? "Upload a résumé PDF first, then request a review."
        : "Add your text first, then request a review.";
      return;
    }
    button.disabled = true;
    const version = resumeReviewVersion;
    const isCurrent = () => resultId !== "resume-review" || version === resumeReviewVersion;
    status.textContent = "Reading your words carefully… This may take up to two minutes.";
    try {
      const result = await postJSON(endpoint, data);
      if (!isCurrent()) return;
      output.textContent = readFeedback(result);
      status.textContent = "Review ready. Your source text is unchanged.";
      if (resultId === "resume-review") {
        document.getElementById("resume-empty").hidden = true;
        document.getElementById("download-resume").hidden = false;
      }
    } catch (error) {
      if (isCurrent()) status.textContent = error.message;
    } finally {
      if (isCurrent()) button.disabled = false;
    }
  });
}
attachReview("review-resume", "/api/resume-review", () => ({resume_text: resumeText, role: document.getElementById("role").value.trim()}), "resume-review-status", "resume-review");
attachReview("pitch-form", "/api/pitch-review", () => ({pitch: document.getElementById("pitch-text").value.trim(), scenario: document.getElementById("pitch-scenario").value, duration: Number(document.getElementById("pitch-duration").value), role: document.getElementById("role").value.trim()}), "pitch-status", "pitch-review");
document.getElementById("pitch-text").addEventListener("input", event => {
  const words = event.target.value.trim().split(/\s+/).filter(Boolean).length;
  document.getElementById("pitch-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
});
document.getElementById("download-resume").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([document.getElementById("resume-review").textContent], {type: "text/plain;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url; link.download = "intraviewer-resume-review.txt"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const focusToggle = document.getElementById("focus-toggle");
focusToggle.addEventListener("click", () => {
  const enabled = document.body.classList.toggle("focus-mode");
  focusToggle.setAttribute("aria-pressed", String(enabled));
  focusToggle.textContent = enabled ? "Exit focus mode" : "Focus mode";
});
document.getElementById("exit-interview").addEventListener("click", () => {
  cancelDictation();
  document.body.classList.remove("focus-mode");
  focusToggle.setAttribute("aria-pressed", "false");
  focusToggle.textContent = "Focus mode";
  questionVoicePaused = true;
  narrators.forEach(narrator => narrator.stop());
  location.hash = "profile";
  document.getElementById("resume-heading").focus({preventScroll: true});
});
