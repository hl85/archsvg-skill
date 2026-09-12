// 几何谓词与构图收集器（净室重写版）。
//
// 行为契约的唯一权威是 tests/fixtures/geometry-golden.json（配合 geometry-corpus.json
// 与 tests/geometry-parity.test.mjs 逐条差分）。内部实现按本模块自己的方式组织，
// 不依赖任何渲染词汇、质量档位、诊断录制或外部依赖。

// ---- 固定容差 -------------------------------------------------------------

// 共线 / 退化 / 阈值带宽容差。
const EPS = 0.0001;
// 仅用于「线段是否退化成一个点」与点—线段投影的退化判断。
const EPS7 = 0.0000001;

// ---- 通用小工具 -----------------------------------------------------------

function isObject(value) {
  return value !== null && typeof value === 'object';
}

// 折线规范化：过滤非法点、合并相邻近重合点、删除同向共线的中间点。
function normalizePolyline(points) {
  if (!Array.isArray(points)) return [];
  const kept = [];
  for (const raw of points) {
    if (!Array.isArray(raw) || raw.length !== 2) continue;
    if (!isFinitePoint(raw[0], raw[1])) continue;
    kept.push([raw[0], raw[1]]);
  }
  const out = [];
  for (const point of kept) {
    const last = out[out.length - 1];
    if (last && Math.abs(point[0] - last[0]) <= EPS && Math.abs(point[1] - last[1]) <= EPS) continue;
    while (out.length >= 2) {
      const prev = out[out.length - 2];
      const mid = out[out.length - 1];
      const ax = mid[0] - prev[0];
      const ay = mid[1] - prev[1];
      const bx = point[0] - mid[0];
      const by = point[1] - mid[1];
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      if (Math.abs(cross) <= EPS && dot >= -EPS) out.pop();
      else break;
    }
    out.push(point);
  }
  return out;
}

// 关系身份：key 优先，其次 (from,to,id)，再退化为位置下标。
function relationIdentity(relation, index) {
  if (relation && relation.key !== undefined) return `key:${String(relation.key)}`;
  if (relation && relation.id) return `id:${relation.from}|${relation.to}|${relation.id}`;
  return `idx:${index}`;
}

function isDegenerateSegment(a, b) {
  return Math.abs(b[0] - a[0]) <= EPS7 && Math.abs(b[1] - a[1]) <= EPS7;
}

function pointSegmentDistance(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPS7 * EPS7) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// ---- 谓词 ----------------------------------------------------------------

export function isFinitePoint(...coords) {
  return coords.every((value) => Number.isFinite(value));
}

export function rectsOverlap(a, b, gap = 0) {
  if (!isObject(a) || !isObject(b)) return false;
  if (!isFinitePoint(a.x, a.y, a.width, a.height) || !isFinitePoint(b.x, b.y, b.width, b.height)) {
    return false;
  }
  const apart =
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y;
  return !apart;
}

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, px, py) {
  return (
    px >= Math.min(ax, bx) - EPS7 &&
    px <= Math.max(ax, bx) + EPS7 &&
    py >= Math.min(ay, by) - EPS7 &&
    py <= Math.max(ay, by) + EPS7
  );
}

// 含端点、含擦边与共线重叠的线段相交判定。
function segmentsIntersect(a, b) {
  const [ax, ay] = a[0];
  const [bx, by] = a[1];
  const [cx, cy] = b[0];
  const [dx, dy] = b[1];
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (Math.abs(d1) <= EPS7 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d2) <= EPS7 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  if (Math.abs(d3) <= EPS7 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d4) <= EPS7 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

export function segmentIntersectsRect(segment, rect, gap = 0) {
  const left = rect.x - gap;
  const top = rect.y - gap;
  const right = rect.x + rect.width + gap;
  const bottom = rect.y + rect.height + gap;
  const box = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];

  // 先读起点：缺 start 时在这里抛 TypeError（与基线一致）。
  const sx = segment.start[0];
  const sy = segment.start[1];
  if (sx >= left && sx <= right && sy >= top && sy <= bottom) return true;

  const ex = segment.end[0];
  const ey = segment.end[1];
  if (ex >= left && ex <= right && ey >= top && ey <= bottom) return true;

  const line = [
    [sx, sy],
    [ex, ey],
  ];
  for (let i = 0; i < 4; i += 1) {
    if (segmentsIntersect(line, [box[i], box[(i + 1) % 4]])) return true;
  }
  return false;
}

const SIDE_AXIS = {
  left: { axis: 'x', source: -1, target: 1 },
  right: { axis: 'x', source: 1, target: -1 },
  top: { axis: 'y', source: -1, target: 1 },
  bottom: { axis: 'y', source: 1, target: -1 },
};

