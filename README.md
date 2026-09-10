# archsvg

把结构化图描述（IR JSON）渲染为**课程 / 文档友好**的静态 SVG，并对产物做机械验证。

archsvg 接收一份描述图结构的 JSON（IR，Intermediate Representation），自动布局并产出
单文件 SVG；同时提供 schema 校验与构图质量检查，保证产出在飞书 / Obsidian 等文档环境中
零 JS、零外部依赖、明/暗双模式可读。

## 与 course-skill 的关系

- `course-skill` 是 archsvg 的**消费者之一**：课程生产链路用 archsvg 生成插图。
- archsvg **不得反向依赖** `course-skill`：它不知道任何课程语义，只认 IR JSON。
  本目录下的代码绝不 `import` 或引用 `course-skill` 的任何文件。

## 目录结构

```
.agents/skills/archsvg/
├── SKILL.md                      # 技能入口（由其他负责人创建）
├── README.md                     # 本文件
├── LICENSE                       # MIT
├── THIRD_PARTY_NOTICES.md        # 第三方 vendored 代码声明
├── package.json                  # { name, type: module, private: true }
├── .gitignore
├── bin/archsvg.mjs               # CLI 入口（由其他负责人创建）
├── lib/
│   ├── geometry.mjs              # vendor 自 archify（仅追加归属头，逻辑未改）
│   ├── diagnostics.mjs           # vendor 自 archify（仅追加归属头，逻辑未改）
│   ├── theme.mjs                 # 配色 token（自研，后建）
│   ├── layout.mjs                # 自动布局（自研，后建）
│   ├── render.mjs                # SVG 渲染（自研，后建）
│   ├── schema.mjs                # 运行时 schema 校验（自研，后建）
│   └── checks/{composition,course}.mjs  # 质量检查（自研，后建）
├── schemas/{common,architecture,flow,sequence}.schema.json
├── examples/                     # 每类型 1–2 个示例 IR
└── references/{diagram-spec.md,diagram-contract.md}
```

> 本 README 仅描述 archsvg 整体；`SKILL.md`、`bin/`、`schemas/`、`examples/`、
> `references/` 及 `lib/` 下的自研模块由对应 subagent 并行负责。

## 运行时要求

- **Node.js 18+**（仅用内置模块，零 npm 依赖）。
- 所有源文件为 `.mjs`，不依赖 `package.json` 的 `type` 字段。
- 路径一律用 `import.meta.url` 相对解析，**支持从任意 cwd 调用**。

## CLI 用法

命令（具体实现位于 `bin/archsvg.mjs`，契约见实施计划 §2.6）：

```bash
node bin/archsvg.mjs doctor                                  # 自检全部资产，全绿即通过
node bin/archsvg.mjs guide "<场景>"                           # 给出 IR 编写指引
node bin/archsvg.mjs validate <type> <input.json> [--quality standard|showcase] [--json]
node bin/archsvg.mjs render   <type> <input.json> <output.svg> [--quality standard|showcase] [--json]
```

- `<type>` ∈ `architecture` | `flow` | `sequence`。
- 质量档位**只由 CLI `--quality` 决定**（不写进 IR）：`standard`（默认）与 `showcase`
  （更严格的构图预算，含连线穿越、走廊歧义、边框借道等校验）。

退出码：

| 码 | 含义 |
|:---:|:---|
| `0` | 通过 |
| `1` | 验证失败 |
| `2` | 用法错误 |

`--json` 回执沿实施计划 §2.6 的契约结构返回，含 `schemaVersion`、`ok`、`command`、
`type`、`checks`、`composition`、`artifact` 等字段。

## Vendor 说明

`lib/geometry.mjs` 与 `lib/diagnostics.mjs` 原样 vendored 自开源项目
[archify](https://github.com/tt-a1i/archify)（MIT，作者 tt-a1i，基于
Cocoon-AI/architecture-diagram-generator MIT v1.0），来源版本 `v2.17.0-dev.1`。
除文件头追加归属注释外，**逻辑未修改**。详见 `THIRD_PARTY_NOTICES.md`。

### 环境变量 `ARCHIFY_DIAGNOSTIC_FORMAT`

`lib/diagnostics.mjs` 沿用上游同名环境变量，**保持原名不改**（改名会破坏逻辑）：

- 默认（未设置或任意非 `json` 值）：诊断以普通文本累加，仅在 `recordDiagnostic()` 调用时
  缓冲，不影响正常渲染流程。
- 设为 `json`：开启诊断录制模式——`installRendererDiagnosticBoundary()` 注册
  `uncaughtException` 处理器，将诊断以 JSON 写入 stderr 并 `process.exit(1)`；
  未捕获错误也会被归一化为结构化诊断回执。

archsvg 在自研模块中**不依赖**该变量，仅保留其语义以兼容上游 vendored 代码。

## 开发状态

- 版本：**v0.1.0**
- 状态：**实施中**（W1 骨架 + vendor 已完成；渲染/校验/CLI/技能文档待后续波次）。
- 验收标准见实施计划 §4。
