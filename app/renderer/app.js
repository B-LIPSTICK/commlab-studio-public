let ALL = [];
let CUR = null;
let ACTIVE_RUN = null;
let RUN_PROGRESS_READY = false;
let COURSEPACK = null;
let DUPLICATE_EXP_NOS = new Set();
let LAST_RUNS = new Map();
let CURRENT_VIEW = "library";
let CURRENT_MODULE = null;
let TOC_PINNED = false;
let CURRENT_PLATFORM_URL = "";
let CURRENT_SCRIPT_TEXT = "";
let SEARCH_HITS = [];
let SEARCH_INDEX = -1;
let SELECT_TOKEN = 0;
let TOAST_TIMER = null;
let SCROLL_TIMER = null;

const PROGRESS_KEY = "commlab.readProgress.v1";
const LAST_KEY = "commlab.lastExperiment.v1";
const TOC_PIN_KEY = "commlab.tocPinned.v1";
const SCROLL_KEY = "commlab.readerScroll.v1";

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

async function initTheme() {
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const forced = new URLSearchParams(location.search).get("theme");
  let currentMode = forced || localStorage.getItem("theme") || "auto";
  const apply = (mode) => {
    currentMode = mode || "auto";
    root.dataset.theme = currentMode === "auto" ? (mq.matches ? "dark" : "light") : currentMode;
    root.dataset.themeMode = currentMode;
    const btn = document.getElementById("theme");
    if (btn) btn.title = "主题：" + ({ light: "日间", dark: "夜间", auto: "跟随系统" })[currentMode] + "（点击切换）";
  };
  try {
    const result = window.api && window.api.settingsGet ? await window.api.settingsGet() : null;
    const stored = result && result.ok && result.settings && result.settings.appearance
      ? result.settings.appearance.theme
      : null;
    if (stored) currentMode = stored;
  } catch {}
  apply(forced || currentMode);

  mq.addEventListener("change", () => {
    if (currentMode === "auto") apply("auto");
  });

  if (window.api && window.api.onSettingsAppearance) {
    window.api.onSettingsAppearance((appearance) => {
      if (!appearance) return;
      apply(appearance.theme || "auto");
    });
  }

  const btn = document.getElementById("theme");
  if (btn) btn.addEventListener("click", async () => {
    const order = ["light", "dark", "auto"];
    const next = order[(order.indexOf(currentMode) + 1) % 3];
    apply(next);
    try {
      if (window.api && window.api.settingsSet) await window.api.settingsSet({ appearance: { theme: next } });
    } catch {}
    try {
      if (next === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
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

function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  clearTimeout(TOAST_TIMER);
  el.textContent = String(message || "");
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-show"));
  TOAST_TIMER = setTimeout(() => {
    el.classList.remove("is-show");
    setTimeout(() => { el.hidden = true; }, 180);
  }, 2600);
}

function openSettings() {
  if (window.api && window.api.openSettings) {
    try {
      const result = window.api.openSettings();
      if (result && typeof result.catch === "function") {
        result.catch(() => toast("设置页暂时无法打开"));
      }
      return;
    } catch {
      toast("设置页暂时无法打开");
      return;
    }
  }
  toast("设置页尚未接入，请稍后再试");
}

async function openWorkbench() {
  if (!window.api || !window.api.openWorkbench) {
    toast("工作台接口不可用");
    return;
  }
  try {
    const r = await window.api.openWorkbench();
    if (r && r.ok === false) toast(r.reason || "工作台打开失败");
  } catch (e) {
    toast("工作台打开失败：" + ((e && e.message) || e));
  }
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function getProgress() {
  const raw = readStore(PROGRESS_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function readCount() {
  const progress = getProgress();
  return ALL.reduce((n, exp) => n + (progress[exp.order] ? 1 : 0), 0);
}

function markVisited(exp) {
  if (!exp) return;
  const progress = getProgress();
  progress[exp.order] = Date.now();
  writeStore(PROGRESS_KEY, progress);
  try { localStorage.setItem(LAST_KEY, String(exp.order)); } catch {}
}

function getLastExperiment() {
  let order = NaN;
  try { order = Number(localStorage.getItem(LAST_KEY)); } catch {}
  let last = ALL.find((exp) => Number(exp.order) === order);
  if (last) return last;
  const progress = getProgress();
  const ordered = Object.keys(progress)
    .map((key) => ({ order: Number(key), at: Number(progress[key]) || 0 }))
    .sort((a, b) => b.at - a.at);
  return ALL.find((exp) => Number(exp.order) === ordered[0]?.order) || null;
}

function lastInModule(module) {
  const progress = getProgress();
  let best = null;
  for (const exp of module.experiments) {
    if (!progress[exp.order]) continue;
    if (!best || Number(progress[exp.order]) > Number(progress[best.order])) best = exp;
  }
  return best;
}

function getModules() {
  const groups = new Map();
  for (const exp of ALL) {
    const key = exp.module || "其他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(exp);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = MODULE_ORDER.indexOf(a), ib = MODULE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((id) => {
    const experiments = sortExperiments(groups.get(id));
    const first = experiments[0] || {};
    return { id, title: first.moduleTitle || "", chapters: first.chapters || "", experiments };
  });
}

function getModule(id) {
  return getModules().find((m) => m.id === id) || null;
}

function sortExperiments(items) {
  return (items || []).slice().sort((a, b) =>
    displayExpNo(a).localeCompare(displayExpNo(b), "zh-CN", { numeric: true }) ||
    Number(a.order) - Number(b.order));
}

function moduleLabel(module) {
  return [module.id, module.title].filter(Boolean).join(" · ");
}

function setActiveNav() {
  const nav = document.getElementById("navLibrary");
  if (nav) nav.classList.add("is-active");
}

function setActiveTab(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("#docBody .pane").forEach((p) => p.classList.remove("on"));
  const pane = document.getElementById("pane-" + tab);
  if (pane) pane.classList.add("on");
}
function renderLibraryHome() {
  CURRENT_VIEW = "library";
  CURRENT_MODULE = null;
  setActiveNav();
  document.getElementById("libraryView").hidden = false;
  document.getElementById("readerView").hidden = true;
  document.getElementById("libraryHome").hidden = false;
  document.getElementById("moduleDetail").hidden = true;
  closeSearch(false);
  closeMore();
  setDrawerOpen(false);

  const modules = getModules();
  document.getElementById("statModules").textContent = String(modules.length || 7);
  document.getElementById("statExperiments").textContent = String(ALL.length || 38);
  document.getElementById("statRead").textContent = String(readCount());
  document.getElementById("moduleCount").textContent = "共 " + modules.length + " 个模块";
  renderContinue();
  renderModuleGrid(modules);
}

function renderContinue() {
  const mount = document.getElementById("continueMount");
  if (!mount) return;
  const last = getLastExperiment();
  if (!last) {
    mount.innerHTML =
      '<section class="continue-card is-empty">' +
        '<div class="continue-copy"><p class="continue-kicker">继续上次实验</p>' +
        '<h2 class="continue-title">还没有阅读记录</h2>' +
        '<p class="continue-meta">从下方课程模块开始，系统会记住你最近打开的实验。</p></div>' +
        '<span class="continue-cta">选择模块 ↓</span>' +
      '</section>';
    return;
  }
  mount.innerHTML =
    '<button class="continue-card" type="button" data-order="' + last.order + '">' +
      '<span class="continue-copy"><span class="continue-kicker">继续上次实验</span>' +
      '<span class="continue-title">' + esc(last.title) + '</span>' +
      '<span class="continue-meta">' + esc(moduleLabel({ id: last.module || "其他", title: last.moduleTitle || "" })) +
        ' · 实验' + esc(displayExpNo(last)) + ' · 第 ' + esc(last.order) + ' 题</span></span>' +
      '<span class="continue-cta">继续阅读 →</span>' +
    '</button>';
}

function renderModuleGrid(modules) {
  const grid = document.getElementById("moduleGrid");
  if (!grid) return;
  if (!modules.length) {
    grid.innerHTML = '<div class="empty-state"><p class="es-title">题库是空的</p><p class="es-sub">检查 data/experiments.json 是否存在。</p></div>';
    return;
  }
  grid.innerHTML = modules.map((module, index) => {
    const progress = getProgress();
    const read = module.experiments.filter((exp) => progress[exp.order]).length;
    const recent = lastInModule(module);
    const pct = module.experiments.length ? Math.round((read / module.experiments.length) * 100) : 0;
    return '<button class="module-card" type="button" data-module="' + esc(module.id) + '">' +
      '<span class="module-card-top"><span class="module-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="module-chapters">' + esc(module.chapters) + '</span></span>' +
      '<span class="module-title">' + esc(moduleLabel(module)) + '</span>' +
      '<span class="module-meta">' + module.experiments.length + ' 个实验</span>' +
      '<span class="module-progress"><span>已读 ' + read + ' / ' + module.experiments.length + '</span><span>' + pct + '%</span></span>' +
      '<span class="module-progress-track"><span style="width:' + pct + '%"></span></span>' +
      '<span class="module-recent' + (recent ? "" : " is-empty") + '">' +
        (recent ? "最近：" + esc(recent.title) : "尚未开始") +
      '</span>' +
    '</button>';
  }).join("");
}

function showLibraryHome() {
  saveReaderScroll();
  renderLibraryHome();
  const scroll = document.getElementById("libraryScroll");
  if (scroll) scroll.scrollTop = 0;
}

function showModule(moduleId) {
  const module = getModule(moduleId);
  if (!module) {
    showLibraryHome();
    return;
  }
  saveReaderScroll();
  CURRENT_VIEW = "module";
  CURRENT_MODULE = module.id;
  setActiveNav();
  closeSearch(true);
  closeMore();
  setDrawerOpen(false);
  document.getElementById("libraryView").hidden = false;
  document.getElementById("readerView").hidden = true;
  document.getElementById("libraryHome").hidden = true;
  document.getElementById("moduleDetail").hidden = false;

  const progress = getProgress();
  const read = module.experiments.filter((exp) => progress[exp.order]).length;
  const rows = module.experiments.map((exp) => {
    const devices = (exp.devices || []).slice(0, 3).join(" · ");
    return '<button class="exp-row" type="button" data-order="' + exp.order + '">' +
      '<span class="exp-no">' + esc(displayExpNo(exp)) + '</span>' +
      '<span class="exp-title">' + esc(exp.title) + '</span>' +
      '<span class="exp-devices">' + esc(devices) + '</span>' +
      '<span class="exp-state' + (progress[exp.order] ? " is-read" : "") + '">' +
        (progress[exp.order] ? "已读" : "未读") + '</span>' +
    '</button>';
  }).join("");

  const detail = document.getElementById("moduleDetail");
  detail.innerHTML =
    '<button class="module-back" type="button" data-back-library>← 课程库</button>' +
    '<header class="module-head"><p class="eyebrow">课程模块</p>' +
      '<h1>' + esc(moduleLabel(module)) + '</h1>' +
      '<p>' + esc(module.chapters) + ' · ' + module.experiments.length + ' 个实验 · 已读 ' + read + '</p>' +
    '</header>' +
    '<div class="module-list-head"><h2>实验列表</h2><span>' + module.experiments.length + ' 项</span></div>' +
    '<div class="exp-list">' + rows + '</div>';

  const scroll = document.getElementById("libraryScroll");
  if (scroll) scroll.scrollTop = 0;
}

function saveReaderScroll() {
  if (CURRENT_VIEW !== "reader" || !CUR) return;
  const scroll = document.getElementById("readerScroll");
  if (!scroll) return;
  const map = readStore(SCROLL_KEY, {});
  if (!map || typeof map !== "object" || Array.isArray(map)) return;
  map[CUR.order] = scroll.scrollTop;
  writeStore(SCROLL_KEY, map);
}

function storedScroll(order) {
  const map = readStore(SCROLL_KEY, {});
  return map && Number.isFinite(Number(map[order])) ? Number(map[order]) : 0;
}

function showReaderView(exp) {
  CURRENT_VIEW = "reader";
  setActiveNav();
  document.getElementById("libraryView").hidden = true;
  document.getElementById("readerView").hidden = false;
  document.getElementById("crumbModule").textContent = moduleLabel({ id: exp.module || "其他", title: exp.moduleTitle || "" });
  document.getElementById("crumbTitle").textContent = exp.title;
  document.getElementById("readerKicker").textContent = "实验" + displayExpNo(exp) + (exp.chapters ? " · " + exp.chapters : "");
  setDrawerOpen(TOC_PINNED);
}

function updatePager() {
  const module = getModule(CURRENT_MODULE);
  const list = module ? module.experiments : [];
  const index = list.findIndex((exp) => CUR && Number(exp.order) === Number(CUR.order));
  const prev = document.getElementById("prevExp");
  const next = document.getElementById("nextExp");
  if (!prev || !next) return;
  prev.disabled = index <= 0;
  next.disabled = index < 0 || index >= list.length - 1;
  prev.title = index > 0 ? list[index - 1].title : "";
  next.title = index >= 0 && index < list.length - 1 ? list[index + 1].title : "";
}

function navigateReader(delta) {
  if (CURRENT_VIEW !== "reader") return;
  const module = getModule(CURRENT_MODULE);
  if (!module) return;
  const index = module.experiments.findIndex((exp) => CUR && Number(exp.order) === Number(CUR.order));
  const target = module.experiments[index + delta];
  if (target) select(target);
}
function closeSearch(clear) {
  const panel = document.getElementById("searchPanel");
  const input = document.getElementById("search");
  if (panel) panel.hidden = true;
  if (input) input.setAttribute("aria-expanded", "false");
  if (clear && input) input.value = "";
  SEARCH_HITS = [];
  SEARCH_INDEX = -1;
}

function experimentMatches(exp, q) {
  const devices = (exp.devices || []).join(" ").toLowerCase();
  const no = displayExpNo(exp).toLowerCase();
  const hay = [exp.title, exp.module, exp.moduleTitle, exp.chapters, devices].join(" ").toLowerCase();
  return hay.includes(q) ||
    (String(exp.order) === q && !DUPLICATE_EXP_NOS.has(q)) ||
    q === "#" + exp.order ||
    q === "第" + exp.order + "题" ||
    q === "order:" + exp.order ||
    String(exp.expNo).toLowerCase() === q ||
    no === q;
}

function moduleMatches(module, q) {
  return [module.id, module.title, module.chapters].join(" ").toLowerCase().includes(q);
}

function runSearch(value) {
  const q = String(value || "").trim().toLowerCase();
  if (!q) {
    closeSearch(false);
    return;
  }
  const modules = getModules();
  const moduleHits = modules.filter((module) => moduleMatches(module, q));
  const moduleIds = new Set(moduleHits.map((module) => module.id));
  const experimentHits = ALL.filter((exp) => moduleIds.has(exp.module) || experimentMatches(exp, q));
  SEARCH_HITS = [
    ...moduleHits.map((module) => ({ type: "module", module })),
    ...sortExperiments(experimentHits).map((exp) => ({ type: "experiment", exp })),
  ];
  SEARCH_INDEX = SEARCH_HITS.length ? 0 : -1;
  renderSearchPanel(q);
}

function searchHitHtml(hit, index) {
  const active = index === SEARCH_INDEX ? " is-active" : "";
  if (hit.type === "module") {
    const module = hit.module;
    return '<button class="search-hit' + active + '" type="button" role="option" aria-selected="' + (active ? "true" : "false") + '" data-search-index="' + index + '">' +
      '<span class="search-hit-top"><span class="search-hit-no">模块</span><span class="search-hit-title">' + esc(moduleLabel(module)) + '</span></span>' +
      '<span class="search-hit-sub">' + esc(module.chapters) + ' · ' + module.experiments.length + ' 个实验</span>' +
    '</button>';
  }
  const exp = hit.exp;
  return '<button class="search-hit' + active + '" type="button" role="option" aria-selected="' + (active ? "true" : "false") + '" data-search-index="' + index + '">' +
    '<span class="search-hit-top"><span class="search-hit-no">' + esc(displayExpNo(exp)) + '</span><span class="search-hit-title">' + esc(exp.title) + '</span></span>' +
    '<span class="search-hit-sub">' + esc(moduleLabel({ id: exp.module || "其他", title: exp.moduleTitle || "" })) + ' · ' + esc((exp.devices || []).slice(0, 2).join(" · ")) + '</span>' +
  '</button>';
}

function renderSearchPanel(q) {
  const panel = document.getElementById("searchPanel");
  const input = document.getElementById("search");
  if (!panel) return;
  if (!SEARCH_HITS.length) {
    panel.innerHTML = '<div class="search-empty">没有找到与“' + esc(q) + '”相关的模块或实验</div>';
  } else {
    const moduleRows = SEARCH_HITS.map((hit, index) => hit.type === "module" ? searchHitHtml(hit, index) : "").join("");
    const expRows = SEARCH_HITS.map((hit, index) => hit.type === "experiment" ? searchHitHtml(hit, index) : "").join("");
    panel.innerHTML =
      (moduleRows ? '<div class="search-group"><div class="search-group-title">模块</div>' + moduleRows + '</div>' : "") +
      (expRows ? '<div class="search-group"><div class="search-group-title">实验</div>' + expRows + '</div>' : "");
  }
  panel.hidden = false;
  if (input) input.setAttribute("aria-expanded", "true");
  const active = panel.querySelector(".is-active");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
}

function updateSearchActive() {
  const panel = document.getElementById("searchPanel");
  if (!panel) return;
  panel.querySelectorAll("[data-search-index]").forEach((el) => {
    const on = Number(el.dataset.searchIndex) === SEARCH_INDEX;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });
  const active = panel.querySelector(".is-active");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
}

function activateSearchHit(index) {
  const hit = SEARCH_HITS[index];
  if (!hit) return;
  const input = document.getElementById("search");
  closeSearch(true);
  if (input) input.blur();
  if (hit.type === "module") showModule(hit.module.id);
  else select(hit.exp);
}

function setDrawerOpen(open) {
  const shell = document.getElementById("readerShell");
  if (!shell) return;
  const pinned = !!TOC_PINNED && !!open;
  shell.classList.toggle("toc-open", !!open);
  shell.classList.toggle("toc-pinned", pinned);
  const drawer = document.getElementById("tocDrawer");
  const toggle = document.getElementById("tocToggle");
  if (drawer) drawer.setAttribute("aria-hidden", open ? "false" : "true");
  if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function setTocPinned(pinned) {
  TOC_PINNED = !!pinned;
  try {
    if (TOC_PINNED) localStorage.setItem(TOC_PIN_KEY, "1");
    else localStorage.removeItem(TOC_PIN_KEY);
  } catch {}
  const pin = document.getElementById("pinToc");
  if (pin) {
    pin.classList.toggle("is-active", TOC_PINNED);
    pin.setAttribute("aria-pressed", TOC_PINNED ? "true" : "false");
  }
  setDrawerOpen(TOC_PINNED);
}

function renderDrawer() {
  const mount = document.getElementById("drawerList");
  if (!mount) return;
  mount.innerHTML = getModules().map((module) => {
    const isCurrent = module.id === CURRENT_MODULE;
    const rows = module.experiments.map((exp) => {
      const current = CUR && Number(exp.order) === Number(CUR.order);
      return '<button class="drawer-exp' + (current ? " is-current" : "") + '" type="button" data-order="' + exp.order + '"' + (current ? ' aria-current="page"' : "") + '>' +
        '<span class="no">' + esc(displayExpNo(exp)) + '</span><span class="nm">' + esc(exp.title) + '</span>' +
      '</button>';
    }).join("");
    return '<details class="drawer-group"' + (isCurrent ? " open" : "") + '>' +
      '<summary><span class="drawer-module-name">' + esc(moduleLabel(module)) + '</span><span class="drawer-module-count">' + module.experiments.length + '</span></summary>' +
      rows +
    '</details>';
  }).join("");
}

function closeMore() {
  const menu = document.getElementById("moreMenu");
  const button = document.getElementById("btnMore");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleMore() {
  const menu = document.getElementById("moreMenu");
  const button = document.getElementById("btnMore");
  if (!menu || !button) return;
  const open = menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

async function copyText(text) {
  if (!text) throw new Error("没有可复制的内容");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("剪贴板不可用");
}

async function handleMore(action) {
  closeMore();
  if (action === "workbench") {
    await openWorkbench();
    return;
  }
  if (action === "platform") {
    if (!CURRENT_PLATFORM_URL) {
      toast("当前实验没有可用的平台原页链接");
      return;
    }
    if (window.api && window.api.openExternal) window.api.openExternal(CURRENT_PLATFORM_URL);
    else toast("外部链接接口不可用");
    return;
  }
  if (action === "copy") {
    if (!CURRENT_SCRIPT_TEXT) {
      toast("当前课程包未提供实验脚本");
      return;
    }
    try {
      await copyText(CURRENT_SCRIPT_TEXT);
      toast("实验脚本已复制");
    } catch (e) {
      toast("复制失败：" + ((e && e.message) || e));
    }
  }
}
function initShell() {
  document.getElementById("brandHome").addEventListener("click", showLibraryHome);
  document.getElementById("navLibrary").addEventListener("click", showLibraryHome);
  document.getElementById("navWorkbench").addEventListener("click", openWorkbench);
  document.getElementById("btnSettings").addEventListener("click", openSettings);
  document.getElementById("statusDot").addEventListener("click", openSettings);

  const search = document.getElementById("search");
  search.addEventListener("input", (e) => runSearch(e.target.value));
  search.addEventListener("focus", () => { if (search.value.trim()) runSearch(search.value); });
  document.getElementById("searchPanel").addEventListener("click", (e) => {
    const hit = e.target.closest("[data-search-index]");
    if (hit) activateSearchHit(Number(hit.dataset.searchIndex));
  });

  document.getElementById("moduleGrid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-module]");
    if (card) showModule(card.dataset.module);
  });
  document.getElementById("continueMount").addEventListener("click", (e) => {
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const exp = ALL.find((x) => Number(x.order) === Number(card.dataset.order));
    if (exp) select(exp);
  });
  document.getElementById("moduleDetail").addEventListener("click", (e) => {
    if (e.target.closest("[data-back-library]")) {
      showLibraryHome();
      return;
    }
    const row = e.target.closest("[data-order]");
    if (!row) return;
    const exp = ALL.find((x) => Number(x.order) === Number(row.dataset.order));
    if (exp) select(exp);
  });

  document.getElementById("crumbLibrary").addEventListener("click", showLibraryHome);
  document.getElementById("crumbModule").addEventListener("click", () => showModule(CURRENT_MODULE));
  document.getElementById("tocToggle").addEventListener("click", () => {
    const shell = document.getElementById("readerShell");
    setDrawerOpen(!shell.classList.contains("toc-open"));
  });
  document.getElementById("closeToc").addEventListener("click", () => {
    if (TOC_PINNED) setTocPinned(false);
    else setDrawerOpen(false);
  });
  document.getElementById("pinToc").addEventListener("click", () => setTocPinned(!TOC_PINNED));
  document.getElementById("drawerScrim").addEventListener("click", () => setDrawerOpen(false));
  document.getElementById("drawerList").addEventListener("click", (e) => {
    const row = e.target.closest("[data-order]");
    if (!row) return;
    const exp = ALL.find((x) => Number(x.order) === Number(row.dataset.order));
    if (exp) select(exp);
  });

  document.getElementById("btnRun").addEventListener("click", runCurrent);
  document.getElementById("btnReport").addEventListener("click", exportCurrentReport);
  document.getElementById("btnMore").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMore();
  });
  document.getElementById("moreMenu").addEventListener("click", (e) => {
    const item = e.target.closest("[data-more]");
    if (item) handleMore(item.dataset.more);
  });
  document.getElementById("tabs").addEventListener("click", (e) => {
    const button = e.target.closest("button[data-tab]");
    if (button) setActiveTab(button.dataset.tab);
  });
  document.getElementById("prevExp").addEventListener("click", () => navigateReader(-1));
  document.getElementById("nextExp").addEventListener("click", () => navigateReader(1));

  document.addEventListener("click", (e) => {
    const searchBox = document.getElementById("searchBox");
    if (searchBox && !searchBox.contains(e.target)) closeSearch(false);
    const moreWrap = document.getElementById("moreWrap");
    if (moreWrap && !moreWrap.contains(e.target)) closeMore();
  });
  document.addEventListener("keydown", onGlobalKey);
  document.getElementById("readerScroll").addEventListener("scroll", () => {
    clearTimeout(SCROLL_TIMER);
    SCROLL_TIMER = setTimeout(saveReaderScroll, 160);
  });
  window.addEventListener("beforeunload", saveReaderScroll);
}

function onGlobalKey(e) {
  const target = e.target instanceof Element ? e.target : document.body;
  const tag = (target && target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
  const search = document.getElementById("search");
  const panel = document.getElementById("searchPanel");

  if (e.key === "/" && !typing) {
    e.preventDefault();
    search.focus();
    search.select();
    if (search.value.trim()) runSearch(search.value);
    return;
  }

  if (e.key === "Escape") {
    if (panel && !panel.hidden) {
      e.preventDefault();
      closeSearch(true);
      search.blur();
      return;
    }
    const moreMenu = document.getElementById("moreMenu");
    if (moreMenu && !moreMenu.hidden) {
      e.preventDefault();
      closeMore();
      return;
    }
    const shell = document.getElementById("readerShell");
    if (shell && shell.classList.contains("toc-open")) {
      e.preventDefault();
      setDrawerOpen(false);
      return;
    }
    if (typing) {
      e.preventDefault();
      closeSearch(true);
      search.blur();
    }
    return;
  }

  if (panel && !panel.hidden && SEARCH_HITS.length) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      SEARCH_INDEX = e.key === "ArrowDown"
        ? Math.min(SEARCH_HITS.length - 1, SEARCH_INDEX + 1)
        : Math.max(0, SEARCH_INDEX - 1);
      updateSearchActive();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activateSearchHit(SEARCH_INDEX);
      return;
    }
  }

  if (typing) return;

  if (CURRENT_VIEW === "reader" && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    navigateReader(e.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (CURRENT_VIEW === "reader" && e.key === "Enter" && !target.closest("button,a,input,textarea,select,[contenteditable]")) {
    e.preventDefault();
    runCurrent();
  }
}

async function boot() {
  await initTheme();
  initUpdates();
  TOC_PINNED = false;
  try { TOC_PINNED = localStorage.getItem(TOC_PIN_KEY) === "1"; } catch {}
  const pin = document.getElementById("pinToc");
  if (pin) {
    pin.classList.toggle("is-active", TOC_PINNED);
    pin.setAttribute("aria-pressed", TOC_PINNED ? "true" : "false");
  }
  initShell();
  initRunProgress();
  initCoursepackControls();
  initNativeStatus();
  try {
    await refreshCatalog();
  } catch (err) {
    console.error(err);
    ALL = [];
    COURSEPACK = null;
  }
  showLibraryHome();

  const params = new URLSearchParams(location.search);
  const auto = params.get("run");
  if (auto) {
    const exp = ALL.find((x) => Number(x.order) === Number(auto));
    if (exp) {
      await select(exp);
      await runCurrent();
    }
    return;
  }
  const tab = params.get("tab");
  if (tab && ALL[0]) {
    await select(ALL[0]);
    setActiveTab(tab);
  }
}

async function refreshCatalog() {
  const data = await window.api.list();
  ALL = Array.isArray(data.experiments) ? data.experiments : [];
  const expNoCounts = new Map();
  for (const x of ALL) {
    const key = String(x.expNo);
    expNoCounts.set(key, (expNoCounts.get(key) || 0) + 1);
  }
  DUPLICATE_EXP_NOS = new Set([...expNoCounts].filter(([, count]) => count > 1).map(([key]) => key));
  COURSEPACK = window.api.coursepackStatus ? await window.api.coursepackStatus() : null;
  updateCoursepackUi();
}

function updateCoursepackUi() {
  const state = document.getElementById("cpState");
  const btn = document.getElementById("btnCoursepack");
  const clear = document.getElementById("btnCoursepackClear");
  if (!state || !btn || !clear) return;
  if (COURSEPACK && COURSEPACK.installed) {
    state.textContent = "课程包：" + COURSEPACK.markdownCount + " 篇";
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
      toast("导入失败：" + ((r && r.reason) || "未知原因"));
      return;
    }
    await refreshCatalog();
    const keep = CUR && ALL.find((x) => Number(x.order) === Number(CUR.order));
    if (CURRENT_VIEW === "reader" && keep) await select(keep);
    else if (CURRENT_VIEW === "module" && CURRENT_MODULE) showModule(CURRENT_MODULE);
    else showLibraryHome();
  } catch (e) {
    toast("导入失败：" + (e.message || String(e)));
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
      toast("清除失败：" + ((r && r.reason) || "未知原因"));
      return;
    }
    await refreshCatalog();
    const keep = CUR && ALL.find((x) => Number(x.order) === Number(CUR.order));
    if (CURRENT_VIEW === "reader" && keep) await select(keep);
    else if (CURRENT_VIEW === "module" && CURRENT_MODULE) showModule(CURRENT_MODULE);
    else showLibraryHome();
  } catch (e) {
    toast("清除失败：" + (e.message || String(e)));
  }
}

function initNativeStatus() {
  const dot = document.getElementById("statusDot");
  if (!dot || !window.api || !window.api.nativeStatus) return;
  window.api.nativeStatus().then((status) => {
    if (!status || !status.ok) return;
    const text = document.getElementById("statusText");
    if (text) text.textContent = "内置仿真 · 就绪";
    if (Number.isFinite(status.covered) && Number.isFinite(status.total)) {
      dot.title = "内置仿真覆盖 " + status.covered + "/" + status.total + " · 点击打开设置";
    }
  }).catch(() => {});
}
async function readCourseText(rel) {
  const result = await window.api.read(rel);
  if (result && typeof result === "object") {
    if (result.ok === false) {
      const error = new Error(result.detail || result.reason || "课程文件不可用");
      error.reason = result.reason || "unavailable";
      throw error;
    }
    return String(result.text == null ? "" : result.text);
  }
  return String(result == null ? "" : result);
}

function extractPlatformUrl(markdown) {
  const match = String(markdown || "").match(/^\s*-\s*页面[:：]\s*(https?:\/\/\S+)/m);
  return match ? match[1] : "";
}

function coursepackMissingHtml(exp, err) {
  const installed = !!(COURSEPACK && COURSEPACK.installed);
  const title = installed ? "课程包缺少这篇原文" : "这份实验的课程原文不在安装包中";
  const sub = installed
    ? "已导入课程包，但没有找到 " + esc(exp.markdown || "对应 Markdown") + "。可重新导入完整课程包。"
    : "公开安装包只包含题号、标题、器件链和参数等结构化元数据。导入课程包后即可阅读课程原文。";
  const detail = installed && err ? '<p class="es-sub es-detail">' + esc(err.message || String(err)) + "</p>" : "";
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

function displayExpNo(exp) {
  const raw = exp && exp.expNo != null ? String(exp.expNo).trim() : "";
  if (!raw) return "";
  const suffix = String((exp && exp.title) || "").match(/[-－]([12])\s*$/);
  const label = /^\d+$/.test(raw) ? raw.padStart(2, "0") : raw;
  return suffix ? label + "-" + suffix[1] : label;
}

const MODULE_ORDER = ["模块一", "模块二", "模块三", "模块四", "模块五", "模块六", "模块七"];

function normalizeBody(md, title) {
  md = String(md || "").replace(/\r\n/g, "\n");
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
    if (/^[-*]\s*页面[:：]\s*https?:\/\//.test(line)) continue;
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
  if (!x) return;
  const exp = ALL.find((item) => Number(item.order) === Number(x.order)) || x;
  saveReaderScroll();
  CUR = exp;
  CURRENT_MODULE = exp.module || "其他";
  markVisited(exp);
  const token = ++SELECT_TOKEN;
  showReaderView(exp);
  setActiveTab("req");
  document.getElementById("run-body").innerHTML = "";

  const chain = Array.isArray(exp.chain) ? exp.chain : [];
  const observers = Array.isArray(exp.observers) ? exp.observers : [];
  document.getElementById("title").textContent = exp.title;
  document.getElementById("meta").innerHTML = [
    "实验" + displayExpNo(exp),
    "第 " + exp.order + " 题",
    chain.length + " 个器件",
    observers.length + " 个观测",
  ].map((text) => "<span>" + esc(text) + "</span>").join("");

  CURRENT_PLATFORM_URL = "";
  CURRENT_SCRIPT_TEXT = "";
  document.getElementById("script").textContent = "";
  document.getElementById("pane-req").innerHTML = skeleton();

  let raw = "";
  try {
    raw = await readCourseText(exp.markdown);
    if (token !== SELECT_TOKEN) return;
    CURRENT_PLATFORM_URL = extractPlatformUrl(raw);
    const body = normalizeBody(raw, exp.title);
    const html = await renderDoc(exp, body);
    if (token !== SELECT_TOKEN) return;
    document.getElementById("pane-req").innerHTML = html;
  } catch (err) {
    if (token !== SELECT_TOKEN) return;
    document.getElementById("pane-req").innerHTML = coursepackMissingHtml(exp, err);
  }

  const rows = chain.map((c, i) =>
    '<tr><td>' + (i + 1) + '</td><td><code>' + esc(c.var) + '</code></td>' +
    '<td class="dev">' + esc(c.devName || c.fn) + '</td>' +
    '<td><code>' + esc(c.fn) + '(' + esc(c.args) + ')</code></td></tr>').join("");
  const obs = observers.map((o) =>
    '<tr><td></td><td>' + esc(o.devName || o.fn) + '</td><td class="dev"></td>' +
    '<td><code>' + esc(o.fn) + '(' + esc(o.args) + ')</code></td></tr>').join("");

  document.getElementById("pane-chain").innerHTML =
    renderTopology(exp) +
    '<p class="sect-label">信号流（明细）</p>' +
    '<table class="chain-table"><thead><tr><th></th><th>变量</th><th>器件</th><th>平台调用</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="sect-label">观测器件</p>' +
    '<table class="chain-table"><thead><tr><th></th><th>器件</th><th></th><th>参数</th></tr></thead><tbody>' + obs + '</tbody></table>';

  try {
    const script = await readCourseText(exp.script);
    if (token !== SELECT_TOKEN) return;
    CURRENT_SCRIPT_TEXT = script;
    document.getElementById("script").textContent = script;
  } catch {
    if (token !== SELECT_TOKEN) return;
    CURRENT_SCRIPT_TEXT = "";
    document.getElementById("script").textContent = "当前课程包未提供平台脚本。导入包含 scripts/ 的课程包后可查看。";
  }

  if (token !== SELECT_TOKEN) return;
  renderDrawer();
  updatePager();
  requestAnimationFrame(() => {
    const scroll = document.getElementById("readerScroll");
    if (scroll) scroll.scrollTop = storedScroll(exp.order);
  });
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
