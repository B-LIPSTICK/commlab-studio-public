"use strict";

// CommLab native DSP core.
// Pure JavaScript, no npm dependencies.  The numerical behavior intentionally
// follows the small set of Rainier/Octave .m functions used by the prototype
// experiments, including a few historical quirks (see README.md).

const EPS = Number.EPSILON;
const DEFAULT_SVG_WIDTH = 640;
const DEFAULT_SVG_HEIGHT = 440;

function toNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const text = String(value).trim().replace(/^['"]|['"]$/g, "");
  if (text === "") return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback) {
  const n = toNumber(value, fallback);
  return n == null ? n : Math.trunc(n);
}

function toText(value, fallback) {
  if (value == null) return fallback;
  let text = String(value).trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1);
  }
  return text === "" ? fallback : text;
}

function asVector(value, label) {
  if (!Array.isArray(value)) {
    throw new Error("native DSP: " + (label || "signal") + " must be a numeric array");
  }
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = toNumber(value[i], NaN);
    if (!Number.isFinite(n)) {
      throw new Error("native DSP: " + (label || "signal") + "[" + i + "] is not numeric");
    }
    out[i] = n;
  }
  return out;
}

function createRng(seed) {
  // mulberry32.  Deterministic by default so the CLI and tests are repeatable.
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sourceRandi(length, rng) {
  const n = Math.max(0, Math.trunc(toNumber(length, 0)));
  const random = typeof rng === "function" ? rng : createRng(0x9e3779b9);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = random() < 0.5 ? 0 : 1;
  return out;
}

function sourceCosin(A, freq, t, phase, fs) {
  const amp = toNumber(A, 1);
  const f = toNumber(freq, 10);
  const duration = toNumber(t, 1);
  const phi = toNumber(phase, 0);
  const sampleRate = toNumber(fs, 100);
  if (!(sampleRate > 0)) throw new Error("native DSP: Source_Cosin fs must be > 0");
  const n = Math.max(0, Math.floor(duration * sampleRate + 1e-9));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const time = i / sampleRate;
    out[i] = amp * Math.cos(2 * Math.PI * f * time + phi);
  }
  return out;
}

function lineCodeSnrz(st, A, sample) {
  const bits = asVector(st, "LineCode_Snrz input");
  const amp = toNumber(A, 1);
  const exponent = Math.trunc(toNumber(sample, 12));
  if (bits.length === 0) throw new Error("native DSP: LineCode_Snrz input is empty");
  const n = Math.pow(2, exponent);
  if (!Number.isFinite(n) || n <= 0) throw new Error("native DSP: invalid LineCode_Snrz sample exponent");
  const m = bits.length;
  const l = n / m;
  if (!Number.isInteger(l) || l <= 0) {
    throw new Error("native DSP: LineCode_Snrz requires 2^sample to be divisible by the symbol count");
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i < m; i++) {
    const v = bits[i] * amp;
    const start = i * l;
    for (let j = 0; j < l; j++) out[start + j] = v;
  }
  return out;
}

function lineCodeManchester(datain, L) {
  const data = asVector(datain, "LineCode_Manchester input");
  const l = Math.trunc(toNumber(L, 64));
  if (!(l >= 2) || l % 2 !== 0) {
    throw new Error("native DSP: LineCode_Manchester L must be an even integer >= 2");
  }
  if (data.length === 0) throw new Error("native DSP: LineCode_Manchester input is empty");
  const out = new Array(data.length).fill(0);
  const half = l / 2;
  for (let start = 0; start < data.length; start += l) {
    const level = data[start] === 0 ? 0 : 1;
    for (let j = 0; j < l && start + j < data.length; j++) {
      if (level === 0) out[start + j] = j < half ? -1 : 1;
      else out[start + j] = j < half ? 1 : -1;
    }
  }
  return out;
}

