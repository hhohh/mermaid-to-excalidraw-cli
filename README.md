# mer2excal

将 **Mermaid 图表** 转换为 **Excalidraw 格式**的命令行工具。

支持 `.mmd` 单文件转换和 `.md` Markdown 文件批量转换（自动提取所有 `mermaid` 代码块）。

支持导出为 **Excalidraw JSON**、**Obsidian Excalidraw Markdown**、**SVG**、**PNG** 四种格式。

基于 [@excalidraw/mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw) 库，适配 **Obsidian Excalidraw 插件** 和 **excalidraw.com**。

## 安装

### 直接使用可执行文件（推荐）

从 [Releases](https://github.com/yourusername/mermaid-to-excalidraw-cli/releases) 下载对应平台的可执行文件：

```bash
# macOS Apple Silicon (M1/M2/M3)
sudo cp ./mer2excal-darwin-arm64 /usr/local/bin/mer2excal
chmod +x /usr/local/bin/mer2excal

# macOS Intel
sudo cp ./mer2excal-darwin-x64 /usr/local/bin/mer2excal
chmod +x /usr/local/bin/mer2excal

# Windows
# 将 mer2excal-windows-x64.exe 添加到 PATH 环境变量
```

**特点**：
- ✅ 零外部依赖，开箱即用
- ✅ 默认字体已嵌入，无需额外文件
- ✅ PNG 导出自动检测系统浏览器

### 从源码构建

```bash
git clone <repo>
cd mermaid-to-excalidraw-cli
npm install
npm run build

# 编译为可执行文件（需要 bun）
npm run compile:all

# 或通过 npm link 使用 node 版本
npm link
```

## 用法

### 单文件转换（.mmd）

```bash
# 文件 → .excalidraw（纯 JSON，excalidraw.com 可用）
mer2excal diagram.mmd

# 文件 → .excalidraw.md（Obsidian Excalidraw 插件格式）
mer2excal diagram.mmd --md

# 文件 → SVG（矢量图）
mer2excal diagram.mmd --svg

# 文件 → PNG（高清位图，2x 分辨率）
mer2excal diagram.mmd --png

# 指定输出路径
mer2excal diagram.mmd --png -o output.png

# 管道输入
cat diagram.mmd | mer2excal --png

# 内联定义
mer2excal -d "graph TD; A[开始] --> B{判断}; B -->|是| C[结束]" --png
```

### Markdown 批量转换（.md）

当输入文件是 Markdown 格式时，工具会自动提取所有 ` ```mermaid ` 代码块，并为每个代码块生成独立的输出文件。

```bash
# 导出为 PNG
mer2excal doc.md --png

# 导出为 SVG
mer2excal doc.md --svg

# 导出为 Excalidraw JSON
mer2excal doc.md
```

**输出规则：**
- 自动创建以 Markdown 文件名命名的目录（去掉 `.md` 后缀）
- 每个 mermaid 代码块按顺序编号输出（001、002、003...）
- 非 mermaid 代码块会被自动忽略

**输出示例：**

```bash
# 输入：doc.md（包含 3 个 mermaid 代码块）
mer2excal doc.md --png

# 输出：
doc/
├── 001.png
├── 002.png
└── 003.png

# 导出为 Excalidraw 格式
mer2excal doc.md

doc/
├── 001.excalidraw
├── 002.excalidraw
└── 003.excalidraw

# 导出为 SVG 格式
mer2excal doc.md --svg

doc/
├── 001.svg
├── 002.svg
└── 003.svg
```

### 字体设置

#### 默认字体

工具内置了"平方萌萌哒"字体（已嵌入到可执行文件中）。当不指定 `--font` 参数时，会自动使用该字体：

```bash
# 使用默认字体（平方萌萌哒）
mer2excal diagram.mmd --png
mer2excal diagram.mmd --svg
```

#### 自定义字体

```bash
# 使用自定义字体文件（TTF/OTF/WOFF/WOFF2）
mer2excal diagram.mmd --png --font path/to/font.ttf

# 使用系统字体名称
mer2excal diagram.mmd --png --font "Arial"
mer2excal diagram.mmd --png --font "PingFang SC"

# 同时调整字号
mer2excal diagram.mmd --png --font-size 24
```

### 输出美化

```bash
# 美化输出（pretty-print JSON）
mer2excal diagram.mmd --pretty

# 美化 + Obsidian 格式
mer2excal diagram.mmd --md --pretty
```

### 全部选项

```
mer2excal [input] [options]

  input.mmd / input.md        Mermaid 文件 (.mmd) 或 Markdown 文件 (.md)
  -o, --output <file>        输出文件路径
  -d, --definition <str>     内联 Mermaid 定义
  -t, --format <type>        输出格式: excalidraw | excalidraw-md | svg | png
  --md                       --format excalidraw-md 的快捷方式
  --svg                      --format svg 的快捷方式
  --png                      --format png 的快捷方式
  --font <path|name>         字体文件路径或系统字体名称（默认：平方萌萌哒）
  -f, --font-size <n>        字号 (默认 20)
  --font-family <id|name>    Excalidraw 字体族: 1=Virgil, 2=Helvetica, 3=Cascadia
  -p, --pretty               美化 JSON 输出
  -v, --version              显示版本
  -h, --help                 显示帮助
```

## PNG 导出

PNG 导出使用系统浏览器的 headless 模式渲染，支持完整的 CSS `@font-face` 字体嵌入。

### 浏览器检测

程序会自动检测系统中安装的浏览器（按优先级）：
1. Google Chrome
2. Microsoft Edge
3. Firefox

如果未找到任何支持的浏览器，会提示用户安装。

### 渲染特性

- ✅ 无头模式（headless），用户无感知
- ✅ 2x 分辨率缩放，高清输出
- ✅ 自动适应 SVG 尺寸
- ✅ 完整支持 CSS `@font-face`
- ✅ 等待字体加载完成后再截图

### 系统要求

**PNG 导出需要安装以下浏览器之一：**
- Google Chrome（推荐）
- Microsoft Edge
- Firefox

其他格式（excalidraw、svg）不需要浏览器。

## 自动布局

基于 **ELK (Eclipse Layout Kernel)** 风格的分层布局算法，自动对转换后的节点进行定位：

- **方向检测**：自动解析 Mermaid 定义中的 `flowchart LR` / `TD` / `RL` / `BT` 决定布局方向
- **拓扑分层**：BFS 拓扑排序为节点分配层级（源 → 目标）
- **间距控制**：
  - 同层相邻节点间距：100px
  - 层与层间距：100px
- **箭头自动连接**：通过 `intersectElementWithLine` 精确计算箭头与矩形各边的交点，箭头始终连接在节点边缘

## 文字处理

自动剥离标签文本中的 Markdown 语法标记，保留纯文本内容：

| 语法 | 处理方式 | 示例 |
|------|---------|------|
| `**bold**` | → `bold` | `**1,053,877**` → `1,053,877` |
| `*italic*` | → `italic` | |
| `__text__` | → `text` | |
| `_text_` | → `text` | |
| `~~strike~~` | → `strike` | |
| `` `code` `` | → `code` | |
| `[text](url)` | → `text` | |

HTML 标签（如 `<br>`）被转换为换行符，其余标签被剥离。

## 输出格式

### `excalidraw`（默认）

纯 JSON 文件（`.excalidraw`），可在 **[excalidraw.com](https://excalidraw.com)** 直接拖入打开。

### `excalidraw-md`（`--md`）

Obsidian Excalidraw 插件兼容格式（`.excalidraw.md`），包含 YAML 前置元数据和嵌入式 JSON：

```markdown
---
excalidraw-plugin: raw
tags: [excalidraw]
---

==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

## Drawing
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "mer2excal",
  "elements": [
    { "type": "rectangle", "id": "A", "x": 0, "y": 0, ... },
    { "type": "text", "id": "A_text", "containerId": "A", ... },
    { "type": "arrow", "id": "A_B", "start": {"id":"A"}, "end": {"id":"B"}, ... }
  ],
  "files": {},
  "appState": { ... }
}
```
%%
```

