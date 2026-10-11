"use strict";
// Conservative, observable camera cues. These are rehearsal heuristics, not
// validated eye tracking, emotion inference, attention scores, or hiring scores.
(() => {
  const tips = {
    missing: {title: "Bring your face into view", text: "Sit where your face is visible and put a light in front of you."},
    multiple: {title: "Use a frame with just you", text: "More than one face is visible, so individual camera cues are paused."},
    framing: {title: "Check your framing", text: "Place the camera at eye level and leave a little space above your head."},
    away: {title: "Reconnect with the lens", text: "Your face or eyes appear turned away from your calibrated position. Glance toward the lens as you finish a point; natural glances are fine."},
    movement: {title: "Notice repeated movement", text: "Repeated hand or upper-body movement is visible. If it’s unintentional, rest your hands between points. Keep gestures that help you explain."}
  };
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  class CameraSignals {
    constructor() { this.reset(); }
    reset() {
      this.baseline = null; this.calibration = null; this.previousTime = null;
      this.window = []; this.holds = {}; this.lastTip = -Infinity;
      this.events = []; this.observedMs = 0; this.visibleMs = 0; this.calibratedMs = 0;
      this.used = false;
    }
    pause() { this.previousTime = null; this.window = []; this.holds = {}; this.calibration = null; }
    calibrate() { this.calibration = []; this.baseline = null; this.holds = {}; }
    observe(f, time, record = true) {
      this.used = true;
      const gap = this.previousTime === null ? 0 : time - this.previousTime;
      const dt = gap > 0 && gap < 1500 ? gap : 0;
      this.previousTime = time;
      if (!dt) { this.window = []; this.holds = {}; }
      if (record && !this.calibration) {
        this.observedMs += dt;
        if (f.faceCount === 1) this.visibleMs += dt;
        if (this.baseline && f.faceCount === 1 && f.eyesOpen) this.calibratedMs += dt;
      }
      if (this.calibration) {
        if (f.faceCount !== 1 || !f.eyesOpen || !f.framed) this.calibration = [];
        else this.calibration.push({...f, time});
        const samples = this.calibration;
        if (samples.length >= 10 && time - samples[0].time >= 3000) {
          this.baseline = Object.fromEntries(["yaw", "pitch", "gaze"].map(key => [key, median(samples.map(s => s[key]))]));
          this.calibration = null;
          return {status: "calibrated", text: "Calibrated. Natural glances and gestures are welcome."};
        }
        return {status: "calibrating", text: f.faceCount === 1 && f.eyesOpen && f.framed
          ? "Look comfortably at the camera lens for 3 seconds…"
          : "Keep one face centered, eyes open, and look toward the lens to calibrate."};
      }
      // Use body-relative wrists, plus shoulder-center movement. Camera movement
      // and explanatory gestures can trigger this too, so never call it anxiety.
      if (f.body && f.faceCount === 1) this.window.push({time, ...f.body});
      else this.window = [];
      this.window = this.window.filter(sample => time - sample.time <= 6500);
      let travel = 0, reversals = 0, previousDirections = [0, 0, 0];
      for (let i = 1; i < this.window.length; i++) {
        const a = this.window[i - 1], b = this.window[i];
        const scale = (a.scale + b.scale) / 2;
        const pointsA = [a.center, ...a.wrists], pointsB = [b.center, ...b.wrists];
        pointsA.forEach((point, j) => {
          const next = pointsB[j];
          if (!point || !next) { previousDirections[j] = 0; return; }
          const dx = (next.x - point.x) / (j === 0 ? scale : 1);
          const dy = (next.y - point.y) / (j === 0 ? scale : 1);
          const distance = Math.hypot(dx, dy);
          if (distance < .025 || distance > .45) return;
          travel += distance;
          const direction = Math.sign(Math.abs(dx) > Math.abs(dy) ? dx : dy);
          if (previousDirections[j] && direction !== previousDirections[j]) reversals++;
          previousDirections[j] = direction;
        });
      }
      const b = this.baseline;
      const conditions = {
        multiple: f.faceCount > 1,
        missing: f.faceCount === 0,
        framing: f.faceCount === 1 && !f.framed,
        away: Boolean(b && f.faceCount === 1 && f.framed && f.eyesOpen &&
          (Math.abs(f.yaw - b.yaw) > .17 || Math.abs(f.pitch - b.pitch) > .14 || Math.abs(f.gaze - b.gaze) > .16)),
        movement: f.faceCount === 1 && this.window.length > 8 && time - this.window[0].time >= 5000 && travel > 2.8 && reversals >= 5
      };
      let cue = null;
      for (const key of Object.keys(conditions)) {
        if (!conditions[key]) { delete this.holds[key]; continue; }
        if (!this.holds[key]) this.holds[key] = {since: time, recorded: false};
        const hold = this.holds[key];
        const threshold = key === "away" || key === "movement" ? 4000 : 3000;
        if (time - hold.since >= threshold && !hold.recorded) {
          hold.recorded = true;
          if (record) this.events.push({kind: key, time});
          if (!cue && time - this.lastTip >= 15000) { cue = {kind:key, ...tips[key]}; this.lastTip = time; }
        }
      }
      return {status: b ? "tracking" : "needs-calibration", text: b
        ? "Camera coaching active · only sustained changes prompt a tip."
        : "Calibrate while looking at the lens to enable look-away tips.", cue};
    }
    summary() {
      return {used: this.used, calibrated: this.calibratedMs > 0, observedMs: this.observedMs,
        visibleMs: this.visibleMs, counts: Object.fromEntries(Object.keys(tips).map(key => [key, this.events.filter(e => e.kind === key).length]))};
    }
  }
  globalThis.CameraSignals = CameraSignals;
})();
