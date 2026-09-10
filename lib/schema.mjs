// IR 校验器：手写 JSON Schema 子集校验器（零依赖，仅用 import.meta.url 解析 schema 路径）。
//
// 支持的关键字：
//   type / required / enum / pattern / minimum / maximum /
//   minLength / maxLength / minItems / maxItems /
//   additionalProperties / properties / items / $ref（相对引用）/ $defs
//
// 所有 schema 文件位于本模块同级的 ./schemas/ 目录，运行时按 ir.type 选取类型 schema，
// 并通过相对 $ref 拉取 common.schema.json 的 $defs。路径一律用 import.meta.url 解析,
// 因此无论从哪个 cwd 调用都能正确定位 schema 文件。

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEMA_TYPES = new Set(['architecture', 'flow', 'sequence']);

// 已加载的 schema 文档缓存（按 URL.href 索引），避免重复读盘。
const schemaDocCache = new Map();

function loadSchemaDoc(urlStr) {
  if (schemaDocCache.has(urlStr)) return schemaDocCache.get(urlStr);
  const text = readFileSync(fileURLToPath(urlStr), 'utf8');
  const doc = JSON.parse(text);
  schemaDocCache.set(urlStr, doc);
  return doc;
}

// 解析 $ref（形如 "common.schema.json#/$defs/role"）。相对路径以当前 schema 文档 URL 为基准。
function resolveRef(ref, baseUrlStr) {
  const hashIndex = ref.indexOf('#');
  const pathPart = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
  const fragPart = hashIndex >= 0 ? ref.slice(hashIndex + 1) : '';
  const docUrlStr = pathPart ? new URL(pathPart, baseUrlStr).href : baseUrlStr;
  const doc = loadSchemaDoc(docUrlStr);
  let sub = doc;
  if (fragPart) {
    // JSON Pointer：去掉首部 '/'，按 '/' 分段，处理 ~1->'/'、~0->'~' 转义。
    const pointer = fragPart.replace(/^\//, '');
    if (pointer.length) {
      for (const raw of pointer.split('/')) {
        const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (sub == null || typeof sub !== 'object') { sub = undefined; break; }
        sub = sub[key];
      }
    }
  }
  return { schema: sub, baseUrl: docUrlStr };
}

// ---- 诊断构造 ----

function makeDiagnostic({ code, severity, message, subject, evidence, supportedFixes }) {
  return {
    code,
    severity: severity === 'warning' ? 'warning' : 'error',
    message,
    subject: subject || {},
    evidence: evidence || {},
    supportedFixes: Array.isArray(supportedFixes) ? supportedFixes : [],
  };
}

// 拼接 subject：JSON pointer 路径 + 最近的 id/label（便于模型定点修复）。
function buildSubject(pointer, nearest) {
  const subject = { pointer };
  if (nearest && nearest.id !== undefined) subject.id = nearest.id;
  if (nearest && nearest.label !== undefined) subject.label = nearest.label;
  return subject;
}

// 在实例中向下传递的「最近可定位标识」（含 id/label 的对象）。
function descendNearest(value, nearest) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.id !== undefined || value.label !== undefined) {
      return { id: value.id, label: value.label };
    }
  }
  return nearest;
}

// ---- 类型判定 ----

function typeMatches(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ---- 核心递归 ----

function validateValue(value, schema, baseUrlStr, pointer, nearest, diags) {
  if (!schema || typeof schema !== 'object') return;

  // $ref 优先：解析后继续校验（JSON Schema 语义下 $ref 同级关键字被忽略）。
  if (schema.$ref) {
    const { schema: sub, baseUrl: subBase } = resolveRef(schema.$ref, baseUrlStr);
    if (sub === undefined) {
      diags.push(makeDiagnostic({
        code: 'schema/ref',
        severity: 'error',
        message: `无法解析 \$ref: ${schema.$ref}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: '$ref', ref: schema.$ref },
        supportedFixes: ['检查 schema 文件中的 $ref 路径与 $defs 定义是否存在'],
      }));
      return;
    }
    validateValue(value, sub, subBase, pointer, nearest, diags);
    return;
  }

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      diags.push(makeDiagnostic({
        code: 'schema/type',
        severity: 'error',
        message: `字段类型不符：期望 ${types.join('|')}，实际 ${describeValue(value)}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'type', expected: types, actual: describeValue(value) },
        supportedFixes: [`将值改为 ${types.join(' 或 ')} 类型`],
      }));
      return; // 类型不符时不再向下校验，避免误报级联。
    }
  }

  // enum
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      diags.push(makeDiagnostic({
        code: 'schema/enum',
        severity: 'error',
        message: `取值不在允许集合内：${JSON.stringify(value)}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'enum', expected: schema.enum, actual: value },
        supportedFixes: [`取值改为以下之一：${schema.enum.join(', ')}`],
      }));
    }
  }

  // 字符串约束
  if (typeof value === 'string') {
    if (schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        diags.push(makeDiagnostic({
          code: 'schema/pattern',
          severity: 'error',
          message: `字符串不匹配模式 ${schema.pattern}：「${value}」`,
          subject: buildSubject(pointer, nearest),
          evidence: { keyword: 'pattern', expected: schema.pattern, actual: value },
          supportedFixes: [`使字符串满足正则 ${schema.pattern}`],
        }));
      }
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      diags.push(makeDiagnostic({
        code: 'schema/minLength',
        severity: 'error',
        message: `字符串长度 ${value.length} 小于最小值 ${schema.minLength}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'minLength', expected: schema.minLength, actual: value.length },
        supportedFixes: [`字符串长度至少 ${schema.minLength}`],
      }));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      diags.push(makeDiagnostic({
        code: 'schema/maxLength',
        severity: 'error',
        message: `字符串长度 ${value.length} 大于最大值 ${schema.maxLength}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'maxLength', expected: schema.maxLength, actual: value.length },
        supportedFixes: [`字符串长度至多 ${schema.maxLength}`],
      }));
    }
  }

  // 数值约束
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      diags.push(makeDiagnostic({
        code: 'schema/minimum',
        severity: 'error',
        message: `数值 ${value} 小于最小值 ${schema.minimum}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'minimum', expected: schema.minimum, actual: value },
        supportedFixes: [`数值不小于 ${schema.minimum}`],
      }));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      diags.push(makeDiagnostic({
        code: 'schema/maximum',
        severity: 'error',
        message: `数值 ${value} 大于最大值 ${schema.maximum}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'maximum', expected: schema.maximum, actual: value },
        supportedFixes: [`数值不大于 ${schema.maximum}`],
      }));
    }
  }

  // 对象约束
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // required
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          diags.push(makeDiagnostic({
            code: 'schema/required',
            severity: 'error',
            message: `缺少必填字段「${key}」`,
            subject: buildSubject(pointer || '/', nearest),
            evidence: { keyword: 'required', expected: key, actual: 'missing' },
            supportedFixes: [`补充必填字段「${key}」`],
          }));
        }
      }
    }
    // properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          const childPointer = `${pointer}/${key}`;
          const childNearest = descendNearest(value[key], nearest);
          validateValue(value[key], propSchema, baseUrlStr, childPointer, childNearest, diags);
        }
      }
    }
    // additionalProperties
    if (schema.additionalProperties === false) {
      const allowed = schema.properties ? Object.keys(schema.properties) : [];
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          diags.push(makeDiagnostic({
            code: 'schema/additionalProperties',
            severity: 'error',
            message: `存在未定义的字段「${key}」`,
            subject: buildSubject(`${pointer}/${key}`, nearest),
            evidence: { keyword: 'additionalProperties', unexpectedKey: key, allowed },
            supportedFixes: [`移除字段「${key}」，或将其加入 schema 的 properties`],
          }));
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const allowed = schema.properties ? Object.keys(schema.properties) : [];
      for (const [key, val] of Object.entries(value)) {
        if (!allowed.includes(key)) {
          validateValue(val, schema.additionalProperties, baseUrlStr, `${pointer}/${key}`, descendNearest(val, nearest), diags);
        }
      }
    }
  }

  // 数组约束
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      diags.push(makeDiagnostic({
        code: 'schema/minItems',
        severity: 'error',
        message: `数组长度 ${value.length} 小于最小值 ${schema.minItems}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'minItems', expected: schema.minItems, actual: value.length },
        supportedFixes: [`数组至少含 ${schema.minItems} 项`],
      }));
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      diags.push(makeDiagnostic({
        code: 'schema/maxItems',
        severity: 'error',
        message: `数组长度 ${value.length} 大于最大值 ${schema.maxItems}`,
        subject: buildSubject(pointer, nearest),
        evidence: { keyword: 'maxItems', expected: schema.maxItems, actual: value.length },
        supportedFixes: [`数组至多含 ${schema.maxItems} 项`],
      }));
    }
    if (schema.items) {
      value.forEach((item, idx) => {
        const childPointer = `${pointer}/${idx}`;
        validateValue(item, schema.items, baseUrlStr, childPointer, descendNearest(item, nearest), diags);
      });
    }
  }
}

// ---- 入口 ----

export function validateSchema(ir) {
  const diags = [];

  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) {
    return {
      ok: false,
      diagnostics: [makeDiagnostic({
        code: 'schema/root',
        severity: 'error',
        message: 'IR 必须是非空对象',
        subject: { pointer: '/' },
        evidence: { actual: describeValue(ir) },
        supportedFixes: ['提供顶层为对象的 JSON IR'],
      })],
    };
  }

  const type = ir.type;
  if (!SCHEMA_TYPES.has(type)) {
    diags.push(makeDiagnostic({
      code: 'schema/type',
      severity: 'error',
      message: `ir.type 必须是 architecture | flow | sequence，实际为 ${JSON.stringify(type)}`,
      subject: buildSubject('/type', { id: ir.id, label: ir?.meta?.title }),
      evidence: { keyword: 'type', expected: [...SCHEMA_TYPES], actual: type },
      supportedFixes: ['将 ir.type 改为 architecture、flow 或 sequence'],
    }));
    return { ok: false, diagnostics: diags };
  }

  const schemaUrl = new URL(`../schemas/${type}.schema.json`, import.meta.url);
  const baseUrlStr = schemaUrl.href;
  const doc = loadSchemaDoc(baseUrlStr); // 类型 schema 文档

  validateValue(ir, doc, baseUrlStr, '', { id: ir.id, label: ir?.meta?.title }, diags);

  return diags.length === 0 ? { ok: true } : { ok: false, diagnostics: diags };
}

// 便于其它模块复用（例如 doctor 自检 schema 文件本身是否合法 JSON）。
export const schemaDirectoryUrl = pathToFileURL(new URL('../schemas/', import.meta.url).pathname).href;
