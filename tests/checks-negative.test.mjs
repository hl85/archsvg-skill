// 负向测试：每一项新检查都必须**能被证伪**。
//
// 只断言「好输入通过」是不够的 —— 一个恒为 ok 的检查也能让所有样例变绿。
// 因此这里为每项检查构造**必定违规**的输入，断言它确实报错，并断言同类正常输入通过。
//
// 测试对象：text_not_truncated（构图）/ marker_contract、svg_text_fits（文档，产物级）。

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import { layout } from '../lib/layout.mjs';
import { renderSvg } from '../lib/render.mjs';
import { runCompositionChecks } from '../lib/checks/composition.mjs';
import { runDocumentChecks } from '../lib/checks/document.mjs';
import { ARROW_MARKER_IDS, MARKER_GEOMETRY } from '../lib/markers.mjs';
import { TYPE_SCALE, BOX } from '../lib/typography.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(HERE, '..', 'samples');
const readSample = (f) => JSON.parse(readFileSync(path.join(SAMPLES, f), 'utf8'));

const TMP = mkdtempSync(path.join(os.tmpdir(), 'archsvg-test-'));
const writeTmp = (name, content) => {
  const p = path.join(TMP, name);
  writeFileSync(p, content, 'utf8');
  return p;
};

function runDoc(svgPath) {
  const ir = readSample('order-system.architecture.json');
  const map = new Map(runDocumentChecks({ ir, svgPath, docDir: null, options: {} }).map((c) => [c.name, c]));
  return map;
}

// 用真实渲染产物做骨架，便于只改一个字段来定向触发某一项。
const GOOD_SVG = renderSvg(readSample('oauth-login.sequence.json'));

export const cases = [
  {
    name: 'text_not_truncated：超长文案必须被拦下',
    run() {
      const ir = readSample('order-system.architecture.json');
      const target = ir.nodes[0];
      const original = target.label;
      target.label = '这是一个刻意写得极长的节点标题用来触发折行上限导致信息被截断的行为';
      const checks = runCompositionChecks(ir, layout(ir), 'showcase');
      const hit = checks.find((c) => c.name === 'text_not_truncated');
      target.label = original;
      if (!hit) throw new Error('找不到 text_not_truncated 检查项');
      if (hit.ok) throw new Error('超长文案未被拦下（检查恒真？）');
      // 反向确认：恢复后应通过
      const again = runCompositionChecks(ir, layout(ir), 'showcase').find((c) => c.name === 'text_not_truncated');
      if (!again.ok) throw new Error(`恢复原文案后仍失败：${again.details[0]}`);
      return `违规被拦（${hit.details.length} 条），恢复后通过`;
    },
  },
  {
    name: 'marker_contract：悬空引用必须被拦下',
    run() {
      const bad = GOOD_SVG.replace('url(#arrow)', 'url(#arrow-typo)');
      if (bad === GOOD_SVG) throw new Error('替换未生效，测试骨架已变，请更新用例');
      const c = runDoc(writeTmp('dangling.svg', bad)).get('marker_contract');
      if (c.ok) throw new Error('悬空引用未被拦下');
      if (!/悬空引用/.test(c.details.join(''))) throw new Error(`报错信息未指明悬空引用：${c.details[0]}`);
      const good = runDoc(writeTmp('good.svg', GOOD_SVG)).get('marker_contract');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return '悬空引用被拦，正常产物通过';
    },
  },
  {
    name: 'marker_contract：契约外 marker 与缺实现都必须被拦下',
    run() {
      const g = MARKER_GEOMETRY;
      // ① 多定义一个契约外的 marker
      const extra = GOOD_SVG.replace(
        '<defs>',
        `<defs><marker id="arrow-rogue" viewBox="${g.viewBox}" markerWidth="${g.markerWidth}" markerHeight="${g.markerHeight}"></marker>`
      );
      const c1 = runDoc(writeTmp('rogue.svg', extra)).get('marker_contract');
      if (c1.ok) throw new Error('契约外 marker 未被拦下');
      // ② 契约里的 marker 少实现一个
      const missing = GOOD_SVG.replace(new RegExp(`<marker id="${ARROW_MARKER_IDS[1]}"[\\s\\S]*?</marker>`), '');
      if (missing === GOOD_SVG) throw new Error('删除 marker 未生效，测试骨架已变');
      const c2 = runDoc(writeTmp('missing.svg', missing)).get('marker_contract');
      if (c2.ok) throw new Error('契约 marker 缺实现未被拦下');
      return `越权定义被拦（${c1.details.length} 条）、缺实现被拦（${c2.details.length} 条）`;
    },
  },
  {
    name: 'svg_text_fits：渲染字号与常量表不一致必须被拦下',
    run() {
      const bad = GOOD_SVG.replace(
        new RegExp(`\\.n-label \\{[^}]*font-size: ${TYPE_SCALE.nodeTitle.px}px`),
        `.n-label { font-size: 24px`
      );
      if (bad === GOOD_SVG) throw new Error('替换未生效，测试骨架已变');
      const c = runDoc(writeTmp('fontdrift.svg', bad)).get('svg_text_fits');
      if (c.ok) throw new Error('字号漂移未被拦下');
      if (!/漂移/.test(c.details.join(''))) throw new Error(`报错信息未指明漂移：${c.details[0]}`);
      const good = runDoc(writeTmp('good2.svg', GOOD_SVG)).get('svg_text_fits');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return '字号漂移被拦，正常产物通过';
    },
  },
  {
    name: 'svg_text_fits：盒宽被改窄必须被拦下',
    run() {
      // 把第一个节点盒的宽度改到远小于文案所需，且保持字号不变。
      const m = GOOD_SVG.match(/<rect class="node" x="([-0-9.]+)" y="([-0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/);
      if (!m) throw new Error('未找到 node rect，测试骨架已变');
      const narrow = Math.max(1, BOX.padX * 2 + 1);
      const bad = GOOD_SVG.replace(m[0], m[0].replace(`width="${m[3]}"`, `width="${narrow}"`));
      const c = runDoc(writeTmp('narrow.svg', bad)).get('svg_text_fits');
      if (c.ok) throw new Error('盒宽过窄未被拦下');
      if (!/内宽/.test(c.details.join(''))) throw new Error(`报错信息未指明内宽：${c.details[0]}`);
      return `盒宽 ${m[3]} → ${narrow} 被拦下`;
    },
  },
  {
    name: 'svg_text_fits：遮罩过矮必须被拦下',
    run() {
      const m = GOOD_SVG.match(/height="([0-9.]+)" rx="3"\/><text class="edge-label"/);
      if (!m) throw new Error('未找到遮罩 rect，测试骨架已变');
      const bad = GOOD_SVG.replace(m[0], m[0].replace(`height="${m[1]}"`, 'height="10"'));
      const c = runDoc(writeTmp('shortmask.svg', bad)).get('svg_text_fits');
      if (c.ok) throw new Error('遮罩过矮未被拦下');
      return `遮罩高 ${m[1]} → 10 被拦下`;
    },
  },
];

// 用例跑完清理临时目录。
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
