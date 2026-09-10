// 静态 SVG 渲染模块：从 IR 经 layout 生成单文件 SVG。
// 约束（§2.5）：内联 <style>、亮色优先、零 JS、无 <foreignObject>、无外部字体、
// 含 <title>/<desc>、箭头 marker 在 <defs>、节点用 class 上色、文本 XML 转义。

import { layout } from './layout.mjs';
import { styleBlock } from './theme.mjs';

// 标题左对齐边距，与 layout 内部 MARGIN 保持一致。
const MARGIN_X = 24;

// 对外导出的文字宽度估算（中文 1.0em/字，英文数字 0.55em/字）。
export function measureTextWidth(text, px) {
  if (!text) return 0;
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    const cjk =
      (c >= 0x2e80 && c <= 0x9fff) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xffef) ||
      (c >= 0x3000 && c <= 0x303f);
    w += cjk ? px : px * 0.55;
  }
  return w;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function polylinePath(points) {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`).join(' ');
}

function round(v) {
  return Math.round(v * 100) / 100;
}

// 边种类 → marker 与虚线样式。
function edgeStyle(kind) {
  switch (kind) {
    case 'async': return { marker: 'arrow-async', dashed: true };
    case 'fallback': return { marker: 'arrow-fallback', dashed: true };
    case 'return': return { marker: 'arrow', dashed: true };
    case 'lifeline': return { marker: null, dashed: true, life: true };
    default: return { marker: 'arrow', dashed: false };
  }
}

function renderDefs() {
  return [
    '<defs>',
    '<marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">',
    '<path class="arrow-fill" d="M0,0 L8,4 L0,8 Z"/>',
    '</marker>',
    '<marker id="arrow-async" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">',
    '<path class="arrow-line" d="M0,0 L8,4 L0,8"/>',
    '</marker>',
    '<marker id="arrow-fallback" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">',
    '<path class="arrow-line" d="M0,0 L8,4 L0,8"/>',
    '</marker>',
    '</defs>',
  ].join('');
}

function renderFrames(frames) {
  return frames.map((f) => {
    const label = f.label
      ? `<text class="frame-label" x="${round(f.x + 12)}" y="${round(f.y + 18)}">${esc(f.label)}</text>`
      : '';
    return `<g><rect class="frame" x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="10"/>${label}</g>`;
  }).join('');
}

function renderEdges(edges) {
  // 生命线先画（在底层），其余边后画。
  const life = [];
  const others = [];
  for (const e of edges) {
    if (e.kind === 'lifeline') life.push(e);
    else others.push(e);
  }
  const parts = [];
  for (const e of life) {
    parts.push(`<path class="lifeline" d="${polylinePath(e.points)}"/>`);
  }
  for (const e of others) {
    const st = edgeStyle(e.kind);
    const marker = st.marker ? ` marker-end="url(#${st.marker})"` : '';
    const cls = st.dashed ? 'edge edge-dashed' : 'edge';
    parts.push(`<path class="${cls}" d="${polylinePath(e.points)}"${marker}/>`);
    if (e.label && e.labelAt) {
      // 标签背景遮罩：用画布底色盖住下方的连线，保证标签文字清晰可读。
      const lw = measureTextWidth(e.label, 11) + 8;
      parts.push(`<rect class="edge-label-bg" x="${round(e.labelAt[0] - lw / 2)}" y="${round(e.labelAt[1] - 7)}" width="${round(lw)}" height="14" rx="3"/>`);
      parts.push(`<text class="edge-label" x="${round(e.labelAt[0])}" y="${round(e.labelAt[1] + 3)}" text-anchor="middle">${esc(e.label)}</text>`);
    }
  }
  return parts.join('');
}

function renderBoxes(boxes) {
  return boxes.map((b) => {
    const sub = b.sublabel
      ? `<text class="n-sub" x="${b.cx}" y="${b.cy + 9}" text-anchor="middle">${esc(b.sublabel)}</text>`
      : '';
    const labelY = b.sublabel ? b.cy - 5 : b.cy;
    const label = `<text class="n-label" x="${b.cx}" y="${labelY}" text-anchor="middle">${esc(b.label)}</text>`;
    return `<g class="role-${b.role}"><rect class="node" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="8"/>${label}${sub}</g>`;
  }).join('');
}

function renderLegend(legend) {
  if (!legend) return '';
  const sw = 14;
  const lh = 18;
  const parts = [];
  parts.push(`<g class="legend"><rect class="legend-box" x="${legend.x}" y="${legend.y}" width="${legend.width}" height="${legend.height}" rx="6"/>`);
  legend.entries.forEach((en, i) => {
    const ry = legend.y + 12 + i * lh;
    parts.push(`<rect class="role-${en.role}" x="${legend.x + 10}" y="${ry - 9}" width="${sw}" height="${sw}" rx="3"/>`);
    parts.push(`<text class="legend-label" x="${legend.x + 10 + sw + 8}" y="${ry}" text-anchor="start">${esc(en.label)}</text>`);
  });
  parts.push('</g>');
  return parts.join('');
}

// 主入口：返回完整 <svg>…</svg> 字符串。
export function renderSvg(ir) {
  const lr = layout(ir);
  const W = lr.width;
  const H = lr.height;
  const title = (ir.meta && ir.meta.title) || 'diagram';
  const desc = (ir.meta && (ir.meta.caption || ir.meta.title)) || title;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(desc)}</desc>`,
    `<style>${styleBlock()}</style>`,
    // 标签背景遮罩样式：复用主题里的画布底色变量（明暗两模式自动切换）。
    `<style>.edge-label-bg{fill:var(--canvas);stroke:none;}</style>`,
    renderDefs(),
    // 标题（不参与明暗绘制层，单独输出在内容之上不影响布局）
    `<text class="title" x="${round(MARGIN_X)}" y="32">${esc(title)}</text>`,
    // 绘制顺序：frames → edges → boxes → legend
    renderFrames(lr.frames),
    renderEdges(lr.edges),
    renderBoxes(lr.boxes),
    renderLegend(lr.legend),
    '</svg>',
  ].join('');

  return svg;
}
