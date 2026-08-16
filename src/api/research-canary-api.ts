import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  dispatchResearchCanary,
  dispatchResearchFinalization,
  getResearchCanaryConfig,
  inspectResearchCanary,
  RESEARCH_CANARY_MODE,
  researchCanaryFingerprint,
  researchCanaryIdempotencyKey,
} from './research-canary.js';
import {
  createResearchRun,
  getResearchRun,
  markResearchRunDispatched,
  markResearchRunState,
  type ResearchRunRecord,
} from './research-run-store.js';
import { triageResearchCandidate, type ResearchSeed } from './research-triage.js';

const app = new Hono();
const postgres = getPostgresDatabase();

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeed(value: unknown): ResearchSeed | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const title = cleanString(raw.title);
  if (!title) return undefined;
  return {
    title,
    ...(cleanString(raw.content) ? { content: cleanString(raw.content) } : {}),
    ...(cleanString(raw.source) ? { source: cleanString(raw.source) } : {}),
    ...(cleanString(raw.link) ? { link: cleanString(raw.link) } : {}),
    ...(cleanString(raw.category) ? { category: cleanString(raw.category) } : {}),
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
    phase: run.attempts <= 1 ? 'research' : 'finalization',
    promotable: run.state === 'completed',
    autoPublished: false,
  };
}

function canaryUnavailable() {
  const config = getResearchCanaryConfig();
  if (!config.enabled) return 'QUOTE0_RESEARCH_CANARY_ENABLED 未启用';
  if (!config.baseUrl) return 'STRAYLIGHT_RESEARCH_BASE_URL 未配置';
  return undefined;
}

app.post('/api/news/research/canary/jobs', async (c) => {
  const unavailable = canaryUnavailable();
  if (unavailable) return c.json({ success: false, error: unavailable }, 503);

  const body = await c.req.json().catch(() => null) as {
    seed?: unknown;
    manual?: unknown;
    conflict?: unknown;
    requestKey?: unknown;
  } | null;
  const seed = normalizeSeed(body?.seed);
  if (!seed) return c.json({ success: false, error: 'seed.title 不能为空' }, 400);

  const triage = triageResearchCandidate({
    seed,
    manual: body?.manual === true,
    conflict: body?.conflict === true,
  });
  if (triage.lane !== 'research') {
    return c.json({
      success: true,
      dispatched: false,
      data: { triage, reason: 'direct-lane' },
    });
  }

  await postgres.initialize();
  const candidateId = randomUUID();
  const idempotencyKey = researchCanaryIdempotencyKey(seed, triage, cleanString(body?.requestKey));
  const run = await createResearchRun(postgres, {
    id: candidateId,
    mode: RESEARCH_CANARY_MODE,
    fingerprint: researchCanaryFingerprint(seed),
    idempotencyKey,
    policyVersion: triage.policyVersion,
    agentId: getResearchCanaryConfig().agentId,
    seed,
    triage,
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
  const inspection = await inspectResearchCanary({
    runId: run.id,
    seed: run.inputSnapshot,
    jobId: run.straylightJobId,
    threadId: run.straylightThreadId,
    phase,
    ...(phase === 'finalization' && run.runtimeReceipt ? { priorRuntime: run.runtimeReceipt } : {}),
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
    await markResearchRunState(postgres, run.id, {
      state: 'running',
      runtimeReceipt: inspection.runtime,
      evidenceSnapshot: inspection.evidencePacket,
      validationErrors: inspection.errors,
    });
    try {
      const finalized = await dispatchResearchFinalization(
        run.id,
        run.inputSnapshot,
        inspection.evidencePacket,
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
    if (phase === 'finalization' && inspection.retryable && run.attempts < 3 && run.evidenceSnapshot) {
      // Preserve the runtime failure that caused the retry. A fresh-thread retry may
      // itself no-event, so the first failure remains part of the durable audit trail.
      await markResearchRunState(postgres, run.id, {
        state: 'running',
        validationErrors: inspection.errors,
      });
      try {
        const retried = await dispatchResearchFinalization(
          run.id,
          run.inputSnapshot,
          run.evidenceSnapshot,
          inspection.errors,
        );
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
    const completed = await markResearchRunState(postgres, run.id, {
      state: 'completed',
      runtimeReceipt: inspection.runtime,
      resultArtifact: inspection.artifact,
      validationErrors: [],
    });
    return c.json({ success: true, reconciled: true, data: publicRun(completed) });
  }

  if (inspection.status === 'invalid' && inspection.retryable && phase === 'finalization' && run.attempts < 3 && run.evidenceSnapshot) {
    // Persist the first validator failure before dispatching the one allowed retry.
    // If the retry itself crashes/no-events, this evidence must survive the terminal update.
    await markResearchRunState(postgres, run.id, {
      state: 'running',
      validationErrors: inspection.errors,
    });
    try {
      const retried = await dispatchResearchFinalization(
        run.id,
        run.inputSnapshot,
        run.evidenceSnapshot,
        inspection.errors,
      );
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
