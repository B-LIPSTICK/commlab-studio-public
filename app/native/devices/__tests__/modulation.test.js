"use strict";

const assert = require("node:assert/strict");
const dsp = require("../../dsp");
const native = require("../../index");
const modulation = require("../modulation");
const channel = require("../channel");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok " + passed + " - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function run(module, name, args, ctx) {
  const handler = module.HANDLERS[name];
  assert.equal(typeof handler, "function", "missing handler " + name);
  return handler(args, ctx || { rng: dsp.createRng(12345), log: [] });
}

function close(actual, expected, epsilon, message) {
  const tolerance = epsilon == null ? 1e-9 : epsilon;
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    (message || "value") + ": expected " + expected + ", got " + actual
  );
}

function complexRows(value) {
  assert.ok(Array.isArray(value) && value.length === 2, "expected [re;im] complex rows");
  assert.equal(value[0].length, value[1].length, "complex row lengths differ");
  return value;
}

function complexAbs(value, index) {
  const rows = complexRows(value);
  return Math.hypot(rows[0][index], rows[1][index]);
}

function ber(expected, actual) {
  assert.equal(expected.length, actual.length, "BER inputs differ in length");
  let errors = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) errors += 1;
  }
  return errors / expected.length;
}

function variance(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let sum = 0;
  for (const value of values) sum += (value - mean) * (value - mean);
  return sum / values.length;
}

test("module contracts, aliases, and native registry", () => {
  const names = [
    "Modulation_Freq",
    "Modulation_Phrase",
    "Modulation_FskMod",
    "Modulation_FskDemod",
    "Modulation_PskMod",
    "Modulation_PskDemod",
    "Modulation_QamMod",
    "Discriminator_EnvelopDetector",
    "Discriminator_Freq",
  ];
  for (const name of names) {
    assert.equal(modulation.ALIASES[name], name);
    assert.equal(modulation.ALIASES[name + "_Comm"], name);
    assert.equal(modulation.INPUT_COUNTS[name], 1);
    assert.equal(typeof modulation.HANDLERS[name], "function");
    assert.ok(native.SUPPORTED_CLASSES.includes(name), "registry missing " + name);
  }
  for (const name of ["ComUse_AWGN", "Filter_LPF", "Multipath_Fading", "Multipath_Zero"]) {
    assert.equal(channel.ALIASES[name], name);
    assert.equal(channel.ALIASES[name + "_Comm"], name);
    assert.equal(channel.INPUT_COUNTS[name], 1);
    assert.equal(typeof channel.HANDLERS[name], "function");
    assert.ok(native.SUPPORTED_CLASSES.includes(name), "registry missing " + name);
  }
  assert.equal(native.canonicalClass("Modulation_Freq_Comm"), "Modulation_Freq");
  assert.equal(native.DEVICE_WARNINGS.length, 0);
});

test("Modulation_Freq and Modulation_Phrase use the Rainier time axis", () => {
  const fm = run(modulation, "Modulation_Freq", [[1, 1, 1, 1], 1, 0, 1, 4 / 100, 100]);
  assert.equal(fm.length, 4);
  close(fm[0], 1, 1e-12);
  close(fm[1], Math.cos(2 * Math.PI / 100), 1e-12);
  close(fm[2], Math.cos(4 * Math.PI / 100), 1e-12);

  const pm = run(modulation, "Modulation_Phrase", [[0, 1], 1, 0, Math.PI / 2, 2 / 100, 100]);
  assert.equal(pm.length, 2);
  close(pm[0], 1, 1e-12);
  close(pm[1], 0, 1e-12);

  const fmAmplitude = run(modulation, "Modulation_Freq", [[0.5, -0.5, 1, -1], 2, 20, 5, 0.1, 100]);
  assert.equal(fmAmplitude.length, 4);
  assert.ok(fmAmplitude.every((value) => Math.abs(value) <= 2 + 1e-12));
});

test("2FSK modulation has constant modulus and demodulates both phase modes", () => {
  const bits = [1, 0, 1, 1, 0, 0, 1, 0];
  for (const phase of ["cont", "discont"]) {
    const wave = run(modulation, "Modulation_FskMod", [bits, 8, 8, 16, phase]);
    complexRows(wave);
    assert.equal(wave[0].length, bits.length * 8);
    for (let i = 0; i < wave[0].length; i++) close(complexAbs(wave, i), 1, 1e-12);
    const decoded = run(modulation, "Modulation_FskDemod", [wave, 8, 8, 16]);
    assert.deepEqual(decoded, bits);
  }

  // A non-integer number of carrier cycles per symbol exercises the general
  // discontinuous-phase oscillator branch in fskmod.m.
  const general = run(modulation, "Modulation_FskMod", [bits, 5, 8, 16, "discont"]);
  const decodedGeneral = run(modulation, "Modulation_FskDemod", [general, 5, 8, 16]);
  assert.deepEqual(decodedGeneral, bits);
});

test("2FSK BER decreases with increasing SNR", () => {
  const bits = [];
  const rng = dsp.createRng(2026);
  for (let i = 0; i < 512; i++) bits.push(rng() < 0.5 ? 0 : 1);
  const wave = run(modulation, "Modulation_FskMod", [bits, 8, 8, 16, "cont"]);

  const low = run(channel, "ComUse_AWGN", [wave, 0, bits.length], { rng: dsp.createRng(11), log: [] });
  const high = run(channel, "ComUse_AWGN", [wave, 20, bits.length], { rng: dsp.createRng(11), log: [] });
  const lowBer = ber(bits, run(modulation, "Modulation_FskDemod", [low, 8, 8, 16]));
  const highBer = ber(bits, run(modulation, "Modulation_FskDemod", [high, 8, 8, 16]));
  assert.ok(lowBer > highBer, "BER should fall with SNR: " + lowBer + " vs " + highBer);
  assert.ok(highBer < 0.01, "20 dB FSK BER is unexpectedly high: " + highBer);
});

test("M-PSK Gray mapping, unit constellation, and noiseless round trip", () => {
  const gray4 = run(modulation, "Modulation_PskMod", [[0, 1, 2, 3], 4]);
  complexRows(gray4);
  close(gray4[0][0], 1, 1e-12);
  close(gray4[1][0], 0, 1e-12);
  close(gray4[0][1], 0, 1e-12);
  close(gray4[1][1], 1, 1e-12);
  close(gray4[0][2], 0, 1e-12);
  close(gray4[1][2], -1, 1e-12);
  close(gray4[0][3], -1, 1e-12);
  close(gray4[1][3], 0, 1e-12);

  for (const M of [2, 4, 8, 16, 32, 64]) {
    const symbols = [];
    for (let i = 0; i < 3 * M; i++) symbols.push(i % M);
    const wave = run(modulation, "Modulation_PskMod", [symbols, M]);
    assert.equal(wave[0].length, symbols.length);
    for (let i = 0; i < symbols.length; i++) close(complexAbs(wave, i), 1, 1e-12);
    const decoded = run(modulation, "Modulation_PskDemod", [wave, M]);
    assert.deepEqual(decoded, symbols, "M=" + M + " round trip");
  }
});

test("M-PSK BER decreases with increasing SNR", () => {
  const symbols = [];
  for (let i = 0; i < 2048; i++) symbols.push(i % 4);
  const wave = run(modulation, "Modulation_PskMod", [symbols, 4]);
  const low = run(channel, "ComUse_AWGN", [wave, 6, symbols.length], { rng: dsp.createRng(77), log: [] });
  const high = run(channel, "ComUse_AWGN", [wave, 20, symbols.length], { rng: dsp.createRng(77), log: [] });
  const lowBer = ber(symbols, run(modulation, "Modulation_PskDemod", [low, 4]));
  const highBer = ber(symbols, run(modulation, "Modulation_PskDemod", [high, 4]));
  assert.ok(lowBer > highBer, "PSK BER should fall with SNR: " + lowBer + " vs " + highBer);
  assert.ok(highBer < 0.01, "20 dB PSK BER is unexpectedly high: " + highBer);
});

test("QAM uses the Octave odd-integer square constellation", () => {
  const qam4 = run(modulation, "Modulation_QamMod", [[0, 1, 2, 3], 4]);
  complexRows(qam4);
  assert.deepEqual(qam4, [
    [-1, -1, 1, 1],
    [1, -1, -1, 1],
  ]);

  const symbols16 = Array.from({ length: 16 }, (_, i) => i);
  const qam16 = run(modulation, "Modulation_QamMod", [symbols16, 16]);
  const points = new Set();
  for (let i = 0; i < symbols16.length; i++) {
    const re = qam16[0][i];
    const im = qam16[1][i];
    assert.ok(Number.isInteger(re) && Math.abs(re) % 2 === 1, "I must be an odd integer");
    assert.ok(Number.isInteger(im) && Math.abs(im) % 2 === 1, "Q must be an odd integer");
    assert.ok(Math.abs(re) <= 7 && Math.abs(im) <= 7);
    points.add(re + "," + im);
  }
  assert.equal(points.size, 16);

  const qam64 = run(modulation, "Modulation_QamMod", [[35], 64]);
  assert.equal(qam64[0][0], 1);
  assert.equal(qam64[1][0], 1);
  assert.throws(() => run(modulation, "Modulation_QamMod", [[0], 8]), /qammod|M_ary/);
});

test("Discriminator_Freq is the first difference and envelope is |hilbert|", () => {
  assert.deepEqual(run(modulation, "Discriminator_Freq", [[1, 4, 9, 16]]), [3, 5, 7]);
  const complexDiff = run(modulation, "Discriminator_Freq", [[[1, 3], [2, 7]]]);
  assert.deepEqual(complexDiff, [[2], [5]]);

  const constant = run(modulation, "Discriminator_EnvelopDetector", [new Array(64).fill(1)]);
  assert.equal(constant.length, 64);
  for (const value of constant) close(value, 1, 1e-12);

  const n = 1000;
  const cosine = new Array(n);
  for (let i = 0; i < n; i++) cosine[i] = Math.cos(2 * Math.PI * 5 * i / n);
  const envelope = run(modulation, "Discriminator_EnvelopDetector", [cosine]);
  assert.equal(envelope.length, n);
  for (const value of envelope) {
    assert.ok(value >= 0.999999 && value <= 1.000001, "cosine envelope " + value);
  }
});

test("Filter_LPF preserves length, passes DC, and rejects the stop band", () => {
  const sample = 1000;
  const dc = run(channel, "Filter_LPF", [new Array(200).fill(1), 10, 50, sample]);
  assert.equal(dc.length, 200);
  for (let i = 900; i < dc.length; i++) close(dc[i], 1, 1e-9);

  const n = 3000;
  const pass = new Array(n);
  const stop = new Array(n);
  for (let i = 0; i < n; i++) {
    pass[i] = Math.sin(2 * Math.PI * 10 * i / sample);
    stop[i] = Math.sin(2 * Math.PI * 50 * i / sample);
  }
  const passOut = run(channel, "Filter_LPF", [pass, 10, 50, sample]);
  const stopOut = run(channel, "Filter_LPF", [stop, 10, 50, sample]);
  assert.equal(passOut.length, n);
  assert.equal(stopOut.length, n);
  let passPeak = 0;
  let stopPeak = 0;
  for (let i = 1000; i < n; i++) {
    passPeak = Math.max(passPeak, Math.abs(passOut[i]));
    stopPeak = Math.max(stopPeak, Math.abs(stopOut[i]));
  }
  assert.ok(passPeak > 0.95, "10 Hz passband peak " + passPeak);
  assert.ok(stopPeak < 0.08, "50 Hz stopband peak " + stopPeak);

  const complexInput = [pass.slice(0, 512), stop.slice(0, 512)];
  const complexOut = run(channel, "Filter_LPF", [complexInput, 10, 50, sample]);
  complexRows(complexOut);
  assert.equal(complexOut[0].length, 512);
  assert.throws(() => run(channel, "Filter_LPF", [pass, 50, 10, sample]), /fp|fs/);
});

test("ComUse_AWGN follows Rainier real and complex noise scaling", () => {
  const realInput = new Array(20000).fill(1);
  const realOut = run(channel, "ComUse_AWGN", [realInput, 10, 1000], { rng: dsp.createRng(42), log: [] });
  const noise = realOut.map((value, i) => value - realInput[i]);
  close(variance(noise), 0.1, 0.01, "real AWGN variance");

  const ignoredA = run(channel, "ComUse_AWGN", [realInput, 10, 1000], { rng: dsp.createRng(7), log: [] });
  const ignoredB = run(channel, "ComUse_AWGN", [realInput, 10, 10], { rng: dsp.createRng(7), log: [] });
  assert.deepEqual(ignoredA, ignoredB);

  const n = 4096;
  const re = new Array(n);
  const im = new Array(n);
  for (let i = 0; i < n; i++) {
    const phase = 2 * Math.PI * i / n;
    re[i] = Math.cos(phase);
    im[i] = Math.sin(phase);
  }
  const complexOut = run(channel, "ComUse_AWGN", [[re, im], 10, n], { rng: dsp.createRng(99), log: [] });
  complexRows(complexOut);
  const complexNoise = new Array(n);
  for (let i = 0; i < n; i++) {
    const dr = complexOut[0][i] - re[i];
    const di = complexOut[1][i] - im[i];
    complexNoise[i] = dr * dr + di * di;
  }
  close(complexNoise.reduce((a, b) => a + b, 0) / n, 0.1, 0.01, "complex AWGN total variance");

  const scaled = run(channel, "ComUse_AWGN", [[re, im], 10, n / 2], { rng: dsp.createRng(99), log: [] });
  const scaledNoise = new Array(n);
  for (let i = 0; i < n; i++) {
    const dr = scaled[0][i] - re[i];
    const di = scaled[1][i] - im[i];
    scaledNoise[i] = dr * dr + di * di;
  }
  close(scaledNoise.reduce((a, b) => a + b, 0) / n, 0.2, 0.02, "nsymbol_bit complex scaling");
});

test("Multipath_Fading is full convolution and Multipath_Zero builds the ZF filter", () => {
  assert.deepEqual(run(channel, "Multipath_Fading", [[1, 2, 3], [1, 1]]), [1, 3, 5, 3]);
  assert.deepEqual(run(channel, "Multipath_Fading", [[1, 2, 3], "[1, 1]"]), [1, 3, 5, 3]);

  assert.deepEqual(run(channel, "Multipath_Zero", [[1, 2, 3], [1], 1]), [0, 1, 2, 3, 0]);
  assert.deepEqual(run(channel, "Multipath_Zero", [[1, 2, 3], [1], 2]), [0, 0, 1, 2, 3, 0, 0]);

  const h = [0.02, 0.05, 0.1, -0.2, 1, -0.2, 0.1, 0.05, 0.02];
  const equalizer = run(channel, "Multipath_Zero", [[1], h, 5]);
  assert.equal(equalizer.length, 11);
  const combined = run(channel, "Multipath_Fading", [equalizer, h]);
  assert.equal(combined.length, 19);
  close(combined[9], 1, 1e-8, "ZF combined center");
  let sidelobe = 0;
  for (let i = 0; i < combined.length; i++) {
    if (i !== 9) sidelobe = Math.max(sidelobe, Math.abs(combined[i]));
  }
  assert.ok(sidelobe < 0.02, "ZF sidelobe " + sidelobe);

  const long = run(channel, "Multipath_Zero", [new Array(20).fill(1), h, 5]);
  assert.equal(long.length, 30);
  assert.ok(long.every((value) => Number.isFinite(value)));
});

test("native graph executes FSK and PSK/QAM chains end to end", () => {
  const fskGraph = {
    seed: 123,
    nodes: [
      { id: "n1", className: "Source_Randi_Comm", inputs: 0, outputs: 1, values: ["64"] },
      { id: "n2", className: "Modulation_FskMod_Comm", inputs: 1, outputs: 1, values: ["8", "8", "16", "cont"] },
      { id: "n3", className: "ComUse_AWGN_Comm", inputs: 1, outputs: 1, values: ["20", "64"] },
      { id: "n4", className: "Modulation_FskDemod_Comm", inputs: 1, outputs: 1, values: ["8", "8", "16"] },
      { id: "n5", className: "Draw_Plot_Comm", inputs: 1, outputs: 0, values: [] },
    ],
    edges: [
      { from: "n1", fromPort: 0, to: "n2", toPort: 0 },
      { from: "n2", fromPort: 0, to: "n3", toPort: 0 },
      { from: "n3", fromPort: 0, to: "n4", toPort: 0 },
      { from: "n4", fromPort: 0, to: "n5", toPort: 0 },
    ],
  };
  const fskResult = native.runNative(fskGraph);
  assert.equal(fskResult.results.length, 1);
  assert.ok(fskResult.results[0].svg.includes("<svg"));

  const qamGraph = {
    seed: 456,
    nodes: [
      { id: "n1", className: "Source_Randi_Comm", inputs: 0, outputs: 1, values: ["64"] },
      { id: "n2", className: "SigTransfer_Bi2toM_Comm", inputs: 1, outputs: 1, values: ["16"] },
      { id: "n3", className: "Modulation_QamMod_Comm", inputs: 1, outputs: 1, values: ["16"] },
      { id: "n4", className: "Draw_ScatterPlot_Comm", inputs: 1, outputs: 0, values: ["16"] },
    ],
    edges: [
      { from: "n1", fromPort: 0, to: "n2", toPort: 0 },
      { from: "n2", fromPort: 0, to: "n3", toPort: 0 },
      { from: "n3", fromPort: 0, to: "n4", toPort: 0 },
    ],
  };
  const qamResult = native.runNative(qamGraph);
  assert.equal(qamResult.results.length, 1);
  assert.ok(qamResult.results[0].svg.includes("<svg"));
  assert.ok(qamResult.results[0].svg.includes("In-phase component"));
});

console.log("");
console.log("PASS " + passed + " assertions");

