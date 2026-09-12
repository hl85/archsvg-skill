// 排版与几何常量：**单点定义**。
//
// layout（估算/摆放）、render（绘制）、theme（CSS）、checks（断言）四处必须引用本表，
// 禁止各自硬编码数值。历史缺陷：同一字号在四处各写一遍，改一处就会静默错位
// （例：节点字号改 16→18，盒高估算却仍是 16 的公式 → 文字溢出盒子，所有检查项均查不出）。
//
// `archsvg doctor` 会断言 `references/design-system.md` 的字级/线宽表与本表一致（见 doctor 项
// 「docs 常量 ↔ 代码常量」），任何一侧改动而忘记同步都会立刻变红。

// 字级表：px + 字重。theme.mjs 用它生成 CSS，layout/checks 用它估算宽度。
export const TYPE_SCALE = {
  title: { px: 24, weight: 700 },       // 图标题
  frameLabel: { px: 13, weight: 700 },  // 组框标签
  nodeTitle: { px: 16, weight: 700 },   // 节点标题
  nodeSub: { px: 12, weight: 400 },     // 节点副标签
  edgeLabel: { px: 12, weight: 400 },   // 边标签
  legend: { px: 12, weight: 400 },      // 图例文字
  caption: { px: 12, weight: 400 },     // 底部图注
};

// 节点盒几何。
export const BOX = {
  minWidth: 96,
  maxWidth: 240,
  padX: 14,          // 左右内边距
  lineHeight: 18,    // 行距（多行时逐行 +18）
  heightSingle: 42,  // 单行盒高
  heightDouble: 58,  // 双行盒高
  radius: 8,
  gap: 16,           // 同带/同层盒间距
  rowGap: 54,        // 带间距
};

// 边标签几何。
//
// 两组数值刻意分开：
//   - rect*/clearance 是「净空判定」用的标签名义矩形。放置器与检查器必须用同一组，
//     否则放置器会选出「刚好差 0.5px 不达标」的位置，导致 label_route_clearance 批量误报。
//   - mask* 是「背景遮罩」实际绘制的矩形。遮罩必须**包住文字 bbox**，
//     而估算宽度与真实字体度量存在误差（实测最大 4.8%），故在名义矩形上再放安全边。
//
// 实测依据（headless Chromium 量 text bbox）：
//   - 文字 bbox 高 ≈ 字号 × 1.25（12px → 15px），故 maskHeight 必须 > rectHeight；
//   - 文字垂直锚点即 labelAt（`dominant-baseline: central` 已在 CSS 里生效），
//     故 baselineOffset 必须为 0 —— 历史上渲染侧额外 +3px，导致遮罩下沿稳定漏出 3.5px。
export const EDGE_LABEL = {
  rectHeight: 15,   // 名义标签矩形高（= 净空阈值）
  rectPadX: 8,      // 名义标签矩形左右留白
  clearance: 15,    // 净空下限，必须 = rectHeight（且 >= 8）
  maskPadX: 10,     // 遮罩左右留白（= rectPadX + 2px 安全边）
  maskPadY: 2,      // 遮罩上下安全边
  maskRadius: 3,
  baselineOffset: 0,
};

// 背景遮罩的实际高（派生，勿单独硬编码）。
export const EDGE_MASK_HEIGHT = EDGE_LABEL.rectHeight + 2 * EDGE_LABEL.maskPadY;

// 线宽。
export const STROKE = {
  node: 1.5,
  edge: 2,
  edgeDashed: [5, 4],
  lifeline: 1.5,
  lifelineDashed: [4, 4],
  frame: 1.25,
  legendBox: 1,
  arrowPath: 1.4,
};

// 组框（容器）几何。
export const FRAME = {
  pad: 18,       // 框内边距
  radius: 10,
  labelInsetX: 12,
  labelInsetY: 18,
};

// 图例几何。
export const LEGEND = {
  swatch: 14,
  rowHeight: 18,
  colGap: 10,
  insetX: 10,
  insetTop: 12,
  widthPad: 16,   // 盒子宽 = widthPad + 各列宽 + 列间距（左右合计留白）
  minWidth: 120,
  defaultColWidth: 96,
  gapToContent: 16,
};

// 画布几何。
export const CANVAS = {
  margin: 24,
  titleHeight: 56,
  captionHeight: 26,
  captionBottomInset: 11,
  titleBaseline: 32,
};

// 时序图几何。
export const SEQUENCE = {
  lifeTopGap: 40,
  msgTopGap: 12,
  rowGap: 44,
  selfLoopWidth: 22,
  selfLoopHeight: 26,
  lifeBottomPad: 8,
};

// 横向演进图（stages）列间距：相邻档位之间的边是水平段，
// 间距必须大于 2×STUB 才能留出足够长的内部段（route_rhythm 要求 interior >= 16px）。
export const STAGE = { colGap: 64, minColWidth: 160 };

// 回边外侧绕行通道与最左 box 左缘的间距。
export const BACK_CHANNEL_GAP = 28;

// 正交路由的首末端外伸长度。
export const STUB = 14;

// 允许出现在产物里的字重白名单。TYPOGRAPHY 只产出 700（标题/组框/节点标题）与
// 400（其余正文档），故以此断言「无第三档字重」——防止未来引入 500/600 造成视觉层级漂移。
export const WEIGHT_WHITELIST = [400, 700];
