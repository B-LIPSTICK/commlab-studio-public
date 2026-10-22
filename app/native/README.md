# CommLab Native JS Kernel (prototype)

这是一个不依赖 Rainier / Octave / 第三方二进制、也不引入 npm 依赖的纯 JavaScript 仿真内核原型。当前覆盖 3 道实验（共 38 道中的 3 道），目标先证明：

- `app/graph.js` 的 `nodes/edges` 图结构可以直接执行；
- 输出结构与 `app/engine.js` 的 `runScript` 结果兼容：`{ results: [{ device, file, svg }], log }`；
- 时间波形、功率谱、PCM 量化/编码/译码的 SVG 可以在不启动 9002 引擎的情况下生成。

> 本目录不修改 `app/engine.js`、`app/graph.js`、`app/main.js`、`app/renderer/**`、`app/workbench/**`、`data/experiments.json` 或 `package.json`。这是可替换内核的原型，不是现有应用的接线版本。

## 1. 接口

```js
const { runNative } = require("./app/native");

const graph = {
  nodes: [
    { id: "n1", className: "Source_Randi_Comm", componentName: "随机序列码产生器", inputs: 0, outputs: 1, values: ["16"] },
    { id: "n2", className: "LineCode_Snrz_Comm", componentName: "单极性不归零码", inputs: 1, outputs: 1, values: ["1", "9"] },
    { id: "n3", className: "Draw_Plot_Comm", componentName: "信号波形图", inputs: 1, outputs: 0, values: [] }
  ],
  edges: [
    { from: "n1", fromPort: 0, to: "n2", toPort: 0 },
    { from: "n2", fromPort: 0, to: "n3", toPort: 0 }
  ],
  // 可选：固定随机源，便于复现。缺省也有固定 seed。
  seed: 20261020
};

const { results, log } = runNative(graph);
// results: [{ device, file, svg }]
// file:   "svg_<拓扑序号>.svg"，与 app/graph.js 的编号规则一致
```

### 参数顺序

与 `app/graph.js` 一致：先按 `toPort` 顺序放已连接输入，再依次放 `node.values` 中非空值。

例如：

```js
LineCode_Snrz_Comm(A, 1, 9)  // inputs=1, values=["1","9"]
Draw_PowerSpectrum_Comm(B, 32, "dB") // inputs=1, values=["32","dB"]
```

### 拓扑执行

`runNative` 使用 Kahn 拓扑排序，节点顺序与 `app/graph.js` 的稳定队列顺序一致。遇到环、未接线输入、重复 node id、重复 toPort 或未支持器件会抛出明确错误。

### 日志

`log` 是字符串，包含：

- 内核版本、节点/边数量、随机 seed；
- 每个节点的输出摘要（二进制头、向量长度、范围）；
- 每个 Draw 节点的 SVG 文件名和字节数；
- 完成数量。

它不包含 Rainier 的 `Owvlab Mathematical Modeling Simulation Engine` 启动横幅和 Fontconfig 警告。

### 插件模块（`app/native/devices/*.js`）

`index.js` 在 `require` 时自动扫描 `app/native/devices/` 下所有 `.js` 文件（按文件名排序），无需再改 `index.js`。每个模块导出：

```js
module.exports = {
  ALIASES: {
    Foo_Comm: "Foo",
    Foo: "Foo"
  },
  INPUT_COUNTS: {
    Foo: 1
  },
  HANDLERS: {
    Foo(args, ctx) {
      // args: 已连接输入 + node.values，顺序与 app/graph.js 一致
      // ctx:  { node, rng, log }
      // 返回数字数组（信号）或 SVG 字符串（Draw_*）
      return [0, 1, 0, 1];
    }
  }
};
```

合并规则：

1. **先合并所有模块的 `ALIASES`**，再合并 `INPUT_COUNTS` 和 `HANDLERS`。因此模块 B 可以使用模块 A 声明的别名，即使文件名排序在后。
2. `ALIASES` 的键是原始类名，值是 canonical 类名；同一别名映射到相同 canonical 可以重复，映射到不同 canonical 会抛错。
3. `INPUT_COUNTS` / `HANDLERS` 的键可以是 canonical 类名，也可以是别名；加载时会用合并后的别名表归一化。
4. 内置的 3 题注册表先加载，device 模块只能新增，不能覆盖内置 handler；重复 handler 或同一 canonical 的不同端口数会抛错。
5. 如果某个 handler 没有对应的 `INPUT_COUNTS`，默认按 0 个输入处理，并在导出的 `DEVICE_WARNINGS` 中记录警告。
6. 不包含 `ALIASES`、`INPUT_COUNTS`、`HANDLERS` 任意一项的 `.js` 文件会被忽略，并在 `DEVICE_WARNINGS` 中记录，便于放共享 helper。
7. Draw 器件的 canonical 类名必须以 `Draw_` 开头，执行器才会把返回值收集为 `{ device, file, svg }`；其他 handler 的返回值作为下游信号。
8. 加载失败、别名冲突、handler 冲突都会带上模块文件名抛出，便于并行开发时定位。

