// 几何差分测试的「可稳定回读」编解码器 —— **单点定义**。
//
// 为什么需要它：JSON.stringify 会把 NaN / Infinity 静默写成 null、把对象里的 undefined
// 直接删掉、把函数删掉。语料里明确含 NaN / Infinity（见 build-geometry-corpus.mjs），
// 若不做显式标记，「基线」与「重写实现」两侧都会丢同样的信息，parity 就变成永远绿。
//
// 因此基准库（corpus / golden）统一用本文件的 encodeValue 写出、decodeValue 读回。
// 标记形状（刻意与任务书建议一致）：
//   NaN / Infinity / -Infinity → { "__num": "NaN" | "Infinity" | "-Infinity" }
//   undefined                  → { "__undefined": true }
//   function                   → { "__fn": "<name>" }
//   symbol / bigint / Date     → { "__symbol" | "__bigint" | "__date": "<文本>" }
//   Map / Set                  → { "__map": [[k,v],...] } / { "__set": [v,...] }
//   循环引用                   → { "__circular": true }（不可还原，如实记录）
//   非普通对象                 → { "__object": "<Ctor>", ...自身可枚举属性 }
//
// 只用 node 内置能力，零 npm 依赖。

export const NUM_MARK = '__num';
export const UNDEFINED_MARK = '__undefined';
export const FN_MARK = '__fn';
export const SYMBOL_MARK = '__symbol';
export const BIGINT_MARK = '__bigint';
export const DATE_MARK = '__date';
export const MAP_MARK = '__map';
export const SET_MARK = '__set';
export const CIRCULAR_MARK = '__circular';
export const OBJECT_MARK = '__object';

const MARKS = [
  NUM_MARK, UNDEFINED_MARK, FN_MARK, SYMBOL_MARK, BIGINT_MARK,
  DATE_MARK, MAP_MARK, SET_MARK, CIRCULAR_MARK, OBJECT_MARK,
];

function isEncodedSpecial(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.some((k) => MARKS.includes(k));
}

// 把任意运行时值转成 JSON 可无损（除循环引用外）表达的结构。
export function encodeValue(value, stack = new Set()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'number') {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return { [NUM_MARK]: 'NaN' };
    return { [NUM_MARK]: value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (type === 'undefined') return { [UNDEFINED_MARK]: true };
  if (type === 'boolean' || type === 'string') return value;
  if (type === 'bigint') return { [BIGINT_MARK]: value.toString() };
  if (type === 'symbol') return { [SYMBOL_MARK]: String(value.description ?? '') };
  if (type === 'function') return { [FN_MARK]: value.name || '(anonymous)' };

  // 以下都是对象；用调用栈检测循环引用。
  if (stack.has(value)) return { [CIRCULAR_MARK]: true };
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => encodeValue(item, stack));
    if (value instanceof Date) return { [DATE_MARK]: value.toISOString() };
    if (value instanceof Map) {
      return { [MAP_MARK]: [...value.entries()].map(([k, v]) => [encodeValue(k, stack), encodeValue(v, stack)]) };
    }
    if (value instanceof Set) {
      return { [SET_MARK]: [...value].map((item) => encodeValue(item, stack)) };
    }
    const encoded = {};
    for (const key of Object.keys(value)) encoded[key] = encodeValue(value[key], stack);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      encoded[OBJECT_MARK] = value.constructor?.name ?? '(unknown)';
    }
    return encoded;
  } finally {
    stack.delete(value);
  }
}

// encodeValue 的逆运算。仅用于还原**入参**（结果只做比较，不需要还原）。
export function decodeValue(value) {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value === null || typeof value !== 'object') return value;

  if (NUM_MARK in value) {
    if (value[NUM_MARK] === 'NaN') return NaN;
    return value[NUM_MARK] === 'Infinity' ? Infinity : -Infinity;
  }
  if (UNDEFINED_MARK in value) return undefined;
  if (FN_MARK in value) {
    const fn = function codecPlaceholder() {};
    return fn;
  }
  if (SYMBOL_MARK in value) return Symbol(value[SYMBOL_MARK]);
  if (BIGINT_MARK in value) return BigInt(value[BIGINT_MARK]);
  if (DATE_MARK in value) return new Date(value[DATE_MARK]);
  if (CIRCULAR_MARK in value) return '[circular]';
  if (MAP_MARK in value) return new Map(value[MAP_MARK].map(([k, v]) => [decodeValue(k), decodeValue(v)]));
  if (SET_MARK in value) return new Set(value[SET_MARK].map(decodeValue));

  const out = {};
  for (const key of Object.keys(value)) {
    if (key === OBJECT_MARK) continue;
    out[key] = decodeValue(value[key]);
  }
  return out;
}

