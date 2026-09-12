# 几何差分测试与行为基线（净室重写前置）

这套设施的唯一目的：在把 vendored 的 `lib/geometry.mjs`（含只有它才 import 的
`lib/diagnostics.mjs`）**净室重写**之前，先把「当前实现的实际行为」冻结成可执行的判据。
重写后只需改一行 import，就能证明新实现与旧行为逐条一致（或指出全部不一致点）。

## 组成

| 文件 | 作用 |
|:---|:---|
| `tests/tools/geometry-codec.mjs` | 入参/结果的编解码器（单点定义 `NaN` / `Infinity` / `undefined` / 函数 / 循环引用的 JSON 标记）与带 1e-9 相对容差的深度比较 |
| `tests/tools/build-geometry-corpus.mjs` | 产出**入参语料** `tests/fixtures/geometry-corpus.json`（真实数据 + 合成边界） |
| `tests/tools/capture-geometry-golden.mjs` | ⚠️ 只在 vendored 代码还在时可用：跑当前实现，产出**行为基线** `tests/fixtures/geometry-golden.json` |
| `tests/geometry-parity.test.mjs` | parity 测试：逐条比对被测实现与基线；`archsvg test` 自动发现 |
| `tests/fixtures/*.json` | 生成物（语料 670 KB / golden 703 KB），随仓库提交 |

## 用法

```bash
node bin/archsvg.mjs test                     # 跑 parity（日常只需要这一条）
```

> ⛔ **两个生成脚本都已退役，且带硬闸门，默认拒绝运行。**
> 它们产出的是 parity 的判据本身，而判据**已随净室重写冻结**：
> - `capture-geometry-golden.mjs`：须 `ARCHSVG_GEOMETRY_REFERENCE=<参考实现路径>` 且该文件
>   sha256 等于 `fcc6f6855fef465fbcbe780009fa083867ae8abd7814dfc47cb6ab3ddca7ce90`，否则拒绝。
> - `build-geometry-corpus.mjs`：语料已存在时须显式 `--force`，否则拒绝。
>
> 原因：重跑它们会把判据换成**当前实现自己的输出**，parity 当场退化成永远为真，
> 而不会有任何提示。参考实现已从仓库移除，因此实际上**不能**再重生成。

**实现替换已完成**（2026-09-12 净室重写）：`tests/geometry-parity.test.mjs` 顶部那行 import
现已指向自研的 `../lib/geometry.mjs`。若日后再次替换实现，只改那一行即可。

## 语料构成

共 **1278** 条。真实数据来自 `samples/*.json` + `examples/*.json` 共 9 个 IR：逐个
`layout(ir)` 后，**严格按 `lib/checks/composition.mjs` 与 `lib/layout.mjs` 的真实调用方式**
重建每个入口的入参（照 `buildRoutes()` / `boxRoutes()` / `buildLabelRect()` /
`placeLabels()` 复刻，未改动任何生产文件）。合成边界 **204** 条，覆盖：

- `rectsOverlap`：相切 / 恰好等于 gap / 略小于 gap / 负 gap / 包含 / 角接触 / 零尺寸 / 负尺寸 / NaN、Infinity（含非有限 gap）
- `segmentIntersectsRect`：穿过 / 擦边 / 擦角 / 内含 / 在外 / 退化为一点 / gap 外扩恰到 / `start`/`end` 缺失（当前实现抛 TypeError，如实冻结）
- `routeHonorsEndpointSides`：首末段水平/垂直/斜/反向 / 退化零长段 / 重复点与共线归一化 / 点数不足 2 / 未知 side / `along` 落在 0.0001 边界
- `collectLabelRouteClearance`：距离恰好 = 阈值 / 略小于 / 含 epsilon 带 / 矩形部分重叠 / `labels` 为空 / 阈值非法（负、NaN、Infinity、undefined）/ 同一 relationship 跳过 / **索引碰撞跳过**（composition 的 boxRoutes 与 edges 共用 relationIndex 的真实行为）
- `collectAmbiguousCorridors`：完全共线重叠 / 恰好 = `minOverlapPx` / epsilon 带内 / 交叉不共线 / 平行 1px / 共享端点豁免 / 垂直重叠 / 反向绘制 / 多条线两两组合
- `collectBorderRuns`：与边框完全重合 / 相距 1px / epsilon 带 / `frames` 为空 / `shape:"line"` / 圆角裁剪与 clamp / `radius` 为字符串或 NaN / frame 零负尺寸 / 路由用 `segments` 数组 / 非有限点
- `collectRouteRhythmIssues`：中间段恰好 16 / 15.9 / epsilon 带 15.99995 / 恰好 8 / 7.9 / epsilon 带 7.99995 / 端点段 8 与 15.9 / 零长段 / 多问题
- `isFinitePoint`：全有限 / `-0` / 空参数 / NaN / ±Infinity / 字符串 / null / undefined / 布尔 / 对象 / 嵌套数组

> 另有 **16 条“规格闭合”语料**（tag 前缀 `spec@`，在生成器里**最后追加**，因此不改动上面
> 已有条目的 `#seq`）：补齐 gap 缺省值、负 gap 收缩、最近段被选中并回指、阈值/长度 epsilon
> 带的另一侧、同侧多段合并计数、曼哈顿段长、`target-stub` 位置、走廊等长候选的 tie-break
> 等——这些是 `lib/geometry.spec.md` 每条断言所需的直接证据。
>
> 另有 **7 条「边界带」语料**（tag 前缀 `lead@`，编号 `#1301` 起，由 lead 在收尾阶段用参考实现
> 直接算出并追加，**不在生成脚本里**——所以重跑生成脚本会丢掉它们，两侧 id 集合会不一致，
> parity 的成对性断言会当场报错）。它们钉的是三处原先无覆盖的边界：
>
> | 条目 | 钉住的边界 | 基线值 |
> |:---|:---|:---|
> | `lead@collectLabelRouteClearance:degenerate-seg-inside-band#1301` | 平方长 9e-8 ≤ 1e-7 → 按点处理 | `clearance=0.00031622776601683794` |
> | `…:degenerate-seg-above-band#1302` | 平方长 1.024e-7 > 1e-7 → 按线段投影 | `clearance=0.0003` |
> | `…:degenerate-seg-exactly-at-band#1303` | 恰在阈值上 | `clearance=0.0004` |
> | `lead@collectAmbiguousCorridors:axis-offset-within-epsilon#1304` | 轴线差 5e-5 ≤ 1e-4 → 视为同轴 | `overlapLength=80` |
> | `…:axis-offset-beyond-epsilon#1305` | 轴线差 1.5e-4 > 1e-4 → 不同轴 | `[]` |
> | `lead@collectBorderRuns:merge-gap-within-epsilon#1306` | 投影间隙 5e-5 | 两条独立命中（`40` / `59.99995`） |
> | `…:merge-gap-beyond-epsilon#1307` | 投影间隙 1.5e-4 | 两条独立命中（`40` / `59.99985`） |
>
> `#1302` 是这几条里最关键的：把退化阈值退回 1e-14（即重写时那版误读的语义）时，
> parity 立刻 `1/204` 红并指向它——它把「与参考实现对齐」这件事永久钉住了。

## ⚠️ 可证伪性验证（必做，且日后新增语料后要重做）

一个「永远绿」的 parity 等于没有。用环境变量把**故意改坏的实现副本**接上，确认它会红、
且报错能指到具体 id：

```bash
# 1) 从 vendored 源复制一份到 tests/tools/（只改 diagnostics 的相对路径）
node -e 'const fs=require("fs");const s=fs.readFileSync("lib/geometry.mjs","utf8");
fs.writeFileSync("tests/tools/geometry-broken.mjs",s.replace("./diagnostics.mjs","../../lib/diagnostics.mjs"))'
# 2) 手工把某个阈值/守卫改坏（见下表）
# 3) 用覆盖开关跑
ARCHSVG_GEOMETRY_IMPL=./tools/geometry-broken.mjs node bin/archsvg.mjs test
# 4) 验证完删除副本，确认默认路径重新全绿
rm tests/tools/geometry-broken.mjs && node bin/archsvg.mjs test
```

### 本轮实测结果（2026-09-12）

| 变异 | 命中 case | 报错是否指到 id / 路径 |
|:---|:---|:---|
| A：`rectsOverlap` 的 gap 边界 `<=` 改成 `<` | **合成边界** 2/181 不一致 | ✅ `id=syn@rectsOverlap:tangent-x#1101`、`syn@rectsOverlap:exactly-gap#1103`，路径 `$`（期望 `false`，实际 `true`） |
| B：`collectAmbiguousCorridors` 去掉「共享语义端点豁免」 | **真实数据** 5/1074 不一致 | ✅ `id=real:samples/alert-triage.flow.json@composition.relationship_corridors#0071` 等，路径 `$.length`（期望 `0`，实际 `2`） |
| C：`collectRouteRhythmIssues` 的 8px/16px 阈值去掉 `0.0001` epsilon | **合成边界** 2/181 不一致 | ✅ `id=syn@collectRouteRhythmIssues:interior-7.99995#1256`，路径 `$[0].code`（期望 `"composition/short-interior-segment"`，实际 `"composition/micro-segment"`） |

变异 B 专门用来证明**真实数据语料是活判据**（不只是合成条目在起作用）；变异 C 证明差异
能定位到**数组下标 + 字段**，不只是顶层长度。

> 第一次做变异 C 时它**没有变红** —— 因为当时的语料只有「恰好 8px」和「7.9px」，
> 漏掉了 `7.9999 < 长度 < 8` 这个 epsilon 带。随后补了 3 条 epsilon 带语料
> （`interior-7.99995`、`interior-15.99995`、`overlap-in-epsilon-band`）才捕获。
> **教训：新增/修改语料后必须重做本节验证，否则无法知道新条目是否真的在承重。**

## 已知的近似与不可序列化项（如实记录，未静默丢弃）

- **抛错条目 1 条**：`syn@segmentIntersectsRect:missing-start#1146`，当前实现抛
  `TypeError: Cannot read properties of undefined (reading '0')`。golden 记为
  `result: null` + `error.name/message`；parity 只比对错误**类型**（message 措辞跨实现不保证一致）。
- **结果里的标记各 1 处**，都来自「结果回指了入参对象」而非计算本身：
  - `__undefined`：`syn@collectLabelRouteClearance:label-index-fallback#1191` —— 命中项里
    `label.relationIndex` 是 `undefined`（原样回指入参）。
  - `__num: "NaN"`：`syn@collectBorderRuns:radius-nan#1233` —— 命中项回指了入参 frame 的 `radius: NaN`。
- **`collectLabelRouteClearance` 的 layout 形状条目是重建的近似**：`placeLabels()` 内部用
  「候选位置」调用，布局结束后候选位置不可见，故这些条目用**最终 `labelAt`** 重建同形状
  的调用（阈值、路由集合索引都照 `placeLabels`）。它锁定的是「同一调用形状下的输入输出
  关系」，不是「placeLabels 内部每一次候选试算的逐个快照」。
- **`-0` 与 `0` 无法区分**：JSON 序列化会丢 `-0`；比较时按相对容差视为相等。
- **浮点比对用相对容差 1e-9**（`scale = max(|a|,|b|,1)`），不是逐位相等；这是为了让重写允许
  不同的中间运算顺序，同时仍能抓住真实的数值偏差。
- **语料/golden 用紧凑 JSON**（非缩进）：2 空格缩进会把 golden 从 703 KB 抬到 1.68 MB。
- 语料生成时按 `(fn, 入参)` 去重，丢弃 28 条完全重复条目（`segmentIntersectsRect` 14、
  `isFinitePoint` 12、其余 2）；id 在去重前分配，去重后仍唯一。

## 与 harness 的关系

本目录的 `tests/*.test.mjs` 会被 `archsvg test` 自动发现（约定：导出 `cases = [{ name, run }]`）。
本套设施不改动 `lib/` 下任何文件，也不新增依赖，`archsvg doctor` 的文档↔代码常量一致性
检查不受影响。
