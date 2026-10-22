"use strict";

const assert = require("node:assert/strict");
const dsp = require("../../dsp");
const linecode = require("../linecode");
const sourceExtra = require("../source-extra");

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
  return handler(args, ctx || { rng: () => 0.5, log: [] });
}

function repeatSymbols(bits, block) {
  const out = [];
  for (const bit of bits) {
    for (let i = 0; i < block; i++) out.push(bit);
  }
  return out;
}

function close(actual, expected, epsilon) {
  assert.ok(Math.abs(actual - expected) <= (epsilon == null ? 1e-12 : epsilon),
    "expected " + expected + ", got " + actual);
}

test("module contract and aliases merge without duplicate handlers", () => {
  assert.equal(linecode.ALIASES.LineCode_Srz_Comm, "LineCode_Srz");
  assert.equal(linecode.ALIASES.LineCode_Hdb3_Comm, "LineCode_Hdb3");
  assert.equal(linecode.ALIASES.LineCode_Snrz_Comm, "LineCode_Snrz");
  assert.equal(linecode.INPUT_COUNTS.LineCode_Srz, 1);
  assert.equal(sourceExtra.ALIASES.Source_DC_Comm, "Source_DC");
  assert.equal(sourceExtra.ALIASES.Source_Rectpuls_Comm, "Source_Rectpuls");
  assert.equal(sourceExtra.ALIASES.Source_Randi_Comm, "Source_Randi");
  assert.equal(sourceExtra.INPUT_COUNTS.Source_Rectpuls, 0);
  assert.equal(linecode.HANDLERS.LineCode_Snrz, undefined);
  assert.equal(linecode.HANDLERS.LineCode_Manchester, undefined);
  assert.equal(sourceExtra.HANDLERS.Source_Randi, undefined);
  assert.equal(sourceExtra.HANDLERS.Source_Cosin, undefined);
});

test("Source_Randi (dsp built-in) returns a 0/1 sequence", () => {
  const bits = dsp.sourceRandi(64, dsp.createRng(12345));
  assert.equal(bits.length, 64);
  assert.ok(bits.every((value) => value === 0 || value === 1));
});

test("Source_Cosin (dsp built-in) uses the Octave time axis and phase", () => {
  const wave = dsp.sourceCosin(2, 5, 0.5, 0, 100);
  assert.equal(wave.length, 50);
  close(wave[0], 2);
  close(wave[10], -2);
});

test("Source_DC has length floor(t*fs) and constant amplitude", () => {
  const wave = run(sourceExtra, "Source_DC", [2, 0.5, 1000]);
  assert.equal(wave.length, 500);
  assert.ok(wave.every((value) => value === 2));
});

test("Source_Rectpuls is half-open on [-Tao/2,Tao/2)", () => {
  const wave = run(sourceExtra, "Source_Rectpuls", [1, 0.5, 1, 100]);
  assert.equal(wave.length, 100);
  assert.ok(wave.slice(0, 25).every((value) => value === 1));
  assert.equal(wave[25], 0);
  assert.ok(wave.slice(25).every((value) => value === 0));
});

test("LineCode_Snrz (dsp built-in) repeats each bit over 2^sample/M samples", () => {
  const wave = dsp.lineCodeSnrz([1, 0, 1, 0], 2, 3);
  assert.deepEqual(wave, [2, 2, 0, 0, 2, 2, 0, 0]);
});

test("LineCode_Manchester (dsp built-in) uses 0 -> -1,+1 and 1 -> +1,-1", () => {
  const wave = dsp.lineCodeManchester([0, 0, 0, 0, 1, 1, 1, 1], 4);
  assert.deepEqual(wave, [-1, -1, 1, 1, 1, 1, -1, -1]);
});

test("LineCode_Srz is unipolar RZ with 2^sample total samples", () => {
  const wave = run(linecode, "LineCode_Srz", [[1, 0, 1, 0], 2, 3, 0.5]);
  assert.equal(wave.length, 8);
  assert.deepEqual(wave, [2, 0, 0, 0, 2, 0, 0, 0]);
});

test("LineCode_Dnrz maps 0 -> -1 and 1 -> +1 for the whole symbol", () => {
  const wave = run(linecode, "LineCode_Dnrz", [repeatSymbols([0, 1], 4), 4]);
  assert.deepEqual(wave, [-1, -1, -1, -1, 1, 1, 1, 1]);
});

test("LineCode_Drz is bipolar RZ with a zero second half", () => {
  const wave = run(linecode, "LineCode_Drz", [repeatSymbols([0, 1], 4), 4]);
  assert.deepEqual(wave, [-1, -1, 0, 0, 1, 1, 0, 0]);
});

test("LineCode_Ami alternates the polarity of successive 1s", () => {
  const wave = run(linecode, "LineCode_Ami", [repeatSymbols([1, 1, 0, 0], 4), 4]);
  assert.deepEqual(wave, [1, 1, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("LineCode_Cmi alternates 1 symbols and encodes 0 as -1,+1", () => {
  const wave = run(linecode, "LineCode_Cmi", [repeatSymbols([1, 1, 0, 0], 4), 4]);
  assert.deepEqual(wave, [1, 1, 1, 1, -1, -1, -1, -1, -1, -1, 1, 1, -1, -1, 1, 1]);
});

test("LineCode_Hdb3 inserts a violation pulse in a four-zero run", () => {
  const wave = run(linecode, "LineCode_Hdb3", [repeatSymbols([0, 0, 0, 0, 1, 0, 1, 1], 4), 4]);
  assert.deepEqual(wave, [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    1, 1, 0, 0,
    -1, -1, 0, 0,
    0, 0, 0, 0,
    1, 1, 0, 0,
    -1, -1, 0, 0,
  ]);
});

test("LineCode_Hdb3 preserves the Octave i-3 B-pulse placement", () => {
  // Rainier's Octave source writes the optional B pulse at 1-based i-3,
  // not at the first zero of the four-zero group.  This is the observed
  // device behavior and is intentionally locked by this assertion.
  const wave = run(linecode, "LineCode_Hdb3", [repeatSymbols([1, 0, 0, 0, 0, 1], 4), 4]);
  assert.deepEqual(wave, [
    1, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 1, 1, 0,
    1, 1, 0, 0,
    -1, -1, 0, 0,
  ]);
});

test("LineCode_Diff accumulates XOR over symbols and keeps input length", () => {
  const wave = run(linecode, "LineCode_Diff", [repeatSymbols([1, 0, 1, 1], 4), 4]);
  assert.equal(wave.length, 16);
  assert.deepEqual(wave, [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
});

console.log("PASS " + passed + " assertions");