function sampleSignal(datain, freq, t) {
  const data = asVector(datain, "ComUse_Sample input");
  const f = toNumber(freq, 64);
  const duration = toNumber(t, 1);
  if (!(f > 0)) throw new Error("native DSP: ComUse_Sample freq must be > 0");
  const n2 = Math.max(0, Math.floor(f * duration + 1e-9));
  if (n2 === 0) return [];
  const n1 = data.length;
  if (n1 === 0) throw new Error("native DSP: ComUse_Sample input is empty");
  const d = Math.round(n1 / n2);
  if (d <= 0) throw new Error("native DSP: ComUse_Sample input is shorter than the output");
  const out = new Array(n2).fill(0);
  // Rainier reads datain(i*d) with 1-based i.  This deliberately keeps the
  // same first-sample offset and the strict "< N1" boundary.
  for (let i = 0; i < n2; i++) {
    const oneBased = (i + 1) * d;
    if (oneBased < n1) out[i] = data[oneBased - 1];
  }
  return out;
}

function roundHalfAwayFromZero(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function pcmQuantize(datain) {
  const data = asVector(datain, "SourceCoding_PCMQuantiz input");
  if (data.length === 0) throw new Error("native DSP: PCM quantizer input is empty");
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  if (max === 0) max = 1;
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = roundHalfAwayFromZero((data[i] / max) * 2048);
  return out;
}

function pcmSegment(absValue) {
  if (absValue >= 0 && absValue < 16) return { bits: [0, 0, 0], step: 1, start: 0 };
  if (absValue >= 16 && absValue < 32) return { bits: [0, 0, 1], step: 1, start: 16 };
  if (absValue >= 32 && absValue < 64) return { bits: [0, 1, 0], step: 2, start: 32 };
  if (absValue >= 64 && absValue < 128) return { bits: [0, 1, 1], step: 4, start: 64 };
  if (absValue >= 128 && absValue < 256) return { bits: [1, 0, 0], step: 8, start: 128 };
  if (absValue >= 256 && absValue < 512) return { bits: [1, 0, 1], step: 16, start: 256 };
  if (absValue >= 512 && absValue < 1024) return { bits: [1, 1, 0], step: 32, start: 512 };
  if (absValue >= 1024 && absValue <= 2048) return { bits: [1, 1, 1], step: 64, start: 1024 };
  throw new Error("native DSP: PCM value out of range (|value| must be <= 2048)");
}

function pcmEncode(datain) {
  const data = asVector(datain, "SourceCoding_PCMCoding input");
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const absValue = Math.abs(value);
    const sign = value > 0 ? 1 : 0;
    const segment = pcmSegment(absValue);
    let b = Math.floor((absValue - segment.start) / segment.step);
    if (b < 0) b = 0;
    if (b > 15) b = 16;
    let nibble;
    if (b === 16) nibble = [1, 1, 1, 1];
    else nibble = [(b >> 3) & 1, (b >> 2) & 1, (b >> 1) & 1, b & 1];
    out.push(sign, segment.bits[0], segment.bits[1], segment.bits[2], nibble[0], nibble[1], nibble[2], nibble[3]);
  }
  return out;
}

function pcmDecode(datain, A) {
  const bits = asVector(datain, "SourceCoding_PCMDecoding input");
  if (bits.length === 0 || bits.length % 8 !== 0) {
    throw new Error("native DSP: PCM decoder input length must be a multiple of 8");
  }
  const amp = toNumber(A, 1);
  const n = bits.length / 8;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = i * 8;
    const segmentCode = bits[base + 1] * 4 + bits[base + 2] * 2 + bits[base + 3];
    let step;
    let start;
    if (segmentCode === 0) { step = 1; start = 0; }
    else if (segmentCode === 1) { step = 1; start = 16; }
    else if (segmentCode === 2) { step = 2; start = 32; }
    else if (segmentCode === 3) { step = 4; start = 64; }
    else if (segmentCode === 4) { step = 8; start = 128; }
    else if (segmentCode === 5) { step = 16; start = 256; }
    else if (segmentCode === 6) { step = 32; start = 512; }
    else { step = 64; start = 1024; }
    const nibble = bits[base + 4] * 8 + bits[base + 5] * 4 + bits[base + 6] * 2 + bits[base + 7];
    let value = start + nibble * step + step / 2;
    if (bits[base] === 0) value = -value;
    out[i] = (value / 2048) * amp;
  }
  return out;
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function fft(re, im) {
  const n = re.length;
  if (n === 0) return { re: [], im: [] };
  if (!isPowerOfTwo(n)) return dft(re, im);
  const rr = Float64Array.from(re);
  const ii = Float64Array.from(im && im.length === n ? im : new Array(n).fill(0));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = rr[i]; rr[i] = rr[j]; rr[j] = tr;
      const ti = ii[i]; ii[i] = ii[j]; ii[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = rr[i + j];
        const uI = ii[i + j];
        const vR = rr[i + j + len / 2] * wr - ii[i + j + len / 2] * wi;
        const vI = rr[i + j + len / 2] * wi + ii[i + j + len / 2] * wr;
        rr[i + j] = uR + vR;
        ii[i + j] = uI + vI;
        rr[i + j + len / 2] = uR - vR;
        ii[i + j + len / 2] = uI - vI;
        const nextWr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nextWr;
      }
    }
  }
  return { re: Array.from(rr), im: Array.from(ii) };
}

function dft(re, im) {
  const n = re.length;
  const outR = new Array(n).fill(0);
  const outI = new Array(n).fill(0);
  const srcI = im && im.length === n ? im : new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sumR = 0;
    let sumI = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      sumR += re[t] * c - srcI[t] * s;
      sumI += re[t] * s + srcI[t] * c;
    }
    outR[k] = sumR;
    outI[k] = sumI;
  }
  return { re: outR, im: outI };
}

function powerSpectrumDensity(datain, L) {
  const data = asVector(datain, "Draw_PowerSpectrum input");
  if (data.length === 0) throw new Error("native DSP: power spectrum input is empty");
  const l = toNumber(L, 64);
  if (!(l > 0)) throw new Error("native DSP: power spectrum L must be > 0");
  if (data.length % 2 === 1) data.push(data[data.length - 1]);
  const n = data.length;
  const dt = 1 / l;
  const df = 1 / (n * dt);
  const t = n * dt;
  const bs = (n * df) / 2;
  const h = fft(data, new Array(n).fill(0));
  const xr = new Array(n);
  const xi = new Array(n);
  for (let i = 0; i < n / 2; i++) {
    const j = n / 2 + i;
    xr[i] = h.re[j] * dt;
    xi[i] = h.im[j] * dt;
  }
  for (let i = n / 2; i < n; i++) {
    const j = i - n / 2;
    xr[i] = h.re[j] * dt;
    xi[i] = h.im[j] * dt;
  }
  const p = new Array(n);
  const db = new Array(n);
  const f = new Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = (xr[i] * xr[i] + xi[i] * xi[i]) / t;
    db[i] = 30 + 10 * Math.log10(p[i] + EPS);
    f[i] = -bs + (i + 1) * df;
  }
  return { f, P: p, dB: db };
}

function parseColor(value, fallback) {
  const text = toText(value, "");
  const key = text.toLowerCase();
  const colors = {
    b: "#0000ff",
    blue: "#0000ff",
    g: "#008000",
    green: "#008000",
    r: "#ff0000",
    red: "#ff0000",
    y: "#b8860b",
    yellow: "#b8860b",
    k: "#000000",
    black: "#000000",
    m: "#ff00ff",
    magenta: "#ff00ff",
    c: "#00ffff",
    cyan: "#00ffff",
  };
  if (colors[key]) return colors[key];
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  return fallback || "#0000ff";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1e-12) return "0";
  if (Math.abs(value) >= 100000 || Math.abs(value) < 0.0001) {
    return value.toExponential(2).replace(/\.?0+e/, "e");
  }
  const d = digits == null ? 3 : digits;
  return value.toFixed(d).replace(/\.?0+$/, "");
}

