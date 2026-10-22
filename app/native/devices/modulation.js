"use strict";

// Modulation / demodulation / discriminator devices for the CommLab native
// kernel.  The formulas follow the Rainier Octave sources under
// OwvlabProgHome/RainierCommunicationCoding and the Octave communications
// package bundled with Rainier (communications-1.2.1).
//
// Complex signals use the native-kernel matrix convention [realRow; imagRow].
// This is the shape accepted by Draw_ScatterPlot and is also accepted by the
// channel devices in channel.js.

const dsp = require("../dsp");

const CLASS_INFO = Object.freeze([
  ["Modulation_Freq", 1],
  ["Modulation_Phrase", 1],
  ["Modulation_FskMod", 1],
  ["Modulation_FskDemod", 1],
  ["Modulation_PskMod", 1],
  ["Modulation_PskDemod", 1],
  ["Modulation_QamMod", 1],
  ["Modulation_QamDemod", 1],
  ["SigTransfer_DeMto2", 1],
  ["Discriminator_EnvelopDetector", 1],
  ["Discriminator_Freq", 1],
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

function isComplexRows(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    Array.isArray(value[0]) &&
    Array.isArray(value[1]) &&
    value[0].length === value[1].length;
}

function asFlat(value, label) {
  if (!Array.isArray(value)) deviceError(label, "expected a numeric array");
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = dsp.toNumber(value[i], NaN);
    if (!Number.isFinite(n)) deviceError(label, "sample " + i + " is not numeric");
    out[i] = n;
  }
  return out;
}

function asRealVector(value, label) {
  if (isComplexRows(value)) {
    // Rainier's real-valued modulators consume the real part.  This keeps the
    // serialized complex convention usable when a caller passes one by mistake.
    return asFlat(value[0], label);
  }
  return asFlat(value, label);
}

function asComplex(value, label) {
  if (isComplexRows(value)) {
    return { re: asFlat(value[0], label + " real"), im: asFlat(value[1], label + " imag") };
  }
  if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
    const re = new Array(value.length);
    const im = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const sample = value[i];
      const r = dsp.toNumber(sample.re != null ? sample.re : sample.real, NaN);
      const q = dsp.toNumber(sample.im != null ? sample.im : sample.imag, NaN);
      if (!Number.isFinite(r) || !Number.isFinite(q)) {
        deviceError(label, "complex sample " + i + " needs numeric re/im fields");
      }
      re[i] = r;
      im[i] = q;
    }
    return { re, im };
  }
  const re = asFlat(value, label);
  return { re, im: new Array(re.length).fill(0) };
}

function complexRows(re, im) {
  return [re, im];
}

function asSymbols(value, M, label) {
  const data = asRealVector(value, label);
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const symbol = data[i];
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= M) {
      deviceError(label, "symbol " + i + " must be an integer in [0," + (M - 1) + "]");
    }
    out[i] = symbol;
  }
  return out;
}

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

function octaveRound(value) {
  // Octave/MATLAB round(): ties go away from zero.
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function positiveMod(value, modulus) {
  const result = value % modulus;
  return result < 0 ? result + modulus : result;
}

function hilbertReal(value, label) {
  const x = asFlat(value, label);
  const n = x.length;
  if (n === 0) return { re: [], im: [] };
  if (n === 1) return { re: [x[0]], im: [0] };

  const spectrum = dsp.fft(x, new Array(n).fill(0));
  const h = new Array(n).fill(0);
  h[0] = 1;
  if (n % 2 === 0) {
    h[n / 2] = 1;
    for (let k = 1; k < n / 2; k++) h[k] = 2;
  } else {
    for (let k = 1; k <= (n - 1) / 2; k++) h[k] = 2;
  }

  const zr = new Array(n);
  const zi = new Array(n);
  for (let k = 0; k < n; k++) {
    zr[k] = spectrum.re[k] * h[k];
    zi[k] = spectrum.im[k] * h[k];
  }
  // IFFT(Z) = conj(FFT(conj(Z))) / N.
  const back = dsp.fft(zr, zi.map((v) => -v));
  const re = new Array(n);
  const im = new Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = back.re[i] / n;
    im[i] = -back.im[i] / n;
  }
  return { re, im };
}

function fskPhaseIncrements(nSamp, freqSep, Fs, label) {
  const samptime = 1 / Fs;
  // M = 2: the source's (-(M-1):2:(M-1)) tone list is [-1, 1].
  const tones = [-1, 1];
  const phaseIncr = new Array(nSamp);
  for (let i = 0; i < nSamp; i++) {
    phaseIncr[i] = new Array(2);
    for (let j = 0; j < 2; j++) {
      phaseIncr[i][j] = i * tones[j] * 2 * Math.PI * freqSep / 2 * samptime;
    }
  }
  if (nSamp < 2) deviceError(label, "nsamp must be an integer > 1");
  return phaseIncr;
}

function pskGrayMap(M) {
  if (M === 4) return [0, 1, 3, 2];
  if (M === 8) return [0, 1, 2, 3, 6, 7, 4, 5];
  if (M === 16) return [0, 1, 3, 2, 4, 5, 7, 6, 12, 13, 15, 14, 8, 9, 11, 10];
  return null;
}

function qamGrayMap(M) {
  if (M === 4) return [0, 1, 3, 2];
  if (M === 8) return [0, 1, 2, 3, 6, 7, 4, 5];
  if (M === 16) return [0, 1, 3, 2, 4, 5, 7, 6, 12, 13, 15, 14, 8, 9, 11, 10];
  return null;
}

function applyGrayMap(symbols, map) {
  if (!map) return symbols.slice();
  return symbols.map((symbol) => map[symbol]);
}

const HANDLERS = Object.freeze({
  // Octave: Modulation_Freq_Comm(datain,A,carrier_freq,Kf,t,fs)
  // int_m(i+1) = int_m(i) + datain(i)/fs; the first sample contributes zero.
  Modulation_Freq(args = []) {
    const data = asRealVector(args[0], "Modulation_Freq");
    const A = dsp.toNumber(args[1], 1);
    const carrier = dsp.toNumber(args[2], 10);
    const Kf = dsp.toNumber(args[3], 5);
    const fs = dsp.toNumber(args[5], 100);
    if (!(fs > 0)) deviceError("Modulation_Freq", "fs must be > 0");

    const out = new Array(data.length);
    let integral = 0;
    for (let i = 0; i < data.length; i++) {
      const phase = 2 * Math.PI * carrier * (i / fs) + 2 * Math.PI * Kf * integral;
      out[i] = A * Math.cos(phase);
      integral += data[i] / fs;
    }
    return out;
  },

  // Octave: Modulation_Phrase_Comm(datain,A,carrier_freq,Kp,t,fs)
  Modulation_Phrase(args = []) {
    const data = asRealVector(args[0], "Modulation_Phrase");
    const A = dsp.toNumber(args[1], 1);
    const carrier = dsp.toNumber(args[2], 10);
    const Kp = dsp.toNumber(args[3], 5);
    const fs = dsp.toNumber(args[5], 100);
    if (!(fs > 0)) deviceError("Modulation_Phrase", "fs must be > 0");

    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = A * Math.cos(2 * Math.PI * carrier * (i / fs) + Kp * data[i]);
    }
    return out;
  },

  // Octave: Modulation_FskMod_Comm(datain,freq_sep,nsamp,Fs,phase_cont)
  // Calls fskmod(datain,2,freq_sep,nsamp,Fs,phase_cont).
  Modulation_FskMod(args = []) {
    const data = asSymbols(args[0], 2, "Modulation_FskMod");
    const freqSep = dsp.toNumber(args[1], 8);
    const nSamp = dsp.toInt(args[2], 8);
    const Fs = dsp.toNumber(args[3], 16);
    const phaseText = String(dsp.toText(args[4], "cont"));
    if (!(freqSep > 0)) deviceError("Modulation_FskMod", "freq_sep must be > 0");
    if (!(nSamp > 1) || !Number.isInteger(nSamp)) {
      deviceError("Modulation_FskMod", "nsamp must be an integer > 1");
    }
    if (!(Fs > 0)) deviceError("Modulation_FskMod", "Fs must be > 0");
    if (freqSep / 2 > Fs / 2) {
      deviceError("Modulation_FskMod", "(M-1)*freq_sep/2 must not exceed Fs/2");
    }
    if (phaseText !== "cont" && phaseText !== "discont") {
      deviceError("Modulation_FskMod", "phase_cont must be 'cont' or 'discont'");
    }

    const phaseIncr = fskPhaseIncrements(nSamp, freqSep, Fs, "Modulation_FskMod");
    const phIncrSym = phaseIncr[nSamp - 1];
    const phIncrSamp = phaseIncr[1];
    const outRe = [];
    const outIm = [];
    const push = (phase) => {
      outRe.push(Math.cos(phase));
      outIm.push(Math.sin(phase));
    };

    const specialDiscont = phaseText === "discont" &&
      Math.abs((nSamp * freqSep / 2 / Fs) - Math.round(nSamp * freqSep / 2 / Fs)) < 1e-12;

    if (specialDiscont) {
      for (const symbol of data) {
        for (let i = 0; i < nSamp; i++) push(phaseIncr[i][symbol]);
      }
    } else if (phaseText === "cont") {
      let prevPhase = 0;
      for (const symbol of data) {
        const ph1 = prevPhase;
        for (let i = 0; i < nSamp; i++) push(ph1 + phaseIncr[i][symbol]);
        prevPhase = ph1 + phaseIncr[nSamp - 1][symbol] + phIncrSamp[symbol];
      }
    } else {
      const oscPhase = [0, 0];
      for (const symbol of data) {
        const ph1 = oscPhase[symbol];
        for (let i = 0; i < nSamp; i++) push(ph1 + phaseIncr[i][symbol]);
        for (let j = 0; j < 2; j++) {
          oscPhase[j] = positiveMod(oscPhase[j] + phIncrSym[j] + phIncrSamp[j], 2 * Math.PI);
        }
      }
    }
    return complexRows(outRe, outIm);
  },

  // Octave: Modulation_FskDemod_Comm(datain,freq_sep,nsamp,Fs)
  // Calls fskdemod(datain,2,freq_sep,nsamp,Fs): multiply by the two tones,
  // integrate-and-dump, and choose the larger magnitude.
  Modulation_FskDemod(args = []) {
    const input = asComplex(args[0], "Modulation_FskDemod");
    const freqSep = dsp.toNumber(args[1], 8);
    const nSamp = dsp.toInt(args[2], 8);
    const Fs = dsp.toNumber(args[3], 16);
    if (!(freqSep > 0)) deviceError("Modulation_FskDemod", "freq_sep must be > 0");
    if (!(nSamp > 1) || !Number.isInteger(nSamp)) {
      deviceError("Modulation_FskDemod", "nsamp must be an integer > 1");
    }
    if (!(Fs > 0)) deviceError("Modulation_FskDemod", "Fs must be > 0");
    if (freqSep / 2 > Fs / 2) {
      deviceError("Modulation_FskDemod", "(M-1)*freq_sep/2 must not exceed Fs/2");
    }
    if (input.re.length % nSamp !== 0) {
      deviceError("Modulation_FskDemod", "input length must be divisible by nsamp");
    }

    const freqs = [-freqSep / 2, freqSep / 2];
    const cosTone = new Array(nSamp);
    const sinTone = new Array(nSamp);
    for (let i = 0; i < nSamp; i++) {
      const t = i / Fs;
      cosTone[i] = new Array(2);
      sinTone[i] = new Array(2);
      for (let j = 0; j < 2; j++) {
        const phase = 2 * Math.PI * t * freqs[j];
        cosTone[i][j] = Math.cos(phase);
        sinTone[i][j] = Math.sin(phase);
      }
    }

    const symbols = new Array(input.re.length / nSamp);
    for (let start = 0; start < input.re.length; start += nSamp) {
      let bestMag = -Infinity;
      let bestSymbol = 0;
      for (let j = 0; j < 2; j++) {
        let sumRe = 0;
        let sumIm = 0;
        for (let i = 0; i < nSamp; i++) {
          const yr = input.re[start + i];
          const yi = input.im[start + i];
          // y * exp(-j*phase)
          sumRe += yr * cosTone[i][j] + yi * sinTone[i][j];
          sumIm += yi * cosTone[i][j] - yr * sinTone[i][j];
        }
        const mag = Math.hypot(sumRe / nSamp, sumIm / nSamp);
        if (mag > bestMag) {
          bestMag = mag;
          bestSymbol = j;
        }
      }
      symbols[start / nSamp] = bestSymbol;
    }
    return symbols;
  },

  // Octave: Modulation_PskMod_Comm(datain,M_ary)
  Modulation_PskMod(args = []) {
    const M = dsp.toInt(args[1], 2);
    if (!isPowerOfTwo(M)) deviceError("Modulation_PskMod", "M_ary must be a power of two >= 2");
    const symbols = asSymbols(args[0], M, "Modulation_PskMod");
    const mapped = applyGrayMap(symbols, pskGrayMap(M));
    const re = new Array(mapped.length);
    const im = new Array(mapped.length);
    for (let i = 0; i < mapped.length; i++) {
      const phase = 2 * Math.PI * mapped[i] / M;
      re[i] = Math.cos(phase);
      im[i] = Math.sin(phase);
    }
    return complexRows(re, im);
  },

  // Octave: Modulation_PskDemod_Comm(datain,M_ary)
  Modulation_PskDemod(args = []) {
    const M = dsp.toInt(args[1], 2);
    if (!isPowerOfTwo(M)) deviceError("Modulation_PskDemod", "M_ary must be a power of two >= 2");
    const input = asComplex(args[0], "Modulation_PskDemod");
    const map = pskGrayMap(M);
    const out = new Array(input.re.length);
    for (let i = 0; i < input.re.length; i++) {
      const angle = Math.atan2(input.im[i], input.re[i]);
      const natural = positiveMod(octaveRound(angle * M / (2 * Math.PI)), M);
      out[i] = map ? map[natural] : natural;
    }
    return out;
  },

  // Octave: Modulation_QamMod_Comm(datain,M_ary)
  // The bundled Octave qammod accepts only square constellations whose side is
  // a power of two (4, 16, 64).  M=8/32 are advertised by the device UI but
  // the original Octave function raises an error for them.
  Modulation_QamMod(args = []) {
    const M = dsp.toInt(args[1], 4);
    const side = Math.sqrt(M);
    if (!(Number.isInteger(side) && isPowerOfTwo(side))) {
      deviceError("Modulation_QamMod", "M_ary must be 4, 16 or 64 (Octave qammod limitation)");
    }
    const symbols = asSymbols(args[0], M, "Modulation_QamMod");
    const mapped = applyGrayMap(symbols, qamGrayMap(M));
    const re = new Array(mapped.length);
    const im = new Array(mapped.length);
    for (let i = 0; i < mapped.length; i++) {
      const x = mapped[i];
      re[i] = 2 * Math.floor(x / side) - side + 1;
      im[i] = -2 * positiveMod(x, side) + side - 1;
    }
    return complexRows(re, im);
  },

  // Octave: Modulation_QamDemod_Comm(datain,M_ary)
  // The bundled qamdemod performs nearest-point decisions on the same odd-
  // integer square constellation produced by qammod, then reverses the Gray
  // mapping.  Keep the nearest-point search explicit so ties and non-square
  // M values fail in the same place as the modulator.
  Modulation_QamDemod(args = []) {
    const M = dsp.toInt(args[1], 4);
    const side = Math.sqrt(M);
    if (!(Number.isInteger(side) && isPowerOfTwo(side))) {
      deviceError("Modulation_QamDemod", "M_ary must be 4, 16 or 64 (Octave qamdemod limitation)");
    }
    const input = asComplex(args[0], "Modulation_QamDemod");
    const map = qamGrayMap(M);
    const inverse = new Array(M);
    for (let symbol = 0; symbol < M; symbol++) {
      const mapped = map ? map[symbol] : symbol;
      inverse[mapped] = symbol;
    }
    const points = new Array(M);
    for (let mapped = 0; mapped < M; mapped++) {
      points[mapped] = {
        re: 2 * Math.floor(mapped / side) - side + 1,
        im: -2 * positiveMod(mapped, side) + side - 1,
        symbol: inverse[mapped],
      };
    }
    const out = new Array(input.re.length);
    for (let i = 0; i < out.length; i++) {
      let best = 0;
      let bestDistance = Infinity;
      for (let p = 0; p < points.length; p++) {
        const dr = input.re[i] - points[p].re;
        const di = input.im[i] - points[p].im;
        const distance = dr * dr + di * di;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
      out[i] = points[best].symbol;
    }
    return out;
  },

  // Octave: SigTransfer_DeMto2_Comm(datain)
  // Convert an M-ary symbol stream back to MSB-first binary.  The device has
  // no explicit M parameter, so the platform infers the width from the
  // largest symbol; this is the same convention used by the nativeChain 16QAM
  // BER path.
  SigTransfer_DeMto2(args = []) {
    const data = asRealVector(args[0], "SigTransfer_DeMto2");
    if (data.length === 0) return [];
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const symbol = data[i];
      if (!Number.isInteger(symbol) || symbol < 0) {
        deviceError("SigTransfer_DeMto2", "symbol " + i + " must be a non-negative integer");
      }
      if (symbol > max) max = symbol;
    }
    const bitsPerSymbol = Math.max(1, Math.ceil(Math.log2(max + 1)));
    const out = new Array(data.length * bitsPerSymbol);
    for (let i = 0; i < data.length; i++) {
      const symbol = data[i];
      for (let bit = 0; bit < bitsPerSymbol; bit++) {
        out[i * bitsPerSymbol + bit] = (symbol >> (bitsPerSymbol - 1 - bit)) & 1;
      }
    }
    return out;
  },

  // Octave: Discriminator_EnvelopDetector_Comm(datain)
  // dataout = abs(hilbert(datain)).  Octave's hilbert() warns and ignores the
  // imaginary part for complex input; the real row is used here for the same
  // behavior.
  Discriminator_EnvelopDetector(args = []) {
    const real = isComplexRows(args[0])
      ? asFlat(args[0][0], "Discriminator_EnvelopDetector")
      : asRealVector(args[0], "Discriminator_EnvelopDetector");
    const analytic = hilbertReal(real, "Discriminator_EnvelopDetector");
    const out = new Array(analytic.re.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(analytic.re[i], analytic.im[i]);
    return out;
  },

  // Octave: Discriminator_Freq_Comm(datain)
  Discriminator_Freq(args = []) {
    if (isComplexRows(args[0])) {
      const input = asComplex(args[0], "Discriminator_Freq");
      const re = new Array(Math.max(0, input.re.length - 1));
      const im = new Array(re.length);
      for (let i = 0; i < re.length; i++) {
        re[i] = input.re[i + 1] - input.re[i];
        im[i] = input.im[i + 1] - input.im[i];
      }
      return complexRows(re, im);
    }
    const data = asRealVector(args[0], "Discriminator_Freq");
    const out = new Array(Math.max(0, data.length - 1));
    for (let i = 0; i < out.length; i++) out[i] = data[i + 1] - data[i];
    return out;
  },
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };

