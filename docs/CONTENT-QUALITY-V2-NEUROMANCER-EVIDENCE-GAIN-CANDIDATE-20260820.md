# Quote0 Content Quality v2 + Neuromancer Evidence-Gain Candidate — 2026-08-20

## Executive decision

Content Quality v1 was deliberately superseded before deployment. The user correctly challenged the statement “InfoQ 7-character body never calls LLM” as a non-generalizable rule.

The active design is now:

```text
semantic evidence adequacy
        +
evidence-bounded Direct synthesis
        +
claim-level deterministic guards
        +
Neuromancer information-gain Research
        +
blind human paired review
```

The key distinction is:

```text
seed-only does NOT mean “no LLM anywhere”.
seed-only means “do not let a publishable Direct synthesis model manufacture a news card from a headline/boilerplate”.
Neuromancer itself is an LLM+tools research path and is prioritized for evidence recovery.
```

No commit, push or deployment has been performed for this candidate. Current production remains Quote0 v1.21.86.

## Workspace / Git boundary

```text
worktree: /Users/friday/.devspace/worktrees/quote0-mcp-c8efa1f7
base: origin/main@4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
production: v1.21.86
```

Primary checkout changes were not touched.

## Why v1 was insufficient

The first candidate classified source evidence partly from body character thresholds. Although production replay showed the holds were mostly correct, this is not a good invariant:

- a short sentence can contain a real proposition;
- a long body can merely repeat a headline or boilerplate;
- English/CJK punctuation changes sentence segmentation;
- evidence richness is not equivalent to byte/character length.

Therefore no literal “7 chars”, “24 chars” or “120 chars” threshold now decides whether Direct synthesis is permitted.

## Content Quality v2

Version:

```text
content-quality/v2
```

### Evidence modes

The source gate now reports one of:

```text
seed-only
sparse
adequate
```

It uses multiple deterministic signals:

- boilerplate stripping;
- semantic characters after normalization;
- proposition/evidence atom count;
- explicit hard-fact count;
- lexical novelty versus headline;
- deterministic repeated-headline detection.

`evidenceChars` remains telemetry only. It is not the decision boundary.

### Examples

```text
content = “点击查看原文>”
→ seed-only
→ no semantic body
→ publishable Direct synthesis forbidden
→ Research required
```

```text
content = “FDA批准新药”
→ sparse
→ Direct synthesis is still allowed
→ review / Research recommended
```

A long body that simply repeats the headline can still become `seed-only`.

A normal English multi-sentence body is correctly atomized using `. ` sentence boundaries without splitting versions such as `1.27`, decimals or hostnames.

### Produced-artifact guard

After Direct synthesis, deterministic guards compare the generated artifact with the actual seed evidence.

Current hard-fact families:

- years;
- percentages;
- currencies;
- versions;
- measured counts.

Equivalent currency forms are normalized, e.g.:

```text
¥80,000 == 8万元
```

If Direct introduces a hard fact that does not exist in the evidence, the artifact becomes:

```text
disposition = hold
recommendation = research-required
reason = unsupported-hard-fact
```

This is a grounding gate, not a world-truth oracle. If the source article itself is wrong, Neuromancer / external evidence is still needed.

## Direct generation governance

The stale 2025 `ax-framework/models/production/latest.json` has been replaced in the candidate with:

```text
evidence-bounded-direct/v1
```

The examples no longer teach the model to invent dates, multipliers, named hardware or counts absent from the input.

The prompt explicitly forbids:

- external-memory completion;
- unsupported dates/amounts/percentages/versions/counts;
- strengthening “may / plans / reportedly” into “did / confirmed / will”.

Generator self-scores are removed:

```text
qualityScore=0.95      removed from this path
confidence=0.95        removed from this path
AI优化·Q95             retired for unmeasured Direct output
```

Instead the artifact carries generation identity:

```text
generationProfileVersion = evidence-bounded-direct/v1
evaluationStatus = unmeasured
signature = AI优化
```

Quality must come from measured holdout / human review, not generator self-report.

## Consumer safety boundary

Only an explicit:

```text
metadata.contentQuality.disposition = hold
```

is excluded from consumer delivery.

`review / research-recommended` remains deliverable. This is important: sparse-but-meaningful feeds are not silenced simply because their RSS payload is short.

Legacy inventory without Content Quality metadata remains compatible.

## Neuromancer Research v3

Research triage version:

```text
quote0-research-triage/v3
```

Modes:

```text
recovery      seed-only / missing evidence
enrichment    sparse evidence
verification  high-risk or conflict
exploration   explicit/manual research over otherwise adequate content
```

### Budget SSoT

Recovery / verification:

```text
maxToolCalls              8
maxPostSeedArtifacts      4
maxPublishableClaims      5
maxFinalizationRetries    1
maxEvidenceChars          8000
targetIndependentClusters 2
```

Enrichment / exploration:

```text
maxToolCalls              6
maxPostSeedArtifacts      3
maxPublishableClaims      4
maxFinalizationRetries    1
maxEvidenceChars          6000
targetIndependentClusters 1
```

Runtime tool/source/claim/evidence limits now consume this decision object instead of duplicating the former `6 / 3 / 4` constants.

### Deep Research playbook

Few-shot/prompt contract:

```text
eink-news-few-shot/v2
```

Phase A is explicitly ordered by information gain:

1. Canonical recovery — crawl the real seed page first when possible.
2. Provenance — follow upstream / original / official / primary links.
3. Gap map — identify 2–4 questions the seed cannot answer.
4. Corroboration — targeted search around those gaps.
5. Conflict + freshness — check status, versions, amounts and timeline drift.
6. Minimum coverage gate.
7. Marginal-gain stop only after minimum coverage has been reached or genuinely attempted.

Search-result snippets are pointers, not evidence. High-value results must be crawled/snapshotted.

Syndication chains and same-stakeholder sources may support attribution but must not be presented as independent corroboration.

### Minimum coverage for recovery

Before early stop, recovery must at least attempt:

- one readable canonical/primary body;
- one targeted search for a central externally verifiable claim or freshness gap;
- one crawl of a high-value search result when available.

If independent corroboration is objectively unavailable, the system must attempt it and then degrade / attribute / mark unresolved. Recovering the article body alone is no longer sufficient reason to stop.

## Research sampling

The old high-risk-first ordering created production sampling bias. The candidate rotates the small daily Research budget across:

```text
slot 1: quality-gap
slot 2: high-risk
slot 3: exploration
```

`quality-gap` includes both:

- priority 2: hold / research-required;
- priority 1: review / research-recommended.

Mandatory holds outrank recommended enrichment inside that bucket. If a preferred bucket is empty the worker falls back to the overall research pool.

The exploration slot is newest-first and intentionally does not silently privilege high-risk again.

## Provider separation

Production experiments exposed that Phase A and Phase B have different runtime requirements.

Phase A is tool-heavy Research. Phase B is strict no-tools JSON synthesis.

Straylight `/jobs` natively accepts `providerId`. Quote0 now supports separate configuration:

```text
STRAYLIGHT_RESEARCH_PROVIDER_ID
STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID
```

Candidate LazyCat config explicitly sets:

```text
STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID = hy3
```

Phase A keeps Straylight's normal provider selection.

This is based on a controlled same-evidence experiment described below, not a model preference guess.

## Provenance hardening

Research Receipt validation now canonicalizes source URLs by removing fragment and common tracking parameters (including `utm_*`) before comparison.

The same page cannot consume two source IDs such as:

```text
https://www.infoq.cn/article/abc?utm_source=rss
https://www.infoq.cn/article/abc
```

If both appear, validation fails closed and the finalizer may correct the Receipt on its one allowed fresh-thread retry.

This does not yet solve full semantic provenance clustering (e.g. a translation and its upstream vendor blog). That remains a separate deterministic provenance problem. The system no longer confuses literal URL duplicates with independent evidence.

## 60-item production counterfactual replay

The latest 60 production `content_inventory` rows were replayed read-only through Content Quality v2.

Disposition:

```text
DELIVER 33
REVIEW  14
HOLD    13
```

Evidence modes:

```text
adequate  34
sparse    13
seed-only 13
```

Research routing:

```text
recovery      13
enrichment    13
verification   2
direct        32
```

### Source distribution

```text
InfoQ          14 → 13 seed-only HOLD, 1 sparse REVIEW
Hacker News    14 → all adequate / deliver
DEV.to         14 → all adequate / deliver
Ars Technica   12 → all sparse / review, none held
SSPAI           3 → all adequate / deliver
Solidot         1 → adequate / deliver
GitHub changelog1 → adequate / review only for output title length
Cloudflare      1 → adequate / deliver, security topic routes verification
```

There were zero rich-body items misclassified as seed-only/sparse after the English sentence-boundary fix.

Every current HOLD in this 60-item replay was an InfoQ row whose semantic body became empty after stripping `点击查看原文>` boilerplate.

## Live Neuromancer recovery experiment

Real production seed:

```text
content_inventory id = 18341
title = 你的 Coding Agent 有多大价值，取决于它对你的数据了解多少 | 技术实践
RSS body = 点击查看原文>
```

Current production Direct artifact:

```text
title:
Coding Agent价值靠数据了解

message:
文章指出，Coding Agent的价值取决于其对用户数据的了解程度，数据认知越深，辅助编程越精准高效，强调技术实践中数据适配的重要性。

signature:
AI优化·Q95
```

This is mostly a headline paraphrase and contains no recovered article details.

### Experiment A — initial v3 recovery prompt

```text
runId   quality-v2-1787222433048
job     bb2efbee-ec23-4f4e-8812-5d1e80b175ec
thread  6228242b-1151-40ac-8f0d-a4b69081f372
```

Runtime:

```text
3 tool calls
3 crawls
0 searches
0 failed tools
```

It successfully recovered the real InfoQ article and Snowflake documentation, but stopped before independent targeted corroboration. This showed that “target independent clusters” in prose was too weak.

### Experiment B — minimum-coverage + marginal-gain prompt

