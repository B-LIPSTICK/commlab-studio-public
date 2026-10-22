"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { marked } = require("marked");

const COVER = Object.freeze({
  university: "实验报告",
  course: "数字传输系统",
  type: "虚拟仿真实验",
  className: "",
  studentId: "",
  studentName: "",
});

const FRIENDLY_NAMES = Object.freeze({
  Source_Cosin: "余弦信号源",
  Source_Randi_Comm: "随机序列码产生器",
  LineCode_Snrz_Comm: "单极性不归零码",
  LineCode_Manchester_Comm: "曼彻斯特码",
  ComUse_Sample: "采样器",
  SourceCoding_PCMQuantiz: "PCM量化器",
  SourceCoding_PCMCoding: "PCM编码器",
  SourceCoding_PCMDecoding: "PCM译码器",
});

const MARKED_OPTIONS = Object.freeze({
  gfm: true,
  breaks: false,
  mangle: false,
  headerIds: false,
});

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function inline(text) {
  return marked.parseInline(String(text == null ? "" : text), MARKED_OPTIONS);
}

function cleanSvg(value) {
  let svg = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  if (!svg) return "";
  svg = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return /<svg[\s>]/i.test(svg) ? svg : "";
}

function normalizeMarkdown(md, title) {
  const source = String(md == null ? "" : md).replace(/\r\n/g, "\n");
  const idx = source.indexOf("\n---\n");
  const body = idx >= 0 ? source.slice(idx + 5) : source;
  const lines = body.split("\n");
  const out = [];
  let droppedTitle = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(""); continue; }
    if (line.startsWith("# ")) continue;
    if (!droppedTitle && line === title) { droppedTitle = true; continue; }
    if (/^(课件资料|开始实验|插件下载|请求智能指导)$/.test(line)) continue;
    if (line.includes("暂未上传课件资料")) continue;
    if (line.includes("Microsoft YaHei")) continue;
    if (/^保存并退出\s*提交$/.test(line)) continue;
    if (/^平台图片[:：]/.test(line)) continue;
    if (/^插件下载\s+请求智能指导$/.test(line)) continue;
    if (line === "实验要求" || line === "提交报告") {
      out.push("## " + line, "");
      continue;
    }
    if (/^[一二三四五六七八九十]、/.test(line)) {
      out.push("### " + line, "");
      continue;
    }
    out.push(raw);
  }
  return out.join("\n");
}

function parseSections(markdown) {
  const lines = String(markdown == null ? "" : markdown).split("\n");
  const sections = [];
  let current = { title: "", body: [] };
  for (const line of lines) {
    const match = line.match(/^#{2,3}\s+(.*)$/);
    if (match) {
      if (current.title || current.body.join("").trim()) sections.push(current);
      current = { title: match[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.title || current.body.join("").trim()) sections.push(current);
  return sections;
}

function findSection(sections, patterns) {
  return (sections || []).find((section) => patterns.some((re) => re.test(section.title || ""))) || null;
}

function splitNumberedBlocks(lines) {
  const items = [];
  let current = null;
  for (const raw of lines || []) {
    const line = String(raw == null ? "" : raw).trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s*[、.．]\s*(.*)$/);
    if (match) {
      if (current) items.push(current);
      current = { number: match[1], lead: match[2], rest: [] };
    } else if (current) {
      current.rest.push(line);
    } else {
      current = { number: "", lead: line, rest: [] };
    }
  }
  if (current) items.push(current);
  return items.filter((item) => item.lead || item.rest.length);
}

function renderNumberedList(lines, className) {
  const items = splitNumberedBlocks(lines);
  if (!items.length) return renderProse(lines);
  return '<ol class="' + (className || "") + '">' + items.map((item) => {
    const detail = item.rest.length
      ? '<div class="item-detail">' + item.rest.map((line) => "<p>" + inline(line) + "</p>").join("") + "</div>"
      : "";
    return "<li>" + inline(item.lead) + detail + "</li>";
  }).join("") + "</ol>";
}

function renderProse(lines) {
  const text = (Array.isArray(lines) ? lines.join("\n") : String(lines == null ? "" : lines))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";

  const prepared = text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (/^图\s*\d+(?:\.\d+)?\s+/.test(trimmed)) {
      return '<p class="fig-caption">' + esc(trimmed) + "</p>";
    }
    if (/^表\s*\d+(?:\.\d+)?\s+/.test(trimmed)) {
      return '<p class="table-caption">' + esc(trimmed) + "</p>";
    }
    return line;
  }).join("\n");

  return marked.parse(prepared, MARKED_OPTIONS).replace(/<p>\s*<\/p>/g, "");
}

function friendlyName(exp, item) {
  if (!item) return "";
  const known = FRIENDLY_NAMES[item.fn];
  if (known) return known;
  const name = item.devName || item.fn || "";
  if (/^(ComUse|Source|SourceCoding|LineCode|Draw)_/.test(name)) return item.fn || name;
  return name;
}

function renderEquipment(exp) {
  const devices = Array.isArray(exp.devices) ? exp.devices : [];
  const unique = [];
  for (const device of devices) {
    const name = String(device == null ? "" : device).trim();
    if (name && !unique.includes(name)) unique.push(name);
  }
  if (!unique.length) return '<p class="muted">本次实验未登记器材名称。</p>';
  return '<ul class="equipment">' + unique.map((name) => "<li>" + esc(name) + "</li>").join("") + "</ul>";
}

function renderDesign(exp) {
  const chain = Array.isArray(exp.chain) ? exp.chain : [];
  const observers = Array.isArray(exp.observers) ? exp.observers : [];
  const parts = ['<h4>仿真方案与器件链路</h4>'];

  if (!chain.length) {
    parts.push('<p class="muted">当前报告没有可用的器件链路信息。</p>');
  } else {
    parts.push('<table class="data-table"><thead><tr><th>序号</th><th>器件</th><th>变量</th><th>参数 / 连接</th></tr></thead><tbody>');
    chain.forEach((item, index) => {
      parts.push("<tr><td>" + (index + 1) + "</td><td>" + esc(friendlyName(exp, item)) +
        "</td><td><code>" + esc(item.var || "") + "</code></td><td><code>" + esc(item.args || "") + "</code></td></tr>");
    });
    parts.push("</tbody></table>");
  }

  if (observers.length) {
    parts.push('<table class="data-table"><thead><tr><th>观测序号</th><th>观测器件</th><th>信号 / 参数</th></tr></thead><tbody>');
    observers.forEach((item, index) => {
      parts.push("<tr><td>" + (index + 1) + "</td><td>" + esc(item.devName || item.fn || "观测器件") +
        "</td><td><code>" + esc(item.args || "") + "</code></td></tr>");
    });
    parts.push("</tbody></table>");
  }

  parts.push('<p class="note">以上链路与参数由当前实验配置自动生成；仿真结果来自内置 native 内核，不依赖外部 LaTeX。</p>');
  return parts.join("");
}

function sourceNameForArg(exp, args) {
  const first = String(args == null ? "" : args).split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  const source = (exp.chain || []).find((item) => String(item.var) === first);
  return source ? friendlyName(exp, source) : "";
}

function resultCaption(exp, result, index) {
  const observer = (exp.observers || [])[index] || null;
  const fn = String((observer && observer.fn) || (result && result.fn) || "");
  const source = sourceNameForArg(exp, observer && observer.args);
  let kind = "";
  if (/PowerSpectrum/i.test(fn)) kind = "功率谱";
  else if (/Stem/i.test(fn)) kind = "离散序列";
  else if (/Plot/i.test(fn)) kind = "波形";
  if (source && kind) return source + kind;
  return (observer && observer.devName) || (result && result.device) || (result && result.fn) || "仿真结果";
}

function formatMetricValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toExponential(2) : "—";
}

function renderMetrics(metrics) {
  const items = (Array.isArray(metrics) ? metrics : []).filter((item) => item && item.kind === "metric");
  if (!items.length) return "";
  return '<h4>仿真指标</h4><table class="data-table metrics"><thead><tr><th>指标</th><th>器件</th><th>数值</th><th>错误 / 总数</th></tr></thead><tbody>' +
    items.map((item) => {
      const label = String(item.name || "指标").toUpperCase() === "BER" ? "误码率" : String(item.name || "指标");
      const errors = item.errors == null ? "—" : String(item.errors);
      const total = item.total == null ? "—" : String(item.total);
      return "<tr><td>" + esc(label) + "</td><td>" + esc(item.device || "") + "</td><td><code>" +
        esc(formatMetricValue(item.value != null ? item.value : item.ber)) + "</code></td><td><code>" +
        esc(errors + " / " + total) + "</code></td></tr>";
    }).join("") + "</tbody></table>";
}

