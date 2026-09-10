---
name: archsvg
description: This skill should be used when the user asks to create, redraw, or validate a professional diagram — architecture, system topology, flowchart, pipeline, sequence diagram, decision tree, state flow, or comparison (架构图 / 拓扑图 / 流程图 / 时序图 / 决策树). Accepts IR JSON, Markdown, or plain prose as input and renders one self-contained static SVG with automatic layout, light/dark theming, zero JavaScript, and 15 composition checks. Also converts Mermaid or prose into static SVG. Not for raster images or freeform artwork.
agent_created: true
---

# archsvg —— IR JSON → 静态 SVG 渲染 + 机械验证

把「结构化图描述（IR JSON）」渲染为**可嵌入文档的静态 SVG**，并对构图质量做 15 项机械检查，产出机器可读回执。自动布局、零 JS、亮色优先 + `prefers-color-scheme: dark`、单图通常 < 15 KB。

**本技能自包含**：只认 IR JSON，不依赖任何外部 skill 或业务语义。

## 快速创作路径

1. **选类型**：按下方「类型路由表」确定 `architecture` / `flow` / `sequence`。
2. **读 schema + example**：`schemas/<type>.schema.json` 与 `examples/<type>.json` 各一份；成品级参考（含已渲染 SVG、覆盖全部类型与变体）见 `samples/`。
3. **写 IR**：只填语义（`role` / `label` / `edges`），**禁止手写坐标**——坐标由 `lib/layout.mjs` 自动布局。
4. **validate**：`archsvg validate <type> <ir.json> --quality showcase`。
5. **按诊断修**：回执里的 `diagnostics[].supportedFixes` 是定点修复建议，逐条改 IR，**不要为了让检查通过而裁剪语义**。
6. **render**：全部通过后 `archsvg render <type> <ir.json> <out.svg> --quality showcase` 才产出文件。

## 类型路由表

| 类型 | 适用场景 | 关键结构 |
|:---|:---|:---|
| `architecture` | 分层图、边界图、组件图、**并列对比图** | `groups` + `nodes` + `edges` |
| `flow` | Pipeline、流程图、**决策树**、**演进路线** | `stages` + `nodes(kind)` + `edges` |
| `sequence` | 时序、请求生命周期、调用链 | `participants` + `messages` |

> 对比图 = architecture 的分组变体；演进路线 = flow 的阶段（`stages`）变体。二者不单独立类型。

## 创作不变量（硬性）

1. **一条清晰主路径**：读者一眼能跟出主干，辅助信息不得喧宾夺主。
2. **节点 ≤ 24**：超过 24 个节点必须拆分为多张图，禁止塞进单图。
3. **边标签是语义数据**：`edge.label` 描述调用/数据类型，**不能随便删**——删标签等于删信息。
4. **先删低价值边再加路由控制**：拥挤时优先删冗余边，再用布局/分组疏解，而非裁剪语义。
5. **不为通过检查而改语义**：检查失败是信号，不是目标。

## 有界重试规则

- 连续**两轮**修复后错误数未降低 → **停止**，并在回执/报告中**如实列出未解决诊断**。
- 禁止以以下手段伪造通过：
  - 裁剪信息（删节点/删边/删标签）；
  - `overflow:hidden` 或任何隐藏溢出；
  - 缩小字号规避净空/对比度检查。

## 明确禁止

- ❌ 用裁剪内容、缩小字号、`overflow:hidden` 伪造检查通过。
- ❌ 在验证失败时产出 SVG 文件（`render` 验证不过绝不写盘）。
- ❌ 修改 vendor 的 `lib/geometry.mjs` / `lib/diagnostics.mjs`（归属 archify，仅可追加归属头）。
- ❌ 在 IR 里手写坐标（`pos`/`x`/`y` 等由布局器生成）。
- ❌ 依赖任何外部 skill 文件，或让 IR 语义耦合某个具体业务领域。
- ❌ 引入任何 npm 依赖。

## CLI 用法

```bash
archsvg doctor                                              # 环境自检，全绿打印 "archsvg is ready."
archsvg guide "<场景>"                                      # 推荐图类型 + 理由 + 最简 IR 骨架
archsvg validate <type> <input.json> [--quality standard|showcase] [--json]
archsvg render   <type> <input.json> <output.svg> [--quality standard|showcase] [--json]
```

- `<type>` ∈ `architecture` | `flow` | `sequence`，且必须与 IR 内 `type` 一致。
- `--quality`：`standard` = 12 项（9 构图 + no_ascii + no_base64 + ref_reachable）；`showcase` = 15 项全过。默认 `standard`。
- `--json`：回执以 JSON 输出（见 `references/diagram-contract.md`）；非 `--json` 为人类可读逐项结果。

### 退出码

`0` 通过 ／ `1` 验证失败（`render` 时不产出文件）／ `2` 用法错误。
完整含义表见 `references/diagram-contract.md`。

## 输出要求（交给调用方）

返回产物时务必包含：

- **产物路径**：`output.svg` 绝对路径；
- **类型**：`type`；
- **验证摘要**：档位 + `passed/total` + 失败项名（showcase 须 `15/15`）；
- **回执**：`--json` 时直接转发回执；非 `--json` 时总结 `ok` 与失败诊断。

## 参考文档

- `references/diagram-spec.md` —— IR 字段完整说明、`role` 三域语义、布局规则、修复优先级。
- `references/diagram-contract.md` —— Diagnostic / Check / 回执契约、15 项检查逐项说明、退出码表。
