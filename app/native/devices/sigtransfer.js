"use strict";

// SigTransfer device family for the native JS kernel.
// Binary grouping is MSB-first.  HexTransform groups by sqrt(M) as the
// platform's "2-4" / 16-QAM converter does.

const dsp = require("../dsp");

const CLASS_INFO = Object.freeze([
  ["SigTransfer_Bi2toM", 1],
  ["SigTransfer_HexTransform", 1],
  ["SigTransfer_Hilbert", 1],
  ["SigTransfer_MultiJudge", 1],
  ["SigTransfer_PSTransform", 2],
  ["SigTransfer_ParalleData", 1],
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

function deviceError(label, message) {
  throw new Error("native devices (" + label + "): " + message);
}

function asVector(value, label) {
  if (!Array.isArray(value) || (value.length > 0 && Array.isArray(value[0]))) {
    deviceError(label, "expected a 1-D numeric array");
  }
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = dsp.toNumber(value[i], NaN);
    if (!Number.isFinite(n)) deviceError(label, "sample " + i + " is not numeric");
    out[i] = n;
  }
  return out;
}

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function exactLog2(n, label) {
  const k = Math.log2(n);
  if (!Number.isInteger(k)) deviceError(label, n + " is not a power of two");
  return k;
}

function toBit(value) {
  return value >= 0.5 ? 1 : 0;
}

function groupBits(value, bitsPerSymbol, label) {
  const bits = asVector(value, label);
  if (!(bitsPerSymbol >= 1) || !Number.isInteger(bitsPerSymbol)) {
    deviceError(label, "bits per symbol must be a positive integer");
  }
  if (bits.length % bitsPerSymbol !== 0) {
    deviceError(label, "input length " + bits.length + " is not divisible by " + bitsPerSymbol);
  }
  const out = new Array(bits.length / bitsPerSymbol);
  for (let start = 0; start < bits.length; start += bitsPerSymbol) {
    let symbol = 0;
    for (let j = 0; j < bitsPerSymbol; j++) {
      symbol = symbol * 2 + toBit(bits[start + j]);
    }
    out[start / bitsPerSymbol] = symbol;
  }
  return out;
}

function blockMean(row, start, length) {
  let sum = 0;
  for (let i = start; i < start + length; i++) sum += row[i];
  return sum / length;
}

function hilbertTransform(value, label) {
  const x = asVector(value, label);
  const n = x.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const spectrum = dsp.fft(x, new Array(n).fill(0));
  const h = new Array(n).fill(0);
  const half = Math.floor(n / 2);
  for (let k = 1; k <= half; k++) {
    h[k] = n % 2 === 0 && k === n / 2 ? 1 : 2;
  }

  const zRe = new Array(n);
  const zIm = new Array(n);
  for (let k = 0; k < n; k++) {
    zRe[k] = spectrum.re[k] * h[k];
    zIm[k] = spectrum.im[k] * h[k];
  }

  // IFFT(Z) = conj(FFT(conj(Z))) / N.  The imaginary part is the real
  // Hilbert transform used by the platform's SSB device.
  const back = dsp.fft(zRe, zIm.map((v) => -v));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = -back.im[i] / n;
  return out;
}

function multiJudge(value, blockLength, label) {
  const data = asVector(value, label);
  if (!(blockLength >= 2) || blockLength % 2 !== 0) {
    deviceError(label, "L must be an even integer >= 2");
  }
  if (data.length % blockLength !== 0) {
    deviceError(label, "input length " + data.length + " is not divisible by L=" + blockLength);
  }

  const out = new Array(data.length);
  const half = blockLength / 2;
  for (let start = 0; start < data.length; start += blockLength) {
    const mean = blockMean(data, start, blockLength);
    let level = Math.round(mean);
    if (level < 0) level = 0;
    if (level > 3) level = 3;
    const msb = level >> 1;
    const lsb = level & 1;
    for (let j = 0; j < half; j++) out[start + j] = msb;
    for (let j = 0; j < half; j++) out[start + half + j] = lsb;
  }
  return out;
}

function psTransform(a, b, blockLength, label) {
  const first = asVector(a, label + " st1");
  const second = asVector(b, label + " st2");
  if (first.length !== second.length) {
    deviceError(label, "st1 and st2 lengths differ (" + first.length + " vs " + second.length + ")");
  }
  if (!(blockLength >= 2) || blockLength % 2 !== 0) {
    deviceError(label, "L must be an even integer >= 2");
  }
  if (first.length % blockLength !== 0) {
    deviceError(label, "input length " + first.length + " is not divisible by L=" + blockLength);
  }

  const out = new Array(first.length);
  const half = blockLength / 2;
  for (let start = 0; start < first.length; start += blockLength) {
    const bit1 = blockMean(first, start, blockLength) > 0.5 ? 1 : 0;
    const bit2 = blockMean(second, start, blockLength) > 0.5 ? 1 : 0;
    for (let j = 0; j < half; j++) out[start + j] = bit1;
    for (let j = 0; j < half; j++) out[start + half + j] = bit2;
  }
  return out;
}

function parallelData(value, rows, label) {
  const data = asVector(value, label);
  if (!(rows >= 1) || !Number.isInteger(rows)) {
    deviceError(label, "row must be a positive integer");
  }
  if (data.length % rows !== 0) {
    deviceError(label, "input length " + data.length + " is not divisible by row=" + rows);
  }
  const out = Array.from({ length: rows }, () => []);
  for (let i = 0; i < data.length; i++) out[i % rows].push(data[i]);
  return out;
}

const HANDLERS = Object.freeze({
  SigTransfer_Bi2toM(args = []) {
    const m = Math.trunc(dsp.toNumber(args[1], 4));
    if (!(m >= 2) || !isPowerOfTwo(m)) {
      deviceError("SigTransfer_Bi2toM", "M must be a power of two >= 2");
    }
    return groupBits(args[0], exactLog2(m, "SigTransfer_Bi2toM"), "SigTransfer_Bi2toM");
  },

  SigTransfer_HexTransform(args = []) {
    const m = Math.trunc(dsp.toNumber(args[1], 16));
    const radix = Math.sqrt(m);
    if (!(m >= 2) || !Number.isInteger(radix) || !isPowerOfTwo(radix)) {
      deviceError("SigTransfer_HexTransform", "M must be a square of a power of two (e.g. 4, 16, 64)");
    }
    return groupBits(args[0], exactLog2(radix, "SigTransfer_HexTransform"), "SigTransfer_HexTransform");
  },

  SigTransfer_Hilbert(args = []) {
    return hilbertTransform(args[0], "SigTransfer_Hilbert");
  },

  SigTransfer_MultiJudge(args = []) {
    const blockLength = Math.trunc(dsp.toNumber(args[1], 64));
    return multiJudge(args[0], blockLength, "SigTransfer_MultiJudge");
  },

  SigTransfer_PSTransform(args = []) {
    const blockLength = Math.trunc(dsp.toNumber(args[2], 64));
    return psTransform(args[0], args[1], blockLength, "SigTransfer_PSTransform");
  },

  SigTransfer_ParalleData(args = []) {
    const rows = Math.trunc(dsp.toNumber(args[1], 2));
    return parallelData(args[0], rows, "SigTransfer_ParalleData");
  },
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };