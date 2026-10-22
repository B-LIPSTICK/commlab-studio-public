"use strict";

const assert = require("assert");
const comuse = require("../comuse");
const sigtransfer = require("../sigtransfer");

const C = comuse.HANDLERS;
const S = sigtransfer.HANDLERS;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (error) {
    failures.push({ name, error });
    console.error("not ok - " + name);
    console.error(String(error && error.stack ? error.stack : error));
  }
}

function approx(actual, expected, eps) {
  assert.strictEqual(actual.length, expected.length, "length mismatch");
  const tolerance = eps == null ? 1e-9 : eps;
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance,
      "index " + i + ": " + actual[i] + " != " + expected[i]
    );
  }
}

test("module contracts and aliases", () => {
  for (const name of Object.keys(comuse.INPUT_COUNTS)) {
    if (name === "ComUse_Sample") continue; // built into app/native/index.js
    assert.strictEqual(typeof C[name], "function", name + " handler missing");
    assert.strictEqual(comuse.ALIASES[name], name);
    assert.strictEqual(comuse.ALIASES[name + "_Comm"], name);
  }
  for (const name of Object.keys(sigtransfer.INPUT_COUNTS)) {
    assert.strictEqual(typeof S[name], "function", name + " handler missing");
    assert.strictEqual(sigtransfer.ALIASES[name], name);
    assert.strictEqual(sigtransfer.ALIASES[name + "_Comm"], name);
  }
  assert.strictEqual(comuse.INPUT_COUNTS.ComUse_Adder, 2);
  assert.strictEqual(comuse.INPUT_COUNTS.ComUse_Delay, 1);
  assert.strictEqual(sigtransfer.INPUT_COUNTS.SigTransfer_PSTransform, 2);
});

test("ComUse_Adder pointwise and scalar broadcast", () => {
  assert.deepStrictEqual(C.ComUse_Adder([[1, 2, 3], [10, 20, 30]]), [11, 22, 33]);
  assert.deepStrictEqual(C.ComUse_Adder([[1, 2], 2]), [3, 4]);
  assert.throws(() => C.ComUse_Adder([[1, 2], [1, 2, 3]]), /lengths differ/);
});

test("ComUse_Multiplier pointwise", () => {
  assert.deepStrictEqual(C.ComUse_Multiplier([[1, 2, 3], [4, 5, 6]]), [4, 10, 18]);
  assert.deepStrictEqual(C.ComUse_Multiplier([[1, 2, 3], 2]), [2, 4, 6]);
});

test("ComUse_Delay prepends zeros and truncates", () => {
  assert.deepStrictEqual(C.ComUse_Delay([[1, 2, 3, 4], 2]), [0, 0, 1, 2]);
  assert.deepStrictEqual(C.ComUse_Delay([[1, 2], 0]), [1, 2]);
  assert.deepStrictEqual(C.ComUse_Delay([[1, 2], 5]), [0, 0]);
  assert.throws(() => C.ComUse_Delay([[1, 2], -1]), /delaytime/);
});

test("ComUse_DownSample decimates by factor", () => {
  assert.deepStrictEqual(C.ComUse_DownSample([[10, 20, 30, 40, 50], 2]), [10, 30, 50]);
  assert.deepStrictEqual(C.ComUse_DownSample([[1, 2, 3, 4], 4]), [1]);
  assert.throws(() => C.ComUse_DownSample([[1, 2], 0]), /nsamp/);
});

test("ComUse_Judge block threshold and hold", () => {
  assert.deepStrictEqual(
    C.ComUse_Judge([[1, 1, -1, -1, 0.2, 0.2, 0.9, 0.9], 2]),
    [1, 1, 0, 0, 1, 1, 1, 1]
  );
  assert.deepStrictEqual(C.ComUse_Judge([[0.4, 0.6], 1, 0.5]), [0, 1]);
  assert.throws(() => C.ComUse_Judge([[1, 2], 0]), /block length/);
});

test("ComUse_Mod2 XOR/modulo two", () => {
  assert.deepStrictEqual(C.ComUse_Mod2([[1, 0, 1, 1], [0, 1, 1, 1], 2]), [1, 1, 0, 0]);
  assert.deepStrictEqual(C.ComUse_Mod2([[0, 1], [0, 1], 1]), [0, 0]);
});

test("ComUse_OnePass passes high-control samples", () => {
  assert.deepStrictEqual(C.ComUse_OnePass([[1, 1, 0, 0], [5, 6, 7, 8], 1]), [5, 6, 0, 0]);
  assert.deepStrictEqual(C.ComUse_OnePass([[1, 1, 0, 0], [5, 6, 7, 8], 2]), [5, 6, 0, 0]);
});

test("ComUse_ZeroPass passes low-control samples", () => {
  assert.deepStrictEqual(C.ComUse_ZeroPass([[1, 1, 0, 0], [5, 6, 7, 8], 1]), [0, 0, 7, 8]);
  assert.deepStrictEqual(C.ComUse_ZeroPass([[1, 1, 0, 0], [5, 6, 7, 8], 2]), [0, 0, 7, 8]);
});

test("ComUse_Rectifier full-wave default and half-wave option", () => {
  assert.deepStrictEqual(C.ComUse_Rectifier([[-2, 0, 3]]), [2, 0, 3]);
  assert.deepStrictEqual(C.ComUse_Rectifier([[-2, 0, 3], "half"]), [0, 0, 3]);
});

test("ComUse_Relay maps levels with hysteresis", () => {
  assert.deepStrictEqual(
    C.ComUse_Relay([[0, 0.2, 0.5, 1, 0.6, 0.1], 0.5, 0.4, 1, -1]),
    [-1, -1, 1, 1, 1, -1]
  );
  assert.deepStrictEqual(C.ComUse_Relay([[0, 1], 0.5, 0.49, 2, -2]), [-2, 2]);
});

test("ComUse_Select selects a 1-based matrix row", () => {
  assert.deepStrictEqual(C.ComUse_Select([[[1, 2], [3, 4]], 2]), [3, 4]);
  assert.deepStrictEqual(C.ComUse_Select([[1, 2, 3], 1]), [1, 2, 3]);
  assert.throws(() => C.ComUse_Select([[[1, 2]], 2]), /exceeds/);
  assert.throws(() => C.ComUse_Select([[1, 2, 3], 2]), /invalid/);
});

test("SigTransfer_Bi2toM groups MSB-first bits", () => {
  assert.deepStrictEqual(
    S.SigTransfer_Bi2toM([[1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0], 64]),
    [35, 26]
  );
  assert.deepStrictEqual(S.SigTransfer_Bi2toM([[1, 0, 1, 1], 4]), [2, 3]);
  assert.throws(() => S.SigTransfer_Bi2toM([[1, 0, 1], 3]), /power of two/);
});

test("SigTransfer_HexTransform groups by sqrt(M)", () => {
  assert.deepStrictEqual(
    S.SigTransfer_HexTransform([[0, 1, 1, 1, 0, 0, 1, 0], 16]),
    [1, 3, 0, 2]
  );
  assert.deepStrictEqual(S.SigTransfer_HexTransform([[1, 0, 1, 1], 4]), [1, 0, 1, 1]);
  assert.throws(() => S.SigTransfer_HexTransform([[1, 0], 8]), /square/);
});

test("SigTransfer_Hilbert returns the analytic-signal imaginary part", () => {
  const n = 16;
  const k = 2;
  const input = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * k * i) / n));
  const expected = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * k * i) / n));
  approx(S.SigTransfer_Hilbert([input]), expected, 1e-9);
  assert.deepStrictEqual(S.SigTransfer_Hilbert([[]]), []);
});

test("SigTransfer_MultiJudge maps 4 levels to two held bits", () => {
  const input = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
  assert.deepStrictEqual(
    S.SigTransfer_MultiJudge([input, 4]),
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1]
  );
  assert.throws(() => S.SigTransfer_MultiJudge([[0, 1, 2, 3], 3]), /even/);
});

test("SigTransfer_PSTransform interleaves two held bit streams", () => {
  const a = [1, 1, 1, 1, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 1, 1, 1, 1];
  assert.deepStrictEqual(S.SigTransfer_PSTransform([a, b, 4]), [1, 1, 0, 0, 0, 0, 1, 1]);
  assert.throws(() => S.SigTransfer_PSTransform([[1, 2], [1], 2]), /lengths differ/);
});

test("SigTransfer_ParalleData splits odd/even rows", () => {
  assert.deepStrictEqual(
    S.SigTransfer_ParalleData([[1, 2, 3, 4, 5, 6, 7, 8], 2]),
    [[1, 3, 5, 7], [2, 4, 6, 8]]
  );
  assert.deepStrictEqual(S.SigTransfer_ParalleData([[1, 2, 3, 4], 1]), [[1, 2, 3, 4]]);
  assert.throws(() => S.SigTransfer_ParalleData([[1, 2, 3], 2]), /divisible/);
});

console.log("");
console.log(passed + " passed, " + failures.length + " failed");
if (failures.length > 0) process.exitCode = 1;