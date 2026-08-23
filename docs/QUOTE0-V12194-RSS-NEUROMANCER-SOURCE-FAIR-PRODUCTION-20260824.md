# Quote0 v1.21.94 — RSS Identity / Neuromancer Depth / Source-Fair Replay Production Deployment

Date: 2026-08-24 (Asia/Shanghai)

## Executive result

Quote0 v1.21.94 has been deployed to production and verified end-to-end.

This release combines three previously verified governance fixes into one production release:

1. **Stable RSS subject identity**: RSS display/freshness time no longer manufactures content identity; canonical source+link identity is stable across missing/future/corrected pubDate and tracking parameters. A 72h compatibility alias prevents existing active inventory from being reborn under new fingerprints during rollout.
2. **Neuromancer digest minimum evidence gain**: Universal `digest` remains bounded to max 4 tool calls but now requires at least one freshness/provenance targeted search before Phase A may advance; target independent provenance clusters increased from 1 to 2. Runtime hard gate rejects zero-search digest instead of relying only on prompt obedience.
3. **Source-fair display replay**: fresh `ready` content remains FIFO-first; fallback historical replay now first selects the source whose newest display is oldest, then the oldest article within that source. This removes article-count bias that made DEV/HN/InfoQ visually dominate low-volume Solidot.

Production release: **v1.21.94**.

No Git commit, push, merge, rebase, release ref, or remote branch update was performed. Production is therefore deployed and source-attested, but Git reproducibility debt remains until explicitly authorized.

## Workspace / Git boundary

- Source repo: `/Users/friday/github/quote0-mcp`
- Isolated worktree: `/Users/friday/github/_worktrees/quote0-rss-neuromancer-governance-20260823`
- Branch: `fix/rss-neuromancer-governance-20260823`
- Base HEAD: `07af89665c14bbfd1fd073ad0ef6fd3ceda871e5`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- Worktree remains dirty with the authorized candidate changes and reports.

Prior context / evidence:

- `ctx-LKrq` — RSS quality + Neuromancer depth candidate
- `ctx-6VPI` — Solidot visibility / source-fair replay candidate
- `ctx-PcXr` — Solidot v1.21.93 production restoration
- tlens raw `454e847a-a997-422a-8462-f9dad1771478:0` — historical article-level LRU design motivation

## Release gate

Manifest / release identity:

- top-level version: `1.21.94`
- news-api image: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.94`
- annotation-web remains `v1.21.86`
- label-web remains `v1.21.29`
- Postgres / MinIO / Redis digest pins unchanged

Pre-release governance:

- base-image guard: PASS
- version pre-release gate: PASS
- expected warnings: dirty working tree, no exact `release/v1.21.94`, HEAD not represented on remote

Final local validation after version bump:

```text
bun test
300 pass
1 optional real-PostgreSQL test skipped
0 fail
7292 expectations
50 test files

bun run build
PASS

git diff --check
PASS
```

The first post-bump full test exposed only the expected stale version assertion (`1.21.93`); `src/api/release-version.test.ts` was updated to `1.21.94` and the complete gate was rerun successfully.

## Image build

Used the safe single-service production route, avoiding conditional-manifest `--service` tag resolution:

```text
lcctl project remote-build
  --ssh root@logic.heiyu.space
  --context .
  --dockerfile Dockerfile.api
  --tag dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.94
  --no-cache
  --cleanup
```

Result:

- build: PASS
- push: PASS
- registry digest: `sha256:575ba4fe63869dd6797d86c907a05acf206df049b47680eff1b59abc2767a73d`
- image ID: `sha256:822e7ebf27929d6bbe58e6bbe65b61241e86f8951fb783976b50d0646f7f2615`

## LPK build / install

LPK:

- file: `lazycat/me.friday.quote0-mcp-v1.21.94.lpk`
- SHA-256: `b7a07dadd3b71dadad46d8efa662313b5803658ea9b5650cdd79de58fddb570b`

`lzc-cli project build` succeeded with the existing legacy LPK v1 / App Store lint warnings only.

### Installation tooling failure and root cause

Initial install failed before touching production:

```text
Failed to check Lazycat Developer Tools in remote mode.
remote command failed: version
```

Production remained v1.21.93 / healthy.

Box-side investigation proved Developer Tools itself was healthy:

- `cloudlazycatdevelopertools-app-1`: running / healthy
- exact backend command `/lzcapp/pkg/content/debug.bridge version`: exit 0
- backend version: `1.0.7`

`lzc-cli --log trace` exposed the actual client-side failure:

```text
ControlPath too long (... >= 104 bytes)
```

`lzc-cli 2.0.6` builds SSH multiplex paths under macOS's long `$TMPDIR`, exceeding OpenSSH's Unix-domain socket path limit.

Safe one-command workaround:

```text
TMPDIR=/tmp lzc-cli lpk install me.friday.quote0-mcp-v1.21.94.lpk --apk n
```

Result: **Installation successful**.

No system SSH config, box Developer Tools config, or project source was changed to work around this client bug.

`TMPDIR=/tmp lzc-cli project info --release` afterwards reported:

- Deployed status: `Installed`
- Instance status: `Status_Running`
- Deployed version: `1.21.94`
- Current version deployed: `yes`

## Runtime health / restart policy

Immediately after install `/api/health` returned:

```text
status=healthy
version=1.21.94
timezone=Asia/Shanghai
```

All production containers returned healthy:

- news-api v1.21.94
- annotation-web v1.21.86
- label-web v1.21.29
- PostgreSQL
- MinIO
- Redis
- app sidecar

As with prior Quote0 releases, pkgm reset service RestartPolicy to `no` despite the manifest `restart` field. The six long-lived service containers were restored to:

```text
restart=unless-stopped
```

for news-api, annotation-web, label-web, postgres, minio, and redis.

## Source identity attestation

Local candidate and running news-api container matched byte-for-byte for:

```text
src/api/news-scheduler.ts
  e6330545a135d296b92899371e2d3ed25a8935e33d29627d48dacf21c2c2a618

src/api/research-canary.ts
  02f130ca051e3f26bc2c3951e36b0d9f79a0910c906f3d1be1f6c9a24b340502

src/api/research-few-shot.ts
  29d00c7208bab7e7eedd30d92c4d8d6d37a0b6d1891e81357871620e5b171bfd

src/api/research-triage.ts
  b35ad1e4b53c1b52c701f84bc05066105145bc8842f9581733e4e056ba649e2e

src/api/news-processing-service.ts
  226c8dbbbcae2e7680dd6c6ff100cfd874461c94cfe8bb423bee4397927157e0

src/react-widgets/core/data-sources/rss-data-source.ts
  60b573e794d18ae3de4b1d91d98b7be95d660b93698985e7c4008986c9b218e6

lazycat/lzc-manifest.yml
  7a3850b6e58032960be49d99293c266c8941a952e4de438519a791348cbde616
```

Running image RepoDigest exactly matched the built registry digest.

Production environment confirmed Universal Research remains enabled and Solidot still points to the intended relay.

## Stable RSS identity production evidence

The first producer run after deployment was Solidot and logged:

```text
RSS stable-identity compatibility: source=solidot reusedLegacy=6/6
```

This is the intended rollout behavior: existing active Solidot subjects kept their legacy fingerprints instead of creating a one-time duplicate wave.

The producer then truthfully returned `producer:no_fresh_candidate`; RSS health remained healthy rather than treating no-new-content as an outage.

## Source-fair replay physical E2E

Before v1.21.94, the last 6h `eink-2` display share was heavily article-count biased:

```text
dev-to      95
hackernews  88
infoq-cn    69
sspai       12
arstechnica 10
solidot      9
```

Solidot was actually displayed but often only for one minute and was easily missed.

After v1.21.94, the first complete consumer fallback cycle was:

```text
02:51  sspai        inventory 18544  Surface Pro7改造指南
02:52  solidot      inventory 18555  Zondacrypto两CEO先后失踪
02:53  arstechnica  inventory 18560  嫦娥七号发射延至2027
02:54  infoq-cn     inventory 18557  PostgreSQL变3D城市模拟器
02:55  hackernews   inventory 18541  Fast and Hard Code
02:56  dev-to       inventory 18534  Kubernetes讲解云DevOps需学
```

All six consumer scheduler runs reported `success / inventory_consumed`.

More importantly, all six matching `eink-2` physical deliveries were `succeeded`:

```text
02:51:55 sspai       succeeded
02:52:50 solidot     succeeded  source=Solidot/NYT
02:53:51 arstechnica succeeded
02:54:47 infoq-cn    succeeded
02:55:49 hackernews  succeeded
02:56:48 dev-to      succeeded
```

This exactly matches the pre-deployment counterfactual source-fair order and proves the fix is active on the real E-Ink delivery path, not merely in SQL/tests.

## Neuromancer production boundary

Running source SHA proves the digest hard gate is deployed. The worker started in:

```text
mode=universal-admission
concurrency=1
tick=15000ms
```

At the final observation point there had not yet been a naturally created post-deploy Research run; the only producer run was Solidot with no fresh candidate. Therefore no claim is made that a new natural digest has already exercised the zero-search gate in production.

What is verified:

- exact deployed `research-canary.ts` contains the hard gate;
- exact deployed prompt/triage files contain the new minimum coverage contract;
- full test gate includes zero-search rejection and targeted-search acceptance;
- Universal Research runtime remains enabled.

A natural post-deploy digest remains a subsequent observation target rather than being fabricated through an artificial production item.

## Final production snapshot

At 02:57 CST:

- `/api/health`: healthy, v1.21.94
- all 8 RSS sources: healthy / consecutive_failures=0
- Solidot last success: 02:53 producer fetch
- active Research queued/running/waiting: 0
- Universal pending inventory: 0
- post-deploy fatal/panic/unhandled/worker-loop/materialization/DB error scan: empty
- stable identity compatibility log present
- source-fair physical six-source cycle complete

## Current Git state / remaining debt

No Git write operations were authorized or performed beyond source-file edits needed for the deployed candidate and version bump.

Worktree remains dirty with:

- RSS stable identity changes/tests
- Neuromancer minimum Research depth changes/tests
- source-fair consumer replay changes/tests
- v1.21.94 manifest / release test bump
- candidate and deployment reports

Therefore:

- deployed: yes
- runtime healthy: yes
- source-attested: yes
- physical source-fair E2E: yes
- Git reproducible from remote: **no**
- commit/push/release ref: **not performed**

## Highest-priority follow-up

Observe the next naturally produced Universal `digest` item and confirm production `searchRequests >= 1` / no zero-search completion. Separately, monitor source display share over several hours to ensure source fairness improves visibility without making low-volume sources feel excessively repetitive.
