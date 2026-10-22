"use strict";

// 9002 engine facade.
//
// Layers:
//   runScript(script)          low-level Rainier/Octave compatibility API
//   runBackend(kind, job)      stable backend-neutral API (Rainier today, native JS later)
//
// A backend receives the normalized job (experiment/circuit/script), never a
// Rainier-specific requirement. The Rainier adapter compiles the job to Octave;
// a future native backend can execute the same job in JavaScript.

const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execSync } = require("child_process");
const WebSocket = require("ws");
const {
  RunProgress,
  PHASES,
  parseRunDirective,
  resolveTimeout,
  resolveRetries,
} = require("./run-progress");
const { buildScene } = require("./scene");
const { buildGraphScript } = require("./graph");

const ENGINE_ID = "com.rainier.osgi.plugin.cms.engine.octave";
const PORT = 9002;
const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
let engineReady = false;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}

function portOpen(port = PORT, host = "127.0.0.1", timeout = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeError(message, code, cause) {
  const e = new Error(message);
  e.code = code || "ENGINE_ERROR";
  if (cause) e.cause = cause;
  return e;
}

async function waitForPort(predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function ensureEngine(cfg, log = () => {}, opts = {}) {
  const conf = cfg || readConfig();
  if (await portOpen(PORT)) {
    if (engineReady) return true;
    if (await probeReady(20000)) {
      engineReady = true;
      log("engine ready");
      return true;
    }
    log("engine listener is not ready; restarting");
    await stopEngine(conf, log);
  }
  if (!conf.engineExe) throw makeError("未配置 Rainier 引擎路径", "ENGINE_NOT_CONFIGURED");
  if (!fs.existsSync(conf.engineExe)) throw makeError("未找到引擎：" + conf.engineExe, "ENGINE_NOT_FOUND");
  if (portListening()) {
    log("engine stale listener; cleaning");
    await stopEngine(conf, log);
  }
  spawn(conf.engineExe, [], {
    cwd: path.dirname(conf.engineExe),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 60000;
  log("engine starting");
  if (!(await waitForPort(() => portOpen(PORT), timeoutMs))) {
    throw makeError("引擎启动超时：9002 未监听", "ENGINE_START_TIMEOUT");
  }
  if (!(await probeReady(20000))) {
    throw makeError("引擎已监听但 Octave 插件未就绪", "ENGINE_NOT_READY");
  }
  engineReady = true;
  log("engine up");
  return true;
}

function killPid(pid) {
  try { execSync("taskkill /F /PID " + Number(pid), { stdio: "ignore", timeout: 8000 }); }
  catch { /* already gone or access denied */ }
}

function portListening() {
  return listeningPids().length > 0;
}

function listeningPids() {
  const pids = new Set();
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", timeout: 8000 });
    for (const line of out.split(/\r?\n/)) {
      if (!/:9002\b/.test(line) || !/LISTENING/i.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
  } catch { /* netstat unavailable */ }
  return [...pids].filter((p) => p > 0);
}

async function stopEngine(cfg, log = () => {}) {
  engineReady = false;
  const conf = cfg || readConfig();
  const image = conf.engineExe ? path.basename(conf.engineExe) : "com_rainier_osgi_gui.exe";
  try { execSync("taskkill /IM " + image + " /F /T", { stdio: "ignore", timeout: 8000 }); }
  catch { /* not running */ }
  await sleep(800);
  for (const pid of listeningPids()) killPid(pid);
  const closed = await waitForPort(async () => !portListening(), 8000);
  if (!closed) log("engine stop: port 9002 is still listening");
  return closed;
}

async function restartEngine(cfg, log = () => {}) {
  engineReady = false;
  const conf = cfg || readConfig();
  await stopEngine(conf, log);
  await sleep(500);
  return ensureEngine(conf, log);
}

function envelope(kind, serial, content) {
  const tail = "<engine-id>" + ENGINE_ID + "</engine-id><serial-id>" + serial + "</serial-id>\n";
  if (kind === "cmd") {
    return "<user-cmd-msg>\n<client-id>-1</client-id>\n<need-return>1</need-return>\n" + tail +
      "<content>" + content + "</content>\n</user-cmd-msg>\n";
  }
  return "<user-scene-msg>\n<client-id>-1</client-id>\n<need-return>1</need-return>\n<content-type>base64</content-type>\n" + tail +
    "<content>" + content + "</content>\n</user-scene-msg>\n";
}

function cleanText(buf) {
  return buf ? buf.toString("utf8").replace(/\u0000/g, "").trim() : "";
}

function logHasError(log) {
  return /(^|\n)\s*(error|错误)[:：]/i.test(log) ||
    /must have the same|no figure to print|out of memory|segmentation/i.test(log);
}

async function probeReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const left = Math.max(1000, deadline - Date.now());
    try {
      const r = await runScriptDetailed("disp('engine-ready');\nsave rainier.mat\n", {
        timeoutMs: Math.min(8000, left),
        respectScriptTimeout: false,
      });
      if (r.files.has("rainier.mat") || r.files.has("out.txt")) return true;
    } catch { /* plugin may still be loading */ }
    await sleep(500);
  }
  return false;
}

function runScriptOnce(script, opts = {}) {
  const text = String(script || "");
  if (!text.trim()) return Promise.reject(makeError("空脚本", "INVALID_SCRIPT"));
  const directive = parseRunDirective(text);
  const fallbackMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 60000;
  const timeoutMs = opts.respectScriptTimeout === false
    ? fallbackMs
    : (directive.timeoutMs || fallbackMs);

  let progress = opts.progress;
  if (!(progress instanceof RunProgress) || progress.snapshot().done) {
    progress = new RunProgress({
      timeoutMs,
      scriptLines: text.split(/\r?\n/).length,
      onProgress: opts.onProgress,
    });
  }
  progress.timeoutMs = timeoutMs;
  progress.scriptLines = text.split(/\r?\n/).length;
  progress.start(PHASES.CONNECTING);

  const startedAt = Date.now();
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const files = new Map();
  let expected = null;
  let serial = 0;
  let settled = false;
  let ws = null;
  let opened = false;
  let timer = null;
  let heartbeat = null;
  let settleTimer = null;

  return new Promise((resolve, reject) => {
    function send(kind, content) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(envelope(kind, serial, content));
        serial += 1;
        return true;
      } catch {
        return false;
      }
    }

    function stopCommands() {
      send("cmd", "bg_halt");
      send("cmd", "quit");
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (settleTimer) clearTimeout(settleTimer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }

    function finish(err, status) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        engineReady = false;
        stopCommands();
        progress.finish(status || (err.code === "TIMEOUT" ? PHASES.TIMEOUT : err.code === "ABORTED" ? PHASES.CANCELLED : PHASES.FAILED), { error: err.message });
        try { ws && ws.close(); } catch {}
        reject(err);
        return;
      }
      engineReady = true;
      progress.finish(PHASES.DONE);
      try { ws && ws.close(); } catch {}
      resolve({
        status: "ok",
        files,
        log: cleanText(files.get("out.txt")),
        elapsedMs: Date.now() - startedAt,
        progress: progress.snapshot(),
        directive,
      });
    }

    function fail(message, code, status, stage) {
      const err = makeError(message, code);
      if (stage) err.stage = stage;
      finish(err, status);
    }

    function onAbort() {
      const reason = opts.signal && opts.signal.reason ? String(opts.signal.reason) : "cancelled";
      progress.cancel(reason);
      fail("运行已取消", "ABORTED", PHASES.CANCELLED);
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      fail("引擎超时（" + Math.round(timeoutMs / 1000) + "s）", "TIMEOUT", PHASES.TIMEOUT);
    }, timeoutMs);
    heartbeat = setInterval(() => { if (!settled) progress.tick(); }, 1000);
    if (heartbeat.unref) heartbeat.unref();

    try {
      ws = new WebSocket("ws://localhost:9002");
    } catch (e) {
      fail("无法创建引擎连接：" + e.message, "ENGINE_ERROR");
      return;
    }

    ws.on("open", () => {
      if (settled) return;
      opened = true;
      log("engine connected");
      progress.update(PHASES.SENDING);
      send("cmd", "bg_halt");
      send("scene", Buffer.from(text, "utf8").toString("base64"));
      send("cmd", "bg_run");
      progress.update(PHASES.RUNNING);
    });

    ws.on("message", (raw) => {
      if (settled) return;
      const message = String(raw);
      const m = message.match(/<content>([\s\S]*?)<\/content>/);
      if (!m) return;
      const content = m[1];

      if (content.indexOf("@@OutputStart@@") >= 0) {
        const fl = content.match(/FileCount:(\d+)/);
        expected = fl ? Number(fl[1]) : null;
        progress.setExpectedFiles(expected);
        progress.update(PHASES.RECEIVING);
        return;
      }

      if (content.indexOf("DATA[") >= 0) {
        const body = content.slice(content.indexOf("@[") + 2);
        let changed = false;
        for (const part of body.split("*****")) {
          const mm = part.match(/^\[(.+?)\]###\[([\s\S]*?)\]$/);
          if (!mm) continue;
          files.set(mm[1], Buffer.from(mm[2], "base64"));
          changed = true;
        }
        if (changed) progress.update(PHASES.RECEIVING, { filesReceived: files.size });
        if (expected != null && files.size >= expected) {
          finish();
        } else if (expected == null && changed) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => finish(), 750);
        }
      }
    });

    ws.on("error", (e) => {
      fail("引擎连接中断" + (e && e.message ? "：" + e.message : ""), "ENGINE_ERROR", null, opened ? "run" : "connect");
    });
    ws.on("close", () => {
      if (!settled) fail("引擎连接中断（WebSocket 已关闭）", "ENGINE_ERROR", null, opened ? "run" : "connect");
    });
  });
}

