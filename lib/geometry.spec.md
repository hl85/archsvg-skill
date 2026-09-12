# `lib/geometry.mjs` 黑盒行为规格（净室重写用）

## 0. 本规格的使用方式与优先级

- **唯一可执行判据是 `tests/fixtures/geometry-golden.json`**（配合其入参 `tests/fixtures/geometry-corpus.json`，由 `tests/geometry-parity.test.mjs` 逐条比对）。
- **规格与 fixtures 冲突时，一律以 fixtures 为准**；规格是让人快速收敛的导读，不是比 fixtures 更高一级的权威。
- 数值比较按**相对容差 1e-9**（`scale = max(|期望|, |实际|, 1)`），因此中间算式不必逐位复刻，但必须落在该容差内。
- **实现者不得阅读 `lib/geometry.mjs`（vendored 参考实现）**。只允许阅读本规格、`tests/fixtures/*.json`、以及调用方 `lib/checks/composition.mjs` / `lib/layout.mjs` 的**调用点**（用于确认字段名）。
- 本规格描述的是「给定输入 → 产出什么输出、在什么条件下」。任何人若发现本规格需要「猜」某条行为，那是本规格的漏洞，应以 fixtures 为准并回补本规格。

---

## 1. 模块定位与导出面

### 1.1 模块路径与必须导出

实现落在 **`lib/geometry.mjs`**（原地替换现有文件，路径不变；调用方与 parity 测试的 import 目标都无需改动）。必须**恰好导出下列 8 个函数，名字与大小写完全一致**：

| 导出名 | 类别 | 返回 |
|:---|:---|:---|
| `isFinitePoint` | 谓词 | boolean |
| `rectsOverlap` | 谓词 | boolean |
| `segmentIntersectsRect` | 谓词 | boolean |
| `routeHonorsEndpointSides` | 谓词 | boolean |
| `collectLabelRouteClearance` | 收集器 | 数组 |
| `collectAmbiguousCorridors` | 收集器 | 数组 |
| `collectBorderRuns` | 收集器 | 数组 |
| `collectRouteRhythmIssues` | 收集器 | 数组 |

除这 8 个之外**不得有其它具名导出**。特别是：本模块不得再 import 或调用任何“诊断录制”设施，不得读写任何环境变量，不得依赖 `process` 状态。

### 1.2 明确不得出现（上游负担，全部剔除）

下列名字/能力**不得出现**在实现里（既不导出，也不作为内部辅助）：

- `clean*` 系列（上游自动修复：如与 endpoint-side / flow / crossing / corridor / border-run / route-rhythm / label-clearance 相关的 `clean*`）。
- 所有 `suggest*`（上游的“建议修法”文案生成）。
- `componentFill`、`componentText`、`arrowClassMap`、`variantAccent`（上游渲染词汇）。
- 任何 `profile` / `profileIsAuthoritative` 形参，以及任何“质量档位”概念。
- 任何读环境变量的行为（如 `ARCHIFY_QUALITY_PROFILE`）。
- 任何“诊断录制 / 抑制录制 / 诊断边界”相关能力，以及对 `lib/diagnostics.mjs` 的依赖。
- 原实现里其余**未被这 8 个入口复用**的导出，也一律不保留（例如数组兜底工具、锚点/端口/自动路由/自适应端口扇开、折线路径串、圆角路径串、路由预算指标、标签锚点、矩形格式化、分段净空/分段交叠长度这两个内部量作为**导出**、以及各种内部 identity 工具等）。它们若被实现为私有辅助是可以的，但不得导出、不得出现在对外契约里。

---

## 2. 通用口径

### 2.1 数值容差（可观测口径）

实现里有两种量级的固定容差，必须按下面的**可观测条件**复刻，而不是按“某个内部变量”复刻：

- **ε = 0.0001**。它在各入口的具体含义见第 3 节，归纳为：
  - 判定“共线”时：轴线坐标之差 **不超过** 0.0001 视为同轴。
  - 判定“退化/零长”时：长度 **不超过** 0.0001 视为零，不产生命中。
  - 判定“达到阈值”时：把实际量与阈值比较前先做 **0.0001 的宽容**，宽容的**方向因入口而异**（见各入口，误把方向写反会被 fixtures 抓到）。
  - 判定“正向推进足够”时：沿轴推进量 **严格大于** 0.0001 才算数（等于 0.0001 不算）。
  - 规范化折线时：相邻两点的坐标差 **均不超过** 0.0001 才视为同一点。
- **ε₇ = 0.0000001（1e-7）**：只用于「线段是否退化成一个点」以及点—线段投影的退化判断；其可见效果是：退化线段按点处理。

阈值本身的**默认值**（入参省略/为 `undefined` 时生效）：

| 入参 | 默认值 |
|:---|:---|
| `rectsOverlap` 的 `gap` | `0` |
| `segmentIntersectsRect` 的 `gap` | `0` |
| `collectAmbiguousCorridors` 的 `minOverlapPx` | `8` |
| `collectRouteRhythmIssues` 的 `interiorSegmentPx` | `16` |
| `collectRouteRhythmIssues` 的 `microSegmentPx` | `8` |

`collectLabelRouteClearance` 的 `threshold` **没有默认值**：非有限数或负数一律使结果为 `[]`（缺省即 `undefined`，等价于 `[]`）。
`collectBorderRuns` 无阈值参数。

### 2.2 规范折线形式（多个入口共享的行为）

