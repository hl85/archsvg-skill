# archsvg

> 给开发者的专业图形生成管线：**IR JSON → 机械验证 → 静态 SVG**。

archsvg 让你用一份描述图结构的 JSON（IR，Intermediate Representation）表达架构图、流程图、
时序图，由它负责自动布局与渲染，并在出图前做 20 项机械检查。产出是**单文件静态 SVG**，
可直接嵌入 Markdown、文档系统或代码仓库。

## 它解决什么问题

让模型直接写 SVG 有三个绕不开的毛病：

| 问题 | 后果 |
|:---|:---|
| 手写坐标 | 标签压线、连线穿越节点、间距失控，只能靠肉眼发现 |
| 一次性输出 | 画错没有诊断，只能整体重来 |
| 风格漂移 | 每次生成一个样，跨文档/跨仓库不一致 |

archsvg 的做法是**让模型输出结构，而不是输出像素**：

```
自然语言 / 代码理解
      ↓
  Typed JSON IR        ← 结构先行
      ↓
  Schema 校验           ← 字段合法性
      ↓
  机械检查（20 项）     ← 标签遮挡、连线穿越、走廊歧义、对比度、文字描边、箭头契约…
      ↓
  渲染静态 SVG
```

验证失败不是抛异常了事，而是返回**结构化诊断**：哪个节点、哪条边、违反哪条规则、
实测多少、建议怎么修。据此改 IR 再跑，形成 `生成 → 验证 → 修复 → 交付` 的闭环。

## 三种图类型

| 类型 | 适用场景 | 关键结构 |
|:---|:---|:---|
| `architecture` | 系统架构、分层、边界、组件拓扑、**并列对比** | `groups` + `nodes` + `edges` |
| `flow` | Pipeline、业务流程、CI/CD、**决策树**、**演进路线** | `stages` + `nodes(kind)` + `edges` |
| `sequence` | API 调用链、请求生命周期、异步追踪 | `participants` + `messages` |

> 对比图是 `architecture` 的分组变体，演进路线是 `flow` 的阶段（`stages`）变体，不单独立类型。

## 语义色板

节点颜色由 `role` 决定，语义固定、不随主题漂移：

| `role` | 含义 | 色系 |
|:---|:---|:---|
| `control` | 编排 / 调度 / 状态 | 紫 |
| `capability` | 工具 / 算子 / 外部系统 | 绿 |
| `interaction` | 协议 / 接口 / 数据契约 | 蓝 |
| `warn` | 警告 / 失败 / 拦截 | 橙红 |
| `neutral` | 中性 / 说明 | 灰 |

## 快速开始

无需安装依赖，Clone 即可用：

```bash
node bin/archsvg.mjs doctor     # 环境自检，全绿打印 "archsvg is ready."
node bin/archsvg.mjs guide "订单创建的服务调用链"
```

写一个 IR（完整字段见 `schemas/` 与 `examples/`）：

```json
{
  "schema_version": 1,
  "type": "architecture",
  "meta": { "title": "缓存未命中的读路径", "caption": "图 3-1 · 读请求回溯源库" },
  "nodes": [
    { "id": "api",   "label": "API 服务", "role": "control" },
    { "id": "cache", "label": "Redis",    "role": "capability" },
    { "id": "db",    "label": "主库",     "role": "capability" }
  ],
  "edges": [
    { "from": "api", "to": "cache", "label": "GET", "kind": "sync" },
    { "from": "api", "to": "db",    "label": "回源", "kind": "fallback" }
  ]
}
```

验证并出图：

```bash
node bin/archsvg.mjs validate architecture demo.json --quality showcase
node bin/archsvg.mjs render   architecture demo.json demo.svg --quality showcase --json
```

验证不通过时 `render` **绝不产出文件**。

## CLI

```bash
archsvg doctor
archsvg guide "<场景>"
archsvg validate <type> <input.json> [--quality standard|showcase] [--json]
archsvg render   <type> <input.json> <output.svg> [--quality standard|showcase] [--json]
```

- `<type>` ∈ `architecture` | `flow` | `sequence`
- `--quality`：`standard` 15 项 / `showcase` 20 项（默认 `standard`）
- `--json`：输出机器可读回执，含 `checks`、`composition.summary`、`artifact.sha256`

退出码：

| 码 | 含义 |
|:---:|:---|
| `0` | 通过 |
| `1` | 验证失败（`render` 时不产出文件） |
| `2` | 用法错误（未知类型 / 文件缺失 / JSON 解析失败） |

## 质量门禁

**构图检查 10 项** —— 坐标有限性、节点重叠、文字锚点在盒内、连线穿越无关节点、标签净空、
端点正交、走廊歧义、贴边借道、转折节奏、图例净空。

**文档集成检查 6 项** —— ASCII 画图残留、base64 内嵌、Markdown 引用可达、
图题规范、明暗双模对比度、多版本目录图资源一致性。

有界重试：连续两轮修复未降低错误数即**停止并如实报告**未解决诊断。
禁止以裁剪内容、缩小字号、隐藏溢出等手段伪造通过。

## 产物特性

