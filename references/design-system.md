# archsvg 设计系统（固定风格 · fewshot）

> 目的：让同一套图在不同文档里**长得一样**，并让 IR 一次写对、少走返工。
> 本文是**约定**，不是新机制——所有约束都用既有 IR 字段表达。

---

## 1. 语义配色：先定「域」，再映射 role

颜色是**语义**，不是装饰。先想清楚图里有几个「域」，再把每个域映射到固定 role：

| 业务域 | role | 色系 | 典型节点 |
|:---|:---|:---|:---|
| 数据域 / 可查询实体 | `interaction` | 蓝 | Product / Brand / Category |
| 规则域 / 编排 / 状态 | `control` | 紫 | Promotion / MemberLevel / Router / Engine |
| 能力域 / 组件 / 外部系统 | `capability` | 绿 | ServiceRule / Milvus / Repository |
| 约束 / 拦截 / 失败路径 | `warn` | 橙红 | QualityGate / Guard / 降级出口 |
| 中性说明 | `neutral` | 灰 | 日志 / 缓存 / 工具类 |

**一条图内同一语义只用一种 role**，不要「这个实体用蓝、那个实体用绿」。
分组框（`groups[].role`）取该域的主色；节点 role 与所属域一致。

---

## 2. 文案规范（信息密度靠文案，不靠堆节点）

| 位置 | 写法 | 例子 |
|:---|:---|:---|
| 节点 `label` | **英文名 + 中文名**（技术图可只留英文） | `Product 商品` |
| 节点 `sublabel` | **规模 / 角色 / 关键属性**，≤ 18 字 | `50 个 SKU · 锚点` |
| 边 `label` | **关系名 · 一句话说明**（说明可省，关系名不省） | `APPLIES_TO · scope=SKU 指向商品` |
| `meta.title` | 图名，**不带序号** | `电商图谱数据模型` |
| `meta.caption` | `图 X-N · 图名（口径/用途）`——**会渲染在底部** | `图 5-2 · …（6 类节点 · 7 类关系边）` |

底线：**删标签 = 删信息**。`label` 是语义数据，不是注释。

### 2.1 字级与线宽（固定值，不要逐图调）

| 元素 | 字号 / 线宽 |
|:---|:---|
| 主标题 | 24px，weight 700 |
| **节点标题** | **16px，weight 700**（近黑 `--text`，不用 role 同色——会同色系顺色发虚） |
| 节点副标签 | 12px，`--muted` |
| 边标签 | 12px，`--muted` |
| 组框标签 | 13px，weight 700，`--text` |
| 图例 | 12px |
| 连线 | `stroke-width: 2` |

> ⚠️ **改字号必须三方同步**，否则文字会溢出盒子、或触发净空误报：
> `lib/theme.mjs`（CSS）↔ `lib/layout.mjs`（`NODE_FONT`/`SUB_FONT`/`LABEL_H`/盒高等估算常量）
> ↔ `lib/checks/composition.mjs`（`LABEL_FONT`/`LABEL_HEIGHT`）。
> 且 `layout.LABEL_MIN_CLEAR` 必须 **≥** 检查阈值 `max(8, LABEL_HEIGHT)`——
> 放置器与检查器的阈值不一致时，会选出「刚好差 0.5px」的位置导致批量误报。

---

## 3. 布局三原则

1. **一图一主干**：读者 3 秒能跟出主路径；辅助信息不抢戏。
2. **分组即分层**：`groups` 每个 group 是一条横带（自上而下）；**未分组节点会被塞进最后一条附加带**——要控制流向，就显式给入口/出口建 group。
3. **画布自动贴合**：`viewBox` 只是「行内舒展宽度提示」，成品画布会自动裁到内容边界（含图例）。**不要靠调大 viewBox 制造留白**。

节点数 > 4 就分组；单图 ≤ 24 节点；分组内节点 ≤ 4 个。

---

## 4. fewshot：可直接复制的完整 IR

> 场景：关系型数据模型（实体 + 带说明的关系边 + 域分层 + 底部口径）

```json
{
  "schema_version": 1,
  "type": "architecture",
  "meta": {
    "title": "电商图谱数据模型",
    "caption": "图 5-2 · 电商图谱数据模型（6 类节点 · 7 类关系边；课6 以此做 0~2 跳关系召回）",
    "locale": "zh-CN",
    "viewBox": [1100, 460]
  },
  "groups": [
    { "id": "data-domain", "label": "数据域 · 可查询实体", "role": "interaction" },
    { "id": "rule-domain", "label": "规则域 · 促销 / 会员 / 售后", "role": "control" }
  ],
  "nodes": [
    { "id": "brand", "label": "Brand 品牌", "sublabel": "11 个品牌", "role": "interaction", "group": "data-domain" },
    { "id": "product", "label": "Product 商品", "sublabel": "50 个 SKU · 锚点", "role": "interaction", "group": "data-domain" },
    { "id": "category", "label": "Category 品类", "sublabel": "5 个品类", "role": "interaction", "group": "data-domain" },
    { "id": "promotion", "label": "Promotion 促销", "sublabel": "13 个促销 · 锚点 · 带 note 边", "role": "control", "group": "rule-domain" },
    { "id": "member", "label": "MemberLevel 会员", "sublabel": "2 级会员 · 锚点", "role": "control", "group": "rule-domain" },
    { "id": "svc", "label": "ServiceRule 售后", "sublabel": "5 条售后规则", "role": "capability", "group": "rule-domain" }
  ],
  "edges": [
    { "from": "product", "to": "brand", "label": "MADE_BY · 商品由品牌制造", "kind": "data" },
    { "from": "product", "to": "category", "label": "BELONGS_TO · 商品归属品类", "kind": "data" },
    { "from": "promotion", "to": "product", "label": "APPLIES_TO · scope=SKU 指向商品", "kind": "sync" },
    { "from": "promotion", "to": "category", "label": "OFFSETS · 以旧换新抵扣货款", "kind": "sync" },
    { "from": "member", "to": "promotion", "label": "ENTITLES · 会员权益", "kind": "sync" },
    { "from": "category", "to": "svc", "label": "GOVERNED_BY · 品类受售后约束", "kind": "data" }
  ]
}
```

**这张例子为什么这样写**（照抄这几条就能少返工）：

- **先定域再上色**：数据域=蓝（interaction）、规则域=紫（control）、售后规则=绿（capability）——同一个「域」内的节点 role 一致。
- **两个 group 就是两行**：数据域在上、规则域在下；`product → brand/category` 在同带内，`category → svc` 向下走一带，都不跨行。
- **节点副标签给规模**（`50 个 SKU · 锚点`），读者不必回正文找数量。
- **边标签带说明**（`OFFSETS · 以旧换新抵扣货款`），一条边自解释。
- **口径放 caption**：会渲染成底部图注，替代额外的「说明条」节点。

---

## 5. 出图前自检（5 条，30 秒）

1. 域 → role 的映射列出来了吗？（一域一色）
2. 每个 group 内部节点 ≤ 4？边是否只跨一到两条带？
3. 节点 `label` 是否有中文名？`sublabel` 是否给了规模/角色？
4. 边 `label` 是否带说明？有没有为了排版删过标签？
5. `meta.caption` 是否写成 `图 X-N · 名称（口径）`？
