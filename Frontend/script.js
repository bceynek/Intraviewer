"use strict";

const $ = (id) => document.getElementById(id);
const storageKey = "intraviewer.workspace.v2";
const fieldIds = [
  "resume-text",
  "linkedin-text",
  "linkedin-url",
  "profile-role",
  "role",
  "experience",
  "job-description",
  "interview-style",
  "interview-mode",
  "pitch-text",
  "pitch-scenario",
  "pitch-duration",
];
const emptySession = () => ({
  phase: "setup",
  questions: [],
  history: [],
  index: 0,
  followUps: 0,
  prompt: "",
  draft: "",
  context: {},
  mode: "mock",
  pendingTurn: null,
  guidance: "",
  feedback: "",
});
let session = emptySession();
let activeDocument = "resume";
let reviews = { resume: null, linkedin: null };
let pitchReview = null;
let pitchInputMode = "typed";
let documentBusy = false,
  uploadBusy = false,
  importBusy = false,
  pitchBusy = false,
  interviewBusy = false;
let reviewController,
  uploadController,
  importController,
  pitchController,
  interviewController;
let recognition = null,
  speechTarget = null;
let saveTimer;

function status(id, message = "", kind = "") {
  const target = $(id);
  target.textContent = message;
  target.dataset.error = String(kind === "error");
  target.dataset.busy = String(kind === "busy");
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function action(text, callback, className = "text-button") {
  const button = node("button", text, className);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}
function save() {
  try {
    const fields = Object.fromEntries(fieldIds.map((id) => [id, $(id).value]));
    session.draft = $("answer").value;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        fields,
        session,
        reviews,
        pitchReview,
        activeDocument,
        pitchInputMode,
      }),
    );
  } catch {
    /* Private browsing or full storage must not interrupt practice. */
  }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (!saved) return;
    for (const id of fieldIds)
      if (typeof saved.fields?.[id] === "string")
        $(id).value = saved.fields[id];
    if (
      ["setup", "active", "results"].includes(saved.session?.phase) &&
      Array.isArray(saved.session?.history) &&
      Array.isArray(saved.session?.questions)
    ) {
      session = { ...emptySession(), ...saved.session };
      if (
        session.phase === "active" &&
        (session.questions.length !== 5 || !session.prompt || session.index > 4)
      )
        session = emptySession();
    }
    if (saved.reviews && typeof saved.reviews === "object")
      reviews = saved.reviews;
    activeDocument =
      saved.activeDocument === "linkedin" ? "linkedin" : "resume";
    pitchReview = saved.pitchReview || null;
    pitchInputMode =
      saved.pitchInputMode === "speech_transcript"
        ? "speech_transcript"
        : "typed";
  } catch {
    session = emptySession();
  }
}
async function request(
  url,
  data,
  controller = new AbortController(),
  multipart = false,
) {
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    multipart ? 30000 : 150000,
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      ...(multipart ? {} : { headers: { "Content-Type": "application/json" } }),
      body: multipart ? data : JSON.stringify(data),
      signal: controller.signal,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "The server returned an unexpected response. Please try again.",
      );
    }
    if (!response.ok)
      throw new Error(
        result.error || "The request could not be completed. Please try again.",
      );
    return result;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason !== "timeout")
      throw error;
    if (controller.signal.aborted)
      throw new Error(
        "This request took too long. Your input is still here; please try again.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not connect. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function canceled(controller) {
  return controller?.signal.aborted && controller.signal.reason !== "timeout";
}
function download(text, filename) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = node("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied ✓";
  } catch {
    button.textContent = "Use Download to save the text";
  }
}
function updateCounts() {
  $("resume-count").textContent =
    `${$("resume-text").value.length.toLocaleString()} / 20,000 characters`;
  $("linkedin-count").textContent =
    `${$("linkedin-text").value.length.toLocaleString()} / 15,000 characters`;
  const words = $("pitch-text")
    .value.trim()
    .split(/\s+/)
    .filter(Boolean).length;
  $("pitch-length").textContent =
    `${words} words · estimated ${Math.round((words / 130) * 60)} sec`;
  const available = [];
  if ($("resume-text").value.trim()) available.push("résumé");
  if ($("linkedin-text").value.trim()) available.push("LinkedIn profile");
  if ($("pitch-text").value.trim()) available.push("practiced introduction");
  $("context-summary").textContent = available.length
    ? `Your ${available.join(" and ")} will inform the questions and feedback.`
    : "Add a résumé or LinkedIn profile above for a more personal interview.";
}

