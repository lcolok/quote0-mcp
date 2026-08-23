# Quote0 RSS 质量 × Neuromancer 治理候选报告（2026-08-23）

## 1. 任务与结论

用户目标：结合 Quote0 RSS 质量守望视角治理新闻质量，并确认生产链是否真的通过 Neuromancer 做了深入证据挖掘。

结论先行：**生产 v1.21.93 已经把 Universal Neuromancer Research 接入每条新新闻的发布主链；当前问题不是“没有调用 Neuromancer”，而是占比最高的 `digest` 模式最低研究覆盖不足，很多任务只确认 seed/canonical 后就停止，因此形成“形式上经过 Research、实质信息增益有限”的体感。** 同时 RSS 稳定身份仍有缺陷，导致同一文章重复入库并重复消耗 Research 工具预算。

本次在隔离 worktree 中实现了两组候选治理：

1. RSS 使用稳定 subject identity（source + canonical link/guid），显示/新鲜度时间与身份时间分离；并提供旧 fingerprint 兼容桥，避免部署时出现一次性重复波。
2. Universal `digest` 保持 4 次工具上限，但将最低研究覆盖提高到“至少 1 次 freshness/provenance targeted search”，目标独立来源簇从 1 提到 2；运行时 hard gate 会拒绝零-search digest 进入 Phase B。

**尚未部署、未 commit、未 push。生产仍为 v1.21.93。**

## 2. 工作区与事实边界

- 源码仓库：`/Users/friday/github/quote0-mcp`
- Remote：`https://github.com/lcolok/quote0-mcp.git`
- 隔离 worktree：`/Users/friday/github/_worktrees/quote0-rss-neuromancer-governance-20260823`
- 候选分支：`fix/rss-neuromancer-governance-20260823`
- 基线：本地 `main@07af896`（`feat(quote0): restore solidot source governance and rss health`）
- 原始 checkout 当时位于旧分支 `governance/workflow-phase1-20260820@6529038`，相对 `origin/main` 落后 19 个提交，因此没有在旧分支直接修改。
- 当前候选 worktree 原始状态 clean；本次只修改本文列出的候选代码/测试与本报告。

事实优先级：生产 SQL/运行日志和实际代码 > 当前测试/build > tlens 原始会话 > skldr 归档。生产只做了只读诊断，本轮未写生产数据库、未部署服务。

## 3. Dynamic Context Rebuild

### 3.1 Binary / backend preflight

- `tlens version`：`v0.2.9-50-g49ed60e`
- `tlens doctor backend`：remote backend healthy
- `skldr version`：`0.3.62`
- `tlens sync`：远端只读 backend 不允许本地重建；当前索引警告最后构建于 2026-08-22 06:39，因此 8 月 22–23 日原始会话证据可能不完整。没有把缺失的 tlens 结果补写成历史事实。

### 3.2 历史证据

高价值 skldr 归档：

- `ctx-LK4N`：2026-08-18 Quote0 Neuromancer 内容治理分析。已识别稳定内容身份、Evidence Gain、Research profile SSoT、paired review 等方向；其中 InfoQ 重复 identity 与 publishTime clamp 已是已知结构性问题。
- `ctx-UkJ4`：2026-08-20 v1.21.86 paired review 收口。当时 Research 仍主要是审阅/候选能力；该状态已被后续 Universal Research 主链取代。
- 当前仓库 `docs/UNIVERSAL-EVIDENCE-RESEARCH-V12192-PRODUCTION-20260821.md`：明确 v1.21.92 起新内容经过 Direct draft → `researchGate=pending` → Neuromancer → no-tools finalizer → supported-claim gate → `researchGate=ready` → delivery；Research mode tool cap 为 digest4 / enrichment6 / verification8 / recovery10。

tlens 原始证据：

- `d76c83f4-2836-40d7-b717-767151f606cb:0`（2026-08-21）记录 Quote0 生产 RSS pool 已是 8 个核心源，并含当时真实 scheduler 状态。该 chunk 不足以证明 8 月 23 日 Universal Research 深度；深度结论以下文当前生产代码、环境、SQL 为准。
- 对 `v1.21.92` / `researchGate` 的 2026-08-20 以后 FTS 当前未返回可用近期 Research chunk；归因于远端 tlens 索引滞后，已标记为原始会话索引缺口。

## 4. 当前生产状态（只读，2026-08-23 22:42 CST 左右）

### 4.1 服务与 Research 开关

`/api/health`：

- status: `healthy`
- service: `Modular News API`
- version: `1.21.93`
- timezone: `Asia/Shanghai (CST)`

生产容器非敏感环境变量确认：

- `QUOTE0_RESEARCH_AUTO_ENABLED=true`
- `QUOTE0_RESEARCH_UNIVERSAL_ENABLED=true`
- auto worker tick 15s
- lookback 24h
- scan limit 25
- Straylight Research canary enabled
- Research agent `pi-mono`
- finalizer provider `hy3`

因此：**Neuromancer Universal Research 当前确实是新内容生产主链，不是仅用于手工 canary / paired review。**

### 4.2 RSS 源健康

8 个核心源全部 `healthy` 且 `consecutive_failures=0`：

- arstechnica
- cloudflare-blog
- dev-to
- github-changelog
- hackernews
- infoq-cn
- solidot
- sspai

所以这轮“内容挖掘不深”不能归因于 RSS 源整体离线。

### 4.3 输入证据完整度（过去 24h）

按 `research_runs.triage.signals.evidenceMode` 联结 `content_inventory`：

| Source | Evidence mode | 数量 | raw content 平均字符 |
| --- | --- | ---: | ---: |
| arstechnica | sparse | 1 | 76 |
| dev-to | adequate | 19 | 6478 |
| hackernews | adequate | 18 | 178 |
| infoq-cn | seed-only | 14 | 7 |
| solidot | adequate | 2 | 301 |
| sspai | adequate | 2 | 109 |

关键观察：

- **InfoQ 14/14 都是 seed-only，原始正文平均只有 7 字符**，实际上高度依赖 `recovery` Research 才能成为可发布新闻。
- DEV.to 与 Hacker News 数量占比很高，通常被判为 adequate，因此大量进入较轻量的 Universal `digest`。

这解释了生产质量的“双峰”：InfoQ 往往真深挖；DEV/HN 的普通条目常常只是轻量 digest。

## 5. Neuromancer 深度守望：真实 24h 指标

最近 24h `inventory-auto` completed Research：

| mode | completed | zero search | single source | avg tools | avg searches | avg sources |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digest | 39 | 20 | 23 | 2.44 | 0.59 | 1.44 |
| enrichment | 1 | 0 | 1 | 5.00 | 4.00 | 1.00 |
| recovery | 14 | 0 | 2 | 6.93 | 4.07 | 2.50 |
| verification | 1 | 0 | 0 | 8.00 | 5.00 | 2.00 |

由此可得：

- digest 占 completed 的 `39 / 55 ≈ 70.9%`。
- digest 中 `20 / 39 ≈ 51.3%` **完全没有执行 search**。
- digest 中 `23 / 39 ≈ 59.0%` 最终 Receipt **只有一个 source**。
- recovery 明显更接近“深入挖掘”：平均 6.93 tools、4.07 searches、2.50 sources。

因此用户体感成立，但准确表述应是：**Neuromancer 已经在跑；主导产量的 digest 允许过早停止，导致信息增益不足。**

### 5.1 代表性样本

深挖较好：

- InfoQ PGSimCity：recovery，约 7 tools / 3 searches / 3 sources / 3 claims；从 7 字符 navigation stub 补到 InfoQ/上游/GitHub 等证据。
- InfoQ Dogwood：recovery，10 tools / 6 searches / 4 sources。
- HN Sydney Marathon：digest，3 tools / 1 search / 2 sources。

偏浅：

- DEV webpack docs：digest，4 tools / 0 search / 1 source。
- DEV assignment：digest，1 tool / 0 search / 1 source。
- HN writing advice：digest，1 tool / 0 search / 1 source。
- DEV enum：digest，1 tool / 0 search / 1 source。

旧逻辑中，digest 的 minimum coverage 允许“crawl canonical/seed 或做 targeted search”；如果 seed 自身是 primary/official 且正文完整，也允许快速结束。这正是零-search digest 合法出现的代码根因。

## 6. RSS 重复身份：Research 预算被重复消耗

过去 24h 对 link 去 tracking normalization 后：

- 3 个重复 subject
- 产生 6 条额外 inventory row
- 对应 6 个冗余 Research run
- 浪费 40 次 tool calls
- 浪费 20 次 searches
- 冗余 Research wall time 合计约 466.5 秒

典型：

- InfoQ DynamoDB：同一 link 出现 4 个 inventory row
- InfoQ PGSimCity：同一 link 出现 3 个 row
- reliability story：同一 link 出现 2 个 row

PGSimCity 的三个有效时间形态直接证明旧 fingerprint 不稳定：