async function runScriptDetailed(script, opts = {}) {
  const connectRetries = Number.isFinite(opts.connectRetries) ? Math.max(0, Math.floor(opts.connectRetries)) : 2;
  let lastError = null;
  for (let i = 0; i <= connectRetries; i++) {
    try {
      return await runScriptOnce(script, opts);
    } catch (e) {
      lastError = e;
      if (!(e && e.code === "ENGINE_ERROR" && e.stage === "connect") || i >= connectRetries) throw e;
      await sleep(250 + i * 250);
    }
  }
  throw lastError;
}

function runScript(script, opts) {
  return runScriptDetailed(script, opts).then((r) => r.files);
}

function createRunController(opts = {}) {
  const controller = new AbortController();
  const progress = new RunProgress({
    timeoutMs: opts.timeoutMs,
    scriptLines: opts.scriptLines,
    onProgress: opts.onProgress,
  });
  return {
    signal: controller.signal,
    progress,
    cancel(reason = "cancelled") {
      progress.cancel(reason);
      controller.abort(reason);
    },
  };
}

// ---------------------------------------------------------------------------
// Backend registry / normalized job API
// ---------------------------------------------------------------------------

const backends = new Map();

function registerBackend(id, impl) {
  if (!id || typeof id !== "string") throw makeError("backend id 必须是非空字符串", "INVALID_BACKEND");
  if (!impl || typeof impl.run !== "function") throw makeError("backend 必须实现 run(job, opts)", "INVALID_BACKEND");
  const backend = {
    id,
    label: impl.label || id,
    available: typeof impl.available === "function" ? impl.available : () => true,
    prepare: typeof impl.prepare === "function" ? impl.prepare : null,
    run: impl.run,
  };
  backends.set(id, backend);
  return backend;
}