// Document types share the editor framework while retaining separate input and reviews.
function selectDocument(kind, moveFocus = false) {
  activeDocument = kind;
  for (const name of ["resume", "linkedin"]) {
    $(name + "-panel").hidden = name !== kind;
    $(name + "-tab").setAttribute("aria-selected", String(name === kind));
    $(name + "-tab").tabIndex = name === kind ? 0 : -1;
  }
  $("review-document").textContent =
    kind === "resume" ? "Review résumé ↗" : "Review LinkedIn ↗";
  $("review-document").disabled = documentBusy || uploadBusy || importBusy;
  status(
    "review-status",
    documentBusy ? "A document review is in progress…" : "",
    documentBusy ? "busy" : "",
  );
  renderDocumentReview();
  if (moveFocus) $(kind + "-tab").focus();
  if (document.querySelector('nav a[data-nav="profile"][aria-current]')) {
    for (const link of document.querySelectorAll('nav a[data-nav="profile"]')) {
      if (link.getAttribute("href") === "#" + kind)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }
  scheduleSave();
}
for (const kind of ["resume", "linkedin"]) {
  $(kind + "-tab").addEventListener("click", () => {
    selectDocument(kind);
    history.replaceState(null, "", "#" + kind);
  });
  $(kind + "-tab").addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectDocument(
        event.key === "Home"
          ? "resume"
          : event.key === "End"
            ? "linkedin"
            : activeDocument === "resume"
              ? "linkedin"
              : "resume",
        true,
      );
    }
  });
  $("clear-" + kind).addEventListener("click", () => {
    $(kind + "-text").value = "";
    reviews[kind] = null;
    if (kind === "resume") $("resume-file").value = "";
    else $("linkedin-url").value = "";
    status(kind + "-status");
    status("review-status");
    renderDocumentReview();
    updateCounts();
    save();
    $(kind + "-text").focus();
  });
}
function renderDocumentReview() {
  const container = $("document-review");
  container.replaceChildren();
  const review = reviews[activeDocument];
  $("review-empty").hidden = !!review;
  if (!review) return;
  const stale =
    review.source !== $(activeDocument + "-text").value.trim() ||
    review.role !== $("profile-role").value.trim();
  if (stale)
    container.append(
      node(
        "p",
        "Your source or target role has changed. This review refers to the previous draft; review again for updated suggestions.",
        "evidence-note",
      ),
    );
  container.append(
    node("p", review.result.summary, "review-summary"),
    node("h4", "What’s working", "review-section-label"),
  );
  const strengths = node("ul", undefined, "review-strengths");
  for (const strength of review.result.strengths)
    strengths.append(node("li", strength));
  container.append(
    strengths,
    node("h4", "Where to sharpen it", "review-section-label"),
  );
  for (const [index, suggestion] of review.result.suggestions.entries()) {
    const article = node("article", undefined, "suggestion");
    article.append(
      node(
        "h4",
        `${String(index + 1).padStart(2, "0")} / ${suggestion.section}`,
      ),
      node("p", "ORIGINAL", "comparison-label"),
      node(
        "p",
        suggestion.original || "Not included in the supplied text.",
        "original-text",
      ),
      node("p", "SUGGESTED", "comparison-label"),
      node("p", suggestion.suggested, "suggested-text"),
      node("p", suggestion.rationale, "rationale"),
    );
    if (suggestion.evidence_needed)
      article.append(
        node(
          "p",
          "Add evidence: " + suggestion.evidence_needed,
          "evidence-note",
        ),
      );
    container.append(article);
  }
  const revision = node("details", undefined, "revision-preview");
  revision.append(
    node("summary", "Inspect the full revised draft"),
    node("pre", review.result.improved_text),
  );
  container.append(revision);
  const kind = activeDocument;
  const exportRow = node("div", undefined, "review-export");
  const apply = action(
    "Use revised draft ↗",
    () => {
      if (review.source !== $(kind + "-text").value.trim()) {
        status(
          "review-status",
          "Your source changed. Review it again before applying a revision.",
          "error",
        );
        return;
      }
      const max = kind === "resume" ? 20000 : 15000;
      if (review.result.improved_text.length > max) {
        status(
          "review-status",
          "The revision is too long for the editor. Download it and shorten it before pasting.",
          "error",
        );
        return;
      }
      $(kind + "-text").value = review.result.improved_text;
      reviews[kind] = null;
      updateCounts();
      renderDocumentReview();
      save();
      status(
        "review-status",
        "Revised draft applied. Check every detail before using it.",
      );
    },
    "outline-button",
  );
  apply.disabled = stale;
  exportRow.append(
    apply,
    action("Download .txt ↓", () =>
      download(review.result.improved_text, `intraviewer-${kind}-draft.txt`),
    ),
  );
  container.append(exportRow);
}
$("review-document").addEventListener("click", async () => {
  if (documentBusy || uploadBusy || importBusy) return;
  const kind = activeDocument,
    source = $(kind + "-text").value.trim(),
    role = $("profile-role").value.trim();
  if (!source) {
    status(
      "review-status",
      `Add your ${kind === "resume" ? "résumé" : "profile"} text first.`,
      "error",
    );
    $(kind + "-text").focus();
    return;
  }
  documentBusy = true;
  const controller = (reviewController = new AbortController());
  $("review-document").disabled = true;
  $(kind + "-text").disabled = $("clear-" + kind).disabled = true;
  status(
    "review-status",
    "Reading your document and preparing specific suggestions…",
    "busy",
  );
  try {
    const result = await request(
      "/api/profile-review",
      { kind, text: source, role },
      controller,
    );
    if (
      !Array.isArray(result.suggestions) ||
      !Array.isArray(result.strengths) ||
      !result.improved_text ||
      !result.summary
    )
      throw new Error("The review was incomplete. Please try again.");
    reviews[kind] = { source, role, result };
    renderDocumentReview();
    save();
    status(
      "review-status",
      `${kind === "resume" ? "Résumé" : "Profile"} review ready. Inspect the suggestions before applying them.`,
    );
  } catch (error) {
    if (!canceled(controller)) status("review-status", error.message, "error");
  } finally {
    documentBusy = false;
    $("review-document").disabled = uploadBusy || importBusy;
    $(kind + "-text").disabled = $("clear-" + kind).disabled = false;
  }
});
$("resume-file").addEventListener("change", async () => {
  const file = $("resume-file").files[0];
  if (!file || uploadBusy || documentBusy) return;
  if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 5000000) {
    status(
      "resume-status",
      "Choose a PDF smaller than 5 MB. Your existing text was kept.",
      "error",
    );
    $("resume-file").value = "";
    return;
  }
  uploadBusy = true;
  const controller = (uploadController = new AbortController());
  for (const id of [
    "resume-file",
    "resume-text",
    "clear-resume",
    "review-document",
  ])
    $(id).disabled = true;
  status("resume-status", "Extracting your résumé text…", "busy");
  try {
    const data = new FormData();
    data.append("resume", file);
    const result = await request("/api/resume", data, controller, true);
    if (typeof result.resume_text !== "string")
      throw new Error("No résumé text was returned.");
    $("resume-text").value = result.resume_text;
    reviews.resume = null;
    updateCounts();
    renderDocumentReview();
    save();
    status(
      "resume-status",
      result.truncated
        ? "Imported the first 20,000 characters. Review and shorten if needed."
        : `${file.name} imported. Check the extracted text before reviewing.`,
    );
  } catch (error) {
    if (!canceled(controller))
      status(
        "resume-status",
        error.message + " Your existing text was kept.",
        "error",
      );
  } finally {
    uploadBusy = false;
    for (const id of [
      "resume-file",
      "resume-text",
      "clear-resume",
      "review-document",
    ])
      $(id).disabled = false;
    $("resume-file").value = "";
  }
});
$("import-linkedin").addEventListener("click", async () => {
  if (importBusy || documentBusy) return;
  const url = $("linkedin-url").value.trim();
  if (!url || !$("linkedin-url").checkValidity()) {
    status(
      "linkedin-status",
      "Enter a valid public LinkedIn profile URL, or paste your text below.",
      "error",
    );
    return;
  }
  importBusy = true;
  const controller = (importController = new AbortController());
  for (const id of [
    "import-linkedin",
    "linkedin-text",
    "clear-linkedin",
    "review-document",
  ])
    $(id).disabled = true;
  status("linkedin-status", "Checking the publicly available profile…", "busy");
  try {
    const result = await request(
      "/api/linkedin",
      { linkedin_url: url },
      controller,
    );
    if (typeof result.linkedin_text !== "string")
      throw new Error(
        "No public profile text was returned. Paste your text below.",
      );
    $("linkedin-text").value = result.linkedin_text;
    reviews.linkedin = null;
    updateCounts();
    renderDocumentReview();
    save();
    status(
      "linkedin-status",
      "Public profile text imported. Check it and add any missing sections before review.",
    );
  } catch (error) {
    if (!canceled(controller))
      status("linkedin-status", error.message, "error");
  } finally {
    importBusy = false;
    for (const id of [
      "import-linkedin",
      "linkedin-text",
      "clear-linkedin",
      "review-document",
    ])
      $(id).disabled = false;
  }
});

function renderPitchReview() {
  const container = $("pitch-review");
  container.replaceChildren();
  if (!pitchReview) return;
  if (pitchReview.source !== $("pitch-text").value.trim())
    container.append(
      node(
        "p",
        "Your pitch has changed. This feedback refers to your previous draft.",
        "evidence-note",
      ),
    );
  const result = pitchReview.result;
  container.append(
    node("h3", "What to sharpen"),
    node("p", result.feedback),
    node("h3", "A more focused introduction"),
    node("p", result.refined_pitch, "pitch-refined"),
  );
  const use = action("Practice this version ↗", () => {
    $("pitch-text").value = result.refined_pitch;
    pitchInputMode = "typed";
    pitchReview = null;
    renderPitchReview();
    updateCounts();
    save();
    $("pitch-text").focus();
  });
  const copyButton = action("Copy revised pitch", () =>
    copy(result.refined_pitch, copyButton),
  );
  container.append(
    use,
    copyButton,
    action("Download .txt ↓", () =>
      download(result.refined_pitch, "intraviewer-pitch.txt"),
    ),
  );
  const followUp = node("div", undefined, "pitch-follow-up");
  followUp.append(
    node("h3", "Now go one question deeper"),
    node("p", result.follow_up_question),
  );
  const currentReview = pitchReview;
  const form = node("form");
  form.id = "pitch-followup-form";
  const label = node("label", "Expand on your introduction", "editor-label");
  label.htmlFor = "pitch-followup-answer";
  const answer = node("textarea");
  answer.id = "pitch-followup-answer";
  answer.maxLength = 5000;
  answer.rows = 4;
  answer.required = true;
  answer.placeholder = "Answer with a specific example from your experience.";
  answer.value = currentReview.followUpDraft || "";
  answer.addEventListener("input", () => {
    currentReview.followUpDraft = answer.value;
    scheduleSave();
  });
  const submit = node("button", "Review this response ↗", "outline-button");
  submit.type = "submit";
  const feedback = node(
    "p",
    currentReview.followUpFeedback || "",
    "guided-feedback",
  );
  form.append(label, answer, submit, feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pitchBusy || !answer.value.trim()) return;
    setPitchBusy(true);
    const controller = (pitchController = new AbortController());
    status(
      "pitch-status",
      "Reviewing how you expanded on your introduction…",
      "busy",
    );
    try {
      const response = await request(
        "/api/pitch-followup",
        {
          pitch: currentReview.source,
          question: result.follow_up_question,
          answer: answer.value.trim(),
          role: $("profile-role").value.trim(),
        },
        controller,
      );
      if (typeof response.feedback !== "string" || !response.feedback.trim())
        throw new Error("The feedback was incomplete. Please retry.");
      if (pitchReview !== currentReview) return;
      currentReview.followUpFeedback = response.feedback;
      feedback.textContent = response.feedback;
      status(
        "pitch-status",
        "Follow-up review ready. Refine your example and try again.",
      );
      save();
    } catch (error) {
      if (!canceled(controller)) status("pitch-status", error.message, "error");
    } finally {
      setPitchBusy(false);
    }
  });
  followUp.append(
    form,
    action("Take it to the interview ↗", () => navigate("#interview")),
  );
  container.append(followUp);
}
function setPitchBusy(busy) {
  pitchBusy = busy;
  for (const control of document.querySelectorAll(
    "#pitch-form button, #pitch-form textarea, #pitch-form select, #pitch-review button, #pitch-review textarea",
  ))
    control.disabled = busy;
}
$("pitch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pitchBusy) return;
  stopSpeech();
  const source = $("pitch-text").value.trim();
  if (!source) {
    status("pitch-status", "Write your introduction first.", "error");
    return;
  }
  setPitchBusy(true);
  const controller = (pitchController = new AbortController());
  const button = $("pitch-form").querySelector('[type="submit"]');
  button.disabled = true;
  $("pitch-text").disabled =
    $("clear-pitch").disabled =
    $("dictate-pitch").disabled =
      true;
  status(
    "pitch-status",
    "Reviewing the structure, clarity, and relevance of your words…",
    "busy",
  );
  try {
    const result = await request(
      "/api/pitch-review",
      {
        pitch: source,
        scenario: $("pitch-scenario").value,
        duration: Number($("pitch-duration").value),
        role: $("profile-role").value.trim(),
        input_mode: pitchInputMode,
      },
      controller,
    );
    if (!result.feedback || !result.refined_pitch || !result.follow_up_question)
      throw new Error("The pitch feedback was incomplete. Please try again.");
    pitchReview = { source, result };
    renderPitchReview();
    save();
    status(
      "pitch-status",
      "Your pitch review is ready. Read it, revise, and practice again.",
    );
  } catch (error) {
    if (!canceled(controller)) status("pitch-status", error.message, "error");
  } finally {
    setPitchBusy(false);
    button.disabled = false;
    $("pitch-text").disabled =
      $("clear-pitch").disabled =
      $("dictate-pitch").disabled =
        false;
  }
});
$("clear-pitch").addEventListener("click", () => {
  stopSpeech();
  $("pitch-text").value = "";
  pitchReview = null;
  pitchInputMode = "typed";
  renderPitchReview();
  status("pitch-status");
  updateCounts();
  save();
  $("pitch-text").focus();
});

