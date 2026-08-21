import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import researchCanaryApp from './research-canary-api.js';
import {
  dispatchResearchCanary,
  getResearchCanaryConfig,
  RESEARCH_CANARY_MODE,
  researchCanaryFingerprint,
  researchCanaryIdempotencyKey,
} from './research-canary.js';
import {
  createResearchRun,
  markResearchRunDispatched,
  markResearchRunState,
  type ResearchRunRecord,
} from './research-run-store.js';
import {
  triageResearchCandidate,
  type ResearchSeed,
  type ResearchTriageDecision,
} from './research-triage.js';
import { contentQualityResearchPriority } from './content-quality.js';
import {
  UNIVERSAL_RESEARCH_POLICY_VERSION,
  universalResearchEnabled,
} from './universal-research-policy.js';

const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface ResearchAutoWorkerConfig {
  enabled: boolean;
  /** Universal mode removes the per-day item quota but keeps per-run bounded budgets. */
  universal: boolean;
  dailyLimit: number;
  lookbackHours: number;
  tickMs: number;
  scanLimit: number;
}

export interface InventoryResearchRow {
  id: number;
  fingerprint?: string | null;
  title?: string | null;
  link?: string | null;
  source?: string | null;
  category?: string | null;
  raw_content?: Record<string, unknown> | null;
  processed_content?: Record<string, unknown> | null;
  created_at?: string | Date | null;
  research_attempts?: number | string | null;
}

export interface AutoResearchCandidate {
  inventoryId: number;
  seed: ResearchSeed;
  triage: ResearchTriageDecision;
  directSnapshot?: Record<string, unknown>;
  priorRuns: number;
}

export type ResearchSelectionBucket = 'quality-gap' | 'high-risk' | 'exploration';

export function researchSelectionBucketForCount(count: number): ResearchSelectionBucket {
  const normalized = Math.max(0, Math.floor(count));
  return normalized % 3 === 0 ? 'quality-gap' : normalized % 3 === 1 ? 'high-risk' : 'exploration';
}

export type ResearchAutoTickResult =
  | { action: 'disabled' }
  | { action: 'reconciled'; runId: string; state?: string }
  | { action: 'daily-cap'; count: number; limit: number }
  | { action: 'no-candidate' }
  | { action: 'idempotent'; run: ResearchRunRecord }
  | { action: 'dispatched'; run: ResearchRunRecord }
  | { action: 'dispatch-failed'; run: ResearchRunRecord; error: string };

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getResearchAutoWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): ResearchAutoWorkerConfig {
  return {
    enabled: (env.QUOTE0_RESEARCH_AUTO_ENABLED || 'false').toLowerCase() === 'true',
    universal: universalResearchEnabled(env),
    dailyLimit: boundedInt(env.QUOTE0_RESEARCH_AUTO_DAILY_LIMIT, 1, 1, 20),
    lookbackHours: boundedInt(env.QUOTE0_RESEARCH_AUTO_LOOKBACK_HOURS, 24, 1, 168),
    tickMs: boundedInt(env.QUOTE0_RESEARCH_AUTO_TICK_MS, 30_000, 5_000, 300_000),
    scanLimit: boundedInt(env.QUOTE0_RESEARCH_AUTO_SCAN_LIMIT, 25, 5, 100),
  };
}

export function inventoryRowToResearchSeed(row: InventoryResearchRow): ResearchSeed | undefined {
  const raw = row.raw_content && typeof row.raw_content === 'object' && !Array.isArray(row.raw_content)
    ? row.raw_content
    : {};
  const title = cleanString(raw.title) || cleanString(row.title);
  if (!title) return undefined;
  const content = cleanString(raw.content) || cleanString(raw.description);
  const source = cleanString(raw.source) || cleanString(row.source);
  const link = cleanString(raw.link) || cleanString(row.link);
  const category = cleanString(raw.category) || cleanString(row.category) || 'news';
  return {
    title,
    ...(content ? { content } : {}),
    ...(source ? { source } : {}),
    ...(link ? { link } : {}),
    category,
  };
}

/**
 * Candidate choice is deterministic and bucket-aware. The worker rotates its daily
 * Research budget across quality-gap, high-risk and exploratory slots so no single
 * class can monopolize the small production canary budget. If the preferred bucket
 * is empty, selection falls back to the global research pool.
 */
