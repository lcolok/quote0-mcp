# Quote0 v1.21.89 — Synthetic Content Evaluation and Controlled Neuromancer Promotion

Date: 2026-08-20 (Asia/Shanghai)

## Executive result

Quote0 now has a production-capable, auditable synthetic content-evaluation lane for comparing the existing Direct artifact with the corresponding Neuromancer Research artifact.

The lane deliberately does **not** pretend that model judgements are human gold:

```text
neuromancer_synthetic_evaluations  = model-simulated editorial judgements
neuromancer_artifact_reviews       = real human paired judgements
quality_annotations                = real content annotations
```

Synthetic rows are stored in a dedicated table and every run/result explicitly states `syntheticNotHuman=true`. A synthetic judge cannot approve a production change. Promotion requires a separate explicit operator identity and is stored as:

```text
approval_kind = operator-explicit
approved_by   = logic-explicit-2026-08-20
```

Nine real completed Direct/Research pairs were judged blind by two independent model families (`hy3` and `deepseek-v4-pro`). The experiment found no universal Research superiority:

```text
Research wins  3
Direct wins    2
Ties           4
```

Mean Research-minus-Direct score delta:

```text
factual confidence  +0.7222
information density -0.4444
E-Ink suitability   +0.5000
```

Only one pair passed the strict promotion gate: the wildfire / prenatal-air-pollution item. Its Research artifact was promoted into the real production inventory, registered through the production delivery pipeline, and was physically displayed by `eink-2` with a CRC-verified displayed ACK.

Production is now running Quote0 `v1.21.89`.

## Workspace and Git boundary

```text
worktree: /Users/friday/.devspace/worktrees/quote0-mcp-c8efa1f7
remote:   https://github.com/lcolok/quote0-mcp.git
base:     4fe2245cffc534af840c7fdbfdcac1e36cfdcc2e
mode:     detached managed worktree
```

The source checkout remains dirty and uncommitted. No commit, push, merge, rebase, force push, tag or release ref was created in this phase. The primary checkout was not reset, stashed or cleaned.

Therefore:

```text
production deployment = completed and attested
remote Git reproducibility = not yet closed
```

## Synthetic evaluation contract

Versions:

```text
neuromancer-synthetic-evaluation/v1
neuromancer-synthetic-judge/v1
neuromancer-synthetic-promotion/v1
```

### Blindness

Each judge receives deterministic judge-specific A/B ordering. Before judgement, the prompt removes:

- Direct / Research identity;
- producer signatures such as `AI优化·Q95` or `神经漫游者`;
- agent, thread, run and usage identity;
- provider/runtime identity.

Both sides receive the same seed and frozen evidence packet. The evidence registry includes only sources, claims and retrieval state.

### Scoring

Each side is scored from 1 to 5 for:

- factual confidence;
- information density;
- E-Ink suitability.

The judge must also list materially unsupported claims, provide evidence notes and return a confidence value from 0 to 1.

The output is strict JSON and is persisted with:

- judge ID and provider ID;
- judge family;
- blind assignment;
- semantic Direct/Research choice;
- semantic Direct/Research scores;
- unsupported-claim lists;
- evidence digest;
- Straylight job/thread references;
- raw result.

### Independence

The first production cohort used:

```text
hy3               → judge family hy3
deepseek-v4-pro   → judge family deepseek
```

Two aliases from one model family are not sufficient for promotion.

## Promotion gate

A Research artifact is eligible only when all current conditions pass:

1. The Research artifact still passes the current Renderable News validator.
2. At least two valid synthetic evaluations exist.
3. At least two independent judge families are represented.
4. At least two judges vote Research.
5. Any Direct vote is a veto.
6. Mean judge confidence is at least 0.65.
7. Research factual confidence is at least 4/5.
8. Research has no factual-confidence regression.
9. Research information-density gain is at least +0.5.
10. Research E-Ink regression is no worse than -0.5.
11. No judge reports an unsupported Research claim.
12. The Research Receipt has at least one supported claim.
13. The Receipt has no context/unresolved/conflict claim in the promotable artifact.
14. At least one primary or official source exists.
15. A real human Direct preference or tie blocks promotion.
16. A non-empty explicit `approvedBy` operator identity is required.

Promotion stores the previous Direct artifact, previous image, previous inventory state and the promoted artifact/image so that rollback is possible.

## Real nine-pair evaluation

| Subject | Synthetic votes | Main finding | Promotion |
|---|---|---|---|
| India DigitalOcean alternatives | Direct 1 / Tie 1 | Research lost factual precision and density | blocked |
| Debian LLM contribution policy | Direct 1 / Research 1 | Research improved wording but remained low-density and had an unsupported claim | blocked |
| Snowflake CoCo cost controls | Research 2 | Strong density/E-Ink gain, but one judge reported an unsupported Research claim | blocked |
| Camp Miasma slasher review | Direct 1 / Tie 1 | Direct retained more concrete content; Receipt also duplicated a canonical URL | blocked |
| Meta 30-state lawsuit | Tie 2 | Research improved specificity but not enough for a stable winner | blocked |
| AI apprenticeship opinion | Direct 1 / Research 1 | Research reduced density and had no supported-claim basis | blocked |
| Stripe / OpenRouter acquisition | Research 1 / Tie 1 | Large factual-confidence gain, but Research was less information-dense | blocked |
| Azure data-theft campaign | Direct 1 / Research 1 | Research softened overclaiming, but remained low-density and had unsupported claims | blocked |
| Wildfire prenatal exposure | Research 2 | Factual +1, density +2, no Research unsupported claims | **promoted** |

This result is important: the system did not blindly promote all Research artifacts, even though Research had a positive mean factual-confidence delta.

## Promoted production artifact

Research run:

```text
c21b8e23-b7ac-4899-88ac-2e8178d03d86
```

Inventory:

```text
content_inventory.id = 18030
promotion.id          = 1
```

Previous Direct:

```text
title:
野火烟成产前污染首因

message:
法规降低产前有害排放暴露，但野火烟雾正抵消成效，已成比人为污染源更大的产前健康威胁。
```

Promoted Research:

```text
title:
野火烟尘成孕期更大空气污染威胁

message:
一项覆盖美国本土2003—2019年的研究发现，人为源PM2.5显著下降，但野火烟尘对胎儿期暴露的贡献反超，已成孕期更大空气污染威胁。
```

Synthetic aggregate:

```text
judges            2
judge families    deepseek + hy3
Research votes    2
Direct votes      0
Tie votes         0
mean confidence   0.785
```

Scores:

| Dimension | Direct | Research | Delta |
|---|---:|---:|---:|
| Factual confidence | 4.0 | 5.0 | +1.0 |
| Information density | 3.0 | 5.0 | +2.0 |
| E-Ink suitability | 4.5 | 4.0 | -0.5 |

Evidence gate:

```text
supported claims      3
Research unsupported  0
sources                2
primary/official       1
human Direct veto      none
```

## Physical production delivery

The promoted inventory generated payload version 23 for three registered E-Ink devices.

The authoritative physical frame for the promoted artifact was independently re-rendered after promotion:

```text
frame_id = 6d2a977c31b340ae
crc32    = b530214d
bytes    = 5624
geometry = 296×152
```

`eink-2` returned a matching physical displayed ACK:

```text
device_id     eink-2
result        displayed
frame_id      6d2a977c31b340ae
crc32         b530214d
current_match true
crc_verified  true
acked_at      2026-08-20T11:41:03.187Z
RSSI          -58 dBm
refresh_ms    2062
```

Therefore the promoted Research artifact was not merely written to a database or queue: its exact 1-bit frame was physically displayed and acknowledged by the S3 E-Ink device.

`eink-1` and `eink-3` did not provide displayed evidence for this frame. Their pending deliveries were superseded by the normal latest-frame display policy before an attempt completed. They are not reported as displayed.

## Audit projection incident and repair

The first v1.21.87 promotion correctly completed the authoritative actions:

```text
promotion ledger write
content_inventory update
rendered image update
delivery registration
eink-2 displayed ACK
```

After those actions, the secondary `news_push_log` projection failed because:

```text
layer = "neuromancer-promotion"
news_push_log.layer = VARCHAR(20)
```

The value exceeded the legacy column limit and PostgreSQL returned `22001`.

The v1.21.88 hotfix changed the bounded audit label to:

```text
research-promoted
```

It also made push-log projection failure non-authoritative: a secondary projection error is stored in the promotion ledger instead of making an already-applied promotion appear to have wholly failed.

The existing promotion audit was repaired idempotently:

```text
news_push_log.id = 349603
job_id           = neuromancer-synthetic-promotion
layer            = research-promoted
promotion_id     = 1
payload_version  = 23
synthetic_eval   = true
```

The promotion ledger now includes the enqueue and physical ACK evidence.

## Preserving the human A/B baseline

Promotion changes `content_inventory.processed_content` to the Research winner. Without additional governance, later review would compare Research against itself and silently destroy the original Direct baseline.

v1.21.89 fixes this by projecting:

```text
active promotion.previous_processed_content
        ??
current content_inventory.processed_content
```

for both:

- real human Neuromancer paired review;
- future synthetic re-evaluation.

Production verification for the promoted run now returns two distinct blind sides:

```text
Research: 野火烟尘成孕期更大空气污染威胁
Direct:   野火烟成产前污染首因
```

The reveal remains null because no human has reviewed the pair.

An idempotent synthetic-evaluation rerun produced:

```text
newJudgeExecutions = []
```

which proves that promotion did not change the preserved Direct evidence digest or trigger a false re-evaluation.

## Human/synthetic separation in production

Current production counts:

```text
neuromancer_synthetic_evaluations = 18
neuromancer_artifact_reviews      = 0
active promotions                 = 1
research-promoted push logs       = 1
```

No fake human review or quality annotation was inserted.

## Renderer regression

Existing renderer governance remained intact after Content Quality and promotion changes:

| Target | Physical self-check | Title bar | Excess rows | Point-to-point | Resize | XOR vs Current |
|---|---|---|---:|---|---|---:|
| 40×20 thermal | pass | pass | 0 | true | false | 0 |
| 20×8 micro | pass | pass | 0 | true | false | 2152 |
| 296×152 E-Ink | pass | pass | 0 | true | false | 0 |

The 20×8 XOR difference remains the intentional micro-recipe semantic reduction, not a resize or physical-lattice failure.

## Verification

Final local gate:

```text
271 tests passed
0 failed
7190 assertions
46 test files
TypeScript production build PASS
git diff --check PASS
base-image digest guard PASS
release-version governance PASS
```

Two production observation rounds, separated by 30 seconds, both returned:

```text
health                  healthy
version                 1.21.89
synthetic rows          18
human review rows       0
active promotions       1
promoted push logs      1
promoted frame ACK      displayed / current_match / crc_verified
40×20 renderer          pass / title pass / excess 0 / point-to-point / XOR 0
```

Deployment-window logs contained no fatal, panic, OOM, unhandled, uncaught, renderer self-check failure, synthetic-evaluation failure or promotion failure.

## Production artifacts

News API:

```text
image tag:
dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.89

registry digest:
sha256:e1bfa33fff13355cbdd75caeb17392d49fffd994dc672fb2379eee4fea14402c

running image ID:
sha256:41959c73d82ae95874b608b49cf643993afec0c10e2025ef5a437260084f24a9
```

LPK:

```text
lazycat/me.friday.quote0-mcp-v1.21.89.lpk
SHA-256 114347293ae495861a728d315349d90f5e35cb99afc9683b4917dfecac02816c
```

Unchanged components:

```text
annotation-web v1.21.86
label-web      v1.21.29
```

All long-lived Quote0 services are healthy and use `restart=unless-stopped`.

Source attestation matched local candidate source byte-for-byte for:

- `src/api/neuromancer-synthetic-evaluation-service.ts`;
- `src/api/neuromancer-promotion-service.ts`;
- `src/api/neuromancer-review-service.ts`;
- `src/api/content-quality.ts`;
- `lazycat/lzc-manifest.yml`.

Resource snapshot:

```text
news-api       CPU 2.89%, 551 MiB / 1 GiB, 192 PIDs
annotation-web CPU 0.00%, 12.85 MiB / 128 MiB, 17 PIDs
```

## What the experiment establishes

Verified:

1. Model-simulated judgements can be isolated from human labels and audited independently.
2. A two-family blind synthetic cohort detects both Research improvements and regressions.
3. Research is not universally better: only 1/9 pairs passed the conservative production gate.
4. The promoted winner improved factual confidence and information density while staying within the allowed E-Ink regression bound.
5. The exact promoted physical frame was displayed and CRC-verified on `eink-2`.
6. Production promotion is reversible and preserves the original Direct artifact for later human review.

Not established:

1. Synthetic judges are not a substitute for human gold.
2. Nine pairs do not establish a global optimum for all source classes.
3. The current two-judge cohort does not quantify judge calibration against a large human-labelled set.
4. The current gate may be conservative; changing it requires more human evidence rather than relaxing it from completion metrics alone.

## Highest-priority next step

Use the existing `/annotate?view=neuromancer` surface to collect real human labels on the same nine pairs, beginning with:

- the promoted wildfire pair;
- CoCo, where synthetic judges unanimously preferred Research but one unsupported-claim signal blocked promotion;
- DigitalOcean, where Direct beat Research;
- Meta, where both judges tied.

The next scientifically useful metric is synthetic-vs-human agreement by judge family and content stratum. Promotion thresholds should only be recalibrated after that comparison.
