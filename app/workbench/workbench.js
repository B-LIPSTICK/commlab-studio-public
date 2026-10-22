const $ = (s) => document.querySelector(s);

let DEVICES = [];
let PARAMS = {};
let EXPS = [];
let nodes = [];
let edges = [];
let selected = null;
let pending = null;
let seq = 0;
let drag = null;
let connectFrom = null;
let hotPort = null;
let view = { s: 1, x: 0, y: 0 };

const WB_KEYS = {
  dockHeight: "wb-dock-height",
  dockLastHeight: "wb-dock-last-height",
  dockTab: "wb-dock-tab",
  palette: "wb-palette-collapsed",
  inspector: "wb-inspector-collapsed",
};

const wbState = {
  projectName: "未命名电路",
  saveState: "dirty",
  lastSavedPath: "",
  results: [],
  svgs: [],
  metrics: [],
  log: "",
  backend: "",
  status: "idle",
  runStartedAt: 0,
  firstImageMs: null,
  firstImagePaintMs: null,
  resultGeneration: 0,
  idleHandle: 0,
  dockHeight: 36,
  lastDockHeight: 240,
  activeTab: "results",
  running: false,
  elapsedTimer: 0,
};

function storageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage is optional */ }
}

function validDockHeight(value) {
  const n = Number(value);
  return [0, 36, 240, 400].includes(n) ? n : 36;
}

function updateProjectTitle() {
  const title = wbState.projectName || "未命名电路";
  const el = $("#projectName");
  if (el) {
    el.textContent = title;
    el.title = title;
  }
  document.title = title + " · 工作台 · CommLab Studio";
}

function setProjectName(name) {
  const clean = String(name || "").trim();
  wbState.projectName = clean || "未命名电路";
  updateProjectTitle();
}

function setSaveState(state, text) {
  wbState.saveState = state;
  const box = $("#saveState");
  const label = $("#saveText");
  if (box) box.dataset.state = state;
  if (label) label.textContent = text || (state === "saved" ? "已保存" : state === "loading" ? "保存中…" : "未保存");
}

function markDirty() {
  if (wbState.saveState === "loading") return;
  setSaveState("dirty", "未保存");
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

let toastTimer = 0;
function toast(message, ms = 2600) {
  const el = $("#toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = String(message || "");
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function setDockStatus(text, options = {}) {
  const label = $("#dockStatus");
  const dot = $("#dockStatusDot");
  const meta = $("#dockMeta");
  if (label) label.textContent = String(text == null ? "" : text);
  if (dot) dot.className = "status-dot" + (options.tone ? " " + options.tone : "");
  if (meta) meta.textContent = options.meta == null ? "" : String(options.meta);
}

function formatShortElapsed(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 10000) return (n / 1000).toFixed(1) + "s";
  return Math.round(n / 1000) + "s";
}

// 画布 DOM 复用与增量渲染状态
const SVG_NS = "http://www.w3.org/2000/svg";
let canvasEl = null;
let viewportEl = null;
let edgeLayerEl = null;
let nodeLayerEl = null;
let previewEl = null;
let sceneBuilt = false;
let nodeEls = new Map();
let edgeEls = new Map();
let nodeIndex = new Map();
let renderRaf = 0;
let canvasSizeDirty = true;
let canvasW = 0, canvasH = 0;
let canvasRect = { left: 0, top: 0, width: 0, height: 0 };
let inspectorKey = "";
let pan = null;

const W = 136, H = 50, PR = 5;

function classify(cn) {
  if (/^Sourse_|^Source_/.test(cn)) return "信号源";
  if (/^LineCode_/.test(cn)) return "线路码型";
  if (/^Modulation_|^Discriminator_/.test(cn)) return "调制与解调";
  if (/^Filter_|^SigTransfer_/.test(cn)) return "滤波与信号变换";
  if (/^SourceCoding_|^ChannalCoding_/.test(cn)) return "信源 / 信道编译码";
  if (/^ComUse_/.test(cn)) return "通用器件";
  if (/^Draw_/.test(cn)) return "观测与分析";
  if (/^Multipath_/.test(cn)) return "信道与均衡";
  if (/^BER/.test(cn)) return "观测与分析";
  return "其他";
}

// 参数兜底中文名（desc 缺失或与参数名对不上时使用）
const PARAM_FALLBACK = {
  A: ["幅度", ""], freq: ["频率", "Hz"], t: ["终止时间", "s"], phase: ["初始相位", "rad"],
  fs: ["采样频率", "Hz"], L: ["每码元采样点数", "点"], db: ["信噪比", "dB"],
  nsymbol_bit: ["信源比特长度", "bit"], Length: ["序列长度", "个"],
  datain: ["输入数据", ""], datain1: ["发送数据", ""], datain2: ["接收数据", ""],
  depth: ["相对延迟数", "采样点"], K: ["约束长度", ""], CodeGenerator: ["生成多项式", ""],
  n: ["码字长度", "bit"], k: ["信息位长度", "bit"], num: ["符号个数", "个"],
  nsamp: ["下采样因子", ""], delaytime: ["延迟时间", "采样点"], row: ["选通行号", ""],
  displayoption: ["显示模式", ""], on: ["高电平阈值", ""], off: ["低电平阈值", ""],
  high: ["高电平值", ""], low: ["低电平值", ""], fp1: ["通带左边界", "Hz"],
  fp2: ["通带右边界", "Hz"], fs1: ["阻带左边界", "Hz"], fs2: ["阻带右边界", "Hz"],
  fc: ["载波频率", "Hz"], fm: ["调制频率", "Hz"], SNR: ["信噪比", "dB"], EbN0: ["Eb/N0", "dB"],
  M: ["进制数", ""], N: ["长度", "点"], T: ["周期", "s"], Ts: ["起始时间", "s"],
  Tp: ["终止时间", "s"], Sample: ["采样点数指数", ""], sample: ["采样点数指数", ""],
  st: ["输入信号", ""], input: ["输入信号", ""], input1: ["第一路输入", ""],
  input2: ["第二路输入", ""], Signal: ["输入信号", ""], Code: ["输入编码", ""],
};

function paramMeta(name, desc, def) {
  const fb = PARAM_FALLBACK[name] || ["", ""];
  const full = String(desc || "").trim();
  const text = full.replace(/^[（(][^）)]*[）)]\s*/, "").replace(/^注[:：]\s*/, "");
  const parts = text.split(/[，。]/).map((x) => x.trim()).filter(Boolean);
  const lead = parts[0] || "";
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let label = "";
  const matched = new RegExp("^" + escName + "\\s*(表示|为|指定|是|[:：])").test(lead);
  if (matched) {
    label = lead.replace(new RegExp("^" + escName + "\\s*(表示|为|指定|是|[:：])\\s*"), "").trim();
  }
  if (!label) label = fb[0] || name;

  let unit = fb[1] || "";
  if (matched) {
    const um = text.match(/单位(?:为)?\s*([^，。]+)/);
    if (um) unit = um[1].replace(/\s+/g, "").trim();
  }

  let dv = def || "";
  if (matched && !dv) {
    const ms = [...text.matchAll(/默认值(?:为|取)?\s*([^，。]+)/g)];
    if (ms.length) dv = ms[ms.length - 1][1].replace(/^[“"]|[”"]$/g, "").trim();
  }

  let options = null;
  if (matched && /选项/.test(text)) {
    const os = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1]);
    if (os.length >= 2) options = os;
  }

  const hint = matched ? parts.slice(1)
    .filter((x) => !/^单位/.test(x) && !/^默认/.test(x))
    .join("；") : "";

  return { label, unit, def: dv, hint, full, options };
}

async function boot() {
  const theme = storageGet("wb-theme", "light");
  document.documentElement.dataset.theme = theme;
  initShell();

  DEVICES = await window.api.devices();
  PARAMS = await window.api.params();
  EXPS = (await window.api.experiments()).experiments || [];
  renderPalette(DEVICES);
  $("#search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderPalette(!q ? DEVICES : DEVICES.filter((d) =>
      (d.componentName || "").toLowerCase().includes(q) ||
      d.className.toLowerCase().includes(q)));
  });

  $("#pickerClose").addEventListener("click", closePicker);
  $("#pickerSearch").addEventListener("input", (e) => renderPicker(e.target.value.trim().toLowerCase()));
  $("#clabFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) await openClabFile(file);
  });

  document.addEventListener("keydown", onGlobalKeyDown);

  // 监听器只绑定一次，所有节点/端口/连线通过事件委托处理
  document.addEventListener("mousemove", onPointerMove);
  document.addEventListener("mouseup", onPointerUp);

  const svg = $("#canvas");
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("dblclick", onCanvasDblClick);
  svg.addEventListener("mousedown", onCanvasMouseDown);
  svg.addEventListener("click", onCanvasClick);

  if (window.ResizeObserver) {
    new ResizeObserver(() => { canvasSizeDirty = true; scheduleRender(); }).observe(svg);
  }
  window.addEventListener("resize", () => { canvasSizeDirty = true; scheduleRender(); });

  render();

  updateProjectTitle();
  setDockStatus("就绪");
  updateCounts();

  const autoExp = new URLSearchParams(location.search).get("exp");
  if (autoExp) {
    try {
      const e = EXPS.find((x) => x.order === Number(autoExp));
      if (e) loadExperiment(e);
      else {
        setDockStatus("未找到实验 " + autoExp + "（共 " + EXPS.length + "）", { tone: "error" });
        toast("未找到实验 " + autoExp);
      }
    } catch (err) {
      setDockStatus("载入失败：" + err.message, { tone: "error" });
      toast("载入失败：" + err.message);
    }
  }
}

function renderPalette(list) {
  const groups = new Map();
  for (const d of list) {
    const g = classify(d.className);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  const box = $("#paletteList");
  box.innerHTML = "";
  const GROUP_ORDER = ["信号源", "线路码型", "调制与解调", "滤波与信号变换", "信源 / 信道编译码", "信道与均衡", "观测与分析", "通用器件", "其他"];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const g of keys) {
    const arr = groups.get(g);
    const h = document.createElement("div");
    h.className = "pgroup";
    h.textContent = g + " · " + arr.length;
    box.appendChild(h);
    for (const d of arr) {
      const it = document.createElement("div");
      it.className = "pitem";
      it.innerHTML = deviceIcon(d.className) + '<span class="pt"></span><span class="pn"></span>';
      it.querySelector(".pt").textContent = d.componentName || d.className;
      it.querySelector(".pn").textContent = d.inputs + "→" + d.outputs;
      it.addEventListener("click", () => addNode(d));
      box.appendChild(it);
    }
  }
}

function addNode(dev) {
  seq += 1;
  const n = {
    id: "n" + seq,
    dev,
    x: 120 + (nodes.length % 5) * 40,
    y: 100 + (nodes.length % 6) * 70,
    inputs: dev.inputs || 0,
    outputs: dev.outputs || 0,
  };
  nodes.push(n);
  selected = n.id;
  markDirty();
  render();
}

function portPos(n, side, i) {
  const total = side === "in" ? n.inputs : n.outputs;
  const gap = H / (total + 1);
  return { x: side === "in" ? n.x : n.x + W, y: n.y + gap * (i + 1) };
}

function fitView() {
  if (!nodes.length) return;
  const rect = $("#canvas").getBoundingClientRect();
  const cw = rect.width || 1200;
  const ch = rect.height || 800;
  const pad = 70;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + W);
    maxY = Math.max(maxY, n.y + H);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const s = Math.min(1.2, Math.max(0.22, Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh)));
  view.s = s;
  view.x = cw / 2 - ((minX + maxX) / 2) * s;
  view.y = ch / 2 - ((minY + maxY) / 2) * s;
}

// ---- 正交走线：优先 H-V-H，列间/行间空隙作为通道 ----
const WIRE_STUB = 16, WIRE_R = 4;
const WIRE_CLEAR = 8, WIRE_LANE = 6, WIRE_BEND = 110, WIRE_CORRIDOR = 20;

let wirePlan = new Map();
let wirePlanKey = "";

function fmt(v) { return Math.round(v * 10) / 10; }

function simplify(pts) {
  let out = pts.filter((p, i) => i === 0 ||
    Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
          (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) {
        out.splice(i, 1); changed = true; break;
      }
    }
  }
  return out;
}

function roundedD(pts) {
  if (pts.length < 2) return "";
  let d = "M" + fmt(pts[0].x) + " " + fmt(pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (!l1 || !l2) { d += " L" + fmt(b.x) + " " + fmt(b.y); continue; }
    const rr = Math.min(WIRE_R, l1 / 2, l2 / 2);
    const ax = b.x - (v1x / l1) * rr, ay = b.y - (v1y / l1) * rr;
    const cx = b.x + (v2x / l2) * rr, cy = b.y + (v2y / l2) * rr;
    d += " L" + fmt(ax) + " " + fmt(ay) + " Q" + fmt(b.x) + " " + fmt(b.y) + " " + fmt(cx) + " " + fmt(cy);
  }
  const last = pts[pts.length - 1];
  return d + " L" + fmt(last.x) + " " + fmt(last.y);
}

function pointInsideRect(p, r) {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

function nodeRect(n, pad) {
  return { x: n.x - pad, y: n.y - pad, w: W + pad * 2, h: H + pad * 2 };
}

function pointsLen(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  }
  return total;
}

function routeBends(pts) {
  return Math.max(0, pts.length - 2);
}

function segmentClear(a, b, ignore, obstacles) {
  if (Math.abs(a.y - b.y) < 0.01) {
    const y = a.y, x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    for (const o of obstacles) {
      if (ignore.has(o.id)) continue;
      const r = o.pad;
      if (y > r.y && y < r.y + r.h && x2 > r.x && x1 < r.x + r.w) return false;
    }
    return true;
  }
  if (Math.abs(a.x - b.x) < 0.01) {
    const x = a.x, y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    for (const o of obstacles) {
      if (ignore.has(o.id)) continue;
      const r = o.pad;
      if (x > r.x && x < r.x + r.w && y2 > r.y && y1 < r.y + r.h) return false;
    }
    return true;
  }
  return false;
}

function pathClear(pts, ignore, obstacles) {
  for (let i = 1; i < pts.length; i++) {
    if (!segmentClear(pts[i - 1], pts[i], ignore, obstacles)) return false;
  }
  return true;
}

function buildRouteContext() {
  const cols = [...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b);
  const rows = [...new Set(nodes.map((n) => n.y))].sort((a, b) => a - b);
  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x + W));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxY = Math.max(...nodes.map((n) => n.y + H));
  const colChannels = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const x1 = cols[i] + W + WIRE_CLEAR;
    const x2 = cols[i + 1] - WIRE_CLEAR;
    if (x2 - x1 >= 0) {
      colChannels.push({ key: "col" + i, kind: "col", i, x1, x2, center: (x1 + x2) / 2 });
    }
  }
  colChannels.push({
    key: "outer-left", kind: "outer-left", i: -1,
    x1: minX - WIRE_CLEAR - 40, x2: minX - WIRE_CLEAR, center: minX - WIRE_CLEAR - 20,
  });
  colChannels.push({
    key: "outer-right", kind: "outer-right", i: 99,
    x1: maxX + WIRE_CLEAR, x2: maxX + WIRE_CLEAR + 40, center: maxX + WIRE_CLEAR + 20,
  });

  const rowChannels = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const y1 = rows[i] + H + WIRE_CLEAR;
    const y2 = rows[i + 1] - WIRE_CLEAR;
    if (y2 - y1 >= 0) {
      rowChannels.push({ key: "row" + i, kind: "row", i, y1, y2, center: (y1 + y2) / 2 });
    }
  }
  rowChannels.push({
    key: "outer-top", kind: "outer-top", i: -1,
    y1: minY - WIRE_CLEAR - 40, y2: minY - WIRE_CLEAR, center: minY - WIRE_CLEAR - 20,
  });
  rowChannels.push({
    key: "outer-bottom", kind: "outer-bottom", i: 99,
    y1: maxY + WIRE_CLEAR, y2: maxY + WIRE_CLEAR + 40, center: maxY + WIRE_CLEAR + 20,
  });
  const rowTraffic = new Map(rowChannels.map((c) => [c.key, 0]));
  for (const e of edges) {
    const a = nodeIndex.get(e.from), b = nodeIndex.get(e.to);
    if (!a || !b) continue;
    const p1 = portPos(a, "out", e.fromPort), p2 = portPos(b, "in", e.toPort);
    const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
    for (const c of rowChannels) {
      if (c.center > lo && c.center < hi) rowTraffic.set(c.key, rowTraffic.get(c.key) + 1);
    }
  }
  return { colChannels, rowChannels, rowTraffic, minX, maxX, minY, maxY };
}

function routePoints(meta, p1, p2) {
  if (meta.type === "straight") return [p1, p2];
  if (meta.type === "3") {
    const x = meta.lanes[0];
    return [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
  }
  const x1 = meta.lanes[0], x2 = meta.lanes[1], yc = meta.row.center;
  return [p1, { x: x1, y: p1.y }, { x: x1, y: yc }, { x: x2, y: yc }, { x: x2, y: p2.y }, p2];
}

function addRouteCandidate(cands, meta, p1, p2, ignore, obstacles) {
  const pts = simplify(routePoints(meta, p1, p2));
  if (!pathClear(pts, ignore, obstacles)) return;
  const length = pointsLen(pts);
  const bends = routeBends(pts);
  cands.push({ meta, basePts: pts, length, bends, cost: length + bends * WIRE_BEND + (meta.penalty || 0) });
}

function makeRouteIgnore(a, b, p1, p2, obstacles) {
  const ignore = new Set([a.id, b.id]);
  const overlap = [];
  for (const o of obstacles) {
    if (ignore.has(o.id)) continue;
    if (pointInsideRect(p1, o.pad) || pointInsideRect(p2, o.pad)) {
      ignore.add(o.id);
      overlap.push(o.id);
    }
  }
  return { ignore, overlap };
}

function routeEdgePlan(e, idx, ctx, obstacles) {
  const a = nodeIndex.get(e.from), b = nodeIndex.get(e.to);
  if (!a || !b) return null;
  const p1 = portPos(a, "out", e.fromPort);
  const p2 = portPos(b, "in", e.toPort);
  const { ignore, overlap } = makeRouteIgnore(a, b, p1, p2, obstacles);
  const reverse = p2.x < p1.x - 0.5;
  const cands = [];

  if (Math.abs(p1.y - p2.y) < 0.01) {
    addRouteCandidate(cands, { type: "straight", lanes: [], vsegs: [] }, p1, p2, ignore, obstacles);
  }

  if (!reverse) {
    const between = ctx.colChannels.filter((c) =>
      c.kind === "col" && c.center > p1.x + WIRE_STUB && c.center < p2.x - WIRE_STUB);
    for (const c of between) {
      addRouteCandidate(cands, {
        type: "3", ch: [c], lanes: [c.center],
        vsegs: [{ ch: c, enterY: p1.y, exitY: p2.y, y1: p1.y, y2: p2.y }],
      }, p1, p2, ignore, obstacles);
    }

    const pool = between.length ? between : ctx.colChannels.filter((c) => c.kind === "col");
    const nearSrc = pool.slice().sort((u, v) =>
      Math.abs(u.center - (p1.x + 120)) - Math.abs(v.center - (p1.x + 120))).slice(0, 6);
    const nearDst = pool.slice().sort((u, v) =>
      Math.abs(u.center - (p2.x - 120)) - Math.abs(v.center - (p2.x - 120))).slice(0, 6);
    for (const x1c of nearSrc) {
      for (const x2c of nearDst) {
        for (const yc of ctx.rowChannels) {
          addRouteCandidate(cands, {
            type: "5", ch: [x1c, x2c], lanes: [x1c.center, x2c.center], row: yc,
            penalty: (ctx.rowTraffic.get(yc.key) || 0) * WIRE_CORRIDOR,
            vsegs: [
              { ch: x1c, enterY: p1.y, exitY: yc.center, y1: p1.y, y2: yc.center },
              { ch: x2c, enterY: yc.center, exitY: p2.y, y1: p2.y, y2: yc.center },
            ],
          }, p1, p2, ignore, obstacles);
        }
      }
    }
  } else {
    const rightCh = ctx.colChannels.filter((c) =>
      c.kind === "outer-right" || (c.kind === "col" && c.center > p1.x + WIRE_STUB))
      .sort((u, v) => u.center - v.center).slice(0, 4);
    const leftCh = ctx.colChannels.filter((c) =>
      c.kind === "outer-left" || (c.kind === "col" && c.center < p2.x - WIRE_STUB))
      .sort((u, v) => v.center - u.center).slice(0, 6);
    const ycands = ctx.rowChannels.filter((c) =>
      c.kind === "outer-top" || c.kind === "outer-bottom" ||
      c.center < Math.min(p1.y, p2.y) - H / 2 || c.center > Math.max(p1.y, p2.y) + H / 2);
    for (const x1c of rightCh) {
      for (const x2c of leftCh) {
        for (const yc of ycands) {
          addRouteCandidate(cands, {
            type: "rev", ch: [x1c, x2c], lanes: [x1c.center, x2c.center], row: yc,
            penalty: (ctx.rowTraffic.get(yc.key) || 0) * WIRE_CORRIDOR,
            vsegs: [
              { ch: x1c, enterY: p1.y, exitY: yc.center, y1: p1.y, y2: yc.center },
              { ch: x2c, enterY: yc.center, exitY: p2.y, y1: p2.y, y2: yc.center },
            ],
          }, p1, p2, ignore, obstacles);
        }
      }
    }
  }

  if (!cands.length) {
    const meta = reverse
      ? {
          type: "rev",
          ch: [ctx.colChannels.find((c) => c.kind === "outer-right"), ctx.colChannels.find((c) => c.kind === "outer-left")],
          lanes: [ctx.maxX + WIRE_CLEAR + 20, ctx.minX - WIRE_CLEAR - 20],
          row: ctx.rowChannels.find((c) => c.kind === "outer-bottom") || ctx.rowChannels[0],
          vsegs: [],
        }
      : { type: "3", ch: [], lanes: [(p1.x + p2.x) / 2], vsegs: [] };
    const pts = simplify(routePoints(meta, p1, p2));
    return {
      idx, e, p1, p2, ignore, overlap, forced: true,
      cand: { meta, basePts: pts, length: pointsLen(pts), bends: routeBends(pts), cost: Infinity },
    };
  }

  cands.sort((u, v) => u.cost - v.cost);
  return { idx, e, p1, p2, ignore, overlap, forced: false, cand: cands[0] };
}

function assignRouteLanes(routes) {
  const groups = new Map();
  for (const r of routes) {
    if (!r || !r.cand || !r.cand.meta.vsegs) continue;
    for (let j = 0; j < r.cand.meta.vsegs.length; j++) {
      const vs = r.cand.meta.vsegs[j];
      if (!vs.ch || vs.ch.kind !== "col") continue;
      const key = vs.ch.key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        r, j, ch: vs.ch,
        enterY: vs.enterY != null ? vs.enterY : vs.y1,
        exitY: vs.exitY != null ? vs.exitY : vs.y2,
        y1: Math.min(vs.y1, vs.y2), y2: Math.max(vs.y1, vs.y2),
        mid: (vs.y1 + vs.y2) / 2,
      });
    }
  }

  for (const list of groups.values()) {
    const c = list[0].ch;
    const n = list.length;
    const width = Math.max(0, c.x2 - c.x1);
    const step = n <= 1 ? 0 : Math.min(WIRE_LANE, width / (n - 1));
    const laneX = (i) => {
      let x = c.center + (i - (n - 1) / 2) * step;
      if (x < c.x1) x = c.x1;
      if (x > c.x2) x = c.x2;
      return x;
    };
    const costOf = (order) => {
      let cross = 0;
      let span = 0;
      for (let i = 0; i < order.length; i++) {
        const u = order[i], xu = laneX(i);
        span += Math.abs(xu - c.x1) + Math.abs(xu - c.x2);
        for (let j = 0; j < order.length; j++) {
          if (i === j) continue;
          const v = order[j], xv = laneX(j);
          if (xv < xu - 0.01 && u.enterY > v.y1 + 0.01 && u.enterY < v.y2 - 0.01) cross++;
          if (xv > xu + 0.01 && u.exitY > v.y1 + 0.01 && u.exitY < v.y2 - 0.01) cross++;
        }
      }
      return cross * 1000 + span * 0.001;
    };
    const candidates = [
      list.slice().sort((a, b) => a.enterY - b.enterY || a.exitY - b.exitY),
      list.slice().sort((a, b) => b.enterY - a.enterY || b.exitY - a.exitY),
      list.slice().sort((a, b) => a.exitY - b.exitY || a.enterY - b.enterY),
      list.slice().sort((a, b) => b.exitY - a.exitY || b.enterY - a.enterY),
      list.slice().sort((a, b) => a.mid - b.mid || a.r.idx - b.r.idx),
      list.slice().sort((a, b) => b.mid - a.mid || a.r.idx - b.r.idx),
    ];
    let best = candidates[0], bestCost = costOf(best);
    for (let i = 1; i < candidates.length; i++) {
      const cost = costOf(candidates[i]);
      if (cost < bestCost) { best = candidates[i]; bestCost = cost; }
    }
    for (let i = 0; i < best.length; i++) {
      best[i].r.cand.meta.lanes[best[i].j] = laneX(i);
    }
  }
}

function segmentBoundaryExit(inside, outside, r) {
  if (Math.abs(inside.y - outside.y) < 0.01) {
    if (inside.y <= r.y || inside.y >= r.y + r.h) return null;
    const x = outside.x > inside.x ? r.x + r.w : r.x;
    if ((outside.x > inside.x && x >= inside.x) || (outside.x < inside.x && x <= inside.x)) {
      return { x, y: inside.y };
    }
    return null;
  }
  if (Math.abs(inside.x - outside.x) < 0.01) {
    if (inside.x <= r.x || inside.x >= r.x + r.w) return null;
    const y = outside.y > inside.y ? r.y + r.h : r.y;
    if ((outside.y > inside.y && y >= inside.y) || (outside.y < inside.y && y <= inside.y)) {
      return { x: inside.x, y };
    }
  }
  return null;
}

function clipStartToCover(pts, cover) {
  let k = 0;
  while (k < pts.length && pointInsideRect(pts[k], cover.body)) k++;
  if (k >= pts.length) return null;
  if (k === 0) return pts;
  const exit = segmentBoundaryExit(pts[k - 1], pts[k], cover.body);
  if (!exit) return pts;
  return simplify([exit, ...pts.slice(k)]);
}

function clipEndToCover(pts, cover) {
  let k = pts.length - 1;
  while (k >= 0 && pointInsideRect(pts[k], cover.body)) k--;
  if (k < 0) return null;
  if (k === pts.length - 1) return pts;
  const exit = segmentBoundaryExit(pts[k + 1], pts[k], cover.body);
  if (!exit) return pts;
  return simplify([...pts.slice(0, k + 1), exit]);
}

// 端口被别的器件压住时，裁掉节点下面的隐藏段；视觉不变，路径也不再穿本体。
function trimHiddenEndpoints(pts, obstacles, ownIds) {
  let out = pts;
  for (let guard = 0; guard < 4; guard++) {
    let cover = null;
    for (const o of obstacles) {
      if (ownIds.has(o.id)) continue;
      if (pointInsideRect(out[0], o.body)) { cover = o; break; }
    }
    if (!cover) break;
    const next = clipStartToCover(out, cover);
    if (!next) break;
    out = next;
  }
  for (let guard = 0; guard < 4; guard++) {
    let cover = null;
    const last = out[out.length - 1];
    for (const o of obstacles) {
      if (ownIds.has(o.id)) continue;
      if (pointInsideRect(last, o.body)) { cover = o; break; }
    }
    if (!cover) break;
    const next = clipEndToCover(out, cover);
    if (!next) break;
    out = next;
  }
  return out;
}

function buildWirePlan() {
  const ctx = buildRouteContext();
  const obstacles = nodes.map((n, i) => ({
    id: n.id, index: i, body: { x: n.x, y: n.y, w: W, h: H }, pad: nodeRect(n, WIRE_CLEAR),
  }));
  const routes = edges.map((e, i) => routeEdgePlan(e, i, ctx, obstacles));
  assignRouteLanes(routes);
  const plan = new Map();
  for (const r of routes) {
    if (!r || !r.cand) continue;
    const ownIds = new Set([r.e.from, r.e.to]);
    let pts = simplify(routePoints(r.cand.meta, r.p1, r.p2));
    pts = trimHiddenEndpoints(pts, obstacles, ownIds);
    if (pts.length < 2) pts = r.cand.basePts;
    if (!pathClear(pts, r.ignore, obstacles)) {
      if (r.cand.meta.vsegs) {
        for (let j = 0; j < r.cand.meta.vsegs.length; j++) {
          const ch = r.cand.meta.vsegs[j].ch;
          if (ch) r.cand.meta.lanes[j] = ch.center;
        }
      }
      pts = simplify(routePoints(r.cand.meta, r.p1, r.p2));
      pts = trimHiddenEndpoints(pts, obstacles, ownIds);
      if (!pathClear(pts, r.ignore, obstacles)) pts = r.cand.basePts;
    }
    plan.set(edgeKey(r.e), {
      d: roundedD(pts), box: pointsBox(pts), pts,
      bends: routeBends(pts), length: pointsLen(pts),
      type: r.cand.meta.type, forced: r.forced, overlap: r.overlap,
    });
  }
  return plan;
}

function wireSignature() {
  let s = "";
  for (const n of nodes) s += n.id + "," + n.x + "," + n.y + "," + n.inputs + "," + n.outputs + ";";
  s += "|";
  for (const e of edges) s += edgeKey(e) + ";";
  return s;
}

function pointsBox(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}

function edgeKey(e) {
  return e.from + "|" + e.fromPort + "|" + e.to + "|" + e.toPort;
}

function setSvgAttr(el, name, value) {
  const s = String(value);
  if (el.getAttribute(name) !== s) el.setAttribute(name, s);
}

function makeSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function ensureCanvasMetrics() {
  if (!canvasEl) canvasEl = $("#canvas");
  if (!canvasEl || !canvasSizeDirty) return;
  const r = canvasEl.getBoundingClientRect();
  canvasRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  canvasW = Math.max(600, r.width);
  canvasH = Math.max(400, r.height);
  setSvgAttr(canvasEl, "viewBox", "0 0 " + canvasW + " " + canvasH);
  canvasSizeDirty = false;
}

function buildScene() {
  canvasEl = $("#canvas");
  if (!canvasEl) return;
  canvasEl.innerHTML = "";
  viewportEl = makeSvg("g", { class: "viewport" });
  edgeLayerEl = makeSvg("g", { class: "wire-layer" });
  nodeLayerEl = makeSvg("g", { class: "node-layer" });
  previewEl = makeSvg("path", { id: "preview", class: "wire preview" });
  previewEl.style.display = "none";
  viewportEl.appendChild(edgeLayerEl);
  viewportEl.appendChild(nodeLayerEl);
  viewportEl.appendChild(previewEl);
  canvasEl.appendChild(viewportEl);
  sceneBuilt = true;
}

function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = 0;
    renderNow();
  });
}

function render() {
  if (renderRaf) {
    cancelAnimationFrame(renderRaf);
    renderRaf = 0;
  }
  renderNow();
}

function renderNow() {
  if (!canvasEl) canvasEl = $("#canvas");
  if (!canvasEl) return;
  if (!sceneBuilt) buildScene();
  ensureCanvasMetrics();
  setSvgAttr(viewportEl, "transform",
    "translate(" + view.x + "," + view.y + ") scale(" + view.s + ")");
  ensureNodeIndex();
  syncNodes();
  syncEdges();
  syncPreview();
  syncInspector(false);
  const hint = $("#hint");
  if (hint) hint.classList.toggle("hide", nodes.length > 0);
  const stageStatus = $("#stageStatus");
  if (stageStatus) stageStatus.textContent = nodes.length + " 器件 · " + edges.length + " 连线";
}