function endpointSideSatisfied(a, b, side, isSource) {
  const spec = SIDE_AXIS[side];
  if (!spec) return true;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (spec.axis === 'x') {
    if (Math.abs(dy) > EPS) return false;
    return (isSource ? spec.source : spec.target) * dx > EPS;
  }
  if (Math.abs(dx) > EPS) return false;
  return (isSource ? spec.source : spec.target) * dy > EPS;
}

export function routeHonorsEndpointSides(points, fromSide, toSide) {
  const pts = normalizePolyline(points);
  if (pts.length < 2) return true;
  const sourceOk = endpointSideSatisfied(pts[0], pts[1], fromSide, true);
  if (!sourceOk) return false;
  return endpointSideSatisfied(pts[pts.length - 2], pts[pts.length - 1], toSide, false);
}

// ---- 标签—路由净空 --------------------------------------------------------

function pointRectDistance(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function segmentRectDistance(a, b, rect) {
  if (segmentIntersectsRect({ start: a, end: b }, rect, 0)) return 0;
  let best = Math.min(pointRectDistance(a[0], a[1], rect), pointRectDistance(b[0], b[1], rect));
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
  for (const corner of corners) {
    const d = pointSegmentDistance(corner[0], corner[1], a, b);
    if (d < best) best = d;
  }
  return best;
}

// 线段落在矩形内部那部分的长度（Liang-Barsky 参数裁剪）。
function segmentRectIntersectionLength(a, b, rect) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const xmin = rect.x;
  const xmax = rect.x + rect.width;
  const ymin = rect.y;
  const ymax = rect.y + rect.height;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - xmin, xmax - a[0], a[1] - ymin, ymax - a[1]];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return 0;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return 0;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return 0;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t1 <= t0) return 0;
  return (t1 - t0) * Math.hypot(dx, dy);
}

// 最近段：距离相交为 0，等距取下标更小者。
function nearestSegment(pts, rect) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const distance = segmentRectDistance(a, b, rect);
    if (best === null || distance < best.distance) {
      best = { index: i, distance, start: a, end: b };
    }
  }
  return best;
}

export function collectLabelRouteClearance({ labels, routedRelations, threshold } = {}) {
  if (!Number.isFinite(threshold) || threshold < 0) return [];

  const labelList = Array.isArray(labels) ? labels : [];
  const routeList = Array.isArray(routedRelations) ? routedRelations : [];

  const labelEntries = [];
  const seenLabels = new Set();
  labelList.forEach((label, arrayIndex) => {
    if (!isObject(label)) return;
    const rect = label.rect !== undefined ? label.rect : label;
    if (!isObject(rect)) return;
    if (!isFinitePoint(rect.x, rect.y, rect.width, rect.height)) return;
    if (rect.width < 0 || rect.height < 0) return;
    const relationIndex = Number.isInteger(label.relationIndex) ? label.relationIndex : arrayIndex;
    const identity = relationIdentity(label.relation, relationIndex);
    if (seenLabels.has(identity)) return;
    seenLabels.add(identity);
    labelEntries.push({ label, rect, relation: label.relation, relationIndex, identity });
  });

  const routeEntries = [];
  const seenRoutes = new Set();
  routeList.forEach((entry, arrayIndex) => {
    if (!isObject(entry)) return;
    const relation = entry.relation !== undefined && entry.relation !== null ? entry.relation : entry;
    if (!relation) return;
    const rawPoints = entry.points !== undefined && entry.points !== null ? entry.points : relation.routePoints;
    const points = normalizePolyline(rawPoints);
    if (points.length < 2) return;
    const relationIndex = Number.isInteger(entry.relationIndex) ? entry.relationIndex : arrayIndex;
    const identity = relationIdentity(relation, relationIndex);
    if (seenRoutes.has(identity)) return;
    seenRoutes.add(identity);
    routeEntries.push({ relation, points, relationIndex, identity });
  });

  const hits = [];
  for (const lab of labelEntries) {
    for (const route of routeEntries) {
      if (lab.relationIndex === route.relationIndex) continue;
      const sameRelation =
        lab.relation === route.relation || lab.identity === route.identity;
      if (sameRelation) continue;
      const nearest = nearestSegment(route.points, lab.rect);
      if (!nearest) continue;
      if (!(nearest.distance < threshold - EPS)) continue;
      hits.push({
        label: lab.label,
        labelRelation: lab.relation,
        labelRelationIndex: lab.relationIndex,
        otherRelation: route.relation,
        otherRelationIndex: route.relationIndex,
        rect: lab.rect,
        clearance: nearest.distance,
        intersectionLength: segmentRectIntersectionLength(nearest.start, nearest.end, lab.rect),
        segmentIndex: nearest.index,
        start: nearest.start,
        end: nearest.end,
        threshold,
      });
    }
  }
  return hits;
}

