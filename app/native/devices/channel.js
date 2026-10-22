"use strict";

// Channel / filtering / multipath devices for the CommLab native kernel.
// The implementations are direct ports of the Rainier Octave sources under
// OwvlabProgHome/RainierCommunicationCoding and the signal package routines
// bundled with Rainier (signal-1.3.2).
//
// Complex signals use [realRow; imagRow].  Real signals are ordinary arrays.

const dsp = require("../dsp");

const CLASS_INFO = Object.freeze([
  ["ComUse_AWGN", 1],
  ["Filter_LPF", 1],
  ["Multipath_Fading", 1],
  ["Multipath_Zero", 1],
]);

const ALIASES = {};
const INPUT_COUNTS = {};
for (const [name, count] of CLASS_INFO) {
  ALIASES[name] = name;
  ALIASES[name + "_Comm"] = name;
  INPUT_COUNTS[name] = count;
}
Object.freeze(ALIASES);
Object.freeze(INPUT_COUNTS);

const DEFAULT_H = Object.freeze([0.02, 0.05, 0.1, -0.2, 1, -0.2, 0.1, 0.05, 0.02]);

function deviceError(label, message) {
  throw new Error("native devices (" + label + "): " + message);
}

function isComplexRows(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    Array.isArray(value[0]) &&
    Array.isArray(value[1]) &&
    value[0].length === value[1].length;
}

function isComplexSignal(value) {
  if (isComplexRows(value)) return true;
  return Array.isArray(value) && value.length > 0 &&
    value[0] && typeof value[0] === "object" && !Array.isArray(value[0]);
}

function asFlat(value, label) {
  if (!Array.isArray(value)) deviceError(label, "expected a numeric array");
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = dsp.toNumber(value[i], NaN);
    if (!Number.isFinite(n)) deviceError(label, "sample " + i + " is not numeric");
    out[i] = n;
  }
  return out;
}

function asComplex(value, label) {
  if (isComplexRows(value)) {
    return { re: asFlat(value[0], label + " real"), im: asFlat(value[1], label + " imag") };
  }
  if (isComplexSignal(value)) {
    const re = new Array(value.length);
    const im = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const sample = value[i];
      const r = dsp.toNumber(sample.re != null ? sample.re : sample.real, NaN);
      const q = dsp.toNumber(sample.im != null ? sample.im : sample.imag, NaN);
      if (!Number.isFinite(r) || !Number.isFinite(q)) {
        deviceError(label, "complex sample " + i + " needs numeric re/im fields");
      }
      re[i] = r;
      im[i] = q;
    }
    return { re, im };
  }
  const re = asFlat(value, label);
  return { re, im: new Array(re.length).fill(0) };
}

function complexRows(re, im) {
  return [re, im];
}

