# Quote0 v1.21.90 Candidate — Universal Evidence Research

Date: 2026-08-21 (Asia/Shanghai)

## Goal

User request:

> 不限额度会不会更好呢？我觉得基本上所有都需要经过 Neuromancer 消化证据

The implemented interpretation is **unlimited item admission, bounded adaptive depth**:

- remove the daily item quota that sampled only a few news items;
- every producer news item enters Neuromancer evidence digestion before it becomes publishable;
- keep bounded per-item tool budgets, fixed initial concurrency, minimum-coverage requirements, provenance validation, and marginal-information-gain stopping;
- do not equate “unlimited” with infinite crawl/search per story.

## Workspace / provenance boundary

```text
candidate worktree: /Users/friday/.devspace/worktrees/quote0-mcp-18f7a711
remote:             https://github.com/lcolok/quote0-mcp.git
base HEAD:          4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
mode:               detached managed worktree
```

The actual v1.21.89 production source envelope was still dirty/uncommitted in:

```text
/Users/friday/.devspace/worktrees/quote0-mcp-c8efa1f7
```

To avoid silently dropping production-only Content Quality / Neuromancer / synthetic-evaluation work, that dirty source envelope was reconstructed into the isolated v1.21.90 candidate with Git patches. The original production worktree was not edited, stashed, reset, cleaned, or committed.

No commit, push, merge, rebase, release ref, image build, LPK install, or production deployment was performed for v1.21.90.

Production remains Quote0 v1.21.89.

## Dynamic context evidence

Preflight:

```text
tlens v0.2.9-50-g49ed60e
backend healthy
skldr 0.3.62
```

Broad tlens/skldr semantic search was degraded by backend/embedding timeouts during this task. High-value archived evidence was recovered directly from:

```text
ctx-YBqo — v1.21.89 synthetic content evaluation + controlled promotion
ctx-PcVy — Content Quality v2 + Neuromancer Evidence-Gain candidate
```

Relevant established facts:

- v1.21.89 synthetic paired evaluation: Research 3 wins / Direct 2 wins / 4 ties.
- Mean Research minus Direct: factual confidence +0.7222, information density -0.4444, E-Ink suitability +0.5000.
- Selective auto Research was capped at 3 items/day.
- Existing deep Research already used canonical → provenance → gap map → corroboration → conflict/freshness → minimum coverage → marginal-gain stop.
- Recovery/verification were bounded to 8 tool calls; enrichment/exploration to 6.
- Phase B finalizer was pinned to hy3 after Kimi/pi-json no-event failures.

The new work therefore changes **admission and publication semantics**, not the already validated deep-research core.

## Production capacity evidence

Read-only production measurements during this task:

```text
new inventory items in latest 24h: 78
```

Universal counterfactual routing over those 78 real items:

```text
digest        42
enrichment    17
recovery      17
verification   2
```

By source:

- Hacker News: 18/18 digest
- Ars Technica: 15/15 enrichment
- InfoQ: 17 recovery + 1 enrichment
- DEV: 17 digest + 1 verification
- GitHub Changelog: 2 digest + 1 verification
- 少数派: 4 digest
- Solidot: 1 digest
- Cloudflare: 1 enrichment

Worst-case *budget ceiling* if every item mechanically consumed every tool allowance:

```text
422 tool calls/day
5.41 max-budget calls/item average
```

This is a ceiling, not measured use. Existing real inventory-auto runs in the last week showed successful jobs roughly in the 76–136 second range for measured modes, with typical historical completed runs around 4.9–6 tool calls. Current production arrivals are therefore well below the theoretical throughput of fixed concurrency=1; increasing concurrency is not required for the first universal rollout.

## Architecture change

Old selective architecture:

```text
RSS
→ Direct
→ usually publishable immediately
→ a few sampled HOLD/high-risk/exploratory items enter Neuromancer
```

v1.21.90 candidate:

```text
RSS
→ Content Quality / Direct draft
→ researchGate=pending
→ Direct is NOT publishable
→ Neuromancer Universal Evidence Research
   ├─ adequate     → digest       (max 4 tool calls)
   ├─ sparse       → enrichment   (max 6 tool calls)
   ├─ seed-only    → recovery     (max 8 tool calls)
   └─ high-risk / conflict → verification (max 8 tool calls)
→ Evidence Packet
→ hy3 Phase B finalizer
   + Direct draft as editorial context, never as evidence
→ Renderable validator
→ universal publish grounding gate
→ re-render final grounded artifact
→ researchGate=ready
→ consumer may enqueue delivery
```

## Universal Research policy

New policy:

```text
universal-evidence-research/v1
```

New explicit environment switch:

```text
QUOTE0_RESEARCH_UNIVERSAL_ENABLED=true
```

`QUOTE0_RESEARCH_AUTO_DAILY_LIMIT` is no longer used in universal mode. The daily item quota is removed instead of set to an arbitrarily large number.

The initial universal worker still uses concurrency=1.

### Digest mode

New `researchMode=digest` applies to adequate low-risk news that previously skipped Research.

Budget:

```text
maxToolCalls               4
maxPostSeedArtifacts       2
maxPublishableClaims       4
maxFinalizationRetries     2
maxEvidenceChars        5000
targetIndependentClusters  1
```

Minimum coverage:

- confirm canonical body / author or organization / freshness where available;
- follow at least one primary/official/upstream clue OR perform one targeted freshness/provenance search;
- new hard facts that change title/conclusion must come from crawled/snapshotted evidence;
- if seed itself is already complete primary/official evidence, stop early rather than consuming all four calls.

Recovery/verification remain 8-call bounded deep paths. Enrichment remains a 6-call bounded path.

## Direct draft semantics

The Direct result is now explicitly an **editorial draft**, not the final evidence authority.

For universal producer items:

```json
metadata.researchGate = {
  "schemaVersion": "universal-evidence-research/v1",
  "required": true,
  "state": "pending"
}
```

Consumer SQL rejects a pending universal item even when Content Quality says `deliver`.

The original Direct draft is persisted immutably in:

```text
research_runs.direct_snapshot JSONB
```

Phase B receives only its `title` and `message` as editorial context. The prompt states that Direct is not evidence: it may preserve concise/specific wording only when Seed/Evidence Packet support it. This specifically addresses the measured v1.21.89 failure mode where Research improved factual confidence but often reduced information density.

Human and synthetic paired-review queries now prefer:

```text
research_runs.direct_snapshot
→ active promotion previous_processed_content
→ current content_inventory.processed_content
```

so universal materialization cannot destroy the A/B Direct baseline.

## Publication grounding gate

A valid JSON artifact alone is not enough to unlock production.

Universal materialization requires:

- current Renderable News validation to pass;
- at least one Research Receipt claim;
- every claim in the final publishable Receipt to be `status=supported`.

`context`, `unresolved`, and `conflict` may inform what the finalizer discards or rephrases, but cannot remain as final publishable card claims.

If the final artifact violates the publish gate:

1. Quote0 feeds the deterministic validator error back into a fresh-thread Phase B retry without repeating Phase A Research.
2. Digest allows up to two finalizer retries (three Phase B attempts total).
3. If it still fails, the run becomes failed and the inventory remains `researchGate=pending`.
4. The worker may retry the whole research later, but no pending Direct draft is silently pushed.

Infrastructure/materialization failures remain retryable without pretending the Research run is completed.

## Backlog / retry fairness

Universal pending items do not expire just because they exceed the legacy 24-hour lookback.

Selection is oldest-first among items with the fewest prior Research attempts. A permanently failing poison item therefore cannot monopolize FIFO and starve all newer news.

Failed/invalid attempts have a 15-minute cooldown before the item becomes eligible again.

Universal idempotency keys include attempt number:

```text
inventory-auto:<inventory-id>:attempt-<N>
```

Active/queued/waiting/completed runs still prevent duplicate concurrent dispatch.

## Final materialization

New service:

```text
src/api/universal-research-finalization.ts
```

On successful grounded Phase B completion:

1. validates Research artifact;
2. applies supported-claim publish gate;
3. renders the exact grounded Research artifact through the production news renderer;
4. updates the same inventory row with Research `processed_content` and new image;
5. resets replay state;
6. writes `researchGate=ready` with run/mode/tool/evidence audit metadata.

Only then is the item eligible for the existing consumer/delivery pipeline.

Legacy inventory without the universal gate is not rewritten.

## Real shadow digest E2E

