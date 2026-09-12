// 结构性不变量测试：把「两处必须相等 / 集合必须闭合」这类约束固化成断言。
//
// 这些不变量一旦破了，表现都是**静默**的：检查全过、图看着不对。例如
//   - 放置器净空阈值 ≠ 检查器阈值 → 批量误报或漏报；
//   - marker id 在 defs 与 edgeStyle 两处各写一份 → 箭头静默消失；
//   - theme 的字号 ≠ typography 的常量 → 盒宽估算与实际渲染错位。
// 每一项都在这里用「读实际导出值」而不是「读副本」的方式断言，故不可能互相包庇。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { TYPE_SCALE, BOX, EDGE_LABEL, EDGE_MASK_HEIGHT } from '../lib/typography.mjs';
import { STROKE } from '../lib/typography.mjs';
import { ARROW_MARKER_IDS, MARKER_SHAPES, EDGE_STYLE, collectUrlRefs, collectIds } from '../lib/markers.mjs';
import { ROLE_KEYS, styleBlock } from '../lib/theme.mjs';
import { renderSvg } from '../lib/render.mjs';
import { layout } from '../lib/layout.mjs';
import { runCompositionChecks, COMPOSITION_CHECK_NAMES } from '../lib/checks/composition.mjs';
import { runDocumentChecks, DOCUMENT_CHECK_NAMES, STANDARD_DOCUMENT_CHECK_NAMES } from '../lib/checks/document.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(HERE, '..', 'samples');
const readSample = (f) => JSON.parse(readFileSync(path.join(SAMPLES, f), 'utf8'));

export const cases = [
  {
    name: '边标签：净空阈值与名义矩形高相等且 ≥ 8',
    run() {
      if (EDGE_LABEL.clearance !== EDGE_LABEL.rectHeight) {
        throw new Error(`clearance(${EDGE_LABEL.clearance}) !== rectHeight(${EDGE_LABEL.rectHeight})，会导致净空误报`);
      }
      if (EDGE_LABEL.clearance < 8) throw new Error('clearance 必须 ≥ 8');
      return `clearance = rectHeight = ${EDGE_LABEL.clearance}`;
    },
  },
  {
    name: '边标签：背景遮罩必须高于名义矩形（文字 bbox ≈ 1.25em）',
    run() {
      const textBoxH = TYPE_SCALE.edgeLabel.px * 1.25;
      if (EDGE_MASK_HEIGHT <= EDGE_LABEL.rectHeight) {
        throw new Error(`遮罩高 ${EDGE_MASK_HEIGHT} 未超过名义高 ${EDGE_LABEL.rectHeight}`);
      }
      if (EDGE_MASK_HEIGHT < textBoxH) {
        throw new Error(`遮罩高 ${EDGE_MASK_HEIGHT} < 12px 文字的 bbox 高 ${textBoxH}，会漏出连线`);
      }
      if (EDGE_LABEL.maskPadX < EDGE_LABEL.rectPadX) {
        throw new Error('遮罩左右留白应 ≥ 名义矩形留白（估算宽有实测误差，需要安全边）');
      }
      if (EDGE_LABEL.baselineOffset !== 0) {
        throw new Error('`.edge-label` 已用 dominant-baseline:central 居中，baselineOffset 必须为 0');
      }
      return `遮罩高 ${EDGE_MASK_HEIGHT} > 名义高 ${EDGE_LABEL.rectHeight}，文字盒高 ${textBoxH}`;
    },
  },
  {
    name: '盒几何自洽',
    run() {
      if (!(BOX.maxWidth > BOX.minWidth)) throw new Error('maxWidth 必须 > minWidth');
      if (BOX.maxWidth - 2 * BOX.padX <= 0) throw new Error('可用内宽必须为正');
      if (!(BOX.heightDouble > BOX.heightSingle)) throw new Error('双行盒必须高于单行盒');
      if (BOX.lineHeight <= 0) throw new Error('lineHeight 必须为正');
      return `盒宽 ${BOX.minWidth}–${BOX.maxWidth}，内宽 ${BOX.maxWidth - 2 * BOX.padX}，行高 ${BOX.lineHeight}`;
    },
  },
  {
    name: 'marker 契约：三向闭合（定义集合 = 契约集合 = 被引用集合）',
    run() {
      const referenced = new Set();
      for (const st of Object.values(EDGE_STYLE)) if (st.marker) referenced.add(st.marker);
      for (const id of ARROW_MARKER_IDS) {
        if (!MARKER_SHAPES[id]) throw new Error(`契约声明了 marker ${id}，但 MARKER_SHAPES 没有对应形状`);
        if (!referenced.has(id)) throw new Error(`marker ${id} 定义了却没有任何 EDGE_STYLE 引用（死定义）`);
      }
      for (const id of referenced) {
        if (!ARROW_MARKER_IDS.includes(id)) throw new Error(`EDGE_STYLE 引用了契约外的 marker ${id}`);
      }
      const kinds = Object.keys(EDGE_STYLE);
      for (const k of kinds) {
        if (!EDGE_STYLE[k].marker && k !== 'lifeline') {
          throw new Error(`kind ${k} 无 marker，且不是 lifeline`);
        }
      }
      return `${ARROW_MARKER_IDS.length} 个 marker、${referenced.size} 处引用、${kinds.length} 种 edge kind`;
    },
  },
  {
    name: 'marker 契约：渲染产物里的 defs 与引用双向可达',
    run() {
      const svg = renderSvg(readSample('oauth-login.sequence.json'));
      const ids = new Set(collectIds(svg));
      const refs = collectUrlRefs(svg);
      const dangling = [...new Set(refs.filter((r) => !ids.has(r)))];
      if (dangling.length) throw new Error(`悬空引用：${dangling.join(', ')}`);
      const definedMarkers = [...svg.matchAll(/<marker\b[^>]*\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
      const extra = definedMarkers.filter((id) => !ARROW_MARKER_IDS.includes(id));
      if (extra.length) throw new Error(`defs 含契约外 marker：${extra.join(', ')}`);
      const missing = ARROW_MARKER_IDS.filter((id) => !definedMarkers.includes(id));
      if (missing.length) throw new Error(`契约 marker 未定义：${missing.join(', ')}`);
      return `${definedMarkers.length} 个定义、${refs.length} 处引用，双向可达`;
    },
  },
  {
    name: 'theme 的 CSS 字号与 typography 常量一致',
    run() {
      const css = styleBlock();
      const expect = {
        title: TYPE_SCALE.title.px,
        desc: TYPE_SCALE.caption.px,
        caption: TYPE_SCALE.caption.px,
        'frame-label': TYPE_SCALE.frameLabel.px,
        'n-label': TYPE_SCALE.nodeTitle.px,
        'n-sub': TYPE_SCALE.nodeSub.px,
        'edge-label': TYPE_SCALE.edgeLabel.px,
        'legend-label': TYPE_SCALE.legend.px,
      };
      const bad = [];
      for (const [cls, px] of Object.entries(expect)) {
        const m = css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*font-size:\\s*([0-9.]+)px`));
        if (!m) { bad.push(`.${cls} 缺少 font-size 规则`); continue; }
        if (Math.abs(parseFloat(m[1]) - px) > 0.001) bad.push(`.${cls} CSS ${m[1]}px ≠ 常量 ${px}px`);
      }
      // 线宽同样必须同源
      const swEdge = css.match(/\.edge\s*\{[^}]*stroke-width:\s*([0-9.]+)/);
      if (!swEdge || Math.abs(parseFloat(swEdge[1]) - STROKE.edge) > 0.001) bad.push('`.edge` 线宽与 STROKE.edge 不一致');
      if (bad.length) throw new Error(bad.join('；'));
      return `${Object.keys(expect).length} 项字号 + edge 线宽与常量同源`;
    },
  },
  {
    name: '检查项名清单与实际返回的检查一一对应',
    run() {
      const ir = readSample('order-system.architecture.json');
      const comp = runCompositionChecks(ir, layout(ir), 'showcase').map((c) => c.name);
      const doc = runDocumentChecks({ ir, svgPath: null, docDir: null, options: {} }).map((c) => c.name);
      const cmp = (label, got, want) => {
        const g = got.join(',');
        const w = want.join(',');
        if (g !== w) throw new Error(`${label} 名清单与实际不符：实际 [${g}] vs 清单 [${w}]`);
      };
      cmp('构图', comp, COMPOSITION_CHECK_NAMES);
      cmp('文档', doc, DOCUMENT_CHECK_NAMES);
      const docSet = new Set(DOCUMENT_CHECK_NAMES);
      for (const n of STANDARD_DOCUMENT_CHECK_NAMES) {
        if (!docSet.has(n)) throw new Error(`standard 档引用了不存在的文档检查 ${n}`);
      }
      return `构图 ${comp.length} 项、文档 ${doc.length} 项、standard 档 ${STANDARD_DOCUMENT_CHECK_NAMES.length} 项`;
    },
  },
  {
    name: 'role 集合闭合：theme 与 layout 图例同源',
    run() {
      const ir = readSample('order-system.architecture.json');
      const lr = layout(ir);
      for (const b of lr.boxes) {
        if (!ROLE_KEYS.includes(b.role)) throw new Error(`box ${b.id} 的 role ${b.role} 不在 ROLE_KEYS 内`);
      }
      if (lr.legend) {
        for (const en of lr.legend.entries) {
          if (!ROLE_KEYS.includes(en.role)) throw new Error(`legend 含未知 role ${en.role}`);
        }
      }
      return `${ROLE_KEYS.length} 个 role 闭合`;
    },
  },
];
