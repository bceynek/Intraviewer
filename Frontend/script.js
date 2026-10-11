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

resumeFile.addEventListener("change", async () => {
  const file = resumeFile.files[0];
  if (!file || uploadingResume) return;
  if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 5000000) {
    resumeStatus.textContent = "Choose a PDF smaller than 5 MB. Your previous résumé was kept.";
    resumeFile.value = "";
    return;
  }
  uploadingResume = true;
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
    resumeFile.disabled = clearResume.disabled = false;
    startButton.disabled = loadingQuestions || linkedInBusy;
  }
});
clearResume.addEventListener("click", () => {
  resumeFile.value = resumeText = resumeStatus.textContent = "";
  document.getElementById("resume-text").value = "";
  document.getElementById("resume-review").textContent = "";
  document.getElementById("download-resume").hidden = true;
  document.getElementById("resume-empty").hidden = false;
  document.getElementById("resume-review-status").textContent = "";
});
const linkedInReview = document.getElementById("review-linkedin");
const linkedInText = document.getElementById("linkedin-text");
const linkedInStatus = document.getElementById("linkedin-status");
const linkedInResult = document.getElementById("linkedin-review");
let linkedInBusy = false;

async function reviewLinkedIn() {
  if (linkedInBusy || loadingQuestions || uploadingResume) return;
  if (!linkedInText.value.trim()) {
    linkedInStatus.textContent = "Paste your profile text first.";
    return;
  }
  linkedInBusy = true;
  linkedInReview.disabled = startButton.disabled = true;
  linkedInText.disabled = true;
  linkedInStatus.textContent = "Reviewing your profile… This may take up to two minutes.";
  linkedInResult.textContent = "";
  try {
    const result = await postJSON("/api/linkedin-review", {
      linkedin_text: linkedInText.value.trim(),
      role: document.getElementById("role").value.trim()
    });
    linkedInResult.textContent = readFeedback(result);
    linkedInStatus.textContent = "Profile review ready.";
  } catch (error) {
    linkedInStatus.textContent = error.message;
  } finally {
    linkedInBusy = false;
    linkedInReview.disabled = startButton.disabled = false;
    linkedInText.disabled = false;
  }
}
linkedInReview.addEventListener("click", reviewLinkedIn);

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
    audio,
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

// Dictation appends finalized speech; unfinished words stay in a separate preview.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
speechNote.textContent = "Speak in English, then stop to review and submit. Your browser may send audio to its transcription service.";
const voiceControls = document.createElement("div");
voiceControls.className = "interview-voice-controls";
const questionVoicePanel = questionNarrator.audio.parentElement;
questionVoicePanel.before(voiceControls);
voiceControls.append(questionVoicePanel, speechButton);
speechPanel.append(speechPreview, speechNote);
answerBox.after(speechPanel);
let recognition = null;
let speechStopping = false;
const speechAvailable = Boolean(SpeechRecognition) && window.isSecureContext;
const speechReady = speechAvailable
  ? "Use your microphone or type your response."
  : "Speech-to-text is unavailable here. Try a supported browser on HTTPS or localhost, or type your response.";
