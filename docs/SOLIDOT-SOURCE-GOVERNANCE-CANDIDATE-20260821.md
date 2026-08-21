# Quote0 Solidot Source Governance Candidate — 2026-08-21

## Executive result

Solidot was not removed from Quote0. The production outage is a cross-application lifecycle dependency failure:

```text
Quote0 v1.21.92
  → http://100.94.204.103:8899/solidot.rss
  → LazyCat host must have Tailnet connectivity
  → me.friday.tailscale lzcapp must be realized
  → devaiplus relay
  → r.jina.ai
  → Solidot
```

After the LazyCat box rebooted at 2026-08-20 16:59 +08, `me.friday.tailscale` remained installed but was not realized. Solidot last succeeded at 16:12; the first post-reboot attempt at 17:32 timed out, followed by repeated 8-second fetch timeouts and scheduler cooldowns.

The durable governance direction is therefore two-layered:

1. Quote0 must make core RSS outages observable and persistent instead of silently relying on cooldown state.
2. Solidot transport should no longer require the Quote0/LazyCat host itself to join Tailnet. The preferred production migration is a read-only public HTTPS relay on devaiplus, with Quote0 consuming it through a runtime URL SSoT.

No production restart, reinstall, Funnel enablement, Quote0 deployment, commit, or push was performed in this candidate phase.

## Workspace / Git boundary

```text
worktree: /Users/friday/github/_worktrees/quote0-solidot-governance-20260821
branch:   fix/solidot-source-governance-20260821
base:     17ec8d6 (exact recovered v1.21.92 production source)
remote:   https://github.com/lcolok/quote0-mcp.git
```

The branch is intentionally uncommitted pending production-action authorization and final release composition.

Related context:

- `ctx-xieq` — Solidot Tailnet outage diagnosis
- `ctx-ARvD` — v1.21.92 production source Git recovery
- `ctx-bncz` — Quote0 content governance audit

## Production evidence

### Quote0 source configuration

Solidot remains a core source in the production registry and in the enabled producer pool:

```text
multi-source-rotation.rss_sources =
solidot, sspai, hackernews, arstechnica,
infoq-cn, dev-to, github-changelog, cloudflare-blog
```

The scheduler currently records `failureCount.solidot=3` and applies the existing 120-minute cooldown after repeated failures.

### Timeline

```text
2026-08-20 16:12 +08  Solidot producer success
2026-08-20 16:59 +08  LazyCat whole-box reboot
2026-08-20 17:32 +08  first Solidot fetch timeout
2026-08-20 17:42 +08  timeout
2026-08-20 17:52 +08  timeout → cooldown
2026-08-21            repeated timeout/cooldown cycles
```

Latest production Solidot inventory remains from 2026-08-20 16:12.

### Relay is healthy

From the development machine over Tailnet:

```text
GET http://100.94.204.103:8899/solidot.rss
HTTP 200
~65 ms
lastBuildDate = 2026-08-21 17:42 +08
```

`devaiplus` is online, `solidot-proxy.service` is active, Tailscale backend is Running, and port 8899 is listening.

The relay server exposes only:

```text
GET /solidot.rss  → cached RSS
GET /health       → last refresh + item count
other paths       → 404
```

It does not provide a general-purpose proxy endpoint.

### LazyCat side is the failed boundary

Current LazyCat host:

```text
no tailscale0
no tailscaled host service
no 100.64/10 Tailnet route
ip route get 100.94.204.103
  → via 192.168.31.1 dev enp2s0
```

Application state:

```text
lzc-cli app status me.friday.tailscale → Installed
lzc-cli app log me.friday.tailscale    → not yet realized
lzc-docker ps -a                       → no me.friday.tailscale containers
```

Persistent Tailscale config/state still exists; no credential value was logged or copied into this report.

The package already declares `application.background_task: true`, but that setting prevents idle suspension; it is not a reliable boot-time realization primitive for an infrastructure dependency.

## Quote0 governance implemented

### 1. Persistent RSS source runtime health

New table:

```text
rss_source_runtime_state
```

Tracks:

- health: `unknown | healthy | degraded`
- last successful fetch
- last failed fetch
- consecutive failures
- last error
- outage start

Semantics deliberately separate availability from freshness:

```text
reachable + no fresh candidate → healthy
fetch/integration failures below threshold → telemetry only
consecutive failures reaching scheduler threshold → degraded
successful fetch after degraded → healthy recovery
```

This means a low-frequency feed is not falsely treated as failed merely because it has not published a new story.

### 2. Durable outage/recovery outbox

New table:

```text
rss_source_health_alerts
```

Only `profile=core` sources produce notifications. State transition and outbox insertion happen atomically in PostgreSQL.

Repeated failures during one degraded incident do not produce duplicate alerts. Recovery is a distinct event.

Bark transport reuses the existing Quote0 sender but uses a separate group:

```text
quote0-rss
```

If Bark is not configured, the event is still persisted as `skipped` so the incident remains auditable without accumulating stale pending notifications.

Production currently has Bark alerts enabled but no usable device key configured, so deployment of this code would make source incidents visible in the database/API immediately; network notifications would remain skipped until a key is configured through the LazyCat console.

### 3. Scheduler integration

`news-scheduler.ts` now records:

- source success when a real candidate is processed;
- source success when the source is reachable but there is no fresh candidate;
- source failure with the actual scheduler failure count, threshold, and error reason.

RSS health bookkeeping is fail-open relative to the scheduler hot path: a health-table/outbox error is logged but cannot stop source rotation, inventory production, or device delivery.

### 4. Runtime relay URL SSoT

Solidot registry entry now supports:

```text
SOLIDOT_RSS_URL
```

The override must be HTTP/HTTPS; invalid values fall back to the built-in URL.

This lets production migrate from the current private Tailnet address to a public HTTPS relay without another source-registry code rewrite.

### 5. Health API

New endpoint:

```text
GET /api/news/sources/health
```

Returns per-source:

- registry name/profile
- runtime health
- consecutive failures
- last success/failure
- outage start
- last error
- whether it is alertable
- whether Bark transport is currently configured

## Validation

### Targeted regression

```text
36 pass
0 fail
205 assertions
```

Covers RSS health policy, existing device Bark behavior, scheduler cooldown, producer fallback, source registry runtime override, and RSS data-source behavior.

### Real PostgreSQL integration

A temporary isolated PostgreSQL 17 container was created locally and destroyed after the test.

The first real-DB run found a genuine CTE parameter inference bug (`42P08`, text vs timestamptz) that mock tests could not reveal. Explicit parameter casts were added.

Final real-DB result:

```text
1 pass
0 fail
19 assertions
```

Verified sequence:

```text
1/3 failure → no incident
3/3 failure → degraded + one outage outbox row
4/3 failure → no duplicate outage
success → healthy + recovery outbox row
```

### Full suite

```text
288 pass
1 optional PostgreSQL test skipped without TEST_DATABASE_URL
0 fail
7260 assertions
50 test files
```

The PostgreSQL test was separately executed and passed with `TEST_DATABASE_URL` against the temporary PostgreSQL 17 instance.

Additional gates:

```text
bun run build  PASS
git diff --check PASS
```

## Durable transport migration candidate

`devaiplus` currently has Tailscale v1.102.2 and the tailnet grants Funnel/HTTPS capability. Funnel is not enabled.

Tailscale Funnel can expose a local HTTP service through a stable public `*.ts.net` HTTPS endpoint. With background mode, Tailscale documents the configuration as persistent across host reboot/Tailscale restart.

Candidate production topology:

```text
Quote0
  → https://devaiplus.<tailnet>.ts.net/solidot.rss
  → Tailscale Funnel HTTPS
  → 127.0.0.1:8899
  → cached Solidot relay
```

Benefits:

- Quote0/LazyCat no longer needs Tailnet membership for Solidot.
- LazyCat reboot cannot remove Solidot connectivity merely because a separate Tailscale lzcapp is not realized.
- devaiplus Tailscale is a native system service and already survives its own boot lifecycle.
- relay requests read a cache; public fetches do not directly multiply upstream r.jina/Solidot requests.
- only `/solidot.rss` and `/health` exist; all other paths return 404.

Production enablement is deliberately not part of this candidate because Funnel makes the relay internet-accessible and is therefore an explicit infrastructure change.

## Recommended production sequence after authorization

1. Enable a background HTTPS Funnel on devaiplus pointing to localhost:8899.
2. Verify the public HTTPS URL from a non-Tailnet network and confirm `/solidot.rss` returns valid RSS while arbitrary paths return 404.
3. Set Quote0 `SOLIDOT_RSS_URL` to the HTTPS endpoint in the release manifest/runtime configuration.
4. Release Quote0 from the recovered v1.21.92 Git baseline plus this governance patch (and any separately approved P0 content patch), with a new version rather than overwriting v1.21.92.
5. Verify `GET /api/news/sources/health` and the new schema migrations.
6. Trigger exactly one Solidot producer run; do not high-frequency probe the upstream source.
7. Confirm a new Solidot inventory row or a healthy/no-fresh state, then observe at least one full source rotation.
8. Keep the old private Tailnet relay URL only as rollback information; do not keep two independent producer paths that could duplicate content.

## Remaining boundary

Current production Solidot is still unavailable from Quote0 because neither the LazyCat Tailscale app nor the public HTTPS replacement has been activated. This report describes and validates the governance candidate; it does not claim production recovery.