function listBackends() {
  return [...backends.keys()];
}

function getBackend(id) {
  return backends.get(id) || null;
}

function normalizeJob(input) {
  if (!input || typeof input !== "object") throw makeError("runBackend 需要一个 job 对象", "INVALID_JOB");
  if (input.schemaVersion === 1 && input.kind) return input;
  if (input.experiment) {
    return { schemaVersion: 1, kind: "experiment", experiment: input.experiment, meta: input.meta || {} };
  }
  if (input.chain && input.observers) {
    return { schemaVersion: 1, kind: "experiment", experiment: input, meta: input.meta || {} };
  }
  if (input.nodes && input.edges) {
    return { schemaVersion: 1, kind: "circuit", nodes: input.nodes, edges: input.edges, meta: input.meta || {} };
  }
  if (typeof input.script === "string") {
    return { schemaVersion: 1, kind: "script", script: input.script, manifest: input.manifest || [], meta: input.meta || {} };
  }
  throw makeError("无法识别的 job：需要 experiment / nodes+edges / script", "INVALID_JOB");
}


function splitArgs(text) {
  const out = [];
  let cur = "", depth = 0;
  for (const ch of String(text == null ? "" : text)) {
    if (ch === "[") depth += 1;
    if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

let deviceCatalog = null;
function loadDeviceCatalog() {
  if (deviceCatalog) return deviceCatalog;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "devices.json"), "utf8"));
    deviceCatalog = new Map((Array.isArray(list) ? list : []).map((d) => [d.className, d]));
  } catch {
    deviceCatalog = new Map();
  }
  return deviceCatalog;
}

function findDevice(className) {
  const byCn = loadDeviceCatalog();
  if (byCn.has(className)) return byCn.get(className);
  if (byCn.has(className + "_Comm")) return byCn.get(className + "_Comm");
  if (String(className).startsWith("Sourse_")) {
    const alt = "Source_" + String(className).slice(7);
    if (byCn.has(alt + "_Comm")) return byCn.get(alt + "_Comm");
  }
  return null;
}

// Convert one experiments.json entry into the graph shape consumed by the
// native kernel.  This mirrors tools/native-qa/run.js so the app and QA exercise
// the same node/edge construction.
function experimentToGraph(exp) {
  if (!exp || typeof exp !== "object") throw makeError("experimentToGraph 需要实验对象", "INVALID_JOB");
  const nodes = [];
  const edges = [];
  const varNode = new Map();
  let seq = 0;

  const sim = exp.simulation || {};
  const chain = Array.isArray(sim.nativeChain) ? sim.nativeChain : (exp.chain || []);
  const observers = Array.isArray(sim.nativeObservers) ? sim.nativeObservers : (exp.observers || []);

  for (const item of chain) {
    seq += 1;
    const dev = findDevice(item.fn) || { className: item.fn, componentName: item.fn, inputs: 0, outputs: 0 };
    const id = "n" + seq;
    const tokens = splitArgs(item.args);
    const ins = [];
    const vals = [];
    for (const token of tokens) {
      if (varNode.has(token)) ins.push(varNode.get(token));
      else vals.push(token);
    }
    nodes.push({
      id,
      className: dev.className,
      componentName: dev.componentName || item.fn,
      inputs: dev.inputs || 0,
      outputs: dev.outputs || 0,
      values: vals,
    });
    varNode.set(item.var, id);
    ins.forEach((source, port) => edges.push({ from: source, fromPort: 0, to: id, toPort: port }));
  }

  for (const item of observers) {
    seq += 1;
    const dev = findDevice(item.fn) || { className: item.fn, componentName: item.fn, inputs: 1, outputs: 0 };
    const id = "n" + seq;
    const tokens = splitArgs(item.args);
    const sources = [];
    const vals = [];
    for (const token of tokens) {
      if (varNode.has(token)) sources.push(varNode.get(token));
      else vals.push(token);
    }
    nodes.push({
      id,
      className: dev.className,
      componentName: dev.componentName || item.fn,
      inputs: Math.max(dev.inputs || 0, sources.length),
      outputs: dev.outputs || 0,
      values: vals,
    });
    sources.forEach((source, port) => edges.push({ from: source, fromPort: 0, to: id, toPort: port }));
  }

  return { nodes, edges };
}

function compileJob(job) {
  if (job.kind === "experiment") {
    const built = buildScene(job.experiment);
    return { ...built, directive: parseRunDirective(built.script) };
  }
  if (job.kind === "circuit") {
    const built = buildGraphScript(job.nodes, job.edges);
    return { ...built, directive: parseRunDirective(built.script) };
  }
  if (job.kind === "script") {
    return {
      script: job.script,
      manifest: job.manifest || [],
      warnings: [],
      runOptions: parseRunDirective(job.script),
      directive: parseRunDirective(job.script),
    };
  }
  throw makeError("未知 job.kind：" + job.kind, "INVALID_JOB");
}

function filesToResults(files, manifest) {
  const results = [];
  for (const item of manifest || []) {
    if (!item.file) continue;
    const buf = files.get(item.file);
    if (!buf) continue;
    const clean = buf.toString("utf8").replace(/\u0000/g, "");
    results.push({ file: item.file, device: item.device, fn: item.fn, svg: clean });
  }
  return results;
}

