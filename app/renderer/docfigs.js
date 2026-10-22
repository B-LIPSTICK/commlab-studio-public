// 为平台原文中丢失的“曲线/星座/特性”类插图生成 SVG 示意
(function () {
  const ACCENT = "#A63A2C";
  const INK = "currentColor";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + z / 2);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const Q = (x) => 0.5 * erfc(x / Math.SQRT2);
  const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

  function frame(w, h, inner, note, caption) {
    return '<figure class="doc-figure"><div class="doc-figure-svg"><svg viewBox="0 0 ' + w + " " + h +
      '" width="100%" role="img" style="color:var(--ink)">' + inner + "</svg></div>" +
      (caption ? '<figcaption>' + esc(caption) + "</figcaption>" : "") +
      (note ? '<p class="fig-note">' + esc(note) + "</p>" : "") + "</figure>";
  }

  function berFigure(exp, caption) {
    const t = (exp.title || "") + " " + caption;
    let label = "BPSK / QPSK", fn = (x) => Q(Math.sqrt(2 * x));
    if (/DPSK/.test(t)) { label = "DPSK（近似）"; fn = (x) => 0.5 * Math.exp(-x); }
    else if (/OOK/.test(t)) { label = "OOK（相干）"; fn = (x) => Q(Math.sqrt(x)); }
    else if (/2FSK/.test(t)) { label = "2FSK（相干）"; fn = (x) => Q(Math.sqrt(x)); }
    else if (/16QAM|MQAM/.test(t)) {
      const M = /16QAM/.test(t) ? 16 : 16;
      const k = Math.log2(M);
      label = M + "QAM";
      fn = (x) => (4 / k) * Q(Math.sqrt((3 * k / (M - 1)) * x));
    }

    const W = 560, H = 280, L = 54, R = 18, T = 16, B = 40;
    const x0 = 0, x1 = 12, y0 = -6, y1 = 0;
    const px = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const py = (y) => T + ((y1 - y) / (y1 - y0)) * (H - T - B);
    const grid = [], ticks = [];
    for (let db = 0; db <= 12; db += 2) {
      grid.push('<line x1="' + px(db) + '" y1="' + T + '" x2="' + px(db) + '" y2="' + (H - B) + '" class="fig-grid"/>');
      ticks.push('<text x="' + px(db) + '" y="' + (H - B + 18) + '" text-anchor="middle" class="fig-tick">' + db + "</text>");
    }
    for (let e = 0; e >= -6; e--) {
      const y = py(e);
      grid.push('<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" class="fig-grid"/>');
      ticks.push('<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="fig-tick">10<tspan baseline-shift="super" font-size="8">' + e + "</tspan></text>");
    }
    const pts = [];
    for (let db = 0; db <= 12; db += 0.2) {
      const p = Math.max(1e-12, fn(Math.pow(10, db / 10)));
      const ly = Math.max(y0, Math.log10(p));
      pts.push((pts.length ? "L" : "M") + px(db).toFixed(1) + " " + py(ly).toFixed(1));
    }
    const inner = grid.join("") +
      '<path d="' + pts.join("") + '" fill="none" stroke="' + ACCENT + '" stroke-width="2"/>' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      ticks.join("") +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="fig-label">E_b / N_0（dB）</text>' +
      '<text x="14" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')" class="fig-label">P_b</text>' +
      '<text x="' + (W - R - 8) + '" y="' + (T + 14) + '" text-anchor="end" class="fig-label">' + esc(label) + "</text>";
    return frame(W, H, inner, "理论误比特率曲线示意；实际结果以「运行结果」中的仿真为准。", caption);
  }

  function constellationFigure(exp, caption) {
    const t = (exp.title || "") + " " + caption;
    const W = 340, H = 340, C = 170, S = 112;
    const pts = [];
    if (/16QAM|MQAM/.test(t)) {
      for (const a of [-3, -1, 1, 3]) for (const b of [-3, -1, 1, 3]) pts.push([a / 3, b / 3]);
    } else if (/QPSK/.test(t) || /四相/.test(t)) {
      const k = 1 / Math.SQRT2;
      for (const a of [-1, 1]) for (const b of [-1, 1]) pts.push([a * k, b * k]);
    } else if (/8PSK/.test(t)) {
      for (let i = 0; i < 8; i++) pts.push([Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
    } else {
      for (const a of [-1, 1]) for (const b of [-1, 1]) pts.push([a / Math.SQRT2, b / Math.SQRT2]);
    }
    const dots = pts.map(([x, y]) => '<circle cx="' + (C + x * S) + '" cy="' + (C - y * S) + '" r="4" fill="' + ACCENT + '"/>').join("");
    const inner = '<circle cx="' + C + '" cy="' + C + '" r="' + S + '" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="4 4"/>' +
      '<line x1="' + (C - S - 20) + '" y1="' + C + '" x2="' + (C + S + 20) + '" y2="' + C + '" class="fig-axis"/>' +
      '<line x1="' + C + '" y1="' + (C - S - 20) + '" x2="' + C + '" y2="' + (C + S + 20) + '" class="fig-axis"/>' +
      '<text x="' + (C + S + 24) + '" y="' + (C + 4) + '" class="fig-label">I</text>' +
      '<text x="' + (C + 4) + '" y="' + (C - S - 24) + '" class="fig-label">Q</text>' + dots;
    return frame(W, H, inner, "理想星座点示意；实际接收点会因噪声而散布在理想点周围。", caption);
  }

  function spectrumFigure(exp, caption) {
    const W = 560, H = 240, L = 50, R = 18, T = 16, B = 36;
    const px = (x) => L + ((x + 3) / 6) * (W - L - R);
    const py = (y) => T + (1 - y) * (H - T - B);
    const pts = [];
    for (let x = -3; x <= 3; x += 0.01) {
      const y = Math.pow(sinc(x), 2);
      pts.push((pts.length ? "L" : "M") + px(x).toFixed(1) + " " + py(y).toFixed(1));
    }
    const grid = [];
    for (let x = -3; x <= 3; x++) grid.push('<line x1="' + px(x) + '" y1="' + T + '" x2="' + px(x) + '" y2="' + (H - B) + '" class="fig-grid"/>');
    for (let y = 0; y <= 1; y += 0.25) grid.push('<line x1="' + L + '" y1="' + py(y) + '" x2="' + (W - R) + '" y2="' + py(y) + '" class="fig-grid"/>');
    const inner = grid.join("") + '<path d="' + pts.join("") + '" fill="none" stroke="' + ACCENT + '" stroke-width="2"/>' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="fig-label">f T_b</text>' +
      '<text x="14" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')" class="fig-label">P(f)</text>';
    return frame(W, H, inner, "归一化功率谱形状示意（sinc² 包络）；具体幅度与参数有关。", caption);
  }

  function alawFigure(caption) {
    const W = 380, H = 320, L = 52, R = 18, T = 18, B = 40, A = 87.6;
    const px = (x) => L + x * (W - L - R);
    const py = (y) => T + (1 - y) * (H - T - B);
    const f = (x) => (x < 1 / A ? (A * x) / (1 + Math.log(A)) : (1 + Math.log(A * x)) / (1 + Math.log(A)));
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      pts.push((i ? "L" : "M") + px(x).toFixed(1) + " " + py(f(x)).toFixed(1));
    }
    const inner = '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + T + '" class="fig-grid"/>' +
      '<path d="' + pts.join("") + '" fill="none" stroke="' + ACCENT + '" stroke-width="2"/>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="fig-label">归一化输入 |x|</text>' +
      '<text x="14" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')" class="fig-label">归一化输出 |y|</text>';
    return frame(W, H, inner, "A 律（A = 87.6）压缩特性；13 折线是其分段线性近似。", caption);
  }

  function deltaFigure(caption) {
    const W = 560, H = 220, L = 40, R = 18, T = 18, B = 34;
    const px = (x) => L + x * (W - L - R);
    const py = (y) => T + (1 - (y + 1.2) / 2.4) * (H - T - B);
    const sine = [];
    const step = [];
    let acc = 0, prev = 0;
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      sine.push((i ? "L" : "M") + px(x).toFixed(1) + " " + py(Math.sin(2 * Math.PI * x)).toFixed(1));
      const target = Math.sin(2 * Math.PI * x);
      if (target > acc + 0.08) acc += 0.16;
      else if (target < acc - 0.08) acc -= 0.16;
      step.push((i ? "L" : "M") + px(x).toFixed(1) + " " + py(acc).toFixed(1));
      prev = acc;
    }
    const inner = '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" class="fig-axis"/>' +
      '<path d="' + sine.join("") + '" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.6"/>' +
      '<path d="' + step.join("") + '" fill="none" stroke="' + ACCENT + '" stroke-width="2"/>' +
      '<text x="' + (W - R) + '" y="' + (T + 12) + '" text-anchor="end" class="fig-label">— 输入  — 阶梯近似</text>';
    return frame(W, H, inner, "增量调制（△M）波形示意：阶梯跟踪输入信号，输出 1 bit 的上升/下降指令。", caption);
  }

  function blockDiagram(blocks, caption, extra) {
    const W = 660, H = extra ? 250 : 190, BW = 96, BH = 44, GAP = 26;
    const total = blocks.length * BW + (blocks.length - 1) * GAP;
    const x0 = (W - total) / 2;
    const y = extra ? 64 : (H - BH) / 2 - 8;
    const boxes = [];
    const arrows = [];
    blocks.forEach((label, i) => {
      const x = x0 + i * (BW + GAP);
      boxes.push('<g class="tl-node"><rect x="' + x + '" y="' + y + '" width="' + BW + '" height="' + BH + '" rx="4"/>' +
        '<text x="' + (x + BW / 2) + '" y="' + (y + BH / 2 + 4) + '" text-anchor="middle">' + esc(label) + "</text></g>");
      if (i) {
        const x1 = x - GAP, x2 = x;
        arrows.push('<path d="M' + x1 + ' ' + (y + BH / 2) + ' H' + (x2 - 6) + '" class="tl-edge"/>');
        arrows.push('<path d="M' + (x2 - 7) + ' ' + (y + BH / 2 - 4) + ' L' + x2 + ' ' + (y + BH / 2) + ' L' + (x2 - 7) + ' ' + (y + BH / 2 + 4) + '" class="tl-arrow"/>');
      }
    });
    if (extra) {
      const ex = x0 + BW + GAP + (BW - BW) / 2;
      const ey = y + BH + 46;
      boxes.push('<g class="tl-node obs"><rect x="' + ex + '" y="' + ey + '" width="' + BW + '" height="' + (BH - 8) + '" rx="4"/>' +
        '<text x="' + (ex + BW / 2) + '" y="' + (ey + (BH - 8) / 2 + 4) + '" text-anchor="middle">' + esc(extra) + "</text></g>");
      const cx = ex + BW / 2;
      arrows.push('<path d="M' + cx + ' ' + ey + ' V' + (y + BH + 6) + '" class="tl-edge"/>');
      arrows.push('<path d="M' + (cx - 4) + ' ' + (y + BH + 7) + ' L' + cx + ' ' + (y + BH) + ' L' + (cx + 4) + ' ' + (y + BH + 7) + '" class="tl-arrow"/>');
    }
    return frame(W, H, arrows.join("") + boxes.join(""), "结构示意；具体器件与参数以平台为准。", caption);
  }

  function structuralFigure(caption) {
    let blocks = null, extra = null;
    if (/相关解调|最佳接收|相干解调/.test(caption)) {
      blocks = ["接收信号", "相乘器", "积分器", "抽样判决", "输出"]; extra = "本地载波";
    } else if (/鉴频|调频解调/.test(caption)) {
      blocks = ["中频输入", "限幅器", "鉴频器", "低通滤波", "输出"];
    } else if (/卷积码.*结构|编码器.*结构/.test(caption)) {
      blocks = ["输入", "移位寄存器", "模 2 加法器", "输出"];
    } else if (/横向滤波器|均衡器.*结构/.test(caption)) {
      blocks = ["输入", "延迟单元 T", "加权求和", "判决", "输出"];
    }
    return blocks ? blockDiagram(blocks, caption, extra) : "";
  }

  window.renderCaptionFigure = function (exp, caption) {
    const t = caption || "";
    if (/误比特率|误码率|P_b|Pb/.test(t)) return berFigure(exp, t);
    if (/星座图/.test(t)) return constellationFigure(exp, t);
    if (/功率谱/.test(t)) return spectrumFigure(exp, t);
    if (/A律13折线|13折线/.test(t)) return alawFigure(t);
    if (/增量调制波形/.test(t)) return deltaFigure(t);
    const s = structuralFigure(t);
    if (s) return s;
    return "";
  };
})();