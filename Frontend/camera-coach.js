"use strict";
(() => {
  class CameraCoach {
    constructor({preflight, stage, toolbar, results, video, recording}) {
      this.video = video; this.recording = recording;
      this.signals = new CameraSignals();
      this.worker = null; this.enabled = false; this.cameraOn = false;
      this.generation = 0; this.busy = false; this.ready = false; this.tipUntil = 0;
      this.setup = document.createElement("div");
      this.setup.className = "camera-coach-setup";
      this.setup.innerHTML = `<label class="camera-coach-optin"><input type="checkbox" id="camera-coach-enable"> Camera coaching · live tips + a review</label><p class="help">Video is analyzed on this device, never uploaded or recorded. Optional cues cover framing, estimated looking away, and repeated movement.</p><button type="button" class="quiet" data-calibrate disabled>Calibrate camera position</button><p data-coach-status role="status">Enable camera coaching and your camera to begin.</p><details><summary>Online interview tips</summary><ul><li>Place the lens at eye level, with light in front of you and space above your head.</li><li>Keep notes near the lens. Look toward it when making a key point; you don’t need constant eye contact.</li><li>Use natural gestures. If you notice repeated fidgeting, put distracting objects aside and rest your hands between points.</li></ul></details>`;
      preflight.append(this.setup);
      this.live = document.createElement("aside");
      this.live.className = "camera-coach-live";
      this.live.hidden = true;
      this.live.innerHTML = `<p class="eyebrow">CAMERA COACH / ON DEVICE</p><p data-coach-status role="status"></p><div data-coach-tip aria-live="polite"><strong></strong><p></p></div><button type="button" data-calibrate disabled>Calibrate</button>`;
      stage.append(this.live);
      this.toggle = document.createElement("button");
      this.toggle.type = "button";
      this.toggle.textContent = "Camera tips off";
      this.toggle.setAttribute("aria-pressed","false");
      toolbar.append(this.toggle);
      this.review = document.createElement("section");
      this.review.id = "camera-coach-review";
      this.review.hidden = true;
      results.insertBefore(this.review, document.getElementById("answers-list"));
      this.checkbox = this.setup.querySelector("input");
      this.checkbox.addEventListener("change", () => this.enable(this.checkbox.checked));
      this.toggle.addEventListener("click", () => this.enable(!this.enabled));
      [this.setup,this.live].forEach(container => container.querySelector("[data-calibrate]").addEventListener("click", () => {
        if (!this.ready) return;
        this.signals.calibrate(); this.tipUntil = 0;
        this.status("Look comfortably at the lens for 3 seconds…");
      }));
    }
    status(text) {
      [this.setup,this.live].forEach(container => {
        const status = container.querySelector("[data-coach-status]");
        if (status.textContent !== text) status.textContent = text;
      });
    }
    controls() {
      this.checkbox.checked = this.enabled;
      this.toggle.setAttribute("aria-pressed",String(this.enabled));
      this.toggle.textContent = this.enabled ? "Camera tips on" : "Camera tips off";
      this.live.hidden = !this.enabled;
      [this.setup,this.live].forEach(container => {container.querySelector("[data-calibrate]").disabled = !this.ready;});
    }
    enable(value) {
      this.enabled = value;
      if (value && this.recording()) this.requested = true;
      if (!value) this.signals.baseline = null;
      if (value && this.cameraOn) this.start();
      else { this.stop(); this.status(value ? "Turn on your camera to use coaching." : "Camera coaching is off."); }
      this.controls();
    }
    camera(value) {
      this.cameraOn = value;
      if (!value) this.signals.baseline = null;
      if (value && this.enabled) this.start();
      else { this.stop(); this.status(this.enabled ? "Camera off · analysis paused." : "Camera coaching is off."); }
    }
    begin() {
      this.requested = this.enabled;
      const baseline = this.signals.baseline;
      this.signals.reset();
      this.signals.baseline = baseline;
      this.review.hidden = true;
      this.tipUntil = 0;
    }
    stop() {
      this.generation++;
      clearTimeout(this.poll); clearTimeout(this.timeout);
      this.worker?.terminate(); this.worker = null;
      this.ready = false; this.busy = false;
      this.signals.pause(); this.tipUntil = 0;
      this.live.querySelector("[data-coach-tip]").hidden = true;
      this.controls();
    }
    fail() {
      this.stop();
      this.status("Camera analysis unavailable. Turn camera tips off and on to retry. Your interview can continue.");
    }
    start() {
      if (this.worker || !this.enabled || !this.cameraOn) return;
      this.stop();
      const epoch = this.generation;
      this.status("Loading camera coaching on your device…");
      try {
        this.worker = new Worker("camera-coach-worker.js");
        this.worker.onerror = () => { if (this.generation === epoch) this.fail(); };
        this.worker.onmessage = event => {
          if (this.generation !== epoch) return;
          clearTimeout(this.timeout);
          if (event.data.type === "error") { this.fail(); return; }
          if (event.data.type === "ready") {
            this.ready = true; this.controls();
            this.status("Ready. Calibrate while looking at the camera lens.");
          } else if (event.data.type === "sample") {
            this.busy = false;
            const result = this.signals.observe(event.data.features,event.data.timestamp,this.recording());
            this.status(result.text);
            const tip = this.live.querySelector("[data-coach-tip]");
            if (result.cue) {
              tip.querySelector("strong").textContent = result.cue.title;
              tip.querySelector("p").textContent = result.cue.text;
              this.tipUntil = performance.now() + 10000;
            }
            tip.hidden = performance.now() > this.tipUntil;
          }
          this.poll = setTimeout(() => this.sample(epoch), 250);
        };
        this.timeout = setTimeout(() => this.fail(), 45000);
        this.worker.postMessage({type:"init"});
      } catch { this.fail(); }
    }
    async sample(epoch) {
      if (this.generation !== epoch || !this.ready || this.busy || document.hidden) return;
      const video = this.video();
      if (video.readyState < 2 || !video.videoWidth) { this.poll = setTimeout(() => this.sample(epoch),250); return; }
      this.busy = true;
      try {
        const frame = await createImageBitmap(video,{resizeWidth:480,resizeHeight:Math.round(480*video.videoHeight/video.videoWidth)});
        if (this.generation !== epoch) { frame.close(); return; }
        this.timeout = setTimeout(() => this.fail(),15000);
        this.worker.postMessage({type:"frame",frame,timestamp:performance.now()},[frame]);
      } catch { if (this.generation === epoch) this.fail(); }
    }
    finish() {
      const summary = this.signals.summary();
      this.stop();
      this.review.replaceChildren();
      this.review.hidden = !summary.used && !this.requested;
      if (this.review.hidden) return;
      const heading = document.createElement("h3"); heading.textContent = "Your camera presence";
      const intro = document.createElement("p");
      intro.textContent = "Local camera observations, separate from your answer feedback. These cues do not measure attention, confidence, or interview ability.";
      this.review.append(heading,intro);
      if (summary.observedMs < 10000) {
        const note = document.createElement("p"); note.textContent = "There wasn’t enough analyzed camera time for a useful review. Try at least 10 seconds with your camera and coaching enabled.";
        this.review.append(note); return;
      }
      const duration = document.createElement("p");
      duration.textContent = `About ${Math.round(summary.observedMs/1000)} seconds of camera observations. Camera-off, calibration, and background time are excluded.`;
      this.review.append(duration);
      const list = document.createElement("ul");
      const {counts} = summary;
      const items = [
        summary.calibrated
          ? `Looking toward the lens: ${counts.away} sustained look-away cue${counts.away === 1 ? "" : "s"}. Keep notes near the lens and reconnect at key points. This is a calibrated direction estimate, not an eye-contact score.`
          : "Looking toward the lens wasn’t assessed. Calibrate your camera position next time to enable this cue.",
        `Repeated movement: ${counts.movement} sustained cue${counts.movement === 1 ? "" : "s"}. These may be gestures, camera motion, or fidgeting. Keep helpful gestures and rest your hands when you choose to pause.`,
        `Framing: ${counts.framing} framing cue${counts.framing === 1 ? "" : "s"}; ${counts.missing} period${counts.missing === 1 ? "" : "s"} with no face detected. Use eye-level framing and front lighting.`,
        "Try another short answer with one change at a time. Zero cues means no sustained threshold crossings were observed, not perfect performance."
      ];
      if (counts.multiple) items.push("More than one face was detected during part of the session; personal cues paused during those periods.");
      for (const text of items) { const li = document.createElement("li"); li.textContent = text; list.append(li); }
      this.review.append(list);
    }
  }
  window.CameraCoach = CameraCoach;
})();
