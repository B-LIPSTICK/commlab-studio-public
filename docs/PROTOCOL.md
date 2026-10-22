# 9002 协议（实测）

> 抓取方式：`tools/ws-spy.js` 在页面脚本前包裹 `WebSocket`，录制收发帧；`tools/run3.js` 用平台自己的 `.ocj` 建电路并触发运行。
> 记录时间：2026-10-20。以下全部是实帧，非推断。

## 1. 传输层

- 地址：`ws://localhost:9002`
- 格式：**XML 文本帧**（非二进制）
- 页面加载即建立连接，但**不主动发消息**；必须触发操作

## 2. 客户端 → 引擎

三种信封。

### 2.1 `<user-cmd-msg>` 命令

```xml
<user-cmd-msg>
<client-id>-1</client-id>
<need-return>1</need-return>
<engine-id>com.rainier.osgi.plugin.cms.engine.octave</engine-id><serial-id>3</serial-id>
<content>bg_run</content>
</user-cmd-msg>
```

`<content>` 目前见到的取值：

| 值 | 含义 |
|---|---|
| `bg_halt` | 暂停 |
| `quit` | 结束/关闭会话 |
| `bg_run` | 开始运行 |

> 注意：`<engine-id>` 与 `<serial-id>` 之间**没有换行**（平台自身的小瑕疵），解析时别按行切。

### 2.2 `<user-scene-msg>` 场景（电路脚本）

```xml
<user-scene-msg>
<client-id>-1</client-id>
<need-return>1</need-return>
<content-type>base64</content-type>
<engine-id>com.rainier.osgi.plugin.cms.engine.octave</engine-id><serial-id>2</serial-id>
<content>BASE64(脚本)</content>
</user-scene-msg>
```

### 2.3 `<user-cvi-inter-msg>` 虚拟仪器交互

```xml
<user-cvi-inter-msg>
<client-id>-1</client-id>
<cvi-type>...</cvi-type>
<cvi-instance>...</cvi-instance>
<serial-id>N</serial-id>
<content>...</content>
</user-cvi-inter-msg>
```

## 3. 场景脚本语言（关键发现）

`<content>` 解 base64 后是**一段 Octave 脚本**，不是 JSON。

实测（实验二 矩形脉冲能量谱，3 器件 2 连线）：

```matlab
Source_Rectpuls_Comm(1,0.5,1,64);
Draw_Plot_Comm(@1@);
print svg_U2.svg
Draw_PowerSpectrum_Comm(@1@,64,'common');
print svg_U5.svg
save rainier.mat
```

规则：

- 每行一个器件调用，参数与平台器件参数一一对应
- `@N@` 引用**第 N 条语句的输出**（端口连线就是参数替换）
- `print svg_Ux.svg` 让引擎把该器件的图形渲染成 SVG 文件
- 结尾固定 `save rainier.mat`

也就是说：**我们只要生成这段脚本，就能驱动引擎，完全不需要润尼尔的画布。**

## 4. 引擎 → 客户端

### 4.1 `<engine-result>` 文件清单

```xml
<engine-result>
<client-id>441259224</client-id>
<engine-id>com.rainier.osgi.plugin.cms.engine.octave</engine-id>
<serial-id>2</serial-id>
<content>@@OutputStart@@DataCount:1@DataSize:245760@FileCount:4@FileList:[svg_U2.svg#svg_U5.svg#rainier.mat#out.txt]</content>
</engine-result>
```

### 4.2 数据帧

```
DATA[1/0/281]@[[svg_U2.svg]###[AA==]*****[svg_U5.svg]###[AA==]*****[rainier.mat]###[AA==]*****[out.txt]###[T3d2bGFiIE...
```

- `DATA[序号/分片/总长]`
- 文件之间 `*****` 分隔
- 每个文件 `[文件名]###[base64内容]`
- 图是 SVG，另有 `rainier.mat` 与 `out.txt`

## 5. 完整运行时序（实测 4 发 2 收）

```
→ user-cmd-msg   bg_halt
→ user-cmd-msg   quit
→ user-scene-msg BASE64(脚本)
→ user-cmd-msg   bg_run
← engine-result  文件清单
← DATA          文件内容（base64）
```

## 6. 对我们意味着什么

自己写界面只需要做三件事：

1. 把画布上的器件/连线序列化成上面那段脚本
2. 按信封发过去
3. 收 `DATA` 帧，解 base64，把 SVG 塞进结果面板

器件参数、端口、图形定义仍然读本地 `resource/partlib/*.js`，不需要重写仿真内核。
