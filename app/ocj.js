// 把新版工作台的图转换成老版 Rainier 的 .ocj 场景（单向导出）
const { randomUUID } = require("crypto");
const TEMPLATES = require("../data/ocj-templates.json");

const clone = (o) => JSON.parse(JSON.stringify(o));

function buildOcj(nodes, edges, meta = {}) {
  const warnings = [];
  const comps = [];
  const map = new Map();

  const xs = nodes.map((n) => Number(n.x) || 0);
  const ys = nodes.map((n) => Number(n.y) || 0);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;

  let label = 0;
  for (const n of nodes) {
    const cn = n.className || (n.dev && n.dev.className);
    const tpl = TEMPLATES[cn];
    if (!tpl) {
      warnings.push("老版器件库没有 " + cn + "，已跳过");
      continue;
    }
    const comp = clone(tpl);
    comp.type = "Rainier.UI.V2.PmsModel";
    comp.uuid = randomUUID();
    const x = Math.round(380 + ((Number(n.x) || 0) - minX) * 1.2);
    const y = Math.round(120 + ((Number(n.y) || 0) - minY) * 1.5);
    comp.uiProperty = comp.uiProperty || {};
    comp.uiProperty.x = x;
    comp.uiProperty.y = y;
    comp.modelProperty = comp.modelProperty || {};
    comp.modelProperty.locator = { type: "default", x, y };
    label += 1;
    comp.modelProperty.label = "U" + label;

    for (const p of comp.portList || []) p.uuid = randomUUID();

    const sp = (comp.modelProperty.additional && comp.modelProperty.additional.spiceProperties) || [];
    const vals = n.values || [];
    for (let i = 0; i < sp.length && i < vals.length; i++) {
      const v = vals[i];
      if (v === "" || v == null) continue;
      sp[i].value = sp[i].value || {};
      sp[i].value.value = String(v);
    }

    const ins = (comp.portList || []).filter((p) => /InputPortModel$/.test(p.type || ""));
    const outs = (comp.portList || []).filter((p) => /OutputPortModel$/.test(p.type || ""));
    map.set(n.id, { uuid: comp.uuid, x, y, ins, outs });
    comps.push(comp);
  }

  const conns = [];
  let ci = 0;
  for (const e of edges || []) {
    const a = map.get(e.from);
    const b = map.get(e.to);
    if (!a || !b) continue;
    const sp = a.outs[Number(e.fromPort) || 0];
    const tp = b.ins[Number(e.toPort) || 0];
    if (!sp || !tp) {
      warnings.push("有一条连线的端口超出范围，已跳过");
      continue;
    }
    const sx = a.x + sp.modelProperty.locator.x;
    const sy = a.y + sp.modelProperty.locator.y;
    const tx = b.x + tp.modelProperty.locator.x;
    const ty = b.y + tp.modelProperty.locator.y;
    const mx = Math.round((sx + tx) / 2);
    ci += 1;
    conns.push({
      type: "Rainier.UI.V2.ConnectionModel",
      uuid: randomUUID(),
      uiProperty: { stroke: 1, radius: 1, color: "#00A8F0" },
      modelProperty: {
        name: "connection" + ci,
        router: "Rainier.UI.V2.InteractiveManhattanRouter",
        segments: [
          { start_x: sx, start_y: sy, end_x: mx, end_y: sy, type: "horizontal" },
          { start_x: mx, start_y: sy, end_x: mx, end_y: ty, type: "vertical" },
          { start_x: mx, start_y: ty, end_x: tx, end_y: ty, type: "horizontal" },
        ],
        source_id: sp.uuid,
        target_id: tp.uuid,
        source_parent_id: a.uuid,
        target_parent_id: b.uuid,
      },
    });
  }

  return {
    scene: {
      experimentInfo: { configuretion: meta.configuretion || "", zoom: Number(meta.zoom) || 1.1 },
      experimentScene: { componentList: comps, connectionList: conns },
      stepByStep: [],
    },
    warnings,
  };
}

module.exports = { buildOcj };

