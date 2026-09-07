# Quote0 Shareable News URL / Deep-Link Contract · v1.21.119 · 2026-08-31

## User goal

The user reported that opening a news item did not put item identity/state into the browser URL, making it difficult to copy a link into a ChatGPT discussion and reliably refer to the same news item later. The goal is a system-wide URL contract that identifies the stable news subject, the exact delivery/research snapshot, and the relevant review view without serializing mutable article text or secrets.

## Workspace / Git boundary

- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- No commit / push / merge / rebase / reset / stash / clean performed.
- Existing v1.21.114–118 dirty Quote0 governance work and pre-existing `package.json` / corpus replay WIP were preserved.

## DCR / evidence

Preflight:
- tlens `v0.2.9-89-g7dcb97e`
- tlens backend healthy
- skldr `0.3.62+introspect.d35e07a`

Relevant history:
- `ctx-Q8ys`: selected-state UI work; state was primarily React-local.
- `ctx-xiQX`: React19/Tailwind annotation console.
- `ctx-ARIJ`: Neuromancer paired review historically used only `?view=neuromancer`.
- `ctx-LKx7`: v1.21.118 provenance/freshness production baseline.
- raw tlens `ses_1d9f24029ffe0FPYf2aUautavJ:2`: historical per-id annotation/detail paths.

## URL contract decision

The URL is an identity/view contract, not a dump of component state.

### Stable identity

- `v=1`: URL contract version.
- `subject=<fingerprint>`: stable news subject identity. Survives multiple deliveries/replays of the same article.

### Exact snapshot

- `delivery=<news_push_log id>`: exact delivery/review snapshot. Required for precise reproduction of what the user was looking at.
- `run=<research run UUID>`: exact Neuromancer Research pair/run.
- `inventory=<content_inventory id>`: exact inventory subject backing a Research run.

### Reproducible view state

Content review `/annotate`:
- `view=content|neuromancer`
- `mode=content|renderers`
- `target=<renderer target id>` e.g. `eink-296x152`
- `pane=list|preview|actions`
- `q=<search text>` when applicable
- repeated `device=<device id>` when a specific E-Ink subset is selected

Scheduler `/scheduler`:
- `delivery`
- `subject`
- `q`
- `page`

Neuromancer A/B:
- `view=neuromancer`
- `run`
- `inventory`

Not serialized into URLs:
- title/body/summary
- evidence body
- tokens/model output
- auth/session/token/secret fields
- cursor pagination internals

Rationale: title/body are mutable generated content and can go stale; cursor is pagination implementation detail. `fingerprint + delivery/run` is sufficient stable + exact identity.

## Implementation

### New URL state SSoT

`annotation-web/src/lib/review-url-state.ts`
- parse/validate URL state
- canonical patch helper
- repeated device param dedupe
- positive integer guards for delivery/inventory/page
- defaults for view/mode/target/pane

### AnnotationPage

`annotation-web/src/components/AnnotationPage.tsx`
- selected delivery, review mode, renderer target, search, mobile pane, selected devices now derive from URL.
- selecting an item updates `delivery + subject`.
- previous/next navigation updates identity.
- Renderer A/B updates `mode`.
- mobile list/preview/actions updates `pane`.
- search updates `q` and clears old selected identity.
- opening bare `/annotate` canonicalizes to the currently displayed first subject/delivery and explicit view defaults.
- adds `复制此条链接`.

Critical deep-link hardening: a target delivery may no longer be inside the current cursor page of 50 subjects. The page therefore independently loads `/api/scheduler/push-history/:id` from URL `delivery` and can reconstruct the current record without list membership.

### SchedulerPage

`annotation-web/src/components/SchedulerPage.tsx`
- selection/search/page are URL-owned.
- detail can restore a delivery outside current page.
- selection writes `delivery + subject`.
- search writes `q` and clears stale selection.
- page writes `page`.
- adds `复制链接`.

### NeuromancerReviewPage

`annotation-web/src/components/NeuromancerReviewPage.tsx`
- selected pair derives from URL `run`.
- `inventory` is canonicalized after pair load.
- first unreviewed candidate canonicalizes a bare `view=neuromancer` URL.
- next/candidate selection updates `run + inventory`.
- adds `复制此条链接`.

### Backend stable identity exposure

`src/api/news-api-server.ts`
- legacy scheduler history list now also exposes `fingerprint`.
- existing fields preserved; no breaking removal.

### Production-build hardening

`annotation-web/tsconfig.json`
- excludes `src/**/*.test.ts(x)` from production TypeScript build.
- This was discovered because the isolated annotation Docker context correctly does not have root `@types/bun`; a Bun unit test under `src` must not be compiled into production UI.
- No dependency or lockfile change was needed.

