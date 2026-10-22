#!/usr/bin/env node
"use strict";

// Packaged smoke test for CommLab Studio.
// Launches an already-built portable/unpacked app, talks to the renderer over
// the Chrome DevTools Protocol, runs the requested experiments and writes a
// machine-readable report. It only terminates the process tree it started.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const WebSocket = require("ws");

const DEFAULT_ORDERS = [1, 8, 25, 30, 31, 33, 37];

function usage() {
  console.log(`Usage: node tools/smoke-packaged.js --app <exe-or-unpacked-dir> [options]

Options:
  --app <path>          CommLab Studio.exe or its unpacked directory (required)
  --label <name>        Label written into the report
  --orders <csv>        Experiment orders (default: ${DEFAULT_ORDERS.join(",")})
  --user-data <dir>     Isolated userData directory (default: temporary)
  --out <file>          JSON report path (default: temporary)
  --timeout <ms>        Per-experiment timeout (default: 180000)
  --help                Show this help`);
}

function parseArgs(argv) {
  const opts = { label: "", orders: DEFAULT_ORDERS.slice(), timeout: 180000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { usage(); process.exit(0); }
    if (a === "--app") { opts.app = argv[++i]; continue; }
    if (a === "--label") { opts.label = argv[++i] || ""; continue; }
    if (a === "--orders") {
      const value = String(argv[++i] || "");
      opts.orders = value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
      continue;
    }
    if (a === "--user-data") { opts.userData = argv[++i]; continue; }
    if (a === "--out") { opts.out = argv[++i]; continue; }
    if (a === "--timeout") { opts.timeout = Number(argv[++i]); continue; }
    throw new Error("unknown argument: " + a);
  }
  if (!opts.app) throw new Error("--app is required");
  if (!opts.orders.length) throw new Error("--orders must contain at least one order");
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) throw new Error("--timeout must be positive");
  return opts;
}

