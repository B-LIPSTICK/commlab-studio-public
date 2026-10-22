"use strict";

// Import a Rainier .ocj project into the new workbench graph.
// The .ocj format is JSON: componentList + connectionList.  Component
// modelProperty.typeName is the device class, spiceProperties are the
// editable parameters after the input ports, and port UUIDs identify wires.

function parseOcj(input, devices) {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || typeof doc !== "object") throw new Error("OCJ 文件不是有效 JSON 对象");

  const scene = (doc.experimentScene && doc.experimentScene) ||
    (doc.scene && doc.scene.experimentScene) || {};
  const comps = Array.isArray(scene.componentList) ? scene.componentList : [];
  const conns = Array.isArray(scene.connectionList) ? scene.connectionList : [];
  if (!comps.length) throw new Error("OCJ 中没有 componentList，无法导入");

  const byClass = new Map((Array.isArray(devices) ? devices : []).map((d) => [d.className, d]));
  const portMap = new Map();
  const nodes = [];
  const edges = [];
  const warnings = [];
  let seq = 0;

  for (const comp of comps) {
    const model = comp.modelProperty || {};
    const className = String(model.typeName || "").trim();
    if (!className) {
      warnings.push("有一个器件缺少 typeName，已跳过");
      continue;
    }
    const dev = byClass.get(className);
    if (!dev) {
      warnings.push("器件库没有 " + className + "，已跳过");
      continue;
    }
    seq += 1;
    const id = "n" + seq;
    const ports = Array.isArray(comp.portList) ? comp.portList : [];
    const ins = ports.filter((p) => /InputPortModel$/.test(String(p.type || "")));
    const outs = ports.filter((p) => /OutputPortModel$/.test(String(p.type || "")));
    ins.forEach((p, index) => {
      if (p && p.uuid) portMap.set(p.uuid, { id, side: "in", index });
    });
    outs.forEach((p, index) => {
      if (p && p.uuid) portMap.set(p.uuid, { id, side: "out", index });
    });

    const props = (model.additional && model.additional.spiceProperties) || [];
    const values = props.map((p) => {
      const v = p && p.value;
      if (v && v.value != null) return String(v.value);
      if (v && v.defaultValue != null) return String(v.defaultValue);
      return "";
    });

    const ui = comp.uiProperty || {};
    const x = Number(ui.x);
    const y = Number(ui.y);
    nodes.push({
      id,
      className,
      componentName: model.componentName || dev.componentName || className,
      label: model.label || "",
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      inputs: Number.isFinite(dev.inputs) ? dev.inputs : ins.length,
      outputs: Number.isFinite(dev.outputs) ? dev.outputs : outs.length,
      values,
    });
    if ((dev.inputs || 0) !== ins.length || (dev.outputs || 0) !== outs.length) {
      warnings.push(model.label || className + " 端口数不一致：OCJ " + ins.length + "/" + outs.length +
        "，器件库 " + (dev.inputs || 0) + "/" + (dev.outputs || 0));
    }
  }

  const usedInputs = new Set();
  for (const conn of conns) {
    const model = conn.modelProperty || {};
    const from = portMap.get(model.source_id);
    const to = portMap.get(model.target_id);
    if (!from || !to) {
      warnings.push("有一条连线找不到端口，已跳过：" + (model.name || conn.uuid || ""));
      continue;
    }
    if (from.side !== "out" || to.side !== "in") {
      warnings.push("有一条连线方向异常，已跳过：" + (model.name || conn.uuid || ""));
      continue;
    }
    const key = to.id + ":" + to.index;
    if (usedInputs.has(key)) warnings.push("输入口被重复接线，后一条会覆盖前一条：" + key);
    usedInputs.add(key);
    edges.push({ from: from.id, fromPort: from.index, to: to.id, toPort: to.index });
  }

  return {
    nodes,
    edges,
    warnings,
    meta: {
      componentCount: comps.length,
      connectionCount: conns.length,
      skippedComponents: comps.length - nodes.length,
      skippedConnections: conns.length - edges.length,
    },
  };
}

module.exports = { parseOcj };
