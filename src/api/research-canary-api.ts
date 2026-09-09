import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  dispatchResearchCanary,
  dispatchResearchExtension,
  dispatchResearchFinalization,
  dispatchResearchTerminalFinalization,
  dispatchStructuredResearchFinalization,
  getResearchCanaryConfig,
  hasSupportEligibleEvidence,
  inspectResearchCanary,
  materializeStructuredResearchFinalization,
  RESEARCH_CANARY_MODE,
  RESEARCH_EVIDENCE_LEDGER_VERSION,
  researchCanaryFingerprint,
  researchCanaryIdempotencyKey,
  shouldExtendResearch,
  structuredFinalizationSchema,
  validateResearchCandidateShape,
  type ResearchCanaryPhase,
  type StraylightCanaryDispatch,
} from './research-canary.js';
import {
  createResearchRun,
  getResearchRun,
  markResearchRunDispatched,
  markResearchRunResearchExtended,
  markResearchRunState,
  markResearchRunTerminalReceipt,
  type ResearchRunRecord,
} from './research-run-store.js';
import { RESEARCH_TRIAGE_POLICY_VERSION, triageResearchCandidate, type ResearchSeed } from './research-triage.js';
import { applyUniversalResearchArtifact } from './universal-research-finalization.js';

const app = new Hono();
const postgres = getPostgresDatabase();

// Same sentence the server-owned editorial materializer emits when a frozen packet has no
// support-eligible Ledger v2 evidence (research-canary.ts), composed from the shared version
// constants rather than a second literal copy that a policy bump could leave stale.
function emptyEvidenceLedgerError(): string {
  return `Research ${RESEARCH_TRIAGE_POLICY_VERSION} 缺少 ${RESEARCH_EVIDENCE_LEDGER_VERSION} 可支持证据`;
}

function directDraftFromRun(run: ResearchRunRecord): { title: string; message: string } | undefined {
  const draft = run.directSnapshot;
  const title = cleanString(draft?.title);
  const message = cleanString(draft?.message);
  if (!title || !message) return undefined;
  return { title, message };
}

/**
 * Re-dispatch a rejected/failed finalization. In structured-inference the model is never left
 * un-finalized (the adapter retries inline), so this only serves legacy agent-job (fresh thread)
 * and terminal-tool (same thread, errors carried forward). Runs pick their lane at creation.
 */
async function redispatchResearchFinalization(
  run: ResearchRunRecord,
  errors: string[],
): Promise<StraylightCanaryDispatch> {
  const mode = run.triage.phaseBMode ?? getResearchCanaryConfig().phaseBMode;
  if (mode === 'terminal-tool') {
    if (!hasSupportEligibleEvidence(run.evidenceSnapshot)) {
      // Fail fast: re-dispatching a same-thread terminal continuation for a frozen packet with no
      // support-eligible evidence can only burn another attempt on a deterministic rejection.
      throw new Error(`Terminal finalization 无法重派（冻结证据无可支持条目）: ${emptyEvidenceLedgerError()}`);
    }
    return dispatchResearchTerminalFinalization(
      run.id,
      run.straylightThreadId!,
      run.inputSnapshot,
      run.evidenceSnapshot!,
      run.triage,
      { errors, directDraft: directDraftFromRun(run) },
    );
  }
  return dispatchResearchFinalization(
    run.id,
    run.inputSnapshot,
    run.evidenceSnapshot!,
    run.triage,
    { errors, directDraft: directDraftFromRun(run) },
  );
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeed(value: unknown): ResearchSeed | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const title = cleanString(raw.title);
  if (!title) return undefined;
  const publishTimeRaw = cleanString(raw.publishTime);
  const publishTime = publishTimeRaw && !Number.isNaN(Date.parse(publishTimeRaw))
    ? new Date(publishTimeRaw).toISOString()
    : '';
  return {
    title,
    ...(cleanString(raw.content) ? { content: cleanString(raw.content) } : {}),
    ...(cleanString(raw.source) ? { source: cleanString(raw.source) } : {}),
    ...(cleanString(raw.link) ? { link: cleanString(raw.link) } : {}),
    ...(cleanString(raw.category) ? { category: cleanString(raw.category) } : {}),
    ...(publishTime ? { publishTime } : {}),
  };
}

function publicRun(run: ResearchRunRecord) {
  const { evidenceSnapshot, ...safeRun } = run;
  return {
    ...safeRun,
    evidencePacket: evidenceSnapshot ? { present: true, chars: evidenceSnapshot.length } : { present: false, chars: 0 },
    // Explicitly state that this is a compatibility canary and cannot be mistaken for
    // the future durable Straylight Run API contract.
    executionContract: RESEARCH_CANARY_MODE,
    phase: run.resultArtifact?.metadata?.researchFinalizer || run.attempts > 1 ? 'finalization' : 'research',
    promotable: run.state === 'completed',
    autoPublished: false,
  };
}

function boundedMetricsHours(value: string | undefined): number {
  const parsed = Number.parseInt(value || '24', 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(168, parsed));
}

function metricsTrigger(value: string | undefined): 'inventory-auto' | 'manual' | 'all' {
  return value === 'manual' || value === 'all' ? value : 'inventory-auto';
}

function canaryUnavailable() {
  const config = getResearchCanaryConfig();
  if (!config.enabled) return 'QUOTE0_RESEARCH_CANARY_ENABLED 未启用';
  if (!config.baseUrl) return 'STRAYLIGHT_RESEARCH_BASE_URL 未配置';
  return undefined;
}

