const ICONS = {
  "信号源": '<path d="M1 8c1.6-5 3.2-5 4.8 0s3.2 5 4.8 0 3.2-5 4.4 0"/>',
  "线路码型": '<path d="M1 11V5h4v6h4V5h4v6h3"/>',
  "调制与解调": '<path d="M1 8c1.5-4.5 3-4.5 4.5 0s3 4.5 4.5 0 3-4.5 4.5 0"/><path d="M1 4v8M15 4v8"/>',
  "滤波与信号变换": '<path d="M1 12h3l2-8h4l2 8h3"/>',
  "信源 / 信道编译码": '<path d="M5 3H2v10h3M11 3h3v10h-3"/><path d="M6 6h4M6 9h4"/>',
  "通用器件": '<path d="M8 2v12M2 8h12"/>',
  "观测与分析": '<path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="1.6"/>',
  "信道与均衡": '<path d="M1 9l3-4 3 6 3-5 3 3"/><path d="M1 13h14"/>',
  "其他": '<circle cx="8" cy="8" r="5"/>'
};

function icon(kind) {
  const d = ICONS[kind] || ICONS["其他"];
  return '<svg class="picon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
}
