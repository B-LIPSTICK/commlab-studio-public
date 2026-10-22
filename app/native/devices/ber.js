"use strict";

// Bit-error-rate observer for the CommLab native kernel.
// Mirrors BERCalculation_Biterr_Comm: compare datain1(1:end-depth) with
// datain2(depth+1:end) and return the bit error ratio.

const dsp = require("../dsp");

const ALIASES = Object.freeze({
  BERCalculation_Biterr: "BERCalculation_Biterr",
  BERCalculation_Biterr_Comm: "BERCalculation_Biterr",
});

const INPUT_COUNTS = Object.freeze({
  BERCalculation_Biterr: 2,
});

function asVector(value, label) {
  if (!Array.isArray(value) || (value.length > 0 && Array.isArray(value[0]))) {
    throw new Error("native devices (BERCalculation_Biterr): " + label + " must be a 1-D numeric array");
  }
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = dsp.toNumber(value[i], NaN);
    if (!Number.isFinite(n)) {
      throw new Error("native devices (BERCalculation_Biterr): " + label + "[" + i + "] is not numeric");
    }
    out[i] = n;
  }
  return out;
}

function bitErrorRate(args = [], ctx) {
  const sent = asVector(args[0], "datain1");
  const received = asVector(args[1], "datain2");
  if (sent.length !== received.length) {
    throw new Error(
      "native devices (BERCalculation_Biterr): inputs must have equal length (" +
        sent.length + " vs " + received.length + ")"
    );
  }
  const depth = dsp.toInt(args[2], 0);
  if (depth < 0 || depth >= sent.length) {
    throw new Error("native devices (BERCalculation_Biterr): depth must satisfy 0 <= depth < length");
  }
  const total = sent.length - depth;
  let errors = 0;
  for (let i = 0; i < total; i++) {
    if (sent[i] !== received[i + depth]) errors += 1;
  }
  const ber = total > 0 ? errors / total : 0;
  const metric = { ber, errors, total };

  // Keep legacy numeric callers working while graph execution receives the
  // full metric.  The coercion hooks also make arithmetic on the object use
  // the BER value, so downstream code can treat it as a number when needed.
  Object.defineProperty(metric, "valueOf", { value: () => ber, enumerable: false });
  Object.defineProperty(metric, Symbol.toPrimitive, { value: () => ber, enumerable: false });

  // The graph runner asks for details explicitly.  Existing direct-handler
  // tests pass a context without that flag and continue to receive a number.
  return ctx && ctx.details !== true ? ber : metric;
}

module.exports = {
  ALIASES,
  INPUT_COUNTS,
  HANDLERS: Object.freeze({ BERCalculation_Biterr: bitErrorRate }),
};
