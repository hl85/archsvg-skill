// 课程专项检查（6 项）：针对已渲染 SVG 与课程目录的诊断。
//
// 与 composition 不同，这里面向「产物 + 课程上下文」：SVG 是否含 ASCII 画图残留 / base64、
// 课程 md 中的相对引用是否可达、caption 格式、明暗双套 token 对比度、双轨图数量一致性。
//
// 跳过语义：被跳过的项必须 ok:true 且在 details[0] 写明「跳过：<原因>」，不允许静默通过。
//
// 不 import course-skill 任何文件；路径解析仅依赖传入参数（courseDir / svgPath / trackPair）。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { contrastRatio, TOKENS } from '../theme.mjs';

// 制表符 / Box-drawing 字符集合（计划明确列出）。
const BOX_DRAWING = /[┌┐└┘├┤┬┴┼─│╔╗╚╝═║╭╮╰╯]/;
// ASCII 流程箭头：-->, |-->|, -->|, |--> 等（形如计划示例）。
const ASCII_ARROW = /\|?-{2,}>\|?/g;
const BASE64_IMAGE = /data:image\//i;
const MD_IMAGE_REF = /!\[[^\]]*\]\((\.\/images\/[^)]+)\)/g;
const CAPTION_RE = /^图\s*\d+-\d+\s*[·•・\-—]\s*\S/;
const FIG_NO_RE = /图\s*(\d+-\d+)/g;

// 递归收集目录下所有 .md 文件绝对路径。
function collectMarkdownFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectMarkdownFiles(full));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// 扫描所有 md，返回 图号 -> 出现次数。
function collectFigureNumbers(courseDir) {
  const counts = new Map();
  for (const md of collectMarkdownFiles(courseDir)) {
    let text;
    try { text = readFileSync(md, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(FIG_NO_RE)) {
      const no = m[1];
      counts.set(no, (counts.get(no) || 0) + 1);
    }
  }
  return counts;
}

// 解析 rgba(...) 为 [r,g,b,a]。
function parseRgba(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s));
  return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
}

