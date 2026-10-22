let ALL = [];
let CUR = null;
let ACTIVE_RUN = null;
let RUN_PROGRESS_READY = false;
let COURSEPACK = null;
let LAST_RUNS = new Map();

const RUN_PHASE_LABELS = {
  idle: "准备中",
  connecting: "连接引擎",
  sending: "发送电路",
  running: "仿真运行",
  receiving: "接收结果",
  done: "完成",
  cancelled: "已取消",
  timeout: "已超时",
  failed: "失败",
};

const $ = (s) => document.querySelector(s);

function initTheme() {
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const forced = new URLSearchParams(location.search).get("theme");
  const apply = (mode) => {
    root.dataset.theme = mode === "auto" ? (mq.matches ? "dark" : "light") : mode;
    root.dataset.themeMode = mode;
    const btn = document.getElementById("theme");
    if (btn) btn.title = "主题：" + ({ light: "日间", dark: "夜间", auto: "跟随系统" })[mode] + "（点击切换）";
  };
  const saved = localStorage.getItem("theme") || "auto";
  apply(forced || saved);

  mq.addEventListener("change", () => {
    if ((localStorage.getItem("theme") || "auto") === "auto") apply("auto");
  });

  const btn = document.getElementById("theme");
  if (btn) btn.addEventListener("click", () => {
    const cur = localStorage.getItem("theme") || "auto";
    const order = ["light", "dark", "auto"];
    const next = order[(order.indexOf(cur) + 1) % 3];
    if (next === "auto") localStorage.removeItem("theme");
    else localStorage.setItem("theme", next);
    apply(next);
  });
}

function initLinks() {
  document.querySelectorAll(".gh-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.api && window.api.openExternal) window.api.openExternal(a.href);
    });
  });
}

function initUpdates() {
  const bar = document.getElementById("updateBar");
  if (!bar || !window.api || !window.api.onUpdate) return;
  const text = document.getElementById("updateText");
  const go = document.getElementById("updateGo");
  const later = document.getElementById("updateLater");
  let info = null;
  const show = (x) => {
    info = x;
    text.textContent = x.mode === "git" ? "发现新提交，可一键更新到最新版" : "发现新版本 " + x.version;
    bar.classList.remove("hide");
  };
  window.api.onUpdate(show);
  later.addEventListener("click", () => bar.classList.add("hide"));
  go.addEventListener("click", async () => {
    go.disabled = true;
    go.textContent = "正在更新…";
    text.textContent = "正在拉取更新，完成后会自动重启";
    try {
      const r = await window.api.applyUpdate();
      if (!r || !r.ok) {
        text.textContent = "更新失败：" + ((r && r.reason) || "未知原因");
        go.disabled = false; go.textContent = "重试";
        return;
      }
      text.textContent = "更新完成，正在重启…";
    } catch (e) {
      text.textContent = "更新失败：" + e.message;
      go.disabled = false; go.textContent = "重试";
    }
  });
  window.api.checkUpdate().then((x) => {
    if (x && x.update && !info) show(x);
    else if (x && x.error) console.warn("[update] " + x.error);
  }).catch((e) => console.warn("[update] " + (e.message || String(e))));
}

