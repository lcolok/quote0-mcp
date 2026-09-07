# Quote0 delivery 366356：Research 深度 vs 最终引用源数量

日期：2026-09-01

## 用户问题

用户针对：

`/annotate?v=1&view=content&mode=content&target=eink-296x152&pane=preview&subject=502eb8bfbaa056ca49e759d50246eec6&delivery=366356`

询问为什么“证据源”这么少，是否意味着 Neuromancer 研究不够深入。

## 精确生产事实

Delivery 366356：
- fingerprint `502eb8bfbaa056ca49e759d50246eec6`
- inventory `19059`
- title `得物推荐Harness打通Agent研发链路`
- Research run `c861d355-ea01-4853-b36d-f1c52480391f`
- source `InfoQ 中文`

Triage：
- researchMode=`recovery`
- 原始 raw content 只有 7 字符：`点击查看原文>`
- evidenceMode=`seed-only`
- maxToolCalls=10
- maxEvidenceChars=8000
- targetIndependentClusters=2

真实 runtime：
- toolCalls=10（跑满上限）
- searchRequests=5
- crawlRequests=5
- failedToolCalls=0
- evidence packet ≈7532 chars
- retrieval healthy
- engines: 360search / bing / playwright / scrapling

所以该条不是“Neuromancer 没深入搜索”。它已经处于当前最重的 recovery 档，并把工具预算跑满。

## Evidence Ledger 实际内容

Ledger 有 4 个 supportEligible crawl entry：

- E1 InfoQ：原始得物 Harness 文章。精确相关，最终主张实际使用。
- E4 网易：AICon 上海 2026 大会/讲师复盘。可提供会议背景，但不能直接支撑 Harness 具体机制。
- E7 掘金：得物 AICon 智能客服 Agent 工程实践。属于同公司/同大会的另一个主题，不能用于给 Harness 主张背书。
- E9 今日头条：搜索标题高度相关（“从狂野代码到按目标生产：得物推荐 AI Harness 的工程化实践”），但 crawl 实际只得到空正文或“需要允许 JavaScript”的页面，不能提供事实支持。

5 次 search 共看见 50 个候选，相关性过滤器判定 5 个 relevant；其余 45 个 rejectedLowRelevance。

最终 artifact 的两条 selected fact 都只引用 E1，因此 Research Receipt `sources` 最后只有一个 source，DisplayProvenance `evidenceSourceCount=1`。

## 关键语义结论

当前 `evidenceSourceCount` 并不是“Neuromancer 总共研究/抓取了多少来源”，而是：

**最终被选入展示事实并进入 Research Receipt 的去重引用域名数量。**

代码证据：
- `materializeServerOwnedEditorialArtifact()` 先从 selectedFacts 收集 `usedEvidenceIds`；
- Receipt.sources 只保存这些 used evidence entries；
- `buildServerOwnedDisplayProvenance()` 只收到最终 `sources`；
- `evidenceSourceCount` = 这些最终 sources 的去重 domain 数。

因此 footer 的“1证据源”容易被误解。对 delivery 366356 更准确的表述是：

- 10 工具调用
- 5 搜索
- 5 crawl
- 4 个 crawl ledger entry
- 1 个最终引用源

## 当前合理性判断

Finalizer 只引用 E1 在本条上是合理且保守的：
- E4 只能补大会背景；
- E7 是另一个 Agent 主题；
- E9 没有可用正文。

不能为了“多源”指标好看，把弱相关或不可访问页面强行算成事实佐证。

所以根因不是简单的 Research budget 太低，而是**外部独立证据的有效产出率不足**。

## 发现的治理缺口

1. UI 语义：`证据源` 建议改叫 `引用源`，或在 review UI 分开展示 `抓取 / 引用`，避免把研究广度和最终 citation breadth 混为一谈。
2. Evidence Ledger admission：`successfulCrawlEvidenceEntries()` 当前主要依据 crawl completed / 非 error / 简单 anti-bot 文案过滤；E9 这种空正文仍可被标 supportEligible。虽然本条 finalizer 没误用，但 admission gate 应进一步要求可支持的正文语义内容，并覆盖中文 JS-block 页面。
3. Research 策略：不建议机械增加 recovery >10 call。优先改善 candidate ranking、crawl yield、独立高价值 source 选择和 claim cross-support。

## Git / production boundary

本任务为只读生产诊断与归档；没有修改生产数据库、renderer、Research policy 或部署。工作区保留既有 v1.21.114–121 dirty changes；无 commit/push/reset/stash/clean。
