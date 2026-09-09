# Quote0 新闻内容复盘治理 — 2026-08-21

## 结论

本轮复盘确认：Quote0 v1.21.92 的 Universal Evidence Research 已经解决了“不是所有新闻都经过 Neuromancer”的上一阶段问题，但它同时暴露出第二层治理缺口：**事实有依据，不等于内容值得作为新闻推送；Research 完成，也不等于最终 artifact 的非事实字段可信。**

当前最重要的发现按优先级排序：

1. **P0：Research finalizer 正在篡改产品拥有的发布时间。**
   - 生产样本 18407 / 18404 / 18400 / 18387 / 18373 的 raw/feed `publishTime` 分别是 2026-08-20/21。
   - 对应 DEV.to 原页 JSON-LD `datePublished` 5/5 与 raw/feed 时间一致。
   - Neuromancer 最终 artifact 却把 5 条改成 2024/2025，最大漂移约 730 天。
   - 18407 的 Evidence Packet 只有网页可见文本 `Posted on Aug 21`，没有年份；生产 `ResearchSeed` 不含 `publishTime`，finalizer contract 却要求模型自行输出 ISO `publishTime`，导致模型猜年份。
   - 18407 已实际进入 `state=pushed`，因此不是仅审阅环境的问题。

2. **P1：Universal Research 缺少“新闻价值 / editorial utility”门。**
   - 生产已经把个人 Wi-Fi 配置、学生黑客松成长日志、个人博客 AI disclosure、个人项目开发日志等内容作为普通新闻推送。
   - 这些内容可以被可靠总结，但“可总结”不代表“应进入新闻流”。
   - 当前 `contentQuality` 主要评估 evidence mode、unsupported hard facts、长度和可渲染性，没有评估 newsworthiness / public impact / timeliness / content kind。

3. **P1：`supported` 语义没有等价于独立核验，高风险路由范围不足。**
   - 18397 安全事件进入 `verification`，得到 Cisco Talos 两个 official 来源，证据质量明显较高。
   - 18378 “TikTok/Reels 让认知控制网络失活”仍是 `digest`；最终主张只由一个博客 seed 支持，HN 仅是 community discussion。
   - 法律版权、监管、科学/健康、重大商业断言没有稳定进入与安全事件同等级的 verification。

4. **P1：质量闭环在 Universal rollout 后没有继续运行。**
   - `neuromancer_artifact_reviews = 0`，真实 human paired review 仍无标签。
   - `neuromancer_synthetic_evaluations = 18`，最新仍停在 2026-08-20 19:39 +08。
   - Universal 窗口（inventory 18370+）进入 synthetic evaluation 的条目数为 0。
   - `quality_annotations` 本轮窗口新增为 0。
   - 所以系统现在是“每条都 Research”，但没有持续回答“Research 后这条新闻值不值得推”。

5. **P2：Research tool budget 仍是 post-hoc gate，不是硬 runtime cap。**
   - 本轮看到 digest 5 > 4、recovery 11 > 10 等 invalid。
   - 这些条目之后都通过 retry 完成，目前 Universal gate `pending=0 / ready=41`，没有积压。
   - 但它仍浪费工具调用和延迟，应在 Straylight execution 层做到真正 stop-at-cap。

6. **P0 基础设施债务：生产 v1.21.92 源码未进入 Git。**
   - 远端 `origin/main` 当前仍是 v1.21.86 基线 `4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e`。
   - v1.21.92 来源于 Devspace 管理的 dirty detached worktree，未 commit / push / release ref。
   - 这使得任何线上热修都存在把 Universal Research 变更倒退的风险。

---

## 工作区与证据边界

### Git

Remote:

```text
https://github.com/lcolok/quote0-mcp.git
```

主 checkout：

```text
/Users/friday/github/quote0-mcp
branch: governance/workflow-phase1-20260820
HEAD:   652903821d44fa8128731dd7bbb34f12b81a2889
status: clean
```

本轮隔离补丁 worktree：

```text
/Users/friday/github/_worktrees/quote0-content-governance-20260821
HEAD: 4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
mode: detached worktree from origin/main
```

v1.21.92 归档指出的生产源码 worktree：

```text
/Users/friday/.devspace/worktrees/quote0-mcp-18f7a711
base: 4fe2245
state: dirty detached worktree
```

该路径不在当前 Devspace allowed root 内，不能作为安全写入目标。本轮只通过运行中容器做只读 source attestation / 诊断，不直接覆盖生产源码。

### Dynamic Context Rebuild

Preflight:

```text
tlens v0.2.9-50-g49ed60e
tlens doctor backend: healthy
skldr 0.3.62
```