在 **Obsidian** 中打开后，切换至 Excalidraw 视图即可编辑。拖拽节点时，连接线会自动跟随。

### `svg`（`--svg`）

矢量图格式，支持自定义字体嵌入（通过 CSS `@font-face` + base64）。可在浏览器中直接查看，或导入到其他矢量图编辑工具。

### `png`（`--png`）

高清位图格式（2x 分辨率），使用浏览器渲染引擎，完整支持字体和样式。适合直接插入文档、演示文稿。

## 支持的图表类型

| 类型 | 支持度 | 说明 |
|------|--------|------|
| Flowchart（流程图） | ✅ 完整 | 矩形、菱形、箭头全部转为 Excalidraw 元素 |
| Sequence（时序图） | ✅ 完整 | 角色、消息线、激活条转为 Excalidraw 元素 |
| Class（类图） | ⚠️ 降级 | 回退为内嵌 SVG 图片 |
| State（状态图） | ⚠️ 降级 | 回退为内嵌 SVG 图片 |
| ER Diagram | ⚠️ 降级 | 回退为内嵌 SVG 图片 |
| Gantt / Pie / 其他 | ⚠️ 降级 | 回退为内嵌 SVG 图片 |

> **降级模式**：当 jsdom 无法完美渲染 SVG DOM 结构时，自动回退为内嵌 SVG 图片，图表内容完整保留。

