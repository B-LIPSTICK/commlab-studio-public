const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const bridge = window.api;
const mq = window.matchMedia("(prefers-color-scheme: dark)");

let state = null;
let defaults = null;
let meta = null;
let nativeInfo = null;
let dirty = false;
let activeSection = "appearance";
let toastTimer = null;
let nativeLoaded = false;

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setSaveState(text, kind = "") {
  const el = $("#saveState");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("dirty", kind === "dirty");
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("bad", kind === "bad");
}

function markDirty() {
  dirty = true;
  setSaveState("有未保存的修改。", "dirty");
}

function markClean(text = "设置已保存。") {
  dirty = false;
  setSaveState(text + " 设置保存在本机 userData/settings.json。", "ok");
}

function showToast(text) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function applyTheme(mode, reduced) {
  const root = document.documentElement;
  const theme = mode === "auto" ? (mq.matches ? "dark" : "light") : mode;
  root.dataset.theme = theme === "dark" ? "dark" : "light";
  root.dataset.themeMode = mode;
  if (typeof reduced === "boolean") root.dataset.reducedMotion = reduced ? "true" : "false";
  $$("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function currentReducedMotion() {
  return !!($("#reducedMotion") && $("#reducedMotion").checked);
}

function setReducedMotionLabel() {
  const label = $("#reducedMotionLabel");
  if (label) label.textContent = currentReducedMotion() ? "开启" : "关闭";
}

function setThemeChoice(mode) {
  if (!state) return;
  state.appearance.theme = mode;
  applyTheme(mode, currentReducedMotion());
  markDirty();
}

function collectSettings() {
  const portValue = $("#enginePort").value.trim();
  return {
    appearance: {
      theme: state && state.appearance ? state.appearance.theme : "auto",
      reducedMotion: currentReducedMotion(),
    },
    simulation: {
      externalEngine: {
        host: $("#engineHost").value.trim(),
        port: portValue === "" ? 0 : Number(portValue),
        exe: $("#engineExe").value.trim(),
      },
    },
    report: {
      school: $("#reportSchool").value.trim(),
      className: $("#reportClass").value.trim(),
      studentId: $("#reportStudentId").value.trim(),
      studentName: $("#reportStudentName").value.trim(),
      exportDir: $("#reportExportDir").value.trim(),
    },
  };
}

function populate(settings) {
  state = settings;
  $("#engineHost").value = settings.simulation.externalEngine.host || "";
  $("#enginePort").value = settings.simulation.externalEngine.port || "";
  $("#engineExe").value = settings.simulation.externalEngine.exe || "";
  $("#reportSchool").value = settings.report.school || "";
  $("#reportClass").value = settings.report.className || "";
  $("#reportStudentId").value = settings.report.studentId || "";
  $("#reportStudentName").value = settings.report.studentName || "";
  $("#reportExportDir").value = settings.report.exportDir || "";
  $("#reducedMotion").checked = !!settings.appearance.reducedMotion;
  setReducedMotionLabel();
  applyTheme(settings.appearance.theme || "auto", !!settings.appearance.reducedMotion);
  setSaveState("设置保存在本机 userData/settings.json。");
  dirty = false;
}

function fillMeta() {
  if (!meta) return;
  $("#currentVersion").textContent = "v" + meta.version;
  $("#aboutVersion").textContent = "v" + meta.version;
  $("#dataDir").textContent = meta.dataDir || "—";
  $("#logsDir").textContent = meta.logsDir || "—";
  $("#settingsPath").textContent = meta.settingsPath || "—";
}

function setNative(info) {
  nativeInfo = info || null;
  const covered = info && Number.isFinite(Number(info.covered)) ? Number(info.covered) : 38;
  const total = info && Number.isFinite(Number(info.total)) ? Number(info.total) : 38;
  const ratio = covered + "/" + total;
  const ok = !!(info && info.ok !== false);
  $("#nativeBadge").textContent = ratio;
  $("#aboutNative").textContent = ratio;
  $("#nativeFoot").textContent = "内置仿真";
  $("#nativeFootDetail").textContent = ok ? ratio + " · 可用" : "状态待确认";
  $("#nativeFootDetail").title = (info && info.detail) || "";
  $("#nativeDetail").textContent = (info && info.detail) || "内置 native 内核可用；覆盖率报告不可读，显示默认 38/38。";
  $("#nativeChip").textContent = ok ? "默认引擎" : "状态未知";
  $("#nativeChip").classList.toggle("ok", ok);
  $("#nativeChip").classList.toggle("bad", !ok);
  const dot = $("#nativeDot");
  dot.classList.toggle("ok", ok);
  dot.classList.toggle("bad", !ok);
}

async function loadNative() {
  if (nativeLoaded || !bridge || !bridge.nativeStatus) return;
  nativeLoaded = true;
  try {
    setNative(await bridge.nativeStatus());
  } catch (err) {
    setNative({
      ok: false,
      covered: 38,
      total: 38,
      detail: "读取内置仿真状态失败；native 仍可运行。",
    });
  }
}

async function loadSettings() {
  if (!bridge) {
    setSaveState("设置接口未加载，请重新打开设置窗口。", "bad");
    return;
  }
  try {
    const result = await bridge.settingsGet();
    if (!result || !result.ok) throw new Error((result && result.reason) || "无法读取设置");
    defaults = result.defaults;
    meta = result.meta;
    populate(result.settings);
    fillMeta();
    await loadNative();
  } catch (err) {
    setSaveState("读取设置失败：" + (err.message || String(err)), "bad");
  }
}

async function saveSettings(silent = false) {
  if (!state || !bridge) return false;
  const payload = collectSettings();
  const port = payload.simulation.externalEngine.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setSaveState("保存失败：外部引擎端口必须是 1–65535 的整数。", "bad");
    showToast("端口必须是 1–65535 的整数");
    return false;
  }
  $("#saveBtn").disabled = true;
  $("#saveBtn").textContent = "保存中…";
  try {
    const result = await bridge.settingsSet(payload);
    if (!result || !result.ok) throw new Error((result && result.reason) || "保存失败");
    state = result.settings;
    meta = result.meta || meta;
    fillMeta();
    applyTheme(state.appearance.theme, state.appearance.reducedMotion);
    markClean();
    if (!silent) showToast("设置已保存");
    return true;
  } catch (err) {
    setSaveState("保存失败：" + (err.message || String(err)), "bad");
    if (!silent) showToast("保存失败");
    return false;
  } finally {
    $("#saveBtn").disabled = false;
    $("#saveBtn").textContent = "保存设置";
  }
}