// 将半透明前景按 alpha 与背景合成，返回 #rrggbb。
function compositeHex(fill, bgHex) {
  const f = parseRgba(fill);
  const b = parseRgba(bgHex);
  if (!f || !b) return bgHex;
  const a = f[3];
  const r = Math.round(f[0] * a + b[0] * (1 - a));
  const g = Math.round(f[1] * a + b[1] * (1 - a));
  const bl = Math.round(f[2] * a + b[2] * (1 - a));
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(bl)}`;
}

function toHex2(n) { return n.toString(16).padStart(2, '0'); }

// ============ 1. no_ascii ============
function checkNoAscii(svgPath) {
  if (!svgPath) return { name: 'no_ascii', ok: true, details: ['跳过：未提供 svgPath'] };
  let content;
  try { content = readFileSync(svgPath, 'utf8'); }
  catch { return { name: 'no_ascii', ok: true, details: ['跳过：无法读取 SVG 文件'] }; }
  // 先剔除注释，避免 <!-- --> 中的 --> 误判。
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  if (BOX_DRAWING.test(stripped)) found.push('含制表符 / Box-drawing 字符残留');
  const arrows = [...stripped.matchAll(ASCII_ARROW)].map((m) => m[0]);
  if (arrows.length) found.push(`含 ASCII 流程箭头：${[...new Set(arrows)].slice(0, 3).join(', ')}`);
  const ok = found.length === 0;
  return { name: 'no_ascii', ok, details: ok ? ['SVG 正文无 ASCII/制表符画图残留'] : found };
}

// ============ 2. no_base64 ============
function checkNoBase64(svgPath) {
  if (!svgPath) return { name: 'no_base64', ok: true, details: ['跳过：未提供 svgPath'] };
  let content;
  try { content = readFileSync(svgPath, 'utf8'); }
  catch { return { name: 'no_base64', ok: true, details: ['跳过：无法读取 SVG 文件'] }; }
  const hit = BASE64_IMAGE.test(content);
  return {
    name: 'no_base64',
    ok: !hit,
    details: hit ? ['SVG 含 data:image/ 形式的 base64 内嵌（应改为外部引用）'] : ['SVG 无 base64 内嵌图片'],
  };
}

// ============ 3. ref_reachable ============
function checkRefReachable(courseDir) {
  if (!courseDir) return { name: 'ref_reachable', ok: true, details: ['跳过：未提供 courseDir'] };
  const missing = [];
  for (const md of collectMarkdownFiles(courseDir)) {
    let text;
    try { text = readFileSync(md, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(MD_IMAGE_REF)) {
      const ref = m[1];
      const target = path.resolve(path.dirname(md), ref);
      if (!existsSync(target)) missing.push(`${path.relative(courseDir, md)} → ${ref}`);
    }
  }
  const ok = missing.length === 0;
  return {
    name: 'ref_reachable',
    ok,
    details: ok ? ['courseDir 下所有 ./images/*.svg 相对引用均存在'] : missing.map((x) => `引用缺失：${x}`),
  };
}

// ============ 4. caption_present ============
function checkCaptionPresent(ir, courseDir) {
  const caption = ir?.meta?.caption;
  if (!caption || !String(caption).trim()) {
    return { name: 'caption_present', ok: false, details: ['meta.caption 为空，必须形如「图 X-N · 标题」'] };
  }
  if (!CAPTION_RE.test(String(caption))) {
    return {
      name: 'caption_present',
      ok: false,
      details: [`meta.caption「${caption}」格式不符，须为「图 X-N · 标题」`],
    };
  }
  // 图号重复检测：需 courseDir 上下文才能跨文件比对。
  const noMatch = String(caption).match(/图\s*(\d+-\d+)/);
  if (courseDir && noMatch) {
    const counts = collectFigureNumbers(courseDir);
    const c = counts.get(noMatch[1]) || 0;
    if (c > 1) {
      return {
        name: 'caption_present',
        ok: false,
        details: [`图号 ${noMatch[1]} 在课程中重复出现 ${c} 次，同一图号不得重复`],
      };
    }
  }
  return { name: 'caption_present', ok: true, details: [`meta.caption 格式合规：${caption}`] };
}

// ============ 5. theme_readable ============
function checkThemeReadable(ir) {
  // 收集 IR 中用到的 role。
  const used = new Set();
  for (const n of ir?.nodes || []) if (n.role) used.add(n.role);
  for (const p of ir?.participants || []) if (p.role) used.add(p.role);
  for (const g of ir?.groups || []) if (g.role) used.add(g.role);

  const fails = [];
  for (const role of used) {
    const lt = TOKENS.light.roles[role];
    const dt = TOKENS.dark.roles[role];
    if (!lt || !dt) { fails.push(`role ${role} 在 token 中缺失`); continue; }
    const lightRatio = contrastRatio(lt.text, lt.fill);
    if (lightRatio < 4.5) {
      fails.push(`role ${role} 亮色：text ${lt.text} 与 fill ${lt.fill} 对比度 ${lightRatio.toFixed(2)} < 4.5`);
    }
    // 暗色 fill 为半透明，需先与暗色画布合成后再与 text 比对。
    const darkBg = compositeHex(dt.fill, TOKENS.dark.canvas);
    const darkRatio = contrastRatio(dt.text, darkBg);
    if (darkRatio < 4.5) {
      fails.push(`role ${role} 暗色：text ${dt.text} 与合成底色 ${darkBg} 对比度 ${darkRatio.toFixed(2)} < 4.5`);
    }
  }
  const ok = fails.length === 0;
  return {
    name: 'theme_readable',
    ok,
    details: ok
      ? [`明/暗两套 token 下，用到的 ${used.size} 个 role 文字对比度均 ≥ 4.5:1`]
      : fails,
  };
}

// ============ 6. dual_track_parity ============
function listTrackSvgs(trackDir) {
  const imagesDir = path.join(trackDir, 'images');
  const base = existsSync(imagesDir) ? imagesDir : trackDir;
  let entries;
  try { entries = readdirSync(base, { withFileTypes: true }); }
  catch { return new Set(); }
  return new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.svg')).map((e) => e.name));
}

function checkDualTrackParity(options) {
  const trackPair = options?.trackPair ?? null;
  if (trackPair == null) return { name: 'dual_track_parity', ok: true, details: ['跳过：未提供 trackPair'] };
  let subdirs;
  try { subdirs = readdirSync(trackPair, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return { name: 'dual_track_parity', ok: true, details: ['跳过：trackPair 目录不可读'] }; }
  if (subdirs.length < 2) {
    return { name: 'dual_track_parity', ok: true, details: [`跳过：trackPair 下未找到至少两个轨目录（仅 ${subdirs.length} 个）`] };
  }
  const sets = subdirs.map((d) => ({ dir: d, svgs: listTrackSvgs(path.join(trackPair, d)) }));
  const mismatches = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const onlyA = [...a.svgs].filter((x) => !b.svgs.has(x));
      const onlyB = [...b.svgs].filter((x) => !a.svgs.has(x));
      if (onlyA.length || onlyB.length) {
        mismatches.push(
          `轨「${a.dir}」(${a.svgs.size}) 与「${b.dir}」(${b.svgs.size}) 不一致` +
          (onlyA.length ? `，仅前者有：${onlyA.join(', ')}` : '') +
          (onlyB.length ? `，仅后者有：${onlyB.join(', ')}` : ''),
        );
      }
    }
  }
  const ok = mismatches.length === 0;
  return {
    name: 'dual_track_parity',
    ok,
    details: ok ? [`双轨 ${subdirs.length} 个目录的 images/*.svg 数量与文件名集合一致`] : mismatches,
  };
}

// ============ 入口 ============
export function runCourseChecks({ ir, svgPath, courseDir, options }) {
  const opts = options || {};
  return [
    checkNoAscii(svgPath),
    checkNoBase64(svgPath),
    checkRefReachable(courseDir),
    checkCaptionPresent(ir, courseDir),
    checkThemeReadable(ir),
    checkDualTrackParity(opts),
  ];
}
