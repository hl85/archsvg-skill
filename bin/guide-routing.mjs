// archsvg 分型路由（`archsvg guide` 的判据），独立成模块以便测试直接引用。
//
// 为什么单独一个文件：CLI 入口 `bin/archsvg.mjs` 末尾有 top-level await 的 main()，
// 测试若静态 import 它会与 cmdTest 的动态 import 形成求值环 → 死锁。故把纯判据
// 拆到这里，`bin/archsvg.mjs` 只负责 IO/打印，测试只 import 本模块。
//
// 分型路由分两步，先负向后正向：
//   1) 负向回流表 REROUTE_RULES —— 命中即「建议不要用本管线」并给出替代方案。
//      这些场景不是「画得不好」，而是「本管线根本不该接」：字段清单、数据图表、
//      地理拓扑、环形结构，静态 SVG 结构图要么塞不下、要么画不准、要么很快过期。
//   2) 正向打分表 SCENE_KEYWORDS —— 各类型统计命中词数取最高分；并列即报歧义。
//      词表天然重叠（「请求」属 sequence、「架构」属 architecture），旧的「按固定
//      顺序先到先得」会让先声明的类型吃掉整句，故改为打分 + 显式歧义。

// ---- 正向：场景关键词 → 图类型（打分制）----
export const SCENE_KEYWORDS = {
  sequence: ['时序', '调用链', '链路', '请求', '生命周期', '交互'],
  flow: ['流程', '步骤', '管道', 'pipeline', '决策', '审批', '演进', '状态流转'],
  architecture: ['架构', '分层', '组件', '拓扑', '对比'],
};
// 并列最高分时的建议优先序（保持历史优先级：sequence → flow → architecture）。
const TYPE_ORDER = ['sequence', 'flow', 'architecture'];

// ---- 负向：回流表（命中即「别用本管线」）----
// 每条：keywords（判据）/ target（回流到）/ reason（为什么）/ alternative（怎么替代）。
export const REROUTE_RULES = [
  {
    id: 'database-er',
    keywords: ['数据库', '表结构', '表设计', '建表', '数据表', '实体关系', 'er', 'erd', 'er图', 'schema', '字段', '主键', '外键', 'ddl', '范式'],
    target: 'mermaid `erDiagram`',
    reason: '实体的字段清单在 SVG 盒子里塞不下，且表结构随需求频繁改动，静态图很快过期',
    alternative: '改用 mermaid `erDiagram`（或等价 ER 工具）承载实体与字段；只有要讲「谁读写谁」的数据流向时，才用 archsvg `flow` 另画一张',
  },
  {
    id: 'cyclic',
    keywords: ['循环', '闭环', '轮转', '环路', '环状', '回环', '周期性', '定时轮询', '心跳', '重试循环'],
    target: '分阶段线性 + 回边（archsvg `flow`）或交互式 stepper',
    reason: '环形布局可读性差、节点文字被压缩，弧形连线还极易穿越无关节点',
    alternative: '用 archsvg `flow` 把环拆成「阶段线性推进 + 一条回边」（回边由 Kahn 拓扑序识别、自动走左侧外侧通道）；若要逐帧演示推进过程，则交给交互式 stepper',
  },
  {
    id: 'geo-map',
    keywords: ['地图', '地理', '区域分布', '省份', '省域', '国家', '城市分布', '经纬度', '行政区', '全国分布'],
    target: '外部地图工具 + 真实拓扑数据',
    reason: '禁止手搓坐标：地理形状必须来自真实拓扑数据，手绘坐标既不准也不可维护',
    alternative: '用地图专用工具/组件（ECharts geo、AntV L7 等）并接入真实 GeoJSON 拓扑；archsvg 只负责与地理无关的结构图',
  },
  {
    id: 'data-chart',
    keywords: ['柱状图', '条形图', '折线', '折线图', '占比', '趋势', '饼图', '同比', '环比', '增长曲线', '散点', '面积图', '直方图', '图表'],
    target: '外部图表工具',
    reason: 'archsvg 是结构图工具、不是数据图表工具：没有坐标轴 / 刻度 / 数值映射能力',
    alternative: '用图表工具/组件（ECharts、Chart.js、Vega-Lite 等）画数据图；archsvg 只画结构关系',
  },
  {
    id: 'data-table',
    keywords: ['参数表', '参数清单', '字段清单', '清单', '表格', '二维表', '对照表', '配置项'],
    target: 'Markdown 表格',
    reason: '结构化数据优先用表格：字段多、需要逐行对照时，图里的小盒子远不如表格可读',
    alternative: '用 Markdown 表格（或表格组件）承载；只有当这些数据之间确实存在「结构关系」时，才回到 archsvg',
  },
];

// ---- 该类型的最小必读规则子集（提炼自 references/design-system.md 与 SKILL.md）----
// 只列「写第一版 IR 前必须知道」的 3–5 条，不重复文档全文；括号内为出处。
export const TYPE_RULES = {
  architecture: [
    '先定「域」再映射 role：一条图内同一语义只用一种 role（一域一色），分组框取该域主色（design-system §1）',
    '节点数 > 4 就分组，组内节点 ≤ 4，单图节点 ≤ 24；未分组节点会被塞进最后一条附加带（design-system §3 / SKILL.md 不变量 2）',
    '`meta.caption` 写成 `图 X-N · 图名（口径/用途）`，它会渲染成底部图注（design-system §2）',
    '节点 `label` 用「英文名 + 中文名」，`sublabel` 给规模/角色（≤ 18 字），边 `label` 带关系名不省（design-system §2）',
    '禁止在 IR 里手写坐标（`pos`/`x`/`y` 由 `lib/layout.mjs` 生成）（SKILL.md「明确禁止」）',
  ],
  flow: [
    '`node.kind` 必填且语义正确：`start`/`step`/`decision`/`terminal`；`decision` 必有 ≥2 出边并带「是/否」标签（diagram-spec §3.2）',
    '主干纵向单链、`decision` 分支向两侧展开；循环/重试要画成「线性 + 回边」，回边走左侧外侧通道（diagram-spec §4）',
    '演进路线用 `stages` + `node.stage` 表达时间/版本推进，不要用多个并列节点硬凑（diagram-spec §3.2 / §4）',
    '禁止在 IR 里手写坐标（diagram-spec §4 · SKILL.md「明确禁止」）',
    '`meta.caption` 写成 `图 X-N · 图名（口径/用途）`（design-system §2）',
  ],
  sequence: [
    '`messages[].kind` 用 `sync`/`async`/`return`/`self`；自调用回环用 `self`（diagram-spec §3.3）',
    '参与者等距横向排布、生命线由布局器生成；消息按出现顺序自上而下，调用方不写坐标（diagram-spec §4）',
    '消息 `label` 是语义数据（方法名 / 数据），不能为了排版删标签（SKILL.md 不变量 3）',
    '角色配色遵「域 → role」映射、一域一色，参与者 role 与其语义一致（design-system §1）',
    '`meta.caption` 写成 `图 X-N · 图名（口径/用途）`（design-system §2）',
  ],
};

// ---- 歧义时的「二选一判断依据」----
export const AMBIGUITY_HINT = {
  'architecture|flow': '追问主问题：关心「分了几层 / 谁依赖谁」→ architecture；关心「按什么顺序走、哪里分支」→ flow。两者常可各出一张。',
  'architecture|sequence': '追问主问题：关心「分了几层 / 边界在哪」→ architecture；关心「谁在什么顺序上和谁交互」→ sequence。',
  'flow|sequence': '追问主问题：关心「步骤/分支如何推进」→ flow；关心「参与者之间来回的时序」→ sequence。',
};
export const AMBIGUITY_HINT_DEFAULT = '看主问题落在哪：结构（分层/边界）=architecture、顺序（步骤/分支）=flow、交互（参与者时序）=sequence，选最贴近主问题的一种。';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CJK 关键词按子串匹配；纯 ASCII 关键词按「词边界」匹配，
// 否则 'er' 会命中 'server'、'erd' 会命中 'guard' 之类。
export function sceneHit(lowerScene, keyword) {
  const k = String(keyword).toLowerCase();
  if (/[^\x00-\x7f]/.test(k)) return lowerScene.includes(k);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`).test(lowerScene);
}

// 打分制：各类型统计命中词数，取最高分；并列返回 ambiguous。
export function recommendType(scene) {
  const lower = String(scene).toLowerCase();
  const scores = {};
  const matched = {};
  for (const t of TYPE_ORDER) {
    matched[t] = SCENE_KEYWORDS[t].filter((k) => sceneHit(lower, k));
    scores[t] = matched[t].length;
  }
  const max = Math.max(...TYPE_ORDER.map((t) => scores[t]));
  if (max === 0) {
    return {
      type: 'architecture', scores, matched, ambiguous: false, fallback: true,
      winners: ['architecture'],
    };
  }
  const winners = TYPE_ORDER.filter((t) => scores[t] === max);
  return {
    type: winners[0], scores, matched, ambiguous: winners.length > 1, fallback: false, winners,
  };
}

// 负向路由：返回命中的回流条目（best = 命中词最多的一条，并列取先声明者）。
export function rerouteFor(scene) {
  const lower = String(scene).toLowerCase();
  const hits = REROUTE_RULES
    .map((rule) => ({ rule, hits: rule.keywords.filter((k) => sceneHit(lower, k)) }))
    .filter((x) => x.hits.length > 0);
  if (!hits.length) return { rule: null, matched: [], hits: {} };
  hits.sort((a, b) => b.hits.length - a.hits.length);
  const best = hits[0].rule;
  const matched = hits.map((x) => x.rule);
  const hitMap = {};
  for (const x of hits) hitMap[x.rule.id] = x.hits;
  return { rule: best, matched, hits: hitMap };
}

// 并列类型的「二选一判断依据」：优先取精确配对，缺省给通用口径。
export function ambiguityHint(winners) {
  const key = [...winners].sort().join('|');
  return AMBIGUITY_HINT[key] || AMBIGUITY_HINT_DEFAULT;
}
