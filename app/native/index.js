"use strict";

const fs = require("fs");
const path = require("path");
const dsp = require("./dsp");

// ---------------------------------------------------------------------------
// Built-in registry
// ---------------------------------------------------------------------------
// The three prototype experiments stay here so the kernel keeps working even
// when app/native/devices/ does not exist yet.  Device modules are merged on
// top of these maps at require time; built-ins cannot be overwritten.

const BASE_ALIASES = Object.freeze({
  Source_Randi: "Source_Randi",
  Source_Randi_Comm: "Source_Randi",
  Sourse_Randi: "Source_Randi",
  Sourse_Randi_Comm: "Source_Randi",

  LineCode_Snrz: "LineCode_Snrz",
  LineCode_Snrz_Comm: "LineCode_Snrz",
  LineCode_Manchester: "LineCode_Manchester",
  LineCode_Manchester_Comm: "LineCode_Manchester",

  Source_Cosin: "Source_Cosin",
  Source_Cosin_Comm: "Source_Cosin",
  ComUse_Sample: "ComUse_Sample",
  ComUse_Sample_Comm: "ComUse_Sample",

  SourceCoding_PCMQuantiz: "SourceCoding_PCMQuantiz",
  SourceCoding_PCMQuantiz_Comm: "SourceCoding_PCMQuantiz",
  SourceCoding_PCMCoding: "SourceCoding_PCMCoding",
  SourceCoding_PCMCoding_Comm: "SourceCoding_PCMCoding",
  SourceCoding_PCMDecoding: "SourceCoding_PCMDecoding",
  SourceCoding_PCMDecoding_Comm: "SourceCoding_PCMDecoding",

  Draw_Plot: "Draw_Plot",
  Draw_Plot_Comm: "Draw_Plot",
  Draw_PowerSpectrum: "Draw_PowerSpectrum",
  Draw_PowerSpectrum_Comm: "Draw_PowerSpectrum",
  Draw_Stem: "Draw_Stem",
  Draw_Stem_Comm: "Draw_Stem",
});

const BASE_INPUT_COUNTS = Object.freeze({
  Source_Randi: 0,
  Source_Cosin: 0,
  LineCode_Snrz: 1,
  LineCode_Manchester: 1,
  ComUse_Sample: 1,
  SourceCoding_PCMQuantiz: 1,
  SourceCoding_PCMCoding: 1,
  SourceCoding_PCMDecoding: 1,
  Draw_Plot: 1,
  Draw_PowerSpectrum: 1,
  Draw_Stem: 1,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionEntries(section, file, sectionName) {
  if (section == null) return [];
  if (section instanceof Map) return Array.from(section.entries());
  if (typeof section === "object" && !Array.isArray(section)) return Object.entries(section);
  throw new Error(
    'native kernel: device module "' + file + '" has a non-object ' + sectionName
  );
}

function createBaseRegistry() {
  const aliases = new Map();
  const inputCounts = new Map();
  const handlers = new Map();
  const aliasSources = new Map();
  const inputSources = new Map();
  const handlerSources = new Map();

  for (const [key, value] of Object.entries(BASE_ALIASES)) {
    aliases.set(key, value);
    aliasSources.set(key, "built-in");
  }
  for (const [key, value] of Object.entries(BASE_INPUT_COUNTS)) {
    inputCounts.set(key, value);
    inputSources.set(key, "built-in");
  }
  for (const [key, value] of Object.entries(BASE_HANDLERS)) {
    handlers.set(key, value);
    handlerSources.set(key, "built-in");
  }

  return { aliases, inputCounts, handlers, aliasSources, inputSources, handlerSources };
}

function readDeviceSpecs(dir) {
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error('native kernel: cannot read device directory "' + dir + '": ' + error.message);
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();

  const specs = [];
  for (const filename of files) {
    const filePath = path.join(dir, filename);
    let loaded;
    try {
      loaded = require(filePath);
    } catch (error) {
      throw new Error(
        'native kernel: failed to load device module "' + filePath + '": ' + error.message
      );
    }
    const spec = loaded && loaded.__esModule && loaded.default ? loaded.default : loaded;
    const hasAnySection =
      spec &&
      (spec.ALIASES != null || spec.INPUT_COUNTS != null || spec.HANDLERS != null);
    if (!hasAnySection) {
      // Allow a shared helper file in the same directory.  Device modules that
      // are intended to be loaded must export at least one of the three maps.
      specs.push({ filename, filePath, spec: null });
      continue;
    }
    if (typeof spec !== "object" && typeof spec !== "function") {
      throw new Error(
        'native kernel: device module "' + filePath + '" must export an object'
      );
    }
    specs.push({ filename, filePath, spec });
  }
  return specs;
}

function mergeDeviceSpecs(registry, specs) {
  // Pass 1: aliases first, so a module may refer to an alias declared by any
  // module in this directory (including a later filename).
  for (const item of specs) {
    if (!item.spec) continue;
    for (const [rawKey, rawTarget] of sectionEntries(item.spec.ALIASES, item.filename, "ALIASES")) {
      const key = String(rawKey).trim();
      const target = String(rawTarget == null ? "" : rawTarget).trim();
      if (!key || !target) {
        throw new Error(
          'native kernel: empty alias in "' + item.filename + '"'
        );
      }
      const existing = registry.aliases.get(key);
      if (existing != null && existing !== target) {
        throw new Error(
          'native kernel: alias "' + key + '" in "' + item.filename +
          '" conflicts with "' + existing + '" from "' + registry.aliasSources.get(key) + '"'
        );
      }
      if (existing == null) {
        registry.aliases.set(key, target);
        registry.aliasSources.set(key, item.filename);
      }
    }
  }

  // Pass 2: input counts.  Keys may be canonical names or aliases; aliases are
  // resolved with the fully merged alias table.
  for (const item of specs) {
    if (!item.spec) continue;
    for (const [rawKey, rawCount] of sectionEntries(item.spec.INPUT_COUNTS, item.filename, "INPUT_COUNTS")) {
      const rawName = String(rawKey).trim();
      if (!rawName) throw new Error('native kernel: empty INPUT_COUNTS key in "' + item.filename + '"');
      const canonical = registry.aliases.get(rawName) || rawName;
      const count = Number(rawCount);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(
          'native kernel: INPUT_COUNTS["' + rawName + '"] in "' + item.filename +
          '" must be a non-negative integer'
        );
      }
      const existing = registry.inputCounts.get(canonical);
      if (existing != null && existing !== count) {
        throw new Error(
          'native kernel: INPUT_COUNTS["' + canonical + '"] in "' + item.filename +
          '" conflicts with ' + existing + ' from "' + registry.inputSources.get(canonical) + '"'
        );
      }
      if (existing == null) {
        registry.inputCounts.set(canonical, count);
        registry.inputSources.set(canonical, item.filename);
      }
    }
  }

  // Pass 3: handlers.  A duplicate canonical handler is always an error; two
  // parallel modules must not silently overwrite each other.
  for (const item of specs) {
    if (!item.spec) continue;
    for (const [rawKey, handler] of sectionEntries(item.spec.HANDLERS, item.filename, "HANDLERS")) {
      const rawName = String(rawKey).trim();
      if (!rawName) throw new Error('native kernel: empty HANDLERS key in "' + item.filename + '"');
      const canonical = registry.aliases.get(rawName) || rawName;
      if (typeof handler !== "function") {
        throw new Error(
          'native kernel: HANDLERS["' + rawName + '"] in "' + item.filename + '" is not a function'
        );
      }
      if (registry.handlers.has(canonical)) {
        throw new Error(
          'native kernel: handler "' + canonical + '" in "' + item.filename +
          '" conflicts with the handler from "' + registry.handlerSources.get(canonical) + '"'
        );
      }
      registry.handlers.set(canonical, handler);
      registry.handlerSources.set(canonical, item.filename);
    }
  }

  // A handler without an explicit port count defaults to 0.  The warning is
  // exposed for diagnostics; it does not prevent the rest of the directory
  // from loading.
  const warnings = [];
  for (const canonical of registry.handlers.keys()) {
    if (!registry.inputCounts.has(canonical)) {
      registry.inputCounts.set(canonical, 0);
      registry.inputSources.set(canonical, "default");
      warnings.push('handler "' + canonical + '" has no INPUT_COUNTS entry; defaulted to 0');
    }
  }
  return warnings;
}

function loadDeviceModules(dir) {
  const registry = createBaseRegistry();
  const specs = readDeviceSpecs(dir || path.join(__dirname, "devices"));
  const warnings = mergeDeviceSpecs(registry, specs);
  for (const item of specs) {
    if (!item.spec) {
      warnings.push('ignored "' + item.filename + '" (no ALIASES/INPUT_COUNTS/HANDLERS)');
    }
  }
  const files = specs.map((item) => item.filename);
  return {
    aliases: registry.aliases,
    inputCounts: registry.inputCounts,
    handlers: registry.handlers,
    files,
    warnings,
  };
}

function parseSpectrumArgs(args) {
  let l = dsp.toNumber(args[1], null);
  let display = dsp.toText(args[2], "common");
  if (l == null) {
    l = 64;
    display = dsp.toText(args[1], "common");
  }
  return { l, display };
}

const BASE_HANDLERS = Object.freeze({
  Source_Randi(args, ctx) {
    const length = dsp.toInt(args[0], 256);
    const localSeed = dsp.toNumber(args[1], null);
    const rng = localSeed == null ? ctx.rng : dsp.createRng(localSeed);
    return dsp.sourceRandi(length, rng);
  },

  Source_Cosin(args) {
    return dsp.sourceCosin(
      dsp.toNumber(args[0], 1),
      dsp.toNumber(args[1], 10),
      dsp.toNumber(args[2], 1),
      dsp.toNumber(args[3], 0),
      dsp.toNumber(args[4], 100)
    );
  },

  LineCode_Snrz(args) {
    return dsp.lineCodeSnrz(args[0], dsp.toNumber(args[1], 1), dsp.toInt(args[2], 12));
  },

  LineCode_Manchester(args) {
    return dsp.lineCodeManchester(args[0], dsp.toInt(args[1], 64));
  },

  ComUse_Sample(args) {
    return dsp.sampleSignal(args[0], dsp.toNumber(args[1], 64), dsp.toNumber(args[2], 1));
  },

  SourceCoding_PCMQuantiz(args) {
    return dsp.pcmQuantize(args[0]);
  },

  SourceCoding_PCMCoding(args) {
    return dsp.pcmEncode(args[0]);
  },

  SourceCoding_PCMDecoding(args) {
    return dsp.pcmDecode(args[0], dsp.toNumber(args[1], 1));
  },

  Draw_Plot(args) {
    return dsp.renderPlot(args[0], {
      color: dsp.parseColor(args[1], "#0000ff"),
      title: "Signal waveform",
      ylabel: "amplitude",
    });
  },

  Draw_PowerSpectrum(args) {
    const parsed = parseSpectrumArgs(args);
    return dsp.renderPowerSpectrum(args[0], parsed.l, parsed.display, {
      color: "#0000ff",
      title: "PowerSpectrumDensity",
    });
  },

  Draw_Stem(args) {
    return dsp.renderStem(args[0], {
      color: dsp.parseColor(args[1], "#0000ff"),
      title: "Discrete signal graph",
      ylabel: "amplitude",
    });
  },
});

// ---------------------------------------------------------------------------
// Registry construction
// ---------------------------------------------------------------------------

const DEVICES_DIR = path.join(__dirname, "devices");
const REGISTRY = loadDeviceModules(DEVICES_DIR);
const CLASS_ALIASES = REGISTRY.aliases;
const INPUT_COUNTS = REGISTRY.inputCounts;
const HANDLERS = REGISTRY.handlers;
const DEVICE_MODULES = Object.freeze(REGISTRY.files.slice());
const DEVICE_WARNINGS = Object.freeze(REGISTRY.warnings.slice());

// ---------------------------------------------------------------------------
// Graph execution
// ---------------------------------------------------------------------------

function canonicalClass(name) {
  const raw = String(name == null ? "" : name).trim();
  if (CLASS_ALIASES.has(raw)) return CLASS_ALIASES.get(raw);
  if (raw.endsWith("_Comm")) {
    const base = raw.slice(0, -5);
    if (CLASS_ALIASES.has(base)) return CLASS_ALIASES.get(base);
  }
  return raw;
}

function cleanValues(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => value !== "" && value != null);
}

function inputCount(node, cls) {
  if (node.inputs != null) {
    const declared = Number(node.inputs);
    if (Number.isFinite(declared) && declared >= 0) return declared;
  }
  return INPUT_COUNTS.has(cls) ? INPUT_COUNTS.get(cls) : 0;
}

function topoSort(nodes, edges) {
  const byId = new Map();
  for (const node of nodes) {
    if (!node || node.id == null || node.id === "") {
      throw new Error("native kernel: every node needs a non-empty id");
    }
    if (byId.has(node.id)) throw new Error("native kernel: duplicate node id " + node.id);
    byId.set(node.id, node);
  }

  const indegree = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
    incoming.set(node.id, new Map());
  }

  for (const edge of edges) {
    if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) {
      throw new Error("native kernel: edge references an unknown node");
    }
    const port = edge.toPort == null ? 0 : Number(edge.toPort);
    if (!Number.isInteger(port) || port < 0) {
      throw new Error("native kernel: invalid toPort on edge " + edge.from + " -> " + edge.to);
    }
    const ports = incoming.get(edge.to);
    if (ports.has(port)) {
      throw new Error("native kernel: multiple edges feed " + edge.to + " port " + port);
    }
    ports.set(port, edge.from);
    outgoing.get(edge.from).push(edge);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    order.push(id);
    for (const edge of outgoing.get(id)) {
      const next = indegree.get(edge.to) - 1;
      indegree.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("native kernel: graph contains a cycle");
  }
  return { order, byId, incoming };
}

