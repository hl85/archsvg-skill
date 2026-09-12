// 几何差分测试的**入参语料**生成器（只产入参，不产结果）。
//
// 目的：在净室重写 lib/geometry.mjs 之前，把「当前 ventered 实现被实际用到的 8 个入口」
// 的调用面冻结成可执行语料。结果基线由 capture-geometry-golden.mjs 另跑一遍产出。
//
// 语料两个来源，缺一不可：
//   1) 真实数据：对 samples/*.json + examples/*.json 逐个 layout(ir)，然后**严格按
//      lib/checks/composition.mjs 与 lib/layout.mjs 的真实调用方式**重建入参
//      （适配代码在 composition.mjs 的 buildRoutes / boxRoutes / buildLabelRect 与
//       layout.mjs 的 placeLabels 里，本文件照那几处复刻，不改动它们）。
//   2) 合成边界：手工构造的边界/退化/非有限值条目。
//
// 每条语料形如 { id, site, fn, args }；args 为参数数组（对象参数原样存）。
// 非有限数与 undefined 用 tests/tools/geometry-codec.mjs 显式编码，保证可稳定回读。
//
// 运行：node tests/tools/build-geometry-corpus.mjs
// 输出：tests/fixtures/geometry-corpus.json
//
// 注意：本脚本只依赖 lib/ 的 layout / text-metrics / typography（只读 import），
// 不需要 vendored geometry 在场即可产出语料；但与它配套的 golden 必须在
// vendored 代码还在时捕获。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { layout } from '../../lib/layout.mjs';
import { estimateTextWidth } from '../../lib/text-metrics.mjs';
import { TYPE_SCALE, EDGE_LABEL } from '../../lib/typography.mjs';
import { encodeValue } from './geometry-codec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, '..', 'fixtures', 'geometry-corpus.json');

// ---- 与 checks/composition.mjs、layout.mjs 同源的标签几何常量 ----
const LABEL_FONT = TYPE_SCALE.edgeLabel.px;      // composition: LABEL_FONT
const LABEL_HEIGHT = EDGE_LABEL.rectHeight;      // composition: LABEL_HEIGHT / layout: LABEL_H
const LABEL_PAD = EDGE_LABEL.rectPadX;           // composition: LABEL_PAD / layout: LABEL_PAD
// composition.mjs:158 —— 阈值 = max(8, LABEL_HEIGHT)
const COMP_LABEL_THRESHOLD = Math.max(8, LABEL_HEIGHT);
// layout.mjs:246 —— 阈值 = EDGE_LABEL.clearance
const LAYOUT_LABEL_THRESHOLD = EDGE_LABEL.clearance;

const entries = [];

function push(site, tag, fn, args) {
  const prefix = site === 'synthetic' ? 'syn' : `real:${site}`;
  const seq = String(entries.length + 1).padStart(4, '0');
  entries.push({ id: `${prefix}@${tag}#${seq}`, site, fn, args });
}

// =====================================================================
// 适配层：严格复刻生产代码的入参构造
// =====================================================================

// 复刻 lib/checks/composition.mjs 的 buildRoutes()
function buildRoutes(edges) {
  return edges.map((e, i) => ({
    relation: { id: e.id, from: e.from, to: e.to, label: e.label },
    points: e.points,
    relationIndex: i,
  }));
}

// 复刻 lib/checks/composition.mjs 的 boxRoutes()（relationIndex 与 edges 共用同一索引空间）
function boxRoutesSharedIndex(boxes) {
  return boxes.map((b, i) => ({
    relation: { id: `box:${b.id}`, from: `box:${b.id}`, to: `box:${b.id}` },
    points: [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
      [b.x, b.y],
    ],
    relationIndex: i,
  }));
}

// 复刻 lib/layout.mjs placeLabels() 的 boxRoutes（relationIndex 从 edges.length 起，避免与边冲突）
function boxRoutesOffsetIndex(boxes, offset) {
  return boxes.map((b, i) => ({
    relation: { id: `box:${b.id}`, from: `box:${b.id}`, to: `box:${b.id}` },
    points: [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
      [b.x, b.y],
    ],
    relationIndex: offset + i,
  }));
}

// 复刻 composition.mjs 的 buildLabelRect() 与 layout.mjs 的 labelRect()（两者同口径）
function labelRectAt(at, text) {
  const w = estimateTextWidth(text || '', LABEL_FONT) + LABEL_PAD;
  return {
    x: at[0] - w / 2,
    y: at[1] - LABEL_HEIGHT / 2,
    width: w,
    height: LABEL_HEIGHT,
  };
}