function renderResults(exp, run) {
  const results = run && Array.isArray(run.results) ? run.results : [];
  const metrics = run && Array.isArray(run.metrics) ? run.metrics : [];
  if (!results.length) {
    return '<div class="empty-result"><p>生成报告时尚未记录该实验的仿真结果。</p>' +
      '<p>请先在主界面点击“运行仿真”，再导出实验报告；当前 PDF 仍保留完整的实验目的、器材、原理与步骤。</p></div>' +
      renderMetrics(metrics);
  }

  const figures = results.map((item, index) => {
    const svg = cleanSvg(item && item.svg);
    if (!svg) return "";
    const caption = resultCaption(exp, item, index);
    const expNo = exp.expNo || exp.order || "X";
    return '<figure class="figure"><div class="figure-frame">' + svg + "</div><figcaption>" +
      '<span class="fig-no">图 ' + esc(expNo + "." + (index + 1)) + "</span> " + esc(caption) +
      "</figcaption></figure>";
  }).filter(Boolean).join("");

  return (figures || '<div class="empty-result"><p>运行结果中没有可嵌入的 SVG 图形。</p></div>') + renderMetrics(metrics);
}

function renderConclusion(exp, run, questionsSection) {
  const results = run && Array.isArray(run.results) ? run.results : [];
  const status = run && run.status ? run.status : (run && run.ok === false ? "failed" : "ok");
  let conclusion = "";
  if (run && run.ok !== false && results.length) {
    conclusion = "本次实验完成“" + esc(exp.title || "当前实验") + "”的虚拟仿真，后端为 " +
      esc(run.backend || "native") + "，共生成 " + results.length + " 张结果图。结果图按实验配置顺序嵌入，"
      + "可用于观察信号波形、离散序列或功率谱等输出。";
  } else if (run) {
    conclusion = "本次运行状态为“" + esc(status) + "”，未取得完整的仿真结果图。请结合运行日志检查实验配置后重新运行。";
  } else {
    conclusion = "本次报告生成时尚未记录仿真运行结果，仿真结果部分为空；请先在主界面运行当前实验后重新导出。";
  }

  const questionLines = questionsSection && Array.isArray(questionsSection.body) ? questionsSection.body : [];
  const questions = questionLines.length
    ? renderNumberedList(questionLines, "questions")
    : '<p class="muted">请结合实验目的、原理和结果图，整理实验观察与结论。</p>';

  return '<h4>结论</h4><p>' + conclusion + "</p><h4>提交问题</h4>" + questions;
}

function buildReportHtml(options) {
  const exp = (options && options.experiment) || {};
  const cover = Object.freeze({ ...COVER, ...((options && options.cover) || {}) });
  const markdown = (options && options.markdown) || "";
  const run = (options && options.run) || null;
  const title = exp.title || "未命名实验";
  const body = normalizeMarkdown(markdown, title);
  const sections = parseSections(body);

  const purposeSection = findSection(sections, [/实验目的/]);
  const theorySection = findSection(sections, [/实验的理论基础|实验原理/]);
  const stepsSection = findSection(sections, [/实验内容|步骤/]);
  const questionsSection = findSection(sections, [/提交报告|提交问题/]);

  const purposeHtml = purposeSection
    ? renderNumberedList(purposeSection.body, "purpose")
    : '<p class="muted">请根据平台实验要求补充实验目的。</p>';
  const equipmentHtml = renderEquipment(exp);
  const theoryHtml = theorySection
    ? renderProse(theorySection.body)
    : '<p class="muted">请根据平台实验要求补充实验原理。</p>';
  const stepsHtml = stepsSection
    ? renderNumberedList(stepsSection.body, "steps")
    : '<p class="muted">请根据平台实验要求补充实验内容及步骤。</p>';
  const resultsHtml = renderResults(exp, run);
  const conclusionHtml = renderConclusion(exp, run, questionsSection);

  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const expNo = exp.expNo || exp.order || "X";

  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n' +
    '<title>' + esc(cover.university + " - " + title) + '</title>\n<style>\n' + reportCss() + '\n</style>\n</head>\n<body>\n' +
    '<section class="cover">' +
      '<div class="cover-rule"></div>' +
      '<h1>' + esc(cover.university) + '</h1>' +
      '<p class="cover-sub">' + esc(cover.course) + ' · ' + esc(cover.type) + '</p>' +
      '<div class="cover-fields">' +
        coverField("所属课程", cover.course) +
        coverField("实验类型", cover.type) +
        coverField("实验题目名称", title, "title-field") +
        coverField("班级", cover.className) +
        coverField("学号", cover.studentId) +
        coverField("姓名", cover.studentName) +
        coverField("实验日期", "") +
        '<div class="field score-field"><span class="label">成绩</span><span class="score-line"></span></div>' +
      '</div>' +
      '<p class="cover-foot">实验序号 ' + esc(expNo) + ' · 报告由 CommLab Studio 生成</p>' +
    '</section>\n' +
    '<main class="report">' +
      '<header class="report-head">' +
        '<p class="kicker">' + esc(cover.university) + '</p>' +
        '<h2>' + esc(title) + '</h2>' +
        '<p class="report-meta">课程：' + esc(cover.course) + '　实验类型：' + esc(cover.type) +
          '　班级：' + esc(cover.className) + '　学号：' + esc(cover.studentId) +
          '　姓名：' + esc(cover.studentName) + '</p>' +
      '</header>' +
      chapter("一", "实验目的", purposeHtml) +
      chapter("二", "实验器材", equipmentHtml) +
      chapter("三", "实验原理及方案设计", theoryHtml + renderDesign(exp)) +
      chapter("四", "实验内容及步骤", stepsHtml) +
      chapter("五", "仿真结果", resultsHtml) +
      chapter("六", "结论 / 提交问题", conclusionHtml) +
      '<p class="report-foot">生成时间：' + esc(generatedAt) + '　|　课程：' + esc(cover.course) +
        '　|　实验序号：' + esc(expNo) + '</p>' +
    '</main>\n</body>\n</html>\n';
}

function coverField(label, value, extraClass) {
  return '<div class="field ' + (extraClass || "") + '"><span class="label">' + esc(label) +
    '</span><span class="value">' + esc(value || "") + '</span></div>';
}

function chapter(number, title, content) {
  return '<section class="chapter"><h3><span class="chapter-no">' + esc(number) + '</span>' +
    esc(title) + '</h3><div class="chapter-body">' + content + '</div></section>';
}

function reportCss() {
  return `
@page { size: A4; margin: 18mm 18mm 20mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #1B1D21; }
body {
  font-family: "Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", serif;
  font-size: 10.8pt;
  line-height: 1.78;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
code { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: .9em; }
.cover {
  min-height: 252mm;
  page-break-after: always;
  break-after: page;
  position: relative;
}
.cover-rule { width: 100%; height: 2px; background: #A63A2C; margin: 0 0 8mm; }
.cover h1 {
  margin: 27mm 0 0;
  text-align: center;
  font-size: 31pt;
  line-height: 1.25;
  letter-spacing: .12em;
  font-weight: 700;
}
.cover-sub {
  margin: 7mm 0 0;
  text-align: center;
  font-size: 11pt;
  letter-spacing: .22em;
  color: #6E7278;
}
.cover-fields { width: 154mm; margin: 44mm auto 0; }
.field {
  display: flex;
  align-items: flex-end;
  gap: 4mm;
  margin: 0 0 6.5mm;
  font-size: 13.5pt;
  line-height: 1.5;
}
.field .label { flex: 0 0 36mm; white-space: nowrap; letter-spacing: .06em; }
.field .value {
  flex: 1;
  min-height: 7mm;
  padding: 0 2mm 1mm;
  border-bottom: 1px solid #1B1D21;
  text-align: center;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.field.title-field .value { font-size: 12.5pt; font-weight: 600; }
.score-field { align-items: center; }
.score-line { display: block; flex: 1; height: 1.4pt; background: #A63A2C; margin: 0 0 1mm; }
.cover-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  text-align: center;
  font-size: 8.5pt;
  letter-spacing: .08em;
  color: #8A8F97;
}
.report { display: block; }
.report-head { margin: 0 0 10mm; padding-bottom: 5mm; border-bottom: 1px solid #D8D1C1; }
.kicker {
  margin: 0 0 2mm;
  color: #A63A2C;
  font-size: 9pt;
  letter-spacing: .18em;
}
.report-head h2 {
  margin: 0;
  font-size: 20pt;
  line-height: 1.35;
  letter-spacing: .02em;
}
.report-meta { margin: 4mm 0 0; color: #6E7278; font-size: 9pt; line-height: 1.7; }
.chapter { margin: 0 0 8mm; }
.chapter h3 {
  display: flex;
  align-items: baseline;
  gap: 2.5mm;
  margin: 0 0 3.5mm;
  padding-bottom: 2mm;
  border-bottom: 1.4px solid #A63A2C;
  font-size: 13.5pt;
  line-height: 1.45;
  break-after: avoid;
}
.chapter-no { color: #A63A2C; font-size: 10pt; letter-spacing: .06em; }
.chapter-body { text-align: justify; text-justify: inter-ideograph; }
.chapter-body p { margin: 0 0 2.6mm; text-indent: 2em; }
.chapter-body h4 {
  margin: 4mm 0 2mm;
  font-size: 11pt;
  color: #1B1D21;
  break-after: avoid;
}
.chapter-body h5 { margin: 3mm 0 1.5mm; font-size: 10.5pt; }
ul, ol { margin: 0 0 3mm; padding-left: 2em; }
li { margin: 0 0 1.4mm; }
.equipment { columns: 2; column-gap: 10mm; padding-left: 1.5em; }
.equipment li { break-inside: avoid; }
.item-detail { margin-top: 1mm; }
.item-detail p { margin: 0 0 1mm; text-indent: 0; color: #3A3E45; }
.data-table {
  width: 100%;
  margin: 2mm 0 4mm;
  border-collapse: collapse;
  font-size: 8.8pt;
  line-height: 1.55;
  break-inside: avoid;
}
.data-table th, .data-table td {
  border: 1px solid #D8D1C1;
  padding: 1.4mm 1.8mm;
  vertical-align: top;
  text-align: left;
}
.data-table th { background: #F4F1E8; font-weight: 600; }
.figure {
  margin: 4mm 0 6mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.figure-frame {
  width: 100%;
  padding: 2.5mm;
  border: 1px solid #D8D1C1;
  background: #fff;
  overflow: hidden;
}
.figure-frame svg {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
}
.figure figcaption {
  margin-top: 2mm;
  text-align: center;
  font-size: 9pt;
  color: #3A3E45;
}
.fig-no { color: #A63A2C; font-weight: 600; margin-right: 1.5mm; }
.fig-caption, .table-caption {
  text-align: center !important;
  text-indent: 0 !important;
  font-size: 9pt;
  color: #6E7278;
  margin: 1.5mm 0 2mm !important;
}
.note, .muted { color: #6E7278; font-size: 9pt; }
.note { text-indent: 0 !important; }
.empty-result {
  padding: 5mm 6mm;
  border: 1px dashed #CFC8B8;
  background: #F4F1E8;
  color: #6E7278;
}
.empty-result p { text-indent: 0; margin: 0 0 1.5mm; }
.questions li { margin-bottom: 2mm; }
.report-foot {
  margin: 12mm 0 0;
  padding-top: 3mm;
  border-top: 1px solid #E2DDD1;
  color: #8A8F97;
  font-size: 8pt;
  text-align: center;
  text-indent: 0;
}
@media print {
  .chapter { break-inside: auto; }
  .figure, .data-table, .empty-result { break-inside: avoid; page-break-inside: avoid; }
}
`;
}

function buildReportFilename(experiment) {
  const exp = experiment || {};
  const title = String(exp.title || "实验报告")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const expNo = String(exp.expNo || exp.order || "").replace(/[\\/:*?"<>|]+/g, "_");
  return ("实验报告_" + (expNo ? expNo + "_" : "") + title + ".pdf").replace(/_+/g, "_");
}

async function exportReportPdf(options) {
  const html = String((options && options.html) || "");
  const pdfPath = String((options && options.pdfPath) || "");
  if (!html) throw new Error("报告 HTML 为空");
  if (!pdfPath) throw new Error("缺少 PDF 保存路径");

  const { BrowserWindow } = require("electron");
  if (typeof BrowserWindow !== "function") throw new Error("当前进程不是 Electron 主进程，无法生成 PDF");

  const target = path.resolve(pdfPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "commlab-report-"));
  const htmlPath = path.join(tempDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      backgroundColor: "#ffffff",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        devTools: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await win.loadFile(htmlPath);
    await new Promise((resolve) => setTimeout(resolve, 220));

    const pdf = await win.webContents.printToPDF({
      landscape: false,
      displayHeaderFooter: true,
      printBackground: true,
      scale: 1,
      pageSize: "A4",
      margins: { marginType: "none" },
      preferCSSPageSize: true,
      headerTemplate: "<div></div>",
      footerTemplate: '<div style="width:100%;font-size:8px;text-align:center;color:#6E7278;font-family:SimSun,serif;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
      generateTaggedPDF: false,
    });
    fs.writeFileSync(target, pdf);
    return { ok: true, path: target, bytes: pdf.length };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  COVER,
  buildReportHtml,
  buildReportFilename,
  exportReportPdf,
  normalizeMarkdown,
  parseSections,
  cleanSvg,
};