function describeSignal(value) {
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      return "matrix[" + value.length + "x" + value[0].length + "]";
    }
    let min = Infinity;
    let max = -Infinity;
    let binary = true;
    for (const item of value) {
      if (item !== 0 && item !== 1) binary = false;
      if (item < min) min = item;
      if (item > max) max = item;
    }
    if (binary) {
      const head = value.slice(0, 32).join("");
      return "bits[" + value.length + "]" + (head ? " head=" + head : "");
    }
    return "vector[" + value.length + "] range=[" + dsp.formatNumber(min, 6) + "," + dsp.formatNumber(max, 6) + "]";
  }
  return typeof value;
}

function runNative(graph) {
  if (!graph || typeof graph !== "object") {
    throw new Error("native kernel: graph must be an object with nodes and edges");
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const seed = (dsp.toNumber(graph.seed, 0x5eed1234) >>> 0);
  const rng = dsp.createRng(seed);
  const log = [];
  log.push("CommLab native JS kernel 0.1.0 | nodes=" + nodes.length + " edges=" + edges.length + " seed=" + seed);

  if (nodes.length === 0) {
    log.push("done: 0 figure(s)");
    return { results: [], metrics: [], log: log.join("\n") };
  }

  const sorted = topoSort(nodes, edges);
  const outputs = new Map();
  const results = [];
  const metrics = [];

  for (let index = 0; index < sorted.order.length; index++) {
    const id = sorted.order[index];
    const node = sorted.byId.get(id);
    const cls = canonicalClass(node.className);
    const handler = HANDLERS.get(cls);
    if (!handler) {
      throw new Error('native kernel: unsupported device class "' + node.className + '" at node ' + id);
    }

    const args = [];
    const ports = sorted.incoming.get(id);
    const count = inputCount(node, cls);
    for (let port = 0; port < count; port++) {
      const from = ports.get(port);
      if (from == null) {
        throw new Error('native kernel: "' + node.className + '" port ' + port + " is not connected");
      }
      if (!outputs.has(from)) {
        throw new Error("native kernel: upstream node " + from + " has no output yet");
      }
      args.push(outputs.get(from));
    }
    args.push(...cleanValues(node.values));

    if (cls.startsWith("Draw_")) {
      const svg = handler(args, { node, rng, log });
      const file = "svg_" + (index + 1) + ".svg";
      const device = node.componentName || node.className || cls;
      results.push({ device, file, svg });
      log.push("[" + (index + 1) + "] " + device + " (" + node.className + ") -> " + file + " (" + svg.length + " bytes)");
    } else {
      const handlerCtx = { node, rng, log };
      if (cls.startsWith("BERCalculation_")) handlerCtx.details = true;
      const value = handler(args, handlerCtx);
      if (cls.startsWith("BERCalculation_") && value && typeof value === "object" && Number.isFinite(value.ber)) {
        const device = node.componentName || node.className || cls;
        const errors = Number.isFinite(value.errors) ? value.errors : null;
        const total = Number.isFinite(value.total) ? value.total : null;
        metrics.push({
          device,
          kind: "metric",
          name: "BER",
          value: value.ber,
          errors,
          total,
        });
        outputs.set(id, value.ber);
        log.push(
          "[" + (index + 1) + "] " + device + " (" + node.className + ") -> BER=" +
          dsp.formatNumber(value.ber, 6) + " errors=" + errors + " total=" + total
        );
      } else {
        outputs.set(id, value);
        log.push("[" + (index + 1) + "] " + node.className + " -> " + describeSignal(value));
      }
    }
  }

  log.push("done: " + results.length + " figure(s)");
  return { results, metrics, log: log.join("\n") };
}

const SUPPORTED_CLASSES = Object.freeze(Array.from(HANDLERS.keys()).sort());

module.exports = runNative;
module.exports.runNative = runNative;
module.exports.canonicalClass = canonicalClass;
module.exports.loadDeviceModules = loadDeviceModules;
module.exports.SUPPORTED_CLASSES = SUPPORTED_CLASSES;
module.exports.DEVICE_MODULES = DEVICE_MODULES;
module.exports.DEVICE_WARNINGS = DEVICE_WARNINGS;
module.exports.default = runNative;