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
let wireCache = new Map();
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
  const theme = localStorage.getItem("wb-theme") || "light";
  document.documentElement.dataset.theme = theme;

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

  $("#btnRun").addEventListener("click", run);
  $("#btnClear").addEventListener("click", () => { nodes = []; edges = []; selected = null; wireCache.clear(); render(); });
  $("#btnSave").addEventListener("click", async () => {
    const r = await window.api.save({
      version: 1,
      nodes: nodes.map((n) => ({ id: n.id, className: n.dev.className, x: n.x, y: n.y, inputs: n.inputs, outputs: n.outputs, values: n.values || [] })),
      edges,
    });
    $("#drawerStatus").textContent = r.ok ? "已保存：" + r.path : "";
  });
  $("#btnLoad").addEventListener("click", async () => {
    const r = await window.api.load();
    if (!r.ok) return;
    const byCn = new Map(DEVICES.map((d) => [d.className, d]));
  const findDev = (cn) => {
    if (byCn.has(cn)) return byCn.get(cn);
    if (byCn.has(cn + "_Comm")) return byCn.get(cn + "_Comm");
    if (cn.startsWith("Sourse_")) {
      const alt = "Source_" + cn.slice(7);
      if (byCn.has(alt + "_Comm")) return byCn.get(alt + "_Comm");
    }
    return null;
  };
    nodes = (r.data.nodes || []).map((n) => ({
      id: n.id, dev: byCn.get(n.className) || { className: n.className, componentName: n.className, inputs: n.inputs, outputs: n.outputs },
      x: n.x, y: n.y, inputs: n.inputs, outputs: n.outputs, values: n.values || [],
    })).filter((n) => n.dev);
    edges = r.data.edges || [];
    seq = nodes.reduce((m, n) => Math.max(m, Number(String(n.id).replace(/\D/g, "")) || 0), 0);
    selected = null;
    wireCache.clear();
    render();
    $("#drawerStatus").textContent = "已打开：" + r.path;
  });
  $("#btnOld").addEventListener("click", async () => {
    const btn = $("#btnOld");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "正在转到老版…";
    try {
      const r = await window.api.openLab({
        nodes: nodes.map((n) => ({
          id: n.id, className: n.dev.className, x: n.x, y: n.y,
          inputs: n.inputs, outputs: n.outputs, values: n.values || [],
        })),
        edges: edges.map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort })),
      });
      if (r && r.ok === false) $("#drawerStatus").textContent = "转到老版失败：" + (r.reason || "未知原因");
      else if (r && r.warnings && r.warnings.length) $("#drawerStatus").textContent = "已转到老版：" + r.warnings.join("；");
      else $("#drawerStatus").textContent = "已把当前电路转到老版实验台";
    } catch (e) {
      $("#drawerStatus").textContent = "转到老版失败：" + e.message;
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
  $("#btnFromExp").addEventListener("click", openPicker);
  $("#pickerClose").addEventListener("click", () => $("#picker").classList.remove("open"));
  $("#pickerSearch").addEventListener("input", (e) => renderPicker(e.target.value.trim().toLowerCase()));
  $("#drawerToggle").addEventListener("click", () => $("#drawer").classList.toggle("open"));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" && selected) {
      nodes = nodes.filter((n) => n.id !== selected);
      edges = edges.filter((x) => x.from !== selected && x.to !== selected);
      wireCache.clear();
      selected = null; render();
    }
    if (e.key === "Escape") { pending = null; connectFrom = null; clearHotPort(); render(); }
  });

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

  const autoExp = new URLSearchParams(location.search).get("exp");
  if (autoExp) {
    try {
      const e = EXPS.find((x) => x.order === Number(autoExp));
      if (e) loadExperiment(e);
      else $("#drawerStatus").textContent = "未找到实验 " + autoExp + "（共 " + EXPS.length + "）";
    } catch (err) {
      $("#drawerStatus").textContent = "载入失败：" + err.message;
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
  wireCache.clear();
  render();
}

function portPos(n, side, i) {
  const total = side === "in" ? n.inputs : n.outputs;
  const gap = H / (total + 1);
  return { x: side === "in" ? n.x : n.x + W, y: n.y + gap * (i + 1) };
}

// ---- 正交走线：绕开器件本体，端口处留 16px 出线 ----
const WIRE_PAD = 12, WIRE_STUB = 16, WIRE_TURN = 4, WIRE_R = 7;
const DIRX = [1, 0, -1, 0], DIRY = [0, 1, 0, -1];

function edgeRect(n) {
  return { x: n.x - WIRE_PAD, y: n.y - WIRE_PAD, w: W + WIRE_PAD * 2, h: H + WIRE_PAD * 2 };
}

function fmt(v) { return Math.round(v * 10) / 10; }

function curveD(p1, p2) {
  const mx = (p1.x + p2.x) / 2;
  return "M" + fmt(p1.x) + " " + fmt(p1.y) + " C" + fmt(mx) + " " + fmt(p1.y) + " " +
    fmt(mx) + " " + fmt(p2.y) + " " + fmt(p2.x) + " " + fmt(p2.y);
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, v) {
    const a = this.a; a.push([f, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0][1], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
}

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

// 在候选线网格上做 A*，线段与器件外扩 12px 的矩形不相交
function orthoRoute(p1, p2, rects) {
  const s = { x: p1.x + WIRE_STUB, y: p1.y };
  const t = { x: p2.x - WIRE_STUB, y: p2.y };
  const xsSet = new Set([s.x, t.x]);
  const ysSet = new Set([s.y, t.y]);
  for (const r of rects) {
    xsSet.add(r.x); xsSet.add(r.x + r.w);
    ysSet.add(r.y); ysSet.add(r.y + r.h);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  const nx = xs.length, ny = ys.length;
  const si = xs.indexOf(s.x), sj = ys.indexOf(s.y);
  const ti = xs.indexOf(t.x), tj = ys.indexOf(t.y);
  if (si < 0 || sj < 0 || ti < 0 || tj < 0) return null;

  const inside = (x, y, r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      for (const r of rects) if (inside(xs[i], ys[j], r)) { blocked[j * nx + i] = 1; break; }
    }
  }
  if (blocked[sj * nx + si] || blocked[tj * nx + ti]) return null;

  const hc = new Uint8Array(Math.max(0, nx - 1) * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      let ok = 1;
      const y = ys[j], x1 = xs[i], x2 = xs[i + 1];
      for (const r of rects) {
        if (y > r.y && y < r.y + r.h && x2 > r.x && x1 < r.x + r.w) { ok = 0; break; }
      }
      hc[j * (nx - 1) + i] = ok;
    }
  }
  const vc = new Uint8Array(nx * Math.max(0, ny - 1));
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx; i++) {
      let ok = 1;
      const x = xs[i], y1 = ys[j], y2 = ys[j + 1];
      for (const r of rects) {
        if (x > r.x && x < r.x + r.w && y2 > r.y && y1 < r.y + r.h) { ok = 0; break; }
      }
      vc[j * nx + i] = ok;
    }
  }

  const manh = (i, j) => Math.abs(i - ti) + Math.abs(j - tj);
  const states = nx * ny * 4;
  const dist = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const start = (sj * nx + si) * 4;
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(manh(si, sj), start);
  const goalCell = tj * nx + ti;
  let found = -1;

  while (heap.size) {
    const cur = heap.pop();
    if (dist[cur] === Infinity) continue;
    const cell = cur >> 2, dir = cur & 3;
    if (cell === goalCell) { found = cur; break; }
    const i = cell % nx, j = (cell - i) / nx;
    const g = dist[cur];
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRX[nd], nj = j + DIRY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      if (blocked[nj * nx + ni]) continue;
      if (nd === 0 && !hc[j * (nx - 1) + i]) continue;
      if (nd === 2 && !hc[j * (nx - 1) + (i - 1)]) continue;
      if (nd === 1 && !vc[j * nx + i]) continue;
      if (nd === 3 && !vc[(j - 1) * nx + i]) continue;
      const nid = (nj * nx + ni) * 4 + nd;
      const ng = g + 1 + (nd === dir ? 0 : WIRE_TURN);
      if (ng < dist[nid]) {
        dist[nid] = ng;
        prev[nid] = cur;
        heap.push(ng + manh(ni, nj), nid);
      }
    }
  }
  if (found < 0) return null;

  const cells = [];
  for (let cur = found; cur >= 0; cur = prev[cur]) {
    const cell = cur >> 2, i = cell % nx, j = (cell - i) / nx;
    cells.push({ x: xs[i], y: ys[j] });
  }
  cells.reverse();
  const pts = simplify([p1, ...cells, p2]);
  return { d: roundedD(pts), box: pointsBox(pts) };
}

function orthoD(p1, p2, rects) {
  const r = orthoRoute(p1, p2, rects || nodes.map(edgeRect));
  return r ? r.d : null;
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

function curveBox(p1, p2) {
  return {
    x1: Math.min(p1.x, p2.x) - 40, y1: Math.min(p1.y, p2.y) - 40,
    x2: Math.max(p1.x, p2.x) + 40, y2: Math.max(p1.y, p2.y) + 40,
  };
}

function edgeKey(e) {
  return e.from + "|" + e.fromPort + "|" + e.to + "|" + e.toPort;
}

function boxesOverlap(box, rect) {
  if (!box) return true;
  const x2 = rect.x + rect.w, y2 = rect.y + rect.h;
  return box.x1 <= x2 && box.x2 >= rect.x && box.y1 <= y2 && box.y2 >= rect.y;
}

function wireD(a, b, e, rects) {
  const p1 = portPos(a, "out", e.fromPort);
  const p2 = portPos(b, "in", e.toPort);
  const routed = orthoRoute(p1, p2, rects || nodes.map(edgeRect));
  return routed || { d: curveD(p1, p2), box: curveBox(p1, p2) };
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
      wireCache.clear();
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
  let rects = null;
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

    let cached = wireCache.get(key);
    if (!cached || cached.aId !== a.id || cached.bId !== b.id ||
        cached.aX !== a.x || cached.aY !== a.y || cached.bX !== b.x || cached.bY !== b.y) {
      if (!rects) rects = nodes.map(edgeRect);
      const path = wireD(a, b, e, rects);
      cached = {
        d: path.d, box: path.box,
        aId: a.id, bId: b.id, aX: a.x, aY: a.y, bX: b.x, bY: b.y,
      };
      wireCache.set(key, cached);
    }
    if (el.d !== cached.d) {
      setSvgAttr(el.hit, "d", cached.d);
      setSvgAttr(el.wire, "d", cached.d);
      el.d = cached.d;
    }
  }
  for (const [key, el] of edgeEls) {
    if (!alive.has(key)) {
      el.hit.remove();
      el.wire.remove();
      edgeEls.delete(key);
      wireCache.delete(key);
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

function invalidateWiresForNode(n, oldX, oldY) {
  const oldRect = edgeRect({ x: oldX, y: oldY });
  const newRect = edgeRect(n);
  for (const [key, entry] of wireCache) {
    if (entry.aId === n.id || entry.bId === n.id ||
        boxesOverlap(entry.box, oldRect) || boxesOverlap(entry.box, newRect)) {
      wireCache.delete(key);
    }
  }
}


function connect(from, toId, toPort) {
  if (!from || from.nodeId === toId) return;
  edges = edges.filter((e) => !(e.to === toId && e.toPort === toPort));
  edges.push({ from: from.nodeId, fromPort: from.port, to: toId, toPort });
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
  invalidateWiresForNode(n, oldX, oldY);
  scheduleRender();
}

function onPointerUp(ev) {
  const hadPan = !!pan;
  const hadDrag = !!drag;
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
      inp.focus();
    });
  });
  const btnResetAll = $("#btnResetAll");
  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => {
      n.values = [];
      renderInspector(n);
    });
  }
  $("#btnDel").addEventListener("click", () => {
    nodes = nodes.filter((x) => x.id !== n.id);
    edges = edges.filter((x) => x.from !== n.id && x.to !== n.id);
    wireCache.clear();
    selected = null; render();
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

function wbProgressInner(p) {
  const phase = (p && p.phase) || "running";
  const done = !!(p && p.done);
  const percent = p && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, p.percent)) : null;
  const indeterminate = !done && ((p && p.indeterminate !== false) || percent == null);
  const width = done ? 100 : (percent == null ? 100 : percent);
  const timeout = p && Number.isFinite(p.timeoutMs) ? " · 上限 " + wbFormatElapsed(p.timeoutMs) : "";
  const cancelText = done ? "已结束" : (wbCancelling ? "正在取消…" : "取消运行");
  const stateText = done ? wbPhaseLabel(phase) : (indeterminate ? "阶段进度待引擎回报" : percent + "%");
  const barStyle = "width:" + width + "%;height:100%;border-radius:999px;background:" + (indeterminate ? "rgba(120,120,120,.55)" : "#3a3a3a") + ";transition:width .2s ease";
  return '<div style="margin:2px 0 16px;padding:11px 12px;border:1px solid #d8d4ca;border-radius:5px;background:#faf8f2">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#333">' +
      '<strong style="font-weight:600">' + esc(wbPhaseLabel(phase)) + '</strong>' +
      '<span style="color:#777">已耗时 ' + esc(wbFormatElapsed(p && p.elapsedMs)) + esc(timeout) + '</span>' +
    '</div>' +
    '<div style="height:4px;margin:9px 0 8px;border-radius:999px;background:#e4e0d6;overflow:hidden"><div style="' + barStyle + '"></div></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:11px;color:#777">' +
      '<span>' + esc(stateText) + '</span>' +
      '<button type="button" data-wb-cancel="1" style="appearance:none;border:1px solid #cfc9bc;background:transparent;color:#444;font-size:11px;padding:4px 9px;border-radius:4px;cursor:pointer" ' + (done || wbCancelling ? "disabled" : "") + '>' + esc(cancelText) + '</button>' +
    '</div>' +
  '</div>';
}

