# Quote0 Research Phase B · terminal-tool 模式（Phase 1）

- 日期：2026-09-07
- 分支：`feat/research-terminal-tool-20260907`
- 状态：Phase 1 实现 + 全仓测试通过（`bun test` 绿，`tsc -p tsconfig.build.json` exit 0）
- 关联：Straylight 侧按同一契约并行施工，本仓不单方面改字段名。

## TL;DR

Phase A 结束时，Quote0 不再新开呕吼线程跑结构化成稿，而是**在同一 Straylight 线程**发起一次
续跑 job，要求 agent **只调用一次** `finish_research_turn` 工具提交结构化提案。该工具由
Straylight 代理通过独立 Bearer 回调 Quote0 校验端点；Quote0 用**现有全部发布门**裁决，并把裁决作为
可信工具结果返回。线程因此以「提案 + 服务器裁决」收尾，Straylight 线程留下终稿记录。

- 默认模式仍是 `structured-inference`（现状逐字节不变）。
- 新模式由 `QUOTE0_RESEARCH_PHASE_B_MODE=terminal-tool` 开启。
- 每次 research_run 创建时**冻结**该模式（写入 run 的 triage.phaseBMode），中途改 env 不影响在途 run。

## 跨仓契约（Straylight 侧已按此并行施工，不要单方面改名）

工具名：`finish_research_turn`；参数（契约固定）：

```json
{
  "runId": "string(uuid)",
  "titleCandidates": ["string", "string", "string"],
  "facts": [{ "text": "string", "evidenceIds": ["E1"] }],
  "linkEvidenceId": "E1"
}
```

Straylight 把参数原样作为 JSON body：

```
POST https://quote0.logic.heiyu.space/api/news/research/terminal/finish
Authorization: Bearer <QUOTE0_RESEARCH_TERMINAL_TOKEN>
```

Quote0 必须返回 200 + JSON：

```json
{
  "trusted": true,
  "outcome": "accepted" | "rejected",
  "runId": "...",
  "summary": "一句话（接受：最终标题；拒绝：主要原因）",
  "errors": ["..."],
  "artifact": { "title": "...", "message": "..." } | null,
  "deeplink": "https://quote0.logic.heiyu.space/annotate?...（有则给）"
}
```

错误语义（契约固定，Straylight 需要据此处理）：

| 场景 | HTTP | outcome |
| --- | --- | --- |
| 鉴权失败（Bearer 不匹配） | 401 | — |
| env 未配置 `QUOTE0_RESEARCH_TERMINAL_TOKEN`（fail closed） | 503 | — |
| runId 不存在 / 状态不对 | 200 | `rejected` |
| 提案未通过 schema / 发布门 | 200 | `rejected`（errors 携带可修正原因） |
| 通过全部发布门 | 200 | `accepted` |

`runId 不存在 / 状态不对` 走 200 + `rejected`（不要 4xx），让 agent 能看到原因再修正。

## 关键决策点与实现细节

### 1. env 与配置

- `QUOTE0_RESEARCH_PHASE_B_MODE` = `structured-inference`（默认，现状不变）| `terminal-tool`。
  - 显式模式总是优先。
  - 未设置时：`QUOTE0_RESEARCH_STRUCTURED_FINALIZER=true` → `structured-inference`；
    `...=false` → `agent-job`（legacy）；都不设置 → `structured-inference`。
- `QUOTE0_RESEARCH_TERMINAL_TOKEN`（bearer，终端回调自鉴权）。真实值只通过懒猫控制台注入，**绝不写进仓库**。
- `getResearchCanaryConfig()` 暴露 `phaseBMode`、`structuredFinalizer`（由 mode 派生）。
- `/api/health` 的 `researchRoute.phaseBMode` 如实反映 `getResearchCanaryConfig().phaseBMode`。

### 2. 端点 `POST /api/news/research/terminal/finish`（research-canary-api.ts）

- 独立 bearer 鉴权：不复用全局 `API_AUTH_TOKEN`（参考 `COMPONENT_LABELS_API_TOKEN` 中间件写法）。
- env 未配置 → 503（fail closed）；Bearer 不符 → 401。
- 加载 run；要求：run 属 `terminal-tool` 模式 且 有 `evidence_snapshot` 且 `attempts≥2` 且 有 thread 引用，
  否则 200 + `rejected`。