// =====================================================================
// 真实数据语料
// =====================================================================
function buildRealEntries(site, ir) {
  const lr = layout(ir);
  const boxes = lr.boxes || [];
  const frames = lr.frames || [];
  const edges = lr.edges || [];
  const legend = lr.legend || null;

  // ---- rectsOverlap：复刻 composition.mjs:96-108（node_overlap，gap=8）----
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      push(site, 'composition.node_overlap', 'rectsOverlap', [boxes[i], boxes[j], 8]);
    }
  }

  // ---- rectsOverlap：复刻 composition.mjs:231-243（legend_clearance，gap=8）----
  if (legend) {
    for (const obstacle of [...boxes, ...frames]) {
      push(site, 'composition.legend_clearance', 'rectsOverlap', [legend, obstacle, 8]);
    }
  }

  // ---- segmentIntersectsRect：复刻 composition.mjs:110-134（relationship_crossings，gap=0）----
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  for (const e of edges) {
    const fromBox = boxById.get(e.from);
    const toBox = boxById.get(e.to);
    const pts = e.points || [];
    for (let s = 0; s < pts.length - 1; s += 1) {
      const seg = { start: pts[s], end: pts[s + 1] };
      for (const b of boxes) {
        if (fromBox && b.id === fromBox.id) continue;
        if (toBox && b.id === toBox.id) continue;
        push(site, `composition.relationship_crossings:${e.id}`, 'segmentIntersectsRect', [seg, b, 0]);
      }
    }
  }

  // ---- routeHonorsEndpointSides：复刻 composition.mjs:174-187（orthogonal_arrows）----
  for (const e of edges) {
    if (e.kind === 'lifeline') continue;
    if (!e.fromSide || !e.toSide) continue;
    push(site, `composition.orthogonal_arrows:${e.id}`, 'routeHonorsEndpointSides', [e.points, e.fromSide, e.toSide]);
  }

  // ---- collectAmbiguousCorridors：复刻 composition.mjs:190-201（relationship_corridors）----
  push(site, 'composition.relationship_corridors', 'collectAmbiguousCorridors', [{
    routedRelations: buildRoutes(edges),
    minOverlapPx: 8,
  }]);

  // ---- collectBorderRuns：复刻 composition.mjs:203-215（container_border_runs）----
  push(site, 'composition.container_border_runs', 'collectBorderRuns', [{
    routedRelations: buildRoutes(edges),
    frames,
  }]);

  // ---- collectRouteRhythmIssues：复刻 composition.mjs:217-228（route_rhythm）----
  push(site, 'composition.route_rhythm', 'collectRouteRhythmIssues', [{
    routedRelations: buildRoutes(edges),
    interiorSegmentPx: 16,
    microSegmentPx: 8,
  }]);

  // ---- collectLabelRouteClearance：复刻 composition.mjs:136-171 的批量形状 ----
  // 注意 boxRoutes 复用 edges 的 relationIndex 空间 —— 这是真实行为，必须一起冻结。
  const labels = [];
  const edgeRoutes = [];
  edges.forEach((e, i) => {
    edgeRoutes.push({
      relation: { id: e.id, from: e.from, to: e.to, label: e.label },
      points: e.points,
      relationIndex: i,
    });
    if (e.label && e.labelAt) {
      labels.push({
        label: e.label,
        relationIndex: i,
        relation: { id: e.id, from: e.from, to: e.to, label: e.label },
        rect: labelRectAt(e.labelAt, e.label),
      });
    }
  });
  push(site, 'composition.label_route_clearance:batch', 'collectLabelRouteClearance', [{
    labels,
    routedRelations: [...edgeRoutes, ...boxRoutesSharedIndex(boxes)],
    threshold: COMP_LABEL_THRESHOLD,
  }]);

  // ---- collectLabelRouteClearance：复刻 layout.mjs:238-247（placeLabels 单标签形状）----
  // placeLabels 内部用「候选位置」调用；layout 结束后候选位置已不可见，这里用最终 labelAt
  // 重建同形状调用（阈值与路由集合索引都照 placeLabels）。见 README 的局限说明。
  const layoutRoutes = [...edgeRoutes, ...boxRoutesOffsetIndex(boxes, edges.length)];
  for (const lab of labels) {
    push(site, `layout.placeLabels:${lab.relation.id}`, 'collectLabelRouteClearance', [{
      labels: [lab],
      routedRelations: layoutRoutes,
      threshold: LAYOUT_LABEL_THRESHOLD,
    }]);
  }

  // ---- isFinitePoint：本项目里是空转 import（0 调用），仍按 finite_svg 的分组就地冻结 ----
  for (const b of boxes) {
    push(site, `composition.finite_svg:box:${b.id}`, 'isFinitePoint', [b.x, b.y, b.width, b.height, b.cx, b.cy]);
  }
  for (const f of frames) {
    push(site, `composition.finite_svg:frame:${f.id}`, 'isFinitePoint', [f.x, f.y, f.width, f.height]);
  }
  if (legend) {
    push(site, 'composition.finite_svg:legend', 'isFinitePoint', [legend.x, legend.y, legend.width, legend.height]);
  }
  for (const e of edges) {
    for (const p of e.points || []) {
      push(site, `composition.finite_svg:edge:${e.id}`, 'isFinitePoint', [p[0], p[1]]);
    }
  }
}

// =====================================================================
// 合成边界语料
// =====================================================================
const rect = (x, y, width, height) => ({ x, y, width, height });
const route = (id, from, to, points, relationIndex = 0) => ({ relation: { id, from, to }, points, relationIndex });

function addRectsOverlapSynthetic() {
  const S = 'synthetic';
  const a = rect(0, 0, 10, 10);
  // 边缘刚好相切（gap=0）→ 不算重叠
  push(S, 'rectsOverlap:tangent-x', 'rectsOverlap', [a, rect(10, 0, 10, 10), 0]);
  push(S, 'rectsOverlap:tangent-y', 'rectsOverlap', [a, rect(0, 10, 10, 10), 0]);
  // 相距恰好等于 gap=8 → 不算重叠
  push(S, 'rectsOverlap:exactly-gap', 'rectsOverlap', [a, rect(18, 0, 10, 10), 8]);
  // 相距略小于 gap=8 → 算重叠（gap 边界另一侧）
  push(S, 'rectsOverlap:just-under-gap', 'rectsOverlap', [a, rect(17.9, 0, 10, 10), 8]);
  // 相距 1px、gap=0 → 不重叠
  push(S, 'rectsOverlap:1px-apart', 'rectsOverlap', [a, rect(11, 0, 10, 10), 0]);
  // 负 gap 收窄判定：相距 2px、gap=-3 → 不重叠
  push(S, 'rectsOverlap:negative-gap-narrow', 'rectsOverlap', [a, rect(12, 0, 10, 10), -3]);
  // 负 gap=-1 且相距 1px → 仍不重叠（10-1=9 <= 11）
  push(S, 'rectsOverlap:negative-gap-1px', 'rectsOverlap', [a, rect(11, 0, 10, 10), -1]);
  // 负 gap 反而放宽到重叠：相距 2px、gap=-1 → 10-1=9 <= 12 成立 → 不重叠
  push(S, 'rectsOverlap:negative-gap-2px', 'rectsOverlap', [a, rect(12, 0, 10, 10), -1]);
  // 一个完全包含另一个
  push(S, 'rectsOverlap:contained', 'rectsOverlap', [rect(0, 0, 100, 100), rect(10, 10, 10, 10), 0]);
  // 反向包含（小在前）
  push(S, 'rectsOverlap:contained-reversed', 'rectsOverlap', [rect(10, 10, 10, 10), rect(0, 0, 100, 100), 0]);
  // 角接触
  push(S, 'rectsOverlap:corner-touch', 'rectsOverlap', [a, rect(10, 10, 10, 10), 0]);
  // 完全相同
  push(S, 'rectsOverlap:identical', 'rectsOverlap', [a, rect(0, 0, 10, 10), 0]);
  // 零尺寸矩形落在另一个内部 / 同点
  push(S, 'rectsOverlap:zero-size-inside', 'rectsOverlap', [rect(5, 5, 0, 0), a, 0]);
  push(S, 'rectsOverlap:zero-size-same-point', 'rectsOverlap', [rect(5, 5, 0, 0), rect(5, 5, 0, 0), 0]);
  push(S, 'rectsOverlap:zero-size-outside', 'rectsOverlap', [rect(50, 50, 0, 0), a, 0]);
  // 负宽 / 负高
  push(S, 'rectsOverlap:negative-width', 'rectsOverlap', [rect(0, 0, -10, 10), a, 0]);
  push(S, 'rectsOverlap:negative-height', 'rectsOverlap', [rect(0, 0, 10, -10), a, 0]);
  // 非有限几何 → 「未知」，一律 false（非有限守卫）
  push(S, 'rectsOverlap:nan-x', 'rectsOverlap', [rect(NaN, 0, 10, 10), a, 0]);
  push(S, 'rectsOverlap:nan-in-second', 'rectsOverlap', [a, rect(0, NaN, 10, 10), 0]);
  push(S, 'rectsOverlap:infinity-width', 'rectsOverlap', [rect(0, 0, Infinity, 10), a, 0]);
  push(S, 'rectsOverlap:nan+infinity', 'rectsOverlap', [rect(NaN, 0, Infinity, 10), rect(Infinity, 0, 10, NaN), 0]);
  // 非有限 gap
  push(S, 'rectsOverlap:infinity-gap', 'rectsOverlap', [a, rect(100, 0, 10, 10), Infinity]);
  push(S, 'rectsOverlap:nan-gap', 'rectsOverlap', [a, rect(100, 0, 10, 10), NaN]);
  // 缺 width/height（undefined）
  push(S, 'rectsOverlap:missing-size', 'rectsOverlap', [{ x: 0, y: 0 }, a, 0]);
  // 完全分离
  push(S, 'rectsOverlap:far-apart', 'rectsOverlap', [a, rect(1000, 1000, 10, 10), 0]);
}

function addSegmentIntersectsRectSynthetic() {
  const S = 'synthetic';
  const box = rect(0, 0, 20, 20);
  const seg = (start, end) => ({ start, end });
  // 穿过
  push(S, 'segmentIntersectsRect:crossing', 'segmentIntersectsRect', [seg([-10, 10], [30, 10]), box, 0]);
  // 斜穿
  push(S, 'segmentIntersectsRect:diagonal-crossing', 'segmentIntersectsRect', [seg([-5, -5], [25, 25]), box, 0]);
  // 擦边（沿右边）
  push(S, 'segmentIntersectsRect:grazing-edge', 'segmentIntersectsRect', [seg([20, -5], [20, 25]), box, 0]);
  // 擦角
  push(S, 'segmentIntersectsRect:corner-touch', 'segmentIntersectsRect', [seg([19, 19], [21, 21]), box, 0]);
  // 完全内含
  push(S, 'segmentIntersectsRect:fully-inside', 'segmentIntersectsRect', [seg([5, 5], [15, 15]), box, 0]);
  push(S, 'segmentIntersectsRect:inside-horizontal', 'segmentIntersectsRect', [seg([2, 10], [18, 10]), box, 0]);
  // 完全在外
  push(S, 'segmentIntersectsRect:fully-outside', 'segmentIntersectsRect', [seg([30, 30], [40, 40]), box, 0]);
  push(S, 'segmentIntersectsRect:outside-parallel', 'segmentIntersectsRect', [seg([-5, -5], [25, -5]), box, 0]);
  // 完全在外 + gap 外扩正好够到
  push(S, 'segmentIntersectsRect:gap-reaches', 'segmentIntersectsRect', [seg([30, 10], [40, 10]), box, 10]);
  push(S, 'segmentIntersectsRect:gap-just-short', 'segmentIntersectsRect', [seg([30, 10], [40, 10]), box, 9.9]);
  // 退化为一点
  push(S, 'segmentIntersectsRect:point-inside', 'segmentIntersectsRect', [seg([10, 10], [10, 10]), box, 0]);
  push(S, 'segmentIntersectsRect:point-outside', 'segmentIntersectsRect', [seg([100, 100], [100, 100]), box, 0]);
  push(S, 'segmentIntersectsRect:point-on-corner', 'segmentIntersectsRect', [seg([0, 0], [0, 0]), box, 0]);
  // 零尺寸矩形
  push(S, 'segmentIntersectsRect:zero-rect-hit', 'segmentIntersectsRect', [seg([0, 0], [10, 10]), rect(5, 5, 0, 0), 0]);
  // 负尺寸矩形（x2<x1 → 恒不相交）
  push(S, 'segmentIntersectsRect:negative-rect', 'segmentIntersectsRect', [seg([0, 0], [10, 10]), rect(10, 10, -5, -5), 0]);
  // 非有限
  push(S, 'segmentIntersectsRect:nan-start', 'segmentIntersectsRect', [seg([NaN, 0], [10, 10]), box, 0]);
  push(S, 'segmentIntersectsRect:infinity-end', 'segmentIntersectsRect', [seg([0, 0], [Infinity, 10]), box, 0]);
  push(S, 'segmentIntersectsRect:nan-rect', 'segmentIntersectsRect', [seg([0, 0], [10, 10]), rect(NaN, 0, 20, 20), 0]);
  push(S, 'segmentIntersectsRect:infinity-rect', 'segmentIntersectsRect', [seg([10, 10], [10, 10]), rect(0, 0, Infinity, Infinity), 0]);
  push(S, 'segmentIntersectsRect:nan-gap', 'segmentIntersectsRect', [seg([30, 10], [40, 10]), box, NaN]);
  // 缺 start / end（当前实现会抛 TypeError）—— 如实冻结
  push(S, 'segmentIntersectsRect:missing-start', 'segmentIntersectsRect', [seg(undefined, [1, 1]), box, 0]);
  push(S, 'segmentIntersectsRect:missing-end', 'segmentIntersectsRect', [seg([1, 1], undefined), box, 0]);
  // 线段两端都在外但穿过
  push(S, 'segmentIntersectsRect:long-crossing', 'segmentIntersectsRect', [seg([-100, 10], [100, 10]), box, 0]);
}

