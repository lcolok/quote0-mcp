# Quote0 真实推送质量治理 · v1.21.116 · 2026-08-31

## 用户反馈

用户在 v1.21.114 “标题复述”治理上线后继续观察到：真实屏幕推送的内容质量似乎没有明显改善。

本轮以 **真实 device delivery** 而非 manual canary 作为验收 SSoT。

## 工作区 / Git 边界

- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- 本轮未 commit / push / merge / rebase / reset / clean。
- 工作区原有不可覆盖资产仍保留：`package.json` 的 corpus replay script 与未跟踪 `scripts/replay-qwen-research-corpus.ts`，以及上一轮 v1.21.114 治理改动。

## Dynamic Context Rebuild

Preflight：

- tlens `v0.2.9-85-g3138808`
- tlens remote backend healthy
- skldr `0.3.62+introspect.d35e07a`
- 当前 tlens 已没有 `timeline` 子命令；通过 `tlens --help` 确认，不再按旧记忆调用。
- 高价值历史：`ctx-PcWo`（v1.21.114 标题复述治理）。

## 生产复盘：用户判断成立

### 1. v1.21.114 上线后，屏幕仍主要在播旧库存

抓取 `eink-2` 从 v1.21.114 部署后的真实 delivery：

| Cohort | displays | unique items | avg message chars | avg claims |
|---|---:|---:|---:|---:|
| post-fix Research | 44 | 10 | 122.5 | 2.30 |
| pre-fix replay | 168 | 37 | 88.0 | 2.09 |

即约 **79.2%** 显示仍是旧 Research 成品 replay。因此即使新生成逻辑变好，用户肉眼仍主要看到旧质量分布。

### 2. v1.21.114 新生成内容仍存在标题/正文跨主题漂移

真实新产物 inventory `19032`（Research 完成于 13:38，明确晚于 v1.21.114 部署）：

- Raw seed: `InfoQ 2026 年云计算与 DevOps 趋势报告`
- Final title: `AWS美东1区故障致多网站宕机`
- Final message: `InfoQ发布了2026年云计算与DevOps趋势报告...；Linux基金会宣布成立Agentic AI基金会（AAIF）...`

Research evidence packet 同时包含 InfoQ/AAIF 与 AWS outage 证据。根因是 schema 只给 `facts[].evidenceIds` 做 grounding，而 `titleCandidates` 只是自由字符串；服务器验证“facts 有证据”，却没有验证“标题是这些 facts 的摘要”。因此 Qwen 可以从另一个 Evidence 子话题挑标题并合法通过。

### 3. v1.21.115 修复旧 replay + 标题错配后，仍出现 sparse 单事实成品

v1.21.115 引入：

- policy `quote0-research-triage/v11`
- ready artifact 写入 `researchPolicyVersion`
- consumer 只 replay 当前 policy 的 Research artifact
- deterministic title ↔ fact 主题一致性校验

部署后旧 v10 立刻被隔离，consumer 连续返回 `inventory_empty`，证明 legacy Research replay 已停止。

但随后真实新鲜 inventory `19041`（少数派/明基）完成 v11 Research 后仍推到屏幕：

- title: `明基十年深耕一束光应用`
- message: `明基在走过十年的发展历程中，持续探索屏幕之外、桌面之上的一束光的更多可能性。`
- claims: 1
- `content-quality/v2`: `sparse / limited / single-evidence-atom`

因此“标题正文一致”仍不足以代表新闻质量；Universal Research 必须有一个统一的信息量发布门。

## 最终治理：v1.21.116 / policy v12

### A. 当前 policy 才能 replay

`src/api/universal-research-policy.ts`

- `researchGate=ready` 时写入 `researchPolicyVersion`。

`src/api/news-scheduler.ts`

- 对 `researchGate.required=true` 的 ready/pushed item，只有 `researchPolicyVersion === RESEARCH_TRIAGE_POLICY_VERSION` 才能进入 consumer。
- 非 Research legacy item 仍保持兼容。

效果：v12 部署后 v10/v11 Research artifact 自动退出 replay，无需篡改历史 DB 记录。

### B. 标题必须是 supported fact 的紧凑摘要

`src/api/research-canary.ts`

- title candidate 必须与至少一条 valid fact 做 deterministic topic alignment。
- 使用 NFKC 归一化、去标点、CJK bigram overlap；明显跨话题标题 fail closed。
- selected facts 完成容量装箱后再次校验 title ↔ selected fact 对齐。

真实 `19032` AWS 标题 + InfoQ/AAIF facts 失败形状已经写入回归测试。

### C. Universal Research 所有模式最低 2 facts

此前只对 digest 做 2-fact 最低门槛，enrichment/recovery 仍可产一条事实。

v12 改为：只要 decision 含 `universal-evidence`，structured schema + materializer 都要求至少 2 条完整 supported facts。

因此 `19041` 明基单 claim 形状现在 deterministic fail closed。

### D. 复用 `content-quality/v2` 做最终发布门

最终 message 组装后调用：

`assessSourceEvidence({ title, content: message })`

Universal Research 只有 `mode=adequate / sufficiency=sufficient` 才允许 materialize；`seed-only` / `sparse` 一律返回 validator feedback，进入既有 Phase-B retry，仍不达标则 invalid，不会变成 ready。

这是“事实原子/硬事实/相对标题 novelty”判据，不是固定字数阈值。

### E. Prompt 只作软约束，deterministic gate 才是最终裁决

`src/api/research-few-shot.ts` 同步要求：

- Universal 至少 2 条 facts；
- title 必须是 facts 中某条高优先事实的紧凑摘要；
- 禁止从 Evidence Packet 其他子话题另挑吸睛标题。

即使模型不遵守，服务器端硬门仍会拒绝。

## 验证

最终完整 gate：

- `bun test`: **328 pass / 1 skip / 0 fail / 7450 expectations**
- 唯一 skip：需要真实 PostgreSQL 的 RSS source-health outbox 测试
- `bun run build`: PASS
- `git diff --check`: PASS

## 生产发布

### v1.21.115（中间验证版本）

- 用于验证 current-policy replay 隔离 + title/fact alignment。
- 真实证明旧 v10 不再播放，但发现 v11 `19041` sparse 单事实缺口。

### v1.21.116（最终当前版本）

- image: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.116`
- registry digest: `sha256:a2c2ecb22eca9afbec1d8c17b7b08cd6c921fd6cc150e5aa1a691e2bd7d2d171`
- install: success
- health: `healthy`, version=`1.21.116`
- Research policy: `quote0-research-triage/v12`
- Phase A provider: `local-qwen`
- Phase B provider: `local-qwen`
- Phase B mode: `structured-inference`
- fallback: none
- Universal Research: true
- install 后 7 个 Quote0 容器 RestartPolicy 已恢复 `unless-stopped`

## v12 真实屏幕 E2E

### inventory 19043 · InfoQ Bun 1.4

- Research policy: v12
- Research mode: recovery
- tool calls: 10 = 7 crawl + 3 search
- failed calls: 0
- final title: `Bun 1.4落地：2900个问题清零`
- final message: `Bun 1.4稳定版正式发布，距离此前计划跳票约一个半月；该版本在发布前清零了2900个已知问题。`
- supported claims: 2
- `content-quality/v2`: `adequate / sufficient`
- evidence atoms: 2
- hard facts: 1
- novelty: 0.7619
- `eink-2` physical delivery: **succeeded at 16:45:45**

### inventory 19044 · DEV / n8n monitor

- Research policy: v12
- Research mode: digest
- tool calls: 3 = 2 crawl + 1 search
- failed calls: 0
- final title: `n8n监控发现IF分支缺失仍报成功`
- final message: `在自托管n8n 2.36.7版本中，当IF条件不再匹配时，对应分支节点完全从resultData.runData中消失，而非显示失败状态；尽管关键节点数据缺失，n8n执行报告仍标记状态为success，导致监控工具误判工作流正常产出。`
- supported claims: 2
- `content-quality/v2`: `adequate / sufficient`
- evidence atoms: 2
- hard facts: 1
- novelty: 0.9375
- `eink-2` physical delivery: **succeeded at 16:46:45**

连续两条 v12 自然 Research → consumer → physical delivery 都通过，且没有旧 policy 混入。

## 结论

用户对 v1.21.114 的反馈是正确的。上一轮治理只解决了一个失败形状，并没有让“用户真实屏幕分布”立刻变好。

最终根因是三层叠加：

1. 旧 Research replay 占据绝大部分展示份额；
2. title 没有和 supported facts 做 grounding，可跨 Evidence 子话题漂移；
3. enrichment/recovery 允许单条 sparse fact 也进入 ready。

v1.21.116 现在把这三层都收进 deterministic publication gate，并用两个真实 v12 物理 delivery 验证。

## 仍未执行

- Git commit
- Git push
- merge/rebase
- reset/stash/clean
- 历史 DB 内容覆写/删除

旧坏样本继续作为审计证据保留，但 current-policy consumer 不会再 replay 它们。
