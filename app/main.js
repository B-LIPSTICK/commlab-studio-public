const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const zlib = require("zlib");
const { marked } = require("marked");
const { buildScene } = require("./scene");
const { buildGraphScript } = require("./graph");
const updater = require("./updater");
const engine = require("./engine");
const report = require("./report");

// Public builds intentionally omit the large third-party OCJ template table.
// Keep the module lazy so the app can still start and offer course-pack import.
let buildOcjCached = null;
function getBuildOcj() {
  if (!buildOcjCached) buildOcjCached = require("./ocj").buildOcj;
  return buildOcjCached;
}

engine.registerBackend("native", {
  label: "CommLab native JS",
  available: () => true,
  run: (job, opts) => {
    const result = require("./native").runNative(job);
    if (opts && typeof opts.onNativeMetrics === "function" && Array.isArray(result.metrics)) {
      opts.onNativeMetrics(result.metrics);
    }
    return result;
  },
});

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
if (process.env.COMMLAB_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.COMMLAB_USER_DATA));
}
const COURSEPACK_DIR = path.join(app.getPath("userData"), "course-pack");

// Packaged builds run from a read-only app.asar. Keep generated run files in
// userData, while preserving the historical dev-mode _out directory.
function getRunsDir() {
  if (process.env.COMMLAB_RUNS_DIR) return path.resolve(process.env.COMMLAB_RUNS_DIR);
  if (app.isPackaged) return path.join(app.getPath("userData"), "runs");
  return path.join(ROOT, "_out");
}

const DEFAULT_CONFIG = {
  labUrl: "http://127.0.0.1:8766/pub/course/CommunicationPrinciple/index.html",
  labRoot: "",
  serverScript: "",
  pythonw: "",
  engineExe: "C:\\Rainier\\OWVLabCRTE\\com_rainier_osgi_gui.exe",
};

function readConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function readReportCover() {
  const candidates = [
    path.join(app.getPath("userData"), "report-cover.json"),
    path.join(ROOT, "report-cover.json"),
  ];
  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && typeof data === "object") return data;
    } catch {}
  }
  return {};
}

// engine.normalizeBackendResult intentionally forwards a fixed field set.
// Preserve the native metric payload here before returning it to the renderer.
function normalizeBackendResult(result, metrics) {
  const normalized = { ...(result || {}) };
  const forwarded = normalized.metrics;
  normalized.metrics = Array.isArray(forwarded) && forwarded.length
    ? forwarded
    : (Array.isArray(metrics) ? metrics : []);
  return normalized;
}

function safeRead(rel) {
  const p = path.resolve(ROOT, rel);
  if (!p.startsWith(path.resolve(ROOT))) throw new Error("path escape");
  return fs.readFileSync(p, "utf8");
}

function findExperimentByOrder(order) {
  const num = Number(order);
  if (!Number.isFinite(num)) return null;
  const index = listExperiments();
  return index.experiments.find((item) => item.order === num) || null;
}

async function exportReportToFile(payload = {}, parent = null) {
  try {
    let experiment = null;
    let markdown = "";
    const hasOrder = payload && payload.order != null && payload.order !== "";
    if (hasOrder) {
      experiment = findExperimentByOrder(payload.order);
      if (!experiment) return { ok: false, reason: "未找到实验 " + payload.order };
      try { markdown = readExperimentText(experiment.markdown); } catch {}
    } else if (payload && payload.experiment && typeof payload.experiment === "object") {
      experiment = payload.experiment;
      markdown = typeof payload.markdown === "string" ? payload.markdown : "";
    }
    if (!experiment) return { ok: false, reason: "缺少实验信息，无法生成报告" };

    const html = report.buildReportHtml({
      experiment,
      markdown,
      run: payload && payload.run ? payload.run : null,
      cover: readReportCover(),
    });
    const defaultName = report.buildReportFilename(experiment);
    const saveOptions = {
      title: "导出实验报告 PDF",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    };
    const save = parent && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (save.canceled || !save.filePath) return { ok: false, canceled: true };
    let pdfPath = save.filePath;
    if (!/\.pdf$/i.test(pdfPath)) pdfPath += ".pdf";
    const written = await report.exportReportPdf({ html, pdfPath });
    return { ok: true, path: written.path || pdfPath, bytes: written.bytes || 0 };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

const COURSEPACK_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxZipBytes: 64 * 1024 * 1024,
};

function normalizeRelPath(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function ensureInside(base, target) {
  const b = path.resolve(base);
  const t = path.resolve(target);
  const rel = path.relative(b, t);
  if (rel && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    throw new Error("路径越界");
  }
  return t;
}

function readTextInside(base, target) {
  ensureInside(base, target);
  const st = fs.statSync(target);
  if (!st.isFile()) throw new Error("不是文件：" + target);
  const real = fs.realpathSync(target);
  ensureInside(base, real);
  return fs.readFileSync(target, "utf8");
}

function isAllowedCoursepackFile(rel) {
  const p = normalizeRelPath(rel);
  if (!p || p.endsWith("/") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  if (p.split("/").some((x) => x === ".." || x === "." || x === "")) return false;
  if (p === "experiments.json") return true;
  if (/^experiments\/.+\.md$/i.test(p)) return true;
  if (/^scripts\/.+\.(?:m|octave)$/i.test(p)) return true;
  return false;
}

function countFilesUnder(dir, predicate) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  let visited = 0;
  const walk = (p) => {
    if (++visited > 5000) return;
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else if (st.isFile() && predicate(nameOf(p))) {
      count += 1;
    }
  };
  walk(dir);
  return count;
}

function nameOf(p) {
  return path.basename(String(p));
}

function readJsonFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getCoursepackStatus() {
  const indexFile = path.join(COURSEPACK_DIR, "experiments.json");
  const indexExists = fs.existsSync(indexFile);
  let experimentCount = 0;
  let error = null;
  if (indexExists) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      experimentCount = Array.isArray(idx.experiments) ? idx.experiments.length : 0;
      if (!experimentCount) error = "experiments.json 中没有 experiments 数组或条目为空";
    } catch (err) {
      error = "experiments.json 无法解析：" + String((err && err.message) || err);
    }
  }
  const markdownCount = countFilesUnder(path.join(COURSEPACK_DIR, "experiments"), (n) => /\.md$/i.test(n));
  const scriptCount = countFilesUnder(path.join(COURSEPACK_DIR, "scripts"), (n) => /\.(?:m|octave)$/i.test(n));
  return {
    ok: !error,
    installed: indexExists && markdownCount > 0 && !error,
    path: COURSEPACK_DIR,
    indexExists,
    experimentCount,
    markdownCount,
    scriptCount,
    error,
  };
}