type StructuredCompletionResult =
  | { kind: 'completed'; run: ResearchRunRecord; universalApply?: unknown }
  | { kind: 'invalid'; run: ResearchRunRecord; errors: string[] }
  | { kind: 'failed'; run: ResearchRunRecord; error: string }
  | { kind: 'pending'; run: ResearchRunRecord; error: string };

async function completeWithStructuredFinalizer(
  run: ResearchRunRecord,
  evidencePacket: string,
  runtime: NonNullable<ResearchRunRecord['runtimeReceipt']>,
): Promise<StructuredCompletionResult> {
  if (!run.straylightThreadId) {
    const error = 'structured finalization 缺少 Phase A threadId';
    const failed = await markResearchRunState(postgres, run.id, { state: 'failed', error, validationErrors: [error] });
    return { kind: 'failed', run: failed, error };
  }

  const maxAttempts = 1 + (run.triage.budget?.maxFinalizationRetries ?? 1);
  let feedback: string[] = [];
  let lastArtifact: ReturnType<typeof materializeStructuredResearchFinalization>['artifact'];
  const aggregateUsage = { input: 0, output: 0, cacheRead: 0, total: 0 };
  let hasAggregateUsage = false;
  let totalLatencyMs = 0;
  const retryErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let structured;
    const attemptStartedAt = Date.now();
    try {
      structured = await dispatchStructuredResearchFinalization(
        run.id,
        run.inputSnapshot,
        evidencePacket,
        run.triage,
        {
          errors: feedback,
          directDraft: directDraftFromRun(run),
          attempt,
        },
      );
    } catch (error) {
      const message = `Structured Phase B attempt ${attempt} 失败: ${error instanceof Error ? error.message : String(error)}`;
      totalLatencyMs += Math.max(0, Date.now() - attemptStartedAt);
      retryErrors.push(message);
      feedback = [message];
      if (attempt < maxAttempts) continue;
      const failed = await markResearchRunState(postgres, run.id, {
        state: 'failed',
        runtimeReceipt: runtime,
        evidenceSnapshot: evidencePacket,
        validationErrors: feedback,
        error: message,
      });
      return { kind: 'failed', run: failed, error: message };
    }

    totalLatencyMs += structured.telemetry.latencyMs || Math.max(0, Date.now() - attemptStartedAt);
    if (structured.telemetry.usage) {
      hasAggregateUsage = true;
      aggregateUsage.input += structured.telemetry.usage.input || 0;
      aggregateUsage.output += structured.telemetry.usage.output || 0;
      aggregateUsage.cacheRead += structured.telemetry.usage.cacheRead || 0;
      aggregateUsage.total += structured.telemetry.usage.total || 0;
    }
    structured = {
      ...structured,
      telemetry: {
        ...structured.telemetry,
        totalLatencyMs,
        ...(retryErrors.length ? { retryErrors: [...retryErrors] } : {}),
        ...(hasAggregateUsage ? { usage: { ...aggregateUsage } } : {}),
      },
    };

    const materialized = materializeStructuredResearchFinalization({
      runId: run.id,
      phaseAThreadId: run.straylightThreadId,
      seed: run.inputSnapshot,
      evidencePacket,
      decision: run.triage,
      runtime,
      finalization: structured,
    });
    lastArtifact = materialized.artifact;

    if (materialized.policyViolation) {
      const invalid = await markResearchRunState(postgres, run.id, {
        state: 'invalid',
        runtimeReceipt: runtime,
        evidenceSnapshot: evidencePacket,
        validationErrors: materialized.errors,
        error: materialized.errors.join('; '),
      });
      return { kind: 'invalid', run: invalid, errors: materialized.errors };
    }

    if (!materialized.artifact) {
      feedback = materialized.errors.length ? materialized.errors : ['Structured Phase B 未产出合法 artifact'];
      if (attempt < maxAttempts) {
        retryErrors.push(`attempt ${attempt} deterministic gate: ${feedback.join('; ')}`);
        continue;
      }
      const invalid = await markResearchRunState(postgres, run.id, {
        state: 'invalid',
        runtimeReceipt: runtime,
        evidenceSnapshot: evidencePacket,
        validationErrors: feedback,
        error: feedback.join('; '),
      });
      return { kind: 'invalid', run: invalid, errors: feedback };
    }

    const artifact = materialized.artifact;
    if (run.trigger === 'inventory-auto' && run.sourceInventoryId) {
      const materializationRun: ResearchRunRecord = {
        ...run,
        runtimeReceipt: runtime,
        resultArtifact: artifact,
        completedAt: new Date().toISOString(),
      };
      try {
        const universalApply = await applyUniversalResearchArtifact(postgres, {
          run: materializationRun,
          artifact,
        });
        const completed = await markResearchRunState(postgres, run.id, {
          state: 'completed',
          runtimeReceipt: runtime,
          evidenceSnapshot: evidencePacket,
          resultArtifact: artifact,
          validationErrors: [],
        });
        return { kind: 'completed', run: completed, universalApply };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const publishGateFailure = message.startsWith('universal Research final artifact 无效:');
        if (publishGateFailure) {
          feedback = [`universal publish gate: ${message}`];
          if (attempt < maxAttempts) {
            retryErrors.push(`attempt ${attempt} universal gate: ${message}`);
            continue;
          }
          const invalid = await markResearchRunState(postgres, run.id, {
            state: 'invalid',
            runtimeReceipt: runtime,
            evidenceSnapshot: evidencePacket,
            resultArtifact: artifact,
            validationErrors: feedback,
            error: feedback.join('; '),
          });
          return { kind: 'invalid', run: invalid, errors: feedback };
        }

        // Rendering/storage failures are not editorial failures. Keep the frozen
        // evidence + valid artifact so a later reconcile can retry without any
        // new Phase-A tool calls.
        const pending = await markResearchRunState(postgres, run.id, {
          state: 'running',
          runtimeReceipt: runtime,
          evidenceSnapshot: evidencePacket,
          resultArtifact: artifact,
          validationErrors: [`structured materialization pending: ${message}`],
        });
        return { kind: 'pending', run: pending, error: message };
      }
    }

    const completed = await markResearchRunState(postgres, run.id, {
      state: 'completed',
      runtimeReceipt: runtime,
      evidenceSnapshot: evidencePacket,
      resultArtifact: artifact,
      validationErrors: [],
    });
    return { kind: 'completed', run: completed };
  }

  const fallbackErrors = feedback.length ? feedback : ['Structured Phase B exhausted without result'];
  const invalid = await markResearchRunState(postgres, run.id, {
    state: 'invalid',
    runtimeReceipt: runtime,
    evidenceSnapshot: evidencePacket,
    ...(lastArtifact ? { resultArtifact: lastArtifact } : {}),
    validationErrors: fallbackErrors,
    error: fallbackErrors.join('; '),
  });
  return { kind: 'invalid', run: invalid, errors: fallbackErrors };
}

app.get('/api/news/research/canary/metrics', async (c) => {
  const hours = boundedMetricsHours(c.req.query('hours'));
  const trigger = metricsTrigger(c.req.query('trigger'));
  await postgres.initialize();
  const summaryResult = await postgres.query(
    `WITH r AS (
       SELECT state,
              trigger,
              triage,
              runtime_receipt,
              research_extension_receipt,
              result_artifact,
              created_at,
              completed_at,
              COALESCE((runtime_receipt->>'toolCalls')::int, 0) AS tool_calls,
              COALESCE((result_artifact->'metadata'->'researchFinalizer'->>'attempt')::int, 0) AS finalizer_attempt,
              COALESCE(
                (result_artifact->'metadata'->'researchFinalizer'->>'totalLatencyMs')::numeric,
                (result_artifact->'metadata'->'researchFinalizer'->>'latencyMs')::numeric,
                0
              ) AS finalizer_latency_ms,
              COALESCE((result_artifact->'metadata'->'researchFinalizer'->'usage'->>'total')::numeric, 0) AS finalizer_tokens
         FROM research_runs
        WHERE policy_version = $2
          AND created_at >= NOW() - ($1::text || ' hours')::interval
          AND ($3='all' OR trigger=$3)
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE state='completed')::int AS completed,
            COUNT(*) FILTER (WHERE state='invalid')::int AS invalid,
            COUNT(*) FILTER (WHERE state='failed')::int AS failed,
            COUNT(*) FILTER (WHERE state IN ('queued','running','waiting_user'))::int AS active,
            ROUND(AVG(tool_calls)::numeric, 2) AS avg_tool_calls,
            ROUND(AVG(EXTRACT(EPOCH FROM (completed_at-created_at))) FILTER (WHERE completed_at IS NOT NULL)::numeric, 1) AS avg_duration_sec,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-created_at)))
              FILTER (WHERE completed_at IS NOT NULL))::numeric, 1) AS p50_duration_sec,
            COUNT(*) FILTER (WHERE triage->>'researchMode'='digest')::int AS digest_total,
            COUNT(*) FILTER (WHERE triage->>'researchMode'='digest' AND tool_calls=3)::int AS digest_three_calls,
            COUNT(*) FILTER (WHERE triage->>'researchMode'='digest' AND tool_calls=4)::int AS digest_four_calls,
            COUNT(*) FILTER (WHERE research_extension_receipt IS NOT NULL)::int AS extension_total,
            COUNT(*) FILTER (WHERE research_extension_receipt->>'required'='true')::int AS required_extensions,
            COUNT(*) FILTER (WHERE research_extension_receipt IS NOT NULL AND COALESCE(research_extension_receipt->>'required','false')<>'true')::int AS optional_extensions,
            COUNT(*) FILTER (WHERE result_artifact->'metadata'->>'researchArtifactOwnership'='quote0-server/v1')::int AS server_owned_artifacts,
            COUNT(*) FILTER (WHERE result_artifact->'metadata'->'researchFinalizer'->>'mode'='structured-inference')::int AS structured_finalized,
            COUNT(*) FILTER (WHERE finalizer_attempt>1)::int AS finalizer_retries,
            ROUND(AVG(NULLIF(finalizer_latency_ms,0))::numeric, 1) AS avg_finalizer_latency_ms,
            ROUND(AVG(NULLIF(finalizer_tokens,0))::numeric, 1) AS avg_finalizer_tokens
       FROM r`,
    [String(hours), RESEARCH_TRIAGE_POLICY_VERSION, trigger],
  );
  const reasonResult = await postgres.query(
    `SELECT research_extension_receipt->>'reason' AS reason, COUNT(*)::int AS count
       FROM research_runs
      WHERE policy_version=$2
        AND created_at >= NOW() - ($1::text || ' hours')::interval
        AND ($3='all' OR trigger=$3)
        AND research_extension_receipt IS NOT NULL
      GROUP BY research_extension_receipt->>'reason'
      ORDER BY COUNT(*) DESC, reason ASC`,
    [String(hours), RESEARCH_TRIAGE_POLICY_VERSION, trigger],
  );
  const row = summaryResult.rows[0] || {};
  const total = Number(row.total || 0);
  const completed = Number(row.completed || 0);
  return c.json({
    success: true,
    windowHours: hours,
    trigger,
    policyVersion: RESEARCH_TRIAGE_POLICY_VERSION,
    summary: {
      total,
      completed,
      invalid: Number(row.invalid || 0),
      failed: Number(row.failed || 0),
      active: Number(row.active || 0),
      completedRate: total > 0 ? Number((completed / total).toFixed(4)) : null,
      avgToolCalls: row.avg_tool_calls == null ? null : Number(row.avg_tool_calls),
      avgDurationSec: row.avg_duration_sec == null ? null : Number(row.avg_duration_sec),
      p50DurationSec: row.p50_duration_sec == null ? null : Number(row.p50_duration_sec),
    },
    digest: {
      total: Number(row.digest_total || 0),
      threeCalls: Number(row.digest_three_calls || 0),
      fourCalls: Number(row.digest_four_calls || 0),
      extensions: Number(row.extension_total || 0),
      requiredExtensions: Number(row.required_extensions || 0),
      optionalExtensions: Number(row.optional_extensions || 0),
      extensionReasons: Object.fromEntries(reasonResult.rows.map((item: any) => [String(item.reason || 'unknown'), Number(item.count || 0)])),
    },
    finalizer: {
      serverOwnedArtifacts: Number(row.server_owned_artifacts || 0),
      structuredFinalized: Number(row.structured_finalized || 0),
      retries: Number(row.finalizer_retries || 0),
      avgLatencyMs: row.avg_finalizer_latency_ms == null ? null : Number(row.avg_finalizer_latency_ms),
      avgTokens: row.avg_finalizer_tokens == null ? null : Number(row.avg_finalizer_tokens),
    },
  });
});

