"use strict";

const assert = require("node:assert/strict");
const coding = require("../coding");
const ber = require("../ber");

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

function run(module, name, args) {
  const handler = module.HANDLERS[name];
  assert.equal(typeof handler, "function", "missing handler " + name);
  return handler(args, { rng: () => 0.5, log: [] });
}

test("module contract, aliases and input counts", () => {
  assert.equal(coding.ALIASES.SourceCoding_DeltaMPredict_Comm, "SourceCoding_DeltaMPredict");
  assert.equal(coding.ALIASES.ChannalCoding_HammingEncode_Comm, "ChannalCoding_HammingEncode");
  assert.equal(coding.ALIASES.ChannalCoding_ConvDecode_Comm, "ChannalCoding_ConvDecode");
  assert.equal(coding.INPUT_COUNTS.SourceCoding_DeltaMCoding, 2);
  assert.equal(coding.INPUT_COUNTS.ChannalCoding_ConvDecode, 1);
  assert.equal(ber.ALIASES.BERCalculation_Biterr_Comm, "BERCalculation_Biterr");
  assert.equal(ber.INPUT_COUNTS.BERCalculation_Biterr, 2);
});

test("DeltaM prediction follows the Rainier sign accumulator", () => {
  const predicted = run(coding, "SourceCoding_DeltaMPredict", [[1, 2, 1, 0, -1], 0.5]);
  assert.deepEqual(predicted, [0.5, 1, 1.5, 1, 0.5]);
});

test("DeltaM coding uses the previous prediction sample", () => {
  const bits = run(coding, "SourceCoding_DeltaMCoding", [
    [1, 2, 1, 0, -1],
    [0.5, 1, 1.5, 1, 0.5],
  ]);
  assert.deepEqual(bits, [1, 1, 1, 0, 0]);
});

test("DeltaM decoding reconstructs the predictor output", () => {
  const decoded = run(coding, "SourceCoding_DeltaMDecoding", [[1, 1, 1, 0, 0], 0.5]);
  assert.deepEqual(decoded, [0.5, 1, 1.5, 1, 0.5]);
});

test("Hamming (7,4) encodes with the Rainier bit ordering", () => {
  const encoded = run(coding, "ChannalCoding_HammingEncode", [[1, 0, 1, 0], 7, 4]);
  assert.deepEqual(encoded, [0, 0, 1, 1, 0, 1, 0]);
  assert.equal(run(coding, "ChannalCoding_HammingEncode", [new Array(8).fill(0), 7, 4]).length, 14);
});

test("Hamming (7,4) corrects every single-bit error", () => {
  for (let mask = 0; mask < 16; mask++) {
    const message = [(mask >> 3) & 1, (mask >> 2) & 1, (mask >> 1) & 1, mask & 1];
    const codeword = run(coding, "ChannalCoding_HammingEncode", [message, 7, 4]);
    assert.equal(codeword.length, 7);
    for (let position = 0; position < 7; position++) {
      const received = codeword.slice();
      received[position] ^= 1;
      const decoded = run(coding, "ChannalCoding_HammingDecode", [received, 7, 4]);
      assert.deepEqual(decoded, message, "mask=" + mask + " position=" + position);
    }
  }
});

test("convolutional encoder matches the Octave (2,1,7) reference", () => {
  const input = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1];
  const encoded = run(coding, "ChannalCoding_ConvEncode", [input, 7, "[171 133]"]);
  assert.equal(encoded.length, 44);
  assert.equal(encoded.join(""), "11100010010111111001100001101110110010110111");
});

test("convolutional Viterbi decoder removes the six tail bits", () => {
  const input = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1];
  const encoded = run(coding, "ChannalCoding_ConvEncode", [input, 7, [171, 133]]);
  const decoded = run(coding, "ChannalCoding_ConvDecode", [encoded, 7, [171, 133], 6]);
  assert.deepEqual(decoded, input);
});

test("convolutional round-trip works for a longer deterministic sequence", () => {
  const input = Array.from({ length: 128 }, (_, i) => ((i * 7 + (i >> 2)) % 3 === 0 ? 1 : 0));
  const encoded = run(coding, "ChannalCoding_ConvEncode", [input, 7, "[171 133]"]);
  const decoded = run(coding, "ChannalCoding_ConvDecode", [encoded, 7, "[171 133]"]);
  assert.deepEqual(decoded, input);
});

test("convolutional decoder corrects every single coded-bit error", () => {
  const input = Array.from({ length: 32 }, (_, i) => ((i * 3 + (i >> 1)) % 5 < 2 ? 1 : 0));
  const encoded = run(coding, "ChannalCoding_ConvEncode", [input, 7, "[171 133]"]);
  for (let position = 0; position < encoded.length; position++) {
    const received = encoded.slice();
    received[position] ^= 1;
    const decoded = run(coding, "ChannalCoding_ConvDecode", [received, 7, "[171 133]", 6]);
    assert.deepEqual(decoded, input, "coded bit " + position);
  }
});
test("BER boundaries and relative depth", () => {
  assert.equal(run(ber, "BERCalculation_Biterr", [[1, 0, 1, 1], [1, 0, 1, 1], 0]), 0);
  assert.equal(run(ber, "BERCalculation_Biterr", [[1, 0, 1, 1], [1, 0, 0, 1], 0]), 0.25);
  assert.equal(
    run(ber, "BERCalculation_Biterr", [[1, 0, 1, 1, 0, 1], [0, 1, 0, 1, 1, 0], 1]),
    0
  );
  assert.throws(() => run(ber, "BERCalculation_Biterr", [[1, 0], [1], 0]), /equal length/);
  assert.throws(() => run(ber, "BERCalculation_Biterr", [[1, 0], [1, 0], 2]), /depth/);
});

console.log("");
console.log(passed + " passed");