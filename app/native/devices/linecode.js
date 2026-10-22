"use strict";

// Line-code devices for the CommLab native kernel.
//
// The implementations below are ports of the Rainier Octave sources under
// OwvlabProgHome/RainierCommunicationCoding.  The public contract is:
//   ALIASES, INPUT_COUNTS, HANDLERS
// Handlers receive (inputValues..., node.values...) as args and return arrays.

const dsp = require("../dsp");

const DEFAULT_L = 64;

function requireInput(value, label) {
  const data = dsp.asVector(value, label + " input");
  if (data.length === 0) throw new Error("native DSP: " + label + " input is empty");
  return data;
}

function requireBlockLength(value, label, evenOnly) {
  const block = dsp.toInt(value, DEFAULT_L);
  if (!Number.isFinite(block) || block < 1) {
    throw new Error("native DSP: " + label + " L must be a positive integer");
  }
  if (evenOnly && block % 2 !== 0) {
    throw new Error("native DSP: " + label + " L must be an even integer");
  }
  return block;
}

function ensureLength(out, length) {
  while (out.length < length) out.push(0);
}

function setRun(out, start, count, value) {
  if (!(count > 0)) return;
  ensureLength(out, start + count);
  for (let i = 0; i < count; i++) out[start + i] = value;
}

function halfBlock(block) {
  // Octave's i:i+L/2-1 colon keeps integer samples up to floor(L/2) even
  // when L is odd; platform parameters normally use an even L.
  return Math.floor(block / 2);
}

// Octave: LineCode_Srz_Comm(datain,A,sample,tao)
// N = 2^sample, L = N/length(datain), and the first floor(L*tao) samples of
// every symbol are filled with datain(symbol)*A.
function lineCodeSrz(args) {
  const data = requireInput(args[0], "LineCode_Srz");
  const amp = dsp.toNumber(args[1], 1);
  const exponent = dsp.toInt(args[2], 12);
  const tao = dsp.toNumber(args[3], 0.5);

  if (exponent < 0) throw new Error("native DSP: LineCode_Srz sample must be >= 0");
  const total = Math.pow(2, exponent);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("native DSP: invalid LineCode_Srz sample exponent");
  }
  const block = total / data.length;
  if (!Number.isInteger(block) || block <= 0) {
    throw new Error("native DSP: LineCode_Srz requires 2^sample to be divisible by the symbol count");
  }

  const out = new Array(total).fill(0);
  const pulse = Math.max(0, Math.floor(block * tao + 1e-12));
  for (let start = 0; start < total; start += block) {
    const symbol = data[Math.round(start / block)];
    setRun(out, start, pulse, symbol * amp);
  }
  return out;
}

// Octave: LineCode_Dnrz_Comm(datain,L)
// 0 -> -1 for the full symbol, 1 -> +1 for the full symbol.
function lineCodeDnrz(args) {
  const data = requireInput(args[0], "LineCode_Dnrz");
  const block = requireBlockLength(args[1], "LineCode_Dnrz", false);
  const out = new Array(data.length).fill(0);
  for (let start = 0; start < data.length; start += block) {
    setRun(out, start, block, data[start] === 0 ? -1 : 1);
  }
  return out;
}

// Octave: LineCode_Drz_Comm(datain,L)
// First half of each symbol is +1 for 1 and -1 for 0; second half is zero.
function lineCodeDrz(args) {
  const data = requireInput(args[0], "LineCode_Drz");
  const block = requireBlockLength(args[1], "LineCode_Drz", false);
  const half = halfBlock(block);
  const out = new Array(data.length).fill(0);
  for (let start = 0; start < data.length; start += block) {
    setRun(out, start, half, data[start] === 1 ? 1 : -1);
  }
  return out;
}

// Octave: LineCode_Ami_Comm(datain,L)
// 1s produce alternating +1/-1 half-width pulses; 0s stay at zero.
function lineCodeAmi(args) {
  const data = requireInput(args[0], "LineCode_Ami");
  const block = requireBlockLength(args[1], "LineCode_Ami", false);
  const half = halfBlock(block);
  const out = new Array(data.length).fill(0);
  let ones = 0;
  for (let start = 0; start < data.length; start += block) {
    if (data[start] === 1) {
      setRun(out, start, half, ones % 2 === 0 ? 1 : -1);
      ones += 1;
    }
  }
  return out;
}

// Octave: LineCode_Cmi_Comm(datain,L)
// 0 -> -1,+1; 1 -> an alternating full-width +1 or -1 symbol.
function lineCodeCmi(args) {
  const data = requireInput(args[0], "LineCode_Cmi");
  const block = requireBlockLength(args[1], "LineCode_Cmi", true);
  const half = block / 2;
  const out = new Array(data.length).fill(0);
  let ones = 0;
  for (let start = 0; start < data.length; start += block) {
    if (data[start] === 0) {
      setRun(out, start, half, -1);
      setRun(out, start + half, half, 1);
    } else if (data[start] === 1) {
      setRun(out, start, block, ones % 2 === 0 ? 1 : -1);
      ones += 1;
    }
  }
  return out;
}