`tlens timeline` 可用，但 `tlens search` 连续三次对中央搜索端点超时，故本轮明确标记 tlens semantic retrieval degraded；未伪造 tlens 历史证据。

高价值 skldr：

- `ctx-XMzO` — v1.21.92 Universal Evidence Research production
- `ctx-PcVy` — Content Quality v2 + Neuromancer Evidence-Gain
- `ctx-YBqo` — v1.21.89 Synthetic Content Evaluation
- `ctx-UkJ4` — v1.21.86 paired review production closure
- `ctx-LK4N` — earlier Neuromancer content-governance analysis

`ctx-LK4N` 已经明确提出过 temporal ownership 风险，但 v1.21.92 仍让模型输出 `publishTime`，因此本轮观察到的是旧风险在 Universal rollout 后的真实生产复现。

---

## 当前生产状态

运行中 News API：

```text
version: v1.21.92
health:  healthy
```

Universal gate snapshot：

```text
ready:   41
pending: 0
```

Research runs（2026-08-21 03:00 +08 之后）：

```text
digest       completed 24 / invalid 3
enrichment   completed  5
recovery     completed 11 / invalid 2
verification completed  1
```

invalid 条目 18399 / 18394 / 18384 / 18372 / 18370 后续都成功 retry 为 completed；当前没有 Universal backlog。

---

## 生产内容抽样：Research 的真实收益与缺口

### 来源级统计

当前 41 条 completed Universal Research：

| source | items | avg tools | avg searches | avg sources | single-source | zero-search | avg claims |
|---|---:|---:|---:|---:|---:|---:|---:|
| dev-to | 11 | 2.4 | 0.8 | 1.4 | 9 | 6 | 2.3 |
| hackernews | 11 | 3.3 | 1.3 | 1.9 | 3 | 3 | 2.1 |
| infoq-cn | 11 | 6.2 | 3.1 | 1.8 | 3 | 0 | 2.3 |
| arstechnica | 4 | 5.5 | 3.5 | 1.8 | 2 | 0 | 2.0 |
| github-changelog | 2 | 3.5 | 1.5 | 1.0 | 2 | 1 | 2.0 |
| sspai | 2 | 2.5 | 1.0 | 1.5 | 1 | 0 | 2.5 |

Interpretation：

- Universal Research 在 recovery / verification 上价值明显。
- 大量 digest 尤其 DEV.to 只是 re-crawl seed，并未形成独立证据增益。
- **单来源并不自动等于低质量**：GitHub 官方 changelog 可以单来源即高可信；个人博客强断言则不同。因此不能用“sources >= 2”一刀切。

### 低增益且已真实 pushed 的代表样本

| id | source | 内容 | Research 行为 | 建议 editorial disposition |
|---:|---|---|---|---|
| 18407 | DEV.to | 表单 dirty state / idempotency 教程 | 1 crawl / 0 search / 1 source | `reading`，非时效新闻 |
| 18404 | DEV.to | “我的博客由 Claude 撰写”个人 disclosure | 1 / 0 / 1 | `hold` |
| 18400 | DEV.to | 学生黑客松 / cloud / AI 成长经历 | 1 / 0 / 1 | `hold` |
| 18387 | DEV.to | KittyClaw 个人项目开发日志 | 1 / 0 / 1 | `reading` 或 `hold` |
| 18383 | DEV.to | 个人 Wi-Fi 四网络配置 | 2 / 0 / 1 | `hold` |
| 18374 | GitHub changelog | Code Quality audit log 变更 | 1 / 0 / 1 | `deliver`，官方产品更新 |

这组样本证明：不能简单用 source 名、工具数或 source count 做 gate；核心缺的是 **content kind + newsworthiness + impact**。

### 高风险 evidence 对比

#### 好例：18397 Cisco Talos

```text
mode: verification
tools: 7
sources: DEV seed + Cisco Talos official + Cisco Talos official
claims: 3 supported
```

最终卡片对攻击者、AI 辅助攻击代码、SPECTRE 和目标规模有明确来源归因，符合高风险 Research 预期。

#### 风险例：18378 TikTok / Reels cognition

```text
mode: digest
tools: 4
sources: 单一博客 seed + Hacker News community
关键科学主张 supported sourceIds=[seed]
```

“研究称观看 TikTok 和 Instagram Reels 会使大脑认知控制网络失活”属于强科学/健康影响表述，但没有 primary paper / journal / institutional source，仍进入普通推送。

#### 法律例：18389 EU copyright

```text
mode: digest
sources: Mathstodon + EUobserver interview
```

最终表达已做部分归因（“用户称”“学者指”），比写成绝对法律结论更好，但仍说明当前 high-risk classifier 没稳定把版权法律问题送进 verification。

