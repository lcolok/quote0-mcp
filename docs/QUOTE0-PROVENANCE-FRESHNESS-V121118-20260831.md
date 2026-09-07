# Quote0 来源 SSoT · Neuromancer 可见性 · 自动新鲜补池治理

日期：2026-08-31
最终生产版本：`1.21.118`
Research policy：`quote0-research-triage/v12`

## 1. 用户目标

用户提出三个互相关联的问题：

1. 新闻“来源”看起来像模型自己生成，希望有确定、可信、可解释的来源框定机制；
2. 希望在最终墨水屏上明确看出一条内容是否经过 Neuromancer Research；
3. 希望尽量看到新鲜内容，补池和轮播应自动完成，而不是每次由人手工触发 producer。

本轮把三者收敛为同一个服务器拥有的 publication/display contract，而不是继续靠 prompt 或人工运维。

## 2. 工作区与边界

- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- 本轮未 commit / push / merge / rebase / reset / stash / clean。
- 工作区在本轮开始前已经存在上一阶段 Quote0 v1.21.114–116 治理改动，以及 `package.json` / `scripts/replay-qwen-research-corpus.ts` 等既有 WIP；均未覆盖或擅自收口。

## 3. Dynamic Context Rebuild

Preflight：

- tlens `v0.2.9-89-g7dcb97e`
- tlens backend healthy
- skldr `0.3.62+introspect.d35e07a`

高价值历史：

- `ctx-RgSh`：Neuromancer 身份曾在 review UI 不可见；
- `ctx-cYqZ`：source-fair replay / digest governance；
- `ctx-rIGJ`：8 个核心 RSS、10min aggregate producer、单源平均约 80min；no-fresh 不以旧闻填充；
- `ctx-Q8Pn`：v12 小池 + 无限 LRU 的“像没更新”问题；同时明确 LazyCat 必须使用 `lzc-docker` daemon。

历史产品决策：commit `09e4f1d` 在 2026-06 有意取消 `replay_count < max_replays` hard cap，使无新货时屏幕仍持续轮播。因此本轮没有简单恢复 hard cap，而是把 `max_replays` 改回有意义的 **soft priority budget**。

## 4. 根因：来源不是 LLM 写的，但旧语义依然是错的

生产 v12 样本证明，旧 `processed_content.source` 并不是 LLM 自由生成，而是 Quote0 服务器的 `sourceLabelFromEvidence()` 把最终 supported evidence 的域名拼起来。

真实例子：

- Bun / InfoQ：`infoq.cn/bun.com/github.com`
- Sail Research：`prnewswire.com/fortune.com/infoq.cn`
- inventory `19049`：原始发现源是 Hacker News，真实文章链接是 PCMag，但因最终 supported evidence 恰好只有一个 X 帖子，旧卡片显示 `source=x.com`

所以用户的“来源像 AI 随便写的”感受成立；技术上不是模型写 source，但**把研究证据域名冒充 Publisher** 在产品语义上同样错误。

## 5. 新来源契约：DisplayProvenance v1

新增：`src/api/news-display-provenance.ts`

Schema：`quote0-display-provenance/v1`

明确分成三层：

### 5.1 Publisher — 原始发布方

`source` 现在只表达 Publisher。

服务器确定规则：

1. 直接 Publisher feed（InfoQ / 少数派 / Solidot / DEV / Ars / GitHub / Cloudflare 等）优先使用 RSS registry 的 canonical name；
2. aggregator feed（当前 Hacker News）不把 HN 当 Publisher，而是从 seed article URL 确定真正 Publisher；
3. 未知站点使用 seed link hostname 的确定性 label；
4. 最后才退到 seed source；
5. evidence domain 永远不得覆盖 Publisher。

### 5.2 Discovery — “从哪里发现”

对于 aggregator 保留单独 discovery：

- Publisher=`PCMag`
- Discovery=`Hacker News`

最终可显示为：`来源: PCMag · via HN ...`

### 5.3 Research Evidence — Neuromancer 用了哪些证据

Research evidence 继续由 `researchReceipt.sources` / evidence ledger SSoT 管理。

DisplayProvenance 只保存去重后的 evidence domains/count：

- `agent=neuromancer`
- `evidenceSourceCount`
- `evidenceDomains[]`
- `policyVersion`
- `runId`

Evidence 不再进入 `source`。

## 6. 不清空 v12：Provenance 与 Research policy 解耦

本轮**有意保持 Research policy v12**，没有为了来源显示升成 v13。

理由：来源是 display/provenance contract 改进，不是 Research factual gate 改进。如果 bump Research policy，会让现有合格 v12 池全部退出 consumer 并重新跑 Research，制造 token 浪费和短期断粮。

兼容策略：

- 新 Research artifact：直接把 DisplayProvenance 持久化进 `processed_content.metadata`；
- 旧 v12 artifact：`device-delivery-worker` 在 inventory → Renderable 阶段，使用 inventory source + seed link + receipt evidence 确定性 retrofit provenance；不改历史 DB，不重跑 Research。

生产证明：旧 inventory `19049` 原 `processed_content.source=x.com`，线上新 projection 得到：

- Publisher: `PCMag`
- Discovery: `Hacker News`
- Evidence: `x.com`
- Research: Neuromancer

最终 296px-class footer：

`来源: PCMag · via HN · Neuromancer·1证据源`

因此 X 被保留为证据，但不会再冒充来源。

## 7. Neuromancer 在真机上可见

之前 `processed_content.metadata.researchReceipt` 已有完整 Research 身份，但 `device-delivery-worker` 转 Renderable 时会丢 metadata，导致物理 Satori renderer 看不到 receipt。

本轮修复：

- `device-delivery-worker` 保留 metadata；
- News / DevicePush / LocalEink rendering module 全部把 metadata 传给 `SatoriNewsWidget`；
- footer 从服务器 metadata 读取 Publisher / discovery / Research，不从模型文本猜测。

Footer 优先级按空间渐进降级：

宽空间：

`来源: PCMag · via Hacker News · Neuromancer研究·1证据源`

296px-class compact：

`来源: PCMag · via HN · Neuromancer·1证据源`

直接 Publisher feed：

`来源: 少数派 · Neuromancer研究·1证据源`

非 Research 卡片仍保持：

`来源: Solidot`

## 8. 自动新鲜补池：不再靠人工连续 trigger

### 8.1 保留长期 10 分钟 cadence

没有把 producer 粗暴改成每分钟抓取。

历史 `ctx-rIGJ` 的压力模型仍保留：

- 8 个 core sources
- normal scheduler interval = 10min
- 正常健康池时每 tick 只检查 1 个 source
- 单 source 平均约 80min 一次

### 8.2 Low-water bounded scan-ahead

新增 supply snapshot：

- `freshEligible`：6 小时内、当前 Research policy 可实际显示的合格库存数；
- `pendingResearch`：24h 内 pending Research 数。

默认阈值：

- `PRODUCER_REFILL_LOW_WATER=12`
- `PRODUCER_REFILL_PENDING_MAX=2`
- `PRODUCER_REFILL_SCAN_MAX=4`
- `INVENTORY_FRESH_REPLAY_HOURS=6`

行为：

- `freshEligible >= 12` → 正常 1 source/tick；
- 池低于 12 且 pending < 2 → 同一个正常 10min tick 内最多 scan 4 个 sources；
- no-fresh → 记录 source healthy，继续下一个；
- fetch failure → 仍真实记录 failure/cooldown，但低水位时不浪费整个 10min slot，可继续下一源；
- 找到第一条 fresh candidate → 立即停止 scan，照常只产生 1 条 inventory / 1 个 Research；
- pending Research >=2 → scan-ahead 自动关闭，避免 Neuromancer backlog。

这不会提高长期 timer cadence，也不会无条件制造额外 Research。

### 8.3 生产自然流量证明（无人工 trigger）

`2026-08-31 19:18:25 +08` scheduler 自然 tick：

```json
{
  "scanLimit": 4,
  "freshEligible": 9,
  "pendingResearch": 0,
  "scannedSources": [
    {"source":"solidot","outcome":"no-fresh"},
    {"source":"sspai","outcome":"selected"}
  ]
}
```

结果：同一轮 Solidot 没新货后没有浪费 10 分钟，而是自动继续到少数派并 `producer_stored`。

产生 inventory `19052`：