function ensureNodeIndex() {
  let same = nodeIndex.size === nodes.length;
  if (same) {
    for (const n of nodes) {
      if (nodeIndex.get(n.id) !== n) { same = false; break; }
    }
  }
  if (!same) nodeIndex = new Map(nodes.map((n) => [n.id, n]));
}

function clearHotPort() {
  if (!hotPort) return;
  hotPort.classList.remove("hot");
  hotPort = null;
}

function createNodeElement(n) {
  const g = makeSvg("g", { class: "node", "data-node": n.id });
  const rect = makeSvg("rect", { class: "node-body", x: 0, y: 0, width: W, height: H, rx: 6 });
  const icon = makeSvg("g", { transform: "translate(10," + (H / 2 - 9) + ")" });
  icon.innerHTML = deviceIcon(n.dev.className, "node-icon");
  const label = makeSvg("text", { class: "node-label", x: 34, y: H / 2 - 2 });
  const sub = makeSvg("text", { class: "node-sub", x: 34, y: H / 2 + 12 });
  g.appendChild(rect);
  g.appendChild(icon);
  g.appendChild(label);
  g.appendChild(sub);

  const inPorts = [];
  const outPorts = [];
  for (let i = 0; i < n.inputs; i++) {
    const y = H / (n.inputs + 1) * (i + 1);
    const p = makeSvg("circle", { class: "port in", "data-port": "in|" + n.id + "|" + i, cx: 0, cy: y, r: PR });
    const hit = makeSvg("circle", { class: "port-hit", "data-port": "in|" + n.id + "|" + i, cx: 0, cy: y, r: 13 });
    g.appendChild(p);
    g.appendChild(hit);
    inPorts.push(p);
  }
  for (let i = 0; i < n.outputs; i++) {
    const y = H / (n.outputs + 1) * (i + 1);
    const p = makeSvg("circle", { class: "port out", "data-port": "out|" + n.id + "|" + i, cx: W, cy: y, r: PR });
    const hit = makeSvg("circle", { class: "port-hit", "data-port": "out|" + n.id + "|" + i, cx: W, cy: y, r: 13 });
    g.appendChild(p);
    g.appendChild(hit);
    outPorts.push(p);
  }

  const el = {
    g, rect, icon, label, sub, inPorts, outPorts,
    inputs: n.inputs, outputs: n.outputs, devClass: n.dev.className,
    labelText: "", subText: "", cls: "", outClasses: new Array(n.outputs).fill(""),
  };
  updateNodeElement(el, n);
  return el;
}

function updateNodeElement(el, n) {
  setSvgAttr(el.g, "transform", "translate(" + n.x + "," + n.y + ")");
  const cls = "node" + (n.id === selected ? " sel" : "");
  if (el.cls !== cls) {
    setSvgAttr(el.g, "class", cls);
    el.cls = cls;
  }

  const label = n.dev.componentName || n.dev.className;
  const short = label.length > 11 ? label.slice(0, 10) + "…" : label;
  if (el.labelText !== short) {
    el.label.textContent = short;
    el.labelText = short;
  }
  const sub = n.dev.className.replace(/_Comm$/, "");
  const subText = sub.length > 17 ? sub.slice(0, 16) + "…" : sub;
  if (el.subText !== subText) {
    el.sub.textContent = subText;
    el.subText = subText;
  }

  for (let i = 0; i < el.outPorts.length; i++) {
    const pend = pending && pending.nodeId === n.id && pending.port === i ? " pending" : "";
    const pcls = "port out" + pend;
    if (el.outClasses[i] !== pcls) {
      setSvgAttr(el.outPorts[i], "class", pcls);
      el.outClasses[i] = pcls;
    }
  }
}

function syncNodes() {
  const alive = new Set();
  for (const n of nodes) {
    alive.add(n.id);
    let el = nodeEls.get(n.id);
    if (el && (el.inputs !== n.inputs || el.outputs !== n.outputs || el.devClass !== n.dev.className)) {
      el.g.remove();
      nodeEls.delete(n.id);
      el = null;
    }
    if (!el) {
      el = createNodeElement(n);
      nodeEls.set(n.id, el);
      nodeLayerEl.appendChild(el.g);
    } else {
      updateNodeElement(el, n);
    }
  }
  for (const [id, el] of nodeEls) {
    if (!alive.has(id)) {
      el.g.remove();
      nodeEls.delete(id);
    }
  }
}

function syncEdges() {
  const alive = new Set();
  const sig = wireSignature();
  if (sig !== wirePlanKey) {
    wirePlan = buildWirePlan();
    wirePlanKey = sig;
  }
  for (const e of edges) {
    const a = nodeIndex.get(e.from);
    const b = nodeIndex.get(e.to);
    if (!a || !b) continue;
    const key = edgeKey(e);
    alive.add(key);

    let el = edgeEls.get(key);
    if (!el) {
      const hit = makeSvg("path", { class: "wire-hit", "data-edge": key });
      const wire = makeSvg("path", { class: "wire" });
      edgeLayerEl.appendChild(hit);
      edgeLayerEl.appendChild(wire);
      el = { hit, wire, d: "" };
      edgeEls.set(key, el);
    }

    const path = wirePlan.get(key);
    if (path && el.d !== path.d) {
      setSvgAttr(el.hit, "d", path.d);
      setSvgAttr(el.wire, "d", path.d);
      el.d = path.d;
    }
  }
  for (const [key, el] of edgeEls) {
    if (!alive.has(key)) {
      el.hit.remove();
      el.wire.remove();
      edgeEls.delete(key);
    }
  }
}

function syncPreview() {
  if (!previewEl) return;
  if (connectFrom) {
    previewEl.style.display = "";
  } else {
    previewEl.style.display = "none";
    if (previewEl.getAttribute("d")) previewEl.setAttribute("d", "");
    clearHotPort();
  }
}

function inspectorKeyFor(n) {
  return n
    ? n.id + "|" + n.dev.className + "|" + n.inputs + "|" + n.outputs + "|" + JSON.stringify(n.values || [])
    : "none";
}

function syncInspector(force) {
  const n = nodeIndex.get(selected);
  const key = inspectorKeyFor(n);
  if (!force && key === inspectorKey) return;
  renderInspector(n);
}

function invalidateWiresForNode() {
  wirePlanKey = "";
}


function connect(from, toId, toPort) {
  if (!from || from.nodeId === toId) return;
  edges = edges.filter((e) => !(e.to === toId && e.toPort === toPort));
  edges.push({ from: from.nodeId, fromPort: from.port, to: toId, toPort });
  markDirty();
}

// 松开鼠标时找输入口：先精确命中，再在 26px 内吸附最近输入口
function portTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const hit = el && el.closest ? el.closest("[data-port]") : null;
  if (hit) {
    const p = hit.dataset.port.split("|");
    if (p[0] === "in") return { id: p[1], port: Number(p[2]) };
    if (p[0] === "out" && connectFrom && p[1] === connectFrom.nodeId && Number(p[2]) === connectFrom.port) {
      return { same: true };
    }
  }
  ensureCanvasMetrics();
  const r = canvasRect;
  let best = null, bestD = 26;
  for (const n of nodes) {
    for (let i = 0; i < n.inputs; i++) {
      const pp = portPos(n, "in", i);
      const x = r.left + view.x + pp.x * view.s;
      const y = r.top + view.y + pp.y * view.s;
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < bestD) { bestD = d; best = { id: n.id, port: i }; }
    }
  }
  return best;
}

function onCanvasMouseDown(ev) {
  if (ev.button === 1 || (ev.button === 0 && ev.altKey)) {
    ev.preventDefault();
    ensureCanvasMetrics();
    pan = { sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y };
    return;
  }
  const target = ev.target;
  const portEl = target && target.closest ? target.closest("[data-port]") : null;
  if (portEl) {
    handlePortMouseDown(ev, portEl);
    return;
  }
  const nodeEl = target && target.closest ? target.closest("[data-node]") : null;
  if (!nodeEl) return;
  const id = nodeEl.dataset.node;
  const n = nodeIndex.get(id);
  if (!n) return;
  const pt = svgPoint(ev);
  drag = { id, dx: pt.x - n.x, dy: pt.y - n.y };
  selected = id;
  render();
}

function handlePortMouseDown(ev, c) {
  const parts = c.dataset.port.split("|");
  const side = parts[0], id = parts[1], i = Number(parts[2]);
  if (side === "out") {
    connectFrom = { nodeId: id, port: i };
    pending = null;
    render();
  } else if (connectFrom) {
    connect(connectFrom, id, i);
    connectFrom = null;
    render();
  } else if (pending) {
    connect(pending, id, i);
    pending = null;
    render();
  }
}

function onCanvasClick(ev) {
  const p = ev.target && ev.target.closest ? ev.target.closest("[data-edge]") : null;
  if (!p) return;
  const parts = p.dataset.edge.split("|");
  edges = edges.filter((e) => !(e.from === parts[0] && e.fromPort === Number(parts[1]) && e.to === parts[2] && e.toPort === Number(parts[3])));
  markDirty();
  render();
}

