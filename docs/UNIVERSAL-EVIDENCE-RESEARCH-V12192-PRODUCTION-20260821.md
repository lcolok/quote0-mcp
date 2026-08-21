# Quote0 v1.21.92 — Universal Evidence Research Production Deployment

Date: 2026-08-21 (Asia/Shanghai)

## Executive result

Quote0 has been moved from selective Neuromancer sampling to **Universal Evidence Research** in production.

The production rule is now:

```text
Every newly produced news item
→ Direct/editorial draft only
→ researchGate=pending
→ Neuromancer evidence digestion
→ evidence-grounded finalizer
→ strict Renderable + supported-claim gate
→ researchGate=ready
→ only then may consumer enqueue device delivery
```

The old daily Research item quota is removed in universal mode. This does **not** mean unlimited per-story searching. Per-item depth remains bounded and adaptive:

```text
digest        max 4 tool calls
enrichment    max 6 tool calls
verification  max 8 tool calls
recovery      max 10 tool calls
```

Concurrency remains 1 for the initial rollout. Minimum coverage and marginal-information-gain stopping remain authoritative.

Final production version is **v1.21.92**.

## Workspace / Git boundary

```text
worktree: /Users/friday/.devspace/worktrees/quote0-mcp-18f7a711
remote:   https://github.com/lcolok/quote0-mcp.git
base HEAD: 4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
mode: detached managed worktree
```

The candidate was reconstructed from the uncommitted v1.21.89 production source envelope plus Universal Research changes. The original production worktree was not reset, stashed, cleaned, or overwritten.

No commit, push, merge, rebase, force push, or release ref was created in this deployment phase. Therefore deployment is attested, but Git reproducibility debt remains until the dirty release source is formally committed.

## Context evidence

Preflight during deployment:

```text
tlens v0.2.9-50-g49ed60e
backend healthy
skldr 0.3.62
```

Broad tlens/skldr semantic search was partially degraded by search/embedding timeouts, but direct archived refs were readable. High-value context:

```text
ctx-4aGI — v1.21.90 Universal Evidence Research candidate
ctx-YBqo — v1.21.89 synthetic content evaluation production closure
ctx-PcVy — Content Quality v2 + Neuromancer Evidence-Gain
```

## Production capacity evidence

Before rollout, recent 24h production contained 78 news items. Universal counterfactual routing was:

```text
digest        42
enrichment    17
recovery      17
verification   2
```

Worst-case mechanical budget ceiling at the then-current policy was roughly 422 tool calls/day; real Research terminates earlier through information-gain stop. Successful historical Research was roughly 76–136 seconds in measured modes. Fixed concurrency=1 was therefore retained rather than increased preemptively.

## v1.21.90 initial deployment

v1.21.90 was first deployed from the fully tested Universal candidate.

Artifacts:

```text
news-api tag:
dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.90

registry digest:
sha256:05121b834806e4a85725209469d56d546b6c2fbfc95f5ec000c325daa3707177

LPK:
lazycat/me.friday.quote0-mcp-v1.21.90.lpk
SHA-256 9deb7b00b68752edec04560df744a72dc6d4d88777affbe8264e107b9765b5ab
```

Runtime verified:

```text
version=1.21.90
QUOTE0_RESEARCH_UNIVERSAL_ENABLED=true
QUOTE0_RESEARCH_AUTO_ENABLED=true
QUOTE0_RESEARCH_AUTO_DAILY_LIMIT absent
STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID=hy3
direct_snapshot migration present
worker mode=universal-admission
concurrency=1
```

All long-lived LazyCat services were restored to `restart=unless-stopped` after installation.

## Real production E2E: fail-closed behavior

The first naturally generated Universal item was inventory **18370**:

```text
seed title: I should have loved biology
source: Hacker News
created: 2026-08-21 03:06 local
```

It entered inventory as:

```text
researchGate.state=pending
```

Before Research completed, direct production checks showed:

```text
device_deliveries for 18370 = 0
news_push_log for 18370     = 0
```

This is decisive evidence that Universal fail-closed publication works: a Direct draft can exist in inventory but cannot reach the device before Neuromancer finishes.

## P0 discovered in v1.21.90: structural finalizer failures

The first 18370 digest Phase A was valid:

```text
3 tool calls
2 crawl
1 search
0 failed tools
```

But Phase B repeatedly produced two structurally equivalent metadata defects:

```text
highlights > 4
same canonical evidence URL duplicated under multiple source IDs
```

After its allowed finalizer attempts, the run became invalid and 18370 correctly remained pending. No unresearched Direct output leaked to delivery.

This was not an evidence-quality failure; it was a deterministic presentation/provenance normalization problem.

## v1.21.91 structural-normalization hotfix

A minimal hotfix was implemented before the strict validator:

- canonical-equivalent source URLs are deduplicated;
- duplicate claim source IDs are remapped to the retained source;
- retained source role may be upgraded to the stronger equivalent role (`official > primary > seed > secondary > community > syndicated`);
- highlights are trimmed/deduplicated, filtered to literal message occurrences, and capped at four.

The normalization explicitly does **not** rewrite title/message factual text and does not relax substantive validation:

- unsupported/context/unresolved/conflict claims remain blocked;
- invalid URLs remain blocked;
- missing evidence remains blocked;
- title/message size remains blocked;
- tool/source/claim budgets remain enforced.

Runtime smoke against the exact 18370 failure shape passed strict validation after normalization.

v1.21.91 artifacts:

```text
news-api registry digest:
sha256:3329b3f474153768989dca0b0915dd6003fb521b54873200e9a3debff5a2e888

LPK:
lazycat/me.friday.quote0-mcp-v1.21.91.lpk
SHA-256 c847a4e16235554d9f25242faf5ee6d49dca5d0171d9078e2e6962f57ea15f21
```

### 18370 natural retry under v1.21.91

After the normal 15-minute cooldown, Quote0 naturally created a second digest run:

```text
run: 0fbdbb4f-3301-42a6-9a8b-327bd91b014b
mode: digest
Phase A: 1 crawl, 0 search, 0 failures
Evidence Packet: 3365 chars
```

It completed successfully and materialized:

```text
title:
I should have loved biology

message:
James Somers文章登Hacker News获46分、18条评论，叹生物课本只给结论。
```

Research Receipt:

```text
3 claims
3/3 supported
1 primary canonical source
```

The inventory gate changed to:

```text
researchGate.state=ready
researchMode=digest
toolCalls=1
```

Only after that transition did consumer create deliveries.

Physical E-Ink proof:

```text
rendered frame_id: d065ad04bbab418a
rendered crc32:    2e9d64b1
geometry:          296×152
```

`eink-2` returned an exact matching pull-mode display ACK:

```text
result=displayed
current_match=true
crc_verified=true
frame_id=d065ad04bbab418a
crc32=2e9d64b1
acked_at=2026-08-20T19:23:56.334Z
refresh_ms=2062
```

The direct EPD1 delivery attempt also succeeded with matching request/ACK trace and CRC.

## P0 discovered after v1.21.91: recovery budget mismatch

A new natural InfoQ item, inventory **18372**, arrived at 03:26:

```text
AI Infra 正在诞生自己的石油期货？GPU 不够买之后，华尔街开始交易算力
RSS body: 点击查看原文>
```

As designed it entered:

```text
researchGate=pending
researchMode=recovery
```

Neuromancer Phase A performed 10 successful tool calls:

```text
crawl  4
search 6
failed 0
```

The actual tool sequence was high-value rather than mechanical noise:

1. recover InfoQ canonical article;
2. targeted CFTC compute-derivatives searches;
3. targeted CME/Silicon Data H100/B200 futures searches;
4. targeted Silicon Data funding search;
5. crawl CFTC official press release;
6. crawl CME official press release;
7. crawl Silicon Data official funding source.

