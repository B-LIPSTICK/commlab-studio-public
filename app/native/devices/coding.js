"use strict";

// Source/channel coding devices for the CommLab native kernel.
//
// The DeltaM, Hamming and convolutional-code implementations follow the
// RainierCommunicationCoding Octave sources used by the experiments.  The
// public contract is ALIASES / INPUT_COUNTS / HANDLERS.

const dsp = require("../dsp");

const CLASS_INFO = Object.freeze([
  ["SourceCoding_DeltaMPredict", 1],
  ["SourceCoding_DeltaMCoding", 2],
  ["SourceCoding_DeltaMDecoding", 1],
  ["ChannalCoding_HammingEncode", 1],
  ["ChannalCoding_HammingDecode", 1],
  ["ChannalCoding_ConvEncode", 1],
  ["ChannalCoding_ConvDecode", 1],
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

function toBit(value, label, index) {
  const n = dsp.toNumber(value, NaN);
  if (!Number.isFinite(n)) deviceError(label, "bit " + index + " is not numeric");
  return n >= 0.5 ? 1 : 0;
}

function deltaMPredict(args = []) {
  const data = asVector(args[0], "SourceCoding_DeltaMPredict");
  const delta = dsp.toNumber(args[1], 0.5);
  if (!(delta >= 0)) deviceError("SourceCoding_DeltaMPredict", "delta must be >= 0");
  if (data.length === 0) return [];
  const out = new Array(data.length);
  out[0] = data[0] > 0 ? delta : 0;
  for (let k = 1; k < data.length; k++) {
    const error = data[k] - out[k - 1];
    out[k] = out[k - 1] + (error >= 0 ? delta : -delta);
  }
  return out;
}

function deltaMCoding(args = []) {
  const data = asVector(args[0], "SourceCoding_DeltaMCoding input 1");
  const predicted = asVector(args[1], "SourceCoding_DeltaMCoding input 2");
  if (data.length !== predicted.length) {
    deviceError("SourceCoding_DeltaMCoding", "input and prediction lengths differ");
  }
  if (data.length === 0) return [];
  const out = new Array(data.length);
  out[0] = data[0] > 0 ? 1 : 0;
  for (let k = 1; k < data.length; k++) {
    const error = data[k] - predicted[k - 1];
    out[k] = error >= 0 ? 1 : 0;
  }
  return out;
}

function deltaMDecoding(args = []) {
  const bits = asVector(args[0], "SourceCoding_DeltaMDecoding");
  const delta = dsp.toNumber(args[1], 0.5);
  if (!(delta >= 0)) deviceError("SourceCoding_DeltaMDecoding", "delta must be >= 0");
  if (bits.length === 0) return [];
  const out = new Array(bits.length);
  out[0] = toBit(bits[0], "SourceCoding_DeltaMDecoding", 0) === 1 ? delta : 0;
  for (let k = 1; k < bits.length; k++) {
    out[k] = out[k - 1] + (toBit(bits[k], "SourceCoding_DeltaMDecoding", k) === 1 ? delta : -delta);
  }
  return out;
}

// Generator/parity-check matrices used by the bundled communications-1.2.1
// hammgen(3).  Keeping this exact ordering preserves the Rainier bit stream.
const HAMMING_G = Object.freeze([
  Object.freeze([1, 1, 0, 1, 0, 0, 0]),
  Object.freeze([0, 1, 1, 0, 1, 0, 0]),
  Object.freeze([1, 1, 1, 0, 0, 1, 0]),
  Object.freeze([1, 0, 1, 0, 0, 0, 1]),
]);

const HAMMING_H = Object.freeze([
  Object.freeze([1, 0, 0, 1, 0, 1, 1]),
  Object.freeze([0, 1, 0, 1, 1, 1, 0]),
  Object.freeze([0, 0, 1, 0, 1, 1, 1]),
]);

function validateHamming(n, k) {
  if (n !== 7 || k !== 4) {
    deviceError("Hamming", "only the (7,4) Hamming code is supported (got " + n + "," + k + ")");
  }
}

function hammingEncodeBlock(message) {
  const out = new Array(7).fill(0);
  for (let row = 0; row < 4; row++) {
    if (message[row] !== 1) continue;
    for (let col = 0; col < 7; col++) out[col] ^= HAMMING_G[row][col];
  }
  return out;
}

const HAMMING_CODEWORD_TO_MESSAGE = new Map();
for (let mask = 0; mask < 16; mask++) {
  const message = [(mask >> 3) & 1, (mask >> 2) & 1, (mask >> 1) & 1, mask & 1];
  HAMMING_CODEWORD_TO_MESSAGE.set(hammingEncodeBlock(message).join(""), message);
}

const HAMMING_SYNDROME_TO_POSITION = new Map();
for (let col = 0; col < 7; col++) {
  const syndrome = [HAMMING_H[0][col], HAMMING_H[1][col], HAMMING_H[2][col]];
  HAMMING_SYNDROME_TO_POSITION.set(syndrome.join(""), col);
}

function hammingDecodeBlock(received) {
  const corrected = received.slice();
  const syndrome = [0, 0, 0];
  for (let row = 0; row < 3; row++) {
    let value = 0;
    for (let col = 0; col < 7; col++) value ^= HAMMING_H[row][col] & corrected[col];
    syndrome[row] = value;
  }
  if (syndrome[0] || syndrome[1] || syndrome[2]) {
    const position = HAMMING_SYNDROME_TO_POSITION.get(syndrome.join(""));
    if (position != null) corrected[position] ^= 1;
  }

  const exact = HAMMING_CODEWORD_TO_MESSAGE.get(corrected.join(""));
  if (exact) return exact.slice();

  // A double error can leave a non-codeword after single-error correction.
  // Pick the nearest codeword so the device still returns k bits.
  let best = null;
  let bestDistance = Infinity;
  for (const [key, message] of HAMMING_CODEWORD_TO_MESSAGE) {
    let distance = 0;
    for (let i = 0; i < 7; i++) distance += key.charCodeAt(i) === corrected[i] + 48 ? 0 : 1;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = message;
    }
  }
  return best.slice();
}

function hammingEncode(args = []) {
  const bits = asVector(args[0], "ChannalCoding_HammingEncode");
  const n = dsp.toInt(args[1], 7);
  const k = dsp.toInt(args[2], 4);
  validateHamming(n, k);
  if (bits.length % k !== 0) {
    deviceError("ChannalCoding_HammingEncode", "input length must be a multiple of k=" + k);
  }
  const out = [];
  for (let start = 0; start < bits.length; start += k) {
    const message = [];
    for (let j = 0; j < k; j++) message.push(toBit(bits[start + j], "ChannalCoding_HammingEncode", start + j));
    out.push(...hammingEncodeBlock(message));
  }
  return out;
}

function hammingDecode(args = []) {
  const bits = asVector(args[0], "ChannalCoding_HammingDecode");
  const n = dsp.toInt(args[1], 7);
  const k = dsp.toInt(args[2], 4);
  validateHamming(n, k);
  if (bits.length % n !== 0) {
    deviceError("ChannalCoding_HammingDecode", "input length must be a multiple of n=" + n);
  }
  const out = [];
  for (let start = 0; start < bits.length; start += n) {
    const received = [];
    for (let j = 0; j < n; j++) received.push(toBit(bits[start + j], "ChannalCoding_HammingDecode", start + j));
    out.push(...hammingDecodeBlock(received));
  }
  return out;
}

function parseGeneratorPolynomials(value, label) {
  let items;
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string") {
    const text = value.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/,/g, " ");
    items = text.split(/\s+/).filter(Boolean);
  } else if (value == null || value === "") {
    items = ["171", "133"];
  } else {
    items = [value];
  }
  if (items.length !== 2) {
    deviceError(label, "expected two octal generator polynomials, e.g. [171 133]");
  }
  return items.map((item, index) => {
    const text = String(item).trim().replace(/^0o/i, "");
    if (/^[0-7]+$/.test(text)) return parseInt(text, 8);
    const number = Number(text);
    if (!Number.isInteger(number) || number < 0) {
      deviceError(label, "generator " + (index + 1) + " is not an octal integer");
    }
    return number;
  });
}

function convolutionalParameters(args, label) {
  const K = dsp.toInt(args[1], 7);
  if (!(K >= 2 && K <= 12)) deviceError(label, "constraint length K must be in [2,12]");
  const generators = parseGeneratorPolynomials(args[2], label);
  const polynomials = generators.map((generator, index) => {
    const binary = generator.toString(2);
    if (binary.length > K) {
      deviceError(label, "generator " + (index + 1) + " does not fit K=" + K);
    }
    return binary.padStart(K, "0").split("").map(Number);
  });
  return { K, polynomials };
}

function convolutionEncode(args = []) {
  const bits = asVector(args[0], "ChannalCoding_ConvEncode");
  const { K, polynomials } = convolutionalParameters(args, "ChannalCoding_ConvEncode");
  const input = bits.map((value, index) => toBit(value, "ChannalCoding_ConvEncode", index));
  const sequence = input.concat(new Array(K - 1).fill(0));
  const register = new Array(K).fill(0);
  const out = [];
  for (const bit of sequence) {
    for (let i = K - 1; i > 0; i--) register[i] = register[i - 1];
    register[0] = bit;
    for (const polynomial of polynomials) {
      let parity = 0;
      for (let i = 0; i < K; i++) parity ^= polynomial[i] & register[i];
      out.push(parity);
    }
  }
  return out;
}

function convolutionDecode(args = []) {
  const coded = asVector(args[0], "ChannalCoding_ConvDecode");
  const { K, polynomials } = convolutionalParameters(args, "ChannalCoding_ConvDecode");
  const outputCount = polynomials.length;
  if (coded.length % outputCount !== 0) {
    deviceError("ChannalCoding_ConvDecode", "input length must be a multiple of the code rate denominator");
  }
  const depth = coded.length / outputCount;
  const tail = K - 1;
  if (depth < tail) {
    deviceError("ChannalCoding_ConvDecode", "encoded input is shorter than the K-1 tail");
  }
  const inputLength = depth - tail;
  const states = 1 << tail;
  const nextState = Array.from({ length: states }, () => [0, 0]);
  const branchOutput = Array.from({ length: states }, () => [[], []]);

  for (let state = 0; state < states; state++) {
    for (let input = 0; input < 2; input++) {
      const register = [input];
      for (let i = 0; i < tail; i++) register.push((state >> i) & 1);
      nextState[state][input] = input | ((state & ((1 << (tail - 1)) - 1)) << 1);
      branchOutput[state][input] = polynomials.map((polynomial) => {
        let parity = 0;
        for (let i = 0; i < K; i++) parity ^= polynomial[i] & register[i];
        return parity;
      });
    }
  }

  const received = coded.map((value, index) => toBit(value, "ChannalCoding_ConvDecode", index));
  const metric = new Array(states).fill(Infinity);
  metric[0] = 0;
  const previousState = Array.from({ length: depth }, () => new Int32Array(states).fill(-1));
  const previousBit = Array.from({ length: depth }, () => new Int8Array(states).fill(-1));

  for (let time = 0; time < depth; time++) {
    const nextMetric = new Array(states).fill(Infinity);
    for (let state = 0; state < states; state++) {
      const base = metric[state];
      if (!Number.isFinite(base)) continue;
      for (let input = 0; input < 2; input++) {
        const target = nextState[state][input];
        const expected = branchOutput[state][input];
        let distance = 0;
        for (let j = 0; j < outputCount; j++) {
          if (expected[j] !== received[time * outputCount + j]) distance += 1;
        }
        const candidate = base + distance;
        if (candidate < nextMetric[target]) {
          nextMetric[target] = candidate;
          previousState[time][target] = state;
          previousBit[time][target] = input;
        }
      }
    }
    for (let state = 0; state < states; state++) metric[state] = nextMetric[state];
  }

  let state = 0;
  if (!Number.isFinite(metric[state])) {
    let best = 0;
    for (let i = 1; i < states; i++) if (metric[i] < metric[best]) best = i;
    state = best;
  }

  const decoded = new Array(depth);
  for (let time = depth - 1; time >= 0; time--) {
    decoded[time] = previousBit[time][state];
    state = previousState[time][state];
  }
  return decoded.slice(0, inputLength);
}

const HANDLERS = Object.freeze({
  SourceCoding_DeltaMPredict: deltaMPredict,
  SourceCoding_DeltaMCoding: deltaMCoding,
  SourceCoding_DeltaMDecoding: deltaMDecoding,
  ChannalCoding_HammingEncode: hammingEncode,
  ChannalCoding_HammingDecode: hammingDecode,
  ChannalCoding_ConvEncode: convolutionEncode,
  ChannalCoding_ConvDecode: convolutionDecode,
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };