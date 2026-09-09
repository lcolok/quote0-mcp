# Quote0 Adaptive Layout Framework v1 — Phase 1 + Production Shadow Handoff

Date: 2026-08-18 (Asia/Shanghai)

## Workspace / Git boundary

- Source repo: `/Users/friday/github/quote0-mcp`
- Isolated worktree: `/Users/friday/.devspace/worktrees/quote0-mcp-15c468f4`
- Remote: `git@github.com:lcolok/quote0-mcp.git`
- Base ref: `release/v1.21.72`
- Base HEAD: `91740ccb4e6ac72d1980d2eb01ba612ffc7b2e22`
- Worktree: detached, currently dirty only with this Adaptive Layout phase.
- Source/main checkout was already dirty and was not touched.
- No commit / push / merge / rebase / deploy in this phase.

An extra unused managed worktree was created earlier during workspace setup:
`/Users/friday/.devspace/worktrees/quote0-mcp-1aa40767`, also based on `91740cc`. It was not used for implementation.

## User goal

Promote the previously discussed adaptive-rendering direction into a real Quote0 mainline capability rather than continuing to create per-device templates. The intended architecture is:

```text
semantic content
  -> renderer-neutral AdaptiveDocument
  -> deterministic Adaptive Layout Engine
  -> AdaptiveLayoutPlan
  -> Satori backend / TRMNL backend
  -> target-size PNG / 1-bit output
```

The same content should adapt across E-Ink and thermal paper sizes without asking Neuromancer/LLM to author pixel coordinates, font sizes, or a different prompt/template per target.

## Dynamic Context Rebuild

Preflight:

- `tlens version`: `v0.2.9-50-g49ed60e`
- `tlens doctor backend`: healthy
- `skldr version`: `0.3.62`

High-value archives read:

- `ctx-rIUa`: TRMNL Framework 3.2 reassessment; renderer seam recommendation, responsive runtime, Clamp/Fit/Content Limiter, custom devices, CJK and fidelity canary.
- `ctx-p5sV`: target-first E-Ink SSoT; runtime board geometry -> `RenderTarget` -> per-target render -> 1-bit push.
- `ctx-vKXm`: original multi-target rendering + thermal label generalization.

Raw tlens evidence opened:

- `f7ffa239-9997-406f-ae6a-9870686b0e12:0`
- `f7ffa239-9997-406f-ae6a-9870686b0e12:15`

Historical conflict resolution:

- Old TRMNL PoC proved browser rendering worked but arbitrary viewport alone was not true adaptive layout.
- Current `RenderTarget` solved physical target identity but existing `NewsLayoutSpec` is still a news-specific pixel layout.
- Therefore the missing layer is a renderer-neutral semantic layout IR between content and renderer.

## Implemented vertical slice

### 1. Renderer-neutral Adaptive IR

New: `src/react-widgets/core/adaptive-layout.ts`

Version: `adaptive-layout/v1`.

Core concepts:

- `AdaptiveDocument`
- `AdaptiveNode`
- semantic roles: `eyebrow`, `title`, `body`, `keyword`, `meta`, `footer`
- priorities: `critical`, `high`, `medium`, `low`
- overflow strategies: `fit`, `clamp`, `omit`
- constraints: `minLines`, `preferredLines`, `optional`, `priority`, `baseFontPx`, `minFontPx`
- `AdaptiveLayoutPlan`

The plan records target/document identity, density tier, padding/gap/fontScale, every node's visibility/clamp/font/estimated height, explicit decisions, and `overflowRisk`.

### 2. Geometry-derived density, not SKU templates

Current v1 density policy:

- micro: `height <= 80` or `width <= 180`
- compact: `height <= 132`
- standard: `height <= 190`
- comfortable: larger targets

This is derived from runtime geometry. No target name/SKU switch is required.

### 3. Deterministic fit policy

`planAdaptiveLayout()` performs:

1. density-specific semantic visibility / line caps;
2. renderer-neutral CJK/ASCII wrap estimation;
3. gap compression;
4. low-priority line clamp;
5. optional-node omission;
6. bounded font scaling;
7. final `overflowRisk` if constraints still cannot fit.

The planner is deterministic and does not call an LLM.

### 4. TRMNL fidelity backend now consumes the plan

Modified: `src/react-widgets/core/trmnl-adaptive-renderer.ts`

Changes:

- existing `TrmnlAdaptiveContent` is adapted into `AdaptiveDocument`;
- plan is computed before HTML rendering;
- DOM visibility, line clamp, font size, line-height, gap and padding come from `AdaptiveLayoutPlan`;
- result returns `layoutPlan`;
- TRMNL remains pinned to Framework 3.2.0;
- existing browser runtime remains fidelity-only.

Important security correction during implementation:

An early debug version embedded the full `AdaptiveLayoutPlan` JSON into an inline `<script>`. Since plan text can contain user-provided content, a literal `</script>` could escape the script context. The inline plan injection was removed completely. Layout plans are returned server-side only, and a regression test covers this boundary.

### 5. Canary API exposes layout identity

Modified: `src/api/trmnl-canary-api.ts`

- status now exposes `layoutEngine: adaptive-layout/v1`;
- render result exposes `layoutPlan`;
- content may include `keyword` and `meta`;
- canary remains explicit-only, concurrency 1, not auto-selected, not replacing Satori.

### 6. Independent Satori backend

New: `src/react-widgets/core/adaptive-satori-renderer.tsx`

This consumes the same `AdaptiveLayoutPlan` rather than deriving its own target policy.

- plan visibility/gap/padding/estimated block heights are honored;
- existing Fusion Pixel selection + Satori/resvg pipeline is reused;
- a plan from another target/document fails closed instead of being silently stretched.

This proves the new IR is not a renamed TRMNL-specific layer.

### 7. Tests

New/modified:

- `src/react-widgets/core/adaptive-layout.test.ts`
- `src/react-widgets/core/adaptive-satori-renderer.test.tsx`
- `src/react-widgets/core/trmnl-adaptive-renderer.test.ts`
- `src/api/trmnl-canary-api.test.ts`

Focused latest result:

```text
15 pass / 0 fail / 104 expects
```

### 8. Real multi-target harness

New: `scripts/adaptive-layout-matrix-smoke.ts`

Package command:

```bash
bun run adaptive:smoke
```

Same representative Neuromancer/MCP semantic content is rendered through both backends across five targets:

1. 160×64 / T20×8 thermal
2. 296×128 E-Ink
3. 296×152 E-Ink
4. 320×160 / T40×20 thermal
5. runtime 400×240 / T50×30 thermal

Outputs are written under `processed-images/adaptive-layout-matrix/`.

## Real 5×2 matrix results

Summary:

```text
targetCount=5
allPlanParity=true
allExactDimensions=true
allTrmnlNoOverflow=true
```

Semantic layout behavior:

- 160×64 micro: keeps `title/body/keyword`; omits `eyebrow/meta/footer`.
- 296×128 compact: omits `eyebrow`; keeps `title/body/keyword/meta/footer`.
- 296×152 standard: all six nodes visible.
- 320×160 standard: all six nodes visible.
- 400×240 comfortable: all six nodes visible.

This is the key acceptance result: target size changes cause semantic reorganization, not proportional template shrinking.

Latest fast-path matrix after the Satori backend fix:

| target | Satori | TRMNL | TRMNL/Satori |
|---|---:|---:|---:|
| 160×64 | ~42 ms cold | ~3.4 s | ~80× |
| 296×128 | ~7.6 ms | ~4.2 s | ~553× |
| 296×152 | ~18.4 ms | ~3.4 s | ~187× |
| 320×160 | ~4.6 ms | ~3.35 s | ~729× |
| 400×240 | ~6.4 ms | ~3.37 s | ~527× |

TRMNL runtime reported `plugins.js v3.2.0` and no horizontal/vertical DOM overflow on all five targets. TRMNL still has network/runtime long-tail variance, so it remains the fidelity canary rather than hot path.

The matrix now also performs real PNG -> MSB-first 1-bit packing for both backends:

- 10/10 packed buffers exactly match target byte length;
- 10/10 bitmaps are nonblank;
- foreground bounds stay inside the physical target;
- burn ratios are recorded for visual/print comparison.

## Satori performance finding and fix

Initial profiling correctly found Adaptive Satori around 1.8–3.0s, but the Adaptive IR was not the cause. The same pre-existing `SatoriNewsWidget` path was also ~1.9–2.1s.

A new `SatoriPipelineMetrics` split the path into:

1. font initialization;
2. Satori React->SVG;
3. Resvg constructor;
4. Resvg raster render.

Before the fix, the dominant cost was `new Resvg(svg)`, not Satori or rasterization:

- Bun hot Resvg constructor: ~1.7–1.8s
- Node hot Resvg constructor: ~0.82–0.89s
- Satori SVG: generally ~3–18ms hot
- actual `resvg.render()`: ~1–3ms

Root cause: Resvg was loading/scanning host system fonts for every render. Satori already uses `embedFont:true`, so this work is unnecessary and environment-dependent.

Fix in `src/react-widgets/core/satori-renderer.ts`:

```text
font.loadSystemFonts = false
```

The Adaptive backend also passes only the 8/10/12px font families actually referenced by the current Layout Plan.

After the fix:

- Bun cold profile: ~42–77ms
- Bun hot profile: ~4–18ms
- Node hot profile: ~4–10ms
- existing production Satori isolated-process regression: ~100ms including process startup
- PNG/1-bit regressions pass

This restores the intended **Satori fast / TRMNL fidelity** split with current runtime evidence rather than old documentation.

## Production shadow vertical slice

The next P0 was implemented in the same isolated worktree without changing physical delivery authority.

Real seam: `renderSingleEinkTarget()` — the point where a target-specific primary PNG has already succeeded. It is shared by synchronous push, delivery enqueue/frame cache, and delivery-worker cache misses.

Shadow behavior:

- primary old `SatoriNewsWidget` PNG remains the only authoritative output;
- `setImmediate()` schedules Adaptive work after the caller continuation, rather than using a microtask;
- queue concurrency fixed at 1;
- queue default 32 / max 256; full queue drops instead of backpressuring;
- pending keys and a bounded 2048 completed-key cache avoid duplicate CPU work; DB `shadow_key UNIQUE` remains final idempotency;
- failed shadow renders are persisted but never thrown back into physical delivery;
- SSO protects detailed shadow evidence API; it is not in LazyCat `public_path`.

New evidence table: `adaptive_render_shadow_runs`.

Each completed row keeps content/subject/target identity, device IDs, `AdaptiveLayoutPlan`, primary/shadow Satori pipeline timings, primary/shadow 1-bit burn metrics, comparison deltas/ratios, primary image path and versioned renderer identities.

Observability:

```text
GET /api/renderers/adaptive/shadow/status
GET /api/renderers/adaptive/shadow/recent?limit=20
```

`content_inventory -> delivery worker` reconstruction was also hardened to preserve `processed.highlights` and `metadata.researchReceipt`, with a raw receipt fallback for older rows. This prevents Neuromancer Research cards from losing their semantic/evidence metadata before Adaptive shadow planning.

Real shadow smoke (`bun run adaptive:shadow:smoke`) renders the old primary and Adaptive shadow for the same Neuromancer/MCP card:

- 296×128: primary burn ratio ~0.2407 vs Adaptive ~0.0765; delta -6222 burn bits. Current sample primary cold ~60ms, shadow ~12ms.
- 296×152: primary ~0.2478 vs Adaptive ~0.0946; delta -6891 burn bits. Current warm sample primary ~7.6ms, shadow ~4.7ms.
- 2/2 completed, both sides exact packed length and nonblank.

The burn reduction is mostly the removal of the old full-width black title banner. It is an energy/ink/visual-density proxy, not an automatic quality win; promotion still requires human/physical review.

## Full repository verification

Latest verification after production-shadow wiring:

```text
base-image digest guard PASS
AX framework build PASS
bun run test:gate
221 pass / 0 fail / 6948 expects
TypeScript production build PASS
git diff --check PASS
adaptive:smoke PASS (5 targets × 2 backends)
adaptive:shadow:smoke PASS (2 primary/shadow E-Ink pairs)
```

Focused real-render tests also confirm a wrong-target Satori plan is rejected rather than stretched, shadow failures are isolated, and queue overflow drops rather than blocking the production path.

## Files changed in this phase

Modified:

- `package.json`
- `scripts/trmnl-adaptive-smoke.ts`
- `src/api/trmnl-canary-api.ts`
- `src/react-widgets/core/trmnl-adaptive-renderer.test.ts`
- `src/react-widgets/core/trmnl-adaptive-renderer.ts`
- `src/react-widgets/core/satori-renderer.ts`
- `src/react-widgets/core/rendering-modules.ts`
- `src/react-widgets/core/postgres-database.ts`
- `src/api/target-aware-eink.ts`
- `src/api/delivery-enqueue.ts`
- `src/api/device-delivery-worker.ts`
- `src/api/news-api-server.ts`
- `src/api/news-scheduler-consumer-delivery.test.ts`
- `lazycat/lzc-manifest.yml`

New:

- `docs/ADAPTIVE-LAYOUT-FRAMEWORK.md`
- `docs/ADAPTIVE-LAYOUT-HANDOFF-20260818.md`
- `scripts/adaptive-layout-matrix-smoke.ts`
- `scripts/satori-runtime-profile.ts`
- `src/react-widgets/core/adaptive-layout.ts`
- `src/react-widgets/core/adaptive-layout.test.ts`
- `src/react-widgets/core/adaptive-satori-renderer.tsx`
- `src/react-widgets/core/adaptive-satori-renderer.test.tsx`
- `src/react-widgets/core/adaptive-document-adapters.ts`
- `src/react-widgets/core/adaptive-document-adapters.test.ts`
- `src/react-widgets/core/adaptive-shadow-renderer.ts`
- `src/react-widgets/core/adaptive-shadow-renderer.test.ts`
- `src/api/adaptive-shadow-api.ts`
- `src/api/adaptive-shadow-api.test.ts`
- `src/api/device-delivery-renderable.test.ts`
- `scripts/adaptive-shadow-smoke.ts`

Generated matrix images/reports live under gitignored `processed-images/`.

## Compatibility / safety boundary

- Existing `RenderTarget.newsLayout` / `deriveNewsLayout()` production path is not deleted.
- Existing `SatoriNewsWidget` production path remains intact.
- TRMNL remains a canary, not auto-selected.
- No existing Research/Review/Inventory schema was rewritten; the shadow evidence table is additive and isolated.
- No production service was restarted or deployed.
- No main/source WIP was modified.

Adaptive v1 is a new seam and can be migrated consumer-by-consumer.

## Highest-priority next phases

Completed during this phase after the initial handoff draft:

- Satori pipeline profiling and fast-path root-cause fix;
- 1-bit packing / foreground / burn-density matrix metrics;
- `RenderableDataItem` / Neuromancer Research Receipt -> `AdaptiveDocument` adapter;
- TRMNL renderer can consume `AdaptiveDocument` directly through `renderDocument()`.

### P0 — Shadow production observation (requires separate deploy authorization)

The shadow code path is ready, but production is unchanged until a separately authorized release/deploy. After deployment, keep existing `SatoriNewsWidget` authoritative and collect real target/source/content-class distributions for render latency, burn ratio, bounds, queue drops/failures and LayoutPlan decisions before considering any automatic promotion.

### P1 — Visual Review / golden fixtures

Add human A/B review and visual golden fixtures for Satori-fast vs TRMNL-fidelity. Pixel equality is not the goal; evaluate information retention, text legibility, 1-bit clarity and crop behavior.

### P1 — Thermal content convergence

Feed existing thermal-label content into the same IR and test unknown runtime paper sizes to prove no new template is needed per SKU.

### P2 — Feedback-driven policy optimization

Use E-Ink/print human review to tune density/priority policy. Feedback should update one Adaptive Layout policy rather than separate Satori/TRMNL/device templates.