No Quote0 production inventory rows were modified by these shadow runs. They created Straylight Research threads/jobs only.

Subject:

```text
GitHub Changelog
Separate GitHub Actions path for GitHub Code Quality
inventory reference: 18363 (read-only production lookup)
```

Existing Direct draft:

```text
GitHub CodeQL路径已可用
GitHub Code Quality专用CodeQL actions工作流路径现已正式可用，工作流运行历史与Actions使用报告现可区分GitHub Code Quality运行。
```

### Shadow 1

```text
run shadow-digest-cce60e26-eff7-45b2-9250-04e6748c3093
Phase A: crawl=1, search=0, total=1
```

Phase A correctly stopped after recovering the official GitHub page instead of mechanically using all four calls.

Phase B exposed a canonical duplicate-source issue (seed URL and normalized crawl URL), caught by the existing validator.

### Shadow 2

```text
run shadow-digest-9ec10d69-9b3a-4a8a-b8e2-9d17f0f511b7
Phase A: crawl=1, search=0, total=1
```

First finalizer attempt: canonical duplicate + title too long.
Second attempt: canonical duplicate fixed; title still too long.

This led to two changes rather than deterministic truncation:

- target ≤28 display units for generated titles, leaving margin below the hard 32-unit validator ceiling;
- digest allows two no-tools finalizer retries without repeating Research.

### Shadow 3 — passed

```text
run shadow-digest-754958f7-1b4c-4002-b5a4-9d9b76cd03ee
Phase A: crawl=1, targeted search=1, total=2
Evidence Packet: 4880 chars
```

First Phase B attempt was rejected for a highlight/canonical presentation issue.
Second Phase B attempt passed without another crawl/search.

Final artifact:

```text
title:
GitHub CodeQL路径已可用

message:
GitHub Code Quality专用CodeQL Actions路径现已正式可用，工作流运行历史与Actions使用报告可区分其运行。

source:
GitHub Blog
```

Final Receipt:

```text
2 claims
2/2 supported
1 canonical source
role=official
universal grounding errors=0
```

This is the desired behavior: Universal Research did **not** force a gratuitously different rewrite. The evidence-supported Direct title structure was retained; the final artifact was simply evidence-digested and provenance-attested.

## Verification

Focused universal/research suite:

```text
66 pass
0 fail
298 assertions
```

Final release gate after all changes:

```text
281 pass
0 fail
7228 assertions
48 test files
TypeScript production build PASS
base-image digest guard PASS
release-version pre-release governance PASS
git diff --check PASS
```

Candidate release envelope:

```text
Quote0 v1.21.90
news-api v1.21.90
annotation-web remains v1.21.86
label-web remains v1.21.29
```

Pre-release governance warnings are expected:

- detached dirty candidate worktree;
- no exact release/v1.21.90 ref yet.

No deployment artifacts were built because production deployment was not authorized in this turn.

## Known operational trade-offs

Universal evidence digestion intentionally changes product latency semantics:

- final news no longer becomes publishable immediately after Direct synthesis;
- Straylight/Neuromancer outage causes a pending backlog rather than silently falling back to unresearched news;
- Research call volume increases materially compared with the 3/day sampling regime;
- per-item budgets and adaptive stop remain necessary safety controls even when item admission is unlimited.

Current measured arrival/throughput evidence indicates concurrency=1 is sufficient for the first rollout. Raising concurrency should be driven by observed queue age/backlog, not by the removal of the daily quota itself.

## Completion boundary

Completed in candidate:

- universal admission;
- no daily item cap;
- adaptive 4/6/8-call depth;
- pending-until-Research consumer gate;
- immutable Direct snapshot;
- Direct-aware but evidence-authoritative finalizer;
- supported-only universal publication gate;
- finalizer repair retries;
- non-expiring universal backlog;
- poison-item fairness;
- final grounded re-render/materialization;
- real adequate/digest shadow E2E;
- full test/build/release-gate verification.

Not done:

- commit;
- push;
- release/v1.21.90 ref;
- image/LPK build;
- production deploy.

Highest-priority next step after explicit deployment authorization: deploy v1.21.90 with concurrency=1, then observe queue age, completed/failed Research rate, mode/tool-call distribution, end-to-end producer→grounded-ready latency, and physical delivery freshness before considering any concurrency increase.