`routeHonorsEndpointSides` 与四个收集器 **`collectLabelRouteClearance` / `collectAmbiguousCorridors` / `collectRouteRhythmIssues`** 在解释一条“折线”时，使用同一个**规范折线形式**；`collectBorderRuns` **不使用**它（`collectBorderRuns` 直接取原始点/段，见 3.7）。

对任一无序点列，其**规范折线形式**是满足下列全部性质、且由原序列**保序删除元素**得到的那个点列：

- (a) 每个元素都是长度为 2 的**有限数**对；数组长度不为 2、或含非有限数、或不是数组的元素一律不出现。
- (b) 相邻两个元素**不同时**落在彼此的 0.0001 方框内（即不出现 |Δx| ≤ 0.0001 且 |Δy| ≤ 0.0001 的相邻对）。
- (c) 不存在下标 i，使三点 `[i-1] → [i] → [i+1]` “同向共线”：叉积绝对值 ≤ 0.0001 且点积 ≥ −0.0001（即中间点位于一条向前直行的线段上）。

若规范折线形式少于 2 个点，则相关的“方向/净空/走廊/节奏”判定对该折线**不产生任何命中**（见各入口）。
语料支撑：`syn@routeHonorsEndpointSides:dup-and-collinear#1158`（(b)(c) 合并）、`syn@routeHonorsEndpointSides:degenerate-zero-length#1157`、`syn@routeHonorsEndpointSides:malformed-points#1170`、`syn@routeHonorsEndpointSides:nan-point#1168`、`syn@routeHonorsEndpointSides:along-at-epsilon#1166`（两点相距恰好 0.0001 → 被 (b) 合并 → 无方向问题）、`syn@collectRouteRhythmIssues:collinear-normalized#1262`、`syn@collectAmbiguousCorridors:normalized-points#1216`、`syn@collectRouteRhythmIssues:nan-points#1268`。

### 2.3 “同一关系”的判定（共享行为）

`collectLabelRouteClearance` 需要对“关系”做**去重**与**跳过同关系**两种判定，二者使用同一套身份口径：

- 若关系对象上 `key` 不为 `undefined`，身份由 `key` 决定。
- 否则若关系对象上 `id` 为真值，身份由 `(from, to, id)` 三元组决定。
- 否则身份退化为该条目所处位置的**下标**（整数 `relationIndex`，若它不是整数则用数组下标）。

“同关系”还额外包含“两个引用是同一个对象”这一情形。
语料支撑：`syn@collectLabelRouteClearance:same-relationship-key#1189`、`syn@collectLabelRouteClearance:duplicate-routes#1193`、`syn@collectLabelRouteClearance:duplicate-labels#1192`、`syn@collectLabelRouteClearance:same-relationship#1188`。

---

## 3. 逐个入口契约

每个入口先给「入参」，再给「返回结构」，再给「语义 / 边界」。括号里的 `syn@…#nnnn` 是**支撑该断言**的语料 id。

### 3.1 `isFinitePoint(...coords)` → boolean

- **入参**：任意个参数（0 个或多个），语义上是若干“坐标”。
- **返回**：`true` 当且仅当**每一个**参数都是有限数（`Number.isFinite` 为真）。
- **边界**：
  - 无参数 → `true`（`syn@isFinitePoint:no-args#1272`）。
  - `-0` 是有限数 → `true`（`syn@isFinitePoint:negative-zero#1271`）。
  - `NaN`、`±Infinity` → `false`（`syn@isFinitePoint:nan#1273`、`syn@isFinitePoint:infinity#1274`、`syn@isFinitePoint:negative-infinity#1275`）。
  - 非 number：数字字符串、空字符串、布尔、`null`、`undefined`、对象、嵌套数组 → 一律 `false`（`syn@isFinitePoint:numeric-string#1277`、`syn@isFinitePoint:empty-string#1283`、`syn@isFinitePoint:boolean#1280`、`syn@isFinitePoint:null#1278`、`syn@isFinitePoint:undefined#1279`、`syn@isFinitePoint:object#1281`、`syn@isFinitePoint:nested-array#1282`）。
  - 混合参数中只要有一个不是有限数即为 `false`（`syn@isFinitePoint:nan-among-finite#1276`）。
- 不抛错。

### 3.2 `rectsOverlap(a, b, gap = 0)` → boolean

- **入参**：
  - `a`、`b`：矩形对象，字段 `x`、`y`、`width`、`height`（数值）。无必填校验，缺字段按 `undefined` 参与判定。
  - `gap`：可选数值，省略/`undefined` → `0`。
- **返回**：布尔。
- **语义**：
  - **前置（有限性守卫）**：若 `a`、`b` 的 `x,y,width,height` 八个值中**任意一个非有限**，结果一律 `false`（“未知”按“不重叠”处理）。注意 `gap` **不在**守卫范围内。（`syn@rectsOverlap:nan-x#1118`、`syn@rectsOverlap:nan-in-second#1119`、`syn@rectsOverlap:infinity-width#1120`、`syn@rectsOverlap:nan+infinity#1121`、`syn@rectsOverlap:missing-size#1124`）
  - 否则，结果为 `false` 当且仅当存在某一个轴，使两矩形在该轴上“相距至少 `gap`”：即 `a` 的右边界加 `gap` 不大于 `b` 的左边界，或 `b` 的右边界加 `gap` 不大于 `a` 的左边界，或 `a`/`b` 的上下边界同理。除此之外均返回 `true`。
- **边界与方向**：
  - **恰好相切**（边贴边，`gap=0`）→ `false`（`syn@rectsOverlap:tangent-x#1101`、`syn@rectsOverlap:tangent-y#1102`、`syn@rectsOverlap:corner-touch#1111`）。
  - 两矩形在 x 上**恰好相距 `gap`** → `false`；**略小于 `gap`** → `true`（`syn@rectsOverlap:exactly-gap#1103`、`syn@rectsOverlap:just-under-gap#1104`）。即“相距 ≥ gap 才不算重叠”用的是**闭区间**。
  - **负 `gap`** 表示要求两矩形真正交叠超过 `|gap|` 才算“重叠”（缩小重叠区）（`syn@rectsOverlap:negative-gap-narrow#1106`、`syn@rectsOverlap:negative-gap-1px#1107`、`syn@rectsOverlap:negative-gap-2px#1108`）。
  - **非有限 `gap`**（`NaN`、`Infinity`）会令上述四条“相距”判据全部不成立，于是结果为 `true`（`syn@rectsOverlap:nan-gap#1123`、`syn@rectsOverlap:infinity-gap#1122`）。
  - 包含关系、完全相同 → `true`；零尺寸矩形落在另一矩形内部（含边界）→ `true`，两个零尺寸矩形同点（边全部相切）→ `false`（`syn@rectsOverlap:contained#1109`、`syn@rectsOverlap:identical#1112`、`syn@rectsOverlap:zero-size-inside#1113`、`syn@rectsOverlap:zero-size-same-point#1114`、`syn@rectsOverlap:zero-size-outside#1115`）。
  - 负 `width`/`height` 无专门守卫，按同一套边界公式参与判定（`syn@rectsOverlap:negative-width#1116`、`syn@rectsOverlap:negative-height#1117`）。
  - `gap` 缺省等价于 `0`：`(0,0,10,10)` 与 `(10,0,10,10)` 无第三参 → `false`；与 `(9,0,10,10)` → `true`（`syn@spec@rectsOverlap:default-gap-tangent#1284`、`syn@spec@rectsOverlap:default-gap-near#1285`）。

### 3.3 `segmentIntersectsRect(segment, rect, gap = 0)` → boolean

- **入参**：
  - `segment`：对象，字段 `start`、`end`，各为 `[x, y]`。
  - `rect`：矩形对象 `x,y,width,height`。
  - `gap`：可选数值，省略/`undefined` → `0`。
- **返回**：布尔。
- **语义**：先由 `rect` 与 `gap` 得到一个**外扩（`gap>0`）/ 收缩（`gap<0`）**的判定盒：左 = `rect.x − gap`，上 = `rect.y − gap`，右 = `rect.x + rect.width + gap`，下 = `rect.y + rect.height + gap`。结果为 `true` 当且仅当：`segment` 的某一端**落在盒内（含边界）**，或 `segment` 与盒的四条边**相交（含擦边、擦角）**。
- **边界与方向**：
  - 端点恰好在边界上算命中；擦边、擦角算命中（`syn@segmentIntersectsRect:grazing-edge#1128`、`syn@segmentIntersectsRect:corner-touch#1129`、`syn@segmentIntersectsRect:point-on-corner#1138`）。
  - `gap` **恰好**把盒扩到端点处 → `true`；`gap` 再小一点够不到 → `false`（`syn@segmentIntersectsRect:gap-reaches#1134`、`syn@segmentIntersectsRect:gap-just-short#1135`）。
  - 退化线段（两端点相同）按一个**点**处理：点在盒内/边界上 → `true`，否则 `false`（`syn@segmentIntersectsRect:point-inside#1136`、`syn@segmentIntersectsRect:point-outside#1137`）。
  - 零尺寸矩形：盒退化为一个点，线段经过该点 → `true`（`syn@segmentIntersectsRect:zero-rect-hit#1139`）。
  - **负 `gap`** 收缩盒：原本仅贴着未收缩边界、收缩后已不在盒内/不相交的线段 → `false`（`syn@spec@segmentIntersectsRect:negative-gap-pulls-in#1287`；对照同线段 `gap=0` → `true`，`#1288`）。
  - **本入口没有有限性守卫**：`NaN` 会顺着比较传播。可见结果以 fixtures 为准：`nan-start` 因**另一端在盒内**而 `true`（`#1141`）；`nan-rect` 为 `false`（`#1143`）；`nan-gap` 为 `false`（`#1145`）；`infinity-end` 因起点在盒角而 `true`（`#1142`）；`infinity-rect` 因点在盒内而 `true`（`#1144`）。
  - 负尺寸矩形（盒的右/下边界小于左/上边界）也无守卫，其退化边界仍可能被判相交 → 语料结果 `true`（`syn@segmentIntersectsRect:negative-rect#1140`）。
- **非法输入的兼容性要求（现状，非设计意图）**：
  - 当 `segment.start` 缺失（`undefined`）时，调用**抛出 `TypeError`**。这是为保持与现状逐条一致而保留的行为，**不是**有意的设计；实现必须同样抛 `TypeError`（parity 只比对错误类型，不比对措辞）。（`syn@segmentIntersectsRect:missing-start#1146`，`result` 记为 `null` 且记录 `error.name === "TypeError"`）
  - `segment.end` 缺失时**不必然**抛错：若起点已经先被判定落在盒内，则结果为 `true`（`syn@segmentIntersectsRect:missing-end#1147`）；否则会因读取缺失坐标而抛 `TypeError`。可见规则即“该入口不校验 `segment` 形状，凡实际读到的缺失坐标都会抛 `TypeError`”。
  - `gap` 缺省等价于 `0`：`[25,10]→[30,10]` 对 `(0,0,20,20)` → `false`（`syn@spec@segmentIntersectsRect:default-gap-outside#1286`）。

### 3.4 `routeHonorsEndpointSides(points, fromSide, toSide)` → boolean

- **入参**：
  - `points`：折线，`[x, y]` 数组的数组。
  - `fromSide`、`toSide`：字符串（期望取值 `left` / `right` / `top` / `bottom`；其它值/`null`/`undefined`/`auto` 均视为“无契约”）。
- **返回**：布尔；对任何输入都**不抛错**。
- **语义**：把 `points` 化为**规范折线形式**（见 2.2）。若结果少于 2 个点 → `true`。否则：**源端**看第 1 段，**目的端**看最后 1 段；两端各自独立判定，**两端都满足**才返回 `true`，任一端不满足即 `false`。
- **单端判定规则**（side → 期望方向）：

  | side | 期望轴 | 源端应指向 | 目的端应指向 |
  |:---|:---|:---|:---|
  | `left` | 水平 | 往 −x | 往 +x |
  | `right` | 水平 | 往 +x | 往 −x |
  | `top` | 竖直 | 往 −y | 往 +y |
  | `bottom` | 竖直 | 往 +y | 往 −y |

  该端“满足”当且仅当：线段**垂直于期望轴**（另一轴上的分量绝对值 ≤ 0.0001），**且**沿期望轴的推进量在期望方向上**严格大于 0.0001**。否则该端不满足。
- **边界**：
  - 首/末段是斜线（垂直于期望轴的分量超过 0.0001）→ 不满足（`syn@routeHonorsEndpointSides:diagonal-first#1156`）。
  - 首/末段方向反向 → 不满足（`syn@routeHonorsEndpointSides:left-but-rightward#1150`、`syn@routeHonorsEndpointSides:right-but-leftward#1151`、`syn@routeHonorsEndpointSides:top-down-wrong#1153`）。
  - 推进量不足（含 0）→ 不满足；恰好 0.0001 也**不满**（严格大于）。
  - 未知 side 名（含 `auto` / `null` / `undefined`）→ **该端不设要求**；但**另一端仍会被检查**。因此 `('diagonal','right')` 仍因目的端 `right` 不满足而为 `false`（`syn@routeHonorsEndpointSides:unknown-from-side#1162`、`syn@routeHonorsEndpointSides:unknown-to-side#1163`）；两端都无契约 → `true`（`syn@routeHonorsEndpointSides:auto-sides#1164`、`syn@routeHonorsEndpointSides:null-sides#1165`）。
  - 规范后少于 2 点 → `true`：空数组、单点、非数组 `null`、退化零长、点被非有限过滤后只剩 1 点（`syn@routeHonorsEndpointSides:empty#1159`、`syn@routeHonorsEndpointSides:single-point#1160`、`syn@routeHonorsEndpointSides:not-array#1161`、`syn@routeHonorsEndpointSides:degenerate-zero-length#1157`、`syn@routeHonorsEndpointSides:nan-point#1168`、`syn@routeHonorsEndpointSides:infinity-point#1169`、`syn@routeHonorsEndpointSides:malformed-points#1170`）。
  - 合法用例（含“重复点 + 共线中间点”被规范化后仍满足）→ `true`（`syn@routeHonorsEndpointSides:right-top-ok#1149`、`syn@routeHonorsEndpointSides:top-up#1152`、`syn@routeHonorsEndpointSides:dup-and-collinear#1158`）。
  - 注意两端的**组合**：源端正确、但目的端为斜段 → 仍 `false`（`syn@routeHonorsEndpointSides:bottom-top-ok#1171`）；源端方向不符（尽管用例名暗示目的端才是重点）→ 也 `false`（`syn@routeHonorsEndpointSides:target-left-ok#1155`）。

### 3.5 `collectLabelRouteClearance({ labels, routedRelations, threshold })` → 数组

- **入参**（对象，字段如下）：
  - `labels`：标签数组。每个元素是对象；其矩形取 `label.rect`，**若无 `rect` 字段则把标签对象自身当作矩形**；其关系取 `label.relation`；其位置索引取整数 `label.relationIndex`，否则用数组下标。
  - `routedRelations`：路由数组。每个元素是对象；其关系取 `entry.relation`，**若无则把条目自身当作关系**；其折线取 `entry.points`，**若缺失则回退到关系的 `routePoints`**；其位置索引取整数 `entry.relationIndex`，否则用数组下标。
  - `threshold`：数值，**无默认值**。
- **返回**：命中数组，可能为空。
- **前置**：若 `threshold` 不是有限数，或为负数 → `[]`（`syn@collectLabelRouteClearance:negative-threshold#1180`、`syn@collectLabelRouteClearance:nan-threshold#1181`、`syn@collectLabelRouteClearance:infinity-threshold#1182`、`syn@collectLabelRouteClearance:undefined-threshold#1183`）。
- **参与集合的筛除**：
  - 路由：关系缺失，或折线化为规范形式后少于 2 点 → 剔除（`syn@collectLabelRouteClearance:short-route#1195`、`syn@collectLabelRouteClearance:route-without-relation#1196`）；含 `NaN` 段的折线在规范化后仍可能保留可用段（`syn@collectLabelRouteClearance:route-with-nan-segment#1197`）。
  - 标签：矩形缺失，或矩形含非有限坐标，或宽/高为负 → 剔除（`syn@collectLabelRouteClearance:null-rect#1186`、`syn@collectLabelRouteClearance:nan-rect#1185`、`syn@collectLabelRouteClearance:negative-width-rect#1184`）。
  - 路由按 2.3 的身份去重，**只保留首次出现**（`syn@collectLabelRouteClearance:duplicate-routes#1193`）；标签同理（`syn@collectLabelRouteClearance:duplicate-labels#1192`）。
