"use strict";

// Additional signal-source devices for the CommLab native kernel.
//
// Source_Randi and Source_Cosin are already built into index.js/dsp.js; their
// aliases are declared here for the _Comm spellings.  Source_DC and
// Source_Rectpuls are direct ports of the Rainier Octave sources.  The public
// contract is ALIASES / INPUT_COUNTS / HANDLERS.

const dsp = require("../dsp");

function sampleCount(duration, rate, label) {
  const t = dsp.toNumber(duration, 1);
  const fs = dsp.toNumber(rate, 100);
  if (!(fs > 0)) throw new Error("native DSP: " + label + " fs must be > 0");
  // Octave: time = 0 : 1/fs : (t-1/fs); length(time) == floor(t*fs).
  return Math.max(0, Math.floor(t * fs + 1e-9));
}

// Octave: Source_DC_Comm(A,t,fs)
function sourceDc(args) {
  const amp = dsp.toNumber(args[0], 1);
  const n = sampleCount(args[1], args[2], "Source_DC");
  return new Array(n).fill(amp);
}

// Octave: Source_Rectpuls_Comm(A,Tao,t,fs)
// rectpuls(t,Tao) is 1 on [-Tao/2, Tao/2) and 0 elsewhere.  Because the
// sampled time axis starts at 0, only the upper edge can be reached.
function sourceRectpuls(args) {
  const amp = dsp.toNumber(args[0], 1);
  const tao = dsp.toNumber(args[1], 0.5);
  const fs = dsp.toNumber(args[3], 100);
  const n = sampleCount(args[2], fs, "Source_Rectpuls");
  const out = new Array(n);
  const low = -tao / 2;
  const high = tao / 2;
  for (let i = 0; i < n; i++) {
    const time = i / fs;
    out[i] = time >= low && time < high ? amp : 0;
  }
  return out;
}

// Source_Randi and Source_Cosin handlers remain built into index.js; this
// module only declares their aliases/port counts so the registry can resolve
// the _Comm spellings without registering duplicate handlers.
const HANDLERS = Object.freeze({
  Source_DC: sourceDc,
  Source_Rectpuls: sourceRectpuls,
});

const ALIASES = Object.freeze({
  Source_Randi: "Source_Randi",
  Source_Randi_Comm: "Source_Randi",
  Sourse_Randi: "Source_Randi",
  Sourse_Randi_Comm: "Source_Randi",
  Source_Cosin: "Source_Cosin",
  Source_Cosin_Comm: "Source_Cosin",
  Source_DC: "Source_DC",
  Source_DC_Comm: "Source_DC",
  Source_Rectpuls: "Source_Rectpuls",
  Source_Rectpuls_Comm: "Source_Rectpuls",
});

const INPUT_COUNTS = Object.freeze({
  Source_Randi: 0,
  Source_Cosin: 0,
  Source_DC: 0,
  Source_Rectpuls: 0,
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };

