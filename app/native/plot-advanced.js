"use strict";

// Advanced plotting helpers for the CommLab native kernel.
// All SVG output uses the same 640x440 chart style as dsp.js and reuses its
// escapeXml / formatNumber / niceTicks helpers.

const dsp = require("./dsp");

const WIDTH = 640;
const HEIGHT = 440;

function plotError(label, message) {
  throw new Error("native plot (" + label + "): " + message);
}

function asSignalVector(value, label) {
  if (!Array.isArray(value)) plotError(label, "input must be an array");
  let source = value;
  if (source.length > 0 && Array.isArray(source[0])) {
    if (source.length === 2 && source.every((row) => Array.isArray(row))) {
      source = source[0];
    } else {
      source = source.flat();
    }
  }
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const n = dsp.toNumber(source[i], NaN);
    if (!Number.isFinite(n)) plotError(label, "sample " + i + " is not numeric");
    out[i] = n;
  }
  return out;
}

function complexPart(object, names) {
  for (const name of names) {
    if (object[name] != null) {
      const value = dsp.toNumber(object[name], NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function parseComplexPoints(value, label) {
  if (!Array.isArray(value)) plotError(label, "signal must be an array");
  if (value.length === 0) return [];

  if (Array.isArray(value[0])) {
    const allRows = value.every((row) => Array.isArray(row));
    if (!allRows) plotError(label, "matrix signal rows must all be arrays");
    if (value.length === 2 && value[0].length > 2 && value[1].length === value[0].length) {
      const points = new Array(value[0].length);
      for (let i = 0; i < value[0].length; i++) {
        const re = dsp.toNumber(value[0][i], NaN);
        const im = dsp.toNumber(value[1][i], NaN);
        if (!Number.isFinite(re) || !Number.isFinite(im)) plotError(label, "complex sample " + i + " is not numeric");
        points[i] = { x: re, y: im };
      }
      return points;
    }
    if (value.every((pair) => pair.length >= 2)) {
      return value.map((pair, index) => {
        const re = dsp.toNumber(pair[0], NaN);
        const im = dsp.toNumber(pair[1], NaN);
        if (!Number.isFinite(re) || !Number.isFinite(im)) plotError(label, "complex sample " + index + " is not numeric");
        return { x: re, y: im };
      });
    }
    plotError(label, "unsupported matrix shape for constellation data");
  }

  if (value[0] && typeof value[0] === "object") {
    return value.map((sample, index) => {
      const re = complexPart(sample, ["re", "real", "I", "i", "inPhase", "x"]);
      const im = complexPart(sample, ["im", "imag", "Q", "q", "quadrature", "y"]);
      if (re == null || im == null) plotError(label, "complex sample " + index + " needs re/im fields");
      return { x: re, y: im };
    });
  }

  return value.map((sample, index) => {
    const re = dsp.toNumber(sample, NaN);
    if (!Number.isFinite(re)) plotError(label, "sample " + index + " is not numeric");
    return { x: re, y: 0 };
  });
}

function finiteExtent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function buildAdvancedSvg(options) {
  const opts = options || {};
  const width = WIDTH;
  const height = HEIGHT;
  const margin = { left: 72, right: 28, top: 52, bottom: 60 };
  const plot = {
    x: margin.left,
    y: margin.top,
    w: width - margin.left - margin.right,
    h: height - margin.top - margin.bottom,
  };
  const series = (opts.series || []).filter((item) => item && Array.isArray(item.x) && Array.isArray(item.y));
  if (!series.length) plotError(opts.title || "chart", "chart has no series");

  const allX = [];
  const allY = [];
  for (const item of series) {
    if (item.x.length !== item.y.length) plotError(opts.title || "chart", "series x/y lengths differ");
    for (let i = 0; i < item.x.length; i++) {
      if (Number.isFinite(item.x[i]) && Number.isFinite(item.y[i])) {
        allX.push(item.x[i]);
        allY.push(item.y[i]);
      }
    }
  }
  if (!allX.length) plotError(opts.title || "chart", "chart data is not finite");

  const xExtent = finiteExtent(allX);
  const yExtent = finiteExtent(allY);
  let xMin = opts.xMin == null ? xExtent.min : opts.xMin;
  let xMax = opts.xMax == null ? xExtent.max : opts.xMax;
  let yMin = opts.yMin == null ? yExtent.min : opts.yMin;
  let yMax = opts.yMax == null ? yExtent.max : opts.yMax;
  if (opts.includeZeroY) {
    if (yMin > 0) yMin = 0;
    if (yMax < 0) yMax = 0;
  }
  if (!(xMax > xMin)) {
    const pad = Math.abs(xMin) > 0 ? Math.abs(xMin) * 0.2 : 1;
    xMin -= pad;
    xMax += pad;
  }
  if (!(yMax > yMin)) {
    const pad = Math.abs(yMin) > 0 ? Math.abs(yMin) * 0.2 : 1;
    yMin -= pad;
    yMax += pad;
  }

  const xTicks = dsp.niceTicks(xMin, xMax, opts.xTickCount || 6);
  const yTicks = dsp.niceTicks(yMin, yMax, opts.yTickCount || 6);
  const xScale = (value) => plot.x + ((value - xMin) / (xMax - xMin)) * plot.w;
  const yScale = (value) => plot.y + plot.h - ((value - yMin) / (yMax - yMin)) * plot.h;

  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img">');
  parts.push('<title>' + dsp.escapeXml(opts.title || "Signal") + '</title>');
  parts.push('<desc>' + dsp.escapeXml(opts.desc || "CommLab native JS kernel SVG") + '</desc>');
  parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>');
  parts.push('<defs><clipPath id="advancedPlotClip"><rect x="' + plot.x + '" y="' + plot.y + '" width="' + plot.w + '" height="' + plot.h + '"/></clipPath></defs>');

  parts.push('<g stroke="#d9d9d9" stroke-width="1" fill="none">');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<line x1="' + dsp.formatNumber(x) + '" y1="' + plot.y + '" x2="' + dsp.formatNumber(x) + '" y2="' + (plot.y + plot.h) + '"/>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<line x1="' + plot.x + '" y1="' + dsp.formatNumber(y) + '" x2="' + (plot.x + plot.w) + '" y2="' + dsp.formatNumber(y) + '"/>');
  }
  parts.push('</g>');

  parts.push('<g stroke="#333333" stroke-width="1" fill="none">');
  parts.push('<rect x="' + plot.x + '" y="' + plot.y + '" width="' + plot.w + '" height="' + plot.h + '"/>');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<line x1="' + dsp.formatNumber(x) + '" y1="' + (plot.y + plot.h) + '" x2="' + dsp.formatNumber(x) + '" y2="' + (plot.y + plot.h + 5) + '"/>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<line x1="' + plot.x + '" y1="' + dsp.formatNumber(y) + '" x2="' + (plot.x - 5) + '" y2="' + dsp.formatNumber(y) + '"/>');
  }
  parts.push('</g>');

  parts.push('<g font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#333333">');
  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push('<text x="' + dsp.formatNumber(x) + '" y="' + (plot.y + plot.h + 19) + '" text-anchor="middle">' + dsp.escapeXml(dsp.formatNumber(tick, 3)) + '</text>');
  }
  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push('<text x="' + (plot.x - 9) + '" y="' + dsp.formatNumber(y + 4) + '" text-anchor="end">' + dsp.escapeXml(dsp.formatNumber(tick, 3)) + '</text>');
  }
  parts.push('</g>');

  parts.push('<g clip-path="url(#advancedPlotClip)" fill="none">');
  for (const item of series) {
    const color = dsp.escapeXml(item.color || "#0000ff");
    const kind = item.kind || "line";
    const widthValue = item.width || 1.5;
    if (kind === "dots") {
      parts.push('<g fill="' + color + '" stroke="none">');
      for (let i = 0; i < item.x.length; i++) {
        if (!Number.isFinite(item.x[i]) || !Number.isFinite(item.y[i])) continue;
        parts.push('<circle cx="' + dsp.formatNumber(xScale(item.x[i])) + '" cy="' + dsp.formatNumber(yScale(item.y[i])) + '" r="' + dsp.formatNumber(item.radius || 2.5) + '"/>');
      }
      parts.push('</g>');
    } else if (kind === "stem") {
      const base = item.baseline == null ? 0 : item.baseline;
      const baseY = yScale(base);
      for (let i = 0; i < item.x.length; i++) {
        if (!Number.isFinite(item.x[i]) || !Number.isFinite(item.y[i])) continue;
        const x = xScale(item.x[i]);
        const y = yScale(item.y[i]);
        parts.push('<path d="M' + dsp.formatNumber(x) + ',' + dsp.formatNumber(baseY) + ' L' + dsp.formatNumber(x) + ',' + dsp.formatNumber(y) + '" stroke="' + color + '" stroke-width="' + widthValue + '"/>');
      }
      if (item.markers) {
        parts.push('<g fill="' + color + '" stroke="none">');
        for (let i = 0; i < item.x.length; i++) {
          if (!Number.isFinite(item.x[i]) || !Number.isFinite(item.y[i])) continue;
          parts.push('<circle cx="' + dsp.formatNumber(xScale(item.x[i])) + '" cy="' + dsp.formatNumber(yScale(item.y[i])) + '" r="2.4"/>');
        }
        parts.push('</g>');
      }
    } else if (kind === "stairs") {
      let d = "";
      for (let i = 0; i < item.x.length; i++) {
        if (!Number.isFinite(item.x[i]) || !Number.isFinite(item.y[i])) continue;
        const x = xScale(item.x[i]);
        const y = yScale(item.y[i]);
        if (!d) d = "M" + dsp.formatNumber(x) + "," + dsp.formatNumber(y);
        else {
          const previousY = yScale(item.y[i - 1]);
          d += " L" + dsp.formatNumber(x) + "," + dsp.formatNumber(previousY) + " L" + dsp.formatNumber(x) + "," + dsp.formatNumber(y);
        }
      }
      if (d) parts.push('<path d="' + d + '" stroke="' + color + '" stroke-width="' + widthValue + '" stroke-linejoin="round" stroke-linecap="round"/>');
      if (item.x.length === 1) parts.push('<circle cx="' + dsp.formatNumber(xScale(item.x[0])) + '" cy="' + dsp.formatNumber(yScale(item.y[0])) + '" r="2.5" fill="' + color + '" stroke="none"/>');
    } else {
      let d = "";
      for (let i = 0; i < item.x.length; i++) {
        if (!Number.isFinite(item.x[i]) || !Number.isFinite(item.y[i])) continue;
        d += (d ? " L" : "M") + dsp.formatNumber(xScale(item.x[i])) + "," + dsp.formatNumber(yScale(item.y[i]));
      }
      if (d) parts.push('<path d="' + d + '" stroke="' + color + '" stroke-width="' + widthValue + '" stroke-linejoin="round" stroke-linecap="round"/>');
      if (item.x.length === 1) parts.push('<circle cx="' + dsp.formatNumber(xScale(item.x[0])) + '" cy="' + dsp.formatNumber(yScale(item.y[0])) + '" r="2.5" fill="' + color + '" stroke="none"/>');
    }
  }
  parts.push('</g>');

  parts.push('<g font-family="Arial, Helvetica, sans-serif" fill="#111111">');
  parts.push('<text x="' + (width / 2) + '" y="25" text-anchor="middle" font-size="15" font-weight="600">' + dsp.escapeXml(opts.title || "Signal") + '</text>');
  if (opts.xlabel) parts.push('<text x="' + (plot.x + plot.w / 2) + '" y="' + (height - 15) + '" text-anchor="middle" font-size="12">' + dsp.escapeXml(opts.xlabel) + '</text>');
  if (opts.ylabel) {
    parts.push('<text x="18" y="' + (plot.y + plot.h / 2) + '" text-anchor="middle" font-size="12" transform="rotate(-90 18 ' + (plot.y + plot.h / 2) + ')">' + dsp.escapeXml(opts.ylabel) + '</text>');
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join("\n");
}

function renderSignalSpectrum(value, fsValue, options) {
  const opts = options || {};
  const signal = asSignalVector(value, "Draw_SignalSpectrum");
  if (signal.length === 0) plotError("Draw_SignalSpectrum", "input is empty");
  const fs = dsp.toNumber(fsValue, 64);
  if (!(fs > 0)) plotError("Draw_SignalSpectrum", "sampling frequency must be > 0");

  const n = signal.length;
  const spectrum = dsp.fft(signal, new Array(n).fill(0));
  const amplitude = new Array(n);
  const shift = Math.floor(n / 2);
  let maximum = 0;
  for (let i = 0; i < n; i++) {
    const source = (i + shift) % n;
    const valueDb = Math.hypot(spectrum.re[source], spectrum.im[source]) / fs;
    amplitude[i] = valueDb;
    if (valueDb > maximum) maximum = valueDb;
  }
  const df = fs / n;
  const frequency = new Array(n);
  for (let i = 0; i < n; i++) frequency[i] = -fs / 2 + i * df;
  return buildAdvancedSvg({
    title: "Signal spectrum",
    desc: "Signal spectrum rendered by the CommLab native JS kernel",
    xlabel: "frequency",
    ylabel: "amplitude",
    series: [{
      x: frequency,
      y: amplitude,
      kind: "stem",
      color: opts.color || "#ff0000",
      width: 1.1,
      markers: false,
    }],
    xMin: frequency[0],
    xMax: frequency[n - 1],
    yMin: 0,
    yMax: maximum > 0 ? maximum * 1.08 : 1,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderScatterPlot(value, numValue, options) {
  const opts = options || {};
  const points = parseComplexPoints(value, "Draw_ScatterPlot");
  if (points.length === 0) plotError("Draw_ScatterPlot", "input is empty");
  const requested = dsp.toInt(numValue, 100);
  const count = Math.max(1, Math.min(points.length, requested));
  const selected = points.slice(0, count);
  let maximum = 0;
  for (const point of selected) maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
  const limits = maximum > 0 ? maximum * 1.07 : 1;
  return buildAdvancedSvg({
    title: "Signal ScatterPlot",
    desc: "Constellation scatter plot rendered by the CommLab native JS kernel",
    xlabel: "In-phase component",
    ylabel: "Quadrature component",
    series: [{
      x: selected.map((point) => point.x),
      y: selected.map((point) => point.y),
      kind: "dots",
      color: opts.color || "#0000ff",
      radius: 2.6,
    }],
    xMin: -limits,
    xMax: limits,
    yMin: -limits,
    yMax: limits,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderEyeDiagram(value, nValue, options) {
  const opts = options || {};
  const signal = asSignalVector(value, "Draw_EYEdiagram");
  if (signal.length === 0) plotError("Draw_EYEdiagram", "input is empty");
  const n = dsp.toInt(nValue, 2);
  if (!(n > 1)) plotError("Draw_EYEdiagram", "n must be an integer > 1");

  const traces = [];
  for (let start = 0; start < signal.length; start += n) {
    const end = Math.min(start + n, signal.length);
    if (end <= start) continue;
    const x = [];
    const y = [];
    for (let i = start; i < end; i++) {
      x.push((i - start) / (n - 1));
      y.push(signal[i]);
    }
    traces.push({ x, y, kind: "line", color: opts.color || "#0000ff", width: 1.1 });
  }
  if (!traces.length) plotError("Draw_EYEdiagram", "no trace could be formed");
  const bounds = finiteExtent(signal);
  return buildAdvancedSvg({
    title: "EyeDiagram",
    desc: "Eye diagram rendered by the CommLab native JS kernel",
    xlabel: "Time",
    ylabel: "Amplitude",
    series: traces,
    xMin: 0,
    xMax: 1,
    yMin: bounds.min - Math.abs(bounds.max - bounds.min) * 0.08,
    yMax: bounds.max + Math.abs(bounds.max - bounds.min) * 0.08,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderDistribution(value, options) {
  const opts = options || {};
  const signal = asSignalVector(value, "Draw_Distribution");
  if (signal.length === 0) plotError("Draw_Distribution", "input is empty");
  const x = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) x[i] = i + 1;
  const bounds = finiteExtent(signal);
  return buildAdvancedSvg({
    title: "SignalDistributionDiagram",
    desc: "Signal distribution rendered by the CommLab native JS kernel",
    xlabel: "Sample",
    ylabel: "Amplitude",
    series: [{
      x,
      y: signal,
      kind: "dots",
      color: opts.color || "#ff0000",
      radius: 2.4,
    }],
    xMin: 1,
    xMax: signal.length,
    yMin: bounds.min - 1,
    yMax: bounds.max + 1,
    xTickCount: 6,
    yTickCount: 6,
  });
}

function renderStairs(value, options) {
  const opts = options || {};
  const signal = asSignalVector(value, "Draw_Stairs");
  if (signal.length === 0) plotError("Draw_Stairs", "input is empty");
  const x = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) x[i] = i + 1;
  const bounds = finiteExtent(signal);
  return buildAdvancedSvg({
    title: "SignalStairsDiagram",
    desc: "Signal stairs plot rendered by the CommLab native JS kernel",
    xlabel: "Sample",
    ylabel: "Amplitude",
    series: [{
      x,
      y: signal,
      kind: "stairs",
      color: opts.color || "#ff0000",
      width: 1.5,
    }],
    xMin: 1,
    xMax: signal.length,
    yMin: bounds.min - 1,
    yMax: bounds.max + 1,
    xTickCount: 6,
    yTickCount: 6,
  });
}

module.exports = {
  buildAdvancedSvg,
  renderSignalSpectrum,
  renderScatterPlot,
  renderEyeDiagram,
  renderDistribution,
  renderStairs,
};