- **配对与跳过**：对每个（标签 × 路由）组合，若**标签的索引等于路由的索引**，或二者属于**同一关系**（2.3）→ 跳过该组合。前者是真实的“索引空间碰撞”行为，必须保留（`syn@collectLabelRouteClearance:index-collision-skip#1190`、`syn@collectLabelRouteClearance:same-relationship#1188`、`syn@collectLabelRouteClearance:same-relationship-key#1189`）。
- **命中条件**：在未跳过的组合里，取该路由**离标签矩形最近的那一段**，其“距离”定义为矩形到线段的距离（相交则为 0）。仅当该距离**比阈值小出超过 0.0001** 时才产生命中，即：命中 ⟺ 距离 < `threshold` − 0.0001。等距取**先出现（下标更小）**的段。
  - 恰好等于阈值 → 不命中（`syn@collectLabelRouteClearance:clearance-exactly-threshold#1172`）。
  - 阈值上调 0.0002 后同一距离 → 命中（`syn@collectLabelRouteClearance:clearance-at-threshold-plus#1174`）。
  - 恰在 epsilon 带内（距离 = 阈值 − 0.00005）→ **不命中**（`syn@spec@collectLabelRouteClearance:clearance-in-epsilon-band#1290`）；再低一点（阈值 − 0.0002）→ 命中（`syn@spec@collectLabelRouteClearance:clearance-just-below-band#1291`、`syn@collectLabelRouteClearance:clearance-just-under#1173`）。
  - 每对（标签, 路由）**最多一条命中**，取该路由的最近段而不是每段各报一条（`syn@collectLabelRouteClearance:multiple-routes#1198` 三条路由只报最近的一条；`syn@spec@collectLabelRouteClearance:nearest-segment-reported#1289` 一条路由的三段只报最近段）。
  - 最近段选择：`syn@spec@collectLabelRouteClearance:nearest-segment-reported#1289` 期望 `segmentIndex = 1`（竖直段与矩形相交，距离 0），而非首段；等距时取先出现段：`syn@spec@collectLabelRouteClearance:segment-tie-earliest-wins#1292` 期望 `segmentIndex = 0`。
- **命中对象字段**（字段名是契约，调用方直接读取，见第 5 节）：
  | 字段 | 类型 | 语义 |
  |:---|:---|:---|
  | `label` | 原标签对象 | 原样回指入参（因此 `label.relationIndex` 缺失时命中也保留该缺失） |
  | `labelRelation` | 对象或 `undefined` | 标签的关系（`label.relation`） |
  | `labelRelationIndex` | number | 标签的有效索引 |
  | `otherRelation` | 对象 | 该路由的关系 |
  | `otherRelationIndex` | number | 该路由的有效索引 |
  | `rect` | 对象 | 实际用于判定的标签矩形 |
  | `clearance` | number | 最近段到矩形的距离（相交为 0） |
  | `intersectionLength` | number | 最近段落在该矩形内部的那部分长度；不重叠时为 0 |
  | `segmentIndex` | number | 最近段在**规范折线**中的下标 |
  | `start` / `end` | `[x,y]` | 最近段的两端 |
  | `threshold` | number | 原样回指传入阈值 |
  - `intersectionLength` 可见值示例：部分重叠 `19.999999999999996`（`syn@collectLabelRouteClearance:overlapping-rect#1175`）、完全覆盖路由段 `10`（`syn@collectLabelRouteClearance:covering-rect#1176`）、不重叠 `0`（`#1289` 之外多数条目）。
- 其它边界：`labels` 为空 / 路由为空 / 两者皆空 → `[]`（`syn@collectLabelRouteClearance:empty-labels#1177`、`syn@collectLabelRouteClearance:empty-routes#1178`、`syn@collectLabelRouteClearance:both-empty#1179`）。
- 关系身份回退：标签缺 `relationIndex` 时用数组下标（`syn@collectLabelRouteClearance:label-index-fallback#1191`，命中里 `label.relationIndex` 编码为 `__undefined`，因为命中原样回指入参对象）。

### 3.6 `collectAmbiguousCorridors({ routedRelations, minOverlapPx = 8 })` → 数组

- **入参**：
  - `routedRelations`：路由数组。每个元素**必须**有 `relation` 且其 `from`、`to` 都是字符串，折线取 `entry.points`（规范折线形式），索引取整数 `entry.relationIndex`，否则数组下标。
  - `minOverlapPx`：可选数值，默认 `8`。
- **返回**：命中数组。
- **语义（走廊 = 同轴共线且相互重叠的一段）**：
  - 路由若关系不合法、或折线规范后少于 2 点 → 剔除（`syn@collectAmbiguousCorridors:invalid-relation#1214`、`syn@collectAmbiguousCorridors:nan-points#1215`）。
  - 路由两两组合，**跳过共享任一语义端点**（`from`/`to` 有交集）的组合（`syn@collectAmbiguousCorridors:shared-endpoint-exempt#1209`）。
  - 对每一组合，候选来自“其一段 × 其另一段”且两段落在**同一条水平或竖直线**上（见 2.1：轴线坐标差 ≤ 0.0001）；候选的重叠长度是该轴上的区间交集长度，重叠 ≤ 0.0001 的候选不成立（`syn@collectAmbiguousCorridors:crossing-not-collinear#1204`、`syn@collectAmbiguousCorridors:parallel-1px-apart#1205`、`syn@collectAmbiguousCorridors:collinear-disjoint#1207`、`syn@collectAmbiguousCorridors:touch-at-endpoint#1208`）。
  - 候选**成立**当且仅当 重叠长度 + 0.0001 ≥ `minOverlapPx`（闭区间方向的宽容）：恰好等于 `minOverlapPx` → 成立；略小（7.9）→ 不成立；恰在带内（7.99995）→ **成立**（`syn@collectAmbiguousCorridors:overlap-exactly-min#1201`、`syn@collectAmbiguousCorridors:overlap-just-under-min#1202`、`syn@collectAmbiguousCorridors:overlap-in-epsilon-band#1203`）。`minOverlapPx = 0` 时任何正重叠都成立（`syn@collectAmbiguousCorridors:min-overlap-zero#1213`）；缺省默认 8 生效（`syn@collectAmbiguousCorridors:default-min-overlap#1212`）。
  - 一组合内取**最长**候选；后出现者需比当前最长**再多出超过 0.0001** 才替换，因此等长时保留**先遍历到的段对（`leftSegment` 小者优先，其次 `rightSegment` 小者）**（`syn@collectAmbiguousCorridors:longest-segment-wins#1211`、`syn@spec@collectAmbiguousCorridors:tie-earliest-pair-wins#1293`）。
  - 每个成立的组合最多一条命中；同一关系出现两次且共享两端点时被跳过（`syn@collectAmbiguousCorridors:same-relation-twice#1220`）；三条线两两组合 → 3 条（`syn@collectAmbiguousCorridors:three-routes#1217`）。空/非数组 → `[]`（`syn@collectAmbiguousCorridors:empty#1218`、`syn@collectAmbiguousCorridors:not-array#1219`）。
- **命中对象字段**：
  | 字段 | 类型 | 语义 |
  |:---|:---|:---|
  | `left` / `right` | 对象 | 两个路由描述符，各含 `relation`、`relationIndex`、`points`（规范化后的折线） |
  | `leftSegment` / `rightSegment` | number | 重叠段在各自规范折线中的下标 |
  | `overlapLength` | number | 重叠长度 |
  | `overlapStart` / `overlapEnd` | `[x,y]` | 重叠区间的两端，按**小→大**排序（反向绘制时亦然） |
  - 反向绘制示例：`syn@collectAmbiguousCorridors:reversed-direction#1210` 期望 `overlapStart=[20,10]`、`overlapEnd=[100,10]`。

### 3.7 `collectBorderRuns({ routedRelations, frames })` → 数组

- **入参**：
  - `routedRelations`：路由数组。每条的段集合：若 `entry.segments` 是数组则用它，否则由 `entry.points` 的相邻点对构成。
  - `frames`：框/容器数组。
- **返回**：命中数组。
- **本入口不使用规范折线形式**：段集合与点坐标**原样**参与判定。
- **路由筛除**：段集合为空 → 跳过；段集合中**任一段**的 `start`/`end` 不是“长度为 2 的有限数对” → **整条路由跳过**（`syn@collectBorderRuns:segments-non-finite#1244`、`syn@collectBorderRuns:points-non-finite#1246`、`syn@collectBorderRuns:single-point-route#1245`、`syn@collectBorderRuns:segments-array#1243`）。
- **框的边**：
  - `shape === "line"` 的框只贡献一条名为 `line` 的边，端点为 `frame.start`（缺省回退 `[frame.x1, frame.y1]`）与 `frame.end`（缺省回退 `[frame.x2, frame.y2]`）；四个坐标任一非有限 → 该框不贡献任何边（`syn@collectBorderRuns:line-shape#1235`、`syn@collectBorderRuns:line-shape-x1y1#1236`、`syn@collectBorderRuns:line-shape-non-finite#1237`）。
  - 其它框（且非 `null`/非对象）只有在 `x,y,width,height` 全有限**且** `width>0`、`height>0` 时才贡献四条边 `top`/`right`/`bottom`/`left`；否则不贡献（`syn@collectBorderRuns:frame-zero-size#1238`、`syn@collectBorderRuns:frame-negative-size#1239`、`syn@collectBorderRuns:frame-nan#1240`、`syn@collectBorderRuns:frame-null#1241`）。
  - 每条边按圆角半径**内缩**：半径 = 把可转成数字的 `frame.radius` 夹在 `[0, width/2]` 与 `[0, height/2]` 之间；`radius` 缺失/非数值/`NaN` 计为 `0`，数字字符串按其数值（`syn@collectBorderRuns:radius-trim-partial#1229`、`syn@collectBorderRuns:radius-trim-inside#1230`、`syn@collectBorderRuns:radius-clamped#1231`、`syn@collectBorderRuns:radius-string#1232`、`syn@collectBorderRuns:radius-missing#1233`、`syn@collectBorderRuns:radius-nan#1234`）。内缩后长度 ≤ 0.0001 的边不贡献。
  - 边的产出顺序为 `top` → `right` → `bottom` → `left`（`syn@collectBorderRuns:two-sides#1249` 的两条命中依次为 `top`、`left`）。
- **命中条件**：路由的某一段与某条边**同轴共线**（轴线坐标差 ≤ 0.0001）且沿轴重叠 **> 0.0001**（`syn@collectBorderRuns:offset-1px#1222` 不命中、`syn@collectBorderRuns:offset-at-epsilon#1223` 命中、`syn@collectBorderRuns:overlap-at-epsilon#1247` 不命中（恰好 0.0001）、`syn@collectBorderRuns:overlap-over-epsilon#1248` 命中、`syn@collectBorderRuns:coincident-top#1221`、`syn@collectBorderRuns:partial-top#1227`、`syn@collectBorderRuns:coincident-right#1228`）。
- **合并规则（可观测）**：对同一条边，所有重叠区间先按**并集**合并，命中只出**一条**；`overlapLength` 是合并后各区间的**长度之和**，因此沿同一路径来回重走**不会**被重复计数（`syn@collectBorderRuns:two-sides#1249` 的 `top` 命中 `overlapLength = 40`，而非 80；`syn@spec@collectBorderRuns:merge-same-side#1294` 期望 50）。`overlapStart`/`overlapEnd` 取**最长的那一个合并区间**的两端；`segmentIndex` 取所有参与重叠的段中**下标最小**者。
- **命中对象字段**：路由条目自身字段（`relation`、`points` 或 `segments`、`relationIndex`）**原样展开**，另加：
  | 字段 | 类型 | 语义 |
  |:---|:---|:---|
  | `frame` | 原框对象 | 原样回指 |
  | `frameIndex` | number | 框在 `frames` 数组中的下标 |
  | `side` | string | `"top"` / `"right"` / `"bottom"` / `"left"` / `"line"` |
  | `segmentIndex` | number | 参与重叠的最小段下标 |
  | `overlapLength` | number | 合并后长度之和 |
  | `overlapStart` / `overlapEnd` | `[x,y]` | 最长合并区间的两端 |
  - 多个框、四条边时，命中按“路由为主序、框为次序、边为末序”产出（`syn@collectBorderRuns:two-frames#1250`、`syn@collectBorderRuns:two-sides#1249`）。
- 空输入 → `[]`（`syn@collectBorderRuns:no-frames#1224`、`syn@collectBorderRuns:no-routes#1225`、`syn@collectBorderRuns:all-empty#1226`）。

### 3.8 `collectRouteRhythmIssues({ routedRelations, interiorSegmentPx = 16, microSegmentPx = 8 })` → 数组

- **入参**：
  - `routedRelations`：路由数组；折线取 `entry.points`（规范折线形式）；索引取整数 `entry.relationIndex`，否则数组下标。
  - `interiorSegmentPx`、`microSegmentPx`：可选数值，默认 `16`、`8`。
- **返回**：问题数组。
- **语义**：
  - 折线规范后少于 2 点 → 跳过（`syn@collectRouteRhythmIssues:short-route#1265`、`syn@collectRouteRhythmIssues:not-array#1266`、`syn@collectRouteRhythmIssues:empty#1267`、`syn@collectRouteRhythmIssues:nan-points#1268`、`syn@collectRouteRhythmIssues:collinear-normalized#1262`）。
  - **段长口径是曼哈顿长度**：`|Δx| + |Δy|`，不是欧氏距离（`syn@spec@collectRouteRhythmIssues:diagonal-manhattan-length#1296` 对 `(3,4)` 位移给出 `length = 7`）。
  - 段长 ≤ 0.0001 → 该段不产生问题（`syn@collectRouteRhythmIssues:zero-length-segment#1261`）。
  - **位置**：第 1 段为 `source-stub`，最后 1 段为 `target-stub`，其余为 `interior`；仅两点的折线其唯一段按**第 1 段**记为 `source-stub`（`syn@collectRouteRhythmIssues:two-points#1260`、`syn@collectRouteRhythmIssues:multiple-issues#1263`、`syn@spec@collectRouteRhythmIssues:target-stub-micro#1297`）。
  - **问题码**：
    - 段长 **< `microSegmentPx` − 0.0001** → `"composition/micro-segment"`（不看位置）。
    - 否则，若位置为 `interior` 且段长 **< `interiorSegmentPx` − 0.0001** → `"composition/short-interior-segment"`。
    - 否则不产生问题。
  - 两端都用**严格小于**且各留 0.0001 的宽容：恰好等于阈值、或仅低于阈值不足 0.0001 → **不报**。
    - 中间段：`16` → 不报；`15.99995` → 不报；`15.99985` → 报 `short-interior`；`15.9` → `short-interior`；`8` → `short-interior`；`7.99995` → `short-interior`；`7.99985` → `micro`；`7.9` → `micro`（`syn@collectRouteRhythmIssues:interior-exactly-16#1251`、`syn@collectRouteRhythmIssues:interior-15.99995#1253`、`syn@spec@collectRouteRhythmIssues:interior-15.99985#1298`、`syn@collectRouteRhythmIssues:interior-15.9#1252`、`syn@collectRouteRhythmIssues:interior-exactly-8#1254`、`syn@collectRouteRhythmIssues:interior-7.99995#1256`、`syn@spec@collectRouteRhythmIssues:interior-7.99985#1299`、`syn@collectRouteRhythmIssues:interior-7.9-micro#1255`）。
    - 端点段没有 `interiorSegmentPx` 下限，只有 `microSegmentPx` 下限（`syn@collectRouteRhythmIssues:stub-exactly-8#1257`、`syn@collectRouteRhythmIssues:stub-7.9-micro#1258`、`syn@collectRouteRhythmIssues:stub-15.9-ok#1259` 三条因折线被规范化（共线）而无问题；端点段仍会产生 `micro`：`syn@spec@collectRouteRhythmIssues:target-stub-micro#1297`）。
    - 自定义阈值生效（`syn@collectRouteRhythmIssues:custom-thresholds#1264`）。
  - 一条路由可产生多个问题（`syn@collectRouteRhythmIssues:multiple-issues#1263` 期望 2 条）。
