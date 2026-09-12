// 文字度量测试：系数表、估算器、折行。
//
// 标定底数据来自 headless Chromium 实测（见同目录 calibrate-text-metrics.tool.mjs），
// 本文件把「实测结果」固化成**不需要浏览器**的回归断言 —— 改系数必过此关。
//
// 注意：底数据在 macOS + system-ui（SF Pro）上采集。其它平台系统字体不同，
// 故容差取 ±15%（足以抓住把 cjk 系数改成 0.5 这类真错误，又不至于跨平台误报）。

import {
  CHAR_RATIO, charClass, estimateTextWidth, isWideChar, maxLineWidth,
  wrapText, wrapTextDetailed,
} from '../lib/text-metrics.mjs';

// 实测样本：[文案, 字号, 实测像素宽]（headless Chromium getComputedTextLength）。
const FIXTURE = [
  ['Milvus 向量检索', 16, 117.7],
  ['QualityGate 质量门禁', 16, 159.1],
  ['PROMOTION 促销规则', 16, 166.2],
  ['50 个 SKU · 锚点', 12, 92.2],
  ['APPLIES_TO · scope=SKU', 12, 147.5],
  ['发布 → 消费（异步解耦）', 12, 136.8],
  ['控制', 12, 23.8],
];

const FIXTURE_TOLERANCE = 0.15;

export const cases = [
  {
    name: 'CHAR_RATIO 覆盖全部类别且取值合理',
    run() {
      const need = ['cjk', 'digit', 'upper', 'lower', 'punct', 'space', 'other'];
      for (const k of need) {
        if (typeof CHAR_RATIO[k] !== 'number') throw new Error(`CHAR_RATIO 缺少类别 ${k}`);
        if (CHAR_RATIO[k] < 0.15 || CHAR_RATIO[k] > 1.1) {
          throw new Error(`CHAR_RATIO.${k} = ${CHAR_RATIO[k]} 超出合理区间 [0.15, 1.1]`);
        }
      }
      if (CHAR_RATIO.cjk < 0.9) throw new Error('cjk 系数必须接近 1（全宽字符）');
      if (CHAR_RATIO.cjk / CHAR_RATIO.lower > 2.5) throw new Error('cjk 与 lower 的宽度比失真');
      return `${Object.keys(CHAR_RATIO).length} 类系数齐备`;
    },
  },
  {
    name: 'charClass / isWideChar 分类正确',
    run() {
      const expect = [
        ['数', 'cjk'], ['，', 'cjk'], ['「', 'cjk'], ['（', 'cjk'],
        ['0', 'digit'], ['9', 'digit'],
        ['A', 'upper'], ['Z', 'upper'],
        ['a', 'lower'], ['z', 'lower'],
        [' ', 'space'],
        ['.', 'punct'], ['/', 'punct'], ['(', 'punct'],
      ];
      for (const [ch, cls] of expect) {
        const got = charClass(ch.codePointAt(0));
        if (got !== cls) throw new Error(`charClass('${ch}') = ${got}，期望 ${cls}`);
      }
      if (!isWideChar('，'.codePointAt(0))) throw new Error('中文逗号应判为全宽');
      if (isWideChar('a'.codePointAt(0))) throw new Error('拉丁字母不应判为全宽');
      return `${expect.length} 个字符分类正确`;
    },
  },
  {
    name: 'estimateTextWidth 基本性质',
    run() {
      if (estimateTextWidth('', 16) !== 0) throw new Error('空串宽度应为 0');
      if (estimateTextWidth(null, 16) !== 0) throw new Error('null 宽度应为 0');
      const a = estimateTextWidth('测试', 12);
      const b = estimateTextWidth('测试', 24);
      if (!(b > a)) throw new Error('宽度应随字号单调递增');
      if (Math.abs(b / a - 2) > 0.001) throw new Error('宽度应与字号成正比');
      const cjk1 = estimateTextWidth('测', 16);
      if (Math.abs(cjk1 - 16 * CHAR_RATIO.cjk) > 0.001) throw new Error('单字宽度应等于系数 × 字号');
      if (maxLineWidth(['a', 'abcd', 'ab'], 16) !== estimateTextWidth('abcd', 16)) {
        throw new Error('maxLineWidth 应取最长行');
      }
      return '单调性 / 比例性 / maxLineWidth 均正确';
    },
  },
  {
    name: '估算器 vs 实测底数据（容差 15%）',
    run() {
      const bad = [];
      for (const [text, px, actual] of FIXTURE) {
        const est = estimateTextWidth(text, px);
        const err = Math.abs(est - actual) / actual;
        if (err > FIXTURE_TOLERANCE) {
          bad.push(`「${text}」估算 ${est.toFixed(1)} vs 实测 ${actual}（误差 ${(err * 100).toFixed(1)}%）`);
        }
      }
      if (bad.length) throw new Error(bad.join('；'));
      return `${FIXTURE.length} 个实测样本均在 ±${FIXTURE_TOLERANCE * 100}% 内`;
    },
  },
  {
    name: 'wrapText 不产生超宽行，且截断标记正确',
    run() {
      const px = 16;
      const maxW = 212;
      const corpus = [
        'Product 商品',
        'Milvus 向量检索服务',
        '一个非常非常非常长的中文节点标题用来触发截断行为',
        'SupercalifragilisticexpialidociousTokenThatCannotBeSplit',
        'v4-shared-5-8/eval/METRICS.md',
        '短',
      ];
      for (const text of corpus) {
        const { lines, truncated } = wrapTextDetailed(text, px, maxW, 2);
        if (lines.length < 1 || lines.length > 2) throw new Error(`「${text}」行数 ${lines.length} 越界`);
        for (const l of lines) {
          const w = estimateTextWidth(l, px);
          if (w > maxW + 0.001) throw new Error(`「${text}」产生超宽行「${l}」(${w.toFixed(1)} > ${maxW})`);
        }
        const joined = lines.join('');
        if (!truncated && !joined.includes('…')) {
          // 未截断时，除了被去掉的空格外应与原文可还原
          const norm = (s) => s.replace(/\s/g, '');
          if (!norm(joined).startsWith(norm(text).slice(0, Math.max(1, norm(joined).length - 1)))) {
            throw new Error(`「${text}」未截断却发生了内容丢失`);
          }
        }
        if (truncated && !lines[lines.length - 1].endsWith('…')) {
          throw new Error(`「${text}」标记为截断但末行没有省略号`);
        }
      }
      // 兼容旧签名
      const plain = wrapText('Product 商品', px, maxW, 2);
      if (!Array.isArray(plain) || plain.length !== 1) throw new Error('wrapText 兼容签名失效');
      return `${corpus.length} 条语料折行合法`;
    },
  },
];