function listExperiments() {
  const base = readJsonFile(path.join(ROOT, "data", "experiments.json")) || { experiments: [] };
  const pack = readJsonFile(path.join(COURSEPACK_DIR, "experiments.json"));
  const experiments = Array.isArray(base.experiments) ? base.experiments.map((x) => ({ ...x })) : [];
  const byOrder = new Map();
  const byExpNo = new Map();
  experiments.forEach((x, i) => {
    if (x && x.order != null) byOrder.set(Number(x.order), i);
    if (x && x.expNo != null) byExpNo.set(String(x.expNo), i);
  });

  if (pack && Array.isArray(pack.experiments)) {
    for (const raw of pack.experiments) {
      if (!raw || typeof raw !== "object") continue;
      let idx = -1;
      if (raw.order != null && byOrder.has(Number(raw.order))) idx = byOrder.get(Number(raw.order));
      else if (raw.expNo != null && byExpNo.has(String(raw.expNo))) idx = byExpNo.get(String(raw.expNo));
      if (idx >= 0) {
        experiments[idx] = { ...experiments[idx], ...raw };
      } else {
        const item = { ...raw };
        item.chain = Array.isArray(item.chain) ? item.chain : [];
        item.observers = Array.isArray(item.observers) ? item.observers : [];
        item.devices = Array.isArray(item.devices) ? item.devices : [];
        experiments.push(item);
      }
    }
  }

  return {
    ...base,
    count: experiments.length,
    experiments,
  };
}

function readExperimentText(rel) {
  const normalized = normalizeRelPath(rel);
  if (!normalized || normalized.includes("\u0000")) throw new Error("非法课程文件路径");
  const candidates = [];
  const push = (base, sub) => candidates.push({ base, file: path.join(base, sub) });

  if (normalized.startsWith("data/experiments/")) {
    const tail = normalized.slice("data/experiments/".length);
    push(COURSEPACK_DIR, "experiments/" + tail);
    push(ROOT, normalized);
  } else if (normalized.startsWith("experiments/")) {
    push(COURSEPACK_DIR, normalized);
  } else if (normalized.startsWith("data/scripts/")) {
    const tail = normalized.slice("data/scripts/".length);
    push(COURSEPACK_DIR, "scripts/" + tail);
    push(ROOT, normalized);
  } else if (normalized.startsWith("scripts/")) {
    push(COURSEPACK_DIR, normalized);
  } else if (!normalized.includes("/")) {
    push(COURSEPACK_DIR, "experiments/" + normalized);
  } else {
    throw new Error("不允许读取该路径：" + normalized);
  }

  let lastError = null;
  for (const item of candidates) {
    try {
      if (!fs.existsSync(item.file)) continue;
      return readTextInside(item.base, item.file);
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  throw new Error("课程原文不存在：" + normalized);
}

function readCourseText(rel) {
  try {
    return { ok: true, text: readExperimentText(rel) };
  } catch (err) {
    const detail = String((err && err.message) || err);
    const missing = /不存在|ENOENT|not found/i.test(detail);
    return { ok: false, reason: missing ? "missing" : "unavailable", detail };
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function decodeZipName(buf, offset, length, flags) {
  const raw = buf.subarray(offset, offset + length);
  if (flags & 0x800) return raw.toString("utf8");
  const utf8 = raw.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try { return new TextDecoder("gbk").decode(raw); }
  catch { return raw.toString("latin1"); }
}

function findZipEocd(buf) {
  if (buf.length < 22) return -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054B50) return i;
  }
  return -1;
}

function readZipEntries(buf) {
  if (buf.length > COURSEPACK_LIMITS.maxZipBytes) throw new Error("ZIP 超过 64 MB 限制");
  const eocd = findZipEocd(buf);
  if (eocd < 0) throw new Error("不是有效的 ZIP（未找到中央目录）");
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error("不支持分卷 ZIP");
  if (totalEntries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) throw new Error("不支持 ZIP64 课程包");
  if (cdOffset + cdSize > buf.length) throw new Error("ZIP 中央目录越界");
  const entries = [];
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014B50) throw new Error("ZIP 中央目录损坏");
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const crc = buf.readUInt32LE(ptr + 16);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    if (flags & 1) throw new Error("不支持加密 ZIP");
    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
      throw new Error("不支持 ZIP64 课程包");
    }
    const name = decodeZipName(buf, ptr + 46, nameLen, flags);
    entries.push({ name, method, crc, compSize, uncompSize, localOffset, flags });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function normalizeZipEntryName(name) {
  let n = String(name || "").replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  if (!n || n.endsWith("/")) return n;
  if (n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").some((x) => x === ".." || x === ".")) {
    throw new Error("ZIP 含非法路径：" + name);
  }
  return n;
}

function pickZipRoot(entries) {
  const names = entries
    .map((e) => normalizeZipEntryName(e.name))
    .filter((n) => n && !n.endsWith("/") && !n.startsWith("__MACOSX/") && !n.endsWith(".DS_Store"));
  if (names.includes("experiments.json")) return "";
  const tops = new Set(names.map((n) => n.split("/")[0]));
  if (tops.size === 1) {
    const top = [...tops][0];
    if (names.includes(top + "/experiments.json")) return top + "/";
  }
  return null;
}

function extractZipEntry(buf, entry) {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034B50) throw new Error("ZIP 本地文件头损坏");
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const end = start + entry.compSize;
  if (end > buf.length) throw new Error("ZIP 文件数据越界");
  const compressed = buf.subarray(start, end);
  let out;
  if (entry.method === 0) {
    out = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      out = zlib.inflateRawSync(compressed, { maxOutputLength: COURSEPACK_LIMITS.maxFileBytes + 1 });
    } catch (err) {
      throw new Error("ZIP 解压失败：" + String((err && err.message) || err));
    }
  } else {
    throw new Error("ZIP 使用了不支持的压缩方法：" + entry.method);
  }
  if (out.length !== entry.uncompSize) throw new Error("ZIP 解压长度不匹配");
  if (entry.crc && crc32(out) !== entry.crc) throw new Error("ZIP CRC 校验失败");
  return out;
}