function onWheel(e) {
  e.preventDefault();
  ensureCanvasMetrics();
  const mx = e.clientX - canvasRect.left, my = e.clientY - canvasRect.top;
  const next = Math.min(2.4, Math.max(0.35, view.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  view.x = mx - (mx - view.x) * (next / view.s);
  view.y = my - (my - view.y) * (next / view.s);
  view.s = next;
  scheduleRender();
}

function onCanvasDblClick(e) {
  if (e.target === canvasEl) {
    view = { s: 1, x: 0, y: 0 };
    render();
  }
}

function onPointerMove(ev) {
  if (pan) {
    view.x = pan.ox + (ev.clientX - pan.sx);
    view.y = pan.oy + (ev.clientY - pan.sy);
    scheduleRender();
    return;
  }
  if (connectFrom) {
    if (previewEl) {
      const n = nodeIndex.get(connectFrom.nodeId);
      if (!n) return;
      const a = portPos(n, "out", connectFrom.port);
      const b = svgPoint(ev);
      previewEl.setAttribute("d", "M" + a.x + " " + a.y + " C" + (a.x + 40) + " " + a.y + " " + (b.x - 40) + " " + b.y + " " + b.x + " " + b.y);
    }
    const hit = portTargetAt(ev.clientX, ev.clientY);
    const target = hit && hit.id
      ? document.querySelector('.port[data-port="in|' + hit.id + "|" + hit.port + '"]')
      : null;
    if (target !== hotPort) {
      if (hotPort) hotPort.classList.remove("hot");
      hotPort = target;
      if (hotPort) hotPort.classList.add("hot");
    }
    return;
  }
  if (!drag) return;
  const pt = svgPoint(ev);
  const n = nodeIndex.get(drag.id);
  if (!n) return;
  const nx = Math.max(0, pt.x - drag.dx);
  const ny = Math.max(0, pt.y - drag.dy);
  if (nx === n.x && ny === n.y) return;
  const oldX = n.x, oldY = n.y;
  n.x = nx;
  n.y = ny;
  drag.moved = true;
  invalidateWiresForNode(n, oldX, oldY);
  scheduleRender();
}

function onPointerUp(ev) {
  const hadPan = !!pan;
  const hadDrag = !!drag;
  const dragMoved = !!(drag && drag.moved);
  pan = null;
  drag = null;
  if (connectFrom) {
    const hit = portTargetAt(ev.clientX, ev.clientY);
    if (hit && hit.same) { clearHotPort(); render(); return; }
    if (hit) { connect(connectFrom, hit.id, hit.port); connectFrom = null; clearHotPort(); render(); return; }
    connectFrom = null;
    clearHotPort();
    render();
    return;
  }
  if (dragMoved) markDirty();
  if (hadPan || hadDrag) render();
}

function svgPoint(ev) {
  ensureCanvasMetrics();
  const r = canvasRect;
  return {
    x: (ev.clientX - r.left - view.x) / view.s,
    y: (ev.clientY - r.top - view.y) / view.s,
  };
}

function renderInspector(n) {
  const box = $("#inspectorBody");
  if (!box) return;
  if (!n) {
    box.innerHTML = '<p class="muted">未选中器件</p>';
    inspectorKey = "none";
    return;
  }
  const rows = [
    ["名称", n.dev.componentName || "-"],
    ...(n.label ? [["工程标签", n.label]] : []),
    ["类名", n.dev.className],
    ["输入口", String(n.inputs)],
    ["输出口", String(n.outputs)],
    ["分类", classify(n.dev.className)],
  ].map((kv) => '<div class="row"><span class="k">' + kv[0] + '</span><span class="v">' + esc(kv[1]) + "</span></div>").join("");
  const pdef = PARAMS[n.dev.className] || { params: [], desc: {}, defaults: {} };
  const extra = (pdef.params || []).slice(n.inputs);
  let form = "";
  if (extra.length) {
    const fields = extra.map((name, j) => {
      const def = (pdef.defaults || {})[name] || "";
      const val = (n.values && n.values[j] != null) ? n.values[j] : def;
      const meta = paramMeta(name, (pdef.desc || {})[name], def);
      const dv = meta.def || def || "";
      const same = String(val) === String(dv);
      const bits = [];
      if (meta.hint) bits.push(meta.hint);
      if (dv) bits.push("默认 " + dv);
      const control = meta.options
        ? '<select class="pinput" data-j="' + j + '" title="' + esc(meta.full) + '">' +
            meta.options.map((o) => '<option' + (String(o) === String(val) ? " selected" : "") + ">" + esc(o) + "</option>").join("") +
          "</select>"
        : '<input class="pinput" data-j="' + j + '" value="' + esc(val) + '" placeholder="' + esc(dv) + '" title="' + esc(meta.full) + '"/>';
      return '<div class="pfield" data-j="' + j + '">' +
        '<div class="phead"><span class="plabel">' + esc(meta.label || name) + "</span>" +
        '<span class="pname">' + esc(name) + "</span></div>" +
        '<div class="prow">' + control +
        (meta.unit ? '<span class="punit">' + esc(meta.unit) + "</span>" : "") +
        '<button class="preset" data-reset="' + j + '" title="恢复默认值' + (dv ? " " + esc(dv) : "") + '"' + (same ? " disabled" : "") + ">↺</button>" +
        "</div>" +
        (bits.length ? '<div class="phint">' + esc(bits.join(" · ")) + "</div>" : "") +
        "</div>";
    }).join("");
    form = '<div class="pgroup-head"><span>参数</span><span class="pcount">' + extra.length + "</span>" +
      '<button class="plink" id="btnResetAll">恢复默认</button></div>' + fields;
  }
  box.innerHTML = rows + form + '<button class="btn" id="btnDel" style="margin-top:14px;width:100%">删除器件</button>';
  box.querySelectorAll(".pinput").forEach((inp) => {
    const onEdit = () => {
      if (!n.values) n.values = [];
      n.values[Number(inp.dataset.j)] = inp.value;
      const j = Number(inp.dataset.j);
      const meta = paramMeta(extra[j], (pdef.desc || {})[extra[j]], (pdef.defaults || {})[extra[j]] || "");
      const btn = box.querySelector('.preset[data-reset="' + j + '"]');
      if (btn) btn.disabled = inp.value === (meta.def || "");
      inspectorKey = inspectorKeyFor(n);
      markDirty();
    };
    inp.addEventListener("input", onEdit);
    inp.addEventListener("change", onEdit);
  });
  box.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const j = Number(btn.dataset.reset);
      const meta = paramMeta(extra[j], (pdef.desc || {})[extra[j]], (pdef.defaults || {})[extra[j]] || "");
      const inp = box.querySelector('.pinput[data-j="' + j + '"]');
      if (!inp) return;
      inp.value = meta.def || "";
      if (!n.values) n.values = [];
      n.values[j] = inp.value;
      btn.disabled = true;
      inspectorKey = inspectorKeyFor(n);
      markDirty();
      inp.focus();
    });
  });
  const btnResetAll = $("#btnResetAll");
  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => {
      n.values = [];
      markDirty();
      renderInspector(n);
    });
  }
  $("#btnDel").addEventListener("click", () => {
    nodes = nodes.filter((x) => x.id !== n.id);
    edges = edges.filter((x) => x.from !== n.id && x.to !== n.id);
    selected = null; markDirty(); render();
  });
  inspectorKey = inspectorKeyFor(n);
}

let wbActiveRunId = null;
let wbLastProgress = null;
let wbCancelling = false;

function wbFormatElapsed(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return Math.round(n) + " ms";
  if (n < 60000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + " s";
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return m + " min " + String(s).padStart(2, "0") + " s";
}

function wbPhaseLabel(phase) {
  return ({
    idle: "准备中",
    connecting: "连接引擎",
    sending: "发送电路",
    running: "仿真运行",
    receiving: "接收结果",
    done: "完成",
    cancelled: "已取消",
    timeout: "已超时",
    failed: "失败",
  })[phase] || phase || "运行中";
}

function updateCounts() {
  const resultCount = wbState.results.length;
  const metricCount = wbState.metrics.length;
  const countResults = $("#countResults");
  const countMetrics = $("#countMetrics");
  const reopenCount = $("#dockReopenCount");
  if (countResults) countResults.textContent = String(resultCount);
  if (countMetrics) countMetrics.textContent = String(metricCount);
  if (reopenCount) reopenCount.textContent = String(resultCount);
  const logDot = $("#logDot");
  if (logDot) logDot.hidden = !wbState.log;
}

function applyDockHeight(value, options = {}) {
  const height = validDockHeight(value);
  if (height >= 240) wbState.lastDockHeight = height;
  wbState.dockHeight = height;
  const dock = $("#dock");
  if (dock) {
    dock.dataset.height = String(height);
    dock.style.height = height + "px";
  }
  const reopen = $("#dockReopen");
  if (reopen) reopen.hidden = height !== 0;
  if (options.persist !== false) {
    storageSet(WB_KEYS.dockHeight, height);
    if (height >= 240) storageSet(WB_KEYS.dockLastHeight, height);
  }
}

function setDockTab(tab, options = {}) {
  const next = ["results", "metrics", "log"].includes(tab) ? tab : "results";
  wbState.activeTab = next;
  const dock = $("#dock");
  if (dock) dock.dataset.tab = next;
  document.querySelectorAll(".dock-tab").forEach((btn) => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  const panes = { results: $("#paneResults"), metrics: $("#paneMetrics"), log: $("#paneLog") };
  Object.keys(panes).forEach((key) => {
    if (panes[key]) {
      panes[key].hidden = key !== next;
      panes[key].classList.toggle("active", key === next);
    }
  });
  storageSet(WB_KEYS.dockTab, next);
  if (options.open !== false && wbState.dockHeight < 240) {
    applyDockHeight(wbState.lastDockHeight || 240);
  }
}

function openDock() {
  applyDockHeight(wbState.lastDockHeight || 240);
}

function collapseDock() {
  applyDockHeight(36);
}

function closeDock() {
  applyDockHeight(0);
}

function toggleDock() {
  if (wbState.dockHeight >= 240) collapseDock();
  else openDock();
}

function resetRunResults() {
  wbState.resultGeneration += 1;
  if (wbState.idleHandle && window.cancelIdleCallback) {
    window.cancelIdleCallback(wbState.idleHandle);
    wbState.idleHandle = 0;
  }
  wbState.results = [];
  wbState.svgs = [];
  wbState.metrics = [];
  wbState.log = "";
  wbState.backend = "";
  if (!wbState.running) wbState.status = "idle";
  wbState.firstImageMs = null;
  wbState.firstImagePaintMs = null;
  const grid = $("#resultsGrid");
  if (grid) grid.innerHTML = "";
  const metricsGrid = $("#metricsGrid");
  if (metricsGrid) metricsGrid.innerHTML = "";
  const resultsEmpty = $("#resultsEmpty");
  if (resultsEmpty) {
    resultsEmpty.hidden = false;
    resultsEmpty.textContent = "运行后在这里查看图形结果。";
  }
  const metricsEmpty = $("#metricsEmpty");
  if (metricsEmpty) {
    metricsEmpty.hidden = false;
    metricsEmpty.textContent = "本题没有 BER 指标";
  }
  const logPre = $("#logPre");
  if (logPre) logPre.textContent = "暂无日志";
  const copyLog = $("#copyLog");
  if (copyLog) copyLog.disabled = true;
  updateCounts();
}

function renderLog(text) {
  wbState.log = String(text == null ? "" : text);
  const pre = $("#logPre");
  if (pre) pre.textContent = wbState.log || "暂无日志";
  const copy = $("#copyLog");
  if (copy) copy.disabled = !wbState.log;
  const dot = $("#logDot");
  if (dot) dot.hidden = !wbState.log;
}

function safeSvgText(svg) {
  return String(svg || "").replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/i, "");
}

function getResultSvg(index) {
  const item = wbState.results[index];
  if (!item) return "";
  if (wbState.svgs[index] == null) wbState.svgs[index] = safeSvgText(item.svg);
  return wbState.svgs[index];
}

function makeResultFigure(index) {
  const result = wbState.results[index];
  if (!result) return null;
  const svg = getResultSvg(index);
  const fig = document.createElement("figure");
  fig.dataset.i = String(index);
  const wrap = document.createElement("div");
  wrap.className = "fig";
  wrap.dataset.i = String(index);
  wrap.title = "点击放大";
  wrap.innerHTML = svg;
  wrap.addEventListener("click", () => openLightbox(svg, result.device || "结果图"));
  const caption = document.createElement("figcaption");
  const device = document.createElement("span");
  device.className = "device";
  device.textContent = result.device || result.file || ("图 " + (index + 1));
  const save = document.createElement("button");
  save.type = "button";
  save.className = "mini";
  save.textContent = "导出 SVG";
  save.addEventListener("click", async (event) => {
    event.stopPropagation();
    await saveSvgIndex(index, save);
  });
  caption.appendChild(device);
  caption.appendChild(save);
  fig.appendChild(wrap);
  fig.appendChild(caption);
  return fig;
}

function scheduleRemainingResults(start, generation) {
  if (start >= wbState.results.length) return;
  const run = (deadline) => {
    if (generation !== wbState.resultGeneration) return;
    const grid = $("#resultsGrid");
    if (!grid) return;
    const fragment = document.createDocumentFragment();
    let added = 0;
    while (start < wbState.results.length && added < 2) {
      if (added > 0 && deadline && typeof deadline.timeRemaining === "function" && deadline.timeRemaining() < 3) break;
      const fig = makeResultFigure(start);
      if (fig) fragment.appendChild(fig);
      start += 1;
      added += 1;
    }
    if (fragment.childNodes.length) grid.appendChild(fragment);
    if (start < wbState.results.length) scheduleRemainingResults(start, generation);
  };
  if (window.requestIdleCallback) {
    wbState.idleHandle = window.requestIdleCallback(run, { timeout: 180 });
  } else {
    wbState.idleHandle = setTimeout(() => run({ timeRemaining: () => 12 }), 24);
  }
}

function renderResults(results, metrics, log) {
  wbState.resultGeneration += 1;
  const generation = wbState.resultGeneration;
  wbState.results = Array.isArray(results) ? results.slice() : [];
  wbState.svgs = new Array(wbState.results.length);
  wbState.metrics = (Array.isArray(metrics) ? metrics : []).filter((m) => m && m.kind === "metric");

  const grid = $("#resultsGrid");
  if (grid) grid.innerHTML = "";
  const resultsEmpty = $("#resultsEmpty");
  if (resultsEmpty) {
    resultsEmpty.hidden = wbState.results.length > 0;
    resultsEmpty.textContent = wbState.results.length ? "" : "本次运行没有图形结果。";
  }
  if (wbState.results.length) {
    const first = makeResultFigure(0);
    if (first && grid) grid.appendChild(first);
    wbState.firstImageMs = Math.max(0, performance.now() - (wbState.runStartedAt || performance.now()));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation === wbState.resultGeneration) {
        wbState.firstImagePaintMs = Math.max(0, performance.now() - (wbState.runStartedAt || performance.now()));
      }
    }));
    scheduleRemainingResults(1, generation);
  }
  renderLog(log);
  updateCounts();
  renderMetrics(wbState.metrics);
}