- 校验与裁决**复用现有代码路径**：
  1. `structuredFinalizationSchema` 校验参数形状（对完整提交体 minus runId 跑，额外字段会被拒）。
  2. `materializeStructuredResearchFinalization` 走全部发布门
     （标题↔事实对齐、最少 facts、content-quality、容量、publishTime server-own、source/claim budget）。
  3. 未复制任何一份门逻辑；`validateResearchCandidateShape` 只是对同一 schema 对象的结构判定。
- 裁决结果持久化到 `research_runs.terminal_receipt jsonb`
  （attempt、outcome、errors、candidate、artifact、receivedAt），通过新增的
  `markResearchRunTerminalReceipt()` 幂等更新。
- 端点本身**不**推进 run 状态、不写 inventory；它只「裁决 + 留据」，推进由 reconcile 负责。

### 3. 派发 `dispatchResearchTerminalFinalization(runId, threadId, seed, evidencePacket, decision, options)`

- 同线程 `POST /jobs`（body 带 `threadId`，校验返回 threadId 与发送的一致，参考 `dispatchResearchExtension`）。
- 头 `X-Straylight-Max-Tool-Calls: 1`（`finish_research_turn` 是 Straylight 终态工具，不计入该上限）。
- 提示词 `buildNeuromancerTerminalFinalizationPrompt`（新增）：
  - 复用冻结 Evidence Packet、few-shot v3、decision 语义（server-owned editorial 变体）。
  - 硬要求：必须且只能调用一次 `finish_research_turn`；`runId` 必须等于给定值。
  - 禁止输出 JSON 文本、禁止调用任何其他工具、禁止工具前后写正文。
  - 被拒绝会收到 `errors`，按 errors 修正后再调用一次。
  - 重试提示词把上一轮 `terminal_receipt.errors` 原样带入。

### 4. 线程 inspection / reconcile（research-canary-api.ts）

- 在 `research_complete` 里 structuredFinalizer 分支旁新增 terminal 分支：同线程派发 terminal 续跑，
  返回 202 `phaseTransition: research->terminal-finalization`，不做状态推进。
- 后续 finalization-phase reconcile 走 `inspectResearchCanary({ phase: 'terminal-finalization' })`：
  - 只看**本次派发之后**的 agent turn（最后一个 user identity turn 之后）。
  - 出现任何非 `finish_research_turn` 的 tool_call → `invalid`（沿用「Phase B 违反 no-tools 契约」文案，
    注明工具名），不可重试。
  - 没有 `finish_research_turn` 调用且 turn 已结束 → `failed` 且 retryable=true（一次）。
  - 有调用 → **以数据库里的 `terminal_receipt`（按 runId + attempt）为真相**；线程里的工具输出只用于关联，
    不信任其内容。
  - accepted → 与 structured 模式同样落 `result_artifact` / runtime receipt
    （`researchFinalizer.mode = 'terminal-tool'`，记录 attempt、latency）→ completed。这一步走既有
    `applyUniversalResearchArtifact`（增量落库）。
  - rejected → 若 `attempts < maxFinalizationRetries` 允许的次数，同线程再派一次（带 errors）；
    否则 `invalid`（errors 原样保留）。
- 兜底：mode 判定一律由 run 创建时写入的 `triage.phaseBMode` 决定，reconcile 不再现场读 env。

### 5. manual canary `/api/news/research/canary/jobs`

- 尊重当前 mode：创建 run 时把 `getResearchCanaryConfig().phaseBMode` 写入 run，用它跑同一条链路，
  不翻自动线。

### 6. persist / DB

- `research_runs` 新增 `terminal_receipt JSONB`。建表是 if-missing-only，ALTER 单独放
  `getMigrationStatements()`（幂等 `ADD COLUMN IF NOT EXISTS`），与 `research_extension_receipt` 当时
  的加列方式一致。CREATE TABLE 也带上该列，保证全新库直接可用。
- `ResearchRunRecord.terminalReceipt` + `fromRow` 映射 + `markResearchRunTerminalReceipt()`。

### 7. 测试（`bun test` 全绿）

- `research-canary.test.ts`（纯逻辑，不碰 DB）：
  - mode 路由（`getResearchCanaryConfig` 默认 structured-inference / legacy / 显式 terminal-tool）。
  - `dispatchResearchTerminalFinalization` 同线程 + 单工具预算 + thread 漂移 fail-closed + retry 带 errors。
  - `validateResearchCandidateShape` 拒多余字段 / 错误标题数量 / 未知 evidence id。
  - `inspectResearchCanary` terminal-finalization 三种形状（只调终态 / 先调 crawl / 无调用）。