- 18533：effective `publishTime=2026-08-23T04:40:06.531Z`
- 18546：effective `publishTime=2026-08-23T10:11:16.839Z`
- 18557：feed 后来补出真实 `publishTime=2026-08-23T11:25:00.000Z`

旧 `normalizeRssPublishTime` 会把缺失/未来时间钳为“本次抓取时刻”，而 `computeNewsFingerprint` 又把该 effective publishTime 纳入 hash，所以同一 subject 随抓取时钟反复换 identity；feed 后续补真实 pubDate 时再换一次。

这不是 InfoQ 特判问题，而是“显示时间参与内容身份”的通用模型错误。

## 7. 本次候选治理

### 7.1 稳定 RSS subject identity

修改：

- `src/react-widgets/core/data-sources/rss-data-source.ts`
- `src/api/news-processing-service.ts`
- `src/api/news-scheduler.ts`
- 对应 tests

设计：

1. `normalizeRssPublishTime` 分离：
   - `publishTime`：显示/新鲜度时间，允许 clamp 到 now；
   - `identityPublishTime`：只来自 feed 原值，从不使用 fetch clock 合成。
2. `normalizeRssIdentityValue`：URL 去 fragment 与 tracking-only params（`utm_*`、`fbclid`、`gclid`、`mc_cid`、`mc_eid`），保留语义 query。
3. `buildRssIdentityKey`：`sourceId + canonical link` 为首选主体 identity；link 缺失才退 guid，再退 source/title/identity time。
4. `computeNewsFingerprint` 支持 authoritative `identityKey`；主体 key 存在时，不让 title/time/source/category 的后续修订制造新 fingerprint。

真实 PGSimCity 反事实实验：

- subject key：`infoq-cn::https://www.infoq.cn/article/umVdo2GaEyONQLWNmPZ9`
- “早期缺 pubDate / effective fetch time”与“后来真实 11:25 pubDate”均得到同一候选 fingerprint：`540d40fac5beecdbf7dd5824dcbc1d6c`
- `same=true`

### 7.2 迁移兼容桥：避免部署即全池重复

直接切换 hash 算法会让现役 RSS 条目全部换 fingerprint，造成一次性重复入库/Research/push。因此新增 migration bridge：

- 对当前 source 查询 active lookback 窗口中的旧 `content_inventory`（lookback = `max(REPLAY_WINDOW_HOURS, maxArticleAgeHoursRelaxed)`，当前 72h）。
- 按 canonical subject 构建 alias map，优先复用该 subject 最新的 legacy fingerprint。
- 真正新 subject 才使用 stable subject fingerprint。
- 日志输出 `RSS stable-identity compatibility ... reusedLegacy=x/y` 便于上线观察。

这样做到“旧活跃内容不重生，新内容立即进入稳定 identity”。

### 7.3 提高 digest 最低证据增益，但不粗暴加预算

修改：

- `src/api/research-triage.ts`
- `src/api/research-few-shot.ts`
- `src/api/research-canary.ts`
- 对应 tests

策略：

- digest `maxToolCalls` **仍为 4**。
- `targetIndependentClusters`：1 → 2。
- Prompt hard wording：**至少执行 1 次 freshness/provenance targeted search**；不能只 crawl seed 就宣布 Research 完成。
- 若 search 找到高价值 primary/official/upstream/independent evidence，必须在剩余预算内 crawl/snapshot 后才能支持 publishable claim。
- 若客观上只有单一第一方来源，可 degraded stop，但必须先做 targeted search 证明未找到新增独立高价值证据。
- 继续保留 marginal-gain stop；不要求机械耗尽 4 calls。

更重要的是新增 runtime hard gate：

- Phase A digest 若 `searchRequests < 1`，返回 `invalid`，不能进入 Phase B。
- 不只依赖 prompt obedience。
- 现有 worker 对 invalid/failed 有 15 分钟 cooldown 后自动重试。

### 7.4 既有失败恢复链验证

生产 inventory 18520：

- 首次 digest run：invalid，`5 > 4` tool budget。
- 15 分钟后新 run 自动接管：3 tools / 1 search，completed。
- inventory 当前 `researchGate=ready` 且已 pushed。

因此“hard gate 拒绝一次”不会天然造成永久 pending；现有自动恢复链真实工作过。

## 8. 验证

首次 focused test 在新 worktree 中因没有 `node_modules`，导入 `sharp` 报缺依赖；这是环境缺依赖，不计为代码失败。随后使用现有 Bun lockfile恢复依赖：

```bash
bun install --frozen-lockfile --ignore-scripts
```

没有切换包管理器、没有重建 lockfile。

最终：

```bash
bun test
```

结果：

- **299 pass**
- **1 skip**
- **0 fail**
- 7285 expectations
- 50 test files

唯一 skip 是既有 `rss-source-health.pg.test.ts` 的 real-PostgreSQL 测试；本地默认环境没有运行该真实 PG 集成测试。

```bash
bun run build
```

- `tsc -p tsconfig.build.json` exit 0

```bash
git diff --check
```

- exit 0

额外覆盖：

- 零-search digest 被 hard gate 拒绝。
- 有 targeted search 的 digest 能继续 Phase B。
- future/missing/invalid RSS time 不再合成 identity time。
- 同一 canonical subject 即使 title/pubDate 后修订仍稳定。
- tracking params 不影响 subject identity，semantic params 保留。
- rollout alias 优先复用最新 legacy fingerprint。

## 9. 当前修改文件

代码/测试：

- `src/api/news-processing-service.test.ts`
- `src/api/news-processing-service.ts`
- `src/api/news-scheduler-source-cooldown.test.ts`
- `src/api/news-scheduler.ts`
- `src/api/research-canary.test.ts`
- `src/api/research-canary.ts`
- `src/api/research-few-shot.test.ts`
- `src/api/research-few-shot.ts`
- `src/api/research-triage.test.ts`
- `src/api/research-triage.ts`
- `src/react-widgets/core/data-sources/rss-data-source.test.ts`
- `src/react-widgets/core/data-sources/rss-data-source.ts`

归档：

- `docs/QUOTE0-RSS-QUALITY-NEUROMANCER-GOVERNANCE-20260823.md`

## 10. 风险、未验证项与上线守望指标

### 10.1 已知取舍

1. **digest latency 会增加**：以前很多 1-crawl/0-search 可很快结束；现在至少多一次 targeted search。没有提高工具上限，成本增长被限制在原 4-call ceiling 内。
2. **targetIndependentClusters=2 是研究目标，不是最终 artifact 的“必须 2 source”硬门**。这是有意的：单一权威第一方事件不应因为没有第二独立来源而永久无法发布；硬约束是“必须至少尝试一次 targeted search”。
3. **零-search hard gate 会触发 15 分钟重试延迟**，若 agent 无视 prompt 或 search 工具异常，条目会延后而不是浅发布。fail closed 是有意行为。
4. **legacy alias 只覆盖当前 active lookback（当前 72h）**。超过该窗口的极老 fallback subject 理论上可能在稳定算法首次遇到时使用新 fingerprint；当前 producer/relaxed 新闻主要窗口与此一致。
5. 本轮没有跑真实 PG 的 `rss-source-health.pg.test.ts`；但生产 PostgreSQL 做了只读查询，所有 8 个 source health 真实为 healthy。
6. 当前 source mix 仍然偏 DEV.to / Hacker News。深度 hardening 不能替代信息源多样性治理，后续应单独守望 source distribution。

### 10.2 部署后 24h Acceptance / Watch

必须守望：

- completed digest `zero_search_rate = 0%`（新 hard invariant）。
- 新进入 stable identity 的 canonical subject 重复 extra rows 应趋近 0。
- 不应出现部署瞬间现役 72h RSS pool 全量换 fingerprint；初期应看到 `reusedLegacy` 兼容日志。
- digest `avg searches >= 1`。
- invalid/failed 比例不能因 hard gate 显著失控；pending oldest age 应保持可接受，若触发 retry 允许出现约 15min 延迟。
- recovery 的来源深度不应回退；当前 baseline avg sources ≈ 2.50。
- 比较部署前后 digest p50/p95 Research latency 和 tool calls，确认深度提升没有造成不可接受吞吐下降。
- 跟踪 duplicate Research 浪费：当前 24h baseline 为 6 redundant runs / 40 tools / 20 searches / 466.5s wall time；治理后应显著下降。
- 继续保留 claim supported hard gate、Phase B no-tools、tool budget ceiling，不用“更多调用”替代证据质量。

## 11. 完成状态与下一步

当前状态：**候选实现 + 本地全量回归 + 当前生产只读验证已完成；没有 commit/push/deploy。**

最高优先级下一步：在获得明确部署授权后，以该候选分支做版本化 release/canary；部署后观察至少一个完整 RSS 轮转窗口，并以第 10.2 节指标做 24h 守望，再决定是否继续提高 digest 来源覆盖或调整 source mix。