// The session retains every core answer and follow-up, including across navigation.
function background() {
  return {
    role: $("role").value.trim(),
    experience: $("experience").value,
    job_description: $("job-description").value.trim(),
    resume_text: $("resume-text").value.trim(),
    linkedin_text: $("linkedin-text").value.trim(),
    pitch_text: $("pitch-text").value.trim(),
    style: $("interview-style").value,
  };
}
function setFocusMode(enabled) {
  document.body.classList.toggle("is-focused", enabled);
  for (const element of document.querySelectorAll(
    "main > section, main > footer",
  )) {
    if (element.id !== "interview") element.inert = enabled;
  }
  $("interview-title").closest(".section-intro").inert = enabled;
  $("focus-toggle").setAttribute("aria-pressed", String(enabled));
  $("focus-toggle").textContent = enabled
    ? "Exit focus mode ↙"
    : "Focus mode ↗";
  if (enabled) $("question-text").focus({ preventScroll: true });
}
$("focus-toggle").addEventListener("click", () =>
  setFocusMode(!document.body.classList.contains("is-focused")),
);
function renderTranscript(target) {
  target.replaceChildren();
  session.history.forEach((entry, index) => {
    const article = node("article");
    article.append(
      node("h4", `RESPONSE ${String(index + 1).padStart(2, "0")}`),
      node("p", entry.question),
      node("p", entry.answer),
    );
    target.append(article);
  });
}
function renderSession(focus = false) {
  $("setup-form").hidden = session.phase !== "setup";
  $("interview-screen").hidden = session.phase !== "active";
  $("results-screen").hidden = session.phase !== "results";
  if (session.phase === "active") {
    $("session-context").textContent =
      `${session.context.role} / ${session.context.style} / ${session.mode === "guided" ? "guided practice" : "mock interview"}`;
    $("question-phase").textContent =
      `QUESTION ${String(session.index + 1).padStart(2, "0")} / 05${session.followUps ? ` · FOLLOW-UP ${session.followUps}` : ""}`;
    $("progress-track")
      .querySelectorAll("i")
      .forEach((element, index) =>
        element.classList.toggle("active", index <= session.index),
      );
    $("question-text").textContent = session.prompt;
    $("answer").value = session.draft;
    $("answer").disabled = !!session.pendingTurn || interviewBusy;
    $("submit-answer").hidden = !!session.pendingTurn;
    $("submit-answer").disabled = interviewBusy || !session.draft.trim();
    $("next-question").hidden = !session.pendingTurn;
    if (session.pendingTurn)
      $("next-question").textContent = session.pendingTurn.follow_up
        ? "Take the follow-up ↗"
        : session.index === 4
          ? "See the review ↗"
          : "Next question ↗";
    $("guided-feedback").textContent = session.guidance;
    $("dictate-answer").disabled = !!session.pendingTurn || interviewBusy;
    $("transcript-count").textContent =
      `${session.history.length} response${session.history.length === 1 ? "" : "s"}`;
    renderTranscript($("transcript-list"));
    if (focus) $("question-text").focus();
  } else if (session.phase === "results") {
    renderTranscript($("answers-list"));
    $("feedback-text").textContent = session.feedback;
    $("retry-feedback").hidden = !!session.feedback || !session.history.length;
    if (focus) $("results-title").focus();
  }
}
$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (interviewBusy) return;
  if (uploadBusy || importBusy) {
    status(
      "setup-status",
      "Wait for your background import to finish before starting.",
    );
    return;
  }
  if (!$("role").value.trim()) {
    status("setup-status", "Enter a target role.", "error");
    $("role").focus();
    return;
  }
  interviewBusy = true;
  const controller = (interviewController = new AbortController());
  const button = $("setup-form").querySelector('[type="submit"]');
  button.disabled = true;
  const context = background(),
    mode = $("interview-mode").value;
  status(
    "setup-status",
    "Preparing questions around your role and experience…",
    "busy",
  );
  try {
    const result = await request("/api/questions", context, controller);
    if (
      !Array.isArray(result.questions) ||
      result.questions.length !== 5 ||
      result.questions.some((q) => typeof q !== "string" || !q.trim())
    )
      throw new Error("The questions were incomplete. Please try again.");
    session = {
      ...emptySession(),
      phase: "active",
      context,
      mode,
      questions: result.questions,
      prompt: result.questions[0],
    };
    status("setup-status");
    renderSession(true);
    save();
  } catch (error) {
    if (!canceled(controller)) status("setup-status", error.message, "error");
  } finally {
    if (interviewController === controller) {
      interviewBusy = false;
      button.disabled = false;
      if (session.phase === "active") renderSession();
    }
  }
});
$("answer").addEventListener("input", () => {
  session.draft = $("answer").value;
  $("submit-answer").disabled = interviewBusy || !session.draft.trim();
  scheduleSave();
});
$("submit-answer").addEventListener("click", async () => {
  if (interviewBusy || session.pendingTurn || session.phase !== "active")
    return;
  stopSpeech();
  const answer = $("answer").value.trim();
  if (!answer) return;
  const entry = { question: session.prompt, answer };
  const controller = (interviewController = new AbortController());
  interviewBusy = true;
  $("answer").disabled =
    $("submit-answer").disabled =
    $("dictate-answer").disabled =
      true;
  status(
    "answer-status",
    "Considering your answer in the context of the conversation…",
    "busy",
  );
  try {
    const result = await request(
      "/api/interview-turn",
      {
        ...session.context,
        history: [...session.history, entry],
        follow_up_count: session.followUps,
        mode: session.mode,
      },
      controller,
    );
    if (
      typeof result.follow_up !== "boolean" ||
      typeof result.question !== "string" ||
      (result.follow_up && !result.question.trim())
    )
      throw new Error(
        "The interviewer’s response was incomplete. Please try again.",
      );
    session.history.push(entry);
    session.draft = "";
    status("answer-status");
    if (session.mode === "guided") {
      session.pendingTurn = result;
      session.guidance =
        result.guidance || "Answer recorded. Continue when you’re ready.";
      $("next-question").textContent = result.follow_up
        ? "Take the follow-up ↗"
        : session.index === 4
          ? "See the review ↗"
          : "Next question ↗";
      interviewBusy = false;
      renderSession();
      $("next-question").focus();
      save();
    } else {
      interviewBusy = false;
      await advance(result);
    }
  } catch (error) {
    if (!canceled(controller))
      status(
        "answer-status",
        error.message + " Your response is still here.",
        "error",
      );
  } finally {
    if (interviewController === controller) {
      interviewBusy = false;
      if (session.phase === "active") renderSession();
    }
  }
});
async function advance(turn) {
  session.pendingTurn = null;
  session.guidance = "";
  if (turn.follow_up && session.followUps < 2) {
    session.followUps++;
    session.prompt = turn.question;
  } else {
    session.index++;
    session.followUps = 0;
    session.prompt = session.questions[session.index] || "";
  }
  session.draft = "";
  $("answer").value = "";
  if (session.index >= 5) {
    await finishSession();
    return;
  }
  renderSession(true);
  save();
}
$("next-question").addEventListener("click", () => {
  if (!interviewBusy && session.pendingTurn) advance(session.pendingTurn);
});
async function finishSession() {
  stopSpeech();
  setFocusMode(false);
  session.phase = "results";
  session.pendingTurn = null;
  renderSession(true);
  save();
  if (session.history.length) await getInterviewReview();
  else {
    session.feedback =
      "No responses were submitted. Start a new conversation when you’re ready.";
    renderSession();
    save();
  }
}
$("end-session").addEventListener("click", () => {
  interviewController?.abort("ended");
  interviewBusy = false;
  const draft = $("answer").value.trim();
  if (draft && !session.pendingTurn && session.history.length < 15)
    session.history.push({ question: session.prompt, answer: draft });
  $("answer").value = "";
  session.draft = "";
  status("answer-status");
  finishSession();
});
async function getInterviewReview() {
  if (interviewBusy || !session.history.length) return;
  interviewBusy = true;
  const controller = (interviewController = new AbortController());
  $("retry-feedback").hidden = true;
  $("restart-button").disabled = true;
  $("feedback-text").textContent =
    "Reading the conversation and preparing your review…";
  try {
    const result = await request(
      "/api/interview-review",
      { ...session.context, history: session.history },
      controller,
    );
    if (typeof result.feedback !== "string" || !result.feedback.trim())
      throw new Error("The review was incomplete. Please try again.");
    session.feedback = result.feedback;
    $("feedback-text").textContent = result.feedback;
    save();
  } catch (error) {
    if (!canceled(controller)) {
      $("feedback-text").textContent = error.message;
      $("retry-feedback").hidden = false;
    }
  } finally {
    if (interviewController === controller) {
      interviewBusy = false;
      $("restart-button").disabled = false;
    }
  }
}
$("retry-feedback").addEventListener("click", getInterviewReview);
$("restart-button").addEventListener("click", () => {
  if (interviewBusy) return;
  session = emptySession();
  $("answer").value = "";
  status("answer-status");
  status("setup-status");
  renderSession();
  save();
  $("role").focus();
});
$("download-interview").addEventListener("click", () =>
  download(
    `${session.context.role || "Interview"}\n\n${session.history.map((entry, index) => `${index + 1}. ${entry.question}\n\n${entry.answer}`).join("\n\n---\n\n")}\n\nREVIEW\n${session.feedback}`,
    "intraviewer-conversation.txt",
  ),
);

// Optional browser dictation transcribes speech; no vocal analysis is claimed.
function stopSpeech(silent = false) {
  if (!recognition) return;
  const instance = recognition;
  instance.onresult = null;
  instance.onend = null;
  instance.onerror = null;
  const statusId =
    speechTarget === "pitch-text" ? "pitch-status" : "answer-status";
  if (!silent && $(statusId).dataset.busy !== "true")
    status(
      statusId,
      "Dictation stopped. Review the transcript before submitting.",
    );
  instance.abort();
  recognition = null;
  speechTarget = null;
  for (const id of ["dictate-pitch", "dictate-answer"]) {
    $(id).textContent = "Use microphone ○";
    $(id).setAttribute("aria-pressed", "false");
  }
}
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  for (const [buttonId, targetId, statusId] of [
    ["dictate-pitch", "pitch-text", "pitch-status"],
    ["dictate-answer", "answer", "answer-status"],
  ]) {
    const button = $(buttonId);
    button.hidden = false;
    button.addEventListener("click", () => {
      if (speechTarget === targetId && recognition) {
        stopSpeech();
        return;
      }
      if (recognition) {
        stopSpeech();
        return;
      }
      const instance = new SpeechRecognition();
      recognition = instance;
      speechTarget = targetId;
      const original = $(targetId).value;
      instance.lang = "en-US";
      instance.continuous = true;
      instance.interimResults = true;
      instance.onstart = () => {
        button.textContent = "Stop dictation ●";
        button.setAttribute("aria-pressed", "true");
        status(
          statusId,
          "Listening. Your browser transcribes speech; feedback reviews the text only.",
        );
      };
      instance.onresult = (event) => {
        const text = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(" ");
        $(targetId).value = (original + (original ? " " : "") + text).slice(
          0,
          $(targetId).maxLength,
        );
        if (targetId === "pitch-text") pitchInputMode = "speech_transcript";
        $(targetId).dispatchEvent(new Event("input", { bubbles: true }));
      };
      instance.onerror = (event) => {
        status(
          statusId,
          event.error === "not-allowed"
            ? "Microphone access was not granted. You can type your response instead."
            : "Dictation stopped. Your text is kept; you can continue typing.",
          "error",
        );
      };
      instance.onend = () => {
        if (recognition !== instance) return;
        recognition = null;
        speechTarget = null;
        button.textContent = "Use microphone ○";
        button.setAttribute("aria-pressed", "false");
        if (
          $(statusId).dataset.error !== "true" &&
          $(statusId).dataset.busy !== "true"
        )
          status(
            statusId,
            "Dictation stopped. Review the transcript before submitting.",
          );
      };
      try {
        instance.start();
      } catch {
        recognition = null;
        speechTarget = null;
        status(
          statusId,
          "Dictation is unavailable. Continue by typing.",
          "error",
        );
      }
    });
  }
  $("speech-help").textContent =
    "Microphone input uses your browser’s speech service. Coaching evaluates the transcript, not vocal delivery. Estimated length assumes 130 words per minute.";
}

function navigate(hash, initial = false) {
  if (!hash) return;
  if (!initial) stopSpeech();
  if (hash === "#resume" || hash === "#linkedin") selectDocument(hash.slice(1));
  const target = ["#resume", "#linkedin"].includes(hash)
    ? $("profile")
    : document.getElementById(hash.slice(1));
  if (!target) return;
  if (hash !== "#interview") setFocusMode(false);
  if (!initial) history.pushState(null, "", hash);
  requestAnimationFrame(() =>
    target.scrollIntoView({
      behavior:
        initial || matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      block: "start",
    }),
  );
}
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", () =>
  navigate(location.hash || "#home", true),
);
window.addEventListener("hashchange", () => navigate(location.hash, true));
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.body.classList.contains("is-focused")
  ) {
    setFocusMode(false);
    $("focus-toggle").focus();
  }
});
for (const id of fieldIds) {
  $(id).addEventListener("input", () => {
    if (id === "profile-role") {
      $("role").value = $(id).value;
      renderDocumentReview();
    }
    if (id === "role") {
      $("profile-role").value = $(id).value;
      renderDocumentReview();
    }
    if (id === "resume-text" || id === "linkedin-text") renderDocumentReview();
    if (id === "pitch-text") renderPitchReview();
    updateCounts();
    scheduleSave();
  });
  $(id).addEventListener("change", scheduleSave);
}
$("clear-session-data").addEventListener("click", () => {
  stopSpeech(true);
  clearTimeout(saveTimer);
  for (const controller of [
    reviewController,
    uploadController,
    importController,
    pitchController,
    interviewController,
  ])
    controller?.abort("cleared");
  for (const id of fieldIds) {
    const element = $(id);
    if (element.tagName === "SELECT")
      element.selectedIndex = id === "pitch-duration" ? 1 : 0;
    else element.value = "";
  }
  $("resume-file").value = $("answer").value = "";
  reviews = { resume: null, linkedin: null };
  pitchReview = null;
  session = emptySession();
  pitchInputMode = "typed";
  interviewBusy = false;
  $("setup-form").querySelector('[type="submit"]').disabled = false;
  $("restart-button").disabled = false;
  setFocusMode(false);
  renderSession();
  renderDocumentReview();
  renderPitchReview();
  updateCounts();
  for (const id of [
    "resume-status",
    "linkedin-status",
    "review-status",
    "pitch-status",
    "setup-status",
    "answer-status",
  ])
    status(id);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {}
  status(
    "privacy-status",
    "Saved drafts, reviews, and the interview conversation have been cleared from this tab.",
  );
});
window.addEventListener("pagehide", save);
restore();
selectDocument(activeDocument);
updateCounts();
renderPitchReview();
renderSession();
if (session.phase === "results" && !session.feedback && session.history.length)
  $("feedback-text").textContent =
    "Your conversation is saved. Select Retry review to generate feedback.";
if (location.hash) navigate(location.hash, true);
$("year").textContent = new Date().getFullYear();
if ("ResizeObserver" in window)
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty(
      "--header-height",
      `${entry.target.getBoundingClientRect().height}px`,
    );
  }).observe(document.querySelector(".site-header"));
if ("IntersectionObserver" in window) {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    document.documentElement.classList.add("motion-ready");
    document
      .querySelectorAll(".reveal")
      .forEach((element) => revealObserver.observe(element));
  }
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          for (const link of document.querySelectorAll("[data-nav]")) {
            const active =
              link.dataset.nav === entry.target.id &&
              (entry.target.id !== "profile" ||
                link.getAttribute("href") === "#" + activeDocument);
            if (active) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
          }
        }
    },
    { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
  );
  for (const id of ["home", "approach", "profile", "pitch", "interview"])
    sectionObserver.observe($(id));
}
