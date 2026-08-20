# Quote0 Neuromancer Paired Review Candidate — 2026-08-20

> Production closure completed in `docs/NEUROMANCER-PAIRED-REVIEW-PRODUCTION-V12186-20260820.md`. The deployment block described below is retained as historical candidate context and is no longer current.

## Workspace / Git boundary

- Worktree: `/Users/friday/.devspace/worktrees/quote0-mcp-8ba2a887`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- Base HEAD: `70013dedb60882cbccd5f4047b692a97dbf7310f`
- Detached worktree; original source workspaces were not modified.
- No commit / push / merge / rebase / deployment performed.
- Base manifest is `v1.21.82`; current production is separately running uncommitted `v1.21.85` renderer work. This candidate MUST NOT be deployed directly from this worktree because doing so would roll back the v1.21.83–v1.21.85 production renderer changes.

## Goal

Productize successful `research_runs.result_artifact` results inside the existing `/annotate` Review Console, so human preference evidence can compare the existing direct artifact against the Neuromancer Research artifact without requiring Research content to be published or pushed first.

## Production evidence that fixed the comparison baseline

Read-only production DB inspection proved that the correct pair is:

```text
content_inventory.processed_content
  vs
research_runs.result_artifact
```

not raw RSS seed vs Research.

Examples:

- inventory `18246`
  - Direct: `Debian投票定AI/LLM贡献政策`
  - Research: `Debian表决LLM贡献政策`
- inventory `18243`
  - Direct: `印7家DigitalOcean替代云`
  - Research: `印度替代DigitalOcean七大云服盘点`

The Research artifact for inventory 18243 contains a real `neuromancer-research/v1` Receipt with three supported claims and three source artifacts.

## Architecture / data model

### Dedicated content-review ledger

Added `neuromancer_artifact_reviews`, deliberately separate from:

- `quality_annotations` — absolute content quality;
- `adaptive_layout_reviews` — renderer/layout preference.

The table stores semantic truth rather than presentation labels:

- `choice = direct | research | tie`
- semantic direct/research score columns;
- `research_side = a | b` for auditability;
- optional `research_worth_cost` after reveal.

### Deterministic blind assignment

`assignmentForResearchRun(runId)` derives A/B assignment from SHA-256(run id). The assignment is stable and does not depend on UI order or database row order.

Before the human submits a review, the API exposes each side as only:

```text
title
message
```

It intentionally withholds:

- signature / producer identity;
- Research Receipt;
- Research runtime/tool metrics;
- Straylight thread mapping;
- semantic direct/research labels.

After review submission, the API reveals the mapping and evidence.

### Human questions

Each blind side requires 1–5 scores for:

- factual confidence;
- information density;
- E-Ink suitability.

The reviewer then selects A / B / tie. Only after reveal can the user answer whether the additional Research execution cost was worthwhile.

## New API

- `GET /api/review/neuromancer/candidates`
- `GET /api/review/neuromancer/:runId`
- `PUT /api/review/neuromancer/:runId/review`
- `PATCH /api/review/neuromancer/:runId/cost`

All endpoints are Review-only and explicitly report `changesPhysicalDelivery=false`.

Candidate selection requires:

- `research_runs.state = completed`;
- non-null `result_artifact`;
- a linked `content_inventory` row with non-null `processed_content`.

Thus failed/invalid Research attempts never appear as valid human-comparison pairs.

## `/annotate` integration

The normal Review Console now exposes a `神经漫游者 A/B` entry.

Target URL:

```text
/annotate?view=neuromancer
```

The new view is implemented as an isolated component, while the ordinary three-column content review remains unchanged.

After reveal it exposes:

- Direct vs Neuromancer semantic identity;
- Research Receipt sources / claims;
- runtime tool count;
- Straylight thread deep link;
- post-reveal `Research 是否值得成本` feedback.

## Files

New:

- `src/api/neuromancer-review-service.ts`
- `src/api/neuromancer-review-service.test.ts`
- `src/api/neuromancer-review-api.ts`
- `annotation-web/src/api/neuromancer-review.ts`
- `annotation-web/src/components/NeuromancerReviewPage.tsx`
- `annotation-web/e2e/neuromancer-review.spec.ts`

Modified:

- `src/react-widgets/core/postgres-database.ts`
- `src/api/news-api-server.ts`
- `annotation-web/src/components/AnnotationPage.tsx`
- `annotation-web/e2e/mobile-shell.spec.ts`

## Verification

Focused semantic tests:

```text
7 pass
0 fail
23 expects
```

They lock:

- deterministic A/B assignment;
- blind choice -> semantic direct/research mapping;
- blind side scores -> semantic cohort mapping;
- pre-review API projection contains title/message only;
- missing content fails closed.

Full Quote0 unit suite:

```text
229 pass
0 fail
6995 expects
```

Builds:

```text
Quote0 TypeScript production build PASS
Annotation Web TypeScript + Vite production build PASS
1603 frontend modules transformed
```

Playwright regression:

```text
mobile WebKit Neuromancer blind review PASS
desktop Chromium Neuromancer blind review PASS
existing mobile content-review shell PASS
existing desktop three-column content-review shell PASS
2 cross-project skips by design
```

The E2E contract explicitly proves that before submission there is no A/B identity mapping, producer identity, or Research Receipt; after submission the mapping/evidence appears. It also asserts the blind request body contains no `research` / `神经漫游者` identity fields.

`git diff --check` PASS for tracked changes.

## Remaining deployment boundary

The current production `v1.21.85` renderer line was deployed from a managed dirty worktree based on the same `70013d` commit, but that worktree is outside the currently allowed Devspace roots and must not be bypassed.

Therefore this phase is implementation + verification only. Safe deployment requires one of:

1. first reconcile/commit the existing v1.21.85 production renderer candidate, then apply this paired-review delta; or
2. expose/open the actual production candidate worktree through Devspace and merge these changes while preserving its dirty assets.

Do not deploy this isolated v1.21.82-manifest worktree directly.