```text
runId   quality-v2b-1787222618326
job     0ab9f4f4-952a-48c4-a63a-0b9a15cc77b2
thread  d9b82cfc-463c-485f-9bc1-e72cce03062d
```

Runtime:

```text
6 tool calls
4 crawls
2 targeted searches
0 failed tools
Evidence Packet = 8000 chars
```

Actual sequence:

1. crawl InfoQ canonical page — recovered the 2189-character article;
2. crawl the linked Snowflake/Medium upstream — JS/cookie challenge;
3. retry that primary with Camoufox — recovered the upstream article;
4. targeted search for Snowflake CoCo / coding-agent context;
5. targeted site search against Snowflake docs;
6. crawl Snowflake CoCo official documentation.

The agent stopped at 6/8 calls after the minimum coverage attempt rather than mechanically consuming all 8 calls.

Recovered semantic detail included:

- production-table context;
- Schema governance;
- RBAC;
- masking policies;
- row access policies;
- Dynamic Tables;
- Snowflake Tasks;
- Snowpark stored procedures;
- Snowflake CoCo's platform-integrated coding-agent context.

### Same Evidence Packet finalizer provider experiment

Two default Kimi finalization attempts both ended with the same real runtime failure:

```text
pi-json produced no assistant or tool events after one recovery attempt
```

The Straylight 0.3.89 `/jobs` state correctly reported `error` rather than the old false `completed` state.

With the exact same frozen 8k Evidence Packet and prompt, explicit:

```text
providerId = hy3
```

completed immediately.

The first hy3 artifact was then rejected by the new deterministic provenance validator because it listed the same InfoQ article twice (UTM and canonical forms).

A fresh-thread hy3 retry using the exact same Evidence Packet plus validator feedback completed successfully without new tools:

```text
job     0f38a657-3b0d-45b0-854f-75fa1609a4c2
thread  cebf228d-999d-428f-881f-05a60b41d9c2
```

Final card:

```text
title:
Coding Agent价值取决于数据上下文

message:
InfoQ译Snowflake文指Coding Agent因缺生产上下文常需人工重塑，瓶颈在运行时与数据设施语义断连。
```

Receipt sources were reduced to distinct canonical pages:

```text
InfoQ translation/seed
Snowflake Builders Blog / Medium primary
```

Claims explicitly referenced those sources. The finalizer did not pretend Snowflake product documentation independently proved the author's thesis.

## What this experiment proves / does not prove

Verified:

- the 7-character literal is no longer a generic threshold;
- short semantic evidence remains Direct-capable;
- long headline restatement can still be seed-only;
- real InfoQ stubs can be recovered into meaningful evidence;
- minimum-coverage prompting changes actual tool behavior from crawl-only to crawl + targeted search;
- dynamic research budgets are enforced by Quote0 runtime;
- hy3 is substantially more reliable than current Kimi/pi-json for this exact 8k no-tools finalizer case;
- canonical URL duplicate provenance is now fail-closed;
- the final Research card contains concrete recovered semantics absent from the current production Direct artifact.

Not yet proven:

- semantic provenance clustering across translation / upstream / same vendor;
- statistical superiority of the new Research card across the full content distribution;
- optimal 8/6 tool budgets;
- optimal finalizer provider across all content classes;
- world-truth correctness when all available sources repeat the same false claim.

Those require the existing blinded `/annotate?view=neuromancer` human feedback loop and a larger controlled sample.

## Validation

Current candidate full gate:

```text
259 tests passed
0 failed
7144 assertions
44 test files
bun run build PASS
git diff --check PASS
```

Targeted regressions additionally prove:

- seed-only boilerplate does not enter publishable Direct synthesis;
- short meaningful evidence does enter Direct synthesis and becomes Research-recommended;
- English multi-sentence bodies are not misclassified due punctuation;
- unsupported hard facts fail closed;
- equivalent currency forms do not false-fail;
- recovery gets 8/4/5/8k/2-cluster budget;
- high-risk gets verification mode and ignores incidental deep-tail risk words;
- Research budget rotates quality-gap / high-risk / exploration;
- Phase B respects dynamic source/claim caps;
- finalizer providerId is forwarded independently;
- duplicate canonical evidence URLs are rejected.

## Current Git state / authorization boundary

Candidate is detached and intentionally uncommitted. No push or deployment has occurred.

The production system is still v1.21.86 and remains unchanged by the experiments. Live canaries created Straylight test threads/jobs only; they did not write Quote0 production Research rows, review labels, inventory artifacts, or device deliveries.

## Recommended next step

Before promotion, run a small real canary set across three strata using this exact candidate:

```text
A. seed-only recovery        5 items
B. sparse enrichment         5 items
C. adequate high-risk verify 5 items
```

For each item measure:

- Direct-vs-Research blind preference;
- factual confidence;
- information density;
- E-Ink suitability;
- externally supported claim gain;
- provenance duplicate rate;
- unresolved/conflict rate;
- tool calls / wall time;
- whether Research was worth cost.

Promotion should depend on human quality evidence and factual-regression gates, not completion rate alone.
