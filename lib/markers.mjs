// 箭头 marker 契约：**单点定义** defs 里的 marker 集合与「连线种类 → marker」映射。
//
// 由来（本模块要挡住的缺陷类）：marker 是 SVG 里典型的「跨引用」资源 ——
// `marker-end="url(#id)"` 与 `<marker id="id">` 分处两地，任何一侧改名都会静默失效
// （Chrome 对不可达引用不报错，只是不画箭头）。这类缺陷在只看布局数据的检查里完全不可见。
//
// 契约（由 `marker_contract` 检查在渲染产物上双向断言）：
//   ① defs 中出现的 marker id ⊆ ARROW_MARKER_IDS；
//   ② ARROW_MARKER_IDS 全部被定义（缺一即失败）；
//   ③ 所有 `url(#x)` 引用的 x 都有对应 `id="x"` 定义。
//
// 反例（真实事故，来自同类系统的公开实现）：设计文档教模型写 `<marker id="arrow">`，
// 而宿主样式表写 `.arr { marker-end: url(#arrowhead) }`，两处 id 不一致且 `#arrowhead` 从未定义
// —— 按文档产出的图全部没有箭头，且没有任何检查报错。

// defs 中允许出现的 marker id 全集。
export const ARROW_MARKER_IDS = ['arrow', 'arrow-async', 'arrow-fallback'];

// 连线种类 → 样式。dashed=true 用虚线。
// kind 取值受 schemas/common.schema.json 约束：sync / async / data / fallback / return。
// lifeline 为时序图生命线，不画箭头。
export const EDGE_STYLE = {
  sync: { marker: 'arrow', dashed: false },
  data: { marker: 'arrow', dashed: false },
  async: { marker: 'arrow-async', dashed: true },
  fallback: { marker: 'arrow-fallback', dashed: true },
  return: { marker: 'arrow', dashed: true },
  lifeline: { marker: null, dashed: true, life: true },
};

// 未知 kind 的兜底（schema 已拦，这里只保证渲染器不会崩）。
export const DEFAULT_EDGE_STYLE = { marker: 'arrow', dashed: false };

export function edgeStyleFor(kind) {
  return EDGE_STYLE[kind] || DEFAULT_EDGE_STYLE;
}

// marker 几何。v1 三个 marker 共用同一 viewBox 与定位参数，
// 差异只在路径（实心三角 vs 空心 chevron）与线宽上 —— 改一处即三处同步。
export const MARKER_GEOMETRY = {
  viewBox: '0 0 10 10',
  markerWidth: 9,
  markerHeight: 9,
  refX: 7,
  refY: 4,
  orient: 'auto-start-reverse',
  markerUnits: 'userSpaceOnUse',
};

// 每个 marker 的绘制定义：路径 d + 用哪个 class 上色（class 定义在 theme.mjs）。
export const MARKER_SHAPES = {
  arrow: { d: 'M0,0 L8,4 L0,8 Z', cls: 'arrow-fill' },        // 实心
  'arrow-async': { d: 'M0,0 L8,4 L0,8', cls: 'arrow-line' },   // 空心 chevron
  'arrow-fallback': { d: 'M0,0 L8,4 L0,8', cls: 'arrow-line' },
};

// 扫描文本里所有 `url(#id)` 形式的引用 id（供检查器与自测复用）。
export function collectUrlRefs(text) {
  const out = [];
  for (const m of String(text).matchAll(/url\(\s*#([^)\s"']+)\s*\)/g)) out.push(m[1]);
  return out;
}

// 扫描文本里所有 `id="..."` 定义。
export function collectIds(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bid\s*=\s*"([^"]+)"/g)) out.push(m[1]);
  return out;
}