app.post('/api/news/research/canary/jobs', async (c) => {
  const unavailable = canaryUnavailable();
  if (unavailable) return c.json({ success: false, error: unavailable }, 503);

  const body = await c.req.json().catch(() => null) as {
    seed?: unknown;
    manual?: unknown;
    conflict?: unknown;
    requestKey?: unknown;
    phaseBMode?: unknown;
    universal?: unknown;
  } | null;
  const seed = normalizeSeed(body?.seed);
  if (!seed) return c.json({ success: false, error: 'seed.title 不能为空' }, 400);

  // Optional manual Phase B mode override. Throws a 400 on any value outside the two public
  // lanes; agent-job stays an internal-only legacy mode and is never accepted here.
  const requestedPhaseBMode = body && typeof body.phaseBMode === 'string'
    ? (body.phaseBMode.trim() as 'structured-inference' | 'terminal-tool')
    : undefined;
  if (requestedPhaseBMode !== undefined
    && requestedPhaseBMode !== 'structured-inference'
    && requestedPhaseBMode !== 'terminal-tool') {
    return c.json({
      success: false,
      error: 'phaseBMode 只允许 structured-inference 或 terminal-tool',
    }, 400);
  }

  const triage = triageResearchCandidate({
    seed,
    manual: body?.manual === true,
    conflict: body?.conflict === true,
    // Pass the universal flag through so the manual canary goes through the exact same universal
    // hard gates (minimumEditorialFactCount etc.) as the auto worker for the same seed.
    universal: body?.universal === true,
  });
  if (triage.lane !== 'research') {
    return c.json({
      success: true,
      dispatched: false,
      data: { triage, reason: 'direct-lane' },
    });
  }

  await postgres.initialize();
  const canaryConfig = getResearchCanaryConfig();
  const candidateId = randomUUID();
  const idempotencyKey = researchCanaryIdempotencyKey(seed, triage, cleanString(body?.requestKey));
  const run = await createResearchRun(postgres, {
    id: candidateId,
    mode: RESEARCH_CANARY_MODE,
    fingerprint: researchCanaryFingerprint(seed),
    idempotencyKey,
    policyVersion: triage.policyVersion,
    agentId: canaryConfig.agentId,
    seed,
    triage,
    // Freeze the Phase B mode at run creation so a mid-flight env switch never flips the
    // lane an in-flight run is already committed to. A request-supplied phaseBMode (Patch A)
    // overrides the env default; otherwise the manual canary follows the current env mode so it
    // exercises the same path the auto worker will use. All downstream reconcile/endpoint/
    // inspection read run.triage.phaseBMode (single source of truth).
    phaseBMode: requestedPhaseBMode ?? canaryConfig.phaseBMode,
  });

  // Idempotency: repeating the same research intent never creates another Straylight job.
  if (run.id !== candidateId || run.straylightJobId || run.attempts > 0) {
    return c.json({ success: true, dispatched: false, idempotent: true, data: publicRun(run) }, 200);
  }

  try {
    const dispatched = await dispatchResearchCanary(run.id, seed, triage);
    const updated = await markResearchRunDispatched(postgres, run.id, dispatched.jobId, dispatched.threadId);
    return c.json({ success: true, dispatched: true, data: publicRun(updated) }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await markResearchRunState(postgres, run.id, { state: 'failed', error: message });
    return c.json({ success: false, error: message, data: publicRun(failed) }, 502);
  }
});

/**
 * Phase B terminal-tool adjudication endpoint. The Straylight proxy calls this (bearer) when the
 * agent invokes finish_research_turn. It validates the submission against the same structured
 * schema and publish gates as the /inference/structured path, persists a terminal_receipt, and
 * returns a trusted result the agent uses as its terminal tool output. It intentionally does NOT
 * advance the run state or write inventory; reconciliation owns those transitions.
 */
app.post('/api/news/research/terminal/finish', async (c) => {
  // Independent bearer auth. Like COMPONENT_LABELS_API_TOKEN, this endpoint is surfaced through the
  // component-labels style public_path and must NOT reuse the global API_AUTH_TOKEN middleware
  // (which covers all of /api/* and would break the browser-token quick-tap used to call it here).
  // Env unset ⇒ fail closed with 503; bad bearer ⇒ 401. Token resolution (env or file) lives in
  // getResearchCanaryConfig so /health can report the source without ever leaking the value.
  const { terminalToken } = getResearchCanaryConfig();
  if (!terminalToken) {
    return c.json({
      trusted: false, outcome: 'rejected', runId: '',
      summary: 'QUOTE0_RESEARCH_TERMINAL_TOKEN / QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE 均未配置，terminal-tool 模式不可用（fail closed）',
      errors: ['terminal 端点未启用：缺少 QUOTE0_RESEARCH_TERMINAL_TOKEN 且 QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE 为空'],
      artifact: null,
    }, 503);
  }
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ') || header.slice('Bearer '.length) !== terminalToken) {
    return c.json({ trusted: false, outcome: 'rejected', runId: '', summary: '鉴权失败', errors: ['Unauthorized'], artifact: null }, 401);
  }

  await postgres.initialize();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !cleanString(body.runId)) {
    return c.json({
      trusted: false, outcome: 'rejected', runId: cleanString(body?.runId),
      summary: 'finish_research_turn 参数不完整', errors: ['runId 必填'], artifact: null,
    }, 400);
  }
  const runId = cleanString(body.runId);

  const rejected = (receipt: {
    attempt: number; outcome: 'rejected'; errors: string[]; candidate: Record<string, unknown>; artifact?: unknown;
  }) => {
    const summary = receipt.errors[0] || 'finish_research_turn 未通过 Quote0 发布门';
    return c.json({
      trusted: true, outcome: 'rejected', runId,
      summary, errors: receipt.errors,
      artifact: null,
      deeplink: `https://quote0.logic.heiyu.space/annotate?view=neuromancer&researchRunId=${encodeURIComponent(runId)}`,
    }, 200);
  };

  const run = await getResearchRun(postgres, runId);
  // runId not found or not in terminal-tool finalization phase (no frozen evidence) ⇒ 200 +
  // rejected per contract. attempt = run.attempts is the current finalization job the agent is
  // answering; a run in another mode never has a terminal continuation to adjudicate.
  const notTerminalMode = (run?.triage.phaseBMode ?? getResearchCanaryConfig().phaseBMode) !== 'terminal-tool';
  if (!run || !run.evidenceSnapshot || run.attempts < 2 || !run.straylightThreadId || notTerminalMode) {
    let missing: string;
    if (!run) missing = 'research_run 不存在';
    else if (notTerminalMode) missing = 'research_run 不在 terminal-tool 模式';
    else missing = 'research_run 不在 finalization 阶段或缺少冻结证据';
    return rejected({ attempt: run?.attempts ?? 0, outcome: 'rejected', errors: [missing], candidate: {} });
  }

  const receivedAt = new Date().toISOString();
  const attempt = run.attempts;
  const startedAt = Date.now();
  const candidate: Record<string, unknown> = {
    titleCandidates: body.titleCandidates,
    facts: body.facts,
    linkEvidenceId: body.linkEvidenceId,
  };

  // Never fall back to the legacy full-artifact schema for terminal-tool adjudication: the
  // finish_research_turn proposal shape is fixed in Straylight, so a frozen packet with no
  // support-eligible evidence cannot yield a valid submission. Reject deterministically instead
  // of burning a retry on misleading missing-field errors from the legacy schema gate.
  if (!hasSupportEligibleEvidence(run.evidenceSnapshot)) {
    const errors = [emptyEvidenceLedgerError()];
    await markResearchRunTerminalReceipt(postgres, run.id, {
      attempt, outcome: 'rejected', errors, candidate, receivedAt,
    });
    return rejected({ attempt, outcome: 'rejected', errors, candidate });
  }

  // Shape gate: reuse the exact schema the structured path uses (rejects extra fields, wrong
  // cardinality, unknown evidence ids). Validate the full submission (minus the runId control
  // key) so a model-injected field is caught rather than silently dropped. Semantic publish
  // gates run next via materialization.
  const submission = { ...body };
  delete submission.runId;
  let schemaErrors: string[] = [];
  try {
    schemaErrors = validateResearchCandidateShape(
      structuredFinalizationSchema(runId, run.triage, run.evidenceSnapshot),
      submission,
    );
  } catch (error) {
    schemaErrors = [error instanceof Error ? error.message : String(error)];
  }
  if (schemaErrors.length) {
    await markResearchRunTerminalReceipt(postgres, run.id, {
      attempt, outcome: 'rejected', errors: schemaErrors, candidate, receivedAt,
    });
    return rejected({ attempt, outcome: 'rejected', errors: schemaErrors, candidate });
  }

  const latencyMs = Math.max(0, Date.now() - startedAt);
  const telemetry = {
    mode: 'terminal-tool' as const,
    providerId: 'server',
    model: 'server-adjudication',
    latencyMs,
    attempt,
  };
  const materialized = materializeStructuredResearchFinalization({
    runId,
    phaseAThreadId: run.straylightThreadId,
    seed: run.inputSnapshot,
    evidencePacket: run.evidenceSnapshot,
    decision: run.triage,
    runtime: run.runtimeReceipt ?? { toolCalls: 0, searchRequests: 0, crawlRequests: 0, failedToolCalls: 0 },
    finalization: { candidate, telemetry },
  });

  if (materialized.artifact) {
    await markResearchRunTerminalReceipt(postgres, run.id, {
      attempt, outcome: 'accepted', errors: [], candidate,
      artifact: materialized.artifact, receivedAt,
    });
    return c.json({
      trusted: true, outcome: 'accepted', runId,
      summary: materialized.artifact.title,
      errors: [],
      artifact: { title: materialized.artifact.title, message: materialized.artifact.message },
      deeplink: `https://quote0.logic.heiyu.space/annotate?view=neuromancer&researchRunId=${encodeURIComponent(runId)}`,
    }, 200);
  }

  await markResearchRunTerminalReceipt(postgres, run.id, {
    attempt, outcome: 'rejected', errors: materialized.errors, candidate, receivedAt,
  });
  return rejected({ attempt, outcome: 'rejected', errors: materialized.errors, candidate });
});

app.get('/api/news/research/canary/jobs/:id', async (c) => {
  await postgres.initialize();
  const run = await getResearchRun(postgres, c.req.param('id'));
  if (!run) return c.json({ success: false, error: 'research_run 不存在' }, 404);
  return c.json({ success: true, data: publicRun(run) });
});

app.post('/api/news/research/canary/jobs/:id/reconcile', async (c) => {
  const unavailable = canaryUnavailable();
  if (unavailable) return c.json({ success: false, error: unavailable }, 503);

  await postgres.initialize();
  const run = await getResearchRun(postgres, c.req.param('id'));
  if (!run) return c.json({ success: false, error: 'research_run 不存在' }, 404);
  if (['completed', 'invalid', 'failed', 'cancelled'].includes(run.state)) {
    return c.json({ success: true, reconciled: false, terminal: true, data: publicRun(run) });
  }
  if (!run.straylightJobId || !run.straylightThreadId) {
    const failed = await markResearchRunState(postgres, run.id, {
      state: 'failed',
      error: 'research_run 缺少 Straylight job/thread 引用',
    });
    return c.json({ success: false, error: failed.error, data: publicRun(failed) }, 409);
  }

  const phase = run.attempts <= 1 ? 'research' : 'finalization';
  // Freeze phase B mode from the run (decided at creation) so a mid-flight env switch never
  // flips the lane an in-flight run is already committed to.
  const phaseBMode = run.triage.phaseBMode ?? getResearchCanaryConfig().phaseBMode;
  const inspectionPhase: ResearchCanaryPhase = phaseBMode === 'terminal-tool' && phase === 'finalization'
    ? 'terminal-finalization'
    : phase;
  const maxFinalizationAttempts = 2 + (run.triage.budget?.maxFinalizationRetries ?? 1);
  const inspection = await inspectResearchCanary({
    runId: run.id,
    seed: run.inputSnapshot,
    jobId: run.straylightJobId,
    threadId: run.straylightThreadId,
    phase: inspectionPhase,
    decision: run.triage,
    ...(phase === 'research' && run.extensionReceipt ? { extensionReceipt: run.extensionReceipt } : {}),
    ...(phase === 'finalization' && run.runtimeReceipt ? { priorRuntime: run.runtimeReceipt } : {}),
    ...(phase === 'finalization' && run.evidenceSnapshot ? { priorEvidencePacket: run.evidenceSnapshot } : {}),
    ...(inspectionPhase === 'terminal-finalization' ? { terminalReceipt: run.terminalReceipt } : {}),
  });

  if (inspection.status === 'running') {
    const running = await markResearchRunState(postgres, run.id, {
      state: 'running',
      // During Phase B keep the persisted runtime as the Phase-A baseline so subsequent
      // reconciles do not double-count it. Final cumulative runtime is stored at terminal.
      ...(phase === 'research' ? { runtimeReceipt: inspection.runtime } : {}),
    });
    return c.json({ success: true, reconciled: true, data: publicRun(running) });
  }

  if (inspection.status === 'research_complete' && inspection.evidencePacket) {
    const persisted = await markResearchRunState(postgres, run.id, {
      state: 'running',
      runtimeReceipt: inspection.runtime,
      evidenceSnapshot: inspection.evidencePacket,
      validationErrors: inspection.errors,
    });

    const extensionDecision = shouldExtendResearch(
      inspection.evidencePacket,
      inspection.runtime,
      run.triage,
    );
    if (extensionDecision.extend && run.straylightJobIds.length === 1) {
      try {
        const extended = await dispatchResearchExtension(
          run.id,
          run.straylightThreadId,
          run.inputSnapshot,
          inspection.evidencePacket,
          run.triage,
          {
            reason: extensionDecision.reason,
            authorizedCandidateUrls: extensionDecision.candidateUrls,
          },
        );
        const updated = await markResearchRunResearchExtended(
          postgres,
          run.id,
          extended.jobId,
          extended.threadId,
          {
            reason: extensionDecision.reason,
            required: extensionDecision.required,
            candidateCount: extensionDecision.candidateUrls.length,
            authorizedCandidateUrls: extensionDecision.candidateUrls,
            existingClusters: extensionDecision.existingClusters,
            initialToolCalls: run.triage.budget?.initialToolCalls ?? inspection.runtime.toolCalls,
            extensionToolCalls: run.triage.budget?.extensionToolCalls ?? 1,
            jobId: extended.jobId,
            threadId: extended.threadId,
            dispatchedAt: new Date().toISOString(),
          },
        );
        return c.json({
          success: true,
          reconciled: true,
          phaseTransition: 'research->conditional-extension',
          researchExtension: {
            reason: extensionDecision.reason,
            required: extensionDecision.required,
            candidateCount: extensionDecision.candidateUrls.length,
            authorizedCandidateUrls: extensionDecision.candidateUrls,
            existingClusters: extensionDecision.existingClusters,
          },
          data: publicRun(updated),
        }, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (extensionDecision.required) {
          const failed = await markResearchRunState(postgres, run.id, {
            state: 'failed',
            runtimeReceipt: inspection.runtime,
            evidenceSnapshot: inspection.evidencePacket,
            validationErrors: [...inspection.errors, `required extension dispatch failed: ${message}`],
            error: `Required Research extension dispatch failed: ${message}`,
          });
          return c.json({
            success: false,
            reconciled: true,
            retryable: true,
            researchExtension: {
              reason: extensionDecision.reason,
              required: true,
            },
            error: failed.error,
            data: publicRun(failed),
          }, 502);
        }
        console.warn(`Research optional extension degraded run=${run.id}: ${message}`);
        // Minimum coverage is already satisfied for optional marginal-gain extension.
        // Finalize from frozen evidence instead of failing or re-running Phase A.
      }
    }

    if (phaseBMode === 'terminal-tool'
      && run.triage.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION
      && !hasSupportEligibleEvidence(inspection.evidencePacket)) {
      // Fail fast on a frozen empty evidence ledger. The finish_research_turn proposal shape is
      // fixed in Straylight, so the structuredFinalizationSchema legacy fallback would reject
      // every submission and burn up to two terminal continuations on a deterministic dead end.
      const invalid = await markResearchRunState(postgres, run.id, {
        state: 'invalid',
        runtimeReceipt: inspection.runtime,
        evidenceSnapshot: inspection.evidencePacket,
        validationErrors: [emptyEvidenceLedgerError()],
      });
      return c.json({ success: false, reconciled: true, data: publicRun(invalid) }, 422);
    }

    if (phaseBMode === 'terminal-tool') {
      // Same-thread terminal-tool continuation. The agent is asked to call finish_research_turn
      // exactly once; Quote0 adjudicates server-side and persists terminal_receipt. No state or
      // inventory is advanced here — a later finalization-phase reconcile consumes the receipt.
      try {
        const terminal = await dispatchResearchTerminalFinalization(
          run.id,
          run.straylightThreadId,
          run.inputSnapshot,
          inspection.evidencePacket,
          run.triage,
          { directDraft: directDraftFromRun(run) },
        );
        const updated = await markResearchRunDispatched(postgres, run.id, terminal.jobId, terminal.threadId);
        return c.json({
          success: true,
          reconciled: true,
          phaseTransition: 'research->terminal-finalization',
          terminalTool: true,
          data: publicRun(updated),
        }, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = await markResearchRunState(postgres, run.id, {
          state: 'failed',
          runtimeReceipt: inspection.runtime,
          evidenceSnapshot: inspection.evidencePacket,
          error: `Terminal finalization dispatch 失败: ${message}`,
        });
        return c.json({ success: false, error: failed.error, data: publicRun(failed) }, 502);
      }
    }

    if (getResearchCanaryConfig().structuredFinalizer) {
      const outcome = await completeWithStructuredFinalizer(
        persisted,
        inspection.evidencePacket,
        inspection.runtime,
      );
      if (outcome.kind === 'completed') {
        return c.json({
          success: true,
          reconciled: true,
          phaseTransition: 'research->structured-finalization->completed',
          structuredFinalizer: true,
          ...(outcome.universalApply ? { universalApply: outcome.universalApply } : {}),
          data: publicRun(outcome.run),
        });
      }
      if (outcome.kind === 'pending') {
        return c.json({
          success: false,
          reconciled: true,
          retryable: true,
          structuredFinalizer: true,
          error: `Structured Research artifact 已合法，但 materialization 暂未成功: ${outcome.error}`,
          data: publicRun(outcome.run),
        }, 503);
      }
      if (outcome.kind === 'failed') {
        return c.json({
          success: false,
          reconciled: true,
          structuredFinalizer: true,
          error: outcome.error,
          data: publicRun(outcome.run),
        }, 502);
      }
      return c.json({
        success: false,
        reconciled: true,
        structuredFinalizer: true,
        error: outcome.errors.join('; '),
        data: publicRun(outcome.run),
      }, 422);
    }

    try {
      const finalized = await dispatchResearchFinalization(
        run.id,
        run.inputSnapshot,
        inspection.evidencePacket,
        run.triage,
        { directDraft: directDraftFromRun(run) },
      );
      const updated = await markResearchRunDispatched(postgres, run.id, finalized.jobId, finalized.threadId);
      return c.json({
        success: true,
        reconciled: true,
        phaseTransition: 'research->finalization',
        data: publicRun(updated),
      }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await markResearchRunState(postgres, run.id, {
        state: 'failed',
        runtimeReceipt: inspection.runtime,
        evidenceSnapshot: inspection.evidencePacket,
        error: `Phase B dispatch 失败: ${message}`,
      });
      return c.json({ success: false, error: failed.error, data: publicRun(failed) }, 502);
    }
  }

  if (inspection.status === 'needs_input') {
    const waiting = await markResearchRunState(postgres, run.id, {
      state: 'waiting_user',
      runtimeReceipt: inspection.runtime,
      validationErrors: inspection.errors,
    });
    return c.json({ success: true, reconciled: true, data: publicRun(waiting) });
  }

  if (inspection.status === 'failed') {
    if (phase === 'finalization' && inspection.retryable && run.attempts < maxFinalizationAttempts && run.evidenceSnapshot) {
      // Preserve the runtime failure that caused the retry. A fresh-thread retry may
      // itself no-event, so the first failure remains part of the durable audit trail.
      await markResearchRunState(postgres, run.id, {
        state: 'running',
        validationErrors: inspection.errors,
      });
      try {
        const retried = await redispatchResearchFinalization(run, inspection.errors);
        const updated = await markResearchRunDispatched(postgres, run.id, retried.jobId, retried.threadId);
        return c.json({ success: true, reconciled: true, finalizationRetry: true, data: publicRun(updated) }, 202);
      } catch (error) {
        inspection.errors.push(`Finalization retry dispatch 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const failed = await markResearchRunState(postgres, run.id, {
      state: 'failed',
      runtimeReceipt: inspection.runtime,
      validationErrors: inspection.errors,
      error: inspection.errors.join('; ') || 'Straylight Research 执行失败',
    });
    return c.json({ success: false, reconciled: true, data: publicRun(failed) }, 502);
  }

  if (inspection.status === 'completed' && inspection.artifact) {
    const materializationRun: ResearchRunRecord = {
      ...run,
      runtimeReceipt: inspection.runtime,
      resultArtifact: inspection.artifact,
      completedAt: new Date().toISOString(),
    };
    let universalApply;
    try {
      universalApply = await applyUniversalResearchArtifact(postgres, {
        run: materializationRun,
        artifact: inspection.artifact,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const publishGateFailure = message.startsWith('universal Research final artifact 无效:');
      const feedback = [`universal publish gate: ${message}`];

      if (publishGateFailure && phase === 'finalization' && run.attempts < maxFinalizationAttempts && run.evidenceSnapshot) {
        await markResearchRunState(postgres, run.id, {
          state: 'running',
          runtimeReceipt: inspection.runtime,
          resultArtifact: inspection.artifact,
          validationErrors: feedback,
        });
        try {
          const retried = await redispatchResearchFinalization(run, feedback);
          const updated = await markResearchRunDispatched(postgres, run.id, retried.jobId, retried.threadId);
          return c.json({
            success: true,
            reconciled: true,
            universalFinalizerRetry: true,
            data: publicRun(updated),
          }, 202);
        } catch (dispatchError) {
          feedback.push(`universal finalizer retry dispatch 失败: ${dispatchError instanceof Error ? dispatchError.message : String(dispatchError)}`);
        }
      }

      if (publishGateFailure) {
        const failed = await markResearchRunState(postgres, run.id, {
          state: 'failed',
          runtimeReceipt: inspection.runtime,
          resultArtifact: inspection.artifact,
          validationErrors: feedback,
          error: feedback.join('; '),
        });
        return c.json({
          success: false,
          reconciled: true,
          retryable: true,
          error: `Research final artifact 未通过 universal publish gate；保留 pending，稍后重新研究: ${message}`,
          data: publicRun(failed),
        }, 422);
      }

      const retrying = await markResearchRunState(postgres, run.id, {
        state: 'running',
        runtimeReceipt: inspection.runtime,
        resultArtifact: inspection.artifact,
        validationErrors: [`universal materialization pending: ${message}`],
      });
      return c.json({
        success: false,
        reconciled: true,
        retryable: true,
        error: `Research 已完成，但 grounded inventory materialization 暂未成功: ${message}`,
        data: publicRun(retrying),
      }, 503);
    }

    const completed = await markResearchRunState(postgres, run.id, {
      state: 'completed',
      runtimeReceipt: inspection.runtime,
      resultArtifact: inspection.artifact,
      validationErrors: [],
    });
    return c.json({
      success: true,
      reconciled: true,
      universalApply,
      data: publicRun(completed),
    });
  }

  if (inspection.status === 'invalid' && inspection.retryable && phase === 'finalization' && run.attempts < maxFinalizationAttempts && run.evidenceSnapshot
    && (phaseBMode !== 'terminal-tool' || hasSupportEligibleEvidence(run.evidenceSnapshot))) {
    // Persist the first validator failure before dispatching the one allowed retry.
    // If the retry itself crashes/no-events, this evidence must survive the terminal update.
    await markResearchRunState(postgres, run.id, {
      state: 'running',
      validationErrors: inspection.errors,
    });
    try {
      const retried = await redispatchResearchFinalization(run, inspection.errors);
      const updated = await markResearchRunDispatched(postgres, run.id, retried.jobId, retried.threadId);
      return c.json({
        success: true,
        reconciled: true,
        finalizationRetry: true,
        data: publicRun(updated),
      }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await markResearchRunState(postgres, run.id, {
        state: 'failed',
        runtimeReceipt: inspection.runtime,
        validationErrors: inspection.errors,
        error: `Finalization retry dispatch 失败: ${message}`,
      });
      return c.json({ success: false, error: failed.error, data: publicRun(failed) }, 502);
    }
  }

  const invalid = await markResearchRunState(postgres, run.id, {
    state: 'invalid',
    runtimeReceipt: inspection.runtime,
    validationErrors: inspection.errors,
  });
  return c.json({ success: false, reconciled: true, data: publicRun(invalid) }, 422);
});

export default app;