- `research-terminal-endpoint.test.ts`（HTTP 端点，mock PG 单测，cache-bust 隔离 import）：
  - 503（token 未配）、401（Bearer 错）、400（runId 缺失）、200+rejected（run 不存在 / schema 拒）；
    `accepted` 返回可信 artifact 且不动 inventory。

## 状态机（Phase B terminal-tool）

```
research_complete(attempts=1)
   │  dispatchResearchTerminalFinalization(runId, threadA, ...)  同线程 /jobs
   ▼
running(attempts=2, threadA)  ── 后续 reconcile ——▶ phase=terminal-finalization
   │
   ├─ 出现非 finish_research_turn call → invalid（不可重试）
   ├─ turn 结束但无 finish_research_turn → failed【可重试一次】→ 同线程再派
   ├─ finish_research_turn 调用 + receipt.accepted → 走 universal apply → completed
   │                                        （result_artifact + researchFinalizer.mode='terminal-tool'）
   └─ receipt.rejected → errors 原样；attempts<maxFinalizationRetries → 同线程再派（带 errors）
                                     否则 → invalid（error 保留）
```

## 如何切换模式

- **默认不切换**：保持现有 `QUOTE0_RESEARCH_STRUCTURED_FINALIZER=true`（= `structured-inference`）。
- **启用 terminal-tool**：
  1. 懒猫控制台给 news-api 注入 `QUOTE0_RESEARCH_TERMINAL_TOKEN=<真实值>`（**不要**写进仓库）。
  2. 把 `QUOTE0_RESEARCH_PHASE_B_MODE` 设为 `terminal-tool`。
  3. 重启 news-api。`GET /api/health` 的 `researchRoute.phaseBMode` 应显示 `terminal-tool`。
- 在途 run 不受影响：每个 run 创建时冻结自己的 mode。

## Canary 步骤（建议）

1. 用 `POST /api/news/research/triage` 拿一条 research-lane seed。
2. `POST /api/news/research/canary/jobs`（body 带 `seed`，可选 `requestKey`）。它在当前 mode 下建 run。
3. 轮询 `POST /api/news/research/canary/jobs/:id/reconcile`：
   - 第一次在 `research_complete` 返回 202 `phaseTransition: research->terminal-finalization`。
   - 之后 reconcile 走 terminal 分支：连续 reconcile 直到 completed / invalid / failed。
4. 若提示词 / 裁决有问题：看 `terminal_receipt.errors`，修正后再派一次。
5. `GET /api/news/research/canary/jobs/:id` 可看完整 run，含 `terminalReceipt`。

## 变更文件

- `src/api/research-triage.ts`：`ResearchPhaseBMode` 类型 + `phaseBMode?` 字段。
- `src/api/research-canary.ts`：config mode 路由、`dispatchResearchTerminalFinalization`、
  `structuredFinalizationSchema` 导出、`validateResearchCandidateShape`、terminal-finalization 线程巡检、
  `ResearchTerminalRunReceipt`。
- `src/api/research-few-shot.ts`：`buildNeuromancerTerminalFinalizationPrompt`。
- `src/api/research-run-store.ts`：`terminal_receipt` 列读写 + `markResearchRunTerminalReceipt` +
  `createResearchRun` 注入 phaseBMode。
- `src/react-widgets/core/postgres-database.ts`：`terminal_receipt` 列（CREATE + 幂等 ALTER）。
- `src/api/research-canary-api.ts`：终端端点、manual canary mode、reconcile terminal 分支与 mode-aware 重派。
- `src/api/research-canary-worker.ts`：自动 run 创建时冻结 phaseBMode。
- `src/api/news-api-server.ts`：health 暴露 `researchRoute.phaseBMode`。
- `lazycat/lzc-manifest.yml`：public_path 精确放行 `/api/news/research/terminal/finish`；env 加
  `QUOTE0_RESEARCH_PHASE_B_MODE` 与 `QUOTE0_RESEARCH_TERMINAL_TOKEN:""` 占位。
- 测试：`research-canary.test.ts`（扩展）、`research-terminal-endpoint.test.ts`（新建）。

## 未验证 / 需要上层补做

- `bun run build` 在本机 `tsc` 不在 PATH，已用 `./node_modules/.bin/tsc -p tsconfig.build.json` 验证 exit 0；
  请确认 CI 的 build 命令用上了本地 tsc。
- 真实 Straylight 回调的端到端（真实 LLM 调用 `finish_research_turn`）属 Phase 2 联调，本次用单测桩验证契约。
- 未部署、未碰 lcctl/lzc-cli/ssh；`QUOTE0_RESEARCH_TERMINAL_TOKEN` 的真实值需上层在懒猫控制台注入。