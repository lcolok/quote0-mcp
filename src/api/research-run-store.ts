import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import type { ResearchRuntimeReceipt } from './research-canary.js';
import type { ResearchSeed, ResearchTriageDecision } from './research-triage.js';

export type ResearchRunState = 'queued' | 'running' | 'waiting_user' | 'completed' | 'invalid' | 'failed' | 'cancelled';

export interface ResearchRunRecord {
  id: string;
  mode: string;
  fingerprint: string;
  idempotencyKey: string;
  state: ResearchRunState;
  policyVersion: string;
  agentId: string;
  trigger: 'manual' | 'inventory-auto';
  sourceInventoryId?: number;
  inputSnapshot: ResearchSeed;
  triage: ResearchTriageDecision;
  straylightJobId?: string;
  straylightJobIds: string[];
  straylightThreadId?: string;
  straylightThreadIds: string[];
  evidenceSnapshot?: string;
  directSnapshot?: Record<string, unknown>;
  attempts: number;
  resultArtifact?: RenderableDataItem;
  runtimeReceipt?: ResearchRuntimeReceipt;
  validationErrors?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

function fromRow(row: any): ResearchRunRecord {
  return {
    id: String(row.id),
    mode: String(row.mode),
    fingerprint: String(row.fingerprint),
    idempotencyKey: String(row.idempotency_key),
    state: row.state as ResearchRunState,
    policyVersion: String(row.policy_version),
    agentId: String(row.agent_id),
    trigger: row.trigger === 'inventory-auto' ? 'inventory-auto' : 'manual',
    ...(row.source_inventory_id != null ? { sourceInventoryId: Number(row.source_inventory_id) } : {}),
    inputSnapshot: row.input_snapshot as ResearchSeed,
    triage: row.triage as ResearchTriageDecision,
    ...(row.straylight_job_id ? { straylightJobId: String(row.straylight_job_id) } : {}),
    straylightJobIds: Array.isArray(row.straylight_job_ids) ? row.straylight_job_ids.map(String) : [],
    ...(row.straylight_thread_id ? { straylightThreadId: String(row.straylight_thread_id) } : {}),
    straylightThreadIds: Array.isArray(row.straylight_thread_ids) ? row.straylight_thread_ids.map(String) : [],
    ...(row.evidence_snapshot ? { evidenceSnapshot: String(row.evidence_snapshot) } : {}),
    ...(row.direct_snapshot ? { directSnapshot: row.direct_snapshot as Record<string, unknown> } : {}),
    attempts: Number(row.attempts || 0),
    ...(row.result_artifact ? { resultArtifact: row.result_artifact as RenderableDataItem } : {}),
    ...(row.runtime_receipt ? { runtimeReceipt: row.runtime_receipt as ResearchRuntimeReceipt } : {}),
    ...(Array.isArray(row.validation_errors) ? { validationErrors: row.validation_errors.map(String) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
  };
}

export async function createResearchRun(
  db: PostgresDatabase,
  input: {
    id: string;
    mode: string;
    fingerprint: string;
    idempotencyKey: string;
    policyVersion: string;
    agentId: string;
    trigger?: 'manual' | 'inventory-auto';
    sourceInventoryId?: number;
    directSnapshot?: Record<string, unknown>;
    seed: ResearchSeed;
    triage: ResearchTriageDecision;
  },
): Promise<ResearchRunRecord> {
  const result = await db.query(
    `INSERT INTO research_runs (
       id, mode, fingerprint, idempotency_key, state, policy_version, agent_id,
       trigger, source_inventory_id, direct_snapshot, input_snapshot, triage
     ) VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = research_runs.updated_at
     RETURNING *`,
    [
      input.id,
      input.mode,
      input.fingerprint,
      input.idempotencyKey,
      input.policyVersion,
      input.agentId,
      input.trigger || 'manual',
      input.sourceInventoryId ?? null,
      input.directSnapshot ? JSON.stringify(input.directSnapshot) : null,
      JSON.stringify(input.seed),
      JSON.stringify(input.triage),
    ],
  );
  return fromRow(result.rows[0]);
}

export async function getResearchRun(db: PostgresDatabase, id: string): Promise<ResearchRunRecord | undefined> {
  const result = await db.query('SELECT * FROM research_runs WHERE id=$1', [id]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}

export async function markResearchRunDispatched(
  db: PostgresDatabase,
  id: string,
  jobId: string,
  threadId: string,
): Promise<ResearchRunRecord> {
  const result = await db.query(
    `UPDATE research_runs
        SET state='running',
            straylight_job_id=$2,
            straylight_job_ids=COALESCE(straylight_job_ids, '[]'::jsonb) || $3::jsonb,
            straylight_thread_id=$4,
            straylight_thread_ids=COALESCE(straylight_thread_ids, '[]'::jsonb) || $5::jsonb,
            attempts=attempts+1,
            error=NULL,
            updated_at=NOW()
      WHERE id=$1
      RETURNING *`,
    [id, jobId, JSON.stringify([jobId]), threadId, JSON.stringify([threadId])],
  );
  if (!result.rows[0]) throw new Error(`research_run ${id} 不存在`);
  return fromRow(result.rows[0]);
}

export async function markResearchRunState(
  db: PostgresDatabase,
  id: string,
  update: {
    state: ResearchRunState;
    runtimeReceipt?: ResearchRuntimeReceipt;
    resultArtifact?: RenderableDataItem;
    validationErrors?: string[];
    evidenceSnapshot?: string;
    error?: string;
  },
): Promise<ResearchRunRecord> {
  const terminal = ['completed', 'invalid', 'failed', 'cancelled'].includes(update.state);
  const result = await db.query(
    `UPDATE research_runs
        SET state=$2,
            runtime_receipt=COALESCE($3::jsonb, runtime_receipt),
            result_artifact=COALESCE($4::jsonb, result_artifact),
            validation_errors=COALESCE($5::jsonb, validation_errors),
            evidence_snapshot=COALESCE($6, evidence_snapshot),
            error=$7,
            updated_at=NOW(),
            completed_at=CASE WHEN $8::boolean THEN COALESCE(completed_at, NOW()) ELSE completed_at END
      WHERE id=$1
      RETURNING *`,
    [
      id,
      update.state,
      update.runtimeReceipt ? JSON.stringify(update.runtimeReceipt) : null,
      update.resultArtifact ? JSON.stringify(update.resultArtifact) : null,
      update.validationErrors ? JSON.stringify(update.validationErrors) : null,
      update.evidenceSnapshot || null,
      update.error || null,
      terminal,
    ],
  );
  if (!result.rows[0]) throw new Error(`research_run ${id} 不存在`);
  return fromRow(result.rows[0]);
}