function renderMetrics(metrics) {
  const grid = $("#metricsGrid");
  const empty = $("#metricsEmpty");
  if (grid) grid.innerHTML = "";
  if (!metrics.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "本题没有 BER 指标";
    }
    return;
  }
  if (empty) empty.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const metric of metrics) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const head = document.createElement("div");
    head.className = "metric-head";
    const name = document.createElement("span");
    name.className = "metric-name";
    name.textContent = String(metric.name || "BER").toUpperCase();
    name.title = String(metric.name || "").toUpperCase() === "BER" ? "误码率" : "";
    const device = document.createElement("span");
    device.className = "metric-device";
    device.textContent = metric.device || "";
    head.appendChild(name);
    head.appendChild(device);
    const value = document.createElement("div");
    value.className = "metric-value";
    value.textContent = formatMetricValue(metric.value != null ? metric.value : metric.ber);
    const detail = document.createElement("div");
    detail.className = "metric-detail";
    const errors = metric.errors == null ? "—" : String(metric.errors);
    const total = metric.total == null ? "—" : String(metric.total);
    detail.textContent = errors + " / " + total + " bit";
    card.appendChild(head);
    card.appendChild(value);
    card.appendChild(detail);
    fragment.appendChild(card);
  }
  if (grid) grid.appendChild(fragment);
}

function setDockProgress(progress) {
  const wrap = $("#dockProgress");
  const bar = $("#dockProgressBar");
  if (!wrap || !bar) return;
  const done = !progress || !!progress.done;
  if (done) {
    wrap.hidden = true;
    wrap.classList.remove("indeterminate");
    bar.style.transform = "";
    return;
  }
  wrap.hidden = false;
  const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
  if (percent == null || progress.indeterminate !== false) {
    wrap.classList.add("indeterminate");
    bar.style.transform = "";
  } else {
    wrap.classList.remove("indeterminate");
    bar.style.transform = "scaleX(" + (percent / 100) + ")";
  }
}

function updateWbProgress(p) {
  wbLastProgress = p;
  setDockProgress(p);
  const elapsed = p && Number.isFinite(p.elapsedMs)
    ? p.elapsedMs
    : (wbState.runStartedAt ? performance.now() - wbState.runStartedAt : 0);
  if (wbState.running && !(p && p.done)) {
    setDockStatus("正在解算 · " + formatShortElapsed(elapsed), {
      tone: "running",
      meta: wbPhaseLabel(p && p.phase),
    });
  }
  const cancel = $("#dockCancel");
  if (cancel) {
    cancel.hidden = !wbState.running;
    cancel.disabled = wbCancelling;
    cancel.textContent = wbCancelling ? "取消中…" : "取消";
  }
}

async function cancelWbRun() {
  if (!wbActiveRunId || wbCancelling) return;
  wbCancelling = true;
  updateWbProgress(wbLastProgress);
  try {
    const r = await window.api.runGraph({ __control: "cancel", __runId: wbActiveRunId });
    if (!r || !r.ok) {
      wbCancelling = false;
      updateWbProgress(wbLastProgress);
    }
  } catch (e) {
    wbCancelling = false;
    updateWbProgress(wbLastProgress);
    console.warn("[workbench] cancel failed: " + (e && e.message ? e.message : e));
  }
}

function setRunButtonRunning(running) {
  const btn = $("#btnRun");
  if (!btn) return;
  btn.disabled = running;
  btn.classList.toggle("is-running", running);
  btn.setAttribute("aria-busy", running ? "true" : "false");
  const label = btn.querySelector(".run-label");
  if (label) label.textContent = running ? "运行中" : "运行";
}

async function run() {
  if (wbState.running) return;
  if (!nodes.length) {
    toast("画布还没有器件");
    setDockStatus("就绪", { meta: "画布为空" });
    return;
  }
  const runId = "wb-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  wbState.running = true;
  wbState.status = "running";
  wbState.runStartedAt = performance.now();
  wbState.firstImageMs = null;
  wbState.firstImagePaintMs = null;
  wbActiveRunId = runId;
  wbCancelling = false;
  wbLastProgress = null;
  resetRunResults();
  setRunButtonRunning(true);
  if (wbState.dockHeight === 0) applyDockHeight(36);
  setDockStatus("正在解算 · 0.0s", { tone: "running", meta: "准备中" });
  setDockProgress({ phase: "connecting", indeterminate: true });
  const cancel = $("#dockCancel");
  if (cancel) {
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = "取消";
  }

  const timer = setInterval(async () => {
    if (wbActiveRunId !== runId) return;
    try {
      const s = await window.api.runGraph({ __control: "status", __runId: runId });
      if (wbActiveRunId === runId && s && s.progress) updateWbProgress(s.progress);
    } catch { /* progress polling must not break the run */ }
  }, 250);
  const elapsedTimer = setInterval(() => {
    if (!wbState.running || wbActiveRunId !== runId) return;
    const phase = wbLastProgress && wbLastProgress.phase;
    setDockStatus("正在解算 · " + formatShortElapsed(performance.now() - wbState.runStartedAt), {
      tone: "running",
      meta: wbPhaseLabel(phase),
    });
  }, 100);

  try {
    const r = await window.api.runGraph({
      __runId: runId,
      nodes: nodes.map((n) => ({ id: n.id, className: n.dev.className, componentName: n.dev.componentName, inputs: n.inputs, values: n.values || [] })),
      edges: edges.map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort })),
    });
    if (!r.ok) {
      const status = (r && r.status) || "failed";
      const label = status === "cancelled" ? "运行已取消" : status === "timeout" ? "运行超时" : "运行失败";
      wbState.status = status;
      setDockStatus(label, { tone: status === "cancelled" ? "" : "error", meta: r.reason || "" });
      renderLog(r.reason || "");
      toast(label + (r.reason ? "：" + r.reason : ""));
      return;
    }
    const results = Array.isArray(r.results) ? r.results : [];
    const metrics = (Array.isArray(r.metrics) ? r.metrics : []).filter((m) => m && m.kind === "metric");
    wbState.backend = r.backend || "";
    wbState.status = "done";
    renderResults(results, metrics, r.log || "");
    const elapsed = Number.isFinite(r.elapsedMs) ? r.elapsedMs : performance.now() - wbState.runStartedAt;
    const meta = [r.backend || "native", formatShortElapsed(elapsed)];
    if (r.fallbackFrom) meta.push("回退自 " + r.fallbackFrom);
    setDockStatus(results.length + " 图 · " + metrics.length + " 指标", {
      tone: "done",
      meta: meta.filter(Boolean).join(" · "),
    });
    updateCounts();
  } catch (e) {
    wbState.status = "failed";
    setDockStatus("运行失败", { tone: "error", meta: e && e.message ? e.message : String(e) });
    renderLog(e && e.message ? e.message : String(e));
    toast("运行失败：" + (e && e.message ? e.message : e));
  } finally {
    clearInterval(timer);
    clearInterval(elapsedTimer);
    if (wbActiveRunId === runId) wbActiveRunId = null;
    wbState.running = false;
    wbCancelling = false;
    setRunButtonRunning(false);
    setDockProgress(null);
    const cancelBtn = $("#dockCancel");
    if (cancelBtn) cancelBtn.hidden = true;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function formatMetricValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toExponential(2) : "—";
}

function fileBaseName(filePath) {
  const base = String(filePath || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.(clab|json)$/i, "") || "未命名电路";
}

function findDeviceForClass(className) {
  const byCn = new Map(DEVICES.map((d) => [d.className, d]));
  if (byCn.has(className)) return byCn.get(className);
  if (byCn.has(className + "_Comm")) return byCn.get(className + "_Comm");
  if (String(className).startsWith("Sourse_")) {
    const alt = "Source_" + String(className).slice(7);
    if (byCn.has(alt + "_Comm")) return byCn.get(alt + "_Comm");
  }
  return null;
}

function restoreDockStatus() {
  if (wbState.running) return;
  if (wbState.status === "done") {
    setDockStatus(wbState.results.length + " 图 · " + wbState.metrics.length + " 指标", {
      tone: "done",
      meta: wbState.backend || "native",
    });
  } else if (wbState.results.length) {
    setDockStatus(wbState.results.length + " 图 · " + wbState.metrics.length + " 指标", { tone: "done" });
  } else {
    setDockStatus("就绪");
  }
}

