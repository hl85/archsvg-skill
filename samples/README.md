# samples —— 成品样例画廊

每个样例一对文件：`.json` 为 IR 源（**唯一应修改的文件**），`.svg` 为 showcase 档位
（17/17 项全过）的渲染产物。改了 IR 后重渲染：

```bash
node ../bin/archsvg.mjs render <type> <sample>.json <sample>.svg --quality showcase
```

## 覆盖矩阵

| 样例 | 类型 / 变体 | 演示要点 |
|:---|:---|:---|
| `order-system` | architecture · 分层图 | `groups` 三层分区、`role` 语义色板、data/sync/async 混合边 |
| `sync-async-compare` | architecture · **并列对比** | 两个并列 group 表达同业务两种方案；`warn` 角色标记阻塞点 |
| `ci-pipeline` | flow · **Pipeline（stages）** | 阶段带分列、decision 门禁、`fallback` 回边（QualityGate → Build） |
| `alert-triage` | flow · **决策树** | 双层判定、三出口分级；`warn`/`interaction`/`neutral` 终态区分 |
| `oauth-login` | sequence · 请求生命周期 | 授权码模式完整时序、`return` 消息类型、跨参与者往返 |

## 与 examples/ 的关系

`examples/` 是**最小可读**的 IR 示例（Schema 对照用）；`samples/` 是**成品级**样例
（完整语义 + 已渲染 SVG），可直接嵌入文档或作为创作起点复制修改。

## 布局提示（来自实战）

flow 类型非 stages 模式下，**每行独立居中**。若「上层判定节点 → 下层首个节点」的
边出现 `route_rhythm` 失败（中段横移 < 16px），原因是两行的行宽不同导致列心漂移
（漂移量 = 行内其余节点宽度差的一半）。修复方法：调整**同层另一侧**节点的标签文本
宽度使两行对齐，或拉开到 ≥ 16px。参考 `alert-triage.flow.json` 中 `P0` / `P2`
标签同构（`P0 电话 + 拉群` / `P2 工单 + 邮件`）对齐列心的做法。
