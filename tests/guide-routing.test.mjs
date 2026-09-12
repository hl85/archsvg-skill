// 分型路由测试：把 `archsvg guide` 的判据固化成断言。
//
// 覆盖三类行为，每类失败时的表现都是「静默错推荐」——不会报错，只是把人带偏：
//   1) 负向回流：字段清单 / 数据图表 / 地理拓扑 / 环形结构本就不该硬塞进本管线；
//   2) 打分与歧义：词表重叠（「请求」属 sequence、「架构」属 architecture）必须并列报警，
//      不能像旧实现那样「按固定顺序先到先得」吞掉整句；
//   3) 正向推荐 + 该类型最小必读规则子集非空。
//
// 只在 bin/guide-routing.mjs 里断言「读实际导出值」，不复制词表/规则副本，故不可能互相包庇。

import {
  SCENE_KEYWORDS, REROUTE_RULES, TYPE_RULES, AMBIGUITY_HINT,
  recommendType, rerouteFor,
} from '../bin/guide-routing.mjs';

const TYPES = ['architecture', 'flow', 'sequence'];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 回流命中：断言「建议不要用本管线」所需四要素齐全，且指向正确的替代方案。
function assertReroute(scene, id, targetFragment) {
  const r = rerouteFor(scene);
  assert(r.rule, `「${scene}」应命中回流，实际未命中`);
  assert(r.rule.id === id, `「${scene}」应回流到 ${id}，实际 ${r.rule.id}`);
  assert(r.rule.target.includes(targetFragment),
    `「${scene}」替代方案应含「${targetFragment}」，实际「${r.rule.target}」`);
  assert(typeof r.rule.reason === 'string' && r.rule.reason.length > 0, '回流条目的理由不能为空');
  assert(typeof r.rule.alternative === 'string' && r.rule.alternative.length > 0,
    '回流条目必须给出替代方案（否则调用方无路可走）');
  return `${scene} → ${r.rule.target}`;
}

export const cases = [
  // ---------- C1 负向回流：5 个场景各一条 ----------
  {
    name: '回流：数据库表结构 ER → mermaid erDiagram',
    run() { return assertReroute('数据库表结构 ER', 'database-er', 'erDiagram'); },
  },
  {
    name: '回流：事件循环闭环 → 分阶段线性 + 回边',
    run() { return assertReroute('事件循环闭环', 'cyclic', '回边'); },
  },
  {
    name: '回流：各省份分布地图 → 外部地图工具 + 真实拓扑',
    run() { return assertReroute('各省份分布地图', 'geo-map', '地图工具'); },
  },
  {
    name: '回流：近四年营收柱状图 → 外部图表工具',
    run() { return assertReroute('近四年营收柱状图', 'data-chart', '图表工具'); },
  },
  {
    name: '回流：参数清单表格 → Markdown 表格',
    run() { return assertReroute('参数清单表格', 'data-table', 'Markdown'); },
  },
  {
    name: '回流表覆盖 ≥ 5 类场景，且每条都带替代方案',
    run() {
      assert(REROUTE_RULES.length >= 5, `回流表仅 ${REROUTE_RULES.length} 条，应 ≥ 5`);
      for (const r of REROUTE_RULES) {
        assert(r.keywords && r.keywords.length > 0, `回流条目 ${r.id} 缺判据关键词`);
        assert(r.target && r.alternative, `回流条目 ${r.id} 缺 target 或 alternative`);
      }
      return `${REROUTE_RULES.length} 条回流规则，判据/替代方案齐全`;
    },
  },
  {
    name: '回流不误伤：正常结构图场景 rule 必须为 null',
    run() {
      for (const s of ['微服务架构分层', '数据同步流程', 'OAuth 授权码时序']) {
        assert(rerouteFor(s).rule === null, `「${s}」是正常结构图，不应触发回流`);
      }
      return '3 个正常场景均未触发回流';
    },
  },

  // ---------- C2 打分 / 歧义 ----------
  {
    name: '打分：请求链路的架构分层 → 报歧义（architecture 与 sequence 并列）',
    run() {
      const r = recommendType('请求链路的架构分层');
      assert(r.ambiguous === true, '「请求链路的架构分层」应报歧义');
      assert(r.winners.includes('architecture') && r.winners.includes('sequence'),
        `并列类型应为 architecture + sequence，实际 ${r.winners.join('/')}`);
      assert(r.scores.architecture === r.scores.sequence, '并列双方分值必须相等');
      assert(r.matched.architecture.length > 0 && r.matched.sequence.length > 0,
        '歧义时必须给出各自命中的关键词');
      const key = [...r.winners].sort().join('|');
      assert(AMBIGUITY_HINT[key], `缺少 ${key} 的二选一判断依据`);
      return `${r.winners.join(' / ')} 并列 ${r.scores[r.winners[0]]} 分；依据已给出`;
    },
  },
  {
    name: '打分：纯「时序调用链」明确判 sequence 且无歧义',
    run() {
      const r = recommendType('纯时序调用链');
      assert(r.type === 'sequence', `应判 sequence，实际 ${r.type}`);
      assert(r.ambiguous === false, '不应报歧义');
      for (const t of ['flow', 'architecture']) {
        assert(r.scores[t] < r.scores.sequence, `${t} 不应追平 sequence`);
      }
      return `sequence ${r.scores.sequence} 分，其余 0 分，唯一判定`;
    },
  },
  {
    name: '打分：全不命中时兜底 architecture',
    run() {
      const r = recommendType('随便写点没有关键词的内容');
      assert(r.fallback === true && r.type === 'architecture', '未命中应兜底 architecture');
      assert(r.ambiguous === false, '兜底不应报歧义');
      return '兜底 architecture';
    },
  },

  // ---------- C3 正向推荐：架构 / 流程 / 时序各一条 ----------
  {
    name: '正向：微服务架构分层 → architecture',
    run() {
      const r = recommendType('微服务架构分层');
      assert(r.type === 'architecture' && !r.ambiguous, `应唯一判 architecture，实际 ${r.type}`);
      assert(r.matched.architecture.length >= 2, '应命中多个 architecture 关键词');
      return `architecture 命中 ${r.matched.architecture.join('、')}`;
    },
  },
  {
    name: '正向：数据同步流程 → flow',
    run() {
      const r = recommendType('数据同步流程');
      assert(r.type === 'flow' && !r.ambiguous, `应唯一判 flow，实际 ${r.type}`);
      return `flow 命中 ${r.matched.flow.join('、')}`;
    },
  },
  {
    name: '正向：OAuth 授权码时序 → sequence',
    run() {
      const r = recommendType('OAuth 授权码时序');
      assert(r.type === 'sequence' && !r.ambiguous, `应唯一判 sequence，实际 ${r.type}`);
      return `sequence 命中 ${r.matched.sequence.join('、')}`;
    },
  },

  // ---------- C3 最小必读规则子集 ----------
  {
    name: '规则子集：三种类型各 3–5 条，非空且不重复',
    run() {
      const detail = [];
      for (const t of TYPES) {
        const rules = TYPE_RULES[t];
        assert(Array.isArray(rules), `${t} 缺规则子集`);
        assert(rules.length >= 3 && rules.length <= 5, `${t} 规则应 3–5 条，实际 ${rules.length}`);
        assert(new Set(rules).size === rules.length, `${t} 规则存在重复`);
        detail.push(`${t} ${rules.length} 条`);
      }
      return detail.join('，');
    },
  },
  {
    name: '规则子集：architecture 必含「一域一色 / 禁手写坐标」，与文档一致',
    run() {
      const rules = TYPE_RULES.architecture.join('\n');
      assert(rules.includes('一域一色'), 'architecture 规则应含「一域一色」');
      assert(rules.includes('禁止') && rules.includes('坐标'), 'architecture 规则应含「禁止手写坐标」');
      assert(rules.includes('图 X-N'), 'architecture 规则应含 caption 口径');
      return 'architecture 规则关键条目齐全';
    },
  },
  {
    name: '词表自洽：三类型均有正向关键词，且都为非空字符串',
    run() {
      for (const t of TYPES) {
        assert(Array.isArray(SCENE_KEYWORDS[t]) && SCENE_KEYWORDS[t].length > 0, `${t} 缺正向关键词`);
        for (const k of SCENE_KEYWORDS[t]) {
          assert(typeof k === 'string' && k.trim().length > 0, `${t} 存在空关键词`);
        }
      }
      return TYPES.map((t) => `${t}:${SCENE_KEYWORDS[t].length}`).join(' ');
    },
  },
];