function applySavedData(data, name) {
  if (!data || !Array.isArray(data.nodes)) throw new Error("文件里没有电路节点");
  nodes = data.nodes.map((n) => {
    const dev = findDeviceForClass(n.className) || {
      className: n.className,
      componentName: n.componentName || n.className,
      inputs: n.inputs,
      outputs: n.outputs,
    };
    return {
      id: n.id,
      dev,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      inputs: n.inputs,
      outputs: n.outputs,
      values: Array.isArray(n.values) ? n.values : [],
      label: n.label || "",
    };
  }).filter((n) => n.dev);
  edges = Array.isArray(data.edges) ? data.edges : [];
  seq = nodes.reduce((m, n) => Math.max(m, Number(String(n.id).replace(/\D/g, "")) || 0), 0);
  selected = null;
  resetRunResults();
  setProjectName(name || "未命名电路");
  setSaveState("saved", "已打开");
  render();
  requestAnimationFrame(() => { fitView(); render(); });
  setDockStatus("已打开 · " + nodes.length + " 器件 / " + edges.length + " 连线", { meta: name || "" });
}

async function openClabFile(file) {
  if (wbState.running) {
    toast("运行中，完成后再载入");
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    applySavedData(data, fileBaseName(file.name));
    toast("已打开 " + file.name);
  } catch (err) {
    setDockStatus("打开失败", { tone: "error", meta: err.message });
    renderLog(err.message);
    toast("打开失败：" + err.message);
  }
}

async function importOcj(sourcePath) {
  if (wbState.running) {
    toast("运行中，完成后再载入");
    return;
  }
  const r = await window.api.importOcj(sourcePath);
  if (!r || !r.ok) {
    if (r && r.canceled) return;
    const reason = (r && r.reason) || "未知错误";
    setDockStatus("导入 OCJ 失败", { tone: "error", meta: reason });
    renderLog(reason);
    toast("导入 OCJ 失败：" + reason);
    return;
  }
  nodes = (r.nodes || []).map((n) => {
    const dev = findDeviceForClass(n.className) || {
      className: n.className,
      componentName: n.componentName || n.className,
      inputs: n.inputs,
      outputs: n.outputs,
    };
    return {
      id: n.id,
      dev,
      x: n.x,
      y: n.y,
      inputs: n.inputs,
      outputs: n.outputs,
      values: n.values || [],
      label: n.label || "",
    };
  }).filter((n) => n.dev);
  edges = r.edges || [];
  seq = nodes.reduce((m, n) => Math.max(m, Number(String(n.id).replace(/\D/g, "")) || 0), 0);
  selected = null;
  resetRunResults();
  setProjectName(r.name || fileBaseName(r.path));
  setSaveState("dirty", "未保存");
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  if (warnings.length) renderLog(warnings.join("\n"));
  render();
  requestAnimationFrame(() => { fitView(); render(); });
  setDockStatus("已导入 · " + nodes.length + " 器件 / " + edges.length + " 连线" +
    (warnings.length ? " · " + warnings.length + " 条提示" : ""), { meta: r.name || "" });
  toast("已导入 " + (r.name || "OCJ 工程"));
}

async function saveProject(saveAs) {
  const payload = {
    version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      className: n.dev.className,
      x: n.x,
      y: n.y,
      inputs: n.inputs,
      outputs: n.outputs,
      values: n.values || [],
      label: n.label || "",
    })),
    edges,
  };
  const wasDirty = wbState.saveState === "dirty";
  setSaveState("loading", saveAs ? "另存中…" : "保存中…");
  try {
    const r = await window.api.save(payload);
    if (!r || !r.ok) {
      setSaveState(wasDirty ? "dirty" : "saved", wasDirty ? "未保存" : "已保存");
      if (r && !r.canceled) toast("保存失败");
      return;
    }
    wbState.lastSavedPath = r.path || "";
    setSaveState("saved", "已保存");
    if (saveAs || wbState.projectName === "未命名电路") setProjectName(fileBaseName(r.path));
    toast("已保存");
    setDockStatus("已保存", { meta: fileBaseName(r.path) });
    setTimeout(restoreDockStatus, 1600);
  } catch (err) {
    setSaveState(wasDirty ? "dirty" : "saved", wasDirty ? "未保存" : "已保存");
    toast("保存失败：" + err.message);
  }
}

async function saveSvgIndex(index, trigger) {
  const item = wbState.results[index];
  if (!item) return;
  const button = trigger && trigger.nodeType === 1 ? trigger : null;
  const original = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "导出中…";
  }
  try {
    const out = await window.api.saveSvg({ name: item.file || "figure.svg", svg: getResultSvg(index) });
    if (out && out.ok) {
      if (button) button.textContent = "已导出";
      toast("已导出 SVG");
    } else if (!(out && out.canceled)) {
      if (button) button.textContent = original || "导出 SVG";
      toast("导出 SVG 失败");
    }
  } catch (err) {
    if (button) button.textContent = original || "导出 SVG";
    toast("导出 SVG 失败：" + err.message);
  } finally {
    if (button) {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original || "导出 SVG";
      }, 1200);
    }
  }
}

function showSvgDialog() {
  if (!wbState.results.length) {
    toast("还没有可导出的结果图");
    return;
  }
  const list = $("#svgDialogList");
  if (!list) return;
  list.innerHTML = "";
  wbState.results.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "svg-item";
    const no = document.createElement("span");
    no.className = "si";
    no.textContent = "图 " + String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "sd";
    name.textContent = item.device || item.file || "结果图";
    btn.appendChild(no);
    btn.appendChild(name);
    btn.addEventListener("click", async () => {
      await saveSvgIndex(index, btn);
      const dialog = $("#svgDialog");
      if (dialog && dialog.open) dialog.close();
    });
    list.appendChild(btn);
  });
  const dialog = $("#svgDialog");
  if (dialog && !dialog.open) dialog.showModal();
}

async function exportReport() {
  setDockStatus("正在生成 PDF…", { meta: "最近一次运行" });
  try {
    const r = await window.api.runGraph({ __control: "report-export" });
    if (r && r.ok) {
      toast("报告已导出");
      setDockStatus("报告已导出", { tone: "done" });
    } else if (!(r && r.canceled)) {
      const reason = (r && r.reason) || "未知错误";
      toast("导出报告失败：" + reason);
      setDockStatus("导出报告失败", { tone: "error", meta: reason });
    }
  } catch (err) {
    toast("导出报告失败：" + err.message);
    setDockStatus("导出报告失败", { tone: "error", meta: err.message });
  } finally {
    setTimeout(restoreDockStatus, 1800);
  }
}

async function openLegacy() {
  setDockStatus("正在转到老版…", { meta: "兼容模式" });
  try {
    const r = await window.api.openLab({
      nodes: nodes.map((n) => ({
        id: n.id,
        className: n.dev.className,
        x: n.x,
        y: n.y,
        inputs: n.inputs,
        outputs: n.outputs,
        values: n.values || [],
      })),
      edges: edges.map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort })),
    });
    if (r && r.ok === false) {
      setDockStatus("转到老版失败", { tone: "error", meta: r.reason || "未知原因" });
      toast("转到老版失败：" + (r.reason || "未知原因"));
    } else if (r && r.warnings && r.warnings.length) {
      setDockStatus("已转到老版", { meta: r.warnings.join("；") });
      toast("已转到老版：" + r.warnings.join("；"));
    } else {
      setDockStatus("已转到老版实验台", { tone: "done" });
      toast("已转到老版实验台");
    }
  } catch (err) {
    setDockStatus("转到老版失败", { tone: "error", meta: err.message });
    toast("转到老版失败：" + err.message);
  }
}

function clearCircuit() {
  if (wbState.running) {
    toast("运行中，暂不清空");
    return;
  }
  nodes = [];
  edges = [];
  selected = null;
  seq = 0;
  resetRunResults();
  setProjectName("未命名电路");
  setSaveState("dirty", "未保存");
  render();
  setDockStatus("就绪", { meta: "画布为空" });
  toast("已清空电路");
  const dialog = $("#confirmDialog");
  if (dialog && dialog.open) dialog.close();
}

async function copyLog() {
  if (!wbState.log) return;
  const button = $("#copyLog");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(wbState.log);
    } else {
      const area = document.createElement("textarea");
      area.value = wbState.log;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    if (button) {
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = "复制"; }, 1200);
    }
  } catch (err) {
    toast("复制失败：" + err.message);
  }
}

boot();

function setPaneCollapsed(pane, button, collapsed, persist) {
  if (!pane || !button) return;
  pane.classList.toggle("collapsed", collapsed);
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = pane.id === "palettePane" ? "器件库" : "属性面板";
  const title = (collapsed ? "展开" : "收起") + label;
  button.title = title;
  button.setAttribute("aria-label", title);
  if (persist) storageSet(pane.id === "palettePane" ? WB_KEYS.palette : WB_KEYS.inspector, collapsed ? "1" : "0");
  canvasSizeDirty = true;
  scheduleRender();
}

function closeMenus() {
  document.querySelectorAll(".menu").forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll("[aria-haspopup=\"menu\"]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function toggleMenu(button, menu) {
  const willOpen = menu.hidden;
  closeMenus();
  if (!willOpen) return;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  const first = menu.querySelector("button");
  if (first) first.focus({ preventScroll: true });
}

function bindMenuButton(button, menu) {
  if (!button || !menu) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu(button, menu);
  });
}

function startDockDrag(ev) {
  if (ev.button !== 0) return;
  const dock = $("#dock");
  if (!dock) return;
  ev.preventDefault();
  const startY = ev.clientY;
  const startHeight = wbState.dockHeight || 36;
  let moved = false;
  dock.classList.add("is-dragging");
  document.body.style.cursor = "ns-resize";
  const onMove = (event) => {
    const delta = startY - event.clientY;
    if (Math.abs(delta) > 2) moved = true;
    const max = Math.max(240, window.innerHeight - 160);
    const height = Math.max(0, Math.min(max, startHeight + delta));
    dock.style.height = height + "px";
    dock.dataset.height = height >= 120 ? "240" : "36";
  };
  const finish = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    document.body.style.cursor = "";
    dock.classList.remove("is-dragging");
    if (!moved) {
      applyDockHeight(wbState.dockHeight, { persist: false });
      return;
    }
    const current = Number.parseFloat(dock.style.height) || wbState.dockHeight;
    const snapped = current < 120 ? 0 : current < 320 ? 240 : 400;
    applyDockHeight(snapped);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}

