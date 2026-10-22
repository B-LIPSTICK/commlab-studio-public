// 场景脚本生成：experiments.json 的 chain → Octave 脚本
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FN = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, "data", "functions.json"), "utf8")).functions
);

// Rainier 的 64QAM 路径不稳定；保留星座图实验含义，默认最多 16 阶。
// 未来 native 后端可通过 simulation.maxM 或后端自身能力解除该限制。
const HARD_QAM_MAX_M = 16;

function resolveFn(fn) {
  let f = fn;
  if (f.startsWith("Sourse_")) f = "Source_" + f.slice(7);
  if (FN.has(f)) return f;
  if (FN.has(f + "_Comm")) return f + "_Comm";
  return f;
}

function clampConstellationM(fn, args, maxM) {
  const base = String(fn || "").replace(/_Comm$/, "");
  if (!/^(SigTransfer_Bi2toM|Modulation_PskMod|Modulation_QamMod)$/.test(base)) {
    return { args, changed: false, from: null, to: null };
  }
  const cap = Number.isFinite(maxM) && maxM > 1
    ? Math.floor(maxM)
    : (base === "Modulation_QamMod" ? HARD_QAM_MAX_M : null);
  if (!cap) return { args, changed: false, from: null, to: null };

  const parts = String(args).split(",");
  const last = parts[parts.length - 1];
  const trimmed = String(last || "").trim();
  if (!/^\d+$/.test(trimmed)) return { args, changed: false, from: null, to: null };
  const m = Number(trimmed);
  if (m <= cap) return { args, changed: false, from: null, to: null };
  parts[parts.length - 1] = String(cap);
  return { args: parts.join(","), changed: true, from: m, to: cap };
}

function runDirective(exp) {
  const sim = (exp && exp.simulation) || {};
  const cfg = {};
  if (Number.isFinite(sim.timeoutMs) && sim.timeoutMs > 0) cfg.timeoutMs = Math.round(sim.timeoutMs);
  if (Number.isFinite(sim.retries) && sim.retries >= 0) cfg.retries = Math.floor(sim.retries);
  if (typeof sim.backend === "string" && sim.backend.trim()) cfg.backend = sim.backend.trim();
  if (Number.isFinite(sim.maxM) && sim.maxM > 1) cfg.maxM = Math.floor(sim.maxM);
  if (!Object.keys(cfg).length) return { text: "", options: cfg };
  return { text: "% commlab-run " + JSON.stringify(cfg) + "\n", options: cfg };
}

function buildScene(exp) {
  const vars = new Map();
  const lines = [];
  const manifest = [];
  const warnings = [];
  const directive = runDirective(exp);
  if (directive.text) lines.push(directive.text.trimEnd());
  let n = 0;

  const subst = (arg) => {
    const t = arg.trim();
    return vars.has(t) ? "v" + vars.get(t) : t;
  };

  for (const c of exp.chain) {
    let args = c.args.split(",").map(subst).join(",");
    const safe = clampConstellationM(c.fn, args, directive.options.maxM);
    if (safe.changed) {
      args = safe.args;
      warnings.push({
        code: "CONSTELLATION_M_CAPPED",
        fn: c.fn,
        from: safe.from,
        to: safe.to,
        message: `${c.fn}: M=${safe.from} 超出 Rainier 安全范围，已降为 M=${safe.to}`,
      });
    }
    n += 1;
    vars.set(c.var, n);
    lines.push(`v${n} = ${resolveFn(c.fn)}(${args});`);
  }

  for (const o of exp.observers) {
    const args = o.args.split(",").map(subst).join(",");
    const fn = resolveFn(o.fn);
    n += 1;
    if (!fn.startsWith("Draw_")) {
      lines.push("try");
      lines.push(`  ${fn}(${args});`);
      lines.push("catch e");
      lines.push("  disp(e.message);");
      lines.push("end");
      manifest.push({ file: null, fn, device: o.devName || fn });
      continue;
    }
    lines.push(`${fn}(${args});`);
    const base = fn.replace(/^Draw_/, "").replace(/_Comm$/, "");
    const file = `svg_${base}_${n}.svg`;
    lines.push(`print ${file}`);
    manifest.push({ file, fn, device: o.devName || fn });
  }

  lines.push("save rainier.mat");
  return {
    script: lines.join("\n") + "\n",
    manifest,
    warnings,
    runOptions: directive.options,
  };
}

module.exports = { buildScene, resolveFn, clampConstellationM, HARD_QAM_MAX_M };