function normalizeBackendResult(result, backendId, job, startedAt) {
  const r = result instanceof Map ? { files: result } : (result || {});
  const files = r.files instanceof Map ? r.files : new Map();
  const manifest = Array.isArray(r.manifest) ? r.manifest : [];
  const results = Array.isArray(r.results) ? r.results : filesToResults(files, manifest);
  const log = r.log != null ? String(r.log) : cleanText(files.get("out.txt"));
  const hasLogError = logHasError(log);
  const status = r.status || (hasLogError ? (results.length ? "partial" : "failed") : "ok");
  return {
    ok: r.ok !== false && status !== "failed",
    status,
    backend: backendId,
    jobKind: job.kind,
    attempts: 1,
    files,
    results,
    log,
    manifest,
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    progress: r.progress || null,
    elapsedMs: Number.isFinite(r.elapsedMs) ? r.elapsedMs : Date.now() - startedAt,
    script: r.script || null,
  };
}

registerBackend("rainier", {
  label: "Rainier OWVLab / Octave WebSocket 9002",
  available: () => true,
  async run(job, opts = {}) {
    const built = compileJob(job);
    const cfg = opts.cfg || readConfig();
    if (opts.ensureEngine !== false) await ensureEngine(cfg, opts.log || (() => {}));
    const configured = opts.timeoutMs ||
      (job.experiment ? resolveTimeout(job.experiment) : null) ||
      built.directive.timeoutMs ||
      (built.runOptions && built.runOptions.timeoutMs) ||
      180000;
    const detailed = await runScriptDetailed(built.script, {
      ...opts,
      timeoutMs: configured,
      respectScriptTimeout: false,
    });
    return {
      ok: true,
      status: "ok",
      backend: "rainier",
      jobKind: job.kind,
      files: detailed.files,
      log: detailed.log,
      manifest: built.manifest,
      warnings: built.warnings || [],
      progress: detailed.progress,
      elapsedMs: detailed.elapsedMs,
      script: built.script,
      runOptions: { ...built.runOptions, timeoutMs: configured },
    };
  },
});

function isNativeUnsupportedError(error) {
  return /native kernel:\s*unsupported device class/i.test(String((error && error.message) || error || ""));
}