However v1.21.91 still had a recovery post-hoc maximum of 8, so Quote0 rejected the successful Phase A as:

```text
Research tool budget 超限: 10 > 8
```

A historical recovery invalid had also landed at exactly 10 calls. This made the mismatch reproducible rather than anecdotal.

A read-only reinspection of the exact same persisted Straylight thread using a 10-call recovery budget returned:

```text
status=research_complete
toolCalls=10
failedToolCalls=0
Evidence Packet=8000 chars
errors=[]
```

## v1.21.92 recovery calibration

Only `recovery` was calibrated from 8 to 10 tool calls:

```text
digest        4
enrichment    6
verification  8
recovery     10
```

Verification was deliberately left at 8. Universal admission remains unlimited by item count; per-item work remains bounded.

Final v1.21.92 release gate:

```text
282 tests passed
0 failed
7235 assertions
48 test files
TypeScript production build PASS
base-image digest guard PASS
release-version pre-release governance PASS
git diff --check PASS
```

Production artifacts:

```text
news-api tag:
dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.92

registry digest:
sha256:bbf4f200518d31fdd3aeaaedcc337a0ca15794f3fc5aec05c6e1b07b7376a697

running image ID:
sha256:4e3267f3f1c5ec3268f487dd92d26ce4342e2fa27b124c0023ab46e12d327d71

LPK:
lazycat/me.friday.quote0-mcp-v1.21.92.lpk
SHA-256 f4639b0065828f839372849ecfc588b03d1f340f00b304e07a44454bf8f740bf
```

Source SHA attestation matched local candidate and running container byte-for-byte for:

```text
src/api/research-triage.ts
f7180c7a3f361149196bbf36cc5ebaa3ba994d4b388d8dd54772d3f88879bcaa

src/api/renderable-news-intake.ts
c1f222e6221f4133a562d33780bbc79674f16a1e5bd7bfb8eb51fe1f1fc475e8

src/api/research-canary.ts
441c3e7ba0dfd37f39439287f3ba10d998f1097a53518d0586637e2eb146e9ef

lazycat/lzc-manifest.yml
35155d2d49291c934b56e0c6458bf8a34a748c35512e573a6725d5cce8caa6d0
```

## 18372 natural recovery under v1.21.92

After its normal cooldown, Quote0 naturally retried 18372:

```text
run: 7d20c31c-9899-44c6-8bce-054f4bc5f7a2
mode: recovery
budget maxToolCalls: 10
actual toolCalls: 7
crawl: 4
search: 3
failedToolCalls: 0
Evidence Packet: 8000 chars
```

It completed and materialized:

```text
title:
华尔街开算算力期货

message:
CFTC就算力衍生品监管征求意见；CME与Silicon Data拟10月5日推H100/B200租赁指数期货。
```

Final Research Receipt:

```text
2 claims
2/2 supported
3 canonical sources
- InfoQ seed
- CFTC official
- CME official
retrieval=healthy
engines: google cse + scrapling
```

Inventory transitioned:

```text
pending → ready → pushed
```

Only after `ready` did consumer create the three device deliveries.

`eink-2` delivery succeeded. Re-rendering the current grounded inventory yielded:

```text
frame_id = 1bc51aa4c23d0da5
crc32    = ada7e43e
bytes    = 5624
geometry = 296×152
```

Exact matching physical displayed ACK:

```text
result=displayed
current_match=true
crc_verified=true
frame_id=1bc51aa4c23d0da5
crc32=ada7e43e
acked_at=2026-08-20T19:43:07.211Z
RSSI=-57
refresh_ms=2057
```

The direct EPD1 attempt also had matching trace/CRC and outcome succeeded.

At the same moment:

- `eink-1` was in retry_wait because it was unreachable;
- `eink-3` was queued;
- this does not affect the content gate or the verified `eink-2` physical display evidence.

## Additional natural Universal production samples

By the final observation window, four naturally produced Universal items were all `researchGate=ready` and already pushed:

```text
18370 — digest, 1 tool call
18371 — enrichment, 6 tool calls, title: Roblox将接受独立审计
18372 — recovery, 7 tool calls, title: 华尔街开算算力期货
18373 — digest, 3 tool calls, title: 149个GenAI工具按概念深度分类
```

Final Universal gate snapshot:

```text
legacy items in observation window: 27
universal ready: 4
universal pending: 0
active queued/running/waiting Research: 0
```

Historical invalid runs remain in the database deliberately for audit; they are not current backlog. They document the pre-hotfix digest normalization and pre-calibration recovery budget failures.

## Renderer regression after v1.21.92

Existing physical renderer governance remained intact:

| Target | Physical | Title bar | Excess | Point-to-point | Resize | Overflow | XOR |
|---|---|---|---:|---|---|---|---:|
| 40×20 | pass | pass | 0 | true | false | false | 0 |
| 20×8 | pass | pass | 0 | true | false | false | 2152 |
| 296×152 | pass | pass | 0 | true | false | false | 0 |

The 20×8 XOR remains the intentional micro-recipe semantic difference rather than a resize/physical-lattice failure.

## Final production health observation

Two rounds 30 seconds apart after v1.21.92 recovery completion both reported:

```text
health=healthy
version=1.21.92
universal ready=4
pending=0
active Research=0
18372 physical ACK still current_match=true / crc_verified=true
```

Resource snapshots:

```text
news-api ~552–553 MiB / 1 GiB, ~209–211 PIDs
annotation-web ~14.27 MiB / 128 MiB, 17 PIDs
```

Final service state:

```text
news-api       v1.21.92 healthy / unless-stopped
annotation-web v1.21.86 healthy / unless-stopped
label-web      v1.21.29 healthy / unless-stopped
PostgreSQL     healthy / unless-stopped
MinIO          healthy / unless-stopped
Redis          healthy / unless-stopped
app sidecar    healthy / unless-stopped
```

Deployment-window error scan found no fatal, panic, OOM, unhandled/uncaught exception, worker loop crash, universal materialization pending error, Research dispatch failure, or renderer/title-bar failure after the final v1.21.92 install.

## What is now verified

1. Every newly produced Universal item is marked pending before Research and cannot be delivered while pending.
2. Adequate content takes a light digest path rather than mechanical deep searching.
3. Sparse content can take enrichment.
4. Seed-only InfoQ content can be recovered into primary/official evidence before publishing.
5. Direct draft is preserved as editorial context/baseline but is not fact authority.
6. Finalizer structural equivalent metadata is normalized deterministically without altering factual text.
7. Final publishable Receipt claims must all be supported.
8. No daily item-count quota remains in universal mode.
9. Per-item adaptive budgets remain bounded at 4/6/8/10.
10. A real digest and a real recovery item both completed the full producer → pending → Neuromancer → grounded ready → consumer → physical display chain.
11. Existing renderer physical self-checks remain passing.

## Remaining risks / next priority

- Git reproducibility debt remains: production v1.21.92 is deployed from a dirty detached worktree based on `4fe2245`; no commit/push/release ref has been created.
- Long-run queue-age telemetry is not yet sufficient to prove concurrency=1 under every burst distribution. Current observed backlog is zero; scale concurrency only if queue age shows need.
- Recovery budget 10 is now grounded in repeated production evidence, but future tuning should use tool information-gain and queue latency, not completion rate alone.
- Real human paired labels are still needed to calibrate synthetic evaluation quality; Universal Research being mandatory does not imply every Neuromancer rewrite is stylistically superior.

Highest-priority next step: observe several hours of Universal production for pending queue age, per-mode completion/failure/tool-call distribution and grounded-ready latency, while keeping fail-closed delivery semantics unchanged.