function parseVector(value, fallback, label) {
  if (value == null || value === "") return fallback.slice();
  if (Array.isArray(value)) return asFlat(value, label);
  const text = String(value).trim().replace(/^['"]|['"]$/g, "");
  if (text === "") return fallback.slice();
  const body = text.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (body === "") return fallback.slice();
  const parts = body.split(/[\s,;]+/).filter(Boolean);
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = dsp.toNumber(parts[i], NaN);
    if (!Number.isFinite(n)) deviceError(label, "h[" + i + "] is not numeric");
    out[i] = n;
  }
  return out;
}

function convReal(a, b) {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

function convComplex(signal, h) {
  const re = convReal(signal.re, h);
  const im = convReal(signal.im, h);
  return complexRows(re, im);
}

function gaussian(rng) {
  let u1 = rng();
  if (!(u1 > 0)) u1 = Number.EPSILON;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Octave signal-1.3.2 buttord.m, scalar low-pass branch.  Wp/Ws are
// normalized to the Nyquist frequency (0..1).
function buttordLowpass(wp, ws, rp, rs) {
  if (!(wp > 0) || !(ws > wp) || !(ws < 1)) {
    deviceError("Filter_LPF", "require 0 < 2*fp/sample < 2*fs/sample < 1");
  }
  const T = 2;
  const Wp = (2 / T) * Math.tan(Math.PI * wp / T);
  const Ws = (2 / T) * Math.tan(Math.PI * ws / T);
  const qs = Math.log(Math.pow(10, rs / 10) - 1);
  const qp = Math.log(Math.pow(10, rp / 10) - 1);
  const n = Math.max(1, Math.ceil(0.5 * (qs - qp) / Math.log(Ws / Wp)));
  let Wc = Math.exp(Math.log(Wp) - qp / (2 * n));
  Wc = Math.atan(T / 2 * Wc) * T / Math.PI;
  return { n, Wc };
}

function binom(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
  return result;
}

function complexDiv(a, b) {
  const den = b.re * b.re + b.im * b.im;
  if (!(den > 0)) deviceError("Filter_LPF", "singular bilinear transform");
  return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
}

function realPoly(roots) {
  // Coefficients in descending powers, starting with 1.
  let coeff = [{ re: 1, im: 0 }];
  for (const root of roots) {
    const next = new Array(coeff.length + 1);
    for (let i = 0; i < next.length; i++) next[i] = { re: 0, im: 0 };
    for (let i = 0; i < coeff.length; i++) {
      const c = coeff[i];
      next[i].re += c.re;
      next[i].im += c.im;
      next[i + 1].re += -root.re * c.re + root.im * c.im;
      next[i + 1].im += -root.re * c.im - root.im * c.re;
    }
    coeff = next;
  }
  const out = new Array(coeff.length);
  for (let i = 0; i < coeff.length; i++) out[i] = coeff[i].re;
  return out;
}

// Octave signal-1.3.2 butter.m for a digital low-pass filter.  Wc is
// normalized to Nyquist.  Returns [b,a] with a[0] == 1.
function butterLowpass(n, Wc) {
  if (!(Wc > 0) || !(Wc < 1)) deviceError("Filter_LPF", "butter cutoff must be in (0,1)");
  const analogWc = Math.tan(Math.PI * Wc / 2);
  const poles = new Array(n);
  for (let k = 0; k < n; k++) {
    const angle = Math.PI * (2 * k + n + 1) / (2 * n);
    let pRe = analogWc * Math.cos(angle);
    let pIm = analogWc * Math.sin(angle);
    if (n % 2 === 1 && k === (n - 1) / 2) {
      pRe = -analogWc;
      pIm = 0;
    }
    const z = complexDiv(
      { re: 1 + pRe, im: pIm },
      { re: 1 - pRe, im: -pIm }
    );
    poles[k] = z;
  }
  let a = realPoly(poles);
  const a0 = a[0];
  if (!(Math.abs(a0) > 0)) deviceError("Filter_LPF", "invalid denominator polynomial");
  a = a.map((value) => value / a0);

  const dcDen = a.reduce((sum, value) => sum + value, 0);
  const gain = dcDen / Math.pow(2, n);
  const b = new Array(n + 1);
  for (let k = 0; k <= n; k++) b[k] = gain * binom(n, k);
  return { b, a };
}

function filterRow(input, b, a) {
  const out = new Array(input.length);
  const order = Math.max(b.length, a.length) - 1;
  const z = new Array(Math.max(0, order)).fill(0);
  const a0 = a[0] || 1;
  const bn = b.map((value) => value / a0);
  const an = a.map((value) => value / a0);
  for (let n = 0; n < input.length; n++) {
    const xn = input[n];
    const yn = bn[0] * xn + (order > 0 ? z[0] : 0);
    out[n] = yn;
    for (let i = 0; i < order; i++) {
      const bi = i + 1 < bn.length ? bn[i + 1] : 0;
      const ai = i + 1 < an.length ? an[i + 1] : 0;
      const next = i + 1 < order ? z[i + 1] : 0;
      z[i] = bi * xn - ai * yn + next;
    }
  }
  return out;
}

function solveLinear(A, rhs, label) {
  const n = A.length;
  const m = A.map((row, i) => row.slice().concat(rhs[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const candidate = Math.abs(m[r][col]);
      if (candidate > pivotAbs) {
        pivot = r;
        pivotAbs = candidate;
      }
    }
    if (!(pivotAbs > 1e-12)) deviceError(label, "singular Toeplitz matrix");
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / m[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

const HANDLERS = Object.freeze({
  // Octave: ComUse_AWGN_Comm(datain,db,nsymbol_bit)
  // Real input: awgn(datain,db,'measured'), so the noise variance is the
  // measured mean signal power divided by 10^(db/10).
  // Complex input: sigma = sqrt(norm(datain)^2/nsymbol_bit/(2*10^(db/10)))
  // for both the real and imaginary components, exactly as the Rainier source.
  ComUse_AWGN(args = [], ctx = {}) {
    const db = dsp.toNumber(args[1], 15);
    const nsymbolBit = dsp.toNumber(args[2], 1000);
    if (!Number.isFinite(db)) deviceError("ComUse_AWGN", "db must be finite");
    if (!(nsymbolBit > 0)) deviceError("ComUse_AWGN", "nsymbol_bit must be > 0");
    const rng = typeof ctx.rng === "function" ? ctx.rng : dsp.createRng(0x9e3779b9);
    const snrLinear = Math.pow(10, db / 10);

    if (isComplexSignal(args[0])) {
      const input = asComplex(args[0], "ComUse_AWGN");
      let norm2 = 0;
      for (let i = 0; i < input.re.length; i++) {
        norm2 += input.re[i] * input.re[i] + input.im[i] * input.im[i];
      }
      const signalPower = norm2 / nsymbolBit;
      const sigma = Math.sqrt(signalPower / (2 * snrLinear));
      const re = new Array(input.re.length);
      const im = new Array(input.im.length);
      for (let i = 0; i < re.length; i++) {
        re[i] = input.re[i] + sigma * gaussian(rng);
        im[i] = input.im[i] + sigma * gaussian(rng);
      }
      return complexRows(re, im);
    }

    const input = asFlat(args[0], "ComUse_AWGN");
    if (input.length === 0) return [];
    let power = 0;
    for (const value of input) power += value * value;
    power /= input.length;
    const sigma = Math.sqrt(power / snrLinear);
    const out = new Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] + sigma * gaussian(rng);
    return out;
  },

  // Octave: Filter_LPF_Comm(input,fp,fs,sample)
  // wp=2*fp/sample; ws=2*fs/sample; [N,Wn]=buttord(wp,ws,0.1,20);
  // [b,a]=butter(N,Wn); output=filter(b,a,input).
  Filter_LPF(args = []) {
    const fp = dsp.toNumber(args[1], 30);
    const fs = dsp.toNumber(args[2], 70);
    const sample = dsp.toNumber(args[3], 600);
    if (!(fp > 0)) deviceError("Filter_LPF", "fp must be > 0");
    if (!(fs > fp)) deviceError("Filter_LPF", "fs must be > fp");
    if (!(sample > 0)) deviceError("Filter_LPF", "sample must be > 0");
    const wp = 2 * fp / sample;
    const ws = 2 * fs / sample;
    const spec = buttordLowpass(wp, ws, 0.1, 20);
    const coeff = butterLowpass(spec.n, spec.Wc);

    if (isComplexSignal(args[0])) {
      const input = asComplex(args[0], "Filter_LPF");
      return complexRows(
        filterRow(input.re, coeff.b, coeff.a),
        filterRow(input.im, coeff.b, coeff.a)
      );
    }
    return filterRow(asFlat(args[0], "Filter_LPF"), coeff.b, coeff.a);
  },

  // Octave: Multipath_Fading_Comm(datain,h)
  // dataout = conv(reshape(datain,1,[]), reshape(h,1,[])).
  Multipath_Fading(args = []) {
    const h = parseVector(args[1], DEFAULT_H, "Multipath_Fading");
    if (h.length === 0) deviceError("Multipath_Fading", "h must not be empty");
    if (isComplexSignal(args[0])) {
      return convComplex(asComplex(args[0], "Multipath_Fading"), h);
    }
    return convReal(asFlat(args[0], "Multipath_Fading"), h);
  },

  // Octave: Multipath_Zero_Comm(datain,h,N)
  // The original builds a (2N+1) x (2N+1) Toeplitz system from the
  // symmetrically padded channel, solves X*C=d, and convolves with C.
  Multipath_Zero(args = []) {
    let h = parseVector(args[1], DEFAULT_H, "Multipath_Zero");
    const N = dsp.toInt(args[2], 5);
    if (!(N >= 1) || !Number.isInteger(N)) {
      deviceError("Multipath_Zero", "N must be a positive integer");
    }
    if (h.length === 0) deviceError("Multipath_Zero", "h must not be empty");

    const ones = [];
    for (let i = 0; i < h.length; i++) if (h[i] === 1) ones.push(i);
    if (ones.length !== 1) {
      deviceError("Multipath_Zero", "h must contain exactly one sample equal to 1");
    }

    const H = h.length;
    const mid = ones[0] + 1; // 1-based, as in the Octave source
    if (mid - 1 < H - mid) {
      const pad = (H - mid) - (mid - 1);
      h = new Array(pad).fill(0).concat(h);
    } else {
      const pad = (mid - 1) - (H - mid);
      h = h.concat(new Array(pad).fill(0));
    }

    const k = Math.max(mid - 1, H - mid);
    const x = new Array(4 * N + 1).fill(0);
    if (2 * N >= k) {
      const start1 = 2 * N + 1 - k;
      const end1 = 2 * N + 1 + k;
      const start = start1 - 1;
      const end = end1;
      if (end - start !== h.length) {
        deviceError("Multipath_Zero", "padded channel does not fit the Toeplitz window");
      }
      for (let i = 0; i < h.length; i++) x[start + i] = h[i];
    } else {
      const start = mid - 2 * N - 1;
      const end = mid + 2 * N;
      if (start < 0 || end > h.length || end - start !== 4 * N + 1) {
        deviceError("Multipath_Zero", "channel is too short for N=" + N);
      }
      for (let i = 0; i < x.length; i++) x[i] = h[start + i];
    }

    const X = new Array(2 * N + 1);
    for (let row = 1; row <= 2 * N + 1; row++) {
      X[row - 1] = x.slice(row - 1, 2 * N + row).reverse();
    }
    const d = new Array(2 * N + 1).fill(0);
    d[N] = 1;
    const C = solveLinear(X, d, "Multipath_Zero");

    if (isComplexSignal(args[0])) {
      return convComplex(asComplex(args[0], "Multipath_Zero"), C);
    }
    return convReal(asFlat(args[0], "Multipath_Zero"), C);
  },
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };
