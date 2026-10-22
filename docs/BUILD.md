# 打包（Windows）

## 构建模式

| 模式 | 命令 | 输出 |
| --- | --- | --- |
| 私有/内部构建 | `npm run dist` / `npm run dist:portable` | `release\` |
| 公开包检查 | `npm run check:public` | 只列出会排除的第三方资产，不构建 |
| 公开构建 | `npm run dist:public` | `release\public\` |

私有构建继续使用 `package.json` 的 `build` 配置，不改动过滤规则。公开构建使用一份临时 electron-builder 配置，只替换 `files` 与输出目录；构建结束后临时配置自动删除。

公开构建输出单独放在 `release\public`，不会覆盖私有构建的 `release\win-unpacked` 和安装包。

## 公开包边界

公开包**不包含**：

- `data/scripts/**`（平台 `.m` / `.octave` 脚本）
- `data/experiments/**`（平台课程原文 Markdown）
- `data/ocj-templates.json`（Rainier OCJ 器件模板）
- `data/**` 下的学校课程图片（png/jpg/jpeg/gif/webp/bmp/svg/tif/tiff）
- `vlab_offline` / Rainier 引擎 / `com_rainier_osgi_gui.exe`
- `data/experiments.json` 中的平台 URL 或 校内平台地址

公开包保留：

- `app/**`、`templates/**`、`build/icon.png`、`package.json`
- `data/experiments.json`（题号、标题、chain、params、observers 等结构化元数据）
- `data/devices.json`、`data/functions.json`、`data/params.json`

`data/experiments.json` 仍保留 `markdown` / `script` 路径，用于与用户课程包按同名文件匹配；公开包中这些文件不存在时，界面显示“导入课程包”空态。

## 检查模式

```powershell
npm run check:public
# 等价于
.\tools\build-win.ps1 -CheckPublicRelease
```

检查模式只读，会列出当前源码树中检测到的第三方资产、数量、体积和处理方式，例如：

```text
- 平台脚本原文: 38 个 / 19.8 KB
- 平台课程原文: 38 个 / 183.8 KB
- Rainier OCJ 器件模板: 1 个 / 965.9 KB
```

检查模式不要求 electron-builder / rcedit 可用，也不会生成安装包。

## 公开构建命令

```powershell
cd <仓库目录>

# 只检查
npm run check:public

# 公开构建：NSIS + portable zip
npm run dist:public

# 等价于直接调用脚本
.\tools\build-win.ps1 -PublicRelease -Portable
```

公开构建前置检查：

- `data/experiments.json` 必须存在、可解析、`experiments` 非空。
- 不得包含 校内平台地址、`http(s)://` 或 `"url"` 字段。发现任一项直接拒绝构建。
- 构建完成后用 `asar list` 校验 `resources\app.asar`，确认其中没有：
  - `data/scripts/**`
  - `data/experiments/**`
  - `data/ocj-templates.json`
  - `data/**` 下的脚本或图片

公开包内 `data` 目录最终只应保留：

```text
data\devices.json
data\experiments.json
data\functions.json
data\params.json
```

## 公开构建的三步

1. **生成解包目录**

   ```powershell
   npx electron-builder --win dir --config <临时公开配置> --config.win.signAndEditExecutable=false
   ```

   产物：`release\public\win-unpacked\CommLab Studio.exe`

2. **写入图标与版本信息**

   `tools\rcedit-x64.exe` 写入：

   - `build\icon.ico`
   - `FileVersion` / `ProductVersion`
   - `ProductName`、`FileDescription`、`CompanyName`、`LegalCopyright`

3. **用已改好的目录生成 NSIS**

   ```powershell
   npx electron-builder --win nsis --prepackaged release\public\win-unpacked --config <临时公开配置> --config.win.signAndEditExecutable=false
   ```

   产物：

   - `release\public\CommLabStudio-0.1.4-setup.exe`
   - `release\public\latest.yml`

`-Portable` 会把 `release\public\win-unpacked` 打成：

```text
release\public\CommLabStudio-0.1.4-portable.zip
```

## 课程包

公开包首次运行没有课程原文时，正文区显示“导入课程包”，侧栏显示“课程包：未导入”。导入 ZIP 或文件夹后，课程原文从：

```text
<userData>\course-pack\experiments\*.md
```

读取；可选脚本从：

```text
<userData>\course-pack\scripts\*.m
```

读取。

完整格式见 [`docs/COURSEPACK.md`](COURSEPACK.md)。

## 老版实验台

`app/ocj.js` 依赖 `data/ocj-templates.json`。公开构建排除了该文件，因此 `app/main.js` 对 `./ocj` 做延迟加载：

- 启动、题库、native 仿真、新版实验台不受影响。
- 点击“老版实验台”并尝试导出电路时，会提示“公开安装包不包含老版 OCJ 器件模板”。

## 为什么不用默认的 signAndEditExecutable

Windows 未开启开发者模式时，electron-builder 解压 `winCodeSign` 会因 macOS 符号链接失败。本项目当前不做代码签名，因此三步命令都显式设置：

```text
--config.win.signAndEditExecutable=false
```

## 验收清单

- [x] `npm run check:js` 通过
- [x] `tools/build-win.ps1 -CheckPublicRelease` 可列出排除资产
- [x] `tools/build-win.ps1 -PublicRelease` 可生成公开 NSIS 安装包
- [x] 公开 `app.asar` 不含 scripts / experiments / ocj-templates / 课程图片
- [x] 私有源码运行可读取本地 `data/experiments`
- [x] 公开模式显示导入空态；文件夹和 ZIP 课程包均可导入并读题
- [x] 课程包清除后恢复导入空态
- [ ] 在干净 Windows 机器上安装并验证
- [ ] 配置代码签名
- [ ] 加 CI（Windows runner）
- [ ] 公开 Git 仓库本身仍保留私有课程原文/脚本，发布前需另行处理 Git 历史或分支