## Tests / validation

### Annotation static build
- `bun install --frozen-lockfile`: PASS, no lockfile diff.
- `bun run build`: PASS, 1605 modules transformed.
- URL helper unit test: 3 pass / 0 fail.

### Browser E2E
Focused Playwright:
- `mobile-shell.spec.ts + neuromancer-review.spec.ts`: 5 pass / 3 project skips / 0 fail.
- `scheduler-url.spec.ts`: 1 desktop pass / 1 project skip / 0 fail.

Covered:
- bare `/annotate` canonicalizes to v/subject/delivery/mode/target/pane.
- mobile pane state appears in URL.
- Renderer mode appears in URL.
- delivery outside current review page restores directly from detail API.
- Neuromancer `run + inventory` restores same pair.
- Scheduler selection survives reload; search updates q and clears stale delivery.

### Backend/full suite
Before release bump, after backend fingerprint change:
- root `bun test`: **340 pass / 1 skip / 0 fail / 7479 expectations**.
- root `bun run build`: PASS.
- `git diff --check`: PASS.

After bump to v1.21.119:
- release-version tests: 5/5 PASS.
- root build: PASS.
- annotation build + URL unit tests: PASS.

### Remote isolated annotation build
Initial remote build correctly failed because `src/lib/review-url-state.test.ts` was included in production `tsc` and isolated annotation context has no `bun:test` types. No image/install occurred from that failed attempt.

Fix: exclude test files in `annotation-web/tsconfig.json`. Rebuild succeeded under the real isolated Docker context with `bun install --frozen-lockfile`.

## Release / production

Production release: **v1.21.119**.

Images:
- news-api: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.119`
  - registry digest: `sha256:6e1c895db0caf0e81732e19d3eb62fe644b95a0e363bd07a319d76b5fae472f2`
- annotation-web: `dev.logic.heiyu.space/friday/quote0-annotation-web:v1.21.119`
  - registry digest: `sha256:85bac7e1b7a87fa3a4e40bcb9782f556d2371d8c0da43c0e34413ba029712c78`
- label-web unchanged `v1.21.29`.

LPK build/install: success.

Runtime:
- `/api/health`: healthy, version `1.21.119`.
- Research policy remains `quote0-research-triage/v12` / local-qwen / structured-inference / fallback none.
- all 7 Quote0 containers healthy.
- all 7 restart policies restored to `unless-stopped` after pkgm install.

E-Ink chain continued after release:
- latest `eink-2` deliveries after install remained succeeded, including delivery contents 19054/19065/19059/19057/19066.

## Production identity evidence

Latest production review subject at verification:
- delivery id: `366202`
- fingerprint: `502eb8bfbaa056ca49e759d50246eec6`
- title: `得物推荐Harness打通Agent研发链路`

Both `/api/review/subjects?limit=1` and `/api/scheduler/push-history?limit=1` returned the same delivery/fingerprint pair.

Production browser was tested by SSH-forwarding directly to the running annotation-web container (bypassing only LazyCat SSO, not using local mocks) while its `/api` proxy continued to the real production news-api.

Content deep link restored:
- subject `502eb8bfbaa056ca49e759d50246eec6`
- delivery `366202`
- view `content`
- mode `content`
- target `eink-296x152`
- pane `preview`
- visible title exactly `得物推荐Harness打通Agent研发链路`

Scheduler deep link restored the same delivery and showed `推送详情`.

Neuromancer production deep link restored:
- run `0d8b0469-9e50-46c0-957c-6df8d198a03e`
- inventory `19066`
- subject title `Google 改变了其搜索结果的展示方式`
- Neuromancer review heading visible.

## Example canonical forms

Content review:
`/annotate?v=1&view=content&subject=<fingerprint>&delivery=<id>&mode=content&target=eink-296x152&pane=preview`

Renderer review:
`/annotate?v=1&view=content&subject=<fingerprint>&delivery=<id>&mode=renderers&target=eink-296x152&pane=preview`

Specific device context:
append repeated `&device=eink-2&device=eink-4`

Neuromancer:
`/annotate?v=1&view=neuromancer&run=<uuid>&inventory=<id>`

Scheduler:
`/scheduler?v=1&delivery=<id>&subject=<fingerprint>&q=<optional>&page=<optional>`

## Remaining boundary

No Git commit/push was performed. Deployed production contains the validated dirty-worktree candidate plus the previously deployed v1.21.118 governance work. Git reproducibility remains pending explicit authorization.