- 单文件静态 SVG，**内联样式**，亮色优先 + `@media (prefers-color-scheme: dark)` 暗色自适应
- **零 JS**、无 `foreignObject`、无外部字体，可在飞书 / Obsidian / GitHub 等环境正常渲染
- 自动布局，**调用方不写坐标**；内容放不下时自动扩展画布，不压缩节点、不缩字号
- **画布自动贴合内容**：`viewBox` 只作行内舒展提示，成品尺寸裁到内容边界（含图例），不留空边
- 标题居中；`meta.caption` 除写入 `<desc>` 外，同时渲染为**底部图注**（图号 + 口径就近可读）
- 节点标题统一中性近黑/近白，role 色只承担卡片填充与描边的语义（避免同色系顺色发虚）
- 含 `<title>` / `<desc>` 无障碍信息
- 单图通常 **< 15 KB**

## 目录结构

```
archsvg/
├── SKILL.md                     # 技能入口（供 Agent 发现与加载）
├── README.md                    # 本文件
├── LICENSE                      # MIT
├── THIRD_PARTY_NOTICES.md       # 第三方 vendored 代码声明
├── package.json                 # { name, type: module, private: true }
├── bin/archsvg.mjs              # CLI 入口
├── lib/
│   ├── geometry.mjs             # vendor 自 archify（仅追加归属头，逻辑未改）
│   ├── diagnostics.mjs          # vendor 自 archify（仅追加归属头，逻辑未改）
│   ├── theme.mjs                # 配色 token 与明暗双模
│   ├── layout.mjs               # 自动布局（正交路由、阶段带、回边绕行）
│   ├── render.mjs               # 静态 SVG 渲染
│   ├── schema.mjs               # 运行时 schema 校验（JSON Schema 子集）
│   └── checks/
│       ├── composition.mjs      # 构图检查 11 项
│       └── document.mjs         # 文档集成检查 9 项
├── schemas/{common,architecture,flow,sequence}.schema.json
├── examples/                    # 各类型最小示例 IR（Schema 对照用）
├── samples/                     # 成品样例画廊（IR + 已渲染 SVG，覆盖全部类型与变体）
└── references/
    ├── design-system.md         # 固定风格约定 + fewshot（域→role 配色、文案规范、自检）
    ├── diagram-spec.md          # IR 规范、role 语义、布局规则、修复优先级
    └── diagram-contract.md      # 诊断 / 回执契约、20 项检查逐项说明
```

## 运行时要求

- **Node.js 18+**，仅用内置模块，**零 npm 依赖**
- 源文件为 `.mjs`，不依赖 `package.json` 的 `type` 字段
- 路径一律用 `import.meta.url` 相对解析，**支持从任意 cwd 调用**

## 设计原则

1. **结构先于像素**：模型输出 IR，不出 SVG 字符串。
2. **验证即契约**：检查项机器可读，失败给出 `subject` / `evidence` / `supportedFixes`。
3. **有界诚实**：修不好就如实报告，不允许伪造通过。
4. **自包含**：无运行时依赖，产物可脱离本工具独立使用。

## Vendor 与授权

`lib/geometry.mjs` 与 `lib/diagnostics.mjs` 原样 vendored 自开源项目
[archify](https://github.com/tt-a1i/archify)（MIT，作者 tt-a1i，基于
Cocoon-AI/architecture-diagram-generator MIT v1.0），来源版本 `v2.17.0-dev.1`。
除文件头追加归属注释外**逻辑未修改**。详见 `THIRD_PARTY_NOTICES.md`。

archsvg 自身以 MIT 发布。

### 环境变量 `ARCHIFY_DIAGNOSTIC_FORMAT`

沿用上游同名环境变量（改名会破坏 vendored 逻辑）。设为 `json` 时进入诊断录制模式：
`installRendererDiagnosticBoundary()` 注册 `uncaughtException` 处理器，把诊断以 JSON
写入 stderr 并退出。archsvg 自研模块不依赖该变量，仅保留语义以兼容上游代码。

## 版本

**v0.1.3** —— 常量单点化与「估算 / 渲染 / 校验」三方拉齐：

- 新增 `lib/typography.mjs`（字号/盒几何/线宽/图例/画布常量）与 `lib/text-metrics.mjs`
  （**实测标定**的字宽系数表），`layout` / `render` / `theme` / `checks` 全部改为引用，
  不再各自硬编码（历史上四处各写一份，改一处即静默错位）。
- 新增 `lib/markers.mjs`：箭头 marker id 由契约单点定义，`marker_contract` 检查双向断言
  （悬空引用 / 越权 marker / 契约缺实现）。
- 新增检查 `text_not_truncated`（截断 = 信息丢失）、`marker_contract`、`svg_text_fits`
  （**产物级**：按渲染字号复核盒内文案与遮罩，能挡住跨模块常量错位）。合计 20 项。
- 修两处渲染缺陷（由新引入的渲染级复核实测发现，此前所有检查项均不可见）：
  边标签遮罩按 11px 估算而文字是 12px（遮罩窄 ~8%，连线从字缝透出）；
  `.edge-label` 已 `dominant-baseline: central` 却仍额外 `+3px`（文字稳定探出遮罩下沿 3.5px）。
- `validate` 改为同样先在内存渲染产物 → 与 `render` 跑同一批检查（此前 validate 静默跳过
  产物级检查，「validate 通过」≠「render 会通过」）。
- 新增 `archsvg test` 与 `tests/`：19 项零依赖断言 + 2 个 headless 浏览器工具（含负向用例，保证每项检查可证伪）。
- `archsvg doctor` 新增「docs 常量 ↔ 代码常量」断言（首次运行即抓出 13 处文档↔代码漂移）。

**v0.1.2** —— 三类型、17 项检查（新增 `text_no_stroke`）、画布自动贴合、共列网格、固定风格设计系统。
