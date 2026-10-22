"use strict";

const assert = require("node:assert/strict");
const draw = require("../draw-advanced");
const plot = require("../../plot-advanced");

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

function run(name, args) {
  const handler = draw.HANDLERS[name];
  assert.equal(typeof handler, "function", "missing handler " + name);
  return handler(args, { rng: () => 0.5, log: [] });
}

function assertSvg(svg, title) {
  assert.equal(typeof svg, "string");
  assert.ok(svg.length > 1000, "SVG is unexpectedly small");
  assert.ok(svg.includes("<svg"), "missing <svg>");
  assert.ok(svg.includes("</svg>"), "missing </svg>");
  assert.ok(svg.includes('width="640" height="440"'), "wrong canvas size");
  assert.ok(svg.includes('viewBox="0 0 640 440"'), "wrong viewBox");
  assert.ok(svg.includes("<title>" + title + "</title>"), "missing title " + title);
  assert.ok(!svg.includes("NaN"), "SVG contains NaN");
  assert.ok(svg.includes("<rect"), "missing axis/background rect");
  assert.ok(svg.includes("<line"), "missing axis/grid line");
  assert.ok(svg.includes("<text"), "missing text labels");
}

test("module contract, aliases and input counts", () => {
  assert.equal(draw.ALIASES.Draw_SignalSpectrum_Comm, "Draw_SignalSpectrum");
  assert.equal(draw.ALIASES.Draw_ScatterPlot_Comm, "Draw_ScatterPlot");
  assert.equal(draw.ALIASES.Draw_EYEdiagram_Comm, "Draw_EYEdiagram");
  assert.equal(draw.ALIASES.Draw_Distribution_Comm, "Draw_Distribution");
  assert.equal(draw.ALIASES.Draw_Stairs_Comm, "Draw_Stairs");
  for (const name of Object.keys(draw.INPUT_COUNTS)) assert.equal(draw.INPUT_COUNTS[name], 1);
});

test("Draw_SignalSpectrum emits stem paths and axes", () => {
  const svg = run("Draw_SignalSpectrum", [[1, 0, -1, 0, 1, 0, -1, 0], 8]);
  assertSvg(svg, "Signal spectrum");
  assert.ok((svg.match(/<path/g) || []).length >= 8, "missing spectrum stems");
  assert.ok(svg.includes("frequency"));
  assert.ok(svg.includes("amplitude"));
});

test("Draw_ScatterPlot accepts a 2-row complex matrix", () => {
  const svg = run("Draw_ScatterPlot", [[[1, 0, -1, 0], [0, 1, 0, -1]], 4]);
  assertSvg(svg, "Signal ScatterPlot");
  assert.ok((svg.match(/<circle/g) || []).length >= 4, "missing constellation points");
  assert.ok(svg.includes("In-phase component"));
  assert.ok(svg.includes("Quadrature component"));
});

test("Draw_ScatterPlot accepts real samples and limits num", () => {
  const svg = run("Draw_ScatterPlot", [[1, 2, 3, 4, 5], 2]);
  assertSvg(svg, "Signal ScatterPlot");
  assert.equal((svg.match(/<circle/g) || []).length, 2);
});

test("Draw_EYEdiagram emits one path per trace", () => {
  const svg = run("Draw_EYEdiagram", [[0, 1, 1, 0, 1, 0, 0, 1], 2]);
  assertSvg(svg, "EyeDiagram");
  assert.ok((svg.match(/<path/g) || []).length >= 4, "missing eye traces");
  assert.ok(svg.includes("Time"));
  assert.ok(svg.includes("Amplitude"));
});

test("Draw_Distribution emits one dot per sample", () => {
  const svg = run("Draw_Distribution", [[0, 1, -1, 0.5, -0.5, 1]]);
  assertSvg(svg, "SignalDistributionDiagram");
  assert.equal((svg.match(/<circle/g) || []).length, 6);
});

test("Draw_Stairs emits a step path", () => {
  const svg = run("Draw_Stairs", [[0, 1, 1, 0, 1, 0]]);
  assertSvg(svg, "SignalStairsDiagram");
  assert.equal((svg.match(/<path/g) || []).length, 1);
});

test("advanced plot helpers are exported", () => {
  assert.equal(typeof plot.buildAdvancedSvg, "function");
  assert.equal(typeof plot.renderSignalSpectrum, "function");
  assert.equal(typeof plot.renderScatterPlot, "function");
  assert.equal(typeof plot.renderEyeDiagram, "function");
  assert.equal(typeof plot.renderDistribution, "function");
  assert.equal(typeof plot.renderStairs, "function");
});

console.log("");
console.log(passed + " passed");