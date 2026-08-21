# Quote0 Content Quality v1 Candidate — 2026-08-20

> **Superseded before deployment.** The initial v1 candidate used coarse source-length bands as part of evidence sufficiency. User review correctly challenged that as non-generalizable. The active candidate is now Content Quality v2: semantic evidence modes + Neuromancer information-gain research. See `CONTENT-QUALITY-V2-NEUROMANCER-EVIDENCE-GAIN-CANDIDATE-20260820.md`.

## Scope

This phase governs the factual/content quality of Direct-generated news artifacts. It does not change the physical renderer, device protocol, or existing Neuromancer blind-review semantics.

Workspace:

```text
/Users/friday/.devspace/worktrees/quote0-mcp-c8efa1f7
```

Base:

```text
origin/main@4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
Quote0 production v1.21.86
```

No commit, push, or deployment has been performed for this candidate.

## Production evidence

A read-only replay of the latest 40 real `content_inventory` rows identified the dominant content-quality failures.

### Thin-source hallucination pressure

Several InfoQ records contain only the literal body:

```text
点击查看原文>
```

while the current Direct processor still creates polished multi-clause summaries. Examples include:

- 将可理解性作为架构特性：无法理解的系统无法安全演进
- 将Pod作为worker而非智能体：在Kubernetes上重新思考AI智能体的部署单元
- AI爬虫涌入电商，安全防线正在从“拦截”转向“判断”
- AI for Science进入新阶段：机器人正在成为科研新基础设施
- OpenAI 因安全问题突然停训GPT-6…

This is a structural error: the model is being asked to manufacture a complete news card from a title stub.

### Over-assertion on limited evidence

Short source snippets from Ars/SSPAI/InfoQ are often rewritten with stronger claims than the source itself. The system previously had no deterministic distinction between a rich article and a 60–90 character teaser.

### Stale / contradictory few-shot profile

The production `ax-framework/models/production/latest.json` was a 2025 artifact containing examples whose outputs introduced facts not present in the demo inputs, including named hardware, multipliers, dates and counts. Those demonstrations directly contradicted a grounding policy.

### Fake quality telemetry

Current Direct output hardcoded:

```text
qualityScore = 0.95
confidence = 0.95
signature = AI优化·Q95
```

These values were not produced by a holdout, human review, or calibrated estimator. They were generator self-report and therefore not valid quality evidence.

## Content Quality v1 architecture

```text
Source evidence
  ↓
Source Evidence Gate
  ├─ insufficient → skip LLM entirely, preserve item, HOLD for Research
  ├─ limited      → Direct allowed, mark REVIEW
  └─ sufficient   → Direct allowed
  ↓
Evidence-bounded Direct prompt
  ↓
Generated artifact
  ↓
Deterministic hard-fact guard
  ├─ unsupported hard facts → HOLD
  ├─ incomplete artifact    → HOLD
  ├─ limited evidence       → REVIEW
  └─ otherwise              → DELIVER
  ↓
content_inventory metadata.contentQuality
  ↓
consumer excludes explicit HOLD
```

Old inventory without the new metadata remains backward-compatible and deliverable.

## New policy module

New:

```text
src/api/content-quality.ts
src/api/content-quality.test.ts
```

Version:

```text
content-quality/v1
```

Source evidence sufficiency:

- body/description that is empty or a pure placeholder is zero evidence;
- `<24` meaningful characters: `insufficient`;
- `24..119`: `limited`;
- `>=120`: `sufficient`.

The threshold was calibrated with a real 40-row production replay. An initial `<48` HOLD threshold incorrectly held a real 43-character SSPAI teaser; v1 was relaxed so that item becomes REVIEW rather than HOLD.

## Deterministic hard-fact guard

The guard detects output facts whose normalized value is absent from source title/body/description:

- years;
- percentages;
- currency values;
- version numbers;
- measured counts / units.

Equivalent currency surface forms are normalized before comparison. For example:

```text
¥80,000 == 8万元
```

The production-shaped Go 1.27 regression test proves that if a generated artifact adds an absent `2024` or `10%`, the result is `HOLD / research-required`.

Important limitation: this guard proves grounding, not source truth. If the source article itself contains a false date, deterministic source-output comparison cannot establish external truth. That belongs to the Neuromancer/source-verification layer.

## Producer behavior

Modified:

```text
src/api/news-scheduler.ts
```

For LLM processors, an `insufficient` source now bypasses LLM generation entirely and goes directly through passthrough so the system does not spend tokens inventing a card from a title stub.

The inventory artifact is preserved with:

```text
metadata.contentQuality.disposition = hold
metadata.contentQuality.recommendation = research-required
```

This keeps the source available for Research and human diagnosis without permitting physical delivery.

After any Direct generation, `assessProducedContentQuality()` runs again and persists the full evidence diagnostic in `processed_content.metadata.contentQuality`.

## Consumer behavior

The ready and pushed/replay inventory queries now exclude only explicit v1 holds:

```sql
COALESCE(processed_content->'metadata'->'contentQuality'->>'disposition', 'deliver') <> 'hold'
```

Therefore:

- explicit HOLD: not physically delivered;
- REVIEW: still deliverable in v1, but available for future review surfacing;
- legacy item without metadata: remains deliverable.

No existing inventory migration or destructive state rewrite is required.

## Research budget governance

Modified:

```text
src/api/research-canary-worker.ts
```

A naive “quality HOLD always first” policy was rejected because historical governance already demonstrated that a single priority bucket creates sampling bias. The production Research budget is stratified in a deterministic three-slot cycle:

```text
slot 0 → quality-hold
slot 1 → high-risk
slot 2 → any / exploration
repeat
```

If a preferred bucket is empty, the worker falls back to the global eligible Research pool.

With the current production daily limit of 3, this prevents quality-resolution work from starving security/high-risk verification and prevents high-risk items from starving thin-source quality repair.

## Evidence-bounded Direct generation profile

Modified:

```text
src/react-widgets/services/ax-optimized-news-processor-simplified.ts
ax-framework/models/production/latest.json
```

New immutable profile identity:

```text
evidence-bounded-direct/v1
```

High-priority prompt contract:

- only facts explicitly present in the input may be used;
- no external knowledge, memory or common-sense completion;
- no new dates/years, money, percentages, versions, counts, identities, causal claims, forecasts or conclusions;
- epistemic strength cannot increase (`计划/可能/据报` must not become `完成/必然/证实`);
- insufficient evidence should produce a shorter artifact, not a fabricated fuller story.

The old few-shot examples were replaced with evidence-grounded examples. Fake accuracy/compliance/final-performance statistics were removed from `latest.json`; the artifact now identifies itself as an untrained manually governed profile rather than a measured model checkpoint.

## Stop fake Q95

Modified:

```text
src/react-widgets/core/modular-architecture.ts
src/react-widgets/core/processing-modules.ts
src/react-widgets/core/rendering-modules.ts
```

AX Direct no longer assigns hardcoded:

```text
qualityScore=0.95
confidence=0.95
```

Instead it records:

```text
generationProfileVersion = evidence-bounded-direct/v1
evaluationStatus = unmeasured
```

AX renderer identity is now simply:

```text
AI优化
```

A numeric `qualityScore` is included only when an actual numeric measured value exists. Generator identity and measured quality are no longer conflated.

## Real production replay

The final `content-quality/v1` policy was replayed read-only against the 40 newest production inventory items:

```text
DELIVER 19
REVIEW  13
HOLD     8
```

All eight final HOLDs were InfoQ records whose effective body was only the placeholder `点击查看原文>`.

No genuine 43-character SSPAI teaser was held after threshold calibration. `¥80,000` vs `8万元` was normalized and no longer produced a false unsupported-fact finding.

This replay is a counterfactual classifier run only; production v1.21.86 behavior was not changed.

## Verification

Focused quality / producer / consumer / Research / prompt / renderer tests passed during development.

Final full suite:

```text
251 pass
0 fail
7084 expects
44 files
```

Production TypeScript build:

```text
bun run build
PASS
```

Whitespace/patch validation:

```text
git diff --check
PASS
```

## Modified files

```text
M ax-framework/models/production/latest.json
M src/api/news-scheduler-consumer-delivery.test.ts
M src/api/news-scheduler-producer-fallback.test.ts
M src/api/news-scheduler.ts
M src/api/research-canary-worker.test.ts
M src/api/research-canary-worker.ts
M src/react-widgets/core/llm-fallback.test.ts
M src/react-widgets/core/modular-architecture.ts
M src/react-widgets/core/processing-modules.ts
M src/react-widgets/core/rendering-modules.test.ts
M src/react-widgets/core/rendering-modules.ts
M src/react-widgets/services/ax-optimized-news-processor-simplified.ts
A src/api/content-quality.ts
A src/api/content-quality.test.ts
```

## Deployment boundary

This candidate has NOT been committed, pushed or deployed.

Deploying it will materially change product behavior: newly generated explicit HOLD items will remain in inventory but will no longer be selected by the device consumer. Therefore production promotion should be an explicit v1.21.87 release after user authorization.

No current v1.21.86 production service or database row was modified during this task.

## Next quality layer

Content Quality v1 establishes **groundedness and evidence sufficiency**, not external factual truth. The next layer should use the existing Neuromancer evidence system to verify source claims/freshness for selected high-value or suspicious items and feed those results into the blind human paired-review dataset. Promotion of any stronger generator should depend on that measured dataset, not generator self-scoring.
