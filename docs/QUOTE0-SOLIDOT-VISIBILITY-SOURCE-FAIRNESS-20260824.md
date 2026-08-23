# Quote0 Solidot 可见性 / Source-Fair Replay 治理（2026-08-24）

## 结论

用户反馈“仍然没有看到 Solidot 消息源推送”。生产只读追踪证明 Solidot 并未再次断链；真正问题是 **producer 按 RSS 源公平轮换，而 consumer fallback 按文章 LRU 轮换**，导致屏幕曝光比例被库存文章数量支配。高产 DEV/HN/InfoQ 视觉上淹没低产 Solidot。

`eink-2` 在 2026-08-24 00:12 和 00:23 都真实成功显示过 Solidot，但下一分钟即被其它文章覆盖，因此非常容易被用户错过。

本次候选将历史复播从 article-level LRU 改为 **source-fair LRU**：fresh `ready` 内容仍 FIFO 优先；只有 fallback 复播时，先选“最久没有在屏幕出现的源”，再选该源“最久没有显示的文章”。不对 Solidot 写特判，不修改 1 分钟刷新节奏，不扩大 24h replay window。

尚未 commit / push / deploy。生产仍是 v1.21.93。

## 工作区

- Repo: `/Users/friday/github/quote0-mcp`
- Worktree: `/Users/friday/github/_worktrees/quote0-rss-neuromancer-governance-20260823`
- Branch: `fix/rss-neuromancer-governance-20260823`
- Base HEAD: `07af89665c14bbfd1fd073ad0ef6fd3ceda871e5`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- 当前 worktree 已包含上一阶段 RSS identity / Neuromancer depth 候选改动；本任务新增改动集中在 `src/api/news-scheduler.ts` 与 `src/api/news-scheduler-consumer-delivery.test.ts`。

## Dynamic Context Rebuild

Preflight:

- tlens `v0.2.9-50-g49ed60e`
- remote backend healthy
- skldr `0.3.62`
- tlens index 仍警告 stale（last built 2026-08-22 06:39）

关键历史证据：

- `ctx-PcXr`: Solidot v1.21.93 生产治理，证明 2026-08-21 已恢复 Tailnet relay，Solidot E2E 曾从 producer → Universal Research → eink-2 成功。
- raw tlens `454e847a-a997-422a-8462-f9dad1771478:0`: 早期 LRU 无限复播的原始目标是“ready 耗尽后保持屏幕每分钟持续更新”；当时没有 source fairness 要求，因此纯 article LRU 是历史设计选择，不是当前多源公平语义。

## 当前生产事实

### Solidot scheduler

`multi-source-rotation` 仍启用，8 源：

- solidot
- sspai
- hackernews
- arstechnica
- infoq-cn
- dev-to
- github-changelog
- cloudflare-blog

Solidot 最近 producer：

- 2026-08-23 21:32: `success / producer_stored`
- 22:52: `producer:no_fresh_candidate`
- 00:12: `producer:no_fresh_candidate`

24h producer 汇总：

- Solidot: 2 success / 16 skipped(no fresh)
- DEV.to: 18 success / 0 skipped
- Hacker News: 18 success / 1 fetch-error skip
- InfoQ: 13 success / 4 skipped
- SSPAI: 2 success / 16 skipped
- Ars: 2 success / 15 skipped
- GitHub Changelog / Cloudflare Blog: 0 success in current 24h window

当前 relay RSS 本身只有 6 条，顶部最新文章为 2026-08-23 19:04 +08 的 Zondacrypto CEO 失踪新闻。因此 Solidot 的低产量一部分是真实上游内容更新频率，不是 fetch outage。

### 21:32 Solidot 全链路

Inventory `18555`:

- original source: `solidot`
- raw source: `奇客Solidot`
- original title: `波兰加密货币交易所 CEO 在 2022 年失踪，4 年后他的继任者也失踪了`
- Neuromancer final title: `Zondacrypto两CEO先后失踪`
- final source: `Solidot/NYT`
- Research: completed, digest, 2 tools / 2 crawls / 0 search
- Research Receipt sources: Solidot + NYT
- state: pushed

Consumer / `eink-2` successful display:

- 21:33 first replay generation later superseded
- 22:31 succeeded
- 23:27 succeeded
- **00:23 succeeded**

At 00:24 another InfoQ item was displayed; therefore Solidot was visible for roughly one minute.