function initEnvironment() {
  const panel = document.getElementById("envPanel");
  if (!panel || !window.api || !window.api.checkEnvironment) return;
  const list = document.getElementById("envList");
  const routes = document.getElementById("envRoutes");
  const summary = document.getElementById("envSummary");
  const refresh = document.getElementById("envRefresh");
  const toggle = document.getElementById("envToggle");

  const setCollapsed = (collapsed) => {
    panel.classList.toggle("collapsed", collapsed);
    toggle.textContent = collapsed ? "展开" : "收起";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  setCollapsed(localStorage.getItem("envCollapsed") === "1");
  toggle.addEventListener("click", () => {
    const collapsed = !panel.classList.contains("collapsed");
    setCollapsed(collapsed);
    localStorage.setItem("envCollapsed", collapsed ? "1" : "0");
  });

  const render = (data) => {
    const items = Array.isArray(data && data.items) ? data.items : [];
    const paths = Array.isArray(data && data.paths) ? data.paths : [];
    const missing = items.filter((x) => !x.ok);
    const nativeReady = !!(data && (data.nativeReady || (data.native && data.native.ok)));
    panel.dataset.state = (data && data.ok) || nativeReady ? "ok" : (missing.length ? "missing" : "ok");
    summary.textContent = data && data.summary
      ? data.summary
      : (data && data.schoolReady
        ? "学校客户端可用"
        : (missing.length ? `${missing.length} 项未就绪` : "学校客户端未就绪"));
    routes.innerHTML = paths.map((pathInfo) => {
      const status = pathInfo.status || (pathInfo.ok ? "可用" : "未就绪");
      const hint = pathInfo.hint ? `<p class="env-route-hint">${esc(pathInfo.hint)}</p>` : "";
      return `<div class="env-route ${pathInfo.ok ? "ok" : "pending"}">
        <div class="env-route-head">
          <span class="env-route-label">${esc(pathInfo.label)}</span>
          <span class="env-route-badge">${esc(status)}</span>
        </div>
        <p>${esc(pathInfo.detail || "")}</p>
        ${hint}
      </div>`;
    }).join("");
    list.innerHTML = items.map((item) => {
      const hint = item.ok ? "" : `<p class="env-fix">${esc(item.hint || "请检查配置。")}</p>`;
      return `<div class="env-item ${item.ok ? "ok" : "bad"}">
        <span class="env-dot" aria-hidden="true"></span>
        <div class="env-item-main">
          <div class="env-item-top">
            <span class="env-name">${esc(item.label)}</span>
            <span class="env-state">${item.ok ? "已就绪" : "未就绪"}</span>
          </div>
          <code class="env-path">${esc(item.detail || "")}</code>
          ${hint}
        </div>
      </div>`;
    }).join("") || '<p class="env-loading">没有检测结果。</p>';
  };

  const check = async () => {
    refresh.disabled = true;
    refresh.textContent = "检测中…";
    panel.dataset.state = "checking";
    summary.textContent = "检测中…";
    try {
      render(await window.api.checkEnvironment());
    } catch (e) {
      panel.dataset.state = "missing";
      summary.textContent = "检测失败";
      list.innerHTML = `<p class="env-loading err">${esc(e.message || String(e))}</p>`;
    } finally {
      refresh.disabled = false;
      refresh.textContent = "重新检测";
    }
  };

  refresh.addEventListener("click", check);
  check();
}

async function boot() {
  initTheme();
  initLinks();
  initUpdates();
  initEnvironment();
  initRunProgress();
  initCoursepackControls();
  await refreshCatalog();
  if (!ALL.length) {
    $("#pane-req").innerHTML =
      '<div class="empty-state"><p class="es-title">题库是空的</p>' +
      '<p class="es-sub">检查 data/experiments.json 是否存在。</p></div>';
  }

  $("#search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const hit = !q ? ALL : ALL.filter((x) =>
      x.title.toLowerCase().includes(q) ||
      (x.devices || []).join(" ").toLowerCase().includes(q) ||
      (x.moduleTitle || "").includes(q) ||
      (x.module || "").includes(q) ||
      String(x.order) === q ||
      String(x.expNo) === q);
    renderList(hit);
  });

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll(".doc-nav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("on"));
    $("#pane-" + b.dataset.tab).classList.add("on");
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA";
    if (e.key === "/" && !typing) { e.preventDefault(); $("#search").focus(); $("#search").select(); }
    if (e.key === "Escape" && typing) { $("#search").value = ""; renderList(ALL); $("#search").blur(); }
    if (!typing && (e.key === "ArrowDown" || e.key === "ArrowUp") && ALL.length) {
      e.preventDefault();
      const i = ALL.findIndex((x) => CUR && x.order === CUR.order);
      const next = e.key === "ArrowDown" ? Math.min(ALL.length - 1, i + 1) : Math.max(0, i - 1);
      select(ALL[next]);
    }
    if (!typing && e.key === "Enter" && CUR) { e.preventDefault(); runCurrent(); }
  });

  $("#btnRun").addEventListener("click", runCurrent);
  $("#btnReport").addEventListener("click", exportCurrentReport);
  $("#btnWorkbench").addEventListener("click", () => window.api.openWorkbench());
  $("#btnLab").addEventListener("click", async () => {
    const r = await window.api.openLab();
    if (!r.ok) alert(r.reason);
  });

  if (ALL[0]) select(ALL[0]);

  const tab = new URLSearchParams(location.search).get("tab");
  if (tab) {
    const b = document.querySelector('.doc-nav button[data-tab="' + tab + '"]');
    if (b) b.click();
  }

  const auto = new URLSearchParams(location.search).get("run");
  if (auto) {
    try {
      const x = ALL.find((e) => e.order === Number(auto));
      if (x) { await select(x); await runCurrent(); }
    } catch (err) { console.error(err); }
  }
}

async function refreshCatalog() {
  const data = await window.api.list();
  ALL = Array.isArray(data.experiments) ? data.experiments : [];
  COURSEPACK = window.api.coursepackStatus ? await window.api.coursepackStatus() : null;
  updateCoursepackUi();
  $("#count").textContent = ALL.length
    ? `${ALL.length} 道实验 · ${COURSEPACK && COURSEPACK.installed ? "课程包已导入" : "结构化元数据"}`
    : "没有实验数据";
  renderList(ALL);
}

function updateCoursepackUi() {
  const state = document.getElementById("cpState");
  const btn = document.getElementById("btnCoursepack");
  const clear = document.getElementById("btnCoursepackClear");
  if (!state || !btn || !clear) return;
  if (COURSEPACK && COURSEPACK.installed) {
    state.textContent = `课程包：${COURSEPACK.markdownCount} 篇`;
    state.title = COURSEPACK.path || "";
    btn.textContent = "更换";
    clear.classList.remove("hide");
  } else if (COURSEPACK && COURSEPACK.error) {
    state.textContent = "课程包：异常";
    state.title = COURSEPACK.error;
    btn.textContent = "重新导入";
    clear.classList.remove("hide");
  } else {
    state.textContent = "课程包：未导入";
    state.title = "";
    btn.textContent = "导入";
    clear.classList.add("hide");
  }
}

function initCoursepackControls() {
  const btn = document.getElementById("btnCoursepack");
  const clear = document.getElementById("btnCoursepackClear");
  if (btn) btn.addEventListener("click", importCoursepack);
  if (clear) clear.addEventListener("click", clearCoursepack);
  const pane = document.getElementById("pane-req");
  if (pane) {
    pane.addEventListener("click", (e) => {
      if (e.target.closest("[data-coursepack-import]")) importCoursepack();
      if (e.target.closest("[data-coursepack-clear]")) clearCoursepack();
    });
  }
}

async function importCoursepack() {
  if (!window.api || !window.api.coursepackImport) return;
  const buttons = document.querySelectorAll("#btnCoursepack, [data-coursepack-import]");
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const r = await window.api.coursepackImport();
    if (!r || r.canceled) return;
    if (!r.ok) {
      alert("导入失败：" + ((r && r.reason) || "未知原因"));
      return;
    }
    await refreshCatalog();
    const keep = (CUR && ALL.find((x) => Number(x.order) === Number(CUR.order))) || ALL[0];
    if (keep) await select(keep);
    else $("#pane-req").innerHTML =
      '<div class="empty-state"><p class="es-title">课程包已导入</p>' +
      '<p class="es-sub">但 experiments.json 中没有可显示的实验。</p></div>';
  } catch (e) {
    alert("导入失败：" + (e.message || String(e)));
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function clearCoursepack() {
  if (!window.api || !window.api.coursepackClear) return;
  if (!confirm("清除已导入的课程包？安装包自带的结构化元数据不会删除。")) return;
  try {
    const r = await window.api.coursepackClear();
    if (!r || !r.ok) {
      alert("清除失败：" + ((r && r.reason) || "未知原因"));
      return;
    }
    await refreshCatalog();
    if (ALL[0]) await select(ALL[0]);
  } catch (e) {
    alert("清除失败：" + (e.message || String(e)));
  }
}

function coursepackMissingHtml(exp, err) {
  const installed = !!(COURSEPACK && COURSEPACK.installed);
  const title = installed ? "课程包缺少这篇原文" : "这份实验的课程原文不在安装包中";
  const sub = installed
    ? `已导入课程包，但没有找到 ${esc(exp.markdown || "对应 Markdown")}。可重新导入完整课程包。`
    : "公开安装包只包含题号、标题、器件链和参数等结构化元数据。导入课程包后即可阅读课程原文。";
  const detail = installed && err ? `<p class="es-sub es-detail">${esc(err.message || String(err))}</p>` : "";
  return '<div class="empty-state coursepack-empty">' +
    '<p class="es-title">' + esc(title) + '</p>' +
    '<p class="es-sub">' + sub + '</p>' +
    detail +
    '<div class="cp-empty-actions">' +
      '<button type="button" class="cp-empty-btn" data-coursepack-import>导入课程包</button>' +
      (installed ? '<button type="button" class="cp-empty-link" data-coursepack-clear>清除课程包</button>' : '') +
    '</div>' +
    '<p class="es-sub es-detail">支持 ZIP 或文件夹：experiments.json + experiments/*.md（可选 scripts/）。</p>' +
  '</div>';
}

const MODULE_ORDER = ["模块一", "模块二", "模块三", "模块四", "模块五", "模块六", "模块七"];

function renderList(items) {
  const ol = $("#list");
  ol.innerHTML = "";
  const groups = new Map();
  for (const x of items) {
    const m = x.module || "其他";
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(x);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = MODULE_ORDER.indexOf(a), ib = MODULE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const k of keys) {
    const head = document.createElement("li");
    head.className = "grp";
    const first = groups.get(k)[0];
    head.innerHTML = '<span class="gt"></span><span class="gc"></span>';
    head.querySelector(".gt").textContent = k === "其他" ? "其他" : k + " · " + (first.moduleTitle || "");
    head.querySelector(".gc").textContent = first.chapters || "";
    ol.appendChild(head);
    const sorted = groups.get(k).slice().sort((a, b) => Number(a.expNo) - Number(b.expNo));
    for (const x of sorted) {
      const li = document.createElement("li");
      li.dataset.order = x.order;
      const no = document.createElement("span");
      no.className = "no";
      no.textContent = String(x.expNo).padStart(2, "0");
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = x.title;
      li.append(no, nm);
      li.addEventListener("click", () => select(x));
      ol.appendChild(li);
    }
  }
}

function normalizeBody(md, title) {
  md = md.replace(/\r\n/g, "\n");
  const idx = md.indexOf("\n---\n");
  let body = idx >= 0 ? md.slice(idx + 5) : md;
  const lines = body.split("\n");
  const out = [];
  let droppedTitle = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(""); continue; }
    if (line.startsWith("# ")) continue;
    if (!droppedTitle && line === title) { droppedTitle = true; continue; }
    if (/^(课件资料|开始实验|插件下载|请求智能指导)$/.test(line)) continue;
    if (line.includes("暂未上传课件资料")) continue;
    if (line.includes("Microsoft YaHei")) continue;
    if (/^保存并退出\s*提交$/.test(line)) continue;
    if (/^平台图片[:：]/.test(line)) continue;
    if (/^插件下载\s+请求智能指导$/.test(line)) continue;
    if (line === "实验要求" || line === "提交报告") {
      out.push("## " + line, ""); continue;
    }
    if (/^[一二三四五六七八九十]、/.test(line)) { out.push("### " + line, ""); continue; }
    out.push(raw);
  }
  return out.join("\n");
}