async function runBackend(kind, graph, opts = {}) {
  const baseJob = normalizeJob(graph);
  const requested = String(kind || opts.backend || "auto");
  let backendId = requested;
  if (requested === "auto") {
    if (opts.prefer && backends.has(opts.prefer) && backends.get(opts.prefer).available()) {
      backendId = opts.prefer;
    } else if (backends.has("native") && backends.get("native").available()) {
      backendId = "native";
    } else {
      backendId = "rainier";
    }
  }

  const cfg = opts.cfg || readConfig();
  const retries = Number.isFinite(opts.retries)
    ? Math.max(0, Math.floor(opts.retries))
    : (baseJob.experiment ? resolveRetries(baseJob.experiment) : 0);
  const maxAttempts = 1 + retries;
  const retryTimeout = opts.retryOnTimeout === true ||
    !!(baseJob.experiment && baseJob.experiment.simulation && baseJob.experiment.simulation.retryOnTimeout === true);
  const startedAt = Date.now();
  let lastError = null;
  let fallbackFrom = null;
  let nativeFallbackTried = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const backend = backends.get(backendId);
    if (!backend) {
      throw makeError("后端未注册：" + backendId + "（可用：" + listBackends().join(", ") + "）", "BACKEND_UNAVAILABLE");
    }
    if (!backend.available()) {
      throw makeError("后端当前不可用：" + backendId, "BACKEND_UNAVAILABLE");
    }

    if (attempt > 1) {
      if (typeof opts.onRetry === "function") {
        try { opts.onRetry({ attempt, maxAttempts, error: lastError }); } catch {}
      }
      if (backendId === "rainier" && opts.restartOnRetry !== false) {
        await restartEngine(cfg, opts.log || (() => {}));
      }
    }

    let job = baseJob;
    if (backendId === "native" && job.kind === "experiment") {
      job = { ...job, ...experimentToGraph(job.experiment) };
    }

    try {
      if (backendId === "native") {
        if (opts.signal && opts.signal.aborted) throw makeError("运行已取消", "ABORTED");
        if (opts.progress && !opts.progress.snapshot().done) opts.progress.start(PHASES.RUNNING);
      }

      const result = await backend.run(job, { ...opts, cfg, attempt, maxAttempts });
      const normalized = normalizeBackendResult(result, backendId, baseJob, startedAt);
      normalized.attempts = attempt;
      normalized.elapsedMs = Number.isFinite(result && result.elapsedMs)
        ? result.elapsedMs
        : Date.now() - startedAt;

      if (fallbackFrom) {
        normalized.fallbackFrom = fallbackFrom;
        normalized.warnings = [
          ...normalized.warnings,
          {
            code: "BACKEND_FALLBACK",
            from: fallbackFrom,
            to: backendId,
            message: "native 不支持该器件，已自动回退到 Rainier",
          },
        ];
      }

      if (backendId === "native" && opts.progress && !opts.progress.snapshot().done) {
        const phase = normalized.ok ? PHASES.DONE : PHASES.FAILED;
        opts.progress.finish(phase, normalized.ok ? {} : { error: normalized.error || normalized.log });
        normalized.progress = opts.progress.snapshot();
      }

      if (!normalized.ok && attempt < maxAttempts) {
        lastError = makeError("后端返回失败状态：" + (normalized.error || normalized.status), "BACKEND_RESULT_FAILED");
        if (typeof opts.onRetry === "function") {
          try { opts.onRetry({ attempt: attempt + 1, maxAttempts, error: lastError }); } catch {}
        }
        if (backendId === "rainier" && opts.restartOnRetry !== false) {
          await restartEngine(cfg, opts.log || (() => {}));
        }
        continue;
      }
      return normalized;
    } catch (e) {
      lastError = e;

      // Auto mode is allowed to recover from a device class the native kernel
      // does not implement.  An explicit backend:"native" never falls back.
      const canFallback = requested === "auto" &&
        backendId === "native" &&
        !nativeFallbackTried &&
        isNativeUnsupportedError(e) &&
        backends.has("rainier") &&
        backends.get("rainier").available();
      if (canFallback) {
        nativeFallbackTried = true;
        fallbackFrom = "native";
        backendId = "rainier";
        if (typeof opts.onRetry === "function") {
          try {
            opts.onRetry({
              attempt,
              maxAttempts,
              error: e,
              fallbackFrom: "native",
              fallbackTo: "rainier",
            });
          } catch {}
        }
        attempt -= 1;
        continue;
      }

      if (backendId === "native" && opts.progress && !opts.progress.snapshot().done) {
        const phase = e.code === "TIMEOUT" ? PHASES.TIMEOUT : e.code === "ABORTED" ? PHASES.CANCELLED : PHASES.FAILED;
        opts.progress.finish(phase, { error: e.message });
      }

      const code = (e && e.code) || "ENGINE_ERROR";
      const retryable = !["ABORTED", "BACKEND_UNAVAILABLE", "INVALID_JOB", "INVALID_SCRIPT"].includes(code);
      if (code === "TIMEOUT" && !retryTimeout) throw e;
      if (!retryable || attempt >= maxAttempts) throw e;
    }
  }
  throw lastError || makeError("后端运行失败", "ENGINE_ERROR");
}

function loadExperiments() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "experiments.json"), "utf8")).experiments;
}

async function runExperiment(orderOrExp, opts = {}) {
  const exp = typeof orderOrExp === "number"
    ? loadExperiments().find((x) => x.order === Number(orderOrExp))
    : orderOrExp;
  if (!exp) throw makeError("未找到实验 " + orderOrExp, "EXPERIMENT_NOT_FOUND");
  const kind = opts.backend || (exp.simulation && exp.simulation.backend) || "auto";
  return runBackend(kind, { experiment: exp }, opts);
}

function runCircuit(nodes, edges, opts = {}) {
  return runBackend(opts.backend || "auto", { nodes, edges }, opts);
}

module.exports = {
  ENGINE_ID,
  PORT,
  ensureEngine,
  restartEngine,
  stopEngine,
  runScript,
  runScriptDetailed,
  createRunController,
  registerBackend,
  listBackends,
  getBackend,
  normalizeJob,
  runBackend,
  runExperiment,
  runCircuit,
  parseRunDirective,
  resolveTimeout,
  resolveRetries,
  experimentToGraph,
  PHASES,
  portOpen,
};