另一个 Solidot inventory `18510`（`AI捏造女患者服迷幻蘑菇`, final source `Solidot/ABC`）也在 **00:12** 对 `eink-2` succeeded，00:13 即被下一条覆盖。

所以“用户没看到”不是设备没有收到，而是低曝光 + 1 分钟 dwell 导致极易错过。

## 曝光不公平的定量证据

过去 6h `eink-2` succeeded delivery 按原始 source：

- dev-to: 95
- hackernews: 88
- infoq-cn: 69
- sspai: 12
- arstechnica: 10
- solidot: **9**

消费者当前逻辑：

1. `ready` FIFO；
2. ready 为空后，在全部 `pushed` 文章中：`ORDER BY last_pushed_at ASC NULLS FIRST LIMIT 1`。

因此公平单位是“文章”，不是“RSS 源”。18 条 DEV + 18 条 HN + 13 条 InfoQ 自然获得远高于只有 2 条活跃库存的 Solidot 的屏幕份额。

这与产品表述“多源 RSS 轮播”不一致：producer source fairness 没有传递到 display fairness。

## 候选修复

文件：`src/api/news-scheduler.ts`

Fresh path 不变：

```text
ready → FIFO by created_at
```

Fallback replay 改为 source-fair LRU：

```sql
SELECT ranked.*
FROM (
  SELECT ci.*,
         MAX(ci.last_pushed_at) OVER (PARTITION BY ci.source) AS source_last_pushed_at
  FROM content_inventory ci
  WHERE ... eligible pushed inventory within replay window ...
) ranked
ORDER BY ranked.source_last_pushed_at ASC NULLS FIRST,
         ranked.last_pushed_at ASC NULLS FIRST,
         ranked.created_at ASC
LIMIT 1
```

语义：

1. 先选择“最近一次显示时间最早”的 source；
2. 再在该 source 中选“最久未播”的 article；
3. fresh ready 内容继续抢占优先；
4. `REPLAY_WINDOW_HOURS` 仍限制陈旧内容；
5. Content Quality HOLD / Universal Research ready gate 完全保留。

### 当前生产数据反事实

用候选 SQL 对当前生产只读计算，source replay 顺序为：

1. sspai
2. solidot
3. arstechnica
4. infoq-cn
5. hackernews
6. dev-to

即当前六个有活跃 pushed inventory 的源在没有 fresh ready 插队时，会近似一轮一个 source，而不是继续按 2/2/13/18/18 条库存比例瓜分曝光。

## 测试 / 验证

新增 consumer 测试锁定：

- ready 为空时 fallback SQL 必须包含 `MAX(ci.last_pushed_at) OVER (PARTITION BY ci.source)`；
- 必须先按 `source_last_pushed_at`，再按 article `last_pushed_at`；
- replay window 参数保持 24h。

专项：

- 13 pass / 0 fail
- TypeScript build PASS
- `git diff --check` PASS

最终全量：

- **300 pass**
- **1 optional real-PG test skip**
- **0 fail**
- 7292 expectations
- 50 test files
- `bun run build` PASS
- `git diff --check` PASS

专项测试首次暴露 consumer test mock 缺少已有导出 `enqueuePreRenderedImageDeliveries`；这是测试桩加载顺序债，不是本次运行时代码故障，已补齐测试 mock 后专项/全量均通过。

## 风险与取舍

- 不改变 1 分钟屏幕刷新节奏，因为历史原始需求明确要求持续快速轮播；用户本轮没有要求延长 dwell。
- Source fairness 会提高低产源的复播占比，因此同一低产源文章会比 article-LRU 更频繁重复。但仍受 24h replay window 限制，不会无限播放陈旧内容。
- Source fairness 只影响 fallback pushed replay；fresh ready article 始终优先，避免为了“公平”延误新鲜内容。
- 当前 Solidot relay 上游本身内容少且更新慢。公平消费解决“看不见”，不制造不存在的新 Solidot 新闻。
- finalizer 目前把来源显示为 `Solidot/NYT`、`Solidot/ABC` 等，这仍保留 Solidot 身份，不是本次主要根因。

## 状态 / 下一步

当前：诊断完成、候选修复完成、生产反事实验证完成、全量测试/build 通过；**未 commit / push / deploy**。

若授权部署，建议与上一阶段 RSS identity + Neuromancer depth 候选一起做同一版本化 release，并在部署后观察：

- 每源 display share；
- source silence p50/p95；
- Solidot 两条 active inventory 的实际出现间隔；
- fresh ready latency 是否保持；
- 是否出现某低产源过度重复的主观体验。
