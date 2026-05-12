# mer2excal

将 **Mermaid 图表** 转换为 **Excalidraw 格式**的命令行工具。

支持 `.mmd` 单文件转换和 `.md` Markdown 文件批量转换（自动提取所有 `mermaid` 代码块）。

基于 [@excalidraw/mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw) 库，适配 **Obsidian Excalidraw 插件** 和 **excalidraw.com**。

## 安装

### 直接使用可执行文件（推荐）

```bash
# macOS arm64
sudo cp ./mer2excal /usr/local/bin/
mer2excal --help
```

### 从源码构建

```bash
git clone <repo>
cd mermaid-to-excalidraw-cli
npm install
npm run build

# 编译为可执行文件（需要 bun）
bun build --compile ./src/cli.ts --outfile=mer2excal

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

# 指定输出路径
mer2excal diagram.mmd -o output.excalidraw

# 管道输入
cat diagram.mmd | mer2excal --md

# 内联定义
mer2excal -d "graph TD; A[开始] --> B{判断}; B -->|是| C[结束]"
```

### Markdown 批量转换（.md）

```bash
# 自动提取文档中所有 ```mermaid 代码块，按顺序输出
mer2excal doc.md

# 输出结构: 原文件名（去后缀）为目录，内部按序号排列
# doc/
# ├── 001.excalidraw
# ├── 002.excalidraw
# └── 003.excalidraw
```

Markdown 文件中可以有任意数量的 mermaid 代码块，也可以穿插非 mermaid 代码块（会被忽略）。每个 mermaid 代码块独立转换为一个 `.excalidraw` 文件。

### 字体设置

```bash
# Excalidraw 标准字体系列
#   1 = Virgil（手写风格，默认）
#   2 = Helvetica（无衬线）
#   3 = Cascadia Code（等宽）
mer2excal diagram.mmd --font-family 2

# 使用系统本地字体（ Obsidian Excalidraw 插件支持）
mer2excal diagram.mmd --font-family "PingFang SC"
mer2excal diagram.mmd --font-family "Noto Sans CJK SC"

# 同时调整字号
mer2excal diagram.mmd --font-family 2 --font-size 24
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
  -o, --output <file>        输出文件路径（.mmd 模式）
  -d, --definition <str>     内联 Mermaid 定义
  -t, --format <type>        输出格式: excalidraw | excalidraw-md
  --md                       --format excalidraw-md 的快捷方式
  -f, --font-size <n>        字号 (默认 20)
  --font-family <id|name>    字体: 1=Virgil, 2=Helvetica, 3=Cascadia, 或本地字体名
  -p, --pretty               美化 JSON 输出
  -v, --version              显示版本
  -h, --help                 显示帮助
```

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
​```json
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
​```
%%
```

在 **Obsidian** 中打开后，切换至 Excalidraw 视图即可编辑。拖拽节点时，连接线会自动跟随。

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

1. **jsdom** 模拟浏览器 DOM 环境（`pretendToBeVisual: true`）
2. 加载 **mermaid** 库在虚拟 DOM 中解析和渲染图表
3. **@excalidraw/mermaid-to-excalidraw** 从渲染结果提取元素
4. **mer2excal** 补充 Excalidraw 元素必填字段（`strokeColor`、`seed`、`versionNonce` 等）
5. 标签文字从容器内联属性拆分为独立 Text 元素，绑定到容器
6. 自动布局：ELK 风格分层算法定位节点、计算箭头端点
7. 剥离 Markdown 语法标记，保留纯文本
8. 输出为标准 Excalidraw JSON 或 Obsidian 兼容的 `.excalidraw.md`

## 项目结构

```
mermaid-to-excalidraw-cli/
├── mer2excal           # 可执行文件（bun 编译，arm64）
├── src/cli.ts          # CLI 入口源码
├── dist/cli.js         # TypeScript 编译产物
├── package.json        # Node 依赖
├── tsconfig.json       # TypeScript 配置
├── patches/            # patch-package 修复补丁
└── README.md
```

## 系统要求

- **可执行文件**: macOS arm64（需要其他平台请自行 bun 编译）
- **源码运行**: Node.js >= 18

## 协议

MIT