function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function paddedBounds(values, ratio, includeZero) {
  const e = extent(values);
  let min = e.min;
  let max = e.max;
  if (includeZero) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }
  const pad = ratio == null ? 0.2 : ratio;
  min -= Math.abs(min) * pad;
  max += Math.abs(max) * pad;
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function niceTicks(min, max, targetCount) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max < min) { const t = min; min = max; max = t; }
  if (max === min) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const target = Math.max(2, Math.trunc(targetCount || 6));
  const raw = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  let step;
  if (normalized <= 1) step = 1;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 5) step = 5;
  else step = 10;
  step *= magnitude;
  let start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    const rounded = Math.round(v / step) * step;
    if (!ticks.length || Math.abs(rounded - ticks[ticks.length - 1]) > step * 1e-9) ticks.push(rounded);
    if (ticks.length > 40) break;
  }
  if (ticks.length < 2) ticks.push(min, max);
  return ticks;
}

function extractSeries(datain, label) {
  if (!Array.isArray(datain)) throw new Error("native DSP: " + (label || "draw input") + " must be an array");
  if (datain.length > 0 && Array.isArray(datain[0])) {
    if (datain.length < 2) throw new Error("native DSP: matrix draw input needs [x; n] rows");
    return { x: asVector(datain[1], label + " x"), y: asVector(datain[0], label + " y") };
  }
  const y = asVector(datain, label);
  const x = new Array(y.length);
  for (let i = 0; i < y.length; i++) x[i] = i + 1;
  return { x, y };
}