// ---- 深度比较（带浮点相对容差）----
//
// 比较的是 encodeValue 之后的树：NaN 已变成标记对象，浮点则用相对容差 1e-9。
// 差异会被记成「路径 + 期望 + 实际」，便于直接把报错指到某个字段 / 数组下标 / 某条 id。

export const REL_TOLERANCE = 1e-9;

function numbersClose(a, b) {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= REL_TOLERANCE * scale;
}

function isPlainEncodedObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isEncodedSpecial(value);
}

// 返回差异数组；空数组表示一致。最多记录 maxDiffs 条，避免一条坏实现刷屏。
export function diffEncoded(expected, actual, path = '$', diffs = [], maxDiffs = 12) {
  if (diffs.length >= maxDiffs) return diffs;

  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!numbersClose(expected, actual)) {
      diffs.push({ path, expected, actual, kind: 'number' });
    }
    return diffs;
  }

  if (isEncodedSpecial(expected) || isEncodedSpecial(actual)) {
    if (!isEncodedSpecial(expected) || !isEncodedSpecial(actual)) {
      diffs.push({ path, expected, actual, kind: 'special-vs-plain' });
      return diffs;
    }
    const key = MARKS.find((k) => k in expected || k in actual);
    if (!(key in expected) || !(key in actual)) {
      diffs.push({ path, expected, actual, kind: 'special-kind' });
      return diffs;
    }
    const left = expected[key];
    const right = actual[key];
    const same = Array.isArray(left) && Array.isArray(right)
      ? JSON.stringify(left) === JSON.stringify(right)
      : left === right;
    if (!same) diffs.push({ path: `${path}.${key}`, expected: left, actual: right, kind: 'special-value' });
    return diffs;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      diffs.push({ path, expected, actual, kind: 'array-vs-plain' });
      return diffs;
    }
    if (expected.length !== actual.length) {
      diffs.push({ path: `${path}.length`, expected: expected.length, actual: actual.length, kind: 'length' });
      return diffs;
    }
    for (let i = 0; i < expected.length; i += 1) {
      diffEncoded(expected[i], actual[i], `${path}[${i}]`, diffs, maxDiffs);
      if (diffs.length >= maxDiffs) return diffs;
    }
    return diffs;
  }

  if (isPlainEncodedObject(expected) || isPlainEncodedObject(actual)) {
    if (!isPlainEncodedObject(expected) || !isPlainEncodedObject(actual)) {
      diffs.push({ path, expected, actual, kind: 'object-vs-plain' });
      return diffs;
    }
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    for (const key of expectedKeys) {
      if (!actualKeys.includes(key)) diffs.push({ path: `${path}.${key}`, expected: expected[key], actual: '(缺失)', kind: 'missing-key' });
    }
    for (const key of actualKeys) {
      if (!expectedKeys.includes(key)) diffs.push({ path: `${path}.${key}`, expected: '(缺失)', actual: actual[key], kind: 'extra-key' });
    }
    for (const key of expectedKeys) {
      if (!actualKeys.includes(key)) continue;
      diffEncoded(expected[key], actual[key], `${path}.${key}`, diffs, maxDiffs);
      if (diffs.length >= maxDiffs) return diffs;
    }
    return diffs;
  }

  if (expected !== actual) diffs.push({ path, expected, actual, kind: 'value' });
  return diffs;
}

// 把差异渲染成人类可读的多行文本（parity 测试的报错信息）。
export function formatDiffs(diffs) {
  return diffs.map((d) => `    ${d.path}（${d.kind}）：期望 ${short(d.expected)}，实际 ${short(d.actual)}`).join('\n');
}

function short(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