- **问题对象字段**：
  | 字段 | 类型 | 语义 |
  |:---|:---|:---|
  | `code` | string | `"composition/micro-segment"` 或 `"composition/short-interior-segment"` |
  | `relation` | 对象或 `undefined` | 该路由的 `relation` 原样 |
  | `relationIndex` | number | 有效索引 |
  | `segmentIndex` | number | 段在规范折线中的下标 |
  | `position` | string | `"source-stub"` / `"target-stub"` / `"interior"` |
  | `length` | number | 曼哈顿段长 |
  | `start` / `end` | `[x,y]` | 该段两端 |

---

## 4. 入口之间的依赖

只陈述依赖事实，不展开流程：

- `rectsOverlap` 依赖 `isFinitePoint` 做有限性前置。
- `collectBorderRuns` 依赖 `isFinitePoint` 判定路由段端点与 `line` 型框端点是否有限。
- `collectLabelRouteClearance` 依赖 `segmentIntersectsRect`（用于“矩形与线段相交则距离为 0”，并据此计算 `intersectionLength`）。
- 规范折线形式（2.2）被 `routeHonorsEndpointSides`、`collectLabelRouteClearance`、`collectAmbiguousCorridors`、`collectRouteRhythmIssues` 共享；`collectBorderRuns` **不**共享（它用原始段）。
- 关系身份口径（2.3）被 `collectLabelRouteClearance` 使用。
- 除上述以外，8 个入口之间**没有**其它交叉调用；各收集器不互相调用。`routeHonorsEndpointSides`、`isFinitePoint`、`segmentIntersectsRect`、`rectsOverlap`、`collectAmbiguousCorridors`、`collectRouteRhythmIssues` 不依赖任何其它导出。

---

## 5. 调用方依赖的返回字段（契约冻结）

以下字段被 `lib/checks/composition.mjs` 与 `lib/layout.mjs` **直接读取**，改名/改型即破坏调用方，必须逐字保留：

| 入口 | 被读取的字段 | 调用点 |
|:---|:---|:---|
| `collectLabelRouteClearance` | `h.otherRelation?.id`、`h.otherRelationIndex`、`h.label?.label`、`h.labelRelationIndex`、`h.clearance`；`layout.mjs` 只读 `hits.length` | `composition.mjs:162-163`、`layout.mjs:248` |
| `routeHonorsEndpointSides` | 返回值本身（布尔） | `composition.mjs:181` |
| `collectAmbiguousCorridors` | `h.left.relation.from`、`h.left.relation.to`、`h.right.relation.from`、`h.right.relation.to`、`h.overlapLength` | `composition.mjs:195-197` |
| `collectBorderRuns` | `h.frame?.label`、`h.frame?.id`、`h.frameIndex`、`h.relation?.id`、`h.side`、`h.overlapLength` | `composition.mjs:210-211` |
| `collectRouteRhythmIssues` | `iss.relation?.id`、`iss.relationIndex`、`iss.segmentIndex`、`iss.length`、`iss.position`、`iss.code` | `composition.mjs:223-224` |
| `rectsOverlap`、`segmentIntersectsRect`、`isFinitePoint` | 返回值本身（布尔） | `composition.mjs:87-90,101,125,237` 及 `layout.mjs` |

因此，第 3 节列出的**全部**命中/问题字段都必须存在且类型正确，即使某些字段调用方当前未读（例如 `intersectionLength`、`start`、`end`、`threshold`、`overlapStart/End`、`rightSegment`），因为 fixtures 会逐字段比对。

---

## 6. 本规格的已知弱点（需实现者从 fixtures 反推）

诚实记录，凡在此列出的点，**以 fixtures 为准**：

1. **非有限值的传播路径**：`segmentIntersectsRect` 未做有限性守卫，`NaN`/`Infinity` 的最终结果依赖“端点是否落在盒内”与“线段是否与盒边相交”这两类判定的逐条比较结果。本规格给出“不守卫 + 逐条比较”的可观测结论并用 5 条语料冻结（`#1140–#1145`），但若断言失败，请以 golden 的实际布尔值为准。
2. **`intersectionLength` 的精确浮点值**：例如 `19.999999999999996`。它只按相对容差 1e-9 比较，因此“用哪条等价算式得到”不被冻结；不要试图逐位复刻。
3. **`collectBorderRuns` 在“多框 × 多边 × 多段”下的命中顺序**：仅由 `two-sides#1249`（同框两边顺序）与 `two-frames#1250`（跨框但只 1 条）弱约束。若实现产出集合相同但顺序不同，parity 会按数组下标报错；请以 golden 的数组顺序为准。
4. **`collectAmbiguousCorridors` 的“等长候选”替换条件**：本规格按「严格多出 0.0001 才替换」描述，并用 `#1293` 冻结；`within 0.0001 的近似等长`这一极端情形未单独构造语料。
5. **规范折线形式在“可级联删除”的极端构型**：语料只覆盖了单点共线与重复点（`#1158`、`#1262`、`#1215`）。若出现删除一个中间点后又新暴露可删除点的构造，请以 golden 为准。
6. **`collectLabelRouteClearance` 的 `label`/`rect` 等字段是回指入参原对象**（非拷贝）：`label-index-fallback#1191` 里 `label.relationIndex` 编码为 `__undefined` 即此证据。规格要求保留这一回指语义。
7. **`segmentIntersectsRect` 缺 `start` 抛 `TypeError`**：parity 只比对错误类型；错误消息措辞不要求一致。
