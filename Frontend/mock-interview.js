"use strict";

// Mock-only orchestration. Narration, dictation, AI requests and result rendering
// are the existing application's services; Guided Practice keeps its own flow.
(() => {
  const preflight = document.createElement("section");
  preflight.className = "mock-preflight full-width";
  preflight.innerHTML = `
    <div class="mock-preflight-portrait"><img src="ivanthegoat.png" alt="Intra Ivan, your AI interviewer" width="1920" height="1080"></div>
    <div><p class="eyebrow">YOUR INTERVIEWER / INTRA IVAN</p><h3>A real rehearsal.</h3>
    <p>Join an AI interview simulation. Listen, take your time, and select Done Answering when you’re ready to move on.</p>
    <div class="mock-device-tests"><button type="button" class="quiet" id="mock-test-mic">Test microphone</button><button type="button" class="quiet" id="mock-test-speaker">Test speaker</button><button type="button" class="quiet" id="mock-preview-camera" aria-pressed="false">Enable camera</button></div>
    <meter id="mock-mic-level" min="0" max="1" value="0" aria-label="Microphone input level" hidden></meter>
    <video id="mock-pre-video" autoplay muted playsinline hidden aria-label="Your camera preview"></video>
    <p class="help">Camera is optional and stays in your browser. Speech recognition uses your browser’s existing transcription service. Questions use the existing ElevenLabs voice.</p>
    <p id="mock-device-status" role="status"></p></div>`;
  setupForm.insertBefore(preflight, setupForm.querySelector(".start-action"));
  const call = document.createElement("dialog");
  call.id = "mock-call";
  call.setAttribute("aria-labelledby", "mock-title");
  call.innerHTML = `
    <header class="mock-call-header"><div><p class="eyebrow">INTRAVIEWER / INTERVIEW ROOM</p><h2 id="mock-title">Mock Interview</h2></div><div class="mock-session-meta"><span id="mock-progress"></span><time id="mock-timer" aria-label="Elapsed interview time">00:00</time></div></header>
    <div class="mock-stage" id="mock-stage">
      <img id="mock-interviewer" src="ivanthegoat.png" alt="Intra Ivan, AI interviewer" width="1920" height="1080">
      <span class="mock-nameplate">Intra Ivan <span>AI interviewer</span></span>
      <div class="mock-self"><video id="mock-camera" autoplay muted playsinline hidden aria-label="Your camera preview"></video><div id="mock-camera-off"><span>YOU</span><p>Camera off</p></div><span class="mock-self-label">You · preview</span></div>
      <div id="mock-captions" class="mock-captions" aria-live="off" hidden></div>
    </div>
    <div class="mock-turn"><div><span class="mock-state-dot" aria-hidden="true"></span><span id="mock-state" role="status">Connecting…</span><p id="mock-notice" role="status"></p></div><button id="mock-done" type="button" disabled>Done Answering</button><button id="mock-recover-audio" type="button" hidden>Continue audio</button><button id="mock-retry-mic" type="button" hidden>Retry microphone</button></div>
    <details class="mock-transcription"><summary>Your response / text fallback</summary><label for="mock-response">Your answer</label><textarea id="mock-response" rows="3" maxlength="10000" placeholder="Your spoken answer appears here. You can also type." disabled></textarea><p id="mock-interim" aria-live="off"></p></details>
    <footer class="mock-toolbar"><div><button id="mock-mute" type="button" aria-pressed="false">Mute microphone</button><button id="mock-camera-toggle" type="button" aria-pressed="false">Enable camera</button><button id="mock-caption-toggle" type="button" aria-pressed="true">Captions on</button></div><button id="mock-end" class="mock-end" type="button">End Interview</button></footer>`;
  document.body.append(call);
  const el = id => document.getElementById(`mock-${id}`);
  const narrator = createNarrator(el("notice"), "question");
  narrator.panel.hidden = true;
  const audio = narrator.audio;
  audio.controls = false;
  const testNarrator = createNarrator(el("device-status"), "question");
  testNarrator.panel.hidden = true;
  testNarrator.audio.controls = false;
  let active = false, phase = "precall", generation = 0;
  let context = {}, prompts = [], history = [], index = 0, probes = 0;
  let prompt = "", deliveryId = "", captionParts = [], muted = false, captions = true;
  let submitting = false, finishing = false, dictationFailed = false;
  let cameraStream = null, cameraGeneration = 0, cameraPending = false;
  let micStream = null, micContext = null, micAnimation = null, micTimeout = null, micGeneration = 0;
  let timer = null, startedAt = 0, stopTimeout = null;
  const delivered = new Set();
  const responsePhase = () => ["user_ready", "user_speaking"].includes(phase);

  const cameraCoach = new CameraCoach({
    preflight: preflight.lastElementChild, stage: el("stage"),
    toolbar: call.querySelector(".mock-toolbar>div"), results: resultsScreen,
    video: () => active ? el("camera") : el("pre-video"), recording: () => active
  });
  restartButton.addEventListener("click", () => { cameraCoach.review.hidden = true; });

  function state(next, label) {
    phase = next;
    call.dataset.state = next;
    el("state").textContent = label;
    el("done").disabled = !responsePhase() || submitting || finishing;
    el("response").disabled = !responsePhase() || submitting || finishing;
  }
  function notice(text = "") { el("notice").textContent = text; }
  function syncTranscript() {
    el("response").value = answerBox.value;
    el("interim").textContent = speechPreview.textContent;
  }
  function stopListening() {
    clearTimeout(stopTimeout);
    cancelDictation();
    el("interim").textContent = "";
  }
  function listen() {
    if (!active || !responsePhase() || submitting || finishing || muted || document.hidden) return;
    if (!speechAvailable) {
      notice(speechReady);
      call.querySelector("details").open = true;
      return;
    }
    if (recognition || dictationFailed) return;
    if (answerBox.value.length >= answerBox.maxLength) {
      state("user_ready", "Answer limit reached · review and submit your response");
      return;
    }
    answerBox.disabled = false;
    answerAccepted = false;
    syncSpeechControls();
    state("user_ready", "Microphone ready · requesting speech capture…");
    speechButton.click();
  }
  function ready() {
    if (!active) return;
    el("stage").classList.remove("is-speaking");
    el("captions").hidden = true;
    state("user_ready", muted ? "Microphone muted" : "Your turn · take your time");
    notice("Select Done Answering when you’ve finished. Thinking pauses won’t submit your answer.");
    listen();
  }
  function updateCaptions() {
    if (!active || phase !== "ai_speaking" || !captions || !Number.isFinite(audio.duration) || !audio.duration) {
      el("captions").hidden = true;
      return;
    }
    // The existing endpoint returns MP3 without alignment metadata. Estimate
    // phrase boundaries by word weight against the actual media playhead.
    const total = captionParts.reduce((sum, part) => sum + part.weight, 0);
    const position = audio.currentTime / audio.duration * total;
    let boundary = 0;
    const part = captionParts.find(item => { boundary += item.weight; return position < boundary; }) || captionParts.at(-1);
    el("captions").textContent = part?.text || "";
    el("captions").hidden = !part;
  }
  function prepareCaptions(text) {
    const words = text.trim().split(/\s+/);
    captionParts = [];
    let chunk = [];
    for (const word of words) {
      chunk.push(word);
      if (chunk.length >= 9 || /[.!?;:]$/.test(word)) {
        captionParts.push({text: chunk.join(" "), weight: chunk.length});
        chunk = [];
      }
    }
    if (chunk.length) captionParts.push({text: chunk.join(" "), weight: chunk.length});
  }
  function speak(text, id) {
    if (!active || delivered.has(id)) return;
    stopListening();
    deliveryId = id;
    state("ai_preparing", "Preparing interviewer audio…");
    el("retry-mic").hidden = true;
    notice();
    prepareCaptions(text);
    el("recover-audio").hidden = true;
    narrator.set(text);
    narrator.panel.hidden = true;
    narrator.start();
  }
  function audioRecovery(message) {
    if (!active || delivered.has(deliveryId) || !["ai_preparing", "ai_speaking", "error"].includes(phase)) return;
    el("stage").classList.remove("is-speaking");
    el("captions").hidden = true;
    state("error", "Interviewer audio needs attention");
    notice(message);
    el("recover-audio").hidden = false;
  }
  audio.addEventListener("playing", () => {
    if (!active || delivered.has(deliveryId)) { audio.pause(); return; }
    stopListening();
    state("ai_speaking", "Intra Ivan is speaking");
    notice();
    el("recover-audio").hidden = true;
    el("stage").classList.add("is-speaking");
    updateCaptions();
  });
  audio.addEventListener("timeupdate", updateCaptions);
  audio.addEventListener("waiting", () => {
    el("stage").classList.remove("is-speaking");
    el("captions").hidden = true;
    if (active) el("state").textContent = "Buffering interviewer audio…";
  });
  audio.addEventListener("pause", () => {
    el("stage").classList.remove("is-speaking");
    if (active && phase === "ai_speaking" && !audio.ended) audioRecovery("Audio was interrupted. Continue to finish this question.");
  });
  audio.addEventListener("error", () => audioRecovery("Audio could not play. Retry this undelivered question."));
  audio.addEventListener("ended", () => {
    if (!active || delivered.has(deliveryId)) return;
    delivered.add(deliveryId);
    ready();
  });
  new MutationObserver(() => {
    const text = narrator.status.textContent;
    if (text && !narrator.button.disabled) audioRecovery(text);
  }).observe(narrator.panel, {subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"]});
  el("recover-audio").addEventListener("click", async () => {
    if (!active || delivered.has(deliveryId) || narrator.button.disabled) return;
    el("recover-audio").hidden = true;
    state("ai_preparing", "Resuming interviewer audio…");
    if (audio.getAttribute("src") && !audio.error) {
      try { await audio.play(); } catch { audioRecovery("Your browser blocked playback. Select Continue audio to try again."); }
    } else narrator.start();
  });

  window.addEventListener("interview-dictation", event => {
    if (!active || !responsePhase()) return;
    const type = event.detail.type;
    syncTranscript();
    if (type === "start") state("user_speaking", "Listening · microphone on");
    if (type === "result") el("state").textContent = "Speech detected · listening";
    if (type === "error") {
      dictationFailed = true;
      const connectionFailure = ["network", "service-not-allowed"].includes(event.detail.error);
      const message = connectionFailure
        ? "Your browser could not connect to its speech recognition service. If you’re using an IDE preview, open this site in standalone Google Chrome at " + location.origin + ". Allow microphone access there and start an interview. If you’re already in Chrome, check your connection and retry. You can also type your answer below."
        : speechStatus.textContent;
      notice(message + (answerBox.value.trim() ? " Your recognized words are preserved." : " No speech has been transcribed yet."));
      el("retry-mic").hidden = false;
      call.querySelector("details").open = true;
    }
    if (type === "end") {
      if (finishing) { clearTimeout(stopTimeout); finishing = false; submitAnswer(); }
      else if (!dictationFailed) listen();
      else state("user_ready", answerBox.value.trim()
        ? "Transcription stopped · recognized words preserved"
        : "Transcription unavailable · no answer captured");
    }
  });
  el("retry-mic").addEventListener("click", () => {
    if (!active || !responsePhase()) return;
    stopListening();
    muted = false;
    dictationFailed = false;
    el("retry-mic").hidden = true;
    el("mute").textContent = "Mute microphone";
    el("mute").setAttribute("aria-pressed", "false");
    ready();
  });
  el("response").addEventListener("input", () => { answerBox.value = el("response").value; });
  el("done").addEventListener("click", () => {
    if (!active || !responsePhase() || submitting || finishing) return;
    if (recognition) {
      finishing = true;
      el("done").disabled = true;
      el("response").disabled = true;
      notice("Finalizing your spoken answer…");
      speechButton.click();
      // A stalled recognition service cannot hold the call indefinitely.
      stopTimeout = setTimeout(() => {
        if (!active || !finishing) return;
        stopListening();
        finishing = false;
        state("user_ready", "Transcription timed out");
        notice("Finalized words were preserved. Review your answer and select Done Answering again.");
        call.querySelector("details").open = true;
      }, 6000);
    } else submitAnswer();
  });
  async function submitAnswer() {
    if (!active || submitting) return;
    const answer = answerBox.value.trim();
    if (!answer) { ready(); notice("No answer captured yet. Speak or type before continuing."); return; }
    const epoch = generation;
    const turn = {question: prompt, answer};
    submitting = true;
    stopListening();
    state("processing_answer", "Considering your response…");
    notice();
    try {
      let followup = "";
      if (probes < 2) {
        const result = await postJSON("/api/interview-followup", {...context, history: [...history, turn]});
        if (typeof result.question !== "string") throw new Error("No valid follow-up received. Please submit again.");
        followup = result.question.trim();
      }
      if (!active || generation !== epoch) return;
      history.push(turn);
      answerBox.value = "";
      syncTranscript();
      dictationFailed = false;
      if (followup) { probes++; prompt = followup; }
      else { index++; probes = 0; prompt = prompts[index]; }
      if (index >= prompts.length) { finish(); return; }
      el("progress").textContent = `Question ${index + 1} / ${prompts.length}${probes ? ` · Follow-up ${probes}` : ""}`;
      speak(prompt, `${generation}:${history.length}`);
    } catch (error) {
      if (!active || generation !== epoch) return;
      state("user_ready", "Answer saved · submission failed");
      notice(error.message + " Select Done Answering to retry.");
    } finally {
      if (generation === epoch) {
        submitting = false;
        el("done").disabled = !responsePhase();
        el("response").disabled = !responsePhase();
      }
    }
  }
  el("mute").addEventListener("click", () => {
    muted = !muted;
    el("mute").setAttribute("aria-pressed", String(muted));
    el("mute").textContent = muted ? "Unmute microphone" : "Mute microphone";
    if (muted) {
      // Muting stops capture immediately; only finalized words are retained.
      finishing = false;
      stopListening();
      if (responsePhase()) state("user_ready", "Microphone muted");
    } else { dictationFailed = false; if (responsePhase()) ready(); }
  });
  el("caption-toggle").addEventListener("click", () => {
    captions = !captions;
    el("caption-toggle").setAttribute("aria-pressed", String(captions));
    el("caption-toggle").textContent = captions ? "Captions on" : "Captions off";
    updateCaptions();
  });

  function stopCamera() {
    cameraCoach.camera(false);
    cameraGeneration++;
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    for (const id of ["camera", "pre-video"]) { el(id).srcObject = null; el(id).hidden = true; }
    el("camera-off").hidden = false;
    for (const id of ["camera-toggle", "preview-camera"]) { el(id).textContent = "Enable camera"; el(id).setAttribute("aria-pressed", "false"); }
  }
  async function toggleCamera() {
    if (cameraPending) return;
    if (cameraStream) { stopCamera(); return; }
    cameraPending = true;
    const epoch = ++cameraGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      if (epoch !== cameraGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
      cameraStream = stream;
      for (const id of ["camera", "pre-video"]) { el(id).srcObject = stream; el(id).hidden = false; }
      el("camera-off").hidden = true;
      cameraCoach.camera(true);
      for (const id of ["camera-toggle", "preview-camera"]) { el(id).textContent = "Disable camera"; el(id).setAttribute("aria-pressed", "true"); }
      stream.getVideoTracks()[0].addEventListener("ended", stopCamera);
    } catch {
      if (epoch !== cameraGeneration) return;
      const message = "Camera unavailable or permission denied. You can complete the interview with camera off.";
      if (active) notice(message); else el("device-status").textContent = message;
    } finally { cameraPending = false; }
  }
  el("camera-toggle").addEventListener("click", toggleCamera);
  el("preview-camera").addEventListener("click", toggleCamera);
  function stopMicTest() {
    micGeneration++;
    clearTimeout(micTimeout);
    cancelAnimationFrame(micAnimation);
    micStream?.getTracks().forEach(track => track.stop());
    micStream = null;
    if (micContext) micContext.close().catch(() => {});
    micContext = null;
    el("mic-level").hidden = true;
    el("test-mic").textContent = "Test microphone";
  }
  el("test-mic").addEventListener("click", async () => {
    if (micStream) { stopMicTest(); el("device-status").textContent = "Microphone test stopped."; return; }
    const epoch = ++micGeneration;
    el("test-mic").disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (epoch !== micGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
      micStream = stream;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      micContext = new AudioContext();
      await micContext.resume();
      if (epoch !== micGeneration) return;
      const analyser = micContext.createAnalyser();
      micContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        const energy = samples.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0);
        el("mic-level").value = Math.min(1, Math.sqrt(energy / samples.length) * 5);
        micAnimation = requestAnimationFrame(measure);
      };
      el("mic-level").hidden = false;
      el("test-mic").textContent = "Stop microphone test";
      el("device-status").textContent = "Microphone connected. Speak and watch the input meter. Test stops after 15 seconds.";
      measure();
      micTimeout = setTimeout(() => { stopMicTest(); el("device-status").textContent = "Microphone test complete."; }, 15000);
    } catch {
      if (epoch === micGeneration) { stopMicTest(); el("device-status").textContent = "Microphone unavailable or permission denied. Text answers remain available."; }
    } finally { el("test-mic").disabled = false; }
  });
  el("test-speaker").addEventListener("click", async () => {
    if (testNarrator.button.disabled) return;
    if (testNarrator.audio.getAttribute("src") && !testNarrator.audio.error) {
      try { await testNarrator.audio.play(); }
      catch { el("device-status").textContent = "Playback blocked. Select Test speaker to try again."; }
      return;
    }
    testNarrator.set("Welcome to your interview. If you can hear me, your speaker is ready.");
    testNarrator.panel.hidden = true;
    testNarrator.start();
    el("device-status").textContent = "Preparing a speaker test…";
  });
  testNarrator.audio.addEventListener("playing", () => { el("device-status").textContent = "Playing speaker test. You should hear Intra Ivan’s interview voice."; });
  testNarrator.audio.addEventListener("ended", () => { el("device-status").textContent = "Speaker test finished."; });
  new MutationObserver(() => {
    if (testNarrator.status.textContent) el("device-status").textContent = testNarrator.status.textContent.replace("Press Play", "Select Test speaker again");
  }).observe(testNarrator.status, {childList: true, subtree: true});

  function cleanup() {
    active = false;
    generation++;
    clearInterval(timer);
    stopListening();
    narrator.set();
    testNarrator.set();
    el("stage").classList.remove("is-speaking");
    stopMicTest();
    stopCamera();
    call.close();
  }
  function finish() {
    if (!active) return;
    // Preserve finalized words on early termination, including an in-flight answer.
    const pending = answerBox.value.trim();
    if (pending && prompt) history.push({question: prompt, answer: pending});
    cameraCoach.finish();
    cleanup();
    state("completed", "Interview complete");
    interviewContext = context;
    mode = "mock";
    answers = history.map(turn => ({...turn}));
    showResults();
    if (answers.length) getFeedback();
    else {
      feedbackText.textContent = "The interview ended before any answers were recorded. Start again whenever you’re ready.";
      retryButton.hidden = true;
    }
    resultsScreen.scrollIntoView({behavior: "smooth", block: "start"});
  }
  el("end").addEventListener("click", () => { if (window.confirm("End this interview and review your recorded answers?")) finish(); });
  call.addEventListener("cancel", event => { event.preventDefault(); el("end").click(); });
  window.addEventListener("pagehide", cleanup);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopMicTest();
      stopCamera();
      if (active && responsePhase()) { finishing = false; stopListening(); state("user_ready", "Microphone paused while this tab is hidden"); }
    } else if (active && responsePhase()) listen();
  });
  function syncMode() {
    const mock = modeSelect.value === "mock";
    preflight.hidden = !mock;
    if (!loadingQuestions) startButton.textContent = mock ? "Join Interview" : "Enter the interview";
    if (!mock) { cameraCoach.review.hidden = true; stopMicTest(); stopCamera(); testNarrator.set(); }
  }
  modeSelect.addEventListener("change", syncMode);
  restartButton.addEventListener("click", syncMode);
  syncMode();

  window.mockInterview = {
    async join(details) {
      if (active) return;
      context = {...details};
      cameraCoach.begin();
      active = true;
      const epoch = ++generation;
      history = []; prompts = []; index = 0; probes = 0;
      prompt = ""; submitting = false; finishing = false; dictationFailed = false;
      delivered.clear();
      muted = false;
      el("mute").textContent = "Mute microphone";
      el("mute").setAttribute("aria-pressed", "false");
      stopMicTest();
      narrators.forEach(item => item.set());
      stopListening();
      answerBox.value = "";
      syncTranscript();
      setupForm.hidden = true;
      interviewScreen.hidden = resultsScreen.hidden = true;
      call.querySelector("details").open = !speechAvailable;
      el("title").textContent = `${context.role} / Mock Interview`;
      el("progress").textContent = "Preparing session";
      el("recover-audio").hidden = true;
      el("retry-mic").hidden = true;
      el("captions").hidden = true;
      startedAt = Date.now();
      el("timer").textContent = "00:00";
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        el("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      }, 1000);
      state("connecting", "Preparing role-specific interview questions…");
      notice();
      call.showModal();
      // Request permission during the Join gesture; STT capture starts only after TTS.
      if (speechAvailable && navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
          stream.getTracks().forEach(track => track.stop());
        }).catch(() => {
          if (active && generation === epoch) {
            muted = true;
            el("mute").textContent = "Unmute microphone";
            el("mute").setAttribute("aria-pressed", "true");
            notice("Microphone permission denied or unavailable. Use the text fallback or unmute to retry.");
            call.querySelector("details").open = true;
          }
        });
      }
      try {
        const result = await postJSON("/api/questions", context);
        if (!active || generation !== epoch) return;
        if (!Array.isArray(result.questions) || result.questions.length !== 5 || result.questions.some(q => typeof q !== "string" || !q.trim())) throw new Error("Invalid interview questions received. Please try joining again.");
        prompts = result.questions;
        prompt = prompts[0];
        el("progress").textContent = "Question 1 / 5";
        speak(`Welcome. I’m Intra Ivan, your AI interviewer. We’ll discuss your experience and the decisions behind your work. Take your time with each answer. Let’s begin. ${prompt}`, `${generation}:0`);
      } catch (error) {
        if (!active || generation !== epoch) return;
        cleanup();
        setupForm.hidden = false;
        setupStatus.textContent = error.message;
        startButton.focus();
      }
    }
  };
})();
