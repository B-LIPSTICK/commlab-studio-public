"use strict";

// ComUse device family for the native JS kernel.
// The handlers are intentionally stateless: Delay is a finite-sample shift and
// Relay hysteresis restarts at the low level for each call.

const dsp = require("../dsp");

const CLASS_INFO = Object.freeze([
  ["ComUse_Adder", 2],
  ["ComUse_Multiplier", 2],
  ["ComUse_Delay", 1],
  ["ComUse_DownSample", 1],
  ["ComUse_Judge", 1],
  ["ComUse_Mod2", 2],
  ["ComUse_OnePass", 2],
  ["ComUse_Rectifier", 1],
  ["ComUse_Relay", 1],
  ["ComUse_Sample", 1],
  ["ComUse_Select", 1],
  ["ComUse_ZeroPass", 2],
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

function isMatrix(value) {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);
}

function asNumber(value, label) {
  const n = dsp.toNumber(value, NaN);
  if (!Number.isFinite(n)) deviceError(label, "expected a numeric value");
  return n;
}

function asFlat(value, label) {
  if (!Array.isArray(value)) deviceError(label, "expected a numeric array");
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    out[i] = asNumber(value[i], label + "[" + i + "]");
  }
  return out;
}

function asMatrix(value, label) {
  if (!isMatrix(value)) deviceError(label, "expected a matrix");
  const cols = value[0].length;
  const out = new Array(value.length);
  for (let r = 0; r < value.length; r++) {
    const row = value[r];
    if (!Array.isArray(row) || row.length !== cols) {
      deviceError(label, "matrix rows must have equal length");
    }
    out[r] = asFlat(row, label + " row " + r);
  }
  return out;
}

function mapSignal(value, fn, label) {
  if (Array.isArray(value)) {
    if (isMatrix(value)) return asMatrix(value, label).map((row) => row.map(fn));
    return asFlat(value, label).map(fn);
  }
  return fn(asNumber(value, label));
}

function binarySignal(a, b, fn, label) {
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (!aArray && !bArray) return fn(asNumber(a, label), asNumber(b, label));
  if (!aArray) {
    const x = asNumber(a, label);
    return mapSignal(b, (y) => fn(x, y), label);
  }
  if (!bArray) {
    const y = asNumber(b, label);
    return mapSignal(a, (x) => fn(x, y), label);
  }

  const aMatrix = isMatrix(a);
  const bMatrix = isMatrix(b);
  if (aMatrix || bMatrix) {
    if (!aMatrix || !bMatrix) deviceError(label, "cannot mix matrix and vector inputs");
    const ma = asMatrix(a, label);
    const mb = asMatrix(b, label);
    if (ma.length !== mb.length || ma[0].length !== mb[0].length) {
      deviceError(label, "matrix shapes differ");
    }
    return ma.map((row, r) => row.map((x, c) => fn(x, mb[r][c])));
  }

  const va = asFlat(a, label);
  const vb = asFlat(b, label);
  if (va.length !== vb.length) {
    deviceError(label, "vector lengths differ (" + va.length + " vs " + vb.length + ")");
  }
  return va.map((x, i) => fn(x, vb[i]));
}

function eachRow(value, label, fn) {
  if (isMatrix(value)) return asMatrix(value, label).map(fn);
  return fn(asFlat(value, label));
}

function delayRow(row, delay) {
  const out = new Array(row.length).fill(0);
  for (let i = delay; i < row.length; i++) out[i] = row[i - delay];
  return out;
}

function downsampleRow(row, factor) {
  const out = [];
  for (let i = 0; i < row.length; i += factor) out.push(row[i]);
  return out;
}