async function select(x) {
  CUR = x;
  document.querySelectorAll("#list li").forEach((li) => {
    const on = Number(li.dataset.order) === x.order;
    li.classList.toggle("sel", on);
    if (on && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
  });

  const chain = Array.isArray(x.chain) ? x.chain : [];
  const observers = Array.isArray(x.observers) ? x.observers : [];
  $("#title").textContent = x.title;
  $("#meta").innerHTML = [
    `实验${x.expNo}`,
    `第 ${x.order} 题`,
    `${chain.length} 个器件`,
    `${observers.length} 个观测`
  ].map((t) => `<span>${esc(t)}</span>`).join("");

  $("#pane-req").innerHTML = skeleton();
  try {
    const md = await window.api.read(x.markdown);
    const body = normalizeBody(md, x.title);
    $("#pane-req").innerHTML = await renderDoc(x, body);
  } catch (err) {
    $("#pane-req").innerHTML = coursepackMissingHtml(x, err);
  }
  $("#pane-req").style.animation = "none";
  void $("#pane-req").offsetWidth;
  $("#pane-req").style.animation = "";

  const rows = chain.map((c, i) =>
    `<tr>
       <td>${i + 1}</td>
       <td><code>${esc(c.var)}</code></td>
       <td class="dev">${esc(c.devName || c.fn)}</td>
       <td><code>${esc(c.fn)}(${esc(c.args)})</code></td>
     </tr>`).join("");

  const obs = observers.map((o) =>
    `<tr>
       <td></td>
       <td>${esc(o.devName || o.fn)}</td>
       <td class="dev"></td>
       <td><code>${esc(o.fn)}(${esc(o.args)})</code></td>
     </tr>`).join("");

  $("#pane-chain").innerHTML =
    renderTopology(x) +
    `<p class="sect-label">信号流（明细）</p>
     <table class="chain-table">
       <thead><tr><th></th><th>变量</th><th>器件</th><th>平台调用</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p class="sect-label">观测器件</p>
     <table class="chain-table">
       <thead><tr><th></th><th>器件</th><th></th><th>参数</th></tr></thead>
       <tbody>${obs}</tbody>
     </table>`;

  try {
    $("#script").textContent = await window.api.read(x.script);
  } catch {
    $("#script").textContent =
      "安装包不包含平台脚本原文（.m）。\n" +
      "可在课程包的 scripts/ 中提供脚本，或使用本机学校客户端。";
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

boot();


function formatElapsed(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return Math.round(n) + " ms";
  if (n < 60000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + " s";
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return m + " min " + String(s).padStart(2, "0") + " s";
}

function formatMetricValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toExponential(2) : "—";
}

function metricsHtml(metrics) {
  const items = Array.isArray(metrics) ? metrics.filter((m) => m && m.kind === "metric") : [];
  if (!items.length) return "";
  return '<div class="metrics">' + items.map((m) => {
    const label = String(m.name || "").toUpperCase() === "BER" ? "误码率" : String(m.name || "指标");
    const errors = m.errors == null ? "—" : String(m.errors);
    const total = m.total == null ? "—" : String(m.total);
    return '<section class="metric-card">' +
      '<div class="metric-head"><span class="metric-name">' + esc(label) + '</span>' +
      '<span class="metric-device">' + esc(m.device || "") + '</span></div>' +
      '<div class="metric-value">' + esc(formatMetricValue(m.value != null ? m.value : m.ber)) + '</div>' +
      '<div class="metric-detail">' + esc(errors) + ' / ' + esc(total) + ' bit</div>' +
      '</section>';
  }).join("") + '</div>';
}

function phaseLabel(phase) {
  return RUN_PHASE_LABELS[phase] || phase || "运行中";
}

function progressInner(p) {
  const phase = (p && p.phase) || "running";
  const done = !!(p && p.done);
  const percent = p && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, p.percent)) : null;
  const indeterminate = !done && ((p && p.indeterminate !== false) || percent == null);
  const width = done ? 100 : (percent == null ? 100 : percent);
  const timeout = p && Number.isFinite(p.timeoutMs) ? " · 上限 " + formatElapsed(p.timeoutMs) : "";
  const cancelling = !!(ACTIVE_RUN && ACTIVE_RUN.cancelling);
  const cancelText = done ? "已结束" : (cancelling ? "正在取消…" : "取消运行");
  const stateText = done ? phaseLabel(phase) : (indeterminate ? "阶段进度待引擎回报" : percent + "%");
  return '<div class="run-progress" data-phase="' + esc(phase) + '">' +
    '<div class="run-progress-head">' +
      '<span class="run-phase">' + esc(phaseLabel(phase)) + '</span>' +
      '<span class="run-elapsed">已耗时 ' + esc(formatElapsed(p && p.elapsedMs)) + esc(timeout) + '</span>' +
    '</div>' +
    '<div class="run-progress-track"><div class="run-progress-bar' + (indeterminate ? ' indeterminate' : '') + '" style="width:' + width + '%"></div></div>' +
    '<div class="run-progress-foot">' +
      '<span>' + esc(stateText) + '</span>' +
      '<button type="button" class="run-cancel" data-run-cancel' + (done || cancelling ? ' disabled' : '') + '>' + esc(cancelText) + '</button>' +
    '</div>' +
  '</div>';
}

function paintRunProgress(p) {
  const mount = document.getElementById("runProgressMount");
  if (!mount) return;
  mount.innerHTML = progressInner(p);
  const btn = mount.querySelector("[data-run-cancel]");
  if (btn && !btn.disabled) btn.addEventListener("click", cancelActiveRun);
}

function initRunProgress() {
  if (RUN_PROGRESS_READY || !window.api || !window.api.onExperimentProgress) return;
  RUN_PROGRESS_READY = true;
  window.api.onExperimentProgress((p) => {
    if (!ACTIVE_RUN || !p) return;
    if (Number(p.order) !== Number(ACTIVE_RUN.order)) return;
    if (p.runId && ACTIVE_RUN.runId && String(p.runId) !== String(ACTIVE_RUN.runId)) return;
    if (p.runId && !ACTIVE_RUN.runId) ACTIVE_RUN.runId = String(p.runId);
    paintRunProgress(p);
  });
}

async function cancelActiveRun() {
  if (!ACTIVE_RUN || ACTIVE_RUN.cancelling) return;
  ACTIVE_RUN.cancelling = true;
  const btn = document.querySelector("#runProgressMount [data-run-cancel]");
  if (btn) { btn.disabled = true; btn.textContent = "正在取消…"; }
  try {
    const r = await window.api.cancelExperiment(ACTIVE_RUN.order);
    if (!r || !r.ok) {
      ACTIVE_RUN.cancelling = false;
      if (btn) { btn.disabled = false; btn.textContent = "取消运行"; }
    }
  } catch (e) {
    ACTIVE_RUN.cancelling = false;
    if (btn) { btn.disabled = false; btn.textContent = "取消运行"; }
    console.warn("[run] cancel failed: " + (e && e.message ? e.message : e));
  }
}

async function runCurrent() {
  if (!CUR || ACTIVE_RUN) return;
  const runOrder = CUR.order;
  const runExpNo = CUR.expNo;
  const pane = document.getElementById("pane-run");
  const body = document.getElementById("run-body");
  document.querySelectorAll(".doc-nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "run"));
  document.querySelectorAll(".pane").forEach((p) => p.classList.remove("on"));
  pane.classList.add("on");

  const btn = document.getElementById("btnRun");
  btn.disabled = true;
  btn.textContent = "运行中…";
  const runId = "exp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  ACTIVE_RUN = { order: runOrder, runId, cancelling: false };
  const initial = { phase: "connecting", elapsedMs: 0, indeterminate: true, timeoutMs: null };
  body.innerHTML = '<div id="runProgressMount">' + progressInner(initial) + "</div>";
  paintRunProgress(initial);

  try {
    const r = await window.api.runExperiment(runOrder, { clientRunId: runId });
    if (!r || !r.ok) {
      const status = (r && r.status) || "failed";
      const label = status === "cancelled" ? "运行已取消" : status === "timeout" ? "运行超时" : "运行失败";
      const cls = status === "cancelled" ? "run-note" : "run-note err";
      body.innerHTML = '<p class="' + cls + '">' + label + (r && r.reason ? "：" + esc(r.reason) : "") + "</p>";
      return;
    }

    const results = Array.isArray(r.results) ? r.results : [];
    const metrics = Array.isArray(r.metrics) ? r.metrics : [];
    LAST_RUNS.set(runOrder, {
      ok: true,
      status: r.status || "ok",
      backend: r.backend || "auto",
      fallbackFrom: r.fallbackFrom || null,
      elapsedMs: r.elapsedMs,
      results,
      metrics,
      log: r.log || "",
      runAt: Date.now(),
    });
    const svgs = results.map((x) => String(x.svg).replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, ""));
    const figs = results.length
      ? '<div class="results">' + results.map((x, i) =>
          '<figure class="result">' +
            '<div class="fig" data-i="' + i + '">' + svgs[i] + '</div>' +
            '<figcaption><span>' + esc(x.device) + '</span>' +
            '<button class="mini" data-save="' + i + '">导出 SVG</button></figcaption>' +
          '</figure>').join("") + '</div>'
      : "";
    const metricHtml = metricsHtml(metrics);
    const hasFigs = results.length > 0;
    const hasOutput = hasFigs || metrics.length > 0;
    const hint = hasOutput ? "" : '<p class="run-note">本题没有图形输出，下面是引擎日志。</p>';
    const logBox = r.log
      ? '<details class="run-log"' + (hasOutput ? "" : " open") + '><summary>引擎输出</summary><pre>' + esc(r.log) + '</pre></details>'
      : "";
    const meta = '<p class="run-meta">后端 ' + esc(r.backend || "auto") + " · 耗时 " + esc(formatElapsed(r.elapsedMs)) +
      (r.fallbackFrom ? " · 已从 " + esc(r.fallbackFrom) + " 回退" : "") + "</p>";
    const content = metricHtml + figs + hint + logBox || '<p class="run-note">本次运行没有任何输出。</p>';
    body.innerHTML = meta + content;
    body.querySelectorAll(".fig").forEach((el) => {
      el.addEventListener("click", () => openLightbox(svgs[Number(el.dataset.i)]));
    });
    body.querySelectorAll("[data-save]").forEach((saveBtn) => {
      saveBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const i = Number(saveBtn.dataset.save);
        const name = "实验" + runExpNo + "_" + (results[i].file || "fig.svg");
        const out = await window.api.saveFigure({ name, svg: svgs[i] });
        if (out && out.ok) saveBtn.textContent = "已导出";
      });
    });
  } catch (e) {
    body.innerHTML = '<p class="run-note err">运行失败：' + esc(e.message) + "</p>";
  } finally {
    ACTIVE_RUN = null;
    btn.disabled = false;
    btn.textContent = "运行仿真";
  }
}