function addEndpointSidesSynthetic() {
  const S = 'synthetic';
  // 正确：right 出 / top 入
  push(S, 'routeHonorsEndpointSides:right-top-ok', 'routeHonorsEndpointSides', [[[0, 0], [10, 0], [10, 10]], 'right', 'top']);
  // 反向：left 出但首段向右
  push(S, 'routeHonorsEndpointSides:left-but-rightward', 'routeHonorsEndpointSides', [[[0, 0], [10, 0]], 'left', 'top']);
  // 反向：right 出但首段向左
  push(S, 'routeHonorsEndpointSides:right-but-leftward', 'routeHonorsEndpointSides', [[[0, 0], [-10, 0]], 'right', 'bottom']);
  // 垂直首段：top 出（向上）
  push(S, 'routeHonorsEndpointSides:top-up', 'routeHonorsEndpointSides', [[[0, 0], [0, -10], [10, -10]], 'top', 'left']);
  // 垂直首段方向错：top 出但向下
  push(S, 'routeHonorsEndpointSides:top-down-wrong', 'routeHonorsEndpointSides', [[[0, 0], [0, 10], [10, 10]], 'top', 'right']);
  // 末段方向错：right 入但末段向右
  push(S, 'routeHonorsEndpointSides:target-right-wrong', 'routeHonorsEndpointSides', [[[0, 0], [0, 10], [10, 10]], 'top', 'right']);
  // 末段方向对：left 入（dx 正）
  push(S, 'routeHonorsEndpointSides:target-left-ok', 'routeHonorsEndpointSides', [[[0, 0], [0, 10], [10, 10]], 'top', 'left']);
  // 斜线首段 → 违反（across 非零）
  push(S, 'routeHonorsEndpointSides:diagonal-first', 'routeHonorsEndpointSides', [[[0, 0], [10, 10]], 'right', 'top']);
  // 退化零长首段 → normalize 后不足两点 → true
  push(S, 'routeHonorsEndpointSides:degenerate-zero-length', 'routeHonorsEndpointSides', [[[0, 0], [0, 0]], 'right', 'left']);
  // 重复点 + 共线中间点
  push(S, 'routeHonorsEndpointSides:dup-and-collinear', 'routeHonorsEndpointSides', [[[0, 0], [0, 0], [5, 0], [10, 0], [10, 10]], 'right', 'top']);
  // 点数不足 2
  push(S, 'routeHonorsEndpointSides:empty', 'routeHonorsEndpointSides', [[], 'right', 'top']);
  push(S, 'routeHonorsEndpointSides:single-point', 'routeHonorsEndpointSides', [[[0, 0]], 'right', 'top']);
  push(S, 'routeHonorsEndpointSides:not-array', 'routeHonorsEndpointSides', [null, 'right', 'top']);
  // 无效 side 名（规则表缺失 → 该项不产生问题）
  push(S, 'routeHonorsEndpointSides:unknown-from-side', 'routeHonorsEndpointSides', [[[0, 0], [10, 10]], 'diagonal', 'right']);
  push(S, 'routeHonorsEndpointSides:unknown-to-side', 'routeHonorsEndpointSides', [[[0, 0], [10, 10]], 'right', 'diagonal']);
  push(S, 'routeHonorsEndpointSides:auto-sides', 'routeHonorsEndpointSides', [[[0, 0], [10, 0]], 'auto', 'auto']);
  push(S, 'routeHonorsEndpointSides:null-sides', 'routeHonorsEndpointSides', [[[0, 0], [10, 0]], null, undefined]);
  // along 恰好落在 0.0001 阈值上 / 之下
  push(S, 'routeHonorsEndpointSides:along-at-epsilon', 'routeHonorsEndpointSides', [[[0, 0], [0.0001, 0]], 'right', 'top']);
  push(S, 'routeHonorsEndpointSides:along-over-epsilon', 'routeHonorsEndpointSides', [[[0, 0], [0.0002, 0]], 'right', 'top']);
  // NaN / Infinity 点被 normalize 过滤
  push(S, 'routeHonorsEndpointSides:nan-point', 'routeHonorsEndpointSides', [[[NaN, 0], [10, 0]], 'right', 'top']);
  push(S, 'routeHonorsEndpointSides:infinity-point', 'routeHonorsEndpointSides', [[[0, 0], [Infinity, 0]], 'right', 'top']);
  // 结构错误点（长度 3 / 非数组元素）
  push(S, 'routeHonorsEndpointSides:malformed-points', 'routeHonorsEndpointSides', [[[0, 0, 0], [10, 0], 'x'], 'right', 'top']);
  // 三点无中间共线，末段为竖段
  push(S, 'routeHonorsEndpointSides:bottom-top-ok', 'routeHonorsEndpointSides', [[[0, 0], [0, 10], [10, 10]], 'bottom', 'top']);
}

