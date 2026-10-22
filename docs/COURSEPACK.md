# 课程包格式与导入

公开安装包只包含题号、标题、器件链、参数等结构化元数据，不包含平台课程原文、平台 `.m` 脚本、OCJ 器件模板或学校课程图片。需要阅读课程原文时，由用户自行导入课程包。

## 安装位置

课程包导入到 Electron 的 `userData` 目录：

```text
<userData>/course-pack/
```

Windows 默认大致为：

```text
C:\Users\<用户名>\AppData\Roaming\CommLab Studio\course-pack
```

开发/测试时可以用环境变量 `COMMLAB_USER_DATA` 覆盖 `userData`。

## 支持的形式

- 文件夹
- `.zip` 压缩包
- ZIP 内或文件夹内允许有一层顶层目录，例如 `my-course-pack/experiments.json`

不支持加密 ZIP、ZIP64、分卷 ZIP；课程包不能包含符号链接。

## 目录结构

```text
course-pack/
├─ experiments.json
├─ experiments/
│  ├─ 01_曼彻斯特码.md
│  ├─ 02_HDB3.md
│  └─ ...
└─ scripts/                 # 可选
   ├─ main10.m
   └─ ...
```

要求：

- `experiments.json` 必须存在且是有效 JSON。
- `experiments/` 下至少有一个 `.md` 文件。
- `scripts/` 可选；允许 `.m` / `.octave`。
- 单个文件不超过 8 MB，解压后总计不超过 64 MB，文件数不超过 2000。

## experiments.json

最小示例：

```json
{
  "name": "我的通信原理课程包",
  "experiments": [
    {
      "order": 1,
      "expNo": "10",
      "title": "实验十 曼彻斯特码",
      "markdown": "experiments/01_曼彻斯特码.md",
      "script": "scripts/main10.m"
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `order` | 二选一 | 与内置题库的 `order` 对齐；匹配后覆盖同名字段 |
| `expNo` | 二选一 | 没有 `order` 时用题号匹配 |
| `title` | 否 | 不填则保留内置标题 |
| `markdown` | 建议 | 指向 `experiments/*.md`；也接受 `data/experiments/*.md` 形式 |
| `script` | 否 | 指向 `scripts/*.m` 或 `scripts/*.octave`；也接受 `data/scripts/*.m` 形式 |
| `chain` / `params` / `observers` 等 | 否 | 不填则保留内置结构化元数据；填写则覆盖 |

导入时按 `order`（其次 `expNo`）与内置题库合并。因此课程包可以只提供原文，不必重复维护器件链和参数。

## 导入 / 清除

主界面侧栏有“课程包：未导入 / 导入 / 更换 / 清除”。缺少课程原文时，正文区也会显示“导入课程包”按钮。

IPC：

- `coursepack:status`：返回是否已安装、路径、实验条目数、Markdown 数、脚本数。
- `coursepack:import`：无参数时弹出“ZIP / 文件夹”选择框；测试或自动化可传入本地路径。
- `coursepack:clear`：删除 `userData/course-pack`。

preload 暴露为：

```js
window.api.coursepackStatus()
window.api.coursepackImport(sourcePath?)
window.api.coursepackClear()
```

## 私有模式与公开模式

- 私有源码树没有导入课程包时，`experiments:read` 继续读取项目本地 `data/experiments/*.md` 和 `data/scripts/*.m`。
- 导入课程包后，同名的 Markdown/脚本优先从 `userData/course-pack` 读取。
- 公开包不包含 `data/experiments/**`、`data/scripts/**`、`data/ocj-templates.json` 和 `data` 下的学校图片；首次运行会显示导入提示。
- 公开包中老版实验台导出依赖的 OCJ 器件模板被排除，因此“老版实验台”导出会提示不可用；新版实验台和 native 仿真不受影响。

## 安全边界

导入器只复制/解压以下路径：

- `experiments.json`
- `experiments/**/*.md`
- `scripts/**/*.m`
- `scripts/**/*.octave`

其他文件会被忽略；包含 `..`、绝对路径、盘符、符号链接的课程包会被拒绝。导入先写入临时目录，校验通过后再替换 `course-pack`。
