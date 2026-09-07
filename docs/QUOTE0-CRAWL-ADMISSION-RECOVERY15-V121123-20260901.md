# Quote0 Crawl Admission + Recovery 10+5 Governance · v1.21.123 · 2026-09-01

## 用户目标

用户基于生产 delivery `366356` 的“1证据源”现象，进一步要求：

1. 加强 Neuromancer crawl 内容 admission；
2. recovery Research 的工具预算从 10 放宽到 15 可以接受。

目标不是机械增加 tool calls，而是提高“搜索候选 → crawl → support ledger → final claim”的有效证据产出率。

## 工作区 / Git 边界

- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- 本轮未 commit / push / merge / rebase / reset / stash / clean。
- 保留此前 v1.21.114–121 已部署但未提交治理改动，以及既有 corpus replay WIP。

## Dynamic Context Rebuild

Preflight：

- tlens `v0.2.9-89-g7dcb97e`
- tlens backend healthy
- skldr `0.3.62+introspect.d35e07a`

当前 tlens 已无 `timeline` 子命令；按当前 binary `--help` 执行，不使用旧记忆猜 flag。

关键历史：

- `ctx-lPsp`：信息增益 E0，seed-only/high-risk 是最值得扩大 Research 的场景；边际 supported-claim gain 应成为停止条件。
- `ctx-LKrq`：生产上 recovery 明显比 digest 深，digest 曾存在过早停止问题。
- `ctx-PcWo`：v1.21.114 evidence packet / title-restatement governance。
- `ctx-9USP`：delivery 366356 精确诊断：旧 recovery 10/10 calls，但 Receipt 最后只有 InfoQ 一个引用源；E9 今日头条空正文/JS wall 仍被旧 ledger 标 supportEligible。

## 精确基线：delivery 366356

- subject: `502eb8bfbaa056ca49e759d50246eec6`
- delivery: `366356`
- inventory: `19059`
- Research run: `c861d355-ea01-4853-b36d-f1c52480391f`
- Seed: InfoQ，原始正文仅 `点击查看原文>`（7 chars）
- mode: recovery
- old policy: v12
- runtime: 10 tools = 5 search + 5 crawl，0 failed
- Evidence Packet: ~7532 chars

旧 Ledger support entries：

- E1 InfoQ：真实 Harness 原文
- E4 网易：AICon 大会/讲师综述
- E7 掘金：同公司同大会但另一 Agent 主题
- E9 今日头条：crawl 实际为空 JSON / JS requirement shell，却被标 supportEligible

最终两条 claim 都只引用 E1，因此旧 footer 显示 `1证据源`。

## v13：crawl completed != support-eligible

Research policy 升为：

`quote0-research-triage/v13`

新增严格 crawl evidence admission：

### Transport unwrap

`crawlTextFragments()` 会递归解开字符串化 JSON transport wrapper，只提取真实：

- formatted
- markdown
- text
- body
- content
- description

若 JSON wrapper 内这些字段都是空，不会把 JSON key / URL 本身当成语义正文。

### Block/shell rejection

拒绝：

- 403 / 404 / access denied / captcha
- checking your browser / just a moment
- enable JavaScript / JavaScript disabled
- 中文 `需要允许该网站执行 JavaScript` / `请启用 JavaScript`
- sign in / log in shells

### Semantic evidence gate

HTTP/tool `completed` 只代表抓取动作成功，不代表内容可以支持事实。

新的 support admission 还要求：

- `assessSourceEvidence()` 不能是 `seed-only`
- `evidenceAtoms >= 1`

因此短但有一个真实事实的 sparse 官方页面仍然可以进入；空正文、导航壳、标题复述、JS 壁不能进入。

新增真实 366356 回归明确锁住：

- InfoQ substantive body：admit
- Toutiao stringified empty JSON：reject
- Toutiao `您需要允许该网站执行 JavaScript`：reject

`toolSummary.successfulCrawlRequests` 仍如实记录动作成功次数，但 ledger.entries 只存证据合格内容。

## Recovery 从 flat 10 改成 10 + 条件 5

v13 recovery budget：

- `maxToolCalls=15`
- `initialToolCalls=10`
- `extensionToolCalls=5`
- `maxPostSeedArtifacts=6`
- `maxPublishableClaims=5`
- `maxFinalizationRetries=1`
- `maxEvidenceChars=10000`
- `targetIndependentClusters=2`

### 为什么不是初始直接 15

初始 Phase A 的 Straylight header 仍是 **10**。

Quote0 `inspectResearchCanary()` 机器级 hard gate：

- 没有 extensionReceipt：phase limit = 10
- 有 Quote0 条件扩展授权：累计 limit = 15

所以若初始 Agent 异常跑出第 11 次 call，会直接 invalid；不会因为总预算 15 而偷偷放过。

### 条件 5 的原则

达到 10 后 Quote0 读取 frozen Evidence Ledger：

- minimum evidence/search 缺口 → required repair
- 已有高相关、尚未 crawl、不同 provenance 的候选 → optional evidence-gain extension
- 没有新增高价值候选 → 直接 finalization

Optional recovery extension 不允许开启新的宽泛 search round，只转换已经发现的高相关候选；最多 5，不要求机械耗尽。

## Extension capability：prompt 白名单 + machine gate

v1.21.122 第一次生产 canary 暴露了一个关键坑。

### v1.21.122 canary

同一 366356 seed：

- run `87c32ea7-f751-48df-a0ae-c96b198f9a96`
- v13 recovery
- first stage exactly 10 calls = 7 crawl + 3 search
- deterministic gate 进入 `research->conditional-extension`
- 只授权：`https://www.toutiao.com/article/7657063975737164330`

