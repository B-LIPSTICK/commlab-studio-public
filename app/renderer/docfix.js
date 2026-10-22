// 平台原文里丢失的公式图，用原生 MathML 补回（Chromium 直接渲染，无外部依赖）
window.DOC_FORMULAS = {
  1: [{
    match: "其功率谱密度表达式如下：",
    note: "矩形脉冲、幅度 A、码元周期 T_b；f = 0 时 P(f) = 0，因此无直流分量。",
    mathml: '<math display="block"><mi>P</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><msup><mi>A</mi><mn>2</mn></msup><msub><mi>T</mi><mi>b</mi></msub><msup><mrow><mo>[</mo><mfrac><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>/</mo><mn>2</mn><mo>)</mo></mrow><mrow><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>/</mo><mn>2</mn></mrow></mfrac><mo>]</mo></mrow><mn>2</mn></msup><msup><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>/</mo><mn>2</mn><mo>)</mo></mrow><mn>2</mn></msup></math>',
  }],
  4: [{
    match: "占空比为50%的AMI码的功率谱计算公式为：",
    note: "A 为幅度，T_b 为码元周期；sin² 项使 f = 0 处为零。",
    mathml: '<math display="block"><mi>P</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><mfrac><mrow><msup><mi>A</mi><mn>2</mn></msup><msub><mi>T</mi><mi>b</mi></msub></mrow><mn>4</mn></mfrac><msup><mrow><mo>[</mo><mfrac><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>)</mo></mrow><mrow><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub></mrow></mfrac><mo>]</mo></mrow><mn>2</mn></msup><msup><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>)</mo></mrow><mn>2</mn></msup></math>',
  }],
  5: [{
    match: "双极性归零码的双边功率谱密度表达式：",
    note: "D = τ/T_b 为占空比；D = 1 时退化为双极性不归零码。",
    mathml: '<math display="block"><mi>P</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><msup><mi>A</mi><mn>2</mn></msup><msub><mi>T</mi><mi>b</mi></msub><msup><mi>D</mi><mn>2</mn></msup><msup><mrow><mo>[</mo><mfrac><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mi>D</mi><mo>)</mo></mrow><mrow><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mi>D</mi></mrow></mfrac><mo>]</mo></mrow><mn>2</mn></msup><msup><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>)</mo></mrow><mn>2</mn></msup></math>',
  }],
  6: [{
    match: "双极性不归零码的功率谱表达式：",
    note: "等概率 ±A 时无离散直流分量。",
    mathml: '<math display="block"><mi>P</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><msup><mi>A</mi><mn>2</mn></msup><msub><mi>T</mi><mi>b</mi></msub><msup><mrow><mo>[</mo><mfrac><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mo>)</mo></mrow><mrow><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub></mrow></mfrac><mo>]</mo></mrow><mn>2</mn></msup></math>',
  }],
  7: [{
    match: "单极性归零码的功率谱表达式：",
    note: "第一项为连续谱，第二项为 f = 0 处的直流离散谱。",
    mathml: '<math display="block"><mi>P</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><mfrac><mrow><msup><mi>A</mi><mn>2</mn></msup><msub><mi>T</mi><mi>b</mi></msub><msup><mi>D</mi><mn>2</mn></msup></mrow><mn>4</mn></mfrac><msup><mrow><mo>[</mo><mfrac><mrow><mi>sin</mi><mo>(</mo><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mi>D</mi><mo>)</mo></mrow><mrow><mi>π</mi><mi>f</mi><msub><mi>T</mi><mi>b</mi></msub><mi>D</mi></mrow></mfrac><mo>]</mo></mrow><mn>2</mn></msup><mo>+</mo><mfrac><mrow><msup><mi>A</mi><mn>2</mn></msup><msup><mi>D</mi><mn>2</mn></msup></mrow><mn>4</mn></mfrac><mi>δ</mi><mo>(</mo><mi>f</mi><mo>)</mo></math>',
  }],
  19: [{
    match: "DSB-SC信号的数学表达式为：",
    note: "m(t) 为调制信号，f_c 为载波频率。",
    mathml: '<math display="block"><msub><mi>s</mi><mrow><mi>D</mi><mi>S</mi><mi>B</mi></mrow></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mi>A</mi><mi>m</mi><mo>(</mo><mi>t</mi><mo>)</mo><mi>cos</mi><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>f</mi><mi>c</mi></msub><mi>t</mi><mo>)</mo></math>',
  }],
  18: [{
    match: "SSB信号的数学表达式为：",
    note: "取“−”为上边带（USB），取“+”为下边带（LSB）；m̂(t) 为 m(t) 的希尔伯特变换。",
    mathml: '<math display="block"><msub><mi>s</mi><mrow><mi>S</mi><mi>S</mi><mi>B</mi></mrow></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mfrac><mi>A</mi><mn>2</mn></mfrac><mi>m</mi><mo>(</mo><mi>t</mi><mo>)</mo><mi>cos</mi><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>f</mi><mi>c</mi></msub><mi>t</mi><mo>)</mo><mo>∓</mo><mfrac><mi>A</mi><mn>2</mn></mfrac><mover accent="true"><mi>m</mi><mo>^</mo></mover><mo>(</mo><mi>t</mi><mo>)</mo><mi>sin</mi><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>f</mi><mi>c</mi></msub><mi>t</mi><mo>)</mo></math>',
  }],
  30: [{
    match: "其中，两个归一化正交基函数为：",
    note: "T_s 为符号周期，f_c 为载波频率。",
    mathml: '<math display="block"><msub><mi>φ</mi><mn>1</mn></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><msqrt><mfrac><mn>2</mn><msub><mi>T</mi><mi>s</mi></msub></mfrac></msqrt><mi>cos</mi><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>f</mi><mi>c</mi></msub><mi>t</mi><mo>)</mo><mo>,</mo><mspace width="1em"/><msub><mi>φ</mi><mn>2</mn></msub><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mo>−</mo><msqrt><mfrac><mn>2</mn><msub><mi>T</mi><mi>s</mi></msub></mfrac></msqrt><mi>sin</mi><mo>(</mo><mn>2</mn><mi>π</mi><msub><mi>f</mi><mi>c</mi></msub><mi>t</mi><mo>)</mo></math>',
  }, {
    match: "其最小欧氏距离为：",
    note: "E_s 为平均符号能量，M 为进制数。",
    mathml: '<math display="block"><msub><mi>d</mi><mrow><mi>m</mi><mi>i</mi><mi>n</mi></mrow></msub><mo>=</mo><msqrt><mfrac><mrow><mn>6</mn><msub><mi>E</mi><mi>s</mi></msub></mrow><mrow><mi>M</mi><mo>−</mo><mn>1</mn></mrow></mfrac></msqrt></math>',
  }],
  38: [{
    match: "余弦信号的傅立叶变换可表示为：",
    note: "x(t) = A cos(2π f_0 t) 的频谱为两根冲激。",
    mathml: '<math display="block"><mi>X</mi><mo>(</mo><mi>f</mi><mo>)</mo><mo>=</mo><mfrac><mi>A</mi><mn>2</mn></mfrac><mo>[</mo><mi>δ</mi><mo>(</mo><mi>f</mi><mo>−</mo><msub><mi>f</mi><mn>0</mn></msub><mo>)</mo><mo>+</mo><mi>δ</mi><mo>(</mo><mi>f</mi><mo>+</mo><msub><mi>f</mi><mn>0</mn></msub><mo>)</mo><mo>]</mo></math>',
  }],
};
window.DOC_INLINE = [
  {
    re: /Q函数的表达式为或/g,
    html: 'Q函数的表达式为 <math><mi>Q</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><msqrt><mn>2</mn><mi>π</mi></msqrt></mfrac><msubsup><mo>∫</mo><mi>x</mi><mi>∞</mi></msubsup><msup><mi>e</mi><mrow><mo>−</mo><msup><mi>t</mi><mn>2</mn></msup><mo>/</mo><mn>2</mn></mrow></msup><mi>d</mi><mi>t</mi></math> 或 <math><mi>Q</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>erfc</mi><mo>(</mo><mfrac><mi>x</mi><msqrt><mn>2</mn></msqrt></mfrac><mo>)</mo></math>',
  },
  { re: /210\/16/g, html: '2<sup>10</sup>/16' },
];
