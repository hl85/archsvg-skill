# archsvg 诊断与回执契约

Diagnostic 对象、Check 对象、16 项检查逐项说明、退出码表、回执 JSON schema。

---

## 1. Diagnostic 对象

schema 层（`validateSchema`）产出的诊断。携带 `subject` / `evidence` / `supportedFixes`，使 Agent 能**定点修复**。

```json
{
  "code": "layout/label-route-clearance",
  "severity": "error",
  "message": "标签 \"Document\" 与连线 edge-3 净空不足 14px（实测 2px）",
  "subject": { "type": "edge", "id": "edge-3", "pointer": "/edges/3" },
  "evidence": { "measured": 2, "threshold": 14 },
  "supportedFixes": ["将标签上移 6px", "缩短标签文案为 \"Doc\""]
}
```

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `code` | string | 诊断码，形如 `schema/required` / `layout/error` / `cli/type-mismatch` |
| `severity` | `"error"\|"warning"` | 严重度；当前 schema 校验均为 `error` |
| `message` | string | 人类可读中文说明 |
| `subject` | object | 定位信息：`pointer`（JSON Pointer）+ 最近的 `id` / `label` |
| `evidence` | object | 量化证据（实测值、阈值等），便于程序消费 |
| `supportedFixes` | string[] | 定点修复建议（可空数组） |

---

## 2. Check 对象

构图 / 文档集成检查产出。

```json
{ "name": "label_route_clearance", "ok": true, "details": ["全部 9 个标签与任何边/盒子净空 ≥ 14px"] }
```

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `name` | string | 检查项名（见 §3 枚举） |
| `ok` | boolean | 是否通过 |
| `details` | string[] | 通过时的正向说明，或失败时的逐条问题清单 |

> 跳过项（无上下文）必须 `ok:true` 且 `details[0]` 写明「跳过：<原因>」，**不允许静默通过**。

---

## 3. 16 项检查逐项说明

构图 10 项（9 项复用 archify `geometry.mjs` 几何内核 + 1 项自研不变量）+ 文档集成专项 6 项。

### 3.1 构图 10 项

| 名称 | 检查什么 | 失败意味着 | 典型修法 |
|:---|:---|:---|:---|
| `finite_svg` | 所有坐标均为有限数（无 NaN/Infinity） | 布局器算出非有限坐标，通常 IR 缺字段 | 补 IR 必填字段 |
| `node_overlap` | 节点两两不相交（gap≥8px） | 节点太挤/分组过密 | 拆组、减节点、拆图（≤24） |
| `node_text_in_box` | 每个 box 的文字锚点 (cx,cy) 落在盒内 | 坐标变换漏改 cx/cy → 色块与文字分离（画布会出现空色块） | 回查 layout 的坐标变换，须同时平移 cx/cy |
| `relationship_crossings` | 边不穿越无关节点框 | 路由穿过无关节点 | 改边起止、加分组、调布局 |
| `label_route_clearance` | 边标签与任何边/盒子净空 ≥ 阈值（短轴高度，默认 14px） | 标签压线/压框 | 缩短标签、减冗余边 |
| `orthogonal_arrows` | 边首尾段垂直于其 fromSide/toSide | 箭头未正交 | 交由布局器修正；排查非法 kind |
| `relationship_corridors` | 无两条边共用无法区分的重叠走廊（overlap≥8px） | 两条边并行难分 | 改路由、删其一 |
| `container_border_runs` | 无边贴容器边框长距离平行走 | 边贴框伪装边界 | 改路由离开边框 |
| `route_rhythm` | 边转折节奏合理（无 <16px / <8px 过短段） | 路由抖动 | 删冗余边、加分组 |
| `legend_clearance` | 图例不压任何 box/容器（gap≥8px） | 图例压节点 | 减节点或调 viewBox |

### 3.2 文档集成专项 6 项

| 名称 | 检查什么 | 失败意味着 | 典型修法 |
|:---|:---|:---|:---|
| `no_ascii` | SVG 无 Box-drawing / ASCII 流程箭头残留 | 渲染了 ASCII 图 | 回查 `lib/render.mjs`（不应发生） |
| `no_base64` | SVG 无 `data:image/` 内嵌 | 内嵌了 base64 图片 | 改为外部相对引用 |
| `ref_reachable` | Markdown 的 `./images/*.svg` 引用均存在 | 引用缺失 | 补图或修 Markdown 引用 |
| `caption_present` | `meta.caption` 形如 `图 X-N · 标题` 且图号不重复 | 图题缺失/格式错/图号重复 | 补 `meta.caption`；跨文件去重 |
| `theme_readable` | 用到的 role 在明/暗两套 token 下文字对比度 ≥ 4.5:1 | 配色对比度不足 | 回查 `role` 选用与 token |
| `variant_parity` | 多版本目录的 `images/*.svg` 文件名集合一致（仅 `--variant-pair` 启用） | 版本间图不对齐 | 对齐各版本图文件 |

### 3.3 档位 → 检查项数

- `standard`：10 构图 + `no_ascii` + `no_base64` + `ref_reachable` = **13 项**
- `showcase`：16 项**全过**

---

## 4. 退出码表

| 码 | 触发场景 |
|:---:|:---|
| `0` | doctor 全绿；validate 通过；render 通过并产出文件 |
| `1` | 验证失败：schema 不合法，或检查项有 `ok:false`（render 时**不写盘**） |
| `2` | 用法错误：未知命令、未知 `<type>`、`validateSchema` 之外输入层错误（文件缺失、JSON 解析失败）、`--quality` 非法 |

> `--json` 模式下错误信息也是 JSON：`{ "schemaVersion":1, "ok":false, "diagnostics":[...] }`。

---

## 5. 回执 JSON schema

`--json` 输出结构：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "render",
  "type": "architecture",
  "input": "/abs/ir.json",
  "output": "/abs/out.svg",
  "checks": [
    { "name": "label_route_clearance", "ok": true, "details": [] }
  ],
  "composition": {
    "profile": "showcase",
    "status": "pass",
    "summary": { "total": 15, "passed": 15, "failed": 0 }
  },
  "artifact": { "bytes": 7809, "sha256": "2b00a5ee..." }
}
```

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `schemaVersion` | `1` | 回执契约版本 |
| `ok` | boolean | 整体是否通过（无诊断 + 检查全过） |
| `command` | string | `doctor`/`guide`/`validate`/`render`/`unknown` |
| `type` | string | 图类型（或 `null`） |
| `input` | string | 输入 IR 绝对路径 |
| `output` | string\|null | 产物路径；validate 为 `null`，render 失败为 `null` |
| `checks` | Check[] | 本档位跑的全部检查（含跳过项） |
| `composition.profile` | `"standard"\|"showcase"` | 档位 |
| `composition.status` | `"pass"\|"fail"` | 汇总状态 |
| `composition.summary` | `{total,passed,failed}` | 检查计数 |
| `artifact` | `{bytes,sha256}` | 仅 render 成功时存在；sha256 用 `node:crypto` |

错误回执（schema 失败 / 用法错误）：额外带 `diagnostics` 数组，`checks` 为空，`composition.status` 为 `fail`。

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "validate",
  "type": "architecture",
  "input": "/abs/bad.json",
  "output": null,
  "checks": [],
  "composition": { "profile": null, "status": "fail", "summary": { "total": 0, "passed": 0, "failed": 0 } },
  "diagnostics": [
    { "code": "cli/usage", "severity": "error",
      "message": "输入不是合法 JSON：/abs/bad.json\n...",
      "subject": {}, "evidence": {}, "supportedFixes": [] }
  ]
}
```