async function exportCurrentReport() {
  if (!CUR) return;
  const order = CUR.order;
  const run = LAST_RUNS.get(order) || null;
  if (!run && !confirm("当前实验还没有运行结果，生成的报告将不含仿真图。是否继续导出？")) return;
  const btn = document.getElementById("btnReport");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "正在生成 PDF…";
  try {
    const result = await window.api.exportReport({ order, run });
    if (result && result.ok) {
      btn.textContent = "已导出 PDF";
      console.info("[report] saved:", result.path);
    } else if (!(result && result.canceled)) {
      alert("导出失败：" + ((result && result.reason) || "未知错误"));
    }
  } catch (err) {
    alert("导出失败：" + ((err && err.message) || err));
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 1200);
  }
}

function openLightbox(svg) {
  let box = document.getElementById("lightbox");
  if (box) box.remove();
  box = document.createElement("div");
  box.id = "lightbox";
  box.className = "lightbox";
  box.innerHTML = '<div class="box">' + svg + '</div>';
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") { box.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}


function splitSections(md) {
  const lines = md.split("\n");
  const secs = [];
  let cur = { title: "", body: [] };
  for (const l of lines) {
    const m = l.match(/^#{2,3}\s+(.*)$/);
    if (m) {
      if (cur.title || cur.body.join("").trim()) secs.push(cur);
      cur = { title: m[1].trim(), body: [] };
    } else {
      cur.body.push(l);
    }
  }
  if (cur.title || cur.body.join("").trim()) secs.push(cur);
  return secs;
}

function splitNumbered(lines) {
  const items = [];
  let cur = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\d+\s*[、.．]/.test(l)) {
      if (cur) items.push(cur);
      cur = l.replace(/^\d+\s*[、.．]\s*/, "");
    } else if (cur) {
      cur += l;
    } else {
      cur = l;
    }
  }
  if (cur) items.push(cur);
  return items;
}

function block(title, inner, cls) {
  return '<section class="sec ' + (cls || "") + '"><h3 class="sec-t">' + esc(title) + '</h3>' + inner + '</section>';
}

function renderBlockDiagram(exp, caption) {
  const vars = new Map();
  (exp.chain || []).forEach((c, i) => vars.set(c.var, i));
  const chain = (exp.chain || []).map((c, i) => ({
    i,
    label: c.devName || c.fn,
    inputs: String(c.args || "").split(",").map((a) => a.trim())
      .filter((a) => vars.has(a) && vars.get(a) !== i).map((a) => vars.get(a)),
  }));
  if (!chain.length) return "";
  const obs = (exp.observers || []).map((o, k) => {
    const args = String(o.args || "").split(",").map((a) => a.trim());
    const src = args.find((a) => vars.has(a));
    return { k, label: o.devName || o.fn, src: src == null ? null : vars.get(src) };
  });

  const depth = new Array(chain.length).fill(0);
  const calc = (i, seen) => {
    if (seen.has(i)) return 0;
    seen.add(i);
    const ins = chain[i].inputs;
    depth[i] = ins.length ? 1 + Math.max(...ins.map((j) => calc(j, seen))) : 0;
    return depth[i];
  };
  chain.forEach((n, i) => calc(i, new Set()));
  const maxDepth = Math.max(...depth);
  const cols = Array.from({ length: maxDepth + 1 }, () => []);
  chain.forEach((n, i) => cols[depth[i]].push(i));

  const BW = 118, BH = 42, GX = 52, GY = 24, PAD = 18;
  const rows = Math.max(cols.reduce((m, c) => Math.max(m, c.length), 0), obs.length);
  const width = PAD * 2 + (maxDepth + 2) * BW + (maxDepth + 1) * GX;
  const height = PAD * 2 + rows * BH + (rows - 1) * GY;

  const pos = {};
  cols.forEach((c, d) => {
    const totalH = c.length * BH + (c.length - 1) * GY;
    const y0 = (height - totalH) / 2;
    c.forEach((idx, k) => { pos[idx] = { x: PAD + d * (BW + GX), y: y0 + k * (BH + GY) }; });
  });
  const oy0 = (height - (obs.length * BH + (obs.length - 1) * GY)) / 2;
  obs.forEach((o, k) => { o.x = PAD + (maxDepth + 1) * (BW + GX); o.y = oy0 + k * (BH + GY); });

  const edges = [];
  const link = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2;
    edges.push('<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + (x2 - 6) + '" class="tl-edge"/>');
    edges.push('<path d="M' + (x2 - 7) + ' ' + (y2 - 4) + ' L' + x2 + ' ' + y2 + ' L' + (x2 - 7) + ' ' + (y2 + 4) + '" class="tl-arrow"/>');
  };
  chain.forEach((n) => n.inputs.forEach((j) => {
    const a = pos[j], b = pos[n.i];
    if (a && b) link(a.x + BW, a.y + BH / 2, b.x, b.y + BH / 2);
  }));
  obs.forEach((o) => {
    const a = pos[o.src];
    if (a) link(a.x + BW, a.y + BH / 2, o.x, o.y + BH / 2);
  });

  const box = (p, label, cls) => {
    const t = label.length > 8 ? label.slice(0, 7) + "…" : label;
    return '<g class="tl-node ' + (cls || "") + '"><rect x="' + p.x + '" y="' + p.y + '" width="' + BW + '" height="' + BH + '" rx="4"/>' +
      '<text x="' + (p.x + BW / 2) + '" y="' + (p.y + BH / 2 + 4) + '" text-anchor="middle">' + esc(t) + '</text></g>';
  };
  const boxes = chain.map((n) => box(pos[n.i], n.label)).join("") +
    obs.map((o) => box({ x: o.x, y: o.y }, o.label, "obs")).join("");

  return '<figure class="doc-figure"><div class="doc-figure-svg"><svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="min-width:' + Math.max(520, width) + 'px" role="img">' +
    edges.join("") + boxes + '</svg></div><figcaption>' + esc(caption) + '</figcaption>' +
    '<p class="fig-note">按平台器件链自动生成</p></figure>';
}

function applyDocFixes(exp, text) {
  let out = text;
  for (const r of window.DOC_INLINE || []) out = out.replace(r.re, r.html);
  const rules = (window.DOC_FORMULAS || {})[exp.order] || [];
  for (const r of rules) {
    const idx = out.indexOf(r.match);
    if (idx < 0) continue;
    const nl = out.indexOf("\n", idx);
    const end = nl < 0 ? out.length : nl;
    const block = "\n\n" + '<div class="formula">' + r.mathml + "</div>" +
      (r.note ? '<p class="formula-note">' + esc(r.note) + "</p>" : "") + "\n";
    out = out.slice(0, end) + block + out.slice(end);
  }
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "。") {
      const near = lines.slice(Math.max(0, i - 6), i).join("\n");
      if (near.indexOf('class="formula"') >= 0) { lines.splice(i, 1); i--; }
    }
  }
  out = lines.join("\n");
  out = out.replace(/^图\s*\d+(?:\.\d+)?\s+.*$/gm, (line) => {
    return "@@FIG@@" + line.trim() + "@@";
  });
  return out;
}

function renderFigure(exp, caption) {
  if (/(框图|原理图|组成|实验模型)/.test(caption)) return renderBlockDiagram(exp, caption);
  const f = window.renderCaptionFigure ? window.renderCaptionFigure(exp, caption) : "";
  return f || '<p class="fig-cap">' + esc(caption) + "</p>";
}

function renderTokens(exp, html) {
  return html.replace(/@@FIG@@([\s\S]*?)@@/g, (_, cap) => renderFigure(exp, cap.trim()));
}