function updateWbProgress(p) {
  wbLastProgress = p;
  const mount = document.getElementById("wbProgressMount");
  if (!mount) return;
  mount.innerHTML = wbProgressInner(p);
  const btn = mount.querySelector("[data-wb-cancel]");
  if (btn && !btn.disabled) btn.addEventListener("click", cancelWbRun);
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

async function run() {
  if (!nodes.length) return;
  const btn = $("#btnRun");
  btn.disabled = true; btn.textContent = "运行中…";
  $("#drawer").classList.add("open");
  $("#drawerStatus").textContent = "正在运行电路…";
  $("#drawerBody").innerHTML = '<div id="wbProgressMount"></div>';

  const runId = "wb-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  wbActiveRunId = runId;
  wbCancelling = false;
  updateWbProgress({ phase: "connecting", elapsedMs: 0, indeterminate: true, timeoutMs: null });

  const timer = setInterval(async () => {
    if (wbActiveRunId !== runId) return;
    try {
      const s = await window.api.runGraph({ __control: "status", __runId: runId });
      if (wbActiveRunId === runId && s && s.progress) updateWbProgress(s.progress);
    } catch { /* progress polling must not break the run */ }
  }, 250);

  try {
    const r = await window.api.runGraph({
      __runId: runId,
      nodes: nodes.map((n) => ({ id: n.id, className: n.dev.className, componentName: n.dev.componentName, inputs: n.inputs, values: n.values || [] })),
      edges: edges.map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort })),
    });
    if (!r.ok) {
      const status = (r && r.status) || "failed";
      const label = status === "cancelled" ? "运行已取消" : status === "timeout" ? "运行超时" : "运行失败";
      $("#drawerStatus").textContent = label;
      $("#drawerBody").innerHTML = '<pre class="log">' + esc(r.reason || "") + "</pre>";
      return;
    }
    ensureMetricStyles();
    const results = Array.isArray(r.results) ? r.results : [];
    const metrics = Array.isArray(r.metrics) ? r.metrics : [];
    $("#drawerStatus").textContent = "完成 · " + results.length + " 张图" +
      (metrics.length ? " · " + metrics.length + " 项指标" : "") +
      (r.backend ? " · " + r.backend : "") + (r.fallbackFrom ? " · 已回退" : "");
    const svgs = results.map((x) => String(x.svg).replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, ""));
    const figs = results.map((x, i) =>
      '<figure><div class="fig" data-i="' + i + '">' + svgs[i] + "</div>" +
      '<figcaption><span>' + esc(x.device) + '</span><button class="mini" data-save="' + i + '">导出 SVG</button></figcaption></figure>'
    ).join("");
    const log = r.log ? '<pre class="log">' + esc(r.log) + "</pre>" : "";
    const metricHtml = metricsHtml(metrics);
    const body = $("#drawerBody");
    body.innerHTML = metricHtml + (figs ? '<div class="results">' + figs + "</div>" : "") + log;
    body.querySelectorAll(".fig").forEach((el) => {
      el.addEventListener("click", () => openLightbox(svgs[Number(el.dataset.i)]));
    });
    body.querySelectorAll("[data-save]").forEach((saveBtn) => {
      saveBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const i = Number(saveBtn.dataset.save);
        const out = await window.api.saveSvg({ name: results[i].file || "figure.svg", svg: svgs[i] });
        if (out && out.ok) saveBtn.textContent = "已导出";
      });
    });
  } catch (e) {
    $("#drawerStatus").textContent = "运行失败";
    $("#drawerBody").innerHTML = '<pre class="log">' + esc(e.message) + "</pre>";
  } finally {
    clearInterval(timer);
    if (wbActiveRunId === runId) wbActiveRunId = null;
    wbCancelling = false;
    btn.disabled = false; btn.textContent = "运行仿真";
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
    return '<div class="metric-card">' +
      '<div class="metric-head"><span class="metric-name">' + esc(label) + '</span>' +
      '<span class="metric-device">' + esc(m.device || "") + '</span></div>' +
      '<div class="metric-value">' + esc(formatMetricValue(m.value != null ? m.value : m.ber)) + '</div>' +
      '<div class="metric-detail">' + esc(errors) + ' / ' + esc(total) + ' bit</div>' +
      '</div>';
  }).join("") + '</div>';
}