function buildChartSvg(opts) {
  const width = opts.width || DEFAULT_SVG_WIDTH;
  const height = opts.height || DEFAULT_SVG_HEIGHT;
  const margin = opts.margin || { left: 72, right: 28, top: 52, bottom: 60 };
  const plot = {
    x: margin.left,
    y: margin.top,
    w: width - margin.left - margin.right,
    h: height - margin.top - margin.bottom,
  };
  const series = opts.series || [];
  if (!series.length || !series[0].x.length) throw new Error("native DSP: chart has no data");

  const allX = [];
  const allY = [];
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      if (Number.isFinite(s.x[i]) && Number.isFinite(s.y[i])) {
        allX.push(s.x[i]);
        allY.push(s.y[i]);
      }
    }
  }
  if (!allX.length) throw new Error("native DSP: chart data is not finite");
  const xExtent = extent(allX);
  const yExtent = opts.yBounds || extent(allY);
  let xMin = opts.xMin == null ? xExtent.min : opts.xMin;
  let xMax = opts.xMax == null ? xExtent.max : opts.xMax;
  let yMin = opts.yMin == null ? yExtent.min : opts.yMin;
  let yMax = opts.yMax == null ? yExtent.max : opts.yMax;
  if (opts.includeZeroY) {
    if (yMin > 0) yMin = 0;
    if (yMax < 0) yMax = 0;
  }
  if (!(xMax > xMin)) {
    const pad = Math.abs(xMin) > 0 ? Math.abs(xMin) * 0.2 : 1;
    xMin -= pad;
    xMax += pad;
  }
  if (!(yMax > yMin)) {
    const pad = Math.abs(yMin) > 0 ? Math.abs(yMin) * 0.2 : 1;
    yMin -= pad;
    yMax += pad;
  }

  const xTicks = niceTicks(xMin, xMax, opts.xTickCount || 6);
  const yTicks = niceTicks(yMin, yMax, opts.yTickCount || 6);
  const xScale = (v) => plot.x + ((v - xMin) / (xMax - xMin)) * plot.w;
  const yScale = (v) => plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h;

  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img">');
  parts.push('<title>' + escapeXml(opts.title || "Signal") + '</title>');
  parts.push('<desc>' + escapeXml(opts.desc || "CommLab native JS kernel SVG") + '</desc>');
  parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>');
  parts.push('<defs><clipPath id="plotClip"><rect x="' + plot.x + '" y="' + plot.y + '" width="' + plot.w + '" height="' + plot.h + '"/></clipPath></defs>');

  // Grid and axis ticks.
  parts.push('<g stroke="#d9d9d9" stroke-width="1" fill="none">');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<line x1="' + formatNumber(x) + '" y1="' + plot.y + '" x2="' + formatNumber(x) + '" y2="' + (plot.y + plot.h) + '"/>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<line x1="' + plot.x + '" y1="' + formatNumber(y) + '" x2="' + (plot.x + plot.w) + '" y2="' + formatNumber(y) + '"/>');
  }
  parts.push('</g>');

  parts.push('<g stroke="#333333" stroke-width="1" fill="none">');
  parts.push('<rect x="' + plot.x + '" y="' + plot.y + '" width="' + plot.w + '" height="' + plot.h + '"/>');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<line x1="' + formatNumber(x) + '" y1="' + (plot.y + plot.h) + '" x2="' + formatNumber(x) + '" y2="' + (plot.y + plot.h + 5) + '"/>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<line x1="' + plot.x + '" y1="' + formatNumber(y) + '" x2="' + (plot.x - 5) + '" y2="' + formatNumber(y) + '"/>');
  }
  parts.push('</g>');

  // Tick labels.
  parts.push('<g font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#333333">');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<text x="' + formatNumber(x) + '" y="' + (plot.y + plot.h + 19) + '" text-anchor="middle">' + escapeXml(formatNumber(tick, 3)) + '</text>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<text x="' + (plot.x - 9) + '" y="' + formatNumber(y + 4) + '" text-anchor="end">' + escapeXml(formatNumber(tick, 3)) + '</text>');
  }
  parts.push('</g>');

  // Data.
  parts.push('<g clip-path="url(#plotClip)" fill="none">');
  for (const s of series) {
    const color = s.color || "#0000ff";
    const kind = s.kind || "line";
    if (kind === "stem") {
      const baseline = s.baseline == null ? 0 : s.baseline;
      const baseY = yScale(baseline);
      parts.push('<g stroke="' + escapeXml(color) + '" stroke-width="' + (s.width || 1.25) + '">');
      for (let i = 0; i < s.x.length; i++) {
        if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
        const x = xScale(s.x[i]);
        const y = yScale(s.y[i]);
        parts.push('<line x1="' + formatNumber(x) + '" y1="' + formatNumber(baseY) + '" x2="' + formatNumber(x) + '" y2="' + formatNumber(y) + '"/>');
      }
      parts.push('</g>');
      parts.push('<g fill="' + escapeXml(color) + '" stroke="none">');
      for (let i = 0; i < s.x.length; i++) {
        if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
        parts.push('<circle cx="' + formatNumber(xScale(s.x[i])) + '" cy="' + formatNumber(yScale(s.y[i])) + '" r="2.4"/>');
      }
      parts.push('</g>');
    } else {
      let d = "";
      for (let i = 0; i < s.x.length; i++) {
        if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
        d += (d ? " L" : "M") + formatNumber(xScale(s.x[i])) + "," + formatNumber(yScale(s.y[i]));
      }
      if (d) parts.push('<path d="' + d + '" stroke="' + escapeXml(color) + '" stroke-width="' + (s.width || 1.5) + '" stroke-linejoin="round" stroke-linecap="round"/>');
      if (s.x.length === 1) {
        parts.push('<circle cx="' + formatNumber(xScale(s.x[0])) + '" cy="' + formatNumber(yScale(s.y[0])) + '" r="2.5" fill="' + escapeXml(color) + '"/>');
      }
    }
  }
  parts.push('</g>');

  // Titles and labels.
  parts.push('<g font-family="Arial, Helvetica, sans-serif" fill="#111111">');
  parts.push('<text x="' + (width / 2) + '" y="25" text-anchor="middle" font-size="15" font-weight="600">' + escapeXml(opts.title || "Signal") + '</text>');
  if (opts.xlabel) parts.push('<text x="' + (plot.x + plot.w / 2) + '" y="' + (height - 15) + '" text-anchor="middle" font-size="12">' + escapeXml(opts.xlabel) + '</text>');
  if (opts.ylabel) {
    parts.push('<text x="18" y="' + (plot.y + plot.h / 2) + '" text-anchor="middle" font-size="12" transform="rotate(-90 18 ' + (plot.y + plot.h / 2) + ')">' + escapeXml(opts.ylabel) + '</text>');
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join("\n");
}