function showSection(name) {
  const valid = $$(".nav-item").some((button) => button.dataset.section === name);
  activeSection = valid ? name : "appearance";
  $$(".nav-item").forEach((button) => {
    const active = button.dataset.section === activeSection;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".section").forEach((section) => {
    const active = section.dataset.panel === activeSection;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });
  const main = $(".main");
  if (main) main.scrollTop = 0;
  try { history.replaceState(null, "", "#" + activeSection); } catch {}
  if (activeSection === "simulation") loadNative();
}

function renderEngineResult(result) {
  const box = $("#engineResult");
  const status = $("#engineState");
  const ok = !!(result && result.ok);
  status.textContent = ok ? "已连接" : "未连接";
  status.classList.toggle("ok", ok);
  status.classList.toggle("bad", !ok);
  box.hidden = false;
  box.className = "result-box " + (ok ? "ok" : "bad");
  const checks = Array.isArray(result && result.checks) ? result.checks : [];
  const rows = checks.map((item) => {
    const mark = item.ok ? "✓" : "×";
    return "<li><strong>" + mark + " " + esc(item.label) + "</strong> · " + esc(item.detail) + "</li>";
  }).join("");
  box.innerHTML = "<strong>" + esc((result && result.message) || (ok ? "外部引擎已连接" : "外部引擎未连接")) + "</strong>" +
    (rows ? "<ul>" + rows + "</ul>" : "") +
    "<p>内置 native 不受影响，仍可继续运行 38/38 个实验。</p>";
}

async function testEngine() {
  if (!bridge) return;
  const host = $("#engineHost").value.trim();
  const port = Number($("#enginePort").value.trim());
  const exe = $("#engineExe").value.trim();
  const button = $("#testEngine");
  const status = $("#engineState");
  button.disabled = true;
  button.textContent = "测试中…";
  status.textContent = "正在检查…";
  status.classList.remove("ok", "bad");
  try {
    const result = await bridge.settingsTestEngine({ host, port, exe });
    renderEngineResult(result);
  } catch (err) {
    renderEngineResult({
      ok: false,
      message: "未连接：测试外部引擎失败（" + (err.message || String(err)) + "）",
      checks: [],
    });
  } finally {
    button.disabled = false;
    button.textContent = "测试连接";
  }
}

function renderDiagnostics(data) {
  const list = $("#diagnosticsList");
  const items = Array.isArray(data && data.items) ? data.items : [];
  if (!items.length) {
    list.innerHTML = '<p class="muted-line">没有检测结果。</p>';
    return;
  }
  const summary = document.createElement("p");
  summary.className = "muted-line";
  summary.textContent = (data && data.summary) || "";
  list.innerHTML = "";
  list.appendChild(summary);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "diagnostic-item";
    const dot = document.createElement("span");
    dot.className = "status-dot " + (item.ok ? "ok" : "bad");
    const main = document.createElement("div");
    main.className = "diagnostic-main";
    const title = document.createElement("strong");
    title.textContent = item.label || item.id || "检测项";
    const detail = document.createElement("code");
    detail.textContent = item.detail || "";
    main.appendChild(title);
    main.appendChild(detail);
    if (!item.ok && item.hint) {
      const hint = document.createElement("p");
      hint.textContent = item.hint;
      main.appendChild(hint);
    }
    row.appendChild(dot);
    row.appendChild(main);
    list.appendChild(row);
  }
}

