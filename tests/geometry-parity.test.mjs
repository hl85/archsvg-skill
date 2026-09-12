// 几何差分 parity 测试：把「被测实现」的输出与 geometry-golden.json 冻结的**旧行为基线**
// 逐条比对。这是净室重写 lib/geometry.mjs 的前置安全网 —— 没有它，重写就是拿
// 8 项构图检查（node_overlap / relationship_crossings / label_route_clearance /
// orthogonal_arrows / relationship_corridors / container_border_runs / route_rhythm /
// legend_clearance）与布局期标签放置的正确性去赌。
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { encodeValue, decodeValue, diffEncoded, formatDiffs } from './tools/geometry-codec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// =====================================================================
// ★ 净室重写时只需要改下面这一行的 import 目标。
//   保留默认值（lib/geometry.mjs）即为「重写前先跑一遍、确认基线全绿」；
//   改成新模块路径（例如 '../lib/geometry-clean.mjs'）即为「重写后验证行为一致」。
// =====================================================================
import * as geometryDefault from '../lib/geometry.mjs';

// 可证伪性验证用的覆盖开关（见 tests/README-geometry-parity.md）：
//   ARCHSVG_GEOMETRY_IMPL=./tools/geometry-broken.mjs node bin/archsvg.mjs test
// 默认（不设置）时走上面那一行的常量。
const IMPL_OVERRIDE = process.env.ARCHSVG_GEOMETRY_IMPL || null;
const geometry = IMPL_OVERRIDE
  ? await import(new URL(IMPL_OVERRIDE, import.meta.url).href)
  : geometryDefault;
const CORPUS_PATH = path.join(HERE, 'fixtures', 'geometry-corpus.json');
const GOLDEN_PATH = path.join(HERE, 'fixtures', 'geometry-golden.json');

const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

// 必须被覆盖的 8 个实际入口（isFinitePoint 是空转 import，也一并冻结）。
export const COVERED_FNS = [
  'collectLabelRouteClearance',
  'rectsOverlap',
  'segmentIntersectsRect',
  'routeHonorsEndpointSides',
  'collectAmbiguousCorridors',
  'collectBorderRuns',
  'collectRouteRhythmIssues',
  'isFinitePoint',
];

const MAX_REPORTED = 5;

function head(entry) {
  return `id=${entry.id}｜site=${entry.site}｜fn=${entry.fn}`;
}

// 调用被测实现一次，返回 { value } 或 { error }。
function invoke(entry) {
  const fn = geometry[entry.fn];
  if (typeof fn !== 'function') {
    return { missing: true, error: { name: 'MissingExport', message: `被测实现未导出 ${entry.fn}` } };
  }
  const args = decodeValue(entry.args);
  try {
    return { value: encodeValue(fn(...args)) };
  } catch (e) {
    return { error: { name: e.name, message: e.message } };
  }
}

// 逐条比对；filter 选定参与比对的语料子集。
function compareAll(filter, label) {
  const list = golden.entries.filter(filter);
  const failures = [];
  for (const entry of list) {
    const actual = invoke(entry);

    // 基线：调用抛错 → 只比对错误类型（message 含实现细节，跨实现不保证措辞一致）。
    if (entry.error) {
      if (actual.missing) {
        failures.push(`${head(entry)}\n    被测实现缺少该导出：${actual.error.message}`);
      } else if (!actual.error) {
        failures.push(`${head(entry)}\n    基线抛 ${entry.error.name}，实际未抛错（返回 ${JSON.stringify(actual.value)?.slice(0, 160)}）`);
      } else if (actual.error.name !== entry.error.name) {
        failures.push(`${head(entry)}\n    基线抛 ${entry.error.name}，实际抛 ${actual.error.name}: ${actual.error.message}`);
      }
      continue;
    }

    if (actual.error) {
      failures.push(`${head(entry)}\n    基线正常返回，实际抛错 ${actual.error.name}: ${actual.error.message}`);
      continue;
    }

    const diffs = diffEncoded(entry.result, actual.value);
    if (diffs.length) {
      failures.push(`${head(entry)}\n${formatDiffs(diffs)}`);
    }
  }

  if (failures.length) {
    const shown = failures.slice(0, MAX_REPORTED).join('\n  ');
    const more = failures.length > MAX_REPORTED ? `\n  ...（另有 ${failures.length - MAX_REPORTED} 条不一致，未展开）` : '';
    throw new Error(
      `${label}：${failures.length}/${list.length} 条与基线不一致（浮点容差 1e-9）\n  ${shown}${more}`
    );
  }
  return `${label}：${list.length} 条全部一致（浮点相对容差 1e-9）`;
}

export const cases = [
  {
    name: '自检：语料与 golden 同源、8 个入口均有覆盖、无重复 id',
    run() {
      if (!Array.isArray(golden.entries) || golden.entries.length === 0) {
        throw new Error('geometry-golden.json 为空 —— 请先跑 build-geometry-corpus.mjs + capture-geometry-golden.mjs');
      }
      if (golden.entries.length !== corpus.entries.length) {
        throw new Error(`golden(${golden.entries.length}) 与语料(${corpus.entries.length}) 条数不一致；两者应成对生成`);
      }
      const goldenIds = new Set(golden.entries.map((e) => e.id));
      const corpusIds = new Set(corpus.entries.map((e) => e.id));
      const missing = [...corpusIds].filter((id) => !goldenIds.has(id));
      const extra = [...goldenIds].filter((id) => !corpusIds.has(id));
      if (missing.length || extra.length) {
        throw new Error(`语料与 golden 的 id 集合不一致：缺 ${missing.slice(0, 3).join(',')}；多 ${extra.slice(0, 3).join(',')}`);
      }
      if (corpusIds.size !== corpus.entries.length) throw new Error('语料存在重复 id，id 不再能定位条目');
      const covered = new Set(golden.entries.map((e) => e.fn));
      const uncovered = COVERED_FNS.filter((fn) => !covered.has(fn));
      if (uncovered.length) throw new Error(`以下入口未入语料：${uncovered.join(', ')}`);
      const syntheticCount = golden.entries.filter((e) => e.site === 'synthetic').length;
      if (syntheticCount === 0) throw new Error('语料里没有任何合成边界条目 —— 真实数据不可能覆盖边界');
      return `语料/golden 各 ${golden.entries.length} 条（合成边界 ${syntheticCount} 条），8 个入口齐备，id 唯一`;
    },
  },
  {
    name: '真实数据语料与基线一致',
    run() {
      return compareAll((e) => e.site !== 'synthetic', '真实数据语料');
    },
  },
  {
    name: '合成边界语料与基线一致',
    run() {
      return compareAll((e) => e.site === 'synthetic', '合成边界语料');
    },
  },
];