function renderPlot(datain, options) {
  const opts = options || {};
  const series = extractSeries(datain, "Draw_Plot input");
  const yb = paddedBounds(series.y, 0.2, false);
  return buildChartSvg({
    title: opts.title || "Signal waveform",
    desc: opts.desc || "Time-domain waveform rendered by the CommLab native JS kernel",
    xlabel: opts.xlabel == null ? "Sample" : opts.xlabel,
    ylabel: opts.ylabel || "amplitude",
    series: [{ x: series.x, y: series.y, color: opts.color || "#0000ff", width: 1.5 }],
    xMin: series.x[0],
    xMax: series.x[series.x.length - 1],
    yMin: yb.min,
    yMax: yb.max,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderStem(datain, options) {
  const opts = options || {};
  const series = extractSeries(datain, "Draw_Stem input");
  const yb = paddedBounds(series.y, 0.2, true);
  return buildChartSvg({
    title: opts.title || "Discrete signal graph",
    desc: opts.desc || "Discrete stem plot rendered by the CommLab native JS kernel",
    xlabel: opts.xlabel == null ? "Sample" : opts.xlabel,
    ylabel: opts.ylabel || "amplitude",
    series: [{ x: series.x, y: series.y, color: opts.color || "#0000ff", kind: "stem", baseline: 0 }],
    xMin: series.x[0],
    xMax: series.x[series.x.length - 1],
    yMin: yb.min,
    yMax: yb.max,
    includeZeroY: true,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderPowerSpectrum(datain, L, displayoption, options) {
  const opts = options || {};
  const spec = powerSpectrumDensity(datain, L);
  const db = String(toText(displayoption, "common")).toLowerCase() === "db";
  const y = db ? spec.dB : spec.P;
  const yb = paddedBounds(y, db ? 0.08 : 0.08, !db);
  return buildChartSvg({
    title: opts.title || "PowerSpectrumDensity",
    desc: opts.desc || "Power spectral density rendered by the CommLab native JS kernel",
    xlabel: opts.xlabel || "Frequency",
    ylabel: opts.ylabel || (db ? "Power (dB)" : "Power"),
    series: [{ x: spec.f, y, color: opts.color || "#0000ff", width: 1.5 }],
    xMin: spec.f[0],
    xMax: spec.f[spec.f.length - 1],
    yMin: yb.min,
    yMax: yb.max,
    includeZeroY: false,
    xTickCount: 6,
    yTickCount: 6,
  });
}

module.exports = {
  EPS,
  toNumber,
  toInt,
  toText,
  asVector,
  createRng,
  sourceRandi,
  sourceCosin,
  lineCodeSnrz,
  lineCodeManchester,
  sampleSignal,
  pcmQuantize,
  pcmEncode,
  pcmDecode,
  fft,
  powerSpectrumDensity,
  parseColor,
  renderPlot,
  renderStem,
  renderPowerSpectrum,
  formatNumber,
  niceTicks,
  escapeXml,
};