function resolveExecutable(input) {
  const p = path.resolve(input);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    const direct = path.join(p, "CommLab Studio.exe");
    if (fs.existsSync(direct)) return direct;
    throw new Error("CommLab Studio.exe not found in " + p);
  }
  throw new Error("--app path does not exist: " + p);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs || 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function waitForTarget(port, deadline) {
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`, 800);
      const pages = Array.isArray(targets) ? targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl) : [];
      const main = pages.find((t) => /renderer[\\/]index\.html/i.test(String(t.url || ""))) || pages[0];
      if (main) return main;
      lastError = new Error("page target not ready");
    } catch (e) {
      lastError = e;
    }
    await sleep(200);
  }
  throw new Error("CDP page target not found: " + (lastError && lastError.message || "timeout"));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
  }

  connect(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), timeoutMs || 10000);
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      this.ws = ws;
      ws.on("open", () => { clearTimeout(timer); resolve(); });
      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else pending.resolve(msg.result);
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        if (!this.closed) reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
      ws.on("close", () => {
        this.closed = true;
        for (const p of this.pending.values()) p.reject(new Error("CDP websocket closed"));
        this.pending.clear();
      });
    });
  }

  send(method, params, timeoutMs) {
    if (!this.ws || this.closed) return Promise.reject(new Error("CDP websocket is not open"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out"));
      }, timeoutMs || 15000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async evaluate(expression, timeoutMs) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs || 15000);
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || "evaluation failed";
      throw new Error(String(text));
    }
    return r && r.result ? r.result.value : undefined;
  }

  close() {
    this.closed = true;
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

function killOwnedTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 15000 });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
}

function inside(base, target) {
  const b = path.resolve(base).toLowerCase();
  const t = path.resolve(target).toLowerCase();
  return t === b || t.startsWith(b + path.sep.toLowerCase());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const exe = resolveExecutable(opts.app);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = opts.label || path.basename(path.dirname(exe));
  const userData = path.resolve(opts.userData || path.join(os.tmpdir(), `commlab-smoke-${stamp}`));
  const outFile = path.resolve(opts.out || path.join(os.tmpdir(), `commlab-smoke-${stamp}.json`));
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`];
  const env = {
    ...process.env,
    COMMLAB_USER_DATA: userData,
  };
  delete env.COMMLAB_RUNS_DIR;
  delete env.COMMLAB_TEST_OPEN;
  delete env.COMMLAB_TEST_RUN;

  let child = null;
  let cdp = null;
  let stderr = "";
  let stdout = "";
  let startupMs = null;
  const startedAt = Date.now();
  const report = {
    schema: "commlab-packaged-smoke/v1",
    label,
    executable: exe,
    userData,
    cdpPort: port,
    startedAt: new Date().toISOString(),
    orders: opts.orders,
    startupMs: null,
    app: null,
    coursepack: null,
    runs: [],
    ok: false,
    error: null,
  };

  try {
    child = spawn(exe, args, {
      cwd: path.dirname(exe),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", (err) => { stderr += "\nspawn error: " + String((err && err.stack) || err); });
    child.stdout.on("data", (b) => { if (stdout.length < 200000) stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { if (stderr.length < 200000) stderr += b.toString("utf8"); });

    const target = await waitForTarget(port, Date.now() + 30000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect(15000);

    const ready = await cdp.evaluate(`(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (window.api && typeof window.api.runExperiment === "function" && document.readyState !== "loading") {
          return { ready: true, title: document.title, href: location.href };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ready: false, title: document.title, href: location.href };
    })()`, 35000);
    if (!ready || !ready.ready) throw new Error("renderer API did not become ready");
    startupMs = Date.now() - startedAt;
    report.startupMs = startupMs;
    report.app = ready;

    const appInfo = await cdp.evaluate(`(async () => {
      const list = await window.api.list();
      const coursepack = await window.api.coursepackStatus();
      return {
        experimentCount: list && Array.isArray(list.experiments) ? list.experiments.length : null,
        coursepack,
        userAgent: navigator.userAgent,
      };
    })()`, 20000);
    report.app.experimentCount = appInfo.experimentCount;
    report.coursepack = appInfo.coursepack;
    report.app.userAgent = appInfo.userAgent;

    const expectedRunsRoot = path.join(userData, "runs");
    for (const order of opts.orders) {
      const t0 = Date.now();
      const run = await cdp.evaluate(`(async () => {
        const started = performance.now();
        const r = await window.api.runExperiment(${Number(order)}, { clientRunId: "smoke-${stamp}-${Number(order)}" });
        return {
          ok: r && r.ok === true,
          status: r && r.status || null,
          backend: r && r.backend || null,
          reason: r && r.reason || null,
          results: r && Array.isArray(r.results) ? r.results.length : 0,
          metrics: r && Array.isArray(r.metrics) ? r.metrics.length : 0,
          elapsedMs: r && Number.isFinite(r.elapsedMs) ? r.elapsedMs : Math.round(performance.now() - started),
          dir: r && r.dir || null,
          logTail: r && r.log ? String(r.log).slice(-800) : "",
          warnings: r && Array.isArray(r.warnings) ? r.warnings.length : 0,
        };
      })()`, opts.timeout + 30000);
      const wallMs = Date.now() - t0;
      const expectedDir = path.join(expectedRunsRoot, String(order));
      const dirOk = !!run.dir && inside(expectedRunsRoot, run.dir);
      const sceneFile = path.join(expectedDir, "scene.octave");
      const sceneExists = fs.existsSync(sceneFile);
      const entry = {
        order,
        ...run,
        wallMs,
        expectedDir,
        dirOk,
        sceneExists,
      };
      report.runs.push(entry);
      console.log(`[${label}] order ${order}: ok=${entry.ok} backend=${entry.backend || "-"} results=${entry.results} metrics=${entry.metrics} elapsed=${entry.elapsedMs}ms dirOk=${entry.dirOk} scene=${entry.sceneExists}`);
      if (!entry.ok) throw new Error(`order ${order} failed: ${entry.reason || entry.status || "unknown"}`);
      if (!entry.dirOk) throw new Error(`order ${order} wrote outside userData runs: ${entry.dir || "null"}`);
      if (!entry.sceneExists) throw new Error(`order ${order} did not create scene.octave`);
    }

    const hasOutput = report.runs.some((r) => r.results > 0 || r.metrics > 0);
    if (!hasOutput) throw new Error("all experiments returned zero results and zero metrics");
    report.ok = true;
  } catch (err) {
    report.error = String((err && err.stack) || err);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - startedAt;
    report.stdoutTail = stdout.slice(-12000);
    report.stderrTail = stderr.slice(-12000);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    if (cdp) cdp.close();
    killOwnedTree(child && child.pid);
    console.log(`report: ${outFile}`);
    if (report.ok) {
      console.log(`PASS ${label}: ${report.runs.length}/${report.runs.length} experiments ok; startup=${report.startupMs}ms; total=${report.totalMs}ms`);
    } else {
      console.error(`FAIL ${label}: ${report.error}`);
    }
  }
}

main().catch((err) => {
  console.error(String((err && err.stack) || err));
  process.exit(1);
});