async function renderDoc(exp, body) {
  const secs = splitSections(body);
  const parts = await Promise.all(secs.map(async (sec) => {
    const t = sec.title || "";
    const text = sec.body.join("\n");
    const fixed = applyDocFixes(exp, text);
    if (/^实验要求$/.test(t) || !t) return "";

    if (/实验目的/.test(t)) {
      const items = splitNumbered(sec.body);
      const lis = items.map((x) => "<li>" + esc(x) + "</li>").join("");
      return block(t, '<ol class="purpose">' + lis + "</ol>", "lead");
    }
    if (/实验仪器|实验器材/.test(t)) {
      const devs = (exp.devices || []).map((d) => "<li>" + esc(d) + "</li>").join("");
      return block(t, '<ul class="devices">' + devs + "</ul>");
    }
    if (/实验内容|步骤/.test(t)) {
      const items = splitNumbered(fixed.split("\n"));
      if (items.length > 1) {
        const lis = items.map((x) => {
          const parts = [];
          let rest = x;
          for (;;) {
            const m = rest.match(/@@FIG@@([\s\S]*?)@@/);
            if (!m) break;
            const before = rest.slice(0, m.index).trim();
            if (before) parts.push({ type: "text", value: before });
            parts.push({ type: "fig", value: m[1].trim() });
            rest = rest.slice(m.index + m[0].length);
          }
          if (rest.trim()) parts.push({ type: "text", value: rest.trim() });
          if (!parts.length) return "<li>" + esc(x) + "</li>";
          return parts.map((p) => p.type === "text"
            ? "<li>" + esc(p.value) + "</li>"
            : '<li class="fig-li">' + renderFigure(exp, p.value) + "</li>").join("");
        }).join("");
        return block(t, '<ol class="steps">' + lis + "</ol>");
      }
      return block(t, renderTokens(exp, await window.api.md(fixed)));
    }
    if (/提交报告/.test(t)) {
      return block(t, '<div class="submit">' + renderTokens(exp, await window.api.md(fixed)) + "</div>", "todo");
    }
    return block(t, renderTokens(exp, await window.api.md(fixed)));
  }));
  return parts.join("");
}


function renderTopology(exp) {
  const vars = new Map();
  exp.chain.forEach((c, i) => vars.set(c.var, i));
  const nodes = exp.chain.map((c, i) => ({
    i,
    label: c.devName || c.fn,
    inputs: c.args.split(",").map((a) => a.trim())
      .filter((a) => vars.has(a) && vars.get(a) !== i)
      .map((a) => vars.get(a)),
  }));
  if (!nodes.length) return "";

  const depth = new Array(nodes.length).fill(0);
  const calc = (i, seen) => {
    if (seen.has(i)) return 0;
    seen.add(i);
    const ins = nodes[i].inputs;
    depth[i] = ins.length ? 1 + Math.max(...ins.map((j) => calc(j, seen))) : 0;
    return depth[i];
  };
  nodes.forEach((n, i) => calc(i, new Set()));

  const maxDepth = Math.max(...depth);
  const cols = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n, i) => { cols[depth[i]].push(i); });

  const BW = 128, BH = 44, GX = 64, GY = 22, PAD = 16;
  const maxRows = Math.max(...cols.map((c) => c.length));
  const width = PAD * 2 + cols.length * BW + (cols.length - 1) * GX;
  const height = PAD * 2 + maxRows * BH + (maxRows - 1) * GY;

  const pos = {};
  cols.forEach((c, d) => {
    const totalH = c.length * BH + (c.length - 1) * GY;
    const y0 = (height - totalH) / 2;
    c.forEach((idx, k) => { pos[idx] = { x: PAD + d * (BW + GX), y: y0 + k * (BH + GY) }; });
  });

  const edges = [];
  nodes.forEach((n) => n.inputs.forEach((j) => {
    const a = pos[j], b = pos[n.i];
    const x1 = a.x + BW, y1 = a.y + BH / 2;
    const x2 = b.x, y2 = b.y + BH / 2;
    const mx = (x1 + x2) / 2;
    edges.push('<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + (x2 - 6) + '" class="tl-edge"/>');
    edges.push('<path d="M' + (x2 - 7) + ' ' + (y2 - 4) + ' L' + x2 + ' ' + y2 + ' L' + (x2 - 7) + ' ' + (y2 + 4) + '" class="tl-arrow"/>');
  }));

  const boxes = nodes.map((n) => {
    const p = pos[n.i];
    const label = n.label.length > 9 ? n.label.slice(0, 8) + "…" : n.label;
    return '<g class="tl-node"><rect x="' + p.x + '" y="' + p.y + '" width="' + BW + '" height="' + BH + '" rx="4"/>' +
      '<text x="' + (p.x + BW / 2) + '" y="' + (p.y + BH / 2 + 4) + '" text-anchor="middle">' + esc(label) + '</text></g>';
  }).join("");

  return '<p class="sect-label">信号流示意</p>' +
    '<div class="topo"><svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" role="img">' + edges.join("") + boxes + '</svg></div>';
}


function skeleton() {
  return '<div class="skeleton" aria-busy="true">' +
    '<div class="sk sk-t"></div><div class="sk"></div><div class="sk"></div>' +
    '<div class="sk sk-s"></div><div class="sk"></div><div class="sk sk-short"></div></div>';
}
