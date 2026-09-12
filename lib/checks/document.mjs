// 文档集成检查（7 项）：针对已渲染 SVG 与所在文档目录的诊断。
//
// 与 composition 不同，这里面向「产物 + 文档上下文」：SVG 是否含 ASCII 画图残留 / base64、
// Markdown 中的相对引用是否可达、图题格式、明暗双套 token 对比度、多版本目录图资源一致性、
// 文本是否被 role 色描边污染（text_no_stroke）。
//
// 跳过语义：被跳过的项必须 ok:true 且在 details[0] 写明「跳过：<原因>」，不允许静默通过。
//
// 本模块不依赖任何外部 skill；路径解析仅依赖传入参数（docDir / svgPath / compareDir）。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { contrastRatio, TOKENS } from '../theme.mjs';
import { estimateTextWidth } from '../text-metrics.mjs';
import { BOX, EDGE_LABEL, EDGE_MASK_HEIGHT, TYPE_SCALE } from '../typography.mjs';
import { ARROW_MARKER_IDS, collectIds, collectUrlRefs } from '../markers.mjs';

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
function collectFigureNumbers(docDir) {
  const counts = new Map();
  for (const md of collectMarkdownFiles(docDir)) {
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
function checkRefReachable(docDir) {
  if (!docDir) return { name: 'ref_reachable', ok: true, details: ['跳过：未提供 docDir'] };
  const missing = [];
  for (const md of collectMarkdownFiles(docDir)) {
    let text;
    try { text = readFileSync(md, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(MD_IMAGE_REF)) {
      const ref = m[1];
      const target = path.resolve(path.dirname(md), ref);
      if (!existsSync(target)) missing.push(`${path.relative(docDir, md)} → ${ref}`);
    }
  }
  const ok = missing.length === 0;
  return {
    name: 'ref_reachable',
    ok,
    details: ok ? ['docDir 下所有 ./images/*.svg 相对引用均存在'] : missing.map((x) => `引用缺失：${x}`),
  };
}

// ============ 4. caption_present ============
function checkCaptionPresent(ir, docDir) {
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
  // 图号重复检测：需 docDir 上下文才能跨文件比对。
  const noMatch = String(caption).match(/图\s*(\d+-\d+)/);
  if (docDir && noMatch) {
    const counts = collectFigureNumbers(docDir);
    const c = counts.get(noMatch[1]) || 0;
    if (c > 1) {
      return {
        name: 'caption_present',
        ok: false,
        details: [`图号 ${noMatch[1]} 重复出现 ${c} 次，同一图号不得重复`],
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

// ============ 6. variant_parity ============
function listVariantSvgs(variantDir) {
  const imagesDir = path.join(variantDir, 'images');
  const base = existsSync(imagesDir) ? imagesDir : variantDir;
  let entries;
  try { entries = readdirSync(base, { withFileTypes: true }); }
  catch { return new Set(); }
  return new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.svg')).map((e) => e.name));
}

function checkDualTrackParity(options) {
  const compareDir = options?.compareDir ?? null;
  if (compareDir == null) return { name: 'variant_parity', ok: true, details: ['跳过：未提供 compareDir'] };
  let subdirs;
  try { subdirs = readdirSync(compareDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return { name: 'variant_parity', ok: true, details: ['跳过：compareDir 目录不可读'] }; }
  if (subdirs.length < 2) {
    return { name: 'variant_parity', ok: true, details: [`跳过：compareDir 下未找到至少两个变体目录（仅 ${subdirs.length} 个）`] };
  }
  const sets = subdirs.map((d) => ({ dir: d, svgs: listVariantSvgs(path.join(compareDir, d)) }));
  const mismatches = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const onlyA = [...a.svgs].filter((x) => !b.svgs.has(x));
      const onlyB = [...b.svgs].filter((x) => !a.svgs.has(x));
      if (onlyA.length || onlyB.length) {
        mismatches.push(
          `变体「${a.dir}」(${a.svgs.size}) 与「${b.dir}」(${b.svgs.size}) 不一致` +
          (onlyA.length ? `，仅前者有：${onlyA.join(', ')}` : '') +
          (onlyB.length ? `，仅后者有：${onlyB.join(', ')}` : ''),
        );
      }
    }
  }
  const ok = mismatches.length === 0;
  return {
    name: 'variant_parity',
    ok,
    details: ok ? [`${subdirs.length} 个变体目录的 images/*.svg 数量与文件名集合一致`] : mismatches,
  };
}

// ============ 入口 ============
// ============ 3. text_no_stroke ============
// 防止「文字被 role 色描边污染」：role 的 fill/stroke 定义在分组 <g class="role-*"> 上，
// 而 SVG 中 g 的 stroke 会被子元素 <text> 继承。文字类若只覆盖 fill 而不覆盖 stroke，
// 近黑字就会被套上 role 色 1px 描边 —— 观感「发蓝/发紫/发糊」，而 theme_readable
// 只比对 fill 的对比度，完全查不出来。本项直接校验产物层：
//   ① 样式层：必须存在对文本关闭描边的规则（`text { stroke: none; }`）；
//   ② 属性层：不得有 <text> 带非 none 的内联 stroke。
function checkTextNoStroke(svgPath) {
  if (!svgPath) {
    return { name: 'text_no_stroke', ok: true, details: ['跳过：未提供 svgPath'] };
  }
  let content;
  try {
    content = readFileSync(svgPath, 'utf8');
  } catch (e) {
    return { name: 'text_no_stroke', ok: true, details: [`跳过：无法读取 ${svgPath}`] };
  }

  const fails = [];
  const styleText = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');

  if (!styleText.trim()) {
    fails.push('未找到内联 <style>，无法确认文本描边是否已关闭');
  } else if (!/(?:^|\})\s*text\s*\{[^}]*stroke\s*:\s*none/i.test(styleText)) {
    fails.push(
      '缺少 `text { stroke: none; }` 规则：role 的 stroke 会从分组 <g> 继承到 <text>，文字会被套上色描边'
    );
  }

  for (const m of content.matchAll(/<text\b[^>]*\bstroke\s*=\s*"([^"]*)"/g)) {
    const v = String(m[1]).trim().toLowerCase();
    if (v && v !== 'none') fails.push(`<text> 带内联 stroke="${m[1]}"，会污染字形`);
  }

  const ok = fails.length === 0;
  return {
    name: 'text_no_stroke',
    ok,
    details: ok ? ['文本已统一关闭描边（不受分组 role 色继承影响）'] : fails,
  };
}

// ============ 8. marker_contract ============
// 箭头 marker 是 SVG 里典型的「跨引用」资源：`marker-end="url(#id)"` 与 `<marker id="id">`
// 分处两地，任何一侧改名都会**静默失效**（Chrome 对不可达引用不报错，只是不画箭头），
// 而基于布局数据的检查完全看不见这类缺陷。
//
// 契约（双向）：
//   ① 所有 `url(#x)` 引用的 x 都必须有 `id="x"` 定义（不存在悬空引用）；
//   ② defs 中出现的 marker id 必须全部属于 ARROW_MARKER_IDS（不存在越权 marker）；
//   ③ ARROW_MARKER_IDS 必须全部被定义（不存在契约里写了却没实现的 marker）。
function checkMarkerContract(svgPath) {
  if (!svgPath) return { name: 'marker_contract', ok: true, details: ['跳过：未提供 svgPath'] };
  let content;
  try { content = readFileSync(svgPath, 'utf8'); }
  catch { return { name: 'marker_contract', ok: true, details: ['跳过：无法读取 SVG 文件'] }; }

  const ids = new Set(collectIds(content));
  const refs = collectUrlRefs(content);
  const fails = [];

  // ① 悬空引用
  const dangling = [...new Set(refs.filter((r) => !ids.has(r)))];
  for (const r of dangling) fails.push(`存在悬空引用 url(#${r})：文件中没有 id="${r}" 的定义（箭头会静默消失）`);

  // ② / ③ 契约集合
  const definedMarkers = [...content.matchAll(/<marker\b[^>]*\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set(ARROW_MARKER_IDS);
  for (const id of definedMarkers) {
    if (!allowed.has(id)) fails.push(`defs 中定义了契约外的 marker id="${id}"（允许：${ARROW_MARKER_IDS.join(', ')}）`);
  }
  const definedSet = new Set(definedMarkers);
  for (const id of ARROW_MARKER_IDS) {
    if (!definedSet.has(id)) fails.push(`契约要求定义的 marker id="${id}" 未在 defs 中出现`);
  }

  const ok = fails.length === 0;
  return {
    name: 'marker_contract',
    ok,
    details: ok
      ? [`marker 契约成立：${definedMarkers.length} 个定义、${refs.length} 处引用，双向可达`]
      : fails,
  };
}

// 从内联 <style> 里取某个 class 的 font-size（用于按「实际渲染字号」而非代码常量做断言，
// 这样 theme 改了字号而 layout 没跟上的话，本检查会立刻失败）。
function fontSizeOf(styleText, className) {
  const m = styleText.match(new RegExp(`\\.${className}\\s*\\{[^}]*font-size\\s*:\\s*([0-9.]+)px`, 'i'));
  return m ? parseFloat(m[1]) : null;
}

// ============ 9. svg_text_fits ============
// 产物级断言：从**渲染好的 SVG** 里取盒/遮罩的实际矩形，与文本按「实际字号」估算的宽度比对。
//
// 为什么不用 LayoutResult 来查：那会用同一套输入自我验证，恒真。这里查的是产物，
// 因此能挡住「theme 改了字号但 layout 的盒宽公式没跟上」「渲染侧用了另一个字号算遮罩」
// 「盒宽被外部覆盖」这一类**跨模块常量错位** —— 它们在使用布局数据的检查里全部不可见。
function checkSvgTextFits(svgPath) {
  if (!svgPath) return { name: 'svg_text_fits', ok: true, details: ['跳过：未提供 svgPath'] };
  let content;
  try { content = readFileSync(svgPath, 'utf8'); }
  catch { return { name: 'svg_text_fits', ok: true, details: ['跳过：无法读取 SVG 文件'] }; }

  const styleText = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const labelPx = fontSizeOf(styleText, 'n-label');
  const subPx = fontSizeOf(styleText, 'n-sub');
  const edgePx = fontSizeOf(styleText, 'edge-label');
  const fails = [];
  const MISSING = '未在内联样式中找到字号';
  if (labelPx == null || subPx == null || edgePx == null) {
    return {
      name: 'svg_text_fits',
      ok: false,
      details: [`${MISSING}（.n-label / .n-sub / .edge-label），无法做产物级宽度断言`],
    };
  }

  // 与字号表交叉核对：样式里的字号必须等于 typography.mjs 的常量。
  const pairs = [['n-label', labelPx, TYPE_SCALE.nodeTitle.px], ['n-sub', subPx, TYPE_SCALE.nodeSub.px], ['edge-label', edgePx, TYPE_SCALE.edgeLabel.px]];
  for (const [cls, got, want] of pairs) {
    if (Math.abs(got - want) > 0.01) fails.push(`.${cls} 渲染字号 ${got}px ≠ 常量表 ${want}px（theme 与 typography 已漂移）`);
  }

  const SLACK = 2;   // 取整与浮点余量

  // ① 节点盒：<g class="role-*"> 内的 rect.node 与同级 <text>
  for (const m of content.matchAll(/<g class="role-[a-z]+">([\s\S]*?)<\/g>/g)) {
    const inner = m[1];
    const rect = inner.match(/<rect class="node"[^>]*x="([-0-9.]+)"[^>]*width="([0-9.]+)"/);
    if (!rect) continue;
    const w = parseFloat(rect[2]);
    for (const t of inner.matchAll(/<text class="(n-label|n-sub)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const px = t[1] === 'n-label' ? labelPx : subPx;
      const est = estimateTextWidth(decodeEntities(t[2]), px);
      const inner_w = w - 2 * BOX.padX;
      if (est > inner_w + SLACK) {
        fails.push(`盒内文案「${t[2]}」估算宽 ${est.toFixed(1)}px > 可用内宽 ${inner_w.toFixed(1)}px（盒宽 ${w}，字号 ${px}px）`);
      }
    }
  }

  // ② 边标签遮罩：rect.edge-label-bg 必须盖住紧随其后的 text.edge-label
  const bgRe = /<rect class="edge-label-bg"[^>]*width="([0-9.]+)"[^>]*height="([0-9.]+)"[^>]*\/><text class="edge-label"[^>]*>([\s\S]*?)<\/text>/g;
  for (const m of content.matchAll(bgRe)) {
    const mw = parseFloat(m[1]);
    const mh = parseFloat(m[2]);
    const est = estimateTextWidth(decodeEntities(m[3]), edgePx);
    if (est > mw - 2 * (EDGE_LABEL.maskPadX - EDGE_LABEL.rectPadX) + SLACK) {
      fails.push(`边标签遮罩宽 ${mw} 不足以覆盖文案「${m[3]}」（估算宽 ${est.toFixed(1)}px，字号 ${edgePx}px）`);
    }
    if (mh < EDGE_MASK_HEIGHT - SLACK) {
      fails.push(`边标签遮罩高 ${mh} < 契约值 ${EDGE_MASK_HEIGHT}（文字 bbox 高约为字号的 1.25 倍，遮罩过矮会漏出连线）`);
    }
  }

  const ok = fails.length === 0;
  return {
    name: 'svg_text_fits',
    ok,
    details: ok
      ? [`产物级文字适配成立：盒内文案均在内宽内，${(content.match(/edge-label-bg/g) || []).length} 个遮罩均覆盖文案`]
      : fails,
  };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function runDocumentChecks({ ir, svgPath, docDir, options }) {
  const opts = options || {};
  return [
    checkNoAscii(svgPath),
    checkNoBase64(svgPath),
    checkTextNoStroke(svgPath),
    checkMarkerContract(svgPath),
    checkSvgTextFits(svgPath),
    checkRefReachable(docDir),
    checkCaptionPresent(ir, docDir),
    checkThemeReadable(ir),
    checkDualTrackParity(opts),
  ];
}

// 检查项名清单（供 doctor 与文档口径断言使用，勿在别处再抄一份）。
export const DOCUMENT_CHECK_NAMES = [
  'no_ascii', 'no_base64', 'text_no_stroke', 'marker_contract', 'svg_text_fits',
  'ref_reachable', 'caption_present', 'theme_readable', 'variant_parity',
];

// standard 档包含的文档专项：只放「与需求无关、任何图都必须成立」的项。
// 其余（视觉打磨与文档上下文相关者）归 showcase。
export const STANDARD_DOCUMENT_CHECK_NAMES = [
  'no_ascii', 'no_base64', 'marker_contract', 'ref_reachable',
];