## 工作原理

### Excalidraw 格式导出

1. **jsdom** 模拟浏览器 DOM 环境（`pretendToBeVisual: true`）
2. 加载 **mermaid** 库在虚拟 DOM 中解析和渲染图表
3. **@excalidraw/mermaid-to-excalidraw** 从渲染结果提取元素
4. **mer2excal** 补充 Excalidraw 元素必填字段（`strokeColor`、`seed`、`versionNonce` 等）
5. 标签文字从容器内联属性拆分为独立 Text 元素，绑定到容器
6. 自动布局：ELK 风格分层算法定位节点、计算箭头端点
7. 剥离 Markdown 语法标记，保留纯文本
8. 输出为标准 Excalidraw JSON 或 Obsidian 兼容的 `.excalidraw.md`

### SVG/PNG 格式导出

1. 生成 Excalidraw JSON 数据
2. 使用 **@excalidraw/utils** 的 `exportToSvg` 生成 SVG
3. 嵌入自定义字体（CSS `@font-face` + base64）
4. SVG 格式直接输出
5. PNG 格式：使用系统浏览器 headless 模式渲染 SVG → PNG

## 项目结构

```
mermaid-to-excalidraw-cli/
├── mer2excal-darwin-arm64    # macOS Apple Silicon 可执行文件
├── mer2excal-darwin-x64      # macOS Intel 可执行文件
├── mer2excal-windows-x64.exe # Windows 可执行文件
├── src/
│   ├── cli.ts                # CLI 入口源码
│   └── defaultFont.ts        # 嵌入的默认字体（自动生成）
├── scripts/
│   └── embed-font.js         # 字体嵌入脚本
├── font/
│   └── PingFangMengMeng-2.ttf # 默认字体源文件
├── dist/
│   ├── cli.js                # TypeScript 编译产物
│   └── cli.bundle.js         # esbuild 打包产物
├── package.json              # Node 依赖
├── tsconfig.json             # TypeScript 配置
├── patches/                  # patch-package 修复补丁
└── README.md
```

## 系统要求

### 可执行文件

- **macOS**: Apple Silicon (arm64) 或 Intel (x64)
- **Windows**: 64位 (x64)
- **PNG 导出**: 需要安装 Chrome/Edge/Firefox 之一

### 源码运行

- Node.js >= 18
- bun（可选，用于编译可执行文件）

## 开发

```bash
# 安装依赖
npm install

# 构建（自动嵌入字体）
npm run build

# 打包所有平台可执行文件
npm run compile:all

# 仅打包当前平台
npm run compile
```

## 协议

MIT