export function chooseAutoResearchCandidate(
  rows: InventoryResearchRow[],
  preferredBucket: ResearchSelectionBucket = 'exploration',
  universal = false,
): AutoResearchCandidate | undefined {
  const candidates = rows.flatMap((row, index) => {
    const seed = inventoryRowToResearchSeed(row);
    if (!seed || !Number.isInteger(row.id) || row.id <= 0) return [];
    const triage = triageResearchCandidate({ seed, universal });
    if (triage.lane !== 'research') return [];
    const direct = row.processed_content && typeof row.processed_content === 'object' && !Array.isArray(row.processed_content)
      ? row.processed_content as Record<string, unknown>
      : undefined;
    return [{
      inventoryId: row.id,
      seed,
      triage,
      ...(direct ? { directSnapshot: direct } : {}),
      priorRuns: Math.max(0, Number(row.research_attempts || 0)),
      qualityPriority: contentQualityResearchPriority(row.processed_content),
      index,
    }];
  });
  const preferred = preferredBucket === 'quality-gap'
    ? candidates.filter((candidate) => candidate.qualityPriority > 0)
    : preferredBucket === 'high-risk'
      ? candidates.filter((candidate) => candidate.triage.signals.highRisk)
      : candidates;
  const pool = preferred.length > 0 ? preferred : candidates;
  pool.sort((a, b) => {
    if (preferredBucket === 'quality-gap') {
      const priorityDelta = b.qualityPriority - a.qualityPriority;
      if (priorityDelta) return priorityDelta;
    }
    // Exploration remains newest-first and intentionally does not privilege high-risk;
    // otherwise the third slot would silently recreate the old high-risk sampling bias.
    return a.index - b.index;
  });
  const selected = pool[0];
  if (!selected) return undefined;
  return {
    inventoryId: selected.inventoryId,
    seed: selected.seed,
    triage: selected.triage,
    ...(selected.directSnapshot ? { directSnapshot: selected.directSnapshot } : {}),
    priorRuns: selected.priorRuns,
  };
}

let running = false;

export function startResearchCanaryWorker(): void {
  const config = getResearchAutoWorkerConfig();
  if (!config.enabled) {
    console.log('🧪 Research auto-canary worker disabled');
    return;
  }
  if (running) return;
  running = true;
  console.log(
    `🧪 Research auto-canary worker started id=${WORKER_ID} `
      + `mode=${config.universal ? 'universal-admission' : `daily-cap:${config.dailyLimit}`} `
      + `lookback=${config.lookbackHours}h tick=${config.tickMs}ms concurrency=1`,
  );
  loop(config).catch((error) => console.error('Research auto-canary worker loop crash:', error));
}

async function loop(config: ResearchAutoWorkerConfig): Promise<void> {
  try {
    await getPostgresDatabase().initialize();
  } catch (error) {
    console.warn('Research auto-canary worker DB preflight failed; tick loop will retry:', error);
  }
  while (running) {
    try {
      const result = await runResearchAutoTick(config);
      if (result.action === 'dispatched') {
        console.log(`🧪 Research auto dispatched inventory=${result.run.sourceInventoryId} run=${result.run.id}`);
      } else if (result.action === 'reconciled' && result.state && result.state !== 'running') {
        console.log(`🧪 Research auto reconciled run=${result.runId} state=${result.state}`);
      } else if (result.action === 'dispatch-failed') {
        console.warn(`🧪 Research auto dispatch failed run=${result.run.id}: ${result.error}`);
      }
    } catch (error) {
      console.error('Research auto-canary worker tick error:', error);
    }
    await sleep(config.tickMs);
  }
}

