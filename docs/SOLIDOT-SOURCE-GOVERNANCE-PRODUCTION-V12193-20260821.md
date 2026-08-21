# Quote0 Solidot Source Governance — Production v1.21.93

Date: 2026-08-21
Workspace: `/Users/friday/github/_worktrees/quote0-solidot-governance-20260821`
Branch: `fix/solidot-source-governance-20260821`
Base: `17ec8d687c3d84782ef032e0ced42eafff9c24c3` (`recovery/v1.21.92-production-20260821`)
Remote: `https://github.com/lcolok/quote0-mcp.git`

## Objective

Restore the missing Solidot production feed after the 2026-08-20 LazyCat reboot and make core RSS source outages observable instead of silently disappearing behind scheduler cooldown.

## Incident root cause

- Solidot remained present in Quote0's core RSS registry and the 8-source production rotation.
- Last successful Solidot producer run before the incident: 2026-08-20 16:12 +08.
- LazyCat host booted at 2026-08-20 16:59 +08.
- Every Solidot run after reboot began failing with `RSS数据获取失败 (Solidot): Request timed out after 8000ms`.
- The scheduler correctly accumulated `failureCount=3` and entered a 120-minute cooldown, but there was no source-level persisted health/alert surface.
- `me.friday.tailscale` was still reported as `Installed`, but `lzc-cli app log me.friday.tailscale` returned `not yet realized`; no Tailscale containers, `tailscale0`, or table-52 route existed on the host.
- devaiplus itself remained healthy. `100.94.204.103:8899/solidot.rss` returned current RSS from other Tailnet peers.

## Recovery of the Tailnet dependency

The existing local `me.friday.tailscale-v1.0.1.lpk` was **not** installed blindly. Inspection showed its packaged `TS_AUTHKEY` was empty, while the production persistent config still held a valid key. Because `run.sh` copies packaged `config.env` over the persistent file at every start, installing that old artifact would have destroyed the valid auth configuration.

A fresh v1.0.1 LPK was rebuilt with the current persisted auth key injected only through an environment variable; the packaged key hash was checked against the production config hash without printing the secret. The rebuilt LPK was installed successfully.

Post-recovery evidence:

- `mefridaytailscale-tailscale-1`: healthy
- `mefridaytailscale-app-1`: healthy
- `tailscale0`: present/up
- `100.94.204.103` routes through table 52 via `tailscale0`
- priority-5200 LAN-main-table workaround is present
- LazyCat host → Solidot relay: HTTP 200, ~40–50 ms

## Rejected decoupling experiment: Tailscale Funnel

A more decoupled architecture was tested before falling back to Tailnet recovery:

- Enabled Funnel on devaiplus for the read-only relay at HTTPS 443.
- Also tested HTTPS 8443.
- Funnel configuration itself was valid and advertised `devaiplus.ison-hoki.ts.net`.
- LazyCat resolved the Funnel edge and successfully established TCP, but TLS stalled after ClientHello with no ServerHello on both 443 and 8443.
- Control request to `tailscale.com` from LazyCat succeeded, so this was specific to the Funnel edge/TLS path rather than total Tailscale-domain reachability.

Conclusion: Funnel is **not** a viable Quote0 production path from the current LazyCat network. Both 443 and 8443 Funnel listeners were disabled again; final Funnel status is `{}`.

## Quote0 v1.21.93 governance changes

### Persistent RSS health

Added `rss_source_runtime_state`:

- `source_id`
- `health` (`unknown|healthy|degraded`)
- `last_success_at`
- `last_failure_at`
- `consecutive_failures`
- `last_error`
- `outage_started_at`
- `updated_at`

Scheduler semantics:

- One transient fetch error does not create an outage.
- A source becomes `degraded` only when its consecutive failures reach the existing scheduler failure threshold.
- A reachable source with no fresh candidate remains healthy; `producer:no_fresh_candidate` is not treated as source failure.
- A successful fetch clears failure state and closes an outage.

### RSS alert outbox

Added `rss_source_health_alerts` and a dedicated worker.

- Outage/recovery transitions are persisted atomically with runtime health.
- Duplicate ongoing outage alerts are suppressed.
- If Bark is unavailable, the event is recorded rather than silently lost.
- Production currently reports `barkAlertsConfigured=false`, so source health is visible in DB/API but push notifications are not yet active.

### Health API

Added:

`GET /api/news/sources/health`

It projects every registry source together with persisted runtime health. Core sources are `alertable=true`; extended/legacy sources are still observable but not high-signal alert targets by default.

### Solidot relay runtime SSoT

`SOLIDOT_RSS_URL` now overrides the registry URL at runtime. Production is explicitly set to:

`http://100.94.204.103:8899/solidot.rss`

The code retains the same address as a fallback, so a future public relay can be cut over through environment/release config without another registry-code rewrite.

## Validation before deployment

- Focused governance tests: 36 pass / 0 fail.
- Full suite after final v1.21.93 bump: 288 pass / 1 optional PostgreSQL test skipped / 0 fail / 7260 assertions.
- TypeScript build: PASS.
- `git diff --check`: PASS.

A real PostgreSQL 17 container was also used for the RSS health transition test. The first run exposed a real `$4` parameter type inference bug (`42P08`) that mocks had missed. Explicit `timestamptz/integer/text` casts fixed it. Final real-PG result:

- 1 pass / 0 fail / 19 assertions.
- Verified: failure 1/3 no outage → failure 3/3 degraded + one outage → failure 4/3 no duplicate → success healthy + recovery.