speechStatus.textContent = speechReady;
speechNote.hidden = !speechAvailable;

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
speechButton.addEventListener("click", () => {
  if (recognition) {
    speechStopping = true;
    speechButton.textContent = "Stopping…";
    speechStatus.textContent = "Finishing transcription…";
    syncSpeechControls();
    recognition.stop();
    return;
  }
  if (!speechAvailable || loadingAnswer || answerAccepted || answerBox.disabled) return;
  narrators.forEach(narrator => narrator.stop());
  const session = new SpeechRecognition();
  session.lang = "en-US";
  session.continuous = true;
  session.interimResults = true;
  recognition = session;
  let failed = false;
  let limitReached = false;
  speechButton.textContent = "Stop recording";
  speechButton.setAttribute("aria-pressed", "true");
  speechStatus.textContent = "Requesting microphone access…";
  syncSpeechControls();
  session.onstart = () => {
    if (recognition === session && !speechStopping) speechStatus.textContent = "Listening… Speak your response, then select Stop recording.";
  };
  session.onresult = event => {
    if (recognition !== session) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const text = result[0].transcript.trim();
        const combined = answerBox.value + (answerBox.value && !/\s$/.test(answerBox.value) ? " " : "") + text;
        answerBox.value = combined.slice(0, answerBox.maxLength);
        if (combined.length >= answerBox.maxLength) limitReached = true;
      } else {
        interim += result[0].transcript;
      }
    }
    speechPreview.textContent = interim ? `Hearing: ${interim}` : "";
    syncSpeechControls();
    if (limitReached && !speechStopping) {
      speechStopping = true;
      syncSpeechControls();
      session.stop();
    }
  };
  session.onerror = event => {
    if (recognition !== session) return;
    failed = true;
    const messages = {
      "not-allowed": "Microphone access was denied. Allow it in your browser settings, or type your response.",
      "service-not-allowed": "Speech recognition is blocked by your browser. You can still type your response.",
      "audio-capture": "No microphone is available. Connect one and try again, or type your response.",
      "network": "The transcription service could not connect. Check your connection and try again.",
      "no-speech": "No speech was detected. Select Start speaking to try again."
    };
    speechStatus.textContent = messages[event.error] || "Speech recognition stopped. You can try again or type your response.";
  };
  session.onend = () => {
    if (recognition !== session) return;
    recognition = null;
    speechStopping = false;
    speechButton.textContent = "Start speaking";
    speechButton.setAttribute("aria-pressed", "false");
    speechPreview.textContent = "";
    if (!failed) speechStatus.textContent = limitReached
      ? "Response reached the 10,000-character limit. Review your text before submitting."
      : "Recording stopped. Review your response, or select Start speaking to add more.";
    syncSpeechControls();
  };
  try { session.start(); }
  catch {
    cancelDictation();
    speechStatus.textContent = "Could not start the microphone. Try again or type your response.";
  }
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

  if (loadingQuestions || linkedInBusy || uploadingResume) return;

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
    linkedin_text: linkedInText.value.trim(),
    experience: document.getElementById("experience").value,
    style: document.getElementById("interview-style").value,
    job_description: document
      .getElementById("job-description")
      .value.trim()
  };

  mode = modeSelect.value;

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
  if (roundTurns.length < 2) {
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
    answer: [...roundTurns, turn].map(t => `${t.question}\n${t.answer}`).join("\n\n")
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
  guidedFeedback.textContent =
    "Gemini is reviewing your answer...";

  try {
    const result = await postJSON("/api/answer-feedback", {
      ...interviewContext,
      ...entry
    });

    const feedback = readFeedback(result);
    conversation.push(turn);

    answers.push({
      ...entry,
      feedback: feedback
    });

    answerAccepted = true;
    guidedFeedback.textContent = feedback;
    guidedNarrator.set(feedback);
    submitButton.hidden = true;

    nextButton.textContent =
      currentQuestion === questions.length - 1
        ? "See Final Review"
        : "Next Question";

    nextButton.hidden = false;
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

    if (item.feedback) {
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
const profileTabs = [document.getElementById("resume-tab"), document.getElementById("linkedin-tab")];
function selectProfile(name, focus = false) {
  profileTabs.forEach((tab, index) => {
    const selected = (name === "linkedin") === (index === 1);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}
profileTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectProfile(index ? "linkedin" : "resume"));
  tab.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectProfile(event.key === "Home" ? "resume" : event.key === "End" ? "linkedin" : index ? "resume" : "linkedin", true);
    }
  });
});
function routeToTool() {
  const name = location.hash.slice(1);
  if (name === "resume" || name === "linkedin") {
    selectProfile(name);
    document.getElementById("profile").scrollIntoView();
  }
  document.querySelectorAll("nav a").forEach(link => {
    if (link.hash === location.hash) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", routeToTool);
routeToTool();
document.getElementById("resume-text").addEventListener("input", event => { resumeText = event.target.value; });

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
    status.textContent = "Reading your words carefully… This may take up to two minutes.";
    try {
      output.textContent = readFeedback(await postJSON(endpoint, data));
      status.textContent = "Review ready. Your source text is unchanged.";
      if (resultId === "resume-review") {
        document.getElementById("resume-empty").hidden = true;
        document.getElementById("download-resume").hidden = false;
      }
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
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
  document.getElementById("resume-tab").focus({preventScroll: true});
});