export async function runResearchAutoTick(
  config: ResearchAutoWorkerConfig = getResearchAutoWorkerConfig(),
): Promise<ResearchAutoTickResult> {
  if (!config.enabled) return { action: 'disabled' };
  const canaryConfig = getResearchCanaryConfig();
  if (!canaryConfig.enabled || !canaryConfig.baseUrl) {
    throw new Error('Research auto worker requires enabled Quote0 Research Canary + STRAYLIGHT_RESEARCH_BASE_URL');
  }

  const db = getPostgresDatabase();
  await db.initialize();

  // Concurrency is intentionally fixed at one in the first production canary.
  const active = await db.query(
    `SELECT id FROM research_runs
      WHERE trigger='inventory-auto' AND state IN ('queued','running')
      ORDER BY created_at ASC LIMIT 1`,
  );
  if (active.rows[0]?.id) {
    const runId = String(active.rows[0].id);
    const response = await researchCanaryApp.request(
      `/api/news/research/canary/jobs/${encodeURIComponent(runId)}/reconcile`,
      { method: 'POST' },
    );
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok && !payload?.data?.state) {
      throw new Error(`auto reconcile HTTP ${response.status}: ${payload?.error || 'unknown error'}`);
    }
    return { action: 'reconciled', runId, ...(payload?.data?.state ? { state: String(payload.data.state) } : {}) };
  }

  let count = 0;
  if (!config.universal) {
    const today = await db.query(
      `SELECT COUNT(*)::int AS count FROM research_runs
        WHERE trigger='inventory-auto'
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')`,
    );
    count = Number(today.rows[0]?.count || 0);
    if (count >= config.dailyLimit) return { action: 'daily-cap', count, limit: config.dailyLimit };
  }

  const inventory = await db.query(
    `SELECT ci.id, ci.fingerprint, ci.title, ci.link, ci.source, ci.category,
            ci.raw_content, ci.processed_content, ci.created_at,
            (SELECT COUNT(*)::int FROM research_runs history
              WHERE history.trigger='inventory-auto' AND history.source_inventory_id=ci.id) AS research_attempts
       FROM content_inventory ci
      WHERE ci.state IN ('ready','pushed')
        AND ($3::boolean = true OR ci.created_at >= now() - ($1 || ' hours')::interval)
        AND COALESCE(ci.raw_content->>'origin','') <> 'renderable-intake'
        AND ci.processed_content->'metadata'->'researchReceipt' IS NULL
        AND ($3::boolean = false OR (
          ci.processed_content->'metadata'->'researchGate'->>'schemaVersion' = $4
          AND ci.processed_content->'metadata'->'researchGate'->>'state' = 'pending'
        ))
        AND NOT EXISTS (
          SELECT 1 FROM research_runs rr
           WHERE rr.trigger='inventory-auto'
             AND rr.source_inventory_id=ci.id
             AND rr.state IN ('queued','running','waiting_user','completed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM research_runs recent_failure
           WHERE recent_failure.trigger='inventory-auto'
             AND recent_failure.source_inventory_id=ci.id
             AND recent_failure.state IN ('failed','invalid')
             AND recent_failure.updated_at >= now() - INTERVAL '15 minutes'
        )
      ORDER BY
        CASE WHEN $3::boolean THEN (SELECT COUNT(*) FROM research_runs attempts
          WHERE attempts.trigger='inventory-auto' AND attempts.source_inventory_id=ci.id) END ASC,
        CASE WHEN $3::boolean THEN ci.created_at END ASC,
        CASE WHEN $3::boolean = false THEN ci.created_at END DESC
      LIMIT $2`,
    [String(config.lookbackHours), config.scanLimit, config.universal, UNIVERSAL_RESEARCH_POLICY_VERSION],
  );
  // Legacy mode preserves the stratified daily canary. Universal mode admits every
  // pending item and uses oldest-first FIFO to prevent starvation while keeping
  // per-item adaptive Research budgets bounded.
  const selectionBucket = researchSelectionBucketForCount(count);
  const candidate = chooseAutoResearchCandidate(
    inventory.rows as InventoryResearchRow[],
    selectionBucket,
    config.universal,
  );
  if (!candidate) return { action: 'no-candidate' };

  const candidateId = randomUUID();
  const requestKey = config.universal
    ? `inventory-auto:${candidate.inventoryId}:attempt-${candidate.priorRuns + 1}`
    : `inventory-auto:${candidate.inventoryId}`;
  const run = await createResearchRun(db, {
    id: candidateId,
    mode: RESEARCH_CANARY_MODE,
    fingerprint: researchCanaryFingerprint(candidate.seed),
    idempotencyKey: researchCanaryIdempotencyKey(candidate.seed, candidate.triage, requestKey),
    policyVersion: candidate.triage.policyVersion,
    agentId: canaryConfig.agentId,
    trigger: 'inventory-auto',
    sourceInventoryId: candidate.inventoryId,
    ...(candidate.directSnapshot ? { directSnapshot: candidate.directSnapshot } : {}),
    seed: candidate.seed,
    triage: candidate.triage,
  });

  if (run.id !== candidateId || run.straylightJobId || run.attempts > 0) {
    return { action: 'idempotent', run };
  }

  try {
    const dispatched = await dispatchResearchCanary(run.id, candidate.seed, candidate.triage);
    const updated = await markResearchRunDispatched(db, run.id, dispatched.jobId, dispatched.threadId);
    return { action: 'dispatched', run: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await markResearchRunState(db, run.id, {
      state: 'failed',
      validationErrors: [message],
      error: message,
    });
    return { action: 'dispatch-failed', run: failed, error: message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
