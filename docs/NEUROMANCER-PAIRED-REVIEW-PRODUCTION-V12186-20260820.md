# Quote0 v1.21.86 — Neuromancer Paired Review Production Closure

Date: 2026-08-20 (Asia/Shanghai)

## Executive result

Quote0 now exposes successful Neuromancer Research artifacts as a first-class, blind, human paired-review queue inside the existing `/annotate` product surface.

The comparison is correctly defined as:

```text
content_inventory.processed_content   (existing Direct / AX product artifact)
vs
research_runs.result_artifact         (Neuromancer Research artifact)
```

It does not compare raw RSS prose against Research, does not publish Research automatically, and does not change physical E-Ink delivery.

Production is running `v1.21.86`. The previously deployed `v1.21.85` physical Pixel Bridge and 40×20 / 20×8 thermal title-bar fixes were first reconstructed and committed, then the paired-review feature was applied on top. No renderer rollback occurred.

## Git and release identity

Repository:

```text
https://github.com/lcolok/quote0-mcp.git
```

Reconstructed production baseline:

```text
adc02d0ac686dec4d8708b40641209eb60a60c00
feat(renderer): ship physical pixel bridge and thermal title governance
release/v1.21.85
```

Paired-review integration:

```text
ed884a6
feat(review): add blind Neuromancer artifact comparison
```

Release preparation:

```text
cc112c4
chore(release): prepare Quote0 v1.21.86
release/v1.21.86
```

Both `release/v1.21.85` and `release/v1.21.86` were pushed. `origin/main` was verified to be a strict ancestor of the release line, so final convergence can be performed as a fast-forward without rewriting history or touching the dirty primary checkout.

## Product behavior

### Blind phase

The API and UI expose only:

```text
side A: title + message
side B: title + message
```

They deliberately hide:

- Direct / Neuromancer identity;
- signature and producer;
- Research Receipt;
- source and claim evidence;
- tool/runtime metrics;
- Straylight thread identity.

The reviewer scores both sides from 1 to 5 for:

- factual confidence;
- information density;
- E-Ink suitability.

The final blind choice is A / B / tie.

### Reveal phase

Only after a human review is saved does the API reveal:

- which side is Direct and which is Neuromancer;
- the semantic `direct | research | tie` winner;
- Research Receipt sources and claims;
- runtime/tool accounting;
- Straylight thread deep link;
- the post-reveal question: whether Research was worth the additional execution cost.

### Data governance

A dedicated table, `neuromancer_artifact_reviews`, stores semantic truth rather than unstable A/B presentation labels:

```text
choice = direct | research | tie
research_side = a | b
semantic Direct scores
semantic Research scores
research_worth_cost
```

A/B assignment is deterministic from SHA-256(run id). Failed or invalid Research runs are excluded; only completed runs with a linked `content_inventory.processed_content` and non-null `result_artifact` are eligible.

No synthetic or fake human review was inserted during deployment.

## API

```text
GET   /api/review/neuromancer/candidates
GET   /api/review/neuromancer/:runId
PUT   /api/review/neuromancer/:runId/review
PATCH /api/review/neuromancer/:runId/cost
```

All responses explicitly preserve:

```text
changesPhysicalDelivery = false
```

## Production acceptance

### Candidate queue

Production returned nine real unreviewed candidates. The newest include:

- `Top 7 DigitalOcean Alternatives in India for Startups That Need More Than Droplets`;
- `Debian Starts Voting on AI/LLM Contributions for Future Development`;
- `Snowflake CoCo AI 成本优化指南：7 个关键方法 | 技术实践`;
- older completed Research artifacts from the existing canary dataset.

For a real production candidate, the pre-review contract was inspected directly:

```text
sideA keys = title, message
sideB keys = title, message
review = null
reveal = null
changesPhysicalDelivery = false
```

The review ledger row count remained:

```text
neuromancer_artifact_reviews = 0
```

### Latency

Container-local cached reads:

```text
candidate list: HTTP 200, 0.0031s, 2462 bytes
paired subject: HTTP 200, 0.0025s, 857 bytes
```

### Existing renderer regression

Real subject `348002` was replayed after v1.21.86 deployment:

```text
renderer-review/v5
renderer-governance/v3
trmnl-layout-satori-pixel/v2
quote0-news-recipe/v2
```

For 40×20, 20×8 and 296×152:

```text
physical candidate = pass
title bar = pass
excess rows = 0
point-to-point = true
critical overflow = false
```

40×20 and 296×152 remained exact against Current (`XOR=0`). 20×8 retained the intentional micro-recipe content difference.

## Verification before deployment

Backend full suite:

```text
239 pass
0 fail
7043 expects
43 test files
```

Builds:

```text
Quote0 TypeScript production build PASS
Annotation Web TypeScript + Vite build PASS
1604 modules transformed
```

Playwright:

```text
Neuromancer blind review — mobile WebKit PASS
Neuromancer blind review — desktop Chromium PASS
existing mobile review shell PASS
existing desktop three-column shell PASS
2 cross-project skips by design
```

The E2E contract asserts that producer/Research identity is absent before submit and appears only after reveal. It also asserts the blind review request contains no Research identity field.

## Build and deployment artifacts

News API:

```text
image tag: dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.86
registry digest: sha256:5251b2d763b880a0fb85f0dcfaff8757f63af822e0d9c2faaf5b7b6455f9f809
running image id: sha256:033038c19df49a48e7e102be4f053aecc5938d07ba32749055a199d0be5333e3
```

Annotation Web:

```text
image tag: dev.logic.heiyu.space/friday/quote0-annotation-web:v1.21.86
registry digest: sha256:000580f49ddbdd71050c27272cfff0d5a351f003f33328eb9d8e0b67c3fd7e6b
running image id: sha256:229e0b3e0e10111920f901944b77201891b2744aaa4bd2504a69f590b9e18811
```

LPK:

```text
lazycat/me.friday.quote0-mcp-v1.21.86.lpk
SHA-256 f51ff11967427e4f4be6cbf2026cd64cf2cde7d0be37e5f283b3cbccd90de31d
```

Installation returned `Installation successful!`.

## Runtime state

```text
/api/health.version = 1.21.86
news-api       healthy / unless-stopped
annotation-web healthy / unless-stopped
label-web      healthy / unless-stopped
PostgreSQL     healthy / unless-stopped
MinIO          healthy / unless-stopped
Redis          healthy / unless-stopped
```

Source attestation matched local release source byte-for-byte for:

- `src/api/neuromancer-review-api.ts`;
- `src/api/neuromancer-review-service.ts`;
- `src/api/renderer-review-service.tsx`;
- `src/react-widgets/core/trmnl-adaptive-renderer.ts`.

Annotation production bundle contains the `神经漫游者 A/B` and post-reveal cost-feedback UI markers.

Resource snapshot after real API and renderer acceptance:

```text
news-api       CPU 1.32%, 657.8 MiB / 1 GiB, 208 PIDs
annotation-web CPU 0.00%, 13.16 MiB / 128 MiB, 17 PIDs
```

Deployment-window logs contained no fatal, panic, OOM, unhandled, uncaught, renderer self-check failure, paired-review failure, or skipped migration. Startup confirmed schema migrations, Research worker and TRMNL prewarm.

## Known boundaries

1. There are still zero real paired human labels immediately after deployment. The feature is operational, but no quality optimum can be claimed yet.
2. Research artifacts remain review candidates only; no automatic publication or device push was enabled.
3. Chromium/TRMNL resident memory remains approximately 658 MiB and should be governed separately.
4. The package still uses legacy LPK v1 metadata and carries existing App Store lint debt. This release did not mix a packaging migration into the content-review change.
5. Provider token telemetry remains unavailable on some Straylight routes; runtime tool accounting is still the authoritative observable evidence.

## Highest-priority next step

Accumulate genuine blinded reviews across thin-source, high-risk and rich-control content, then analyze semantic Direct-vs-Research preference, factual-confidence delta, information-density delta, E-Ink suitability delta and `worth cost` by selection bucket. Do not tune Research budgets from operational completion metrics alone.
