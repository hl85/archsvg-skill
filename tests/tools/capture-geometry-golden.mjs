// 几何行为基线（golden）捕获器。
//
// ⚠️ 本脚本**只在 vendored 的 lib/geometry.mjs 还在时可用**：它 import 当前 vendored
// 实现，逐条读入 geometry-corpus.json 的入参、调用、把返回值原样（经可稳定回读的编码）
// 写入 tests/fixtures/geometry-golden.json。
//
// 净室重写之后：本脚本退役（它的 import 目标不可再依赖），但 golden 文件长期保留，
// 由 tests/geometry-parity.test.mjs 用来验证新实现。**重写后不要再运行本脚本**，
// 否则等于用新实现覆盖自己的判据（基线就失去了「旧行为参照物」的意义）。
//
// 运行：node tests/tools/capture-geometry-golden.mjs
// 前置：node tests/tools/build-geometry-corpus.mjs
// 输出：tests/fixtures/geometry-golden.json（形状 { schemaVersion, entries:[{id,site,fn,args,result,error?}] }）
//
// 失败/不可序列化一律**如实记录**，不静默丢弃：
//   - 调用抛错 → result = null，并写 error = { name, message }；
//   - 返回值里的 NaN/Infinity/undefined/function/循环引用 → 由 geometry-codec.mjs
//     写成 __num / __undefined / __fn / __circular 等标记。捕获结束会打印标记统计。

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// =====================================================================
// ⛔ 硬闸门：本脚本已退役，默认**不可运行**。
//
// 为什么需要闸门而不是一句注释：它的输出就是 parity 测试的判据。若它在重写后
// 被重新运行，会把基线覆盖成「当前实现自己的输出」——parity 当场退化成永远为真，
// 而且**没有任何提示**。注释拦不住人，哈希能。
//
// 现在的 lib/geometry.mjs 是自研实现，不再是捕获基线时用的那个参考实现。
// 要重放捕获，必须显式提供参考实现，且其 sha256 必须匹配下面记录的指纹。
// =====================================================================
const REFERENCE_SHA256 = 'fcc6f6855fef465fbcbe780009fa083867ae8abd7814dfc47cb6ab3ddca7ce90';
const REFERENCE_DESC = '当 vendored 的 lib/geometry.mjs（1430 行，archify v2.17.0-dev.1）';

function resolveReference() {
  const p = process.env.ARCHSVG_GEOMETRY_REFERENCE;
  if (!p) {
    console.error([
      '✗ 拒绝运行：本脚本已退役，输出即 parity 判据，不能用当前实现覆盖。',
      '',
      `  它只应在「${REFERENCE_DESC} 还在、需要重新捕获基线」时运行。`,
      '  如需重放，请显式提供参考实现并确认其哈希：',
      '',
      `    ARCHSVG_GEOMETRY_REFERENCE=<path> node tests/tools/capture-geometry-golden.mjs`,
      '',
      `  参考实现的 sha256 必须等于 ${REFERENCE_SHA256}`,
      `  （可从 git 历史取：git show <vendored-commit>:lib/geometry.mjs）`,
      '',
      '  另：本脚本的 import 目标已改为 lib/geometry.mjs（自研实现），',
      '  仅当 ARCHSVG_GEOMETRY_REFERENCE 指向的文件内容与其哈希匹配时才继续。',
    ].join('\n'));
    process.exit(2);
  }
  const abs = path.resolve(p);
  let src;
  try { src = readFileSync(abs, 'utf8'); } catch (e) {
    console.error(`✗ 无法读取参考实现：${abs}（${e.message}）`);
    process.exit(2);
  }
  const sha = createHash('sha256').update(Buffer.from(src, 'utf8')).digest('hex');
  if (sha !== REFERENCE_SHA256) {
    console.error([
      `✗ 拒绝运行：参考实现哈希不匹配，说明它**不是**捕获基线时用的那个版本。`,
      `    给定文件：${abs}`,
      `    实际 sha256：${sha}`,
      `    期望 sha256：${REFERENCE_SHA256}`,
      '',
      '  用别的实现重放会把基线换成它的输出 —— 那正是本闸门要拦住的事。',
    ].join('\n'));
    process.exit(2);
  }
  return abs;
}

const REFERENCE_PATH = resolveReference();
const geometry = await import(new URL(`file://${REFERENCE_PATH}`).href);
console.log(`参考实现已校验：${REFERENCE_PATH}`);

import {
  encodeValue, decodeValue,
  NUM_MARK, UNDEFINED_MARK, FN_MARK, SYMBOL_MARK, BIGINT_MARK,
  DATE_MARK, MAP_MARK, SET_MARK, CIRCULAR_MARK, OBJECT_MARK,
} from './geometry-codec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, '..', 'fixtures', 'geometry-corpus.json');
const GOLDEN = path.join(HERE, '..', 'fixtures', 'geometry-golden.json');

const MARK_LABELS = [
  NUM_MARK, UNDEFINED_MARK, FN_MARK, SYMBOL_MARK, BIGINT_MARK,
  DATE_MARK, MAP_MARK, SET_MARK, CIRCULAR_MARK, OBJECT_MARK,
];

function countMarks(node, counts) {
  if (Array.isArray(node)) {
    for (const item of node) countMarks(item, counts);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (MARK_LABELS.includes(key)) counts.set(key, (counts.get(key) || 0) + 1);
    countMarks(node[key], counts);
  }
}

function main() {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const entries = [];
  const errors = [];
  const missingFns = new Set();
  const markCounts = new Map();

  for (const entry of corpus.entries) {
    const fn = geometry[entry.fn];
    if (typeof fn !== 'function') {
      missingFns.add(entry.fn);
      entries.push({ id: entry.id, site: entry.site, fn: entry.fn, args: entry.args, result: null, error: { name: 'MissingExport', message: `lib/geometry.mjs 未导出 ${entry.fn}` } });
      continue;
    }
    const args = decodeValue(entry.args);
    let result;
    let error = null;
    try {
      result = encodeValue(fn(...args));
    } catch (e) {
      result = null;
      error = { name: e.name, message: e.message };
    }
    if (error) errors.push({ id: entry.id, fn: entry.fn, ...error });
    else countMarks(result, markCounts);
    const record = { id: entry.id, site: entry.site, fn: entry.fn, args: entry.args, result };
    if (error) record.error = error;
    entries.push(record);
  }

  const payload = {
    schemaVersion: 1,
    note: '由 tests/tools/capture-geometry-golden.mjs 在 vendored geometry 还在时捕获；重写后本文件是唯一判据，不可用新实现重生成。',
    implementation: 'lib/geometry.mjs（vendored archify，捕获时的实现）',
    entries,
  };
  // 生成物用紧凑序列化：2 空格缩进会让深层嵌套的坐标数组膨胀一倍以上（1.68MB → 0.71MB）。
  writeFileSync(GOLDEN, `${JSON.stringify(payload)}\n`, 'utf8');

  const bytes = statSync(GOLDEN).size;
  console.log(`已写出 ${GOLDEN}`);
  console.log(`golden ${entries.length} 条，体量 ${(bytes / 1024).toFixed(1)} KB`);
  if (missingFns.size) console.log(`⚠️ 缺失导出：${[...missingFns].join(', ')}`);
  if (errors.length) {
    console.log(`抛错条目 ${errors.length} 条（已如实记录 error.name / error.message）：`);
    for (const e of errors.slice(0, 12)) console.log(`  - ${e.id} ${e.fn} → ${e.name}: ${e.message}`);
    if (errors.length > 12) console.log(`  ... 其余 ${errors.length - 12} 条见 golden 文件`);
  } else {
    console.log('无抛错条目');
  }
  if (markCounts.size) {
    console.log(`不可直接 JSON 表达的标记（编码后如实保留）：${[...markCounts.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  } else {
    console.log('结果中未出现 NaN/Infinity/undefined/function 等标记');
  }
}

main();