诊断导出：

```js
const native = require("./app/native");
console.log(native.DEVICE_MODULES);  // 已扫描的 .js 文件名
console.log(native.DEVICE_WARNINGS); // 缺省端口/被忽略文件等警告
```

## 2. 支持的器件

以下类名同时接受带 `_Comm` 和不带 `_Comm` 的写法。`Sourse_Randi` 是历史拼写，也作为别名接受。

| 类名 | 输入 | `values` | 输出 / 行为 |
|---|---|---:|---|
| `Source_Randi` / `Source_Randi_Comm` | 0 | `Length`（可选第二个值作为本地 seed） | `1xLength` 的 0/1 序列 |
| `LineCode_Snrz` / `LineCode_Snrz_Comm` | 1 | `A, sample` | `1x2^sample` 单极性不归零波形 |
| `LineCode_Manchester` / `LineCode_Manchester_Comm` | 1 | `L` | 与输入等长的 Manchester 波形，`0 -> -1,+1`，`1 -> +1,-1` |
| `Source_Cosin` / `Source_Cosin_Comm` | 0 | `A, freq, t, phase, fs` | `1x(floor(t*fs))` 余弦序列 |
| `ComUse_Sample` / `ComUse_Sample_Comm` | 1 | `freq, t` | `1x(floor(freq*t))` 采样序列 |
| `SourceCoding_PCMQuantiz` / `..._Comm` | 1 | 无 | `round((x/max(x))*2048)` 的量化序列 |
| `SourceCoding_PCMCoding` / `..._Comm` | 1 | 无 | `1x8N` 的 8 位 PCM 折叠码流 |
| `SourceCoding_PCMDecoding` / `..._Comm` | 1 | `A` | `1xN` 译码序列（额外支持，便于跑完整实验二十六） |
| `Draw_Plot` / `Draw_Plot_Comm` | 1 | 可选颜色/尺寸/路径（忽略尺寸与路径） | 时间波形 SVG |
| `Draw_PowerSpectrum` / `Draw_PowerSpectrum_Comm` | 1 | `L, displayoption` | 功率谱 SVG，`displayoption` 支持 `common` / `dB` |
| `Draw_Stem` / `Draw_Stem_Comm` | 1 | 可选颜色/尺寸/路径（忽略尺寸与路径） | 离散针状图 SVG |

### 与 Rainier 数值语义对齐的细节

1. **`Source_Cosin`**：`time = 0 : 1/fs : (t - 1/fs)`，不包含终点 `t`。
2. **`ComUse_Sample`**：保留 Rainier 的 1-based 采样索引 `datain(i*d)` 和严格 `< N1` 边界。以实验二十六为例，`N1=1000, freq=20, t=1` 时 `d=50`，读的是第 50、100、...、950 个点，最后一个输出为 0。
3. **`LineCode_Snrz`**：要求 `2^sample` 能被输入码元数整除，按 `L=2^sample/M` 逐码元填充。
4. **`LineCode_Manchester`**：按输入每 `L` 个样本取一个判决点；`L` 必须为偶数。实验十中 `Snrz` 输出 1024 点、`L=64`，因此实际形成 16 个 Manchester 码元，而不是 4 个。
5. **`SourceCoding_PCMQuantiz`**：按输入最大值归一化到 2048；使用 Octave/MATLAB 风格的“半数远离 0”舍入。
6. **`SourceCoding_PCMCoding`**：完全复刻 Rainier 的 8 位折叠码分段阈值、段内 4 位自然码、`B==16 -> 1111` 特判，以及 `dataout'` 后按行展开成 `1x8N` 的顺序。
7. **`SourceCoding_PCMDecoding`**：复刻 Rainier 的段码/段内码重建、`step/2` 偏置和符号位为 0 时取负的行为；因此量化值为 0 时译码结果是 `-0.000244140625`，这是原实现的行为，不是本内核新增的 bug。
8. **`Draw_PowerSpectrum`**：复刻 Rainier 的 FFT 半谱交换、`P=|X|^2/T` 和 `30+10*log10(P+eps)` 的 dB 偏移；频率轴从 `-Bs+df` 到 `Bs`。

## 3. 运行 bench

```powershell
node tools/native-bench/run.js
node tools/native-bench/run.js --seed 123
node tools/native-bench/run.js --out tools/native-bench/out
```

输出目录默认是 `tools/native-bench/out/`，会写：

- `exp03_svg_*.svg`：实验三
- `exp10_svg_*.svg`：实验十
- `exp26_svg_*.svg`：实验二十六（含 PCM 译码，因此是 5 张图）
- `summary.json`：耗时、结果数、文件列表和完整 log

三题的结果数：

| order | 实验 | 结果数 |
|---:|---|---:|
| 8 | 实验三 单极性不归零码 | 2 |
| 1 | 实验十 曼彻斯特码 | 3 |
| 25 | 实验二十六 PCM | 5 |

## 4. 与 Rainier 的差异

- **随机序列不同**：Rainier 的 `randi([0,1],...)` 没有固定 seed；本内核使用 mulberry32，默认 seed 固定，保证 bench 可复现。若要比较同一比特序列下的编码/谱，需要显式把同一序列送入 `LineCode_*` 或给 `Source_Randi` 传入第二个 seed 值。
- **SVG 不是 Gnuplot 字节级复刻**：本内核直接生成 640x440 的 SVG，轴范围、刻度、字体和网格为自绘；Rainier 输出为 Gnuplot 5.0 的 576x432 SVG。波形/谱的数值和形状对齐，像素布局不保证一致。
- **坐标轴细节不同**：Rainier 的 Gnuplot 自动扩展 x 轴到整刻度（例如 512 点显示到 600），本内核按样本 1..N 取轴范围后取整刻度；功率谱频率轴和 dB 数值按原公式计算。
- **`Draw_Plot` / `Draw_Stem` 的额外参数被忽略**：Rainier 脚本里的颜色、厘米尺寸和输出路径不会改变本内核的 SVG 尺寸；颜色参数会尽量映射到 `b/g/r/...`。
- **日志不同**：本内核返回执行摘要，不返回 Octave 启动横幅、Fontconfig 警告或 `rainier.mat` 保存信息。
- **PCM 实验二十六完整链**：bench 额外跑了 `SourceCoding_PCMDecoding`，因此输出 5 张图；题目要求的四段链（到 `PCMCoding`）本身也支持，只是不会生成译码图。

## 5. 扩展到其余 35 题

建议按下面的顺序做，避免把原型变成不可维护的“大 if”：

1. **先补 `dsp.js` 的纯函数**：信号源、码型、滤波器、采样/量化、FFT/IFFT、误码统计等。每个函数只接收数字数组/标量，返回数字数组，不依赖 DOM。
2. **在 `app/native/devices/` 新增模块**：
   - 在 `ALIASES` 增加 `Xxx` 和 `Xxx_Comm`；
   - 在 `INPUT_COUNTS` 声明输入端口数；
   - 在 `HANDLERS` 写参数解析和 DSP 调用；
   - 如果是 Draw 器件，canonical 类名以 `Draw_` 开头并返回 SVG 字符串；否则返回信号数组。
   - 不需要修改 `index.js`。
3. **补矩阵信号**：`Draw_Plot` / `Draw_Stem` 的 Rainier 语义支持 `[x; n]` 两行矩阵。当前 `extractSeries` 已支持这种输入；新增器件如果需要输出“值 + 坐标”，可以沿用两行数组约定。
4. **补非 2 次幂 FFT**：当前 FFT 对 2 的幂使用 radix-2，其他长度回退到 O(n²) DFT。对 1000 点以内的原型够用；后续如果做长序列频谱，建议实现 Bluestein 或混合基 FFT。
5. **每个新题加一个 bench 图**：在 `tools/native-bench/run.js` 增加 inline graph、`expectedResults` 和输出文件前缀；至少断言结果数、SVG 合法、无 `NaN`。
6. **与历史 Rainier SVG 对拍**：仓库 `_out/` 下有历史输出（例如 `_out/8`、`_out/1`、`_out/25`）。可以解析路径点、轴刻度和 stem 点，做“数值/形状”对比；不要要求字节级 SVG 相同。
7. **再考虑接线到应用**：`runNative` 的返回结构已经兼容 `runScript` 的 `results/log`，但本原型没有修改 `app/engine.js`、`app/main.js` 或 renderer。接入时应新增一个显式的 native 分支，而不是改变 Rainier 默认路径。

### 当前未覆盖的典型器件族

- 其他线路码：AMI、HDB3、CMI、双极性/归零码等；
- 调制/解调：ASK、FSK、PSK、QAM、载波同步；
- 信道与噪声：AWGN、衰落、滤波；
- 信源/信道编码：DeltaM、Hamming、卷积码、BER；
- 观测器：眼图、星座图、散点图、直方图、信号频谱等。

这些都可以沿用同一接口：`nodes + edges -> 拓扑排序 -> 纯函数信号 -> SVG`。