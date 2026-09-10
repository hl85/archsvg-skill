#!/usr/bin/env node
// archsvg CLI 入口 —— 把 IR JSON 渲染为可嵌入文档的静态 SVG，并做机械验证。
//
// 设计铁律：
//   - 所有路径用 import.meta.url 相对解析，支持任意 cwd 调用；
//   - 运行时零 npm 依赖；
//   - 自包含：不依赖任何外部 skill，IR 语义不耦合具体业务领域。
//
// 退出码：0 通过 / 1 验证失败 / 2 用法错误。

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// ---- 路径解析（仅依赖 import.meta.url，与 cwd 无关）----
const BIN_URL = import.meta.url;
const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(BIN_URL)));
const SCHEMAS_DIR = path.join(SKILL_ROOT, 'schemas');
const LIB_DIR = path.join(SKILL_ROOT, 'lib');
const EXAMPLES_DIR = path.join(SKILL_ROOT, 'examples');
const VENDOR_FILES = ['geometry.mjs', 'diagnostics.mjs'];

const importFrom = (rel) => import(new URL(rel, BIN_URL).href);

const TYPES = new Set(['architecture', 'flow', 'sequence']);
const STANDARD_DOCUMENT = new Set(['no_ascii', 'no_base64', 'ref_reachable']);

// ---- 通用错误 ----
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.code = 'usage';
  }
}

// =====================================================================
// 参数解析
// =====================================================================
function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--quality') {
      const v = args[i + 1];
      if (!v) throw new UsageError('--quality 需要一个值（standard|showcase）');
      flags.quality = v;
      i += 1;
    } else if (a.startsWith('--quality=')) {
      flags.quality = a.slice('--quality='.length);
    } else if (a === '--variant-pair') {
      const v = args[i + 1];
      if (!v) throw new UsageError('--variant-pair 需要一个对比根目录路径');
      flags.variantPair = v;
      i += 1;
    } else if (a.startsWith('--variant-pair=')) {
      flags.variantPair = a.slice('--variant-pair='.length);
    } else if (a.startsWith('--')) {
      throw new UsageError(`未知选项：${a}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function resolveQuality(raw) {
  const q = raw || 'standard';
  if (q !== 'standard' && q !== 'showcase') {
    throw new UsageError(`--quality 仅支持 standard|showcase，实际为「${q}」`);
  }
  return q;
}

// =====================================================================
// 输入读取
// =====================================================================
function readInput(inputPath) {
  if (!existsSync(inputPath)) {
    throw new UsageError(`找不到输入文件：${inputPath}`);
  }
  let text;
  try {
    text = readFileSync(inputPath, 'utf8');
  } catch (e) {
    throw new UsageError(`无法读取输入文件：${inputPath}（${e.message}）`);
  }
  let ir;
  try {
    ir = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`输入不是合法 JSON：${inputPath}\n${e.message}`);
  }
  return ir;
}

// =====================================================================
// 验证 + 渲染 编排
// =====================================================================
async function loadLib() {
  const [{ validateSchema }, { layout }, { renderSvg }, { runCompositionChecks },
    { runDocumentChecks }] = await Promise.all([
    importFrom('../lib/schema.mjs'),
    importFrom('../lib/layout.mjs'),
    importFrom('../lib/render.mjs'),
    importFrom('../lib/checks/composition.mjs'),
    importFrom('../lib/checks/document.mjs'),
  ]);
  return { validateSchema, layout, renderSvg, runCompositionChecks, runDocumentChecks };
}

// 跑「全部检查」：schema → layout → 9 构图 → 按档位选文档集成专项。
// 入参 svgPath：render 时为已渲染的临时 SVG；validate 时为 null（ASCII/base64 项自动跳过）。
// 返回 { schemaOk, diagnostics, checks, layoutOk }
async function runPipeline({ ir, type, svgPath, profile, variantPair = null }) {
  const { validateSchema, layout, runCompositionChecks, runDocumentChecks } = await loadLib();

  // 1) schema
  const schemaRes = validateSchema(ir);
  if (!schemaRes.ok) {
    return { schemaOk: false, diagnostics: schemaRes.diagnostics, checks: [], layoutOk: false };
  }

  // 2) layout（包裹异常，防止渲染器崩溃冒泡为未捕获错误）
  let layoutResult;
  try {
    layoutResult = layout(ir);
  } catch (e) {
    return {
      schemaOk: true,
      layoutOk: false,
      diagnostics: [{
        code: 'layout/error', severity: 'error',
        message: `布局失败：${e.message}`, subject: {}, evidence: {}, supportedFixes: [],
      }],
      checks: [],
    };
  }

  // 3) 9 项构图
  const composition = runCompositionChecks(ir, layoutResult, profile);

  // 4) 6 项文档集成专项 → 按档位筛选
  const docAll = runDocumentChecks({
    ir, svgPath, docDir: null,
    options: { compareDir: variantPair },
  });
  const doc = profile === 'showcase'
    ? docAll
    : docAll.filter((c) => STANDARD_DOCUMENT.has(c.name));

  return {
    schemaOk: true, layoutOk: true, diagnostics: [],
    checks: [...composition, ...doc],
  };
}

function summarize(checks) {
  const failed = checks.filter((c) => !c.ok).length;
  return { total: checks.length, passed: checks.length - failed, failed };
}

function buildReceipt({ command, type, input, output, profile, checks, diagnostics, artifact }) {
  const summary = summarize(checks);
  const ok = diagnostics.length === 0 && summary.failed === 0;
  const receipt = {
    schemaVersion: 1,
    ok,
    command,
    type,
    input,
    output: output ?? null,
    checks,
    composition: {
      profile,
      status: ok ? 'pass' : 'fail',
      summary,
    },
  };
  if (diagnostics.length) receipt.diagnostics = diagnostics;
  if (artifact) receipt.artifact = artifact;
  return receipt;
}

function cliErrorReceipt(command, type, message, code) {
  return {
    schemaVersion: 1,
    ok: false,
    command,
    type: type ?? null,
    input: null,
    output: null,
    checks: [],
    composition: { profile: null, status: 'fail', summary: { total: 0, passed: 0, failed: 0 } },
    diagnostics: [{
      code, severity: 'error', message, subject: {}, evidence: {}, supportedFixes: [],
    }],
  };
}

// =====================================================================
// 人类可读输出
// =====================================================================
function printChecksHuman(checks, prefix) {
  const width = Math.max(...checks.map((c) => c.name.length), 4);
  for (const c of checks) {
    const tag = c.ok ? '[ok]' : '[fail]';
    const detail = c.details && c.details.length ? c.details[0] : (c.ok ? '通过' : '未通过');
    console.log(`  ${tag} ${c.name.padEnd(width)}  ${detail}`);
    for (let i = 1; i < (c.details || []).length; i += 1) {
      console.log(`  ${' '.repeat(6)}${' '.repeat(width)}  ${c.details[i]}`);
    }
  }
}

function printHumanSummary(command, type, profile, checks, diagnostics, artifact, output) {
  if (diagnostics.length) {
    console.log(`\n✗ 架构校验失败（${diagnostics.length} 项诊断）：`);
    for (const d of diagnostics) {
      console.log(`  [${d.severity}] ${d.code}  ${d.message}`);
      if (d.supportedFixes && d.supportedFixes.length) {
        console.log(`    建议：${d.supportedFixes.join('；')}`);
      }
    }
    return;
  }
  const s = summarize(checks);
  const head = command === 'render' ? `渲染校验（${profile}）` : `校验结果（${profile}）`;
  console.log(`\n${head}：共 ${s.total} 项，通过 ${s.passed}，失败 ${s.failed}`);
  printChecksHuman(checks);
  if (s.failed === 0) {
    console.log('\n✓ 验证通过');
    if (artifact) {
      console.log(`  产物：${output}`);
      console.log(`  体积：${artifact.bytes} 字节`);
      console.log(`  sha256：${artifact.sha256}`);
    }
  } else {
    console.log('\n✗ 验证未通过，未产出文件');
  }
}

// =====================================================================
// 命令：validate
// =====================================================================
async function cmdValidate(args, command) {
  const { positional, flags } = parseArgs(args);
  const type = positional[0];
  const input = positional[1];
  if (!type || !input) {
    throw new UsageError('用法：archsvg validate <type> <input.json> [--quality standard|showcase] [--variant-pair <dir>] [--json]');
  }
  if (!TYPES.has(type)) {
    throw new UsageError(`未知的图类型「${type}」\n支持：architecture / flow / sequence`);
  }
  const profile = resolveQuality(flags.quality);
  const ir = readInput(input);

  // 命令指定的类型需与 IR 内 type 一致（schema 以 IR.type 为准）
  if (ir && ir.type && ir.type !== type) {
    return finishValidate(command, type, input, profile, flags.json, {
      schemaOk: false,
      diagnostics: [{
        code: 'cli/type-mismatch', severity: 'error',
        message: `命令指定的类型「${type}」与 IR 中 type「${ir.type}」不一致`,
        subject: { pointer: '/type' }, evidence: { arg: type, irType: ir.type },
        supportedFixes: [`将命令类型改为 ${ir.type}，或把 IR.type 改为 ${type}`],
      }],
      checks: [],
    });
  }

  const result = await runPipeline({ ir, type, svgPath: null, profile, variantPair: flags.variantPair ?? null });
  return finishValidate(command, type, input, profile, flags.json, result);
}

function finishValidate(command, type, input, profile, json, result) {
  const { schemaOk, diagnostics, checks } = result;
  if (json) {
    const receipt = buildReceipt({ command, type, input, output: null, profile, checks, diagnostics });
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
    return schemaOk && summarize(checks).failed === 0 ? 0 : 1;
  }
  printHumanSummary(command, type, profile, checks, diagnostics, null, null);
  return schemaOk && summarize(checks).failed === 0 ? 0 : 1;
}

// =====================================================================
// 命令：render
// =====================================================================
async function cmdRender(args) {
  const command = 'render';
  const { positional, flags } = parseArgs(args);
  const type = positional[0];
  const input = positional[1];
  const output = positional[2];
  if (!type || !input || !output) {
    throw new UsageError('用法：archsvg render <type> <input.json> <output.svg> [--quality standard|showcase] [--variant-pair <dir>] [--json]');
  }
  if (!TYPES.has(type)) {
    throw new UsageError(`未知的图类型「${type}」\n支持：architecture / flow / sequence`);
  }
  const profile = resolveQuality(flags.quality);
  const ir = readInput(input);

  if (ir && ir.type && ir.type !== type) {
    const diag = [{
      code: 'cli/type-mismatch', severity: 'error',
      message: `命令指定的类型「${type}」与 IR 中 type「${ir.type}」不一致`,
      subject: { pointer: '/type' }, evidence: { arg: type, irType: ir.type },
      supportedFixes: [`将命令类型改为 ${ir.type}，或把 IR.type 改为 ${type}`],
    }];
    if (flags.json) {
      process.stdout.write(JSON.stringify(cliErrorReceipt(command, type, diag[0].message, 'cli/type-mismatch'), null, 2) + '\n');
    } else {
      console.log(`✗ ${diag[0].message}`);
    }
    return 2;
  }

  // 1) schema + layout + 9 构图（不依赖 SVG 文件）
  const { renderSvg } = await loadLib();
  const pre = await runPipeline({ ir, type, svgPath: null, profile, variantPair: flags.variantPair ?? null });
  if (!pre.schemaOk || !pre.layoutOk) {
    if (flags.json) {
      process.stdout.write(JSON.stringify(
        buildReceipt({ command, type, input, output, profile, checks: pre.checks, diagnostics: pre.diagnostics }),
        null, 2) + '\n');
    } else {
      printHumanSummary(command, type, profile, pre.checks, pre.diagnostics, null, output);
    }
    return 1;
  }

  // 2) 渲染到内存并写入临时文件，供 no_ascii / no_base64 检查
  let svg;
  try {
    svg = renderSvg(ir);
  } catch (e) {
    const diag = [{
      code: 'render/error', severity: 'error', message: `渲染失败：${e.message}`,
      subject: {}, evidence: {}, supportedFixes: [],
    }];
    if (flags.json) {
      process.stdout.write(JSON.stringify(
        buildReceipt({ command, type, input, output, profile, checks: [], diagnostics: diag }), null, 2) + '\n');
    } else {
      console.log(`✗ 渲染失败：${e.message}`);
    }
    return 1;
  }

  const tmp = path.join(os.tmpdir(), `archsvg-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.svg`);
  writeFileSync(tmp, svg, 'utf8');

  // 3) 完整跑全部检查（含针对实际 SVG 的 no_ascii / no_base64）
  const full = await runPipeline({ ir, type, svgPath: tmp, profile, variantPair: flags.variantPair ?? null });
  const s = summarize(full.checks);

  if (s.failed === 0) {
    // 验证通过才写最终产物
    writeFileSync(output, svg, 'utf8');
    const buf = Buffer.from(svg, 'utf8');
    const artifact = {
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
    rmSync(tmp, { force: true });
    if (flags.json) {
      process.stdout.write(JSON.stringify(
        buildReceipt({ command, type, input, output, profile, checks: full.checks, diagnostics: [], artifact }),
        null, 2) + '\n');
    } else {
      printHumanSummary(command, type, profile, full.checks, [], artifact, output);
    }
    return 0;
  }

  // 验证失败：绝不产出，清理临时文件
  rmSync(tmp, { force: true });
  if (flags.json) {
    process.stdout.write(JSON.stringify(
      buildReceipt({ command, type, input, output, profile, checks: full.checks, diagnostics: full.diagnostics }),
      null, 2) + '\n');
  } else {
    printHumanSummary(command, type, profile, full.checks, full.diagnostics, null, output);
  }
  return 1;
}

// =====================================================================
// 命令：guide
// =====================================================================
const SCENE_KEYWORDS = {
  sequence: ['时序', '调用链', '请求', '生命周期', '交互'],
  flow: ['流程', '步骤', '管道', 'pipeline', '决策', '审批', '演进', '状态流转'],
  architecture: ['架构', '分层', '组件', '拓扑', '对比'],
};
const SKELETONS = {
  architecture: `{
  "schema_version": 1,
  "type": "architecture",
  "meta": { "title": "示例架构图", "caption": "图 1-1 · 一句话说明", "locale": "zh-CN", "viewBox": [800, 500] },
  "groups": [{ "id": "g1", "label": "层一", "role": "interaction" }],
  "nodes": [
    { "id": "a", "label": "组件A", "role": "capability", "group": "g1" },
    { "id": "b", "label": "组件B", "role": "control", "group": "g1" }
  ],
  "edges": [{ "from": "a", "to": "b", "label": "调用", "kind": "sync" }]
}`,
  flow: `{
  "schema_version": 1,
  "type": "flow",
  "meta": { "title": "示例流程图", "caption": "图 1-2 · 一句话说明", "locale": "zh-CN", "viewBox": [800, 500] },
  "nodes": [
    { "id": "s", "label": "开始", "role": "neutral", "kind": "start" },
    { "id": "step", "label": "处理", "role": "capability", "kind": "step" },
    { "id": "d", "label": "判断", "role": "control", "kind": "decision" },
    { "id": "t", "label": "结束", "role": "neutral", "kind": "terminal" }
  ],
  "edges": [
    { "from": "s", "to": "step", "kind": "sync" },
    { "from": "step", "to": "d", "kind": "sync" },
    { "from": "d", "to": "t", "label": "是", "kind": "sync" }
  ]
}`,
  sequence: `{
  "schema_version": 1,
  "type": "sequence",
  "meta": { "title": "示例时序图", "caption": "图 1-3 · 一句话说明", "locale": "zh-CN", "viewBox": [800, 500] },
  "participants": [
    { "id": "p1", "label": "客户端", "role": "interaction" },
    { "id": "p2", "label": "服务端", "role": "control" }
  ],
  "messages": [{ "from": "p1", "to": "p2", "label": "请求", "kind": "sync" }]
}`,
};

function recommendType(scene) {
  const lower = String(scene).toLowerCase();
  for (const t of ['sequence', 'flow', 'architecture']) {
    if (SCENE_KEYWORDS[t].some((k) => lower.includes(k.toLowerCase()))) return t;
  }
  return 'architecture';
}

const REASON = {
  architecture: '涉及分层 / 组件 / 边界 / 对比关系，用架构图最清晰',
  flow: '涉及步骤 / 管道 / 决策 / 状态流转，用流程图描述执行顺序',
  sequence: '涉及时序 / 调用链 / 请求生命周期，用时序图呈现参与者交互',
};

function cmdGuide(args) {
  const scene = args.join(' ').trim();
  if (!scene) {
    throw new UsageError('用法：archsvg guide "<场景描述>"');
  }
  const type = recommendType(scene);
  console.log(`推荐图类型：${type}`);
  console.log(`理由：${REASON[type]}`);
  console.log('\n最简 IR 骨架：');
  console.log(SKELETONS[type]);
  return 0;
}

// =====================================================================
// 命令：doctor（环境自检）
// =====================================================================
async function check(label, fn) {
  try {
    const msg = await fn();
    return { label, ok: true, msg: msg || 'ok' };
  } catch (e) {
    return { label, ok: false, msg: e.message };
  }
}

async function cmdDoctor() {
  const items = [];

  // 1) Node 版本
  items.push(check('Node ≥ 18', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`当前 ${process.versions.node}，需 ≥ 18`);
    return `v${process.versions.node}`;
  }));

  // 2) schemas 四文件存在且可解析
  const schemaFiles = ['common.schema.json', 'architecture.schema.json', 'flow.schema.json', 'sequence.schema.json'];
  for (const f of schemaFiles) {
    items.push(check(`schemas/${f}`, () => {
      const p = path.join(SCHEMAS_DIR, f);
      if (!existsSync(p)) throw new Error('文件不存在');
      const t = readFileSync(p, 'utf8');
      JSON.parse(t);
      return '存在且可解析';
    }));
  }

  // 3) examples 至少 1 个
  items.push(check('examples/ ≥ 1', () => {
    let list;
    try { list = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json')); }
    catch (e) { throw new Error(`无法读取 examples 目录：${e.message}`); }
    if (list.length < 1) throw new Error('examples 目录为空');
    return `${list.length} 个样例`;
  }));

  // 4) lib 各模块可 import
  const libModules = [
    '../lib/theme.mjs', '../lib/layout.mjs', '../lib/render.mjs', '../lib/schema.mjs',
    '../lib/checks/composition.mjs', '../lib/checks/document.mjs',
    '../lib/geometry.mjs', '../lib/diagnostics.mjs',
  ];
  for (const m of libModules) {
    items.push(check(`import ${m}`, async () => {
      const mod = await importFrom(m);
      if (!mod || typeof mod !== 'object') throw new Error('导出为空');
      return `导出 ${Object.keys(mod).length} 项`;
    }));
  }

  // 5) vendor 文件存在
  for (const f of VENDOR_FILES) {
    items.push(check(`lib/${f}`, () => {
      const p = path.join(LIB_DIR, f);
      if (!existsSync(p)) throw new Error('文件不存在');
      return '存在';
    }));
  }

  const results = await Promise.all(items);

  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    console.log(`  [${r.ok ? 'ok' : 'fail'}] ${r.label}  ${r.msg}`);
  }
  console.log('');
  if (allOk) {
    console.log('archsvg is ready.');
    return 0;
  }
  console.log('archsvg 自检未通过，请修复上述 [fail] 项。');
  return 1;
}

// =====================================================================
// 入口分发
// =====================================================================
function printUsage() {
  console.log(`archsvg —— 把 IR JSON 渲染为可嵌入文档的静态 SVG 并做机械验证

用法：
  archsvg doctor                                            环境自检
  archsvg guide "<场景>"                                    推荐图类型
  archsvg validate <type> <input.json> [--quality standard|showcase] [--variant-pair <dir>] [--json]
  archsvg render   <type> <input.json> <output.svg> [--quality standard|showcase] [--variant-pair <dir>] [--json]

类型：architecture | flow | sequence
退出码：0 通过 / 1 验证失败 / 2 用法错误`);
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    printUsage();
    return cmd ? 0 : 2;
  }

  try {
    switch (cmd) {
      case 'doctor': return await cmdDoctor();
      case 'guide': return cmdGuide(rest);
      case 'validate': return await cmdValidate(rest, 'validate');
      case 'render': return await cmdRender(rest);
      default:
        throw new UsageError(`未知命令：「${cmd}」`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      if (rest.includes('--json') || process.argv.includes('--json')) {
        const typeArg = rest.find((a) => TYPES.has(a));
        process.stdout.write(JSON.stringify(cliErrorReceipt(cmd, typeArg, e.message, 'cli/usage'), null, 2) + '\n');
      } else {
        console.error(`用法错误：${e.message}`);
      }
      return 2;
    }
    // 未预期错误：友好中文 + 退出码 2
    const msg = `内部错误：${e.message}`;
    if (rest.includes('--json')) {
      process.stdout.write(JSON.stringify(cliErrorReceipt(cmd, null, msg, 'cli/internal'), null, 2) + '\n');
    } else {
      console.error(msg);
    }
    return 2;
  }
}

const code = await main();
process.exitCode = code;
