[![CI](https://github.com/B-LIPSTICK/commlab-studio-public/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/B-LIPSTICK/commlab-studio-public/actions/workflows/ci.yml)

# CommLab Studio

通信原理虚拟仿真实验 · 教学助手

把 38 道虚拟仿真实验做成一个可安装的桌面工具：题目、参数、拓扑、仿真、报告，一站式。

## 下载

- 安装版：https://github.com/B-LIPSTICK/commlab-studio-public/releases/download/v0.1.6/CommLabStudio-0.1.6-setup.exe
- 便携版：https://github.com/B-LIPSTICK/commlab-studio-public/releases/download/v0.1.6/CommLabStudio-0.1.6-portable.zip

## 公开源码说明

这个仓库是**公开源码快照**，不包含：

- 学校课程原文 Markdown
- 平台 `.m` / `.octave` 脚本
- Rainier OCJ 器件模板
- 学校课程图片、校内平台地址
- 本机路径、姓名、学号、班级等个人信息

公开包仍然内置 38 道实验的结构化元数据（题号、标题、器件链、参数、观测器）和自研 native 内核。
课程原文请通过“课程包导入”使用自己的课程包，格式见 [`docs/COURSEPACK.md`](docs/COURSEPACK.md)。

## 本地运行

```powershell
npm install
npm start
```

源码运行默认使用 native 内核，不依赖 Rainier / 9002 / 8766。native 覆盖 38/38 道实验，100 张 SVG，0 错误。

如果需要路径 A（本机学校客户端），复制配置模板并填写自己的路径：

```powershell
Copy-Item config.example.json config.json
```

`config.json` 已被 `.gitignore` 忽略，不会提交。

## 报告封面

报告 PDF 的封面信息从以下位置读取，优先级从高到低：

1. `<userData>\report-cover.json`
2. 仓库根目录 `report-cover.json`

复制模板：

```powershell
Copy-Item report-cover.example.json report-cover.json
```

然后填写学校、班级、学号、姓名。`report-cover.json` 已被 `.gitignore` 忽略。

## 构建

```powershell
npm run dist:public      # 公开包：NSIS + portable zip，输出 release\public
npm run dist             # 本机构建：NSIS
npm run dist:portable    # 本机构建：NSIS + portable zip
```

公开构建会排除课程原文、平台脚本、OCJ 模板、课程图片和校内地址。详细说明见 [`docs/BUILD.md`](docs/BUILD.md)。

## 38 道实验

- native 内核覆盖 38/38，100 张 SVG，0 错误
- v0.1.6 公开/私有 portable 均通过 38/38 全量回归
- 单题基础题 1–5 ms，BER 题约 30–600 ms
- 结果包括波形、频谱、星座图、误码率指标

## 目录

```text
app/                Electron 主进程、界面、工作台、native 内核
data/               结构化元数据（不含课程原文/脚本）
templates/          报告 LaTeX 母版
tools/              构建与打包 smoke test
docs/               构建、课程包、协议与工作台说明
```

## 许可

MIT，见 [`LICENSE`](LICENSE)。课程原文、平台脚本、Rainier 引擎及 OCJ 模板不属于本仓库，也不随公开包分发。