- raw sourceId=`sspai`
- raw source=`少数派`
- raw link=`https://sspai.com/post/114041`
- Research run=`2147fd65-a7bf-4f8f-8f6b-96d61bdd1708`
- completed `19:19:19`
- 6 tool calls = 4 crawl + 2 search
- failed calls=0
- final Publisher=`少数派`
- DisplayProvenance 持久化 evidenceDomains=`[sspai.com]`

`19052` 随后由正常 consumer 自动进入真机：

- `19:20:21` eink-2 succeeded（v1.21.117）
- v1.21.118 安装后 `19:27:33` 再次自然 succeeded，证明最终 compact footer 进入真实物理 renderer 路径。

当前（约 19:28）freshEligible 已从 9 自动增长到 **11**、pending=0；达到 12 后 `producerRefillScanLimit()` 会自动回落为 1 source/tick。

## 9. Consumer 新鲜度优先，但保留不断屏安全网

原有 fresh `ready` 仍绝对 FIFO-first。

当没有 ready 时，pushed fallback 变为：

1. 6h 内 fresh tier 优先；
2. `replay_count < max_replays` 的 soft-budget tier 优先；
3. tier 内保持 source-fair LRU；
4. 如果所有项都超 soft budget，仍允许无限 LRU 作为最后 safety net，避免屏幕停在最后一帧。

所以 `max_replays=3` 不再完全失效，但也不会回到“播三次后永远没内容”的旧问题。

## 10. 验证

最终完整 gate：

- `bun test`: **340 pass / 1 skip / 0 fail**
- expectations: **7479**
- 唯一 skip：真实 PostgreSQL RSS source-health outbox 测试（既有）
- `bun run build`: PASS
- `git diff --check`: PASS

新增/扩展测试覆盖：

- server-owned Publisher / HN discovery / evidence separation；
- 旧 v12 `source=x.com` retrofit → PCMag；
- physical Renderable metadata 不丢失；
- Neuromancer footer full/compact；
- low-water refill budget；
- freshness/replay soft budget source-fair SQL。

## 11. 生产发布

### v1.21.117（功能验证中间版）

已用于生产验证 provenance、low-water scan-ahead 与自然补池。
Registry digest：

`sha256:bd3bd9d992112dd93a749f6c429a00b14ff903be7401a72edfe7b8d45eb2bcab`

### v1.21.118（最终当前版本）

- image: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.118`
- registry digest: `sha256:2410f68ff08ad8f645d88be43e4cfdb0d270286238911ebede53749d01322da2`
- LPK install: success
- `/api/health`: healthy, version=`1.21.118`
- Research policy: `quote0-research-triage/v12`
- Phase A/B: `local-qwen`
- Phase B: `structured-inference`
- fallback: none
- 7 个 Quote0 容器最终全部 healthy
- 7 个 RestartPolicy 全恢复 `unless-stopped`
- 本地/运行容器四个关键源码 SHA256 完全一致

v1.21.118 recycle 后真机：

- 19:27:29 delivery 19052 → eink-2 succeeded at 19:27:33
- 19:28:29 delivery 19048 → eink-2 succeeded at 19:28:32
- device runtime: `healthy`, `consecutive_failures=0`
- board: `wifi_healthy=true`, `last_push_error=""`, trace=`d108884-a1`

## 12. 当前结论

本轮把三个原先分叉的问题收敛成一个自动闭环：

`RSS registry / seed URL → server-owned Publisher provenance → Neuromancer evidence research → v12 factual gate → persisted DisplayProvenance → freshness-aware inventory → physical Satori footer`

现在：

- “来源”不再等于 Research evidence 域名；
- HN 等 aggregator 不会冒充 Publisher；
- Neuromancer Research 在真机上可见；
- 证据源数量可见；
- 低水位时 scheduler 会自行跨源找新货；
- Research backlog 会自动抑制补池；
- 池充足后自动恢复原 10min / 1 source 的低压力模式；
- consumer 优先新鲜/低复播内容，同时保留无新货时不断屏的安全网。

## 13. 未执行

- 未 Git commit
- 未 Git push
- 未 merge/rebase
- 未 reset/stash/clean
- 未覆写/删除历史 DB Research artifact
