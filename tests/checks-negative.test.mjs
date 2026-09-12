// 负向测试：每一项新检查都必须**能被证伪**。
//
// 只断言「好输入通过」是不够的 —— 一个恒为 ok 的检查也能让所有样例变绿。
// 因此这里为每项检查构造**必定违规**的输入，断言它确实报错，并断言同类正常输入通过。
//
// 测试对象：entity_coverage、text_not_truncated（构图）/ marker_contract、svg_text_fits、svg_a11y、
// svg_hygiene、weight_whitelist、role_budget、min_font_size、content_within_canvas（文档，产物级 / IR 级）。

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
  {
    name: 'svg_a11y：缺 role="img" 或 title/desc 顺序错误必须被拦下',
    run() {
      const bad = GOOD_SVG.replace(' role="img"', '');
      if (bad === GOOD_SVG) throw new Error('替换未生效，测试骨架已变（根 <svg> 已无 role="img"？）');
      const c = runDoc(writeTmp('no-role.svg', bad)).get('svg_a11y');
      if (c.ok) throw new Error('缺 role="img" 未被拦下');
      if (!/role="img"/.test(c.details.join(''))) throw new Error(`报错信息未指明 role：${c.details[0]}`);
      // ② title / desc 顺序被破坏
      const swapped = GOOD_SVG.replace(
        /<title>([\s\S]*?)<\/title><desc>([\s\S]*?)<\/desc>/,
        '<desc>$2</desc><title>$1</title>'
      );
      if (swapped === GOOD_SVG) throw new Error('title/desc 交换未生效，测试骨架已变');
      const c2 = runDoc(writeTmp('swapped.svg', swapped)).get('svg_a11y');
      if (c2.ok) throw new Error('title / desc 顺序错误未被拦下');
      const good = runDoc(writeTmp('a11y-good.svg', GOOD_SVG)).get('svg_a11y');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return '缺 role 被拦、title/desc 顺序错误被拦，正常产物通过';
    },
  },
  {
    name: 'svg_hygiene：注释 / 渐变 / filter 必须被拦下',
    run() {
      const withComment = GOOD_SVG.replace('<style>', '<!-- generated --><style>');
      if (withComment === GOOD_SVG) throw new Error('注释注入未生效，测试骨架已变');
      const c1 = runDoc(writeTmp('comment.svg', withComment)).get('svg_hygiene');
      if (c1.ok) throw new Error('注释残留未被拦下');
      const withGrad = GOOD_SVG.replace('<defs>', '<defs><linearGradient id="g1"></linearGradient>');
      const c2 = runDoc(writeTmp('grad.svg', withGrad)).get('svg_hygiene');
      if (c2.ok) throw new Error('渐变定义未被拦下');
      const withFilter = GOOD_SVG.replace('<defs>', '<defs><filter id="f1"></filter>');
      const c3 = runDoc(writeTmp('filter.svg', withFilter)).get('svg_hygiene');
      if (c3.ok) throw new Error('<filter> 未被拦下');
      const good = runDoc(writeTmp('hygiene-good.svg', GOOD_SVG)).get('svg_hygiene');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return '注释 / 渐变 / filter 均被拦，正常产物通过';
    },
  },
  {
    name: 'weight_whitelist：白名单外字重必须被拦下',
    run() {
      const bad = GOOD_SVG.replace('font-weight: 700', 'font-weight: 600');
      if (bad === GOOD_SVG) throw new Error('替换未生效，测试骨架已变');
      const c = runDoc(writeTmp('weight.svg', bad)).get('weight_whitelist');
      if (c.ok) throw new Error('白名单外字重未被拦下');
      if (!/600/.test(c.details.join(''))) throw new Error(`报错信息未指明字重：${c.details[0]}`);
      const good = runDoc(writeTmp('weight-good.svg', GOOD_SVG)).get('weight_whitelist');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return '字重 600 被拦下，正常产物通过';
    },
  },
  {
    name: 'role_budget：> 3 个 role 未声明或声明漏项必须被拦下',
    run() {
      const run = (ir) => runDocumentChecks({ ir, svgPath: null, docDir: null, options: {} })
        .find((c) => c.name === 'role_budget');
      const base = readSample('order-system.architecture.json'); // 4 个 role + 已声明
      const declared = run(base);
      if (!declared.ok) throw new Error(`带声明的样例被误判：${declared.details[0]}`);
      // ① 删除声明 → 失败
      const noDecl = JSON.parse(JSON.stringify(base));
      delete noDecl.meta.roleBudget;
      const c1 = run(noDecl);
      if (c1.ok) throw new Error('缺 meta.roleBudget 未被拦下');
      if (!/roleBudget/.test(c1.details.join(''))) throw new Error(`报错未指明 roleBudget：${c1.details[0]}`);
      // ② 声明漏掉一个 role → 失败
      const partial = JSON.parse(JSON.stringify(base));
      partial.meta.roleBudget.roles = ['capability', 'control', 'interaction', 'warn'];
      const c2 = run(partial);
      if (c2.ok) throw new Error('声明漏列 role 未被拦下');
      if (!/neutral/.test(c2.details.join(''))) throw new Error(`报错未列出缺失 role：${c2.details[0]}`);
      // ③ ≤ 3 个 role 免声明
      const small = {
        meta: { title: 'x' },
        nodes: [{ id: 'a', role: 'control' }, { id: 'b', role: 'capability' }, { id: 'c', role: 'interaction' }],
      };
      const c3 = run(small);
      if (!c3.ok) throw new Error(`≤ 3 个 role 被误判：${c3.details[0]}`);
      return '缺声明被拦、漏列 role 被拦，≤3 role 免声明通过';
    },
  },
  {
    name: 'min_font_size：画布过宽导致展示字号不足必须被拦下',
    run() {
      const m = GOOD_SVG.match(/<svg[^>]*viewBox="0 0 ([0-9.]+) /);
      if (!m) throw new Error('未找到根 viewBox，测试骨架已变');
      const wide = GOOD_SVG.replace(m[0], m[0].replace(`viewBox="0 0 ${m[1]} `, 'viewBox="0 0 2000 '));
      if (wide === GOOD_SVG) throw new Error('画布加宽替换未生效');
      const c = runDoc(writeTmp('widefont.svg', wide)).get('min_font_size');
      if (c.ok) throw new Error('画布过宽未被拦下');
      if (!/下限/.test(c.details.join(''))) throw new Error(`报错信息未指明下限：${c.details[0]}`);
      const good = runDoc(writeTmp('fontsize-good.svg', GOOD_SVG)).get('min_font_size');
      if (!good.ok) throw new Error(`正常产物被误判：${good.details[0]}`);
      return `画布宽 ${m[1]} → 2000 被拦下，正常产物通过`;
    },
  },
  {
    name: 'entity_coverage：flow+stages 下 stage 不匹配的节点必须被拦下',
    run() {
      const ir = readSample('ci-pipeline.flow.json');
      const target = ir.nodes.find((n) => n.id === 'rollback');
      const original = target.stage;
      // 形态一：stage 值不存在
      target.stage = 'no-such-stage';
      let c = runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage');
      if (!c) throw new Error('找不到 entity_coverage 检查项');
      if (c.ok) throw new Error('stage 值不存在时节点被静默丢弃，未被拦下');
      if (!/rollback/.test(c.details.join(''))) throw new Error(`报错未指明丢失的节点：${c.details[0]}`);
      // 形态二：stage 缺失
      delete target.stage;
      c = runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage');
      if (c.ok) throw new Error('stage 缺失时节点被静默丢弃，未被拦下');
      // 恢复后应通过
      target.stage = original;
      const again = runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage');
      if (!again.ok) throw new Error(`恢复后仍失败：${again.details[0]}`);
      return `stage 值不存在 / stage 缺失两种形态均被拦下，恢复后通过`;
    },
  },
  {
    name: 'entity_coverage：端点不存在的边/消息必须被拦下',
    run() {
      const checks = [];
      // architecture / flow：edge 指向不存在的节点
      for (const [file, type] of [['order-system.architecture.json', 'architecture'], ['ci-pipeline.flow.json', 'flow']]) {
        const ir = readSample(file);
        const original = ir.edges[0].to;
        ir.edges[0].to = 'ghost-node';
        const c = runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage');
        if (c.ok) throw new Error(`${type}：端点不存在的边被静默丢弃，未被拦下`);
        if (!/ghost-node/.test(c.details.join(''))) throw new Error(`${type}：报错未指明丢失的边：${c.details[0]}`);
        ir.edges[0].to = original;
        if (!runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage').ok) {
          throw new Error(`${type}：恢复后仍失败`);
        }
        checks.push(type);
      }
      // sequence：message 指向不存在的参与者
      {
        const ir = readSample('oauth-login.sequence.json');
        const original = ir.messages[0].from;
        ir.messages[0].from = 'ghost-participant';
        const c = runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage');
        if (c.ok) throw new Error('sequence：端点不存在的消息被静默丢弃，未被拦下');
        ir.messages[0].from = original;
        if (!runCompositionChecks(ir, layout(ir), 'showcase').find((x) => x.name === 'entity_coverage').ok) {
          throw new Error('sequence：恢复后仍失败');
        }
        checks.push('sequence');
      }
      return `${checks.join(' / ')} 三种类型下的悬空端点边均被拦下`;
    },
  },
  {
    name: 'content_within_canvas：比内容更宽的居中文字必须被拦下',
    run() {
      const ir = readSample('order-system.architecture.json');
      const lrWidth = layout(ir).width;
      // 造一份「图注远宽于内容」的 IR，再**把画布宽改回不含图注宽度的 lrWidth**
      // —— 这正是修复前的几何：内容按 lrWidth 摆，而图注居中在新（更宽的）画布上，
      //    于是它必然越界。修复后渲染器会把图注宽度计入画布，故这里手工复现旧态。
      const orig = ir.meta.caption;
      ir.meta.caption = '图 1-1 · 一条刻意写得非常长的图注，用来验证画布宽度是否把居中文字自身的宽度算了进去（修复前会被左右各切一半）';
      const rendered = renderSvg(ir);
      const shrunk = rendered.replace(/viewBox="0 0 [\d.]+ ([\d.]+)"/, `viewBox="0 0 ${lrWidth} $1"`);
      if (shrunk === rendered) throw new Error('viewBox 替换未生效，测试骨架已变');
      const c = runDoc(writeTmp('caption-overflow.svg', shrunk)).get('content_within_canvas');
      if (c.ok) throw new Error('超宽图注未被拦下');
      if (!/caption/.test(c.details.join('')) || !/越出画布/.test(c.details.join(''))) {
        throw new Error(`报错未指明越界元素与方向：${c.details[0]}`);
      }
      // 同一张图，画布宽度正常时（修复后的渲染结果）必须通过
      const good = runDoc(writeTmp('caption-ok.svg', rendered)).get('content_within_canvas');
      if (!good.ok) throw new Error(`修复后的产物被误判：${good.details[0]}`);
      ir.meta.caption = orig;
      return `画布 ${lrWidth}px 时装不下图注 → 拦下；修复后的 ${layout(ir).width}px 版本通过`;
    },
  },
];

// 用例跑完清理临时目录。
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
