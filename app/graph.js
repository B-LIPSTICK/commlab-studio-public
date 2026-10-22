const HARD_QAM_MAX_M = 16;

function clampQamValues(node) {
  const cls = String((node && node.className) || "").replace(/_Comm$/, "");
  const values = ((node && node.values) || []).slice();
  if (cls !== "Modulation_QamMod") return { values, warning: null };
  for (let i = values.length - 1; i >= 0; i--) {
    const text = String(values[i] == null ? "" : values[i]).trim();
    if (!/^\d+$/.test(text)) continue;
    const m = Number(text);
    if (m <= HARD_QAM_MAX_M) break;
    values[i] = String(HARD_QAM_MAX_M);
    return {
      values,
      warning: {
        code: "CONSTELLATION_M_CAPPED",
        nodeId: node.id,
        fn: cls,
        from: m,
        to: HARD_QAM_MAX_M,
        message: `${cls}: M=${m} 超出 Rainier 安全范围，已降为 M=${HARD_QAM_MAX_M}`,
      },
    };
  }
  return { values, warning: null };
}

function buildGraphScript(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, {});
    incoming.get(e.to)[e.toPort] = e.from;
  }

  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  const queue = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of edges) {
      if (e.from === id) {
        indeg.set(e.to, indeg.get(e.to) - 1);
        if (indeg.get(e.to) === 0) queue.push(e.to);
      }
    }
  }
  if (order.length !== nodes.length) throw new Error("电路里有环，无法确定执行顺序");

  const lines = [];
  const manifest = [];
  const warnings = [];
  const varOf = new Map();
  let idx = 0;

  for (const id of order) {
    const n = byId.get(id);
    const ins = incoming.get(id) || {};
    const args = [];
    for (let i = 0; i < (n.inputs || 0); i++) {
      const src = ins[i];
      if (src && varOf.has(src)) args.push(varOf.get(src));
      else args.push("");
    }
    while (args.length && args[args.length - 1] === "") args.pop();
    if (args.some((a) => a === "")) {
      throw new Error("「" + (n.componentName || n.className) + "」有输入口没接线");
    }
    const safe = clampQamValues(n);
    if (safe.warning) warnings.push(safe.warning);
    const vals = safe.values;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v !== "" && v != null) args.push(String(v));
    }
    idx += 1;
    const isDraw = /^Draw_/.test(n.className);
    if (isDraw) {
      lines.push(n.className + "(" + args.join(",") + ");");
      const file = "svg_" + idx + ".svg";
      lines.push("print " + file);
      manifest.push({ file, device: n.componentName || n.className });
    } else {
      const v = "v" + idx;
      lines.push(v + " = " + n.className + "(" + args.join(",") + ");");
      varOf.set(id, v);
    }
  }
  lines.push("save rainier.mat");
  return { script: lines.join("\n") + "\n", manifest, warnings };
}

module.exports = { buildGraphScript, HARD_QAM_MAX_M };