async function runDiagnostics() {
  if (!bridge || !bridge.checkEnvironment) return;
  const button = $("#runDiagnostics");
  const list = $("#diagnosticsList");
  button.disabled = true;
  button.textContent = "检测中…";
  list.innerHTML = '<p class="muted-line">正在检查外部引擎与内置 native…</p>';
  try {
    renderDiagnostics(await bridge.checkEnvironment());
  } catch (err) {
    list.innerHTML = '<p class="muted-line">检测失败：' + esc(err.message || String(err)) + "</p>";
  } finally {
    button.disabled = false;
    button.textContent = "重新检测";
  }
}

async function checkUpdate() {
  if (!bridge || !bridge.checkUpdate) return;
  const button = $("#checkUpdate");
  const box = $("#updateResult");
  button.disabled = true;
  button.textContent = "检查中…";
  box.hidden = false;
  box.className = "result-box";
  box.textContent = "正在连接更新服务器…";
  try {
    const result = await bridge.checkUpdate();
    if (result && result.error) {
      box.className = "result-box bad";
      box.innerHTML = "<strong>检查失败</strong><p>" + esc(result.error) + "</p>";
      return;
    }
    if (result && result.mode === "git") {
      box.className = "result-box " + (result.update ? "ok" : "");
      box.innerHTML = result.update
        ? "<strong>发现新提交</strong><p>源码仓库有更新，可在主界面提示条中拉取。</p>"
        : "<strong>当前已是最新源码</strong><p>没有发现新的提交。</p>";
      return;
    }
    const current = (result && result.current) || (meta && meta.version) || "—";
    const latest = (result && (result.latest || result.version)) || "—";
    box.className = "result-box " + (result && result.update ? "ok" : "");
    box.innerHTML = result && result.update
      ? "<strong>发现新版本 v" + esc(latest) + "</strong><p>当前 v" + esc(current) + "。可在主界面更新提示中安装。</p>"
      : "<strong>当前已是最新版本</strong><p>当前 v" + esc(current) + "，最新 v" + esc(latest) + "。</p>";
  } catch (err) {
    box.className = "result-box bad";
    box.innerHTML = "<strong>检查失败</strong><p>" + esc(err.message || String(err)) + "</p>";
  } finally {
    button.disabled = false;
    button.textContent = "检查更新";
  }
}

function showResultBox(id, kind, title, detail) {
  const box = $(id);
  if (!box) return;
  box.hidden = false;
  box.className = "result-box " + (kind || "");
  box.innerHTML = "<strong>" + esc(title) + "</strong>" + (detail ? "<p>" + esc(detail) + "</p>" : "");
}

async function openOldLab() {
  if (!bridge || !bridge.openLab) return;
  const button = $("#openOldLab");
  button.disabled = true;
  button.textContent = "打开中…";
  try {
    const result = await bridge.openLab();
    if (result && result.ok) {
      showResultBox("#oldLabResult", "ok", "老版实验台已打开", "外部引擎未连接时，此入口可能无法完成加载。");
    } else {
      showResultBox("#oldLabResult", "bad", "无法打开老版实验台", (result && result.reason) || "请先在仿真分区配置外部引擎。");
    }
  } catch (err) {
    showResultBox("#oldLabResult", "bad", "无法打开老版实验台", err.message || String(err));
  } finally {
    button.disabled = false;
    button.textContent = "打开老版实验台";
  }
}

async function resetSettings() {
  if (!bridge || !bridge.settingsReset) return;
  if (!window.confirm("恢复默认会清除外观、外部引擎和报告信息，但不会删除课程包或运行结果。继续？")) return;
  const button = $("#resetSettings");
  button.disabled = true;
  button.textContent = "恢复中…";
  try {
    const result = await bridge.settingsReset();
    if (!result || !result.ok) throw new Error((result && result.reason) || "恢复失败");
    meta = result.meta || meta;
    populate(result.settings);
    fillMeta();
    showToast("已恢复默认设置");
  } catch (err) {
    showToast("恢复失败：" + (err.message || String(err)));
  } finally {
    button.disabled = false;
    button.textContent = "恢复默认";
  }
}

function wireEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  $$("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => setThemeChoice(button.dataset.themeChoice));
  });

  $("#reducedMotion").addEventListener("change", () => {
    setReducedMotionLabel();
    applyTheme(state ? state.appearance.theme : "auto", currentReducedMotion());
    markDirty();
  });

  $("#settingsForm").addEventListener("input", markDirty);
  $("#settingsForm").addEventListener("change", markDirty);
  $("#saveBtn").addEventListener("click", () => saveSettings(false));

  $("#browseEngine").addEventListener("click", async () => {
    if (!bridge || !bridge.settingsChooseEngine) return;
    try {
      const result = await bridge.settingsChooseEngine();
      if (result && result.ok && result.path) {
        $("#engineExe").value = result.path;
        markDirty();
      }
    } catch (err) {
      showToast("选择程序失败：" + (err.message || String(err)));
    }
  });

  $("#browseExportDir").addEventListener("click", async () => {
    if (!bridge || !bridge.settingsChooseDirectory) return;
    try {
      const result = await bridge.settingsChooseDirectory();
      if (result && result.ok && result.path) {
        $("#reportExportDir").value = result.path;
        markDirty();
      }
    } catch (err) {
      showToast("选择目录失败：" + (err.message || String(err)));
    }
  });

  $("#testEngine").addEventListener("click", testEngine);
  $("#runDiagnostics").addEventListener("click", runDiagnostics);
  $("#checkUpdate").addEventListener("click", checkUpdate);
  $("#openOldLab").addEventListener("click", openOldLab);
  $("#resetSettings").addEventListener("click", resetSettings);

  $("#openDataDir").addEventListener("click", async () => {
    try {
      const result = await bridge.settingsOpenDataDir();
      if (result && !result.ok) showToast("打开数据目录失败：" + (result.reason || "未知原因"));
    } catch (err) { showToast("打开数据目录失败：" + (err.message || String(err))); }
  });

  $("#openLogs").addEventListener("click", async () => {
    try {
      const result = await bridge.settingsOpenLogs();
      if (result && !result.ok) showToast("打开日志目录失败：" + (result.reason || "未知原因"));
    } catch (err) { showToast("打开日志目录失败：" + (err.message || String(err))); }
  });

  $("#openGithub").addEventListener("click", () => {
    if (bridge && meta && meta.github) bridge.openExternal(meta.github);
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveSettings(false);
    }
  });

  mq.addEventListener("change", () => {
    if (state && state.appearance.theme === "auto") applyTheme("auto", currentReducedMotion());
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function boot() {
  applyTheme("auto", false);
  wireEvents();
  showSection((location.hash || "#appearance").slice(1));
  await loadSettings();
}

boot().catch((err) => {
  setSaveState("设置页启动失败：" + (err.message || String(err)), "bad");
});