function ensureMetricStyles() {
  if (document.getElementById("wbMetricStyles")) return;
  const style = document.createElement("style");
  style.id = "wbMetricStyles";
  style.textContent = ".metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:0 0 18px}" +
    ".metric-card{border:1px solid var(--rule);border-radius:4px;background:var(--paper-2);padding:12px 14px}" +
    ".metric-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}" +
    ".metric-name{font-size:12px;letter-spacing:.04em;color:var(--muted)}" +
    ".metric-device{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)}" +
    ".metric-value{margin-top:8px;font-family:var(--mono);font-size:22px;line-height:1.1;color:var(--ink)}" +
    ".metric-detail{margin-top:5px;font-family:var(--mono);font-size:11px;color:var(--muted)}";
  document.head.appendChild(style);
}

boot();


function openPicker() {
  $("#picker").classList.add("open");
  renderPicker("");
  setTimeout(() => $("#pickerSearch").focus(), 30);
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
  const list = expSort(q ? EXPS.filter((e) => e.title.toLowerCase().includes(q) || String(e.order) === q) : EXPS);
  const box = $("#pickerList");
  box.innerHTML = "";
  for (const e of list) {
    const it = document.createElement("div");
    it.className = "picker-item";
    it.innerHTML = '<span class="pt"></span><span class="pm"></span>';
    it.querySelector(".pt").textContent = e.title;
    it.querySelector(".pm").textContent = e.module || "";
    it.addEventListener("click", () => { $("#picker").classList.remove("open"); loadExperiment(e); });
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
  nodes = []; edges = []; selected = null; seq = 0;
  wireCache.clear();
  const byCn = new Map(DEVICES.map((d) => [d.className, d]));
  const findDev = (cn) => {
    if (byCn.has(cn)) return byCn.get(cn);
    if (byCn.has(cn + "_Comm")) return byCn.get(cn + "_Comm");
    if (cn.startsWith("Sourse_")) {
      const alt = "Source_" + cn.slice(7);
      if (byCn.has(alt + "_Comm")) return byCn.get(alt + "_Comm");
    }
    return null;
  };
  const varNode = new Map();
  const col = (i) => 60 + (i % 6) * 180;
  const row = (i) => 70 + Math.floor(i / 6) * 92;

  let k = 0;
  for (const c of exp.chain) {
    seq += 1;
    const dev = findDev(c.fn) || { className: c.fn, componentName: c.fn, inputs: 0, outputs: 0 };
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
    const dev = findDev(o.fn) || { className: o.fn, componentName: o.fn, inputs: 1, outputs: 0 };
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

  render();
  $("#drawerStatus").textContent = "已载入：" + exp.title;
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
