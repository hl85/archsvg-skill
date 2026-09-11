// 主题模块：配色 token、CSS 自定义属性、明暗切换、WCAG 对比度。
//
// 配色 token：亮色 / 暗色两套，语义固定，改动会影响 theme_readable 检查。
// 画布/正文/辅助/箭头来自同一节；panel、panelBorder、grid 不在表中，
// 选取与表格一致视觉梯度的值（亮色更浅、暗色更深），不影响节点对比度。

export const ROLE_KEYS = ['control', 'capability', 'interaction', 'warn', 'neutral'];

export const TOKENS = {
  light: {
    canvas: '#f8fafc',
    panel: '#ffffff',
    panelBorder: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    arrow: '#94a3b8',
    grid: '#e2e8f0',
    roles: {
      control: { fill: '#fdf4ff', stroke: '#c084fc', text: '#7e22ce' },
      capability: { fill: '#f0fdf4', stroke: '#4ade80', text: '#166534' },
      interaction: { fill: '#eff6ff', stroke: '#60a5fa', text: '#1e40af' },
      warn: { fill: '#fef2f2', stroke: '#ef4444', text: '#b91c1c' },
      neutral: { fill: '#f8fafc', stroke: '#94a3b8', text: '#475569' },
    },
  },
  dark: {
    canvas: '#0f172a',
    panel: '#1e293b',
    panelBorder: '#334155',
    text: '#e2e8f0',
    muted: '#94a3b8',
    arrow: '#64748b',
    grid: '#1e293b',
    roles: {
      control: { fill: 'rgba(168,85,247,0.18)', stroke: '#c084fc', text: '#e9d5ff' },
      capability: { fill: 'rgba(74,222,128,0.16)', stroke: '#4ade80', text: '#bbf7d0' },
      interaction: { fill: 'rgba(96,165,250,0.16)', stroke: '#60a5fa', text: '#dbeafe' },
      warn: { fill: 'rgba(239,68,68,0.16)', stroke: '#f87171', text: '#fecaca' },
      neutral: { fill: 'rgba(148,163,184,0.14)', stroke: '#94a3b8', text: '#cbd5e1' },
    },
  },
};

// 取某模式下的完整 token 集合（含 roles 映射）。
export function tokensFor(mode) {
  const t = mode === 'dark' ? TOKENS.dark : TOKENS.light;
  return {
    canvas: t.canvas,
    panel: t.panel,
    panelBorder: t.panelBorder,
    text: t.text,
    muted: t.muted,
    arrow: t.arrow,
    grid: t.grid,
    roles: JSON.parse(JSON.stringify(t.roles)),
  };
}

// 生成内联 <style> 文本。默认（:root）亮色，暗色放入 prefers-color-scheme。
export function styleBlock() {
  const lines = [];
  lines.push(':root {');
  lines.push(...varsLines(TOKENS.light));
  lines.push('}');
  lines.push('@media (prefers-color-scheme: dark) {');
  lines.push('  :root {');
  lines.push(...varsLines(TOKENS.dark, '  '));
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push(baseCss());
  return lines.join('\n');
}

function varsLines(t, indent = '') {
  const out = [];
  out.push(`${indent}--canvas: ${t.canvas};`);
  out.push(`${indent}--panel: ${t.panel};`);
  out.push(`${indent}--panel-border: ${t.panelBorder};`);
  out.push(`${indent}--text: ${t.text};`);
  out.push(`${indent}--muted: ${t.muted};`);
  out.push(`${indent}--arrow: ${t.arrow};`);
  out.push(`${indent}--grid: ${t.grid};`);
  for (const r of ROLE_KEYS) {
    const role = t.roles[r];
    out.push(`${indent}--role-${r}-fill: ${role.fill};`);
    out.push(`${indent}--role-${r}-stroke: ${role.stroke};`);
    out.push(`${indent}--role-${r}-text: ${role.text};`);
  }
  return out;
}

function baseCss() {
  const roleRules = [];
  for (const r of ROLE_KEYS) {
    // .role-X 直接作用于色块（图例 swatch）；盒子用 .role-X .node 上色。
    // 节点标题统一用中性 --text（近黑/近白）：role 色只承担「卡片填充 + 描边」的语义，
    // 若标题也取 role 同色系深色调，会与同色系浅底形成顺色（发灰、发虚）。
    roleRules.push(`.role-${r} { fill: var(--role-${r}-fill); stroke: var(--role-${r}-stroke); }`);
    roleRules.push(`.role-${r} .node { fill: var(--role-${r}-fill); stroke: var(--role-${r}-stroke); }`);
  }
  return [
    'svg { background: var(--canvas); }',
    '.title { fill: var(--text); font-size: 24px; font-weight: 700; }',
    '.desc { fill: var(--muted); font-size: 12px; }',
    '.caption { fill: var(--muted); font-size: 12px; }',
    '.frame { fill: var(--panel); stroke: var(--panel-border); stroke-width: 1.25; }',
    '.frame-label { fill: var(--text); font-size: 13px; font-weight: 700; }',
    '.node { stroke-width: 1.5; }',
    '.n-label { fill: var(--text); font-size: 16px; font-weight: 700; dominant-baseline: central; }',
    '.n-sub { fill: var(--muted); font-size: 12px; dominant-baseline: central; }',
    '.edge { fill: none; stroke: var(--arrow); stroke-width: 2; }',
    '.edge-dashed { stroke-dasharray: 5 4; }',
    '.edge-label { fill: var(--muted); font-size: 12px; dominant-baseline: central; }',
    '.lifeline { fill: none; stroke: var(--arrow); stroke-width: 1.5; stroke-dasharray: 4 4; }',
    '.legend-box { fill: var(--panel); stroke: var(--panel-border); stroke-width: 1; }',
    '.legend-label { fill: var(--text); font-size: 12px; dominant-baseline: central; }',
    '.arrow-fill { fill: var(--arrow); }',
    '.arrow-line { fill: none; stroke: var(--arrow); stroke-width: 1.4; }',
    ...roleRules,
  ].join('\n');
}

// ---- WCAG 相对亮度对比度 ----

function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 1];
  c = c.trim();
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r, g, b, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]];
  }
  return [0, 0, 0, 1];
}

// 将半透明前景按 alpha 与给定背景合成，得到不透明等效色。
function composite(fg, bg) {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function relLuminance(r, g, b) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 返回 1..21 的对比度。任一色为 rgba 时，按其 alpha 与另一色合成后再算。
export function contrastRatio(hexFg, hexBg) {
  let f = parseColor(hexFg);
  let b = parseColor(hexBg);
  if (f[3] < 1) f = composite(f, b);
  else if (b[3] < 1) b = composite(b, f);
  const L1 = relLuminance(f[0], f[1], f[2]);
  const L2 = relLuminance(b[0], b[1], b[2]);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}