---

## P0 时间所有权事故

### 生产数据

41 个带 raw/result `publishTime` 的 completed item 中：

```text
raw vs Research drift > 24h: 13
drift > 72h:            10
drift > 30d:             5
```

> 这些 drift 不应一概视为错误。例如 Hacker News 可以在今天讨论一篇旧文章，feed event time 与 canonical article time 本来就不同。真正的问题是当前系统只用一个 `publishTime` 字段承载多个不同时间语义，而且最终字段由模型控制。

5 个 >30d DEV.to 样本是确定性错误：

| id | raw/feed | DEV.to JSON-LD | Research final |
|---:|---|---|---|
| 18407 | 2026-08-21 07:07Z | 2026-08-21 07:07Z | **2024-08-21** |
| 18404 | 2026-08-21 05:20Z | 2026-08-21 05:20Z | **2025-08-21** |
| 18400 | 2026-08-21 04:32Z | 2026-08-21 04:32Z | **2025-08-21** |
| 18387 | 2026-08-21 00:02Z | 2026-08-21 00:02Z | **2025-08-21** |
| 18373 | 2026-08-20 19:13Z | 2026-08-20 19:13Z | **2025-08-20** |

18407 Evidence Packet 中 crawl 页面正文只含：

```text
Posted on
Aug 21
```

当前生产源 attestation：

```ts
export interface ResearchSeed {
  title: string;
  content?: string;
  source?: string;
  link?: string;
  category?: string;
}
```

`seedReceipt()` 也没有 time；与此同时 finalizer JSON contract 要求：

```json
"publishTime": "ISO-8601时间"
```

最终 `materializeArtifact()` 对模型返回的 candidate 直接 `validateRenderableNews()`，没有用 seed time 覆盖。

### 正确所有权模型

最小修复：

```text
RSS / producer admitted time  -> ResearchSeed.publishTime
ResearchSeed.publishTime      -> Phase A/B prompt + Receipt seed
model candidate.publishTime   -> advisory only
materialize final publishTime -> deterministic seed.publishTime override
```

进一步应拆开：

```text
seedPublishTime            # feed / producer event identity，产品拥有
canonicalSourcePublishTime # canonical article 原始发表时间，可选证据字段
researchGeneratedAt        # Research runtime time
inventoryCreatedAt         # Quote0 ingestion time
```

不要再让单个 `publishTime` 同时承担四种语义。

---

## 本轮已落地的 P0 补丁原型

由于 v1.21.92 源码没有进入 Git，本轮没有冒险部署。补丁在 `origin/main@4fe2245` 的隔离 worktree 上实现并验证，目的是建立可 cherry-pick / forward-port 的确定性修复。

修改：

- `src/api/research-triage.ts`
  - `ResearchSeed` 增加 `publishTime?: string`。
- `src/api/research-canary-worker.ts`
  - 从 `raw_content.publishTime` 解析并标准化到 Seed。
- `src/api/research-canary-api.ts`
  - 手工 canary seed 同样支持合法 ISO time。
- `src/api/research-few-shot.ts`
  - Phase A/B Seed 显式包含 publishTime。
  - Prompt 明确禁止根据 `Aug 21` 之类无年份文本自行推断年份。
- `src/api/research-canary.ts`
  - Receipt seed 持久化 publishTime。
  - `materializeArtifact()` 在 validator 前用 product-owned seed time 确定性覆盖模型 candidate。
- Tests
  - 回归 fixture 故意让 finalizer 返回 `2024-08-21`，seed 为 `2026-08-21`；最终 artifact 与 Receipt 必须保持 2026 seed time。

验证：

```text
Targeted: 29 pass / 0 fail / 111 assertions
Full:     239 pass / 0 fail / 7045 assertions
TypeScript production build: PASS
git diff --check: PASS
```

这证明“产品时间所有权”方案在已提交基线中是兼容且可回归的；**不证明 v1.21.92 已修复或已部署。**

---

## 建议的 Content Governance v3

### 1. Evidence Gate 与 Editorial Gate 分离

不要把“Research 完成”当作“新闻可推送”。建议改成：

```text
producer draft
  -> evidence assessment
  -> Universal Research
  -> grounded claim gate
  -> editorial utility gate
  -> ready / reading / verify / hold
  -> consumer delivery
```

### 2. Editorial disposition

建议引入来源无关的四态：

```text
deliver  当前事件 / 产品发布 / outage / 安全事件 / 政策变化 / 研究新结果等，值得即时新闻位
reading  高质量教程 / 分析 / opinion / architecture，但不是“今天发生的新闻”
verify   高风险或高影响断言，现有证据不足以安全推送
hold     个人日记、配置清单、成长记录、明显自我宣传、低公共价值内容
```

