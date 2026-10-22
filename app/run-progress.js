"use strict";

// Coarse, truthful progress for a single engine run. The Rainier protocol does
// not stream Octave line events, so we never invent a line percentage: before
// the file manifest arrives the run is explicitly indeterminate.

const PHASES = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  SENDING: "sending",
  RUNNING: "running",
  RECEIVING: "receiving",
  DONE: "done",
  CANCELLED: "cancelled",
  TIMEOUT: "timeout",
  FAILED: "failed",
});

function now() {
  return Date.now();
}

class RunProgress {
  constructor(opts = {}) {
    this.timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : null;
    this.scriptLines = Number(opts.scriptLines) > 0 ? Number(opts.scriptLines) : 0;
    this.expectedFiles = Number.isFinite(opts.expectedFiles) ? Number(opts.expectedFiles) : null;
    this.filesReceived = 0;
    this.phase = PHASES.IDLE;
    this.startedAt = now();
    this.endedAt = null;
    this.elapsedMs = 0;
    this.percent = null;
    this.indeterminate = true;
    this.cancelled = false;
    this.cancelReason = null;
    this.error = null;
    this._onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    this._cancelHandlers = [];
    this._lastEmit = 0;
    this._emitTimer = null;
    this._closed = false;
  }

  start(phase = PHASES.CONNECTING, patch = {}) {
    this.startedAt = now();
    return this.update(phase, patch);
  }

  tick() {
    if (this._closed) return this.snapshot();
    this.elapsedMs = now() - this.startedAt;
    this._emit(false);
    return this.snapshot();
  }

  update(phase, patch = {}) {
    if (this._closed && phase !== PHASES.DONE) return this.snapshot();
    if (phase) this.phase = phase;
    if (Number.isFinite(patch.expectedFiles)) this.expectedFiles = Number(patch.expectedFiles);
    if (Number.isFinite(patch.filesReceived)) this.filesReceived = Number(patch.filesReceived);
    if (patch.error) this.error = String(patch.error);
    this.elapsedMs = now() - this.startedAt;
    this._recompute();
    this._emit(true);
    return this.snapshot();
  }

  setExpectedFiles(n) {
    return this.update(this.phase, { expectedFiles: n });
  }

  setFilesReceived(n) {
    return this.update(this.phase, { filesReceived: n });
  }

  _recompute() {
    if (this.phase === PHASES.DONE) {
      this.percent = 100;
      this.indeterminate = false;
      return;
    }
    if (this.phase === PHASES.CANCELLED || this.phase === PHASES.TIMEOUT || this.phase === PHASES.FAILED) {
      this.percent = null;
      this.indeterminate = false;
      return;
    }
    if (this.expectedFiles && this.expectedFiles > 0 && this.phase === PHASES.RECEIVING) {
      // 10% is the protocol handshake; file transfer is the remaining 90%.
      this.percent = Math.max(10, Math.min(99, Math.round(10 + 89 * (this.filesReceived / this.expectedFiles))));
      this.indeterminate = false;
      return;
    }
    this.percent = null;
    this.indeterminate = true;
  }

  snapshot() {
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      elapsedMs: this.elapsedMs || (now() - this.startedAt),
      timeoutMs: this.timeoutMs,
      timeoutRemainingMs: this.timeoutMs == null ? null : Math.max(0, this.timeoutMs - (this.elapsedMs || (now() - this.startedAt))),
      scriptLines: this.scriptLines,
      expectedFiles: this.expectedFiles,
      filesReceived: this.filesReceived,
      percent: this.percent,
      indeterminate: this.indeterminate,
      cancelled: this.cancelled,
      cancelReason: this.cancelReason,
      error: this.error,
      done: [PHASES.DONE, PHASES.CANCELLED, PHASES.TIMEOUT, PHASES.FAILED].includes(this.phase),
    };
  }

  cancel(reason = "cancelled") {
    if (this.cancelled) return this.snapshot();
    this.cancelled = true;
    this.cancelReason = String(reason || "cancelled");
    for (const fn of this._cancelHandlers.splice(0)) {
      try { fn(this.cancelReason); } catch { /* cancellation must not throw */ }
    }
    this.update(PHASES.CANCELLED);
    return this.snapshot();
  }

  onCancel(fn) {
    if (typeof fn !== "function") return () => {};
    if (this.cancelled) {
      try { fn(this.cancelReason); } catch {}
      return () => {};
    }
    this._cancelHandlers.push(fn);
    return () => {
      const i = this._cancelHandlers.indexOf(fn);
      if (i >= 0) this._cancelHandlers.splice(i, 1);
    };
  }

  finish(phase = PHASES.DONE, patch = {}) {
    if (this._closed) return this.snapshot();
    this.endedAt = now();
    this.elapsedMs = this.endedAt - this.startedAt;
    this._closed = true;
    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
    }
    this.phase = phase;
    if (patch.error) this.error = String(patch.error);
    this._recompute();
    this._emit(true);
    return this.snapshot();
  }

  _emit(force) {
    if (!this._onProgress) return;
    const t = now();
    if (!force && t - this._lastEmit < 200) {
      if (!this._emitTimer) {
        this._emitTimer = setTimeout(() => {
          this._emitTimer = null;
          this._emit(true);
        }, 200);
        if (this._emitTimer.unref) this._emitTimer.unref();
      }
      return;
    }
    this._lastEmit = t;
    try { this._onProgress(this.snapshot()); } catch { /* progress observers must not break a run */ }
  }
}

function parseRunDirective(script) {
  const m = String(script || "").match(/^\s*%\s*commlab-run\s+(\{.*\})\s*$/m);
  if (!m) return {};
  try {
    const raw = JSON.parse(m[1]);
    const out = {};
    if (Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0) out.timeoutMs = Math.round(raw.timeoutMs);
    if (Number.isFinite(raw.retries) && raw.retries >= 0) out.retries = Math.floor(raw.retries);
    if (typeof raw.backend === "string" && raw.backend.trim()) out.backend = raw.backend.trim();
    if (Number.isFinite(raw.maxM) && raw.maxM > 1) out.maxM = Math.floor(raw.maxM);
    return out;
  } catch {
    return {};
  }
}

function resolveTimeout(exp, fallbackMs = 90000) {
  const sim = (exp && exp.simulation) || {};
  if (Number.isFinite(sim.timeoutMs) && sim.timeoutMs > 0) return Math.round(sim.timeoutMs);
  const observers = (exp && exp.observers) || [];
  const isBer = observers.some((o) => /BER|Conv|Hamming/i.test(o.fn || ""));
  return isBer ? 300000 : fallbackMs;
}

function resolveRetries(exp, fallback = 1) {
  const sim = (exp && exp.simulation) || {};
  return Number.isFinite(sim.retries) && sim.retries >= 0 ? Math.floor(sim.retries) : fallback;
}

module.exports = {
  PHASES,
  RunProgress,
  parseRunDirective,
  resolveTimeout,
  resolveRetries,
};