但当时授权 URL 只存在服务器 extension receipt，没有显式写进 Neuromancer prompt。Agent 自己改去 crawl：

`https://m.163.com/dy/article/KV0AEAMP0519CUHG.html?clickfrom=subscribe`

机器 validator 正确 fail closed：

`optional extension crawl 越权`

因此 v1.21.122 安全地没有把越权 evidence 晋升，但这会浪费 Research。

### v1.21.123 修复

Prompt 现在明确列出：

`Quote0 明确授权的候选 URL（白名单）`

并声明：

- novel-evidence extension 只能 crawl 白名单 URL；
- Evidence Packet 中其它候选没有本段 capability；
- 禁止自行替换 URL。

机器 validator 同时继续逐次检查：

- 必须是 crawl
- 每个 actual canonical URL 必须在 authorized whitelist
- 不能重复 crawl
- search/browser 或 URL substitution → invalid

所以 prompt 不是安全边界，machine gate 仍是最终 authority；prompt 负责降低安全拒绝带来的无效消耗。

## Policy rollout：v13 新产物 + v12 replay 兼容

直接从 v12 切 v13 且 consumer 只认 current policy，会把现有 v12 ready/pushed pool 瞬间踢出播放集合。

生产迁移前 72h 有约：

- 30 v12 pushed
- 1 v12 ready

因此新增：

`RESEARCH_REPLAY_COMPATIBLE_POLICY_VERSIONS = [v13, v12]`

规则：

- 新 Research run / artifact 一律写 v13；
- supply snapshot / ready consumer / fallback replay 暂时接受 v13 + v12；
- 不重跑、不改写历史 v12 Research。

生产证明：v1.21.123 安装后，`eink-2` 仍持续成功播放 v12：

- 02:23:02 inventory 19057 succeeded
- 02:23:41 inventory 19058 succeeded
- 02:24:45 inventory 19071 succeeded

迁移没有造成断粮。

## 最终生产 canary · v1.21.123

同一 delivery 366356 seed，独立 manual canary，不写 inventory、不自动发布：

- run: `21c90a8c-37b6-4e75-b8e6-4a58b122552c`
- policy: v13
- mode: recovery
- budget: 10 + conditional 5 / max15
- state: completed
- actual runtime: **7 tools = 4 crawl + 3 search**
- failed tools: 0
- Retrieval: healthy
- Engines: 360search / bing / scrapling

这次在 7 calls 时已获得足够高价值证据，所以按 marginal-gain stop **没有机械跑到 10，更没有触发 5-call extension**。

最终 frozen ledger support entries：

1. E1 InfoQ — 原始 Harness 演讲文章
2. E4 掘金 — `EP-Harness：从个人 AI Coding 到团队级 Agent 工作流｜得物技术`
3. E5 腾讯云 — `从狂野代码到按目标生产：得物推荐 AI Harness 的工程化实践｜AICon 演讲整理`
4. E7 CSDN — `得物技术揭秘：AI Harness 工程化实践，从代码生成到目标生产的跃迁`

Search：

- total candidates = 32
- relevant = 2
- rejected low relevance = 30

**Toutiao 空壳不在 support ledger。**

最终 materializer 没有为了“来源数量好看”强行引用全部四个，而是选择：

- claim 1 → E1
- claim 2 → E1 + E7

Receipt sources = 2：

- InfoQ
- CSDN

DisplayProvenance `evidenceSourceCount=2`。

相较旧 v12 同一 seed 的 1 个最终引用源，新 v13 canary 得到 2 个，并且第二条具体 PDCA / 七阶段护栏主张有双源支持。

## 验证

最终 v1.21.123 release gate：

- `bun test`: **344 pass / 1 skip / 0 fail**
- expectations: **7502**
- 唯一 skip：既有 real PostgreSQL RSS source-health outbox
- `bun run build`: PASS
- `git diff --check`: PASS

重点新增/扩展测试：

- recovery budget = 10 + conditional 5
- no extensionReceipt 时第 11 个初始 call fail closed
- 366356 empty JSON / JS shell admission rejection
- short substantive evidence compatibility
- multiple optional extension crawls must all be whitelist-authorized
- extension search/browser rejected
- authorized candidate URLs explicitly present in prompt
- v12 + v13 consumer replay compatibility

## 发布

Final app release: **v1.21.123**

- news-api: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.123`
- image ID: `sha256:751973a7bd6c6ac4b498c534397058535e275bb05855738785768cd295156912`
- registry digest: `sha256:fe57ad30c2a2ca121a2e9dcef5218c75d32b5775fdad75bfeb39ba35cdd43d77`
- annotation-web remains v1.21.120
- label-web remains v1.21.29

LPK install: success.

Production health：

- version `1.21.123`
- triage `quote0-research-triage/v13`
- Phase A/B local-qwen
- structured-inference
- fallback none
- 7 Quote0 containers running/healthy after startup
- 7 restart policies restored to `unless-stopped`

## 结论

用户提出“加强 crawl admission + recovery 放宽到15”是正确方向，但最终实现不是 flat 15，而是：

`strict crawl admission + recovery 10 + deterministic conditional 5 + URL capability whitelist + machine enforcement + marginal-gain stop`

这使额外预算只在有证据增益机会时使用；同时 prevents completed-but-empty/browser-shell pages from inflating evidence counts。

## Git 边界

未 commit / push。当前 worktree 继续包含此前 v1.21.114–121 治理资产、本轮 v1.21.123 Research v13 改动，以及既有 corpus replay WIP。