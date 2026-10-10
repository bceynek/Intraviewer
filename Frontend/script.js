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

let questions = [];
let answers = [];
let currentQuestion = 0;
let interviewContext = {};
let mode = "mock";
let loadingQuestions = false;
let loadingAnswer = false;
let loadingFeedback = false;
let answerAccepted = false;

// Call the Python backend.
async function postJSON(url, data) {
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
  } catch {
    throw new Error(
      "Could not reach the server. Make sure the Python server is running."
    );
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

    questions = result.questions;
    answers = [];
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
  answerAccepted = false;

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
    loadingAnswer ||
    answerAccepted ||
    answerBox.value.trim() === "";
});

// Submit an answer.
submitButton.addEventListener("click", async function () {
  const answer = answerBox.value.trim();

  if (
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

  const entry = {
    question: questions[currentQuestion],
    answer: answer
  };

  if (mode === "mock") {
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

    answers.push({
      ...entry,
      feedback: feedback
    });

    answerAccepted = true;
    guidedFeedback.textContent = feedback;
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