关键点：**不要 hardcode `DEV.to = hold`。** 同一来源既有 18397 这种高价值安全情报，也有 18383 这种个人 Wi-Fi 配置。

### 3. 风险升级矩阵

除现有 security/legal 关键词外，至少增加：

- health / medical / neuroscience / cognition / exposure / mortality / efficacy；
- research causal claims / “study finds” / 大脑失活等强科学结论；
- regulation / ban / copyright / privacy / antitrust / sanctions；
- acquisition / layoffs / valuation / price / market-moving business claims；
- 极大数量级或明显 sensational claims。

高风险最小 evidence contract：

```text
primary/official >= 1
independent cluster target >= 2   # 在确实可取得独立来源时
否则必须明确 attribution / uncertainty
```

官方 changelog 等第一方自述可以单来源 deliver，但只能支持“官方宣布/发布了 X”，不能把营销效果宣称升级为独立事实。

### 4. 恢复持续评估闭环

v1.21.89 的 synthetic evaluation 已证明两模型族能发现 Research 退化，但 Universal rollout 后没有继续执行。

建议：

- 对 Universal 流量持续抽样，而不是只评旧 cohort；
- 增加 `newsworthiness` / `editorialUtility` 维度，而不只 factualConfidence / informationDensity / einkSuitability；
- synthetic 明确继续与 human label 分离；
- 至少收集一小批真实 human paired + admission labels，校准 hold/reading/deliver；
- 不允许 synthetic judge 直接批准 production policy change。

### 5. Tool budget 变成 execution hard stop

当前 prompt 写“最多 N 次”+ Quote0 post-hoc invalid 会导致 5>4、11>10。

正确位置应是 Straylight/agent tool dispatcher：

```text
remainingBudget == 0 -> tool call rejected / phase ends
```

Quote0 validator 继续保留为 defense-in-depth，但不应成为第一道预算执行器。

---

## 本轮模拟编辑标注（非 human gold）

这些仅用于制定 gate，不得写入 `neuromancer_artifact_reviews` 冒充用户人工标签：

### deliver

- 18409 Vercel v0 API：产品/API 发布，有 official + seed evidence。
- 18397 Cisco Talos UAT-10147：高风险安全事件，official evidence 强。
- 18393 GitHub saved-view change：官方 changelog，单源可以成立。
- 18398 GitHub outage：当前服务事件，具即时性。

### reading

- 18407 form idempotency：技术内容有用，但属于 evergreen tutorial。
- 18405 small software team：观点/趋势分析，应离开即时新闻位。
- 18399 Pod as worker：架构文章，可进入阅读池。
- 18392 MCP C# SDK：技术问题/教程，更适合作为 developer reading。

### hold

- 18404 “Claude writes my blog”：个人 disclosure。
- 18400 学生 hackathon journey：个人成长记录。
- 18383 My Wi-Fi networks：个人配置清单。

### verify / stronger attribution

- 18378 TikTok/Reels cognition：强科学/认知断言，缺 primary research。
- 18389 EU AI copyright：法律结论需更稳定的 authority / attribution。
- 18402 AI companies destroy physical books：强数量级断言当前只有 seed 自身支撑。
- 18384 Aaron Swartz vs Meta：历史事实 + 强价值判断混合，应拆开 attribution。

---

## 当前未完成与阻塞

1. **没有部署 P0 修复。** 原因不是测试不足，而是 v1.21.92 生产源码没有可复现 Git 基线；从 v1.21.86 build 新镜像会回退 Universal Research。
2. **没有提交或 push。** 用户本轮未授权 commit/push，而且当前修复仍需要 forward-port 到真实 v1.21.92 source。
3. Devspace `register_intent` / `record_decision` 均返回 `no MCP session id available`，本轮以 skldr handoff 补足可追溯性。
4. tlens backend healthy，但 semantic search 连续超时；原始会话检索存在基础设施降级。

---

## 最高优先级下一步

**先回收 v1.21.92 dirty production source 进入 Git，再 forward-port 本轮 product-owned publishTime P0 patch，并用真实 18407 regression fixture 在 v1.21.92 全量测试后部署。**

紧接着做 Content Governance v3 的最小垂直切片：

```text
editorial disposition = deliver | reading | verify | hold
```

先在 shadow mode 给现有 41 条 Universal 样本打标，不改变设备推送；用本轮人工模拟标签 + synthetic judge + 少量真实 human labels 做 calibration。确认误杀率后，再让 consumer 只消费 `deliver`，`reading` 进入独立低频池，`verify/hold` 不进入普通新闻位。