// ---- 共线重叠走廊 ---------------------------------------------------------

function segmentAxisInfo(p, q) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const horizontal = Math.abs(dy) <= EPS;
  const vertical = Math.abs(dx) <= EPS;
  if (horizontal && !vertical) {
    return { axis: 'x', coord: p[1], lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) };
  }
  if (vertical && !horizontal) {
    return { axis: 'y', coord: p[0], lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) };
  }
  return null;
}

function axisPoint(axis, coord, value) {
  return axis === 'x' ? [value, coord] : [coord, value];
}

function sharesSemanticEndpoint(a, b) {
  return (
    a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to
  );
}

export function collectAmbiguousCorridors({ routedRelations, minOverlapPx = 8 } = {}) {
  const list = Array.isArray(routedRelations) ? routedRelations : [];
  const routes = [];
  list.forEach((entry, arrayIndex) => {
    if (!isObject(entry)) return;
    const relation = entry.relation;
    if (!isObject(relation) || typeof relation.from !== 'string' || typeof relation.to !== 'string') return;
    const points = normalizePolyline(entry.points);
    if (points.length < 2) return;
    const relationIndex = Number.isInteger(entry.relationIndex) ? entry.relationIndex : arrayIndex;
    routes.push({ relation, relationIndex, points });
  });

  const hits = [];
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      const left = routes[i];
      const right = routes[j];
      if (sharesSemanticEndpoint(left.relation, right.relation)) continue;

      let best = null;
      for (let li = 0; li + 1 < left.points.length; li += 1) {
        const leftInfo = segmentAxisInfo(left.points[li], left.points[li + 1]);
        if (!leftInfo) continue;
        for (let ri = 0; ri + 1 < right.points.length; ri += 1) {
          const rightInfo = segmentAxisInfo(right.points[ri], right.points[ri + 1]);
          if (!rightInfo || rightInfo.axis !== leftInfo.axis) continue;
          if (Math.abs(rightInfo.coord - leftInfo.coord) > EPS) continue;
          const lo = Math.max(leftInfo.lo, rightInfo.lo);
          const hi = Math.min(leftInfo.hi, rightInfo.hi);
          const overlap = hi - lo;
          if (overlap <= EPS) continue;
          if (overlap + EPS < minOverlapPx) continue;
          if (best === null || overlap > best.overlap + EPS) {
            best = { leftSegment: li, rightSegment: ri, overlap, lo, hi, info: leftInfo };
          }
        }
      }
      if (!best) continue;
      hits.push({
        left: { relation: left.relation, relationIndex: left.relationIndex, points: left.points },
        right: { relation: right.relation, relationIndex: right.relationIndex, points: right.points },
        leftSegment: best.leftSegment,
        rightSegment: best.rightSegment,
        overlapLength: best.overlap,
        overlapStart: axisPoint(best.info.axis, best.info.coord, best.lo),
        overlapEnd: axisPoint(best.info.axis, best.info.coord, best.hi),
      });
    }
  }
  return hits;
}

// ---- 容器边框并行段 -------------------------------------------------------

function routeSegments(entry) {
  if (Array.isArray(entry.segments)) return entry.segments;
  if (!Array.isArray(entry.points)) return [];
  const segments = [];
  for (let i = 0; i + 1 < entry.points.length; i += 1) {
    segments.push({ start: entry.points[i], end: entry.points[i + 1] });
  }
  return segments;
}

function isFiniteSegment(segment) {
  if (!isObject(segment)) return false;
  const { start, end } = segment;
  if (!Array.isArray(start) || start.length !== 2 || !isFinitePoint(start[0], start[1])) return false;
  if (!Array.isArray(end) || end.length !== 2 || !isFinitePoint(end[0], end[1])) return false;
  return true;
}

function frameEdges(frame) {
  if (!isObject(frame)) return [];
  if (frame.shape === 'line') {
    const start = Array.isArray(frame.start) ? frame.start : [frame.x1, frame.y1];
    const end = Array.isArray(frame.end) ? frame.end : [frame.x2, frame.y2];
    if (!isFinitePoint(start[0], start[1], end[0], end[1])) return [];
    return [{ side: 'line', a: [start[0], start[1]], b: [end[0], end[1]] }];
  }
  const { x, y, width, height } = frame;
  if (!isFinitePoint(x, y, width, height) || width <= 0 || height <= 0) return [];
  let radius = Number(frame.radius);
  if (!Number.isFinite(radius) || radius < 0) radius = 0;
  const maxRadius = Math.min(width / 2, height / 2);
  if (radius > maxRadius) radius = maxRadius;
  const edges = [
    { side: 'top', a: [x + radius, y], b: [x + width - radius, y] },
    { side: 'right', a: [x + width, y + radius], b: [x + width, y + height - radius] },
    { side: 'bottom', a: [x + radius, y + height], b: [x + width - radius, y + height] },
    { side: 'left', a: [x, y + radius], b: [x, y + height - radius] },
  ];
  return edges.filter((edge) => {
    const dx = edge.b[0] - edge.a[0];
    const dy = edge.b[1] - edge.a[1];
    return Math.hypot(dx, dy) > EPS;
  });
}

// 合并区间并按并集统计长度；返回总长、最长区间、参与重叠的最小段下标。
function mergeOverlaps(intervals) {
  const sorted = [...intervals].sort((p, q) => p.lo - q.lo);
  const merged = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.lo <= last.hi) {
      if (item.hi > last.hi) last.hi = item.hi;
    } else {
      merged.push({ lo: item.lo, hi: item.hi });
    }
  }
  let total = 0;
  let longest = null;
  for (const item of merged) {
    total += item.hi - item.lo;
    if (longest === null || item.hi - item.lo > longest.hi - longest.lo) longest = item;
  }
  return { total, longest };
}

export function collectBorderRuns({ routedRelations, frames } = {}) {
  const routeList = Array.isArray(routedRelations) ? routedRelations : [];
  const frameList = Array.isArray(frames) ? frames : [];
  const hits = [];

  for (const entry of routeList) {
    if (!isObject(entry)) continue;
    const segments = routeSegments(entry);
    if (segments.length === 0) continue;
    if (!segments.every(isFiniteSegment)) continue;

    for (let frameIndex = 0; frameIndex < frameList.length; frameIndex += 1) {
      const frame = frameList[frameIndex];
      const edges = frameEdges(frame);
      for (const edge of edges) {
        const info = segmentAxisInfo(edge.a, edge.b);
        if (!info) continue;
        const intervals = [];
        let minSegmentIndex = null;
        for (let s = 0; s < segments.length; s += 1) {
          const segInfo = segmentAxisInfo(segments[s].start, segments[s].end);
          if (!segInfo || segInfo.axis !== info.axis) continue;
          if (Math.abs(segInfo.coord - info.coord) > EPS) continue;
          const lo = Math.max(segInfo.lo, info.lo);
          const hi = Math.min(segInfo.hi, info.hi);
          if (hi - lo <= EPS) continue;
          intervals.push({ lo, hi });
          if (minSegmentIndex === null || s < minSegmentIndex) minSegmentIndex = s;
        }
        if (intervals.length === 0) continue;
        const merged = mergeOverlaps(intervals);
        hits.push({
          ...entry,
          frame,
          frameIndex,
          side: edge.side,
          segmentIndex: minSegmentIndex,
          overlapLength: merged.total,
          overlapStart: axisPoint(info.axis, info.coord, merged.longest.lo),
          overlapEnd: axisPoint(info.axis, info.coord, merged.longest.hi),
        });
      }
    }
  }
  return hits;
}

// ---- 路由节奏问题 ---------------------------------------------------------

export function collectRouteRhythmIssues({ routedRelations, interiorSegmentPx = 16, microSegmentPx = 8 } = {}) {
  const list = Array.isArray(routedRelations) ? routedRelations : [];
  const issues = [];
  list.forEach((entry, arrayIndex) => {
    if (!isObject(entry)) return;
    const points = normalizePolyline(entry.points);
    if (points.length < 2) return;
    const relationIndex = Number.isInteger(entry.relationIndex) ? entry.relationIndex : arrayIndex;
    const segmentCount = points.length - 1;
    for (let s = 0; s < segmentCount; s += 1) {
      const a = points[s];
      const b = points[s + 1];
      const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (length <= EPS) continue;
      const position = s === 0 ? 'source-stub' : s === segmentCount - 1 ? 'target-stub' : 'interior';
      let code = null;
      if (length < microSegmentPx - EPS) code = 'composition/micro-segment';
      else if (position === 'interior' && length < interiorSegmentPx - EPS) {
        code = 'composition/short-interior-segment';
      }
      if (!code) continue;
      issues.push({
        code,
        relation: entry.relation,
        relationIndex,
        segmentIndex: s,
        position,
        length,
        start: [a[0], a[1]],
        end: [b[0], b[1]],
      });
    }
  });
  return issues;
}