function judgeRow(row, blockLength, threshold) {
  // Octave ComUse_Judge_Comm: threshold=(max+min)/2, decide on the middle
  // sample of each block (datain(i+L/2)), then hold the bit for the block.
  let min = Infinity, max = -Infinity;
  for (const v of row) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mid = (max + min) / 2;
  const out = new Array(row.length);
  for (let start = 0; start < row.length; start += blockLength) {
    const end = Math.min(start + blockLength, row.length);
    const idx = Math.min(row.length - 1, start + Math.floor(blockLength / 2));
    const bit = row[idx] > mid ? 1 : 0;
    for (let i = start; i < end; i++) out[i] = bit;
  }
  return out;
}

function gateRow(control, signal, blockLength, passHigh) {
  if (control.length !== signal.length) {
    deviceError("OnePass/ZeroPass", "control and signal lengths differ");
  }
  const out = new Array(signal.length);
  for (let start = 0; start < signal.length; start += blockLength) {
    const end = Math.min(start + blockLength, signal.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += control[i];
    const high = sum / (end - start) > 0.5;
    const pass = passHigh ? high : !high;
    for (let i = start; i < end; i++) out[i] = pass ? signal[i] : 0;
  }
  return out;
}

function gateSignal(control, signal, blockLength, passHigh, label) {
  if (!Array.isArray(control) || !Array.isArray(signal)) {
    deviceError(label, "both inputs must be arrays");
  }
  if (isMatrix(control) || isMatrix(signal)) {
    if (!isMatrix(control) || !isMatrix(signal)) {
      deviceError(label, "cannot mix matrix and vector inputs");
    }
    const mc = asMatrix(control, label);
    const ms = asMatrix(signal, label);
    if (mc.length !== ms.length || mc[0].length !== ms[0].length) {
      deviceError(label, "matrix shapes differ");
    }
    return mc.map((row, r) => gateRow(row, ms[r], blockLength, passHigh));
  }
  return gateRow(asFlat(control, label), asFlat(signal, label), blockLength, passHigh);
}

function relayRow(row, on, off, high, low) {
  const out = new Array(row.length);
  let previous = low;
  for (let i = 0; i < row.length; i++) {
    const x = row[i];
    let y;
    if (x >= on) y = high;
    else if (x <= off) y = low;
    else y = previous;
    out[i] = y;
    previous = y;
  }
  return out;
}

function checkBlockLength(value, fallback, label) {
  const n = Math.trunc(dsp.toNumber(value, fallback));
  if (!(n >= 1)) deviceError(label, "block length must be >= 1");
  return n;
}

function resampleMultiplyRow(a, b) {
  const n1 = a.length, n2 = b.length;
  if (n1 === n2) return a.map((x, i) => x * b[i]);
  const m1 = Math.round(n2 / n1), m2 = Math.round(n1 / n2);
  if (m1 >= 1) {
    const out = new Array(n1).fill(0);
    for (let i = 0; i < n1; i++) {
      const k = m1 * (i + 1);
      if (k < n2) out[i] = a[i] * b[k - 1];
    }
    return out;
  }
  if (m2 >= 1) {
    const out = new Array(n2).fill(0);
    for (let i = 0; i < n2; i++) {
      const k = m2 * (i + 1);
      if (k < n1) out[i] = a[k - 1] * b[i];
    }
    return out;
  }
  const n = Math.min(n1, n2);
  return Array.from({ length: n }, (_, i) => a[i] * b[i]);
}

function multiplyResampled(a, b, label) {
  if (!Array.isArray(a) && !Array.isArray(b)) return asNumber(a, label) * asNumber(b, label);
  if (!Array.isArray(a)) {
    const x = asNumber(a, label);
    return mapSignal(b, (y) => x * y, label);
  }
  if (!Array.isArray(b)) {
    const y = asNumber(b, label);
    return mapSignal(a, (x) => x * y, label);
  }
  const aMatrix = isMatrix(a), bMatrix = isMatrix(b);
  if (aMatrix && bMatrix) {
    const ma = asMatrix(a, label), mb = asMatrix(b, label);
    if (ma.length !== mb.length) deviceError(label, "matrix row counts differ");
    return ma.map((row, r) => resampleMultiplyRow(row, mb[r]));
  }
  if (aMatrix) {
    const vb = asFlat(b, label);
    return asMatrix(a, label).map((row) => resampleMultiplyRow(row, vb));
  }
  if (bMatrix) {
    const va = asFlat(a, label);
    return asMatrix(b, label).map((row) => resampleMultiplyRow(va, row));
  }
  return resampleMultiplyRow(asFlat(a, label), asFlat(b, label));
}

const HANDLERS = Object.freeze({
  ComUse_Adder(args = []) {
    return binarySignal(args[0], args[1], (a, b) => a + b, "ComUse_Adder");
  },

  ComUse_Multiplier(args = []) {
    return multiplyResampled(args[0], args[1], "ComUse_Multiplier");
  },

  ComUse_Delay(args = []) {
    const delay = Math.trunc(dsp.toNumber(args[1], 64));
    if (delay < 0) deviceError("ComUse_Delay", "delaytime must be >= 0");
    return eachRow(args[0], "ComUse_Delay", (row) => delayRow(row, delay));
  },

  ComUse_DownSample(args = []) {
    const factor = Math.trunc(dsp.toNumber(args[1], 16));
    if (!(factor >= 1)) deviceError("ComUse_DownSample", "nsamp must be >= 1");
    return eachRow(args[0], "ComUse_DownSample", (row) => downsampleRow(row, factor));
  },

  ComUse_Judge(args = []) {
    const blockLength = checkBlockLength(args[1], 64, "ComUse_Judge");
    return eachRow(args[0], "ComUse_Judge", (row) => judgeRow(row, blockLength));
  },

  ComUse_Mod2(args = []) {
    checkBlockLength(args[2], 64, "ComUse_Mod2");
    return binarySignal(args[0], args[1], (a, b) => {
      const value = (a + b) % 2;
      return value < 0 ? value + 2 : value;
    }, "ComUse_Mod2");
  },

  ComUse_OnePass(args = []) {
    const blockLength = checkBlockLength(args[2], 64, "ComUse_OnePass");
    return gateSignal(args[0], args[1], blockLength, true, "ComUse_OnePass");
  },

  ComUse_Rectifier(args = []) {
    const mode = String(dsp.toText(args[1], "full")).toLowerCase();
    const half = mode === "half" || mode === "halfwave" || mode === "half-wave" || mode === "半波";
    return mapSignal(args[0], half ? (x) => Math.max(x, 0) : (x) => Math.abs(x), "ComUse_Rectifier");
  },

  ComUse_Relay(args = []) {
    const on = dsp.toNumber(args[1], 0.5);
    const off = dsp.toNumber(args[2], 0.49);
    const high = dsp.toNumber(args[3], 1);
    const low = dsp.toNumber(args[4], 0);
    return eachRow(args[0], "ComUse_Relay", (row) => relayRow(row, on, off, high, low));
  },

  // ComUse_Sample is built into index.js.  Its alias and port count are
  // declared above, but the handler is intentionally not registered here:
  // the device registry rejects duplicate canonical handlers.

  ComUse_Select(args = []) {
    const row = Math.trunc(dsp.toNumber(args[1], 1));
    if (!(row >= 1)) deviceError("ComUse_Select", "row must be >= 1");
    if (isMatrix(args[0])) {
      const matrix = asMatrix(args[0], "ComUse_Select");
      if (row > matrix.length) {
        deviceError("ComUse_Select", "row " + row + " exceeds matrix rows " + matrix.length);
      }
      return matrix[row - 1].slice();
    }
    if (row !== 1) deviceError("ComUse_Select", "row " + row + " is invalid for a vector input");
    return asFlat(args[0], "ComUse_Select");
  },

  ComUse_ZeroPass(args = []) {
    const blockLength = checkBlockLength(args[2], 64, "ComUse_ZeroPass");
    return gateSignal(args[0], args[1], blockLength, false, "ComUse_ZeroPass");
  },
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };