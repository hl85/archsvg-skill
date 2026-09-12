// 文字度量：字符宽度系数表、宽度估算、折行。
//
// **单点定义** —— layout / render / checks 三处必须复用本模块，禁止各自复刻一份系数。
// 历史缺陷（本模块的由来）：render.mjs 曾自持一份与 layout 重复的系数函数，且按 11px 估算
// 边标签背景遮罩宽，而 layout / checks 按 12px 估算标签矩形 —— 遮罩比文字窄约 8%，
// 连线从文字两端透出。两份实现 + 两个字号，任何检查项都查不出来。
//
// 系数来源：headless Chromium 实测，口径见 `tests/calibrate-text-metrics.mjs`。
//   - 取样：system-ui 字体族，按 archsvg 实际字号/字重（16/700、12/400、13/700、24/700）逐类测量；
//   - 结果：7 个真实文案样本上，本表的**最大绝对误差 4.8%**，旧的「CJK 1.0 / 其余 0.55」为 10.6%；
//   - 负结果：实测显示再叠加「字重放大系数（700/400）」会把混合文本误差放大到 9.4%，
//     故**不引入字重项** —— 分类系数已吸收字重的平均效应。此事已测，勿重复尝试。
//
// 已知边界：系数随字号有轻微漂移（CJK 在 24px 实测 0.952，在 12–16px 为 0.993），
// 本表取常用字号区间的均值；标题为居中绘制、不参与盒宽推导，故该漂移不影响布局。

// 字符宽度系数（em）。括号内为实测区间。
export const CHAR_RATIO = {
  cjk: 0.99,    // CJK 表意文字 + 全角标点（0.952–0.993）
  digit: 0.62,  // 0-9（0.586–0.651）
  upper: 0.68,  // A-Z（0.656–0.710）
  lower: 0.54,  // a-z（0.510–0.573）
  punct: 0.44,  // ASCII 标点（0.387–0.473）
  space: 0.26,  // 空格（0.211–0.281，用差量法实测）
  other: 0.55,  // 其它：拉丁扩展、未知符号（沿用实测前的经验值）
};

// 该码点是否按「全宽字符」计。含 CJK 扩展 A、兼容表意、全角形式、CJK 标点，
// 以及 emoji / 杂项符号（宽字形，宁可高估不可低估）。
export function isWideChar(code) {
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}

// 兼容旧名（layout.mjs 曾导出 isCjkChar）。
export const isCjkChar = isWideChar;

// 码点 → 系数类别。
export function charClass(code) {
  if (isWideChar(code)) return 'cjk';
  if (code === 0x20) return 'space';
  if (code >= 0x30 && code <= 0x39) return 'digit';
  if (code >= 0x41 && code <= 0x5a) return 'upper';
  if (code >= 0x61 && code <= 0x7a) return 'lower';
  if (code >= 0x21 && code <= 0x7e) return 'punct';
  return 'other';
}

// 估算文字宽度（像素）。逐码点按类别累加系数 × 字号。
export function estimateTextWidth(text, px) {
  if (!text) return 0;
  let w = 0;
  for (const ch of String(text)) w += px * CHAR_RATIO[charClass(ch.codePointAt(0))];
  return w;
}

// 一组文本行的最宽值（排版前推盒宽用）。
export function maxLineWidth(lines, px) {
  let m = 0;
  for (const l of lines || []) m = Math.max(m, estimateTextWidth(l, px));
  return m;
}

// 文本折行：超长文本按「估算宽度」拆成多行——**尽量填满容器宽度**（贪心折到 maxW，不提前折，
// 否则会多占一行高度）。CJK 逐字可断；拉丁按空格断；单个超长 token 再逐字符硬断。
// 最多 maxLines 行（默认 2）；超出部分截断、末行以 … 结尾。
// 返回 { lines, truncated }：truncated=true 表示发生了信息截断（调用方须显式处置）。
export function wrapTextDetailed(text, px, maxW, maxLines = 2) {
  const s = String(text || '');
  if (!s) return { lines: [''], truncated: false };
  if (estimateTextWidth(s, px) <= maxW) return { lines: [s], truncated: false };
  const tokens = [];
  let buf = '';
  for (const ch of s) {
    if (isWideChar(ch.codePointAt(0))) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (ch === ' ') {
      buf += ch; tokens.push(buf); buf = '';
    } else buf += ch;
  }
  if (buf) tokens.push(buf);
  const lines = [];
  let cur = '';
  const flush = () => { if (cur !== '') lines.push(cur.trimEnd()); cur = ''; };
  for (const tok of tokens) {
    if (cur !== '' && estimateTextWidth(cur + tok, px) > maxW) flush();
    if (estimateTextWidth(tok, px) > maxW) {
      for (const ch of tok) {
        if (cur !== '' && estimateTextWidth(cur + ch, px) > maxW) flush();
        cur += ch;
      }
    } else {
      cur += tok;
    }
  }
  flush();
  const out = lines.length ? lines : [s];
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && estimateTextWidth(last + '…', px) > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '…';
    return { lines: kept, truncated: true };
  }
  return { lines: out, truncated: false };
}

// 兼容旧签名：只返回行数组。
export function wrapText(text, px, maxW, maxLines = 2) {
  return wrapTextDetailed(text, px, maxW, maxLines).lines;
}