function addLabelClearanceSynthetic() {
  const S = 'synthetic';
  const H = [[0, 0], [100, 0]];
  const label = (d, overrides = {}) => ({
    label: 'L',
    relationIndex: 1,
    relation: { id: 'L1', from: 'x', to: 'y', label: 'L' },
    rect: { x: 40, y: d, width: 20, height: 10 },
    ...overrides,
  });
  const call = (labels, routedRelations, threshold) => [{ labels, routedRelations, threshold }];

  // 距离恰好等于阈值 15 → 不报（nearest.clearance + 0.0001 >= threshold 成立）
  push(S, 'collectLabelRouteClearance:clearance-exactly-threshold', 'collectLabelRouteClearance',
    call([label(15)], [route('R1', 'a', 'b', H)], 15));
  // 略小于阈值 → 报
  push(S, 'collectLabelRouteClearance:clearance-just-under', 'collectLabelRouteClearance',
    call([label(14.9)], [route('R1', 'a', 'b', H)], 15));
  // 等于阈值但阈值上调 0.0002 → 报（阈值边界另一侧）
  push(S, 'collectLabelRouteClearance:clearance-at-threshold-plus', 'collectLabelRouteClearance',
    call([label(15)], [route('R1', 'a', 'b', H)], 15.0002));
  // 标签矩形与路由部分重叠（rect 跨越 y=0）
  push(S, 'collectLabelRouteClearance:overlapping-rect', 'collectLabelRouteClearance',
    call([label(-5)], [route('R1', 'a', 'b', H)], 15));
  // 标签矩形完全压住路由端点
  push(S, 'collectLabelRouteClearance:covering-rect', 'collectLabelRouteClearance',
    call([{ ...label(-5), rect: { x: -10, y: -5, width: 20, height: 10 } }], [route('R1', 'a', 'b', H)], 15));
  // labels 为空数组
  push(S, 'collectLabelRouteClearance:empty-labels', 'collectLabelRouteClearance',
    call([], [route('R1', 'a', 'b', H)], 15));
  // routedRelations 为空
  push(S, 'collectLabelRouteClearance:empty-routes', 'collectLabelRouteClearance',
    call([label(5)], [], 15));
  // labels 与 routedRelations 都为空
  push(S, 'collectLabelRouteClearance:both-empty', 'collectLabelRouteClearance', call([], [], 15));
  // 阈值非法：负数 / NaN / Infinity / 缺省
  push(S, 'collectLabelRouteClearance:negative-threshold', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', H)], -1));
  push(S, 'collectLabelRouteClearance:nan-threshold', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', H)], NaN));
  push(S, 'collectLabelRouteClearance:infinity-threshold', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', H)], Infinity));
  push(S, 'collectLabelRouteClearance:undefined-threshold', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', H)], undefined));
  // 标签 rect 非法
  push(S, 'collectLabelRouteClearance:negative-width-rect', 'collectLabelRouteClearance',
    call([{ ...label(5), rect: { x: 40, y: 5, width: -20, height: 10 } }], [route('R1', 'a', 'b', H)], 15));
  push(S, 'collectLabelRouteClearance:nan-rect', 'collectLabelRouteClearance',
    call([{ ...label(5), rect: { x: NaN, y: 5, width: 20, height: 10 } }], [route('R1', 'a', 'b', H)], 15));
  push(S, 'collectLabelRouteClearance:null-rect', 'collectLabelRouteClearance',
    call([{ ...label(5), rect: null }], [route('R1', 'a', 'b', H)], 15));
  // label 自身就是矩形（无 rect 字段）
  push(S, 'collectLabelRouteClearance:bare-rect-label', 'collectLabelRouteClearance',
    call([{ x: 40, y: 5, width: 20, height: 10, label: 'bare', relationIndex: 1, relation: { id: 'L2', from: 'x', to: 'y' } }],
      [route('R1', 'a', 'b', H)], 15));
  // 同一 relationship（同 id/from/to）→ 跳过
  push(S, 'collectLabelRouteClearance:same-relationship', 'collectLabelRouteClearance',
    call([{ ...label(5), relation: { id: 'R1', from: 'a', to: 'b' } }], [route('R1', 'a', 'b', H)], 15));
  // 同一关系但用 relation.key 识别
  push(S, 'collectLabelRouteClearance:same-relationship-key', 'collectLabelRouteClearance',
    call([{ ...label(5), relation: { key: 'K1', from: 'x', to: 'y' } }],
      [{ relation: { key: 'K1', from: 'a', to: 'b' }, points: H, relationIndex: 0 }], 15));
  // relationIndex 与路由相同 → 跳过（composition 的 boxRoutes 与 edges 共用索引空间的真实行为）
  push(S, 'collectLabelRouteClearance:index-collision-skip', 'collectLabelRouteClearance',
    call([{ ...label(5), relationIndex: 0, relation: { id: 'L9', from: 'x', to: 'y' } }], [route('R1', 'a', 'b', H, 0)], 15));
  // label 缺 relationIndex → 用数组下标
  push(S, 'collectLabelRouteClearance:label-index-fallback', 'collectLabelRouteClearance',
    call([{ ...label(5), relationIndex: undefined }], [route('R1', 'a', 'b', H, 5)], 15));
  // 重复标签（同 identity）→ 只留第一个
  push(S, 'collectLabelRouteClearance:duplicate-labels', 'collectLabelRouteClearance',
    call([label(5), label(6), label(7)], [route('R1', 'a', 'b', H)], 15));
  // 重复路由（同 identity）→ 只留第一条
  push(S, 'collectLabelRouteClearance:duplicate-routes', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', H), route('R1', 'a', 'b', [[0, 50], [100, 50]])], 15));
  // 多段路由：取最近段（竖段比横段更近）
  push(S, 'collectLabelRouteClearance:nearest-segment', 'collectLabelRouteClearance',
    call([label(15)], [route('R1', 'a', 'b', [[0, 0], [100, 0], [100, 100]])], 15));
  // 路由 points 不足 2 → 被过滤
  push(S, 'collectLabelRouteClearance:short-route', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', [[0, 0]])], 15));
  // 路由 relation 缺失 → 被过滤
  push(S, 'collectLabelRouteClearance:route-without-relation', 'collectLabelRouteClearance',
    call([label(5)], [{ points: H, relationIndex: 0 }], 15));
  // 路由含 NaN 段 + 正常段
  push(S, 'collectLabelRouteClearance:route-with-nan-segment', 'collectLabelRouteClearance',
    call([label(5)], [route('R1', 'a', 'b', [[NaN, NaN], [0, 0], [100, 0]])], 15));
  // 多路由：只报最近的一条
  push(S, 'collectLabelRouteClearance:multiple-routes', 'collectLabelRouteClearance',
    call([label(5)], [
      route('R1', 'a', 'b', H),
      route('R2', 'c', 'd', [[0, 40], [100, 40]]),
      route('R3', 'e', 'f', [[0, 60], [100, 60]]),
    ], 15));
  // boxRoutes 闭环形状（复刻 composition 的 box: 关系）
  push(S, 'collectLabelRouteClearance:box-route', 'collectLabelRouteClearance',
    call([label(5)], [{
      relation: { id: 'box:bx', from: 'box:bx', to: 'box:bx' },
      points: [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
      relationIndex: 0,
    }], 15));
}

function addCorridorsSynthetic() {
  const S = 'synthetic';
  const call = (routedRelations, minOverlapPx) => [{ routedRelations, ...(minOverlapPx === undefined ? {} : { minOverlapPx }) }];

  // 完全共线重叠（水平）
  push(S, 'collectAmbiguousCorridors:collinear-full-overlap', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [100, 10]]), route('R2', 'b1', 'b2', [[20, 10], [120, 10]])], 8));
  // 恰好重叠等于 minOverlapPx=8
  push(S, 'collectAmbiguousCorridors:overlap-exactly-min', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[42, 10], [90, 10]])], 8));
  // 重叠略小于 minOverlapPx
  push(S, 'collectAmbiguousCorridors:overlap-just-under-min', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[42.1, 10], [90, 10]])], 8));
  // epsilon 带内：重叠 7.99995（+0.0001 >= 8）→ 仍算命中。删掉 epsilon 会漏掉，用来锁死该细节。
  push(S, 'collectAmbiguousCorridors:overlap-in-epsilon-band', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[42.00005, 10], [90, 10]])], 8));
  // 交叉但不共线（水平 vs 垂直）→ 不算走廊
  push(S, 'collectAmbiguousCorridors:crossing-not-collinear', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [100, 10]]), route('R2', 'b1', 'b2', [[50, -50], [50, 50]])], 8));
  // 同一轴线但间距 1px → 不共线（超过 epsilon）
  push(S, 'collectAmbiguousCorridors:parallel-1px-apart', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [100, 10]]), route('R2', 'b1', 'b2', [[0, 11], [100, 11]])], 8));
  // 垂直共线重叠
  push(S, 'collectAmbiguousCorridors:vertical-overlap', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[10, 0], [10, 100]]), route('R2', 'b1', 'b2', [[10, 30], [10, 130]])], 8));
  // 共线但相离
  push(S, 'collectAmbiguousCorridors:collinear-disjoint', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [30, 10]]), route('R2', 'b1', 'b2', [[50, 10], [90, 10]])], 8));
  // 仅端点接触（overlap = 0）→ 不算
  push(S, 'collectAmbiguousCorridors:touch-at-endpoint', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[50, 10], [90, 10]])], 0));
  // 共享语义端点 → 豁免
  push(S, 'collectAmbiguousCorridors:shared-endpoint-exempt', 'collectAmbiguousCorridors',
    call([route('R1', 'n1', 'n2', [[0, 10], [100, 10]]), route('R2', 'n2', 'n3', [[0, 10], [100, 10]])], 8));
  // 反向绘制（坐标递减）仍应命中
  push(S, 'collectAmbiguousCorridors:reversed-direction', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[100, 10], [0, 10]]), route('R2', 'b1', 'b2', [[120, 10], [20, 10]])], 8));
  // 多段：取最长重叠段并记录段索引
  push(S, 'collectAmbiguousCorridors:longest-segment-wins', 'collectAmbiguousCorridors',
    call([
      route('R1', 'a1', 'a2', [[0, 0], [100, 0], [100, 60]]),
      route('R2', 'b1', 'b2', [[20, 0], [60, 0], [60, 60]]),
    ], 8));
  // minOverlapPx 缺省（默认 8）
  push(S, 'collectAmbiguousCorridors:default-min-overlap', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[43, 10], [90, 10]])]));
  // minOverlapPx = 0 → 任何正重叠都命中
  push(S, 'collectAmbiguousCorridors:min-overlap-zero', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [50, 10]]), route('R2', 'b1', 'b2', [[49.9, 10], [90, 10]])], 0));
  // relation 缺 from/to / 非字符串 → 被过滤
  push(S, 'collectAmbiguousCorridors:invalid-relation', 'collectAmbiguousCorridors',
    call([{ relation: { id: 'R1' }, points: [[0, 10], [100, 10]], relationIndex: 0 }, route('R2', 'b1', 'b2', [[0, 10], [100, 10]])], 8));
  // points 不足 2 / 非有限 → 被过滤
  push(S, 'collectAmbiguousCorridors:nan-points', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[NaN, 10], [100, 10]]), route('R2', 'b1', 'b2', [[0, 10], [100, 10]])], 8));
  // 重复点 / 共线中间点被 normalize
  push(S, 'collectAmbiguousCorridors:normalized-points', 'collectAmbiguousCorridors',
    call([
      route('R1', 'a1', 'a2', [[0, 10], [0, 10], [50, 10], [100, 10]]),
      route('R2', 'b1', 'b2', [[20, 10], [20, 10], [120, 10]]),
    ], 8));
  // 三条线两两组合
  push(S, 'collectAmbiguousCorridors:three-routes', 'collectAmbiguousCorridors',
    call([
      route('R1', 'a1', 'a2', [[0, 10], [100, 10]]),
      route('R2', 'b1', 'b2', [[10, 10], [110, 10]]),
      route('R3', 'c1', 'c2', [[20, 10], [120, 10]]),
    ], 8));
  // 空列表
  push(S, 'collectAmbiguousCorridors:empty', 'collectAmbiguousCorridors', call([], 8));
  // 非数组
  push(S, 'collectAmbiguousCorridors:not-array', 'collectAmbiguousCorridors', call(null, 8));
  // 同一条 relation 出现两次（同 identity）→ 不豁免（只豁免共享端点，不去重）
  push(S, 'collectAmbiguousCorridors:same-relation-twice', 'collectAmbiguousCorridors',
    call([route('R1', 'a1', 'a2', [[0, 10], [100, 10]]), route('R1', 'a1', 'a2', [[0, 10], [100, 10]])], 8));
}

function addBorderRunsSynthetic() {
  const S = 'synthetic';
  const frame = (overrides = {}) => ({ id: 'f1', x: 0, y: 0, width: 100, height: 80, label: 'F', ...overrides });
  const call = (routedRelations, frames) => [{ routedRelations, frames }];

  // 路由与 top 边完全重合（radius 0，无圆角裁剪）
  push(S, 'collectBorderRuns:coincident-top', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ radius: 0 })]));
  // 相距 1px → 不算
  push(S, 'collectBorderRuns:offset-1px', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 1], [100, 1]], 0)], [frame({ radius: 0 })]));
  // 相距 0.0001（epsilon 内）→ 仍算共线且重叠
  push(S, 'collectBorderRuns:offset-at-epsilon', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0.0001], [100, 0.0001]], 0)], [frame({ radius: 0 })]));
  // frames 为空
  push(S, 'collectBorderRuns:no-frames', 'collectBorderRuns', call([route('R1', 'a', 'b', [[0, 0], [100, 0]])], []));
  // routedRelations 为空
  push(S, 'collectBorderRuns:no-routes', 'collectBorderRuns', call([], [frame({ radius: 0 })]));
  // 两者都空
  push(S, 'collectBorderRuns:all-empty', 'collectBorderRuns', call([], []));
  // 部分重叠（不覆盖整条边）
  push(S, 'collectBorderRuns:partial-top', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[20, 0], [60, 0]], 0)], [frame({ radius: 0 })]));
  // 与 right 竖直边重合
  push(S, 'collectBorderRuns:coincident-right', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[100, 0], [100, 80]], 0)], [frame({ radius: 0 })]));
  // 圆角裁剪：radius=10，top 边只有 [10,0]->[90,0]
  push(S, 'collectBorderRuns:radius-trim-partial', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [20, 0]], 0)], [frame({ radius: 10 })]));
  push(S, 'collectBorderRuns:radius-trim-inside', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[10, 0], [90, 0]], 0)], [frame({ radius: 10 })]));
  // radius 超过 min(w/2,h/2) → 被 clamp
  push(S, 'collectBorderRuns:radius-clamped', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ radius: 999 })]));
  // radius 为字符串
  push(S, 'collectBorderRuns:radius-string', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [20, 0]], 0)], [frame({ radius: '10' })]));
  // radius 缺省 / NaN
  push(S, 'collectBorderRuns:radius-missing', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame()]));
  push(S, 'collectBorderRuns:radius-nan', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ radius: NaN })]));
  // frame.shape = 'line'
  push(S, 'collectBorderRuns:line-shape', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [{ id: 'l1', shape: 'line', start: [0, 0], end: [100, 0] }]));
  push(S, 'collectBorderRuns:line-shape-x1y1', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [{ id: 'l2', shape: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }]));
  push(S, 'collectBorderRuns:line-shape-non-finite', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [{ id: 'l3', shape: 'line', start: [0, NaN], end: [100, 0] }]));
  // frame 尺寸退化为 0 / 负
  push(S, 'collectBorderRuns:frame-zero-size', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ width: 0, height: 0 })]));
  push(S, 'collectBorderRuns:frame-negative-size', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ width: -100, height: -80 })]));
  // frame 非有限坐标
  push(S, 'collectBorderRuns:frame-nan', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ x: NaN })]));
  // frame 为 null / 非对象
  push(S, 'collectBorderRuns:frame-null', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [null, frame({ radius: 0 })]));
  // 多段路由沿同一条边 → merged 长度求和，segmentIndex 取最小
  push(S, 'collectBorderRuns:merged-multi-segment', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [30, 0], [30, 5], [60, 0]], 0)], [frame({ radius: 0 })]));
  // 路由用 segments 数组而非 points
  push(S, 'collectBorderRuns:segments-array', 'collectBorderRuns',
    call([{
      relation: { id: 'R1', from: 'a', to: 'b' },
      segments: [{ start: [0, 0], end: [100, 0] }],
      relationIndex: 0,
    }], [frame({ radius: 0 })]));
  // 路由 segments 含非有限 → 整条跳过
  push(S, 'collectBorderRuns:segments-non-finite', 'collectBorderRuns',
    call([{
      relation: { id: 'R1', from: 'a', to: 'b' },
      segments: [{ start: [0, 0], end: [NaN, 0] }],
      relationIndex: 0,
    }], [frame({ radius: 0 })]));
  // 路由 points 长度 1 → 无段
  push(S, 'collectBorderRuns:single-point-route', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0]], 0)], [frame({ radius: 0 })]));
  // 路由含非有限点（points 形状）
  push(S, 'collectBorderRuns:points-non-finite', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [Infinity, 0]], 0)], [frame({ radius: 0 })]));
  // 重叠恰好 0.0001（<= epsilon → 不算）
  push(S, 'collectBorderRuns:overlap-at-epsilon', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [0.0001, 0]], 0)], [frame({ radius: 0 })]));
  // 重叠 0.001（> epsilon → 算）
  push(S, 'collectBorderRuns:overlap-over-epsilon', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [0.001, 0]], 0)], [frame({ radius: 0 })]));
  // 一条路由同时贴两条边（左上角）
  push(S, 'collectBorderRuns:two-sides', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [40, 0], [0, 0], [0, 40]], 0)], [frame({ radius: 0 })]));
  // 两个 frame
  push(S, 'collectBorderRuns:two-frames', 'collectBorderRuns',
    call([route('R1', 'a', 'b', [[0, 0], [100, 0]], 0)], [frame({ radius: 0 }), frame({ id: 'f2', y: 100, radius: 0 })]));
}

function addRhythmSynthetic() {
  const S = 'synthetic';
  const call = (routedRelations, interiorSegmentPx = 16, microSegmentPx = 8) => [{
    routedRelations, interiorSegmentPx, microSegmentPx,
  }];

  // 中间段恰好 16 → 不报
  push(S, 'collectRouteRhythmIssues:interior-exactly-16', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 16], [100, 16]], 0)]));
  // 中间段 15.9 → short-interior
  push(S, 'collectRouteRhythmIssues:interior-15.9', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 15.9], [100, 16]], 0)]));
  // epsilon 带内：15.99995（> 16-0.0001）→ 不报。删掉 epsilon 才会报，用来锁死该实现细节。
  push(S, 'collectRouteRhythmIssues:interior-15.99995', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 15.99995], [100, 16]], 0)]));
  // 中间段恰好 8 → 不是 micro（8<7.9999 false），但是 short-interior
  push(S, 'collectRouteRhythmIssues:interior-exactly-8', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 8], [100, 8]], 0)]));
  // 中间段 7.9 → micro
  push(S, 'collectRouteRhythmIssues:interior-7.9-micro', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 7.9], [100, 8]], 0)]));
  // epsilon 带内：7.99995（> 8-0.0001）→ 不是 micro，只是 short-interior。删掉 epsilon 会翻成 micro。
  push(S, 'collectRouteRhythmIssues:interior-7.99995', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 7.99995], [100, 8]], 0)]));
  // 端点段恰好 8（source-stub）→ 不报
  push(S, 'collectRouteRhythmIssues:stub-exactly-8', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [8, 0], [100, 0]], 0)]));
  // 端点段 7.9 → micro（micro 判定不看位置）
  push(S, 'collectRouteRhythmIssues:stub-7.9-micro', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [7.9, 0], [100, 0]], 0)]));
  // 端点段 15.9（source-stub / target-stub）→ 不报（只有 interior 有 16px 下限）
  push(S, 'collectRouteRhythmIssues:stub-15.9-ok', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [15.9, 0], [100, 0]], 0)]));
  // 两段式：只有一段，source-stub 与 target-stub 是同一段
  push(S, 'collectRouteRhythmIssues:two-points', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [10, 0]], 0)]));
  // 退化零长段被跳过
  push(S, 'collectRouteRhythmIssues:zero-length-segment', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [0, 0], [100, 0]], 0)]));
  // 共线中间点被 normalize 合并
  push(S, 'collectRouteRhythmIssues:collinear-normalized', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [4, 0], [8, 0], [100, 0]], 0)]));
  // 多段多问题
  push(S, 'collectRouteRhythmIssues:multiple-issues', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [5, 0], [5, 12], [40, 12], [40, 100]], 0)]));
  // 自定义阈值
  push(S, 'collectRouteRhythmIssues:custom-thresholds', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 20], [100, 20]], 0)], 24, 10));
  // points 不足 2 / 非数组
  push(S, 'collectRouteRhythmIssues:short-route', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0]], 0)]));
  push(S, 'collectRouteRhythmIssues:not-array', 'collectRouteRhythmIssues', call(null));
  // 空列表
  push(S, 'collectRouteRhythmIssues:empty', 'collectRouteRhythmIssues', call([]));
  // NaN 点被 normalize 过滤
  push(S, 'collectRouteRhythmIssues:nan-points', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[NaN, NaN], [0, 0], [100, 0]], 0)]));
  // relationIndex 非整数 → 用下标
  push(S, 'collectRouteRhythmIssues:index-fallback', 'collectRouteRhythmIssues',
    call([route('R1', 'a', 'b', [[0, 0], [50, 0], [50, 8], [100, 8]], undefined)]));
}

function addIsFinitePointSynthetic() {
  const S = 'synthetic';
  push(S, 'isFinitePoint:all-finite', 'isFinitePoint', [0, 1, -1, 1e-9, Number.MAX_SAFE_INTEGER, 0.1]);
  push(S, 'isFinitePoint:negative-zero', 'isFinitePoint', [0, -0]);
  push(S, 'isFinitePoint:no-args', 'isFinitePoint', []);
  push(S, 'isFinitePoint:nan', 'isFinitePoint', [NaN]);
  push(S, 'isFinitePoint:infinity', 'isFinitePoint', [Infinity]);
  push(S, 'isFinitePoint:negative-infinity', 'isFinitePoint', [-Infinity]);
  push(S, 'isFinitePoint:nan-among-finite', 'isFinitePoint', [1, NaN, 2]);
  push(S, 'isFinitePoint:numeric-string', 'isFinitePoint', [1, '2']);
  push(S, 'isFinitePoint:null', 'isFinitePoint', [1, null]);
  push(S, 'isFinitePoint:undefined', 'isFinitePoint', [1, undefined]);
  push(S, 'isFinitePoint:boolean', 'isFinitePoint', [true]);
  push(S, 'isFinitePoint:object', 'isFinitePoint', [1, {}]);
  push(S, 'isFinitePoint:nested-array', 'isFinitePoint', [[1, 2]]);
  push(S, 'isFinitePoint:empty-string', 'isFinitePoint', ['']);
}

// =====================================================================
// 主流程
// =====================================================================
function main() {
  const sources = [
    ...readdirSync(path.join(ROOT, 'samples')).filter((f) => f.endsWith('.json')).sort().map((f) => `samples/${f}`),
    ...readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).sort().map((f) => `examples/${f}`),
  ];
  for (const rel of sources) {
    const ir = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
    buildRealEntries(rel, ir);
  }

  addRectsOverlapSynthetic();
  addSegmentIntersectsRectSynthetic();
  addEndpointSidesSynthetic();
  addLabelClearanceSynthetic();
  addCorridorsSynthetic();
  addBorderRunsSynthetic();
  addRhythmSynthetic();
  addIsFinitePointSynthetic();

  // 去重：只丢弃 (fn, 入参) 完全相同的条目。它们对 baseline 没有任何额外信息量，
  // 却会成比例抬高 golden 体积。id 在 push 时分配，去重后仍唯一。
  const seen = new Set();
  const deduped = [];
  const dropped = [];
  for (const entry of entries) {
    const key = `${entry.fn}\u0000${JSON.stringify(encodeValue(entry.args))}`;
    if (seen.has(key)) {
      dropped.push(entry);
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  const payload = {
    schemaVersion: 1,
    note: '只含入参；结果基线见 geometry-golden.json。NaN/Infinity/undefined 用 __num/__undefined 等标记显式编码。',
    entries: deduped.map((e) => ({
      id: e.id,
      site: e.site,
      fn: e.fn,
      args: encodeValue(e.args),
    })),
  };
  // 生成物用紧凑序列化：2 空格缩进会让深层嵌套的坐标数组膨胀一倍以上（1.6MB → 0.68MB）。
  writeFileSync(OUT, `${JSON.stringify(payload)}\n`, 'utf8');

  const byFn = new Map();
  const bySite = new Map();
  for (const e of deduped) {
    byFn.set(e.fn, (byFn.get(e.fn) || 0) + 1);
    bySite.set(e.site, (bySite.get(e.site) || 0) + 1);
  }
  console.log(`已写出 ${OUT}`);
  console.log(`语料 ${deduped.length} 条（完全重复的 (fn+args) 条目已去重 ${dropped.length} 条）`);
  if (dropped.length) {
    const droppedByFn = new Map();
    for (const e of dropped) droppedByFn.set(e.fn, (droppedByFn.get(e.fn) || 0) + 1);
    console.log(`去重明细：${[...droppedByFn.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  console.log(`按 fn：${[...byFn.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`按 site：${[...bySite.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
}

main();