## Build and deployment

News API image:

- tag: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.93`
- remote no-cache build: PASS
- registry digest: `sha256:845b0d719646ea98104f1f41ab52ed6c5c5d0f21d6bf2f3ad6563bf816a62bdb`
- running image id: `sha256:241037685affe80736bcab4ed009e15eb1253ac7c986f3fce6d626a583405165`

LPK:

- `lazycat/me.friday.quote0-mcp-v1.21.93.lpk`
- SHA-256: `755c023e0aed160fa637317109156ea0e09462457c16466f8e8a744d55bd6942`
- install: successful

Known legacy LPK v1/App Store lint warnings remain unchanged; they were not mixed into this incident fix.

Runtime after install:

- `/api/health.version = 1.21.93`
- news-api healthy
- postgres/minio/redis/app healthy
- Tailscale app remained healthy through the Quote0 reinstall
- both new RSS health tables exist
- `/api/news/sources/health` responds successfully

The following production-relevant files were SHA-256 compared between the local release worktree and the running v1.21.93 container and matched byte-for-byte:

- `src/api/rss-source-health.ts`
- `src/api/device-health-alerts.ts`
- `src/api/news-api-server.ts`
- `src/api/news-scheduler.ts`
- `src/api/server.ts`
- `src/react-widgets/core/data-sources/rss-source-registry.ts`
- `src/react-widgets/core/postgres-database.ts`
- `lazycat/lzc-manifest.yml`

## Production Solidot E2E

The stale Solidot scheduler cooldown/failure state was cleared after the relay was proven reachable. No source list, cadence, or long-term producer configuration was changed.

Because the existing scheduler create API has a separate jsonb serialization bug for `rss_sources`, a temporary isolated single-source producer job was inserted with explicit jsonb casts and then loaded/triggered through the Scheduler API. It was deleted immediately after the run.

### Producer

Run:

- job: temporary `solidot-recovery-e2e-20260821`
- source: `solidot`
- run id: `383181`
- started: 2026-08-21 18:53:51 +08
- layer: `strict`
- candidate publish time: 2026-08-21 15:16 +08
- result: `success / producer_stored`
- relay fetch: 5 items

Created inventory:

- id: `18416`
- source: `solidot`
- original title: `Bilibili 进军国际市场`
- Direct draft entered Universal Research with `researchGate=pending`

RSS health after the successful producer:

- source: `solidot`
- health: `healthy`
- consecutive failures: `0`
- last success: 2026-08-21 18:53:54 +08
- outage: none

### Universal Research

Run:

- id: `8e86a4be-1092-404d-b303-a5e3aae4b69b`
- trigger: `inventory-auto`
- source inventory: `18416`
- final state: `completed`
- completed: 2026-08-21 18:55:26 +08
- research mode: `digest`
- tool calls: `4`
- evidence chars: `5000`

Final gate:

- `researchGate=ready`
- final title: `B站重发国际版拟进全球`
- evidence-grounded final message was materialized before delivery.

No device delivery existed while the gate was pending.

### Consumer / device delivery

At 2026-08-21 18:55:41 +08, consumer `device-content-rotator` registered 3/3 deliveries for content 18416:

- `eink-1`: queued, device already offline
- `eink-2`: succeeded
- `eink-3`: queued, device already offline

Physical success evidence for `eink-2`:

- delivery id: `64273`
- attempt: `1/5`
- EPD1 trace: `d64273-a1`
- request CRC32: `8a221da3`
- ACK trace: `d64273-a1`
- ACK CRC32: `8A221DA3`
- outcome: `succeeded`
- finished: 2026-08-21 18:55:44 +08

The other two devices were not reported as successful; their existing runtime health is offline/connection failure and the deliveries correctly remain queued.

## Additional finding discovered during E2E

`POST /api/news/scheduler/jobs` has a pre-existing jsonb serialization bug: `upsertSchedulerJob()` sends JS arrays such as `rssSources` directly to `pg`, which encodes them as PostgreSQL array text (`{"solidot"}`) rather than JSON, causing `invalid input syntax for type json`. The PATCH path already handles job-role changes and is not the root of this incident. This should be fixed separately rather than mixed into v1.21.93.

## Current boundaries / remaining debt

1. **Tailscale lifecycle dependency remains**: this incident was recovered by re-realizing `me.friday.tailscale`; LazyCat's reboot-time realization behavior is still a platform/lifecycle weakness.
2. **Funnel rejected for now**: public Funnel TLS is not usable from the current LazyCat network.
3. **Bark key absent**: RSS source outages are now persisted and queryable, but active Bark notifications remain disabled until a device key is configured.
4. **Scheduler create API jsonb bug**: discovered, not fixed in this release.
5. **Git state**: v1.21.93 was built from branch `fix/solidot-source-governance-20260821`, based on the recovered production commit `17ec8d6`. No commit or push was performed in this authorized production action. The worktree retains the exact deployed source and the running-container hashes have been verified.

## Rollback

- Quote0 application can be rolled back to the known v1.21.92 image/release envelope if needed.
- `SOLIDOT_RSS_URL` remains the original Tailnet relay address, so no relay URL migration needs reverting.
- Funnel is already disabled; no public exposure remains.
- Tailscale restoration is independent of Quote0 v1.21.93 and should remain running because it is required by the current Solidot topology and other Tailnet-dependent workloads.