// Octave: LineCode_Hdb3_Comm(datain,L)
//
// The original implementation writes the optional B pulse at 1-based index
// i-3 (not i-3*L).  That placement is preserved here so results match the
// Rainier/Octave device byte-for-byte at the sample level.
function lineCodeHdb3(args) {
  const data = requireInput(args[0], "LineCode_Hdb3");
  const block = requireBlockLength(args[1], "LineCode_Hdb3", false);
  const half = halfBlock(block);
  const out = new Array(data.length).fill(0);

  let lastV = -1;
  let lastOne = -1;
  let zeroCount = 0;

  for (let start = 0; start < data.length; start += block) {
    if (data[start] === 1) {
      setRun(out, start, half, -lastOne);
      lastOne = out[start];
      zeroCount = 0;
    } else {
      zeroCount += 1;
      if (zeroCount === 4) {
        zeroCount = 0;
        setRun(out, start, half, -lastV);
        lastV = out[start];
        if (out[start] * lastOne === 1) {
          const bStart = start - 3; // Octave's s(i-3:...) with i one-based
          if (bStart < 0) {
            throw new Error("native DSP: LineCode_Hdb3 B-pulse index is negative");
          }
          setRun(out, bStart, half, out[start]);
        }
        lastOne = out[start];
      }
    }
  }
  return out;
}

function octaveMod2(value) {
  return ((value % 2) + 2) % 2;
}

// Octave: LineCode_Diff_Comm(datain,L)
// b[n] = mod(a[n] + b[n-1], 2), starting with b[-1] = 0.  The original loop
// reads datain(i) at i=2:L:N+1, i.e. the second sample of each L-sample symbol.
function lineCodeDiff(args) {
  const data = requireInput(args[0], "LineCode_Diff");
  const block = requireBlockLength(args[1], "LineCode_Diff", false);
  const out = new Array(data.length).fill(0);
  let previous = 0;

  for (let start = 0; start < data.length; start += block) {
    const sampleIndex = start + 1;
    if (sampleIndex >= data.length) {
      throw new Error("native DSP: LineCode_Diff requires at least two samples per symbol");
    }
    const encoded = octaveMod2(data[sampleIndex] + previous);
    const count = Math.min(block, data.length - start);
    setRun(out, start, count, encoded);
    previous = encoded;
  }
  return out;
}

const HANDLERS = Object.freeze({

  LineCode_Srz: lineCodeSrz,
  LineCode_Dnrz: lineCodeDnrz,
  LineCode_Drz: lineCodeDrz,
  LineCode_Ami: lineCodeAmi,
  LineCode_Cmi: lineCodeCmi,
  LineCode_Hdb3: lineCodeHdb3,
  LineCode_Diff: lineCodeDiff,
});

// Snrz and Manchester handlers remain built into index.js; only their aliases
// and port counts are declared here so the registry can resolve _Comm names
// without registering duplicate handlers.
const ALIASES = Object.freeze({
  LineCode_Snrz: "LineCode_Snrz",
  LineCode_Snrz_Comm: "LineCode_Snrz",
  LineCode_Manchester: "LineCode_Manchester",
  LineCode_Manchester_Comm: "LineCode_Manchester",
  LineCode_Srz: "LineCode_Srz",
  LineCode_Srz_Comm: "LineCode_Srz",
  LineCode_Dnrz: "LineCode_Dnrz",
  LineCode_Dnrz_Comm: "LineCode_Dnrz",
  LineCode_Drz: "LineCode_Drz",
  LineCode_Drz_Comm: "LineCode_Drz",
  LineCode_Ami: "LineCode_Ami",
  LineCode_Ami_Comm: "LineCode_Ami",
  LineCode_Cmi: "LineCode_Cmi",
  LineCode_Cmi_Comm: "LineCode_Cmi",
  LineCode_CMI: "LineCode_Cmi",
  LineCode_CMI_Comm: "LineCode_Cmi",
  LineCode_Hdb3: "LineCode_Hdb3",
  LineCode_Hdb3_Comm: "LineCode_Hdb3",
  LineCode_HDB3: "LineCode_Hdb3",
  LineCode_HDB3_Comm: "LineCode_Hdb3",
  LineCode_Diff: "LineCode_Diff",
  LineCode_Diff_Comm: "LineCode_Diff",
});

const INPUT_COUNTS = Object.freeze({
  LineCode_Snrz: 1,
  LineCode_Manchester: 1,
  LineCode_Srz: 1,
  LineCode_Dnrz: 1,
  LineCode_Drz: 1,
  LineCode_Ami: 1,
  LineCode_Cmi: 1,
  LineCode_Hdb3: 1,
  LineCode_Diff: 1,
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };


