"use strict";

// Advanced drawing devices for the CommLab native kernel.
// The SVG construction lives in ../plot-advanced.js; this module only maps
// Rainier class names/arguments to those renderers.

const dsp = require("../dsp");
const plot = require("../plot-advanced");

const CLASS_INFO = Object.freeze([
  ["Draw_SignalSpectrum", 1],
  ["Draw_ScatterPlot", 1],
  ["Draw_EYEdiagram", 1],
  ["Draw_Distribution", 1],
  ["Draw_Stairs", 1],
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

const HANDLERS = Object.freeze({
  Draw_SignalSpectrum(args = []) {
    return plot.renderSignalSpectrum(args[0], dsp.toNumber(args[1], 64), {
      color: dsp.parseColor(args[2], "#ff0000"),
    });
  },

  Draw_ScatterPlot(args = []) {
    return plot.renderScatterPlot(args[0], dsp.toInt(args[1], 100), {
      color: dsp.parseColor(args[2], "#0000ff"),
    });
  },

  Draw_EYEdiagram(args = []) {
    return plot.renderEyeDiagram(args[0], dsp.toInt(args[1], 2), {
      color: dsp.parseColor(args[2], "#0000ff"),
    });
  },

  Draw_Distribution(args = []) {
    return plot.renderDistribution(args[0], {
      color: dsp.parseColor(args[1], "#ff0000"),
    });
  },

  Draw_Stairs(args = []) {
    return plot.renderStairs(args[0], {
      color: dsp.parseColor(args[1], "#ff0000"),
    });
  },
});

module.exports = { ALIASES, INPUT_COUNTS, HANDLERS };