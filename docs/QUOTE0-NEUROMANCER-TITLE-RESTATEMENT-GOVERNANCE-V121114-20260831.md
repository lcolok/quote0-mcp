# Quote0 Neuromancer 标题复述质量治理 · v1.21.114 · 2026-08-31

## 工作区与身份

- Repo: `https://github.com/lcolok/quote0-mcp.git`
- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- HEAD（本轮未 commit）: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- 生产机: `root@logic.heiyu.space`
- 发布版本: `1.21.114`

## 用户目标

治理 Quote0 中“经过 Neuromancer Research 后，成品仍然只是标题翻译/同义复述”的新闻质量问题。具体失败样本：

- inventory `18996`
- 原始标题：`Iceland rejects reopening talks on EU entry`
- 已推送标题：`冰岛拒绝重启入欧谈判`
- 已推送正文：`冰岛拒绝重启加入欧盟的谈判。`
- 原 Research run：`a0ecb5d3-16e8-4666-82e8-2c9c923bce0c`

## Dynamic Context Rebuild

历史高价值归档：

- `ctx-LKrq` — Quote0 RSS Quality × Neuromancer 深入研究治理
- `ctx-gXNz` — 新闻内容密度治理
- `ctx-uE31` — v1.21.95 Universal Research 生产发布与持续部署授权
- `ctx-cYqZ` — v1.21.94 RSS/Neuromancer/source-fair 生产状态

当前 checkout `/Users/friday/github/quote0-mcp` 落后于生产 Research 实现且存在无关设备 URL 未提交改动，因此没有在主 checkout 上修改；改用更接近生产 `v1.21.113` 的既有 worktree。

## 已验证根因

这不是 Neuromancer 没有运行，也不是 provider 绕过。

生产原 run 真实记录：

- state=`completed`
- researchMode=`digest`
- 4 次工具调用：2 search + 2 crawl
- retrieval healthy
- Phase A/Phase B provider 均为 `local-qwen`
- finalizer model=`qwen3.8-27b`
- evidence packet=5000 chars
- 但最终只有 1 条 supported claim，而且就是标题复述

最关键的 packet 实测：

- 总长度：5000 chars
- `ledger=` 前缀：4413 chars
- 四个真实 tool evidence section 合计：仅 587 chars

因此主要结构性问题是：

1. Evidence Ledger v2 的 searchCandidates/metadata 抢占了约 88% 的冻结证据包，真正 crawl 正文被严重截断。
2. 剩余 tool evidence 又按 search/crawl 等额分配；但 search snippet 只是发现线索，只有 crawl 当前可作为 supported claim 证据。
3. Structured finalizer schema 允许 `facts.minItems=1`。
4. deterministic materializer 没有“正文相对标题的信息增益”门禁，因此标题同义复述可以合法 `completed -> researchGate=ready -> pushed`。

Consumer 本身没有绕过门禁：`researchGate=pending` 的内容不会进入屏幕；失败发生在 Research 已经错误地被判为 ready 之后。

## 本轮修改

### 1. Evidence Packet 预算治理

`src/api/research-canary.ts`

- 新增 `serializeEvidenceLedgerForPacket()`。
- 固定为 tool evidence 保留至少约 55% packet 预算。
- 优先裁剪 discovery-only search candidates；绝不删除 support-eligible crawl ledger entries。
- tool section 改为加权分配：crawl=3，search=1，other=2。
- 目标：搜索线索不能再把真正可引用的 crawl 正文挤掉。

### 2. deterministic 信息增益门禁

- digest structured schema 最少要求 2 条 facts。
- materializer 同样要求 digest 在真实显示容量内至少保留 2 条完整事实；空间不足时让 finalizer 缩短句子，而不是静默退化为一句。
- 新增 title-restatement 检测：NFKC/去标点归一化 + 中文 bigram overlap。
- 若所有 facts 都只是标题翻译/扩写/同义复述，直接判 invalid，并进入既有 structured-finalizer repair retry；仍无法修复则 fail closed，不允许 ready。

### 3. Prompt 契约

`src/api/research-few-shot.ts`

明确要求 digest：

- 至少 2 条、互不重复事实；
- 正文禁止只翻译/扩写/同义复述标题；
- 至少保留数字、时间线、背景、因果、影响或下一步行动中的一种信息增益。

### 4. 回归测试

新增冰岛失败形状测试：

- 5000-char 拥挤 packet + 12 个 search candidate + 2 search + 2 crawl：真实 tool evidence section >=2500 chars，第二个 crawl 尾部的 `52.8%` 仍保留。
- 单条 `冰岛拒绝重启加入欧盟的谈判`：fail closed。
- 人为凑成两条等价标题复述：仍 fail closed，命中 `Research 信息增益不足`。

第一版只裁剪 Ledger 后测试仍失败，证明 search/crawl 等额预算是第二个真实瓶颈；随后引入 crawl:search=3:1 后通过。

## 验证结果

最终完整 gate：

- `bun test`: 326 pass / 1 skip / 0 fail / 7439 expectations
- 唯一 skip：需要真实 PostgreSQL 的 RSS source health outbox 测试
- `bun run build`: passed (`tsc -p tsconfig.build.json`)
- `git diff --check`: passed

## 发布与生产证明

仅重建 API 镜像，不重建 annotation/label/postgres/minio/redis：

- image: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.114`
- registry digest: `sha256:10264b9cc04c77b050802e8b1913ca3a81db0f81a4197114eca6b3679347d916`
- LPK `1.21.114` 安装成功

生产 health：

- status=healthy
- version=`1.21.114`
- Neuromancer agent=`pi-mono`
- Phase A=`local-qwen`
- Phase B=`local-qwen`
- Phase B mode=`structured-inference`
- fallback=`none`
- Universal Research=true

源码 attestation：本地和生产容器 SHA256 完全一致：

- `research-canary.ts`: `faac65577e140bd60f8ef0109b9616b524e73288a775c5ca47ed815eef6721e3`
- `research-few-shot.ts`: `8316b26a0ad58d990894fe60451c6a0ae8e04508315f21b12e763274b4108711`

LPK install 会把 Quote0 7 个容器 restart policy 重置为 `no`；已全部恢复并验证为 `unless-stopped`。

## 生产复跑：同一冰岛新闻

在 `1.21.114` 用相同 HN/FT seed 发起真实 manual canary：

- run=`9907e6db-e3b9-42d4-97cd-4f1fb633b558`
- state=`completed`
- 5 tool calls：2 search + 3 crawl，0 failed
- evidence packet=6000 chars
- Phase B=`local-qwen/qwen3.8-27b` structured-inference
- validationErrors=[]

最终成品：

- 标题：`冰岛选民否决重启欧盟入盟谈判`
- 正文：`冰岛选民在2026年8月30日的公投中否决了重启与欧盟的入盟谈判；此次公投的核心争议焦点集中在渔业权益保护及地缘政治稳定性上。`
- supported claims=2
- 证据来源包括 AP News 与对应公投资料页

这证明 Neuromancer 链路本身可行；旧问题是 Quote0 自己把检索证据挤掉，并允许信息增益为零的 finalizer 结果通过。

## 旧坏样本处理原则

inventory `18996` 当前仍为 `state=pushed`，保留原错误内容作为真实事故审计证据，不直接覆写历史 pushed record，避免破坏 delivery/research lineage。它不是 `ready` 待推库存，不会作为新 ready item 再次进入消费链。新代码已经把同类标题复述结果 fail closed，并有专门回归测试。

## 工作区原有改动与本轮改动边界

本 worktree 在本轮开始前已有不可覆盖资产：

- `package.json`：新增 `quality:research-corpus` script
- `scripts/replay-qwen-research-corpus.ts`：未跟踪 corpus replay 工具
- `src/api/research-canary.ts`：已有 candidateLooksServerOwned 兼容改动

本轮保留上述原有资产，没有 stash/reset/clean。

本轮新增/修改主体：

- `src/api/research-canary.ts`
- `src/api/research-canary.test.ts`
- `src/api/research-few-shot.ts`
- `lazycat/lzc-manifest.yml`
- `src/api/release-version.test.ts`
- 本 handoff 文档

未 commit、未 push、未 merge/rebase/reset/clean。

## 下一优先级

将已有 `quality:research-corpus` replay 工具补齐真实 `testdata` corpus，把 inventory 18996 / run a0ecb5d3 的生产失败形状加入长期离线质量 gate，并增加“Research 信息增益率/标题复述拒绝率”的生产指标，防止未来 prompt/model/packet 变更再次产生同类退化。