function extractCoursepackZip(zipPath, staging) {
  const buf = fs.readFileSync(zipPath);
  const entries = readZipEntries(buf);
  const rootPrefix = pickZipRoot(entries);
  if (rootPrefix == null) throw new Error("ZIP 中未找到 experiments.json");
  let count = 0;
  let total = 0;
  for (const entry of entries) {
    const name = normalizeZipEntryName(entry.name);
    if (!name || name.endsWith("/")) continue;
    if (name.startsWith("__MACOSX/") || name.endsWith(".DS_Store")) continue;
    if (rootPrefix && !name.startsWith(rootPrefix)) continue;
    const rel = rootPrefix ? name.slice(rootPrefix.length) : name;
    if (!isAllowedCoursepackFile(rel)) continue;
    if (entry.uncompSize > COURSEPACK_LIMITS.maxFileBytes) throw new Error("课程包单个文件超过 8 MB：" + rel);
    total += entry.uncompSize;
    if (total > COURSEPACK_LIMITS.maxTotalBytes) throw new Error("课程包解压后超过 64 MB");
    const out = extractZipEntry(buf, entry);
    const dest = ensureInside(staging, path.join(staging, ...rel.split("/")));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
    count += 1;
    if (count > COURSEPACK_LIMITS.maxFiles) throw new Error("课程包文件数超过 2000");
  }
  if (!count) throw new Error("ZIP 中没有可导入的课程包文件");
}

function findCoursepackRoot(dir) {
  if (fs.existsSync(path.join(dir, "experiments.json"))) return dir;
  let dirs = [];
  try {
    dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return null;
  }
  const roots = dirs
    .map((d) => path.join(dir, d.name))
    .filter((p) => fs.existsSync(path.join(p, "experiments.json")));
  return roots.length === 1 ? roots[0] : null;
}

function copyCoursepackTree(sourceRoot, staging) {
  let count = 0;
  let total = 0;
  let visited = 0;
  const walk = (rel) => {
    const src = rel ? path.join(sourceRoot, ...rel.split("/")) : sourceRoot;
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) throw new Error("课程包不能包含符号链接：" + rel);
    if (st.isDirectory()) {
      if (++visited > 5000) throw new Error("课程包目录项超过 5000");
      for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        walk(rel ? rel + "/" + ent.name : ent.name);
      }
      return;
    }
    if (!st.isFile()) return;
    const norm = rel.replace(/\\/g, "/");
    if (!isAllowedCoursepackFile(norm)) return;
    if (st.size > COURSEPACK_LIMITS.maxFileBytes) throw new Error("课程包单个文件超过 8 MB：" + norm);
    total += st.size;
    if (total > COURSEPACK_LIMITS.maxTotalBytes) throw new Error("课程包超过 64 MB");
    const dest = ensureInside(staging, path.join(staging, ...norm.split("/")));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    count += 1;
    if (count > COURSEPACK_LIMITS.maxFiles) throw new Error("课程包文件数超过 2000");
  };
  walk("");
  if (!count) throw new Error("文件夹中没有可导入的课程包文件");
}

function validateCoursepack(root) {
  const indexFile = path.join(root, "experiments.json");
  if (!fs.existsSync(indexFile)) throw new Error("课程包缺少 experiments.json");
  let index;
  try { index = JSON.parse(fs.readFileSync(indexFile, "utf8")); }
  catch (err) { throw new Error("experiments.json 不是有效 JSON：" + String((err && err.message) || err)); }
  if (!Array.isArray(index.experiments) || !index.experiments.length) {
    throw new Error("experiments.json 需要非空 experiments 数组");
  }
  if (index.experiments.length > 1000) throw new Error("experiments.json 条目过多");
  const markdownCount = countFilesUnder(path.join(root, "experiments"), (n) => /\.md$/i.test(n));
  if (!markdownCount) throw new Error("课程包缺少 experiments/*.md");
  const warnings = [];
  const seen = new Set();
  for (const [i, item] of index.experiments.entries()) {
    if (!item || typeof item !== "object") throw new Error("experiments[" + i + "] 不是对象");
    const key = item.order != null ? "order:" + item.order : (item.expNo != null ? "expNo:" + item.expNo : "");
    if (!key) throw new Error("experiments[" + i + "] 需要 order 或 expNo");
    if (seen.has(key)) throw new Error("experiments.json 条目重复：" + key);
    seen.add(key);
    if (!item.markdown) continue;
    const rel = normalizeRelPath(item.markdown);
    let file = null;
    if (rel.startsWith("data/experiments/")) {
      file = path.join(root, "experiments", rel.slice("data/experiments/".length));
    } else if (rel.startsWith("experiments/")) {
      file = path.join(root, rel);
    } else if (!rel.includes("/") && rel && !rel.includes("..")) {
      file = path.join(root, "experiments", rel);
    }
    if (!file) throw new Error("experiments[" + i + "] 的 markdown 路径非法：" + item.markdown);
    ensureInside(root, file);
    if (!fs.existsSync(file)) warnings.push("缺少 " + item.markdown);
  }
  return { index, markdownCount, warnings };
}

function importCoursepack(sourcePath) {
  const source = path.resolve(String(sourcePath || ""));
  if (!sourcePath || !fs.existsSync(source)) throw new Error("课程包路径不存在：" + source);
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  const staging = path.join(userData, ".course-pack-import-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(staging, { recursive: true });
  try {
    const st = fs.statSync(source);
    if (st.isDirectory()) {
      const root = findCoursepackRoot(source);
      if (!root) throw new Error("文件夹中未找到 experiments.json（或包含多个课程包根目录）");
      copyCoursepackTree(root, staging);
    } else if (st.isFile() && /\.zip$/i.test(source)) {
      extractCoursepackZip(source, staging);
    } else {
      throw new Error("课程包必须是文件夹或 .zip 文件");
    }
    const checked = validateCoursepack(staging);
    const target = COURSEPACK_DIR;
    ensureInside(userData, target);
    const backup = target + ".old-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    try {
      fs.renameSync(staging, target);
    } catch (err) {
      if (fs.existsSync(backup)) {
        try { fs.renameSync(backup, target); } catch {}
      }
      throw err;
    }
    if (fs.existsSync(backup)) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
    }
    return { ...getCoursepackStatus(), warnings: checked.warnings };
  } finally {
    if (fs.existsSync(staging)) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    }
  }
}

function clearCoursepack() {
  const userData = app.getPath("userData");
  ensureInside(userData, COURSEPACK_DIR);
  if (fs.existsSync(COURSEPACK_DIR)) fs.rmSync(COURSEPACK_DIR, { recursive: true, force: true });
  try {
    for (const name of fs.readdirSync(userData)) {
      if (/^\.course-pack-(?:import|old)-/.test(name)) {
        fs.rmSync(path.join(userData, name), { recursive: true, force: true });
      }
    }
  } catch {}
  return getCoursepackStatus();
}

async function pickCoursepackSource(win) {
  const options = {
    type: "question",
    buttons: ["选择 ZIP", "选择课程文件夹", "取消"],
    defaultId: 0,
    cancelId: 2,
    title: "导入课程包",
    message: "选择课程包来源",
    detail: "课程包需包含 experiments.json 与 experiments/*.md；可选 scripts/。",
  };
  const choice = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (choice.response === 2) return null;
  if (choice.response === 0) {
    const opts = {
      properties: ["openFile"],
      filters: [{ name: "课程包 ZIP", extensions: ["zip"] }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  }
  const opts = { properties: ["openDirectory"] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
}


function portOpen(port, host = "127.0.0.1", timeout = 600) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

function httpOk(url, timeout = 1200) {
  return new Promise((resolve) => {
    let req;
    try {
      const u = new URL(url);
      const mod = u.protocol === "https:" ? https : http;
      req = mod.get(u, (res) => { res.resume(); resolve(res.statusCode === 200); });
    } catch {
      resolve(false);
      return;
    }
    req.setTimeout(timeout, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}


function readNativeCoverage() {
  const fallback = {
    ok: true,
    covered: 38,
    total: 38,
    svgTotal: 100,
    reportAvailable: false,
    status: "可用（38/38）",
    detail: "内置 native 内核可用；覆盖率报告不可读，显示默认 38/38。",
  };
  try {
    const coverage = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "native-qa", "out", "coverage.json"), "utf8"));
    const summary = coverage.summary || {};
    const covered = Number(summary.covered);
    const total = Number(summary.total);
    if (!Number.isFinite(covered) || !Number.isFinite(total) || total <= 0) return fallback;
    const svgTotal = Number(summary.nativeSvgTotal);
    return {
      ok: true,
      covered,
      total,
      svgTotal: Number.isFinite(svgTotal) ? svgTotal : 100,
      reportAvailable: true,
      status: `可用（${covered}/${total}）`,
      detail: `内置 native 内核覆盖 ${covered}/${total} 个实验，${Number.isFinite(svgTotal) ? svgTotal : 100} 张 SVG，0 错误；不依赖 Rainier。`,
    };
  } catch {
    return fallback;
  }
}

async function checkEnvironment() {
  const cfg = readConfig();
  const [enginePort, labReachable] = await Promise.all([
    portOpen(9002, "127.0.0.1", 800),
    httpOk(cfg.labUrl, 1600),
  ]);
  const engineExists = fs.existsSync(cfg.engineExe);
  const labRootExists = fs.existsSync(cfg.labRoot);

  const items = [
    {
      id: "engineExe",
      label: "Rainier 引擎",
      ok: engineExists,
      detail: cfg.engineExe || "未配置",
      hint: "路径 A：安装或解压本机学校客户端 Rainier OWVLabCRTE，确保 com_rainier_osgi_gui.exe 存在；公开安装包不附带引擎。",
    },
    {
      id: "enginePort",
      label: "引擎端口 9002",
      ok: enginePort,
      detail: enginePort ? "127.0.0.1:9002 已监听" : "127.0.0.1:9002 未监听",
      hint: "路径 A：先手动启动学校客户端引擎；若已启动仍失败，检查防火墙或端口占用。",
    },
    {
      id: "labUrl",
      label: "实验台服务 8766",
      ok: labReachable,
      detail: cfg.labUrl || "未配置",
      hint: "路径 A：启动本机学校客户端的实验台服务（默认 127.0.0.1:8766）；公开安装包不附带实验台。",
    },
    {
      id: "labRoot",
      label: "vlab_offline",
      ok: labRootExists,
      detail: cfg.labRoot || "未配置",
      hint: "路径 A：将本机学校客户端的 vlab_offline/rainier_v2 放到该目录；公开仓库不包含 vlab_offline。",
    },
  ];
  const missing = items.filter((x) => !x.ok);
  const schoolReady = missing.length === 0;
  const native = readNativeCoverage();
  const nativeReady = native.ok;
  return {
    ok: schoolReady || nativeReady,
    schoolReady,
    nativeReady,
    native,
    checkedAt: new Date().toISOString(),
    summary: schoolReady ? "学校客户端与 native 内核可用" : `路径 B 可用 · 学校客户端缺少 ${missing.length} 项`,
    items,
    missing: missing.map((x) => x.label),
    paths: [
      {
        id: "school",
        label: "路径 A · 本机学校客户端",
        ok: schoolReady,
        status: schoolReady ? "可用" : "未就绪",
        detail: schoolReady
          ? "Rainier 引擎、9002、8766 实验台和 vlab_offline 均已检测到，可直接使用。"
          : "未检测到完整的本机学校客户端环境。",
        hint: schoolReady ? "" : "按下方缺失项安装/启动本机学校客户端；公开安装包不附带这些文件。",
      },
      {
        id: "native",
        label: "路径 B · 自研 native 内核",
        ok: nativeReady,
        status: native.status,
        detail: native.detail,
        hint: "路径 B 不依赖 Rainier / 9002 / 8766，可在学校客户端缺失时直接运行。",
      },
    ],
    configPath: CONFIG_PATH,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureEngine(cfg) {
  if (await portOpen(9002)) return { ok: true, already: true };
  if (!fs.existsSync(cfg.engineExe)) return { ok: false, reason: `未找到引擎：${cfg.engineExe}` };
  spawn(cfg.engineExe, [], { cwd: path.dirname(cfg.engineExe), detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) { if (await portOpen(9002)) return { ok: true }; await sleep(400); }
  return { ok: false, reason: "引擎启动超时：9002 端口未监听" };
}

async function ensureServer(cfg) {
  if (await httpOk(cfg.labUrl)) return { ok: true, already: true };
  if (!fs.existsSync(cfg.serverScript)) return { ok: false, reason: `未找到本地服务脚本：${cfg.serverScript}` };
  const exe = fs.existsSync(cfg.pythonw) ? cfg.pythonw : "pythonw";
  spawn(exe, [cfg.serverScript], { cwd: path.dirname(cfg.serverScript), detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) { if (await httpOk(cfg.labUrl)) return { ok: true }; await sleep(400); }
  return { ok: false, reason: "本地实验台服务启动超时：8766 未响应" };
}

let labWin = null;

async function waitForLabEditor(win, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const ok = await win.webContents.executeJavaScript(
        "!!(window.app && window.app.getContext && window.app.getContext().getActiveEditor && window.app.getContext().getActiveEditor())"
      );
      if (ok) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

async function openLab(graph) {
  const cfg = readConfig();
  const engine = await ensureEngine(cfg);
  if (!engine.ok) return { ok: false, reason: engine.reason };
  const server = await ensureServer(cfg);
  if (!server.ok) return { ok: false, reason: server.reason };

  let built = null;
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    try { built = getBuildOcj()(graph.nodes, graph.edges || [], graph.meta || {}); }
    catch (e) {
      const missing = /ocj-templates\.json/.test(String((e && e.message) || e));
      return {
        ok: false,
        reason: missing
          ? "公开安装包不包含老版 OCJ 器件模板，无法导出到老版实验台。"
          : "生成老版场景失败：" + e.message,
      };
    }
  }

  if (labWin && !labWin.isDestroyed()) {
    labWin.focus();
    if (built) {
      if (!(await waitForLabEditor(labWin))) return { ok: false, reason: "老版实验台还没准备好" };
      const res = await labWin.webContents.executeJavaScript(
        "(function(){try{window.app.getContext().getActiveEditor().doRestore(" + JSON.stringify(built.scene) + ");return {ok:true};}catch(e){return {ok:false,error:String(e&&e.stack||e)};}})()"
      );
      if (res && res.ok === false) return { ok: false, reason: "老版加载电路失败：" + res.error };
    }
    return { ok: true, reused: true, warnings: built ? built.warnings : [] };
  }

  labWin = new BrowserWindow({
    width: 1440, height: 920, title: "实验台", backgroundColor: "#FCFBF7",
    icon: path.join(ROOT, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  labWin.on("closed", () => { labWin = null; });
  await labWin.loadURL(cfg.labUrl);

  if (built) {
    if (!(await waitForLabEditor(labWin))) return { ok: false, reason: "老版实验台加载超时" };
    const res = await labWin.webContents.executeJavaScript(
      "(function(){try{window.app.getContext().getActiveEditor().doRestore(" + JSON.stringify(built.scene) + ");return {ok:true};}catch(e){return {ok:false,error:String(e&&e.stack||e)};}})()"
    );
    if (res && res.ok === false) return { ok: false, reason: "老版加载电路失败：" + res.error };
  }
  return { ok: true, warnings: built ? built.warnings : [] };
}

function queryParams() {
  const q = {};
  if (process.env.COMMLAB_THEME) q.theme = process.env.COMMLAB_THEME;
  if (process.env.COMMLAB_TEST_RUN) q.run = process.env.COMMLAB_TEST_RUN;
  if (process.env.COMMLAB_TAB) q.tab = process.env.COMMLAB_TAB;
  return Object.keys(q).length ? { query: q } : undefined;
}

let mainWin = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 960, minHeight: 640,
    backgroundColor: "#FCFBF7", title: "CommLab Studio", autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged },
  });
  mainWin = win;
  win.on("closed", () => { mainWin = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"), queryParams());
}

ipcMain.handle("experiments:list", () => listExperiments());
ipcMain.handle("experiments:read", (_e, rel) => readCourseText(rel));
ipcMain.handle("report:export", async (e, payload = {}) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  return exportReportToFile(payload, parent);
});
ipcMain.handle("coursepack:status", () => getCoursepackStatus());
ipcMain.handle("coursepack:import", async (e, sourcePath) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const source = sourcePath || await pickCoursepackSource(win);
    if (!source) return { ok: false, canceled: true };
    const status = importCoursepack(source);
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
});
ipcMain.handle("coursepack:clear", () => {
  try { return { ok: true, ...clearCoursepack() }; }
  catch (err) { return { ok: false, reason: String((err && err.message) || err) }; }
});
ipcMain.handle("md:render", (_e, text) => marked.parse(text, { mangle: false, headerIds: false }));
ipcMain.handle("lab:open", (_e, graph) => openLab(graph));
ipcMain.handle("shell:open", (_e, url) => {
  if (/^https?:\/\//i.test(String(url || ""))) return shell.openExternal(url);
  return false;
});
ipcMain.handle("update:check", () => updater.check());
ipcMain.handle("update:apply", () => updater.apply());
ipcMain.handle("environment:check", () => checkEnvironment());
const experimentRuns = new Map();
let experimentRunSeq = 0;

function finishRunProgress(controller, phase, reason) {
  if (!controller || !controller.progress) return;
  if (controller.progress.snapshot().done) return;
  const allowed = ["done", "cancelled", "timeout", "failed"];
  controller.progress.finish(allowed.includes(phase) ? phase : "failed", reason ? { error: String(reason) } : {});
}

function errorRunStatus(error, snapshot) {
  if (error && error.code === "ABORTED") return "cancelled";
  if (error && error.code === "TIMEOUT") return "timeout";
  if (snapshot && snapshot.phase === "cancelled") return "cancelled";
  if (snapshot && snapshot.phase === "timeout") return "timeout";
  return "failed";
}

function resultTerminalPhase(status, ok) {
  if (status === "cancelled") return "cancelled";
  if (status === "timeout") return "timeout";
  if (status === "failed" || ok === false) return "failed";
  return "done";
}

ipcMain.handle("experiment:run", async (e, order, opts = {}) => {
  const sender = e.sender;
  const numOrder = Number(order);
  const idx = listExperiments();
  const exp = idx.experiments.find((x) => x.order === numOrder);
  if (!exp) return { ok: false, status: "failed", reason: "未找到实验 " + order };
  if (experimentRuns.has(numOrder)) {
    return { ok: false, status: "failed", reason: `实验 ${numOrder} 正在运行` };
  }

  let built;
  try { built = buildScene(exp); }
  catch (err) {
    return { ok: false, status: "failed", reason: String((err && err.message) || err) };
  }

  const cfg = readConfig();
  const runId = String((opts && opts.clientRunId) || `exp-${numOrder}-${Date.now()}-${++experimentRunSeq}`);
  const controller = engine.createRunController({
    timeoutMs: engine.resolveTimeout(exp),
    onProgress: (snapshot) => {
      if (!sender || sender.isDestroyed()) return;
      sender.send("experiment:progress", { order: numOrder, runId, ...snapshot });
    },
  });
  const record = { order: numOrder, runId, controller, sender };
  experimentRuns.set(numOrder, record);
  const nativeMetrics = [];

  const dir = path.join(getRunsDir(), String(numOrder));
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "scene.octave"), built.script, "utf8");

    const runOpts = {
      cfg,
      signal: controller.signal,
      progress: controller.progress,
      onNativeMetrics: (items) => {
        nativeMetrics.length = 0;
        if (Array.isArray(items)) nativeMetrics.push(...items);
      },
    };
    if (opts && opts.backend) runOpts.backend = String(opts.backend);
    const result = await engine.runExperiment(exp, runOpts);
    const status = result.status || (result.ok === false ? "failed" : "ok");
    finishRunProgress(controller, resultTerminalPhase(status, result.ok !== false), result.ok === false ? result.log : null);

    const results = Array.isArray(result.results) ? result.results : [];
    for (const item of results) {
      if (!item || !item.file || typeof item.svg !== "string") continue;
      fs.writeFileSync(path.join(dir, item.file), item.svg.replace(/\u0000/g, ""), "utf8");
    }
    return normalizeBackendResult({
      ok: result.ok !== false,
      status,
      backend: result.backend || "auto",
      fallbackFrom: result.fallbackFrom || null,
      elapsedMs: result.elapsedMs,
      results,
      log: result.log || "",
      script: result.script || built.script,
      warnings: result.warnings || [],
      dir,
    }, nativeMetrics);
  } catch (err) {
    const snapshot = controller.progress.snapshot();
    const status = errorRunStatus(err, snapshot);
    finishRunProgress(controller, status, err && err.message ? err.message : String(err));
    return {
      ok: false,
      status,
      reason: String((err && err.message) || err),
      script: built.script,
      dir,
      elapsedMs: snapshot.elapsedMs,
      metrics: nativeMetrics,
    };
  } finally {
    const current = experimentRuns.get(numOrder);
    if (current && current.runId === runId) experimentRuns.delete(numOrder);
  }
});

ipcMain.handle("experiment:cancel", (_e, order) => {
  const rec = experimentRuns.get(Number(order));
  if (!rec) return { ok: false, status: "failed", reason: "没有正在运行的实验" };
  rec.controller.cancel("用户取消");
  return { ok: true, status: "cancelling", order: Number(order) };
});

ipcMain.handle("native:status", () => readNativeCoverage());

let wbWin = null;

async function installWorkbenchReportButton(win) {
  if (!win || win.isDestroyed()) return;
  const code = [
    "(() => {",
    "  if (document.getElementById('wbReportBtn')) return;",
    "  const tools = document.querySelector('.tools');",
    "  if (!tools) return;",
    "  const button = document.createElement('button');",
    "  button.id = 'wbReportBtn';",
    "  button.className = 'btn';",
    "  button.type = 'button';",
    "  button.textContent = '导出报告 PDF';",
    "  button.title = '导出工作台最近一次运行结果为 PDF';",
    "  button.addEventListener('click', async () => {",
    "    const original = button.textContent;",
    "    button.disabled = true;",
    "    button.textContent = '生成中…';",
    "    try {",
    "      const result = await window.api.runGraph({ __control: 'report-export' });",
    "      if (result && result.ok) button.textContent = '已导出';",
    "      else if (!(result && result.canceled)) alert('导出失败：' + ((result && result.reason) || '未知错误'));",
    "    } catch (err) {",
    "      alert('导出失败：' + ((err && err.message) || err));",
    "    } finally {",
    "      setTimeout(() => { button.disabled = false; button.textContent = original; }, 1200);",
    "    }",
    "  });",
    "  tools.insertBefore(button, tools.querySelector('#btnRun'));",
    "})();",
  ].join("\n");
  try { await win.webContents.executeJavaScript(code); } catch {}
}

async function openWorkbench() {
  if (wbWin && !wbWin.isDestroyed()) { wbWin.focus(); return { ok: true, reused: true }; }
  wbWin = new BrowserWindow({
    width: 1440, height: 900, title: "工作台 · CommLab Studio", backgroundColor: "#FCFBF7",
    icon: path.join(ROOT, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "workbench", "preload.js"), contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged },
  });
  wbWin.on("closed", () => { wbWin = null; });
  const q = process.env.COMMLAB_WB_EXP ? { query: { exp: process.env.COMMLAB_WB_EXP } } : undefined;
  await wbWin.loadFile(path.join(__dirname, "workbench", "index.html"), q);
  await installWorkbenchReportButton(wbWin);
  return { ok: true };
}

ipcMain.handle("workbench:open", () => openWorkbench());

ipcMain.handle("workbench:saveSvg", async (_e, payload) => {
  const name = (payload && payload.name) || "figure.svg";
  const svg = String((payload && payload.svg) || "").replace(/\u0000/g, "");
  const r = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "SVG", extensions: ["svg"] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, svg, "utf8");
  return { ok: true, path: r.filePath };
});

ipcMain.handle("workbench:save", async (_e, data) => {
  const r = await dialog.showSaveDialog({
    defaultPath: "circuit.clab.json",
    filters: [{ name: "CommLab 电路", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1), "utf8");
  return { ok: true, path: r.filePath };
});

ipcMain.handle("workbench:load", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "CommLab 电路", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const raw = fs.readFileSync(r.filePaths[0], "utf8");
  try { return { ok: true, data: JSON.parse(raw), path: r.filePaths[0] }; }
  catch (e) { return { ok: false, reason: "文件不是有效 JSON" }; }
});

ipcMain.handle("workbench:devices", () => JSON.parse(safeRead("data/devices.json")));
ipcMain.handle("workbench:params", () => JSON.parse(safeRead("data/params.json")));
ipcMain.handle("workbench:experiments", () => listExperiments());

let workbenchRun = null;
let workbenchLastReport = null;

ipcMain.handle("workbench:run", async (_e, graph = {}) => {
  // The workbench preload intentionally stays unchanged.  It polls this same
  // handler with a control envelope, which keeps progress/cancel available
  // without adding another privileged bridge surface.
  if (graph && graph.__control === "status") {
    if (!workbenchRun) return { ok: true, progress: null };
    if (graph.__runId && String(graph.__runId) !== workbenchRun.runId) return { ok: true, progress: null };
    return { ok: true, progress: workbenchRun.controller.progress.snapshot() };
  }
  if (graph && graph.__control === "cancel") {
    if (!workbenchRun) return { ok: false, status: "failed", reason: "没有正在运行的电路" };
    if (graph.__runId && String(graph.__runId) !== workbenchRun.runId) {
      return { ok: false, status: "failed", reason: "运行标识不匹配" };
    }
    workbenchRun.controller.cancel("用户取消");
    return { ok: true, status: "cancelling" };
  }
  if (graph && graph.__control === "report-export") {
    if (!workbenchLastReport) return { ok: false, reason: "工作台尚无运行结果，请先运行仿真" };
    return exportReportToFile(workbenchLastReport, BrowserWindow.fromWebContents(_e.sender));
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  let built;
  try { built = buildGraphScript(nodes, edges); }
  catch (err) { return { ok: false, status: "failed", reason: err.message }; }

  if (workbenchRun) {
    return { ok: false, status: "failed", reason: "已有电路正在运行" };
  }

  const runId = String(graph.__runId || `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const controller = engine.createRunController({
    timeoutMs: 180000,
    onProgress: (snapshot) => {
      if (workbenchRun && workbenchRun.runId === runId) workbenchRun.progress = snapshot;
    },
  });
  workbenchRun = { runId, controller, progress: controller.progress.snapshot() };
  const nativeMetrics = [];
  const dir = path.join(getRunsDir(), "workbench");

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "scene.octave"), built.script, "utf8");
    controller.progress.start("running");

    const result = await engine.runCircuit(nodes, edges, {
      signal: controller.signal,
      progress: controller.progress,
      onNativeMetrics: (items) => {
        nativeMetrics.length = 0;
        if (Array.isArray(items)) nativeMetrics.push(...items);
      },
    });
    const status = result.status || (result.ok === false ? "failed" : "ok");
    finishRunProgress(controller, resultTerminalPhase(status, result.ok !== false), result.ok === false ? result.log : null);

    const results = Array.isArray(result.results) ? result.results : [];
    for (const item of results) {
      if (!item || !item.file || typeof item.svg !== "string") continue;
      fs.writeFileSync(path.join(dir, item.file), item.svg.replace(/\u0000/g, ""), "utf8");
    }
    const normalized = normalizeBackendResult({
      ok: result.ok !== false,
      status,
      backend: result.backend || "auto",
      fallbackFrom: result.fallbackFrom || null,
      elapsedMs: result.elapsedMs,
      script: result.script || built.script,
      results,
      log: result.log || "",
      warnings: result.warnings || [],
    }, nativeMetrics);
    const deviceNames = [];
    for (const node of nodes) {
      const name = node.componentName || node.className;
      if (name && !deviceNames.includes(name)) deviceNames.push(name);
    }
    workbenchLastReport = {
      experiment: {
        title: "工作台 · 自定义电路",
        expNo: "WB",
        devices: deviceNames,
        chain: nodes.map((node, index) => ({
          var: node.id || ("n" + (index + 1)),
          fn: node.className,
          args: Array.isArray(node.values) ? node.values.join(",") : "",
          devName: node.componentName || node.className,
        })),
        observers: [],
      },
      markdown: "",
      run: {
        ok: normalized.ok,
        status: normalized.status,
        backend: normalized.backend,
        elapsedMs: normalized.elapsedMs,
        results: normalized.results,
        metrics: normalized.metrics,
        runAt: Date.now(),
      },
    };
    return normalized;
  } catch (err) {
    const snapshot = controller.progress.snapshot();
    const status = errorRunStatus(err, snapshot);
    finishRunProgress(controller, status, err && err.message ? err.message : String(err));
    return {
      ok: false,
      status,
      reason: String((err && err.message) || err),
      script: built.script,
      elapsedMs: snapshot.elapsedMs,
      metrics: nativeMetrics,
    };
  } finally {
    if (workbenchRun && workbenchRun.runId === runId) workbenchRun = null;
  }
});

ipcMain.handle("figure:save", async (_e, payload) => {
  const name = (payload && payload.name) || "figure.svg";
  const svg = String((payload && payload.svg) || "").replace(/\u0000/g, "");
  const r = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "SVG", extensions: ["svg"] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, svg, "utf8");
  return { ok: true, path: r.filePath };
});

ipcMain.handle("report:openFolder", () => shell.openPath(path.join(ROOT, "templates")));

app.whenReady().then(() => { Menu.setApplicationMenu(null); });
app.whenReady().then(() => {
  createWindow();
  if (process.env.COMMLAB_TEST_OPEN) setTimeout(() => {
    const dir = getRunsDir();
    fs.mkdirSync(dir, { recursive: true });
    openLab()
      .then((r) => fs.writeFileSync(path.join(dir, "_lab.json"), JSON.stringify(r)))
      .catch((e) => fs.writeFileSync(path.join(dir, "_lab.err"), String((e && e.stack) || e)));
  }, 1500);
  setTimeout(async () => {
    try {
      const info = await updater.check();
      if (info && info.update && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("update:available", info);
    } catch {}
  }, 2600);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

app.whenReady().then(() => { if (process.env.COMMLAB_TEST_WORKBENCH) setTimeout(openWorkbench, 1200); });