function closeTopLayers() {
  if (document.getElementById("lightbox")) {
    closeLightbox();
    return true;
  }
  const picker = $("#picker");
  if (picker && picker.classList.contains("open")) {
    closePicker();
    return true;
  }
  const confirm = $("#confirmDialog");
  if (confirm && confirm.open) {
    confirm.close();
    return true;
  }
  const svgDialog = $("#svgDialog");
  if (svgDialog && svgDialog.open) {
    svgDialog.close();
    return true;
  }
  if (document.querySelector(".menu:not([hidden])")) {
    closeMenus();
    return true;
  }
  return false;
}

function onGlobalKeyDown(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "Escape") {
    if (closeTopLayers()) {
      event.preventDefault();
      return;
    }
    if (pending || connectFrom) {
      pending = null;
      connectFrom = null;
      clearHotPort();
      render();
      event.preventDefault();
      return;
    }
    if (wbState.dockHeight !== 0) {
      closeDock();
      event.preventDefault();
    }
    return;
  }
  if (mod && (event.key === "`" || event.code === "Backquote")) {
    event.preventDefault();
    toggleDock();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject(event.shiftKey);
    return;
  }
  if (mod && event.key === "Enter") {
    event.preventDefault();
    run();
    return;
  }
  if (event.key === "Delete" && selected && !isEditableTarget(event.target)) {
    nodes = nodes.filter((n) => n.id !== selected);
    edges = edges.filter((edge) => edge.from !== selected && edge.to !== selected);
    selected = null;
    markDirty();
    render();
    event.preventDefault();
  }
}

function initShell() {
  const storedHeight = validDockHeight(storageGet(WB_KEYS.dockHeight, 36));
  const storedLast = validDockHeight(storageGet(WB_KEYS.dockLastHeight, 240));
  wbState.lastDockHeight = storedLast >= 240 ? storedLast : 240;
  applyDockHeight(storedHeight, { persist: false });
  setDockTab(storageGet(WB_KEYS.dockTab, "results"), { open: false });
  setPaneCollapsed($("#palettePane"), $("#paletteToggle"), storageGet(WB_KEYS.palette, "0") === "1", false);
  setPaneCollapsed($("#inspectorPane"), $("#inspectorToggle"), storageGet(WB_KEYS.inspector, "0") === "1", false);

  bindMenuButton($("#btnImport"), $("#importMenu"));
  bindMenuButton($("#btnMore"), $("#moreMenu"));
  $("#btnBack").addEventListener("click", () => window.close());
  $("#btnRun").addEventListener("click", run);
  $("#menuFromExp").addEventListener("click", openPicker);
  $("#menuImportOcj").addEventListener("click", () => importOcj());
  $("#menuOpenClab").addEventListener("click", () => $("#clabFile").click());
  $("#menuSave").addEventListener("click", () => saveProject(false));
  $("#menuSaveAs").addEventListener("click", () => saveProject(true));
  $("#menuReport").addEventListener("click", exportReport);
  $("#menuExportSvg").addEventListener("click", showSvgDialog);
  $("#menuClear").addEventListener("click", () => {
    const dialog = $("#confirmDialog");
    if (dialog && !dialog.open) dialog.showModal();
  });
  $("#menuLegacy").addEventListener("click", openLegacy);

  $("#paletteToggle").addEventListener("click", () => {
    const pane = $("#palettePane");
    setPaneCollapsed(pane, $("#paletteToggle"), !pane.classList.contains("collapsed"), true);
  });
  $("#inspectorToggle").addEventListener("click", () => {
    const pane = $("#inspectorPane");
    setPaneCollapsed(pane, $("#inspectorToggle"), !pane.classList.contains("collapsed"), true);
  });

  document.querySelectorAll(".dock-tab").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setDockTab(button.dataset.tab, { open: true });
    });
  });
  $("#dockCollapse").addEventListener("click", collapseDock);
  $("#dockClose").addEventListener("click", closeDock);
  $("#dockReopen").addEventListener("click", openDock);
  $("#dockCancel").addEventListener("click", cancelWbRun);
  $("#dockResize").addEventListener("pointerdown", startDockDrag);
  $("#dockBar").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    startDockDrag(event);
  });
  $("#dockBar").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (wbState.dockHeight < 240) openDock();
  });
  $("#copyLog").addEventListener("click", copyLog);

  $("#confirmCancel").addEventListener("click", () => {
    const dialog = $("#confirmDialog");
    if (dialog && dialog.open) dialog.close();
  });
  $("#confirmClear").addEventListener("click", clearCircuit);
  $("#svgDialogClose").addEventListener("click", () => {
    const dialog = $("#svgDialog");
    if (dialog && dialog.open) dialog.close();
  });
  $("#svgDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#picker").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePicker();
  });

  document.querySelectorAll(".menu").forEach((menu) => {
    menu.addEventListener("click", (event) => {
      if (event.target.closest(".menu-item")) closeMenus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-anchor")) closeMenus();
  });

  const commandBar = document.querySelector(".commandbar");
  const removeInjected = () => {
    const injected = document.getElementById("wbReportBtn");
    if (injected) injected.remove();
  };
  removeInjected();
  if (commandBar && window.MutationObserver) {
    new MutationObserver(removeInjected).observe(commandBar, { childList: true, subtree: true });
  }
}


function openPicker() {
  closeMenus();
  $("#picker").classList.add("open");
  renderPicker("");
  setTimeout(() => $("#pickerSearch").focus(), 30);
}

function closePicker() {
  const picker = $("#picker");
  if (picker) picker.classList.remove("open");
}

const MODULE_ORDER = ["模块一", "模块二", "模块三", "模块四", "模块五", "模块六", "模块七"];

function expSort(list) {
  return list.slice().sort((a, b) => {
    const ia = MODULE_ORDER.indexOf(a.module), ib = MODULE_ORDER.indexOf(b.module);
    return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) ||
      (Number(a.expNo) - Number(b.expNo)) || (a.order - b.order);
  });
}

function renderPicker(q) {
  const list = expSort(q ? EXPS.filter((e) =>
    e.title.toLowerCase().includes(q) ||
    String(e.order) === q ||
    String(e.module || "").toLowerCase().includes(q)) : EXPS);
  const box = $("#pickerList");
  if (!box) return;
  box.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "没有匹配的实验";
    box.appendChild(empty);
    return;
  }
  for (const e of list) {
    const it = document.createElement("div");
    it.className = "picker-item";
    it.tabIndex = 0;
    it.setAttribute("role", "button");
    it.innerHTML = '<span class="po"></span><span class="pt"></span><span class="pm"></span>';
    it.querySelector(".po").textContent = "#" + String(e.order).padStart(2, "0");
    it.querySelector(".pt").textContent = e.title;
    it.querySelector(".pm").textContent = e.module || "";
    it.addEventListener("click", () => { closePicker(); loadExperiment(e); });
    it.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closePicker();
        loadExperiment(e);
      }
    });
    box.appendChild(it);
  }
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

function loadExperiment(exp) {
  if (wbState.running) {
    toast("运行中，完成后再载入");
    return;
  }
  nodes = []; edges = []; selected = null; seq = 0;
  const varNode = new Map();
  const col = (i) => 60 + (i % 6) * 180;
  const row = (i) => 70 + Math.floor(i / 6) * 92;

  let k = 0;
  for (const c of exp.chain || []) {
    seq += 1;
    const dev = findDeviceForClass(c.fn) || { className: c.fn, componentName: c.fn, inputs: 0, outputs: 0 };
    const id = "n" + seq;
    const tokens = splitArgs(c.args);
    const ins = [], vals = [];
    for (const t of tokens) {
      if (varNode.has(t)) ins.push(varNode.get(t));
      else vals.push(t);
    }
    const n = { id, dev, x: col(k), y: row(k), inputs: dev.inputs || 0, outputs: dev.outputs || 0, values: vals };
    nodes.push(n);
    varNode.set(c.var, id);
    ins.forEach((src, j) => edges.push({ from: src, fromPort: 0, to: id, toPort: j }));
    k += 1;
  }

  for (const o of exp.observers || []) {
    seq += 1;
    const dev = findDeviceForClass(o.fn) || { className: o.fn, componentName: o.fn, inputs: 1, outputs: 0 };
    const id = "n" + seq;
    const tokens = splitArgs(o.args);
    const srcs = [];
    const vals = [];
    for (const t of tokens) {
      if (varNode.has(t)) srcs.push(varNode.get(t));
      else vals.push(t);
    }
    nodes.push({ id, dev, x: col(k), y: row(k), inputs: Math.max(dev.inputs || 0, srcs.length), outputs: dev.outputs || 0, values: vals });
    srcs.forEach((src, j) => edges.push({ from: src, fromPort: 0, to: id, toPort: j }));
    k += 1;
  }

  resetRunResults();
  setProjectName(exp.title);
  setSaveState("dirty", "未保存");
  render();
  requestAnimationFrame(() => { fitView(); render(); });
  setDockStatus("已载入 · " + nodes.length + " 器件 / " + edges.length + " 连线", { meta: exp.title });
  toast("已载入 " + exp.title);
}


function closeLightbox() {
  const box = document.getElementById("lightbox");
  if (box) box.remove();
}

function openLightbox(svg, title) {
  closeLightbox();
  const overlay = document.createElement("div");
  overlay.id = "lightbox";
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title || "结果图预览");
  const box = document.createElement("div");
  box.className = "box";
  box.innerHTML = String(svg || "");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "×";
  close.title = "关闭";
  close.setAttribute("aria-label", "关闭预览");
  close.addEventListener("click", closeLightbox);
  box.prepend(close);
  box.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("click", closeLightbox);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

window.importOcj = importOcj;
window.__wbDebug = {
  getState() {
    return {
      projectName: wbState.projectName,
      saveState: wbState.saveState,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      resultsCount: wbState.results.length,
      metricsCount: wbState.metrics.length,
      renderedResults: document.querySelectorAll("#resultsGrid figure").length,
      renderedMetrics: document.querySelectorAll("#metricsGrid .metric-card").length,
      logLength: wbState.log.length,
      backend: wbState.backend,
      status: wbState.status,
      running: wbState.running,
      firstImageMs: wbState.firstImageMs,
      firstImagePaintMs: wbState.firstImagePaintMs,
      dockHeight: wbState.dockHeight,
      activeTab: wbState.activeTab,
      metrics: wbState.metrics.map((m) => ({
        name: m.name,
        value: m.value != null ? m.value : m.ber,
        errors: m.errors,
        total: m.total,
        device: m.device,
      })),
    };
  },
  run,
  importOcj,
  loadExperimentByOrder(order) {
    const exp = EXPS.find((x) => x.order === Number(order));
    if (!exp) return false;
    loadExperiment(exp);
    return true;
  },
  openDock,
  closeDock,
  collapseDock,
  setDockHeight: applyDockHeight,
  setDockTab,
  openPicker,
  closePicker,
};
