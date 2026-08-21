import { hostname } from 'node:os';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  getRssSourceDefinition,
  getRssSourceRegistry,
  type RSSSourceProfile,
} from '../react-widgets/core/data-sources/rss-source-registry.js';
import {
  isBarkAlertsConfigured,
  sendBarkAlertMessage,
  type BarkAlertLevel,
} from './device-health-alerts.js';

export type RssSourceHealth = 'unknown' | 'healthy' | 'degraded';
export type RssSourceAlertKind = 'outage' | 'recovery';
export type RssSourceAlertState = 'pending' | 'leased' | 'retry_wait' | 'sent' | 'dead' | 'skipped';

export interface QueryExecutor {
  query(text: string, params?: any[]): Promise<any>;
}

export interface RssSourceFailureObservation {
  sourceId: string;
  consecutiveFailures: number;
  threshold: number;
  reason?: string;
  observedAt?: Date;
}

export interface RssSourceHealthAlertRow {
  id: string;
  source_id: string;
  from_health: RssSourceHealth;
  to_health: RssSourceHealth;
  alert_kind: RssSourceAlertKind;
  level: BarkAlertLevel;
  consecutive_failures: number;
  reason: string | null;
  outage_started_at: string | Date | null;
  state: RssSourceAlertState;
  attempts: number;
  max_attempts: number;
}

export interface RssSourceHealthSummary {
  sourceId: string;
  name: string;
  profile: RSSSourceProfile;
  health: RssSourceHealth;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  outageStartedAt: string | null;
  lastError: string | null;
  alertable: boolean;
}

const SOURCE_ALERT_WORKER_ID = `${hostname()}:${process.pid}:rss-bark:${crypto.randomUUID().slice(0, 8)}`;
const SOURCE_ALERT_TICK_MS = 30_000;
const SOURCE_ALERT_LEASE_SECONDS = 60;
const SOURCE_ALERT_BATCH_SIZE = 4;
const SOURCE_ALERT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
let sourceAlertWorkerRunning = false;

function cleanReason(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
}

function alertableSource(sourceId: string): boolean {
  return getRssSourceDefinition(sourceId)?.profile === 'core';
}

function alertState(env: NodeJS.ProcessEnv): { state: RssSourceAlertState; lastError: string | null } {
  if (isBarkAlertsConfigured(env)) return { state: 'pending', lastError: null };
  return {
    state: 'skipped',
    lastError: 'Bark disabled or BARK_DEVICE_KEY not configured',
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatRssSourceHealthAlert(alert: Pick<RssSourceHealthAlertRow,
  'source_id' | 'from_health' | 'to_health' | 'alert_kind' | 'level' | 'consecutive_failures' | 'reason' | 'outage_started_at'>): {
  title: string;
  body: string;
  level: BarkAlertLevel;
} {
  const source = getRssSourceDefinition(alert.source_id);
  const label = source?.name || alert.source_id;
  if (alert.alert_kind === 'recovery') {
    const outageStart = alert.outage_started_at ? new Date(alert.outage_started_at) : null;
    const durationMinutes = outageStart && Number.isFinite(outageStart.getTime())
      ? Math.max(0, Math.round((Date.now() - outageStart.getTime()) / 60_000))
      : null;
    return {
      title: '✅ Quote0 RSS 源恢复',
      body: [
        `source=${label}`,
        `${alert.from_health}→${alert.to_health}`,
        durationMinutes !== null ? `outage≈${durationMinutes}min` : null,
      ].filter(Boolean).join(' · '),
      level: 'info',
    };
  }

  return {
    title: '🚨 Quote0 核心 RSS 源失联',
    body: [
      `source=${label}`,
      `${alert.from_health}→${alert.to_health}`,
      `failures=${alert.consecutive_failures}`,
      alert.reason ? `reason=${cleanReason(alert.reason)}` : null,
    ].filter(Boolean).join(' · '),
    level: alert.level || 'critical',
  };
}

/**
 * Record one failed source probe. The source becomes degraded only after the
 * scheduler's own consecutive-failure threshold is reached; one-off fetch
 * jitter is telemetry, not an incident. The state transition and outbox insert
 * are one SQL statement so scheduler concurrency cannot duplicate an outage.
 */
export async function recordRssSourceFailure(
  executor: QueryExecutor,
  observation: RssSourceFailureObservation,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const observedAt = observation.observedAt ?? new Date();
  const threshold = Math.max(1, Math.trunc(observation.threshold || 1));
  const failures = Math.max(0, Math.trunc(observation.consecutiveFailures || 0));
  const reason = cleanReason(observation.reason);
  const notify = alertableSource(observation.sourceId);
  const delivery = alertState(env);

  const result = await executor.query(
    `WITH previous AS (
       SELECT health, last_success_at, outage_started_at
         FROM rss_source_runtime_state
        WHERE source_id = $1
     ), upserted AS (
       INSERT INTO rss_source_runtime_state (
         source_id, health, last_failure_at, consecutive_failures,
         last_error, outage_started_at, updated_at
       ) VALUES (
         $1,
         CASE WHEN $2::integer >= $3::integer THEN 'degraded' ELSE 'unknown' END,
         $4::timestamptz, $2::integer, NULLIF($5::text,''),
         CASE WHEN $2::integer >= $3::integer THEN $4::timestamptz ELSE NULL END,
         $4::timestamptz
       )
       ON CONFLICT (source_id) DO UPDATE SET
         health = CASE
           WHEN $2::integer >= $3::integer THEN 'degraded'
           ELSE rss_source_runtime_state.health
         END,
         last_failure_at = $4::timestamptz,
         consecutive_failures = $2::integer,
         last_error = NULLIF($5::text,''),
         outage_started_at = CASE
           WHEN $2::integer >= $3::integer AND rss_source_runtime_state.health <> 'degraded'
             THEN COALESCE(rss_source_runtime_state.outage_started_at, $4::timestamptz)
           ELSE rss_source_runtime_state.outage_started_at
         END,
         updated_at = $4::timestamptz
       RETURNING health, outage_started_at
     ), transition AS (
       SELECT COALESCE((SELECT health FROM previous), 'unknown') AS from_health,
              (SELECT health FROM upserted) AS to_health,
              (SELECT outage_started_at FROM upserted) AS outage_started_at
     )
     INSERT INTO rss_source_health_alerts (
       source_id, from_health, to_health, alert_kind, level,
       consecutive_failures, reason, outage_started_at,
       state, last_error, updated_at
     )
     SELECT $1::text, from_health, to_health, 'outage', 'critical',
            $2::integer, NULLIF($5::text,''), outage_started_at, $7::text, $8::text, $4::timestamptz
       FROM transition
      WHERE $6::boolean = true
        AND from_health <> 'degraded'
        AND to_health = 'degraded'
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      observation.sourceId,
      failures,
      threshold,
      observedAt,
      reason,
      notify,
      delivery.state,
      delivery.lastError,
    ],
  );
  return result.rowCount === 1;
}

/** Any successful fetch — including "reachable but no fresh candidate" — closes an outage. */
export async function recordRssSourceSuccess(
  executor: QueryExecutor,
  sourceId: string,
  observedAt: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const notify = alertableSource(sourceId);
  const delivery = alertState(env);
  const result = await executor.query(
    `WITH previous AS (
       SELECT health, outage_started_at
         FROM rss_source_runtime_state
        WHERE source_id = $1
     ), upserted AS (
       INSERT INTO rss_source_runtime_state (
         source_id, health, last_success_at, consecutive_failures,
         last_error, outage_started_at, updated_at
       ) VALUES ($1, 'healthy', $2::timestamptz, 0, NULL, NULL, $2::timestamptz)
       ON CONFLICT (source_id) DO UPDATE SET
         health = 'healthy',
         last_success_at = $2::timestamptz,
         consecutive_failures = 0,
         last_error = NULL,
         outage_started_at = NULL,
         updated_at = $2::timestamptz
       RETURNING health
     ), transition AS (
       SELECT COALESCE((SELECT health FROM previous), 'unknown') AS from_health,
              (SELECT health FROM upserted) AS to_health,
              (SELECT outage_started_at FROM previous) AS outage_started_at
     )
     INSERT INTO rss_source_health_alerts (
       source_id, from_health, to_health, alert_kind, level,
       consecutive_failures, outage_started_at,
       state, last_error, updated_at
     )
     SELECT $1::text, from_health, to_health, 'recovery', 'info',
            0, outage_started_at, $4::text, $5::text, $2::timestamptz
       FROM transition
      WHERE $3::boolean = true
        AND from_health = 'degraded'
        AND to_health = 'healthy'
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [sourceId, observedAt, notify, delivery.state, delivery.lastError],
  );
  return result.rowCount === 1;
}

function sourceAlertBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1) - 1, SOURCE_ALERT_BACKOFF_MS.length - 1);
  return SOURCE_ALERT_BACKOFF_MS[index];
}

export async function sendBarkRssSourceAlert(
  alert: RssSourceHealthAlertRow,
  options: { env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const formatted = formatRssSourceHealthAlert(alert);
  await sendBarkAlertMessage({
    ...formatted,
    group: env.BARK_SOURCE_GROUP || 'quote0-rss',
  }, options);
}

export async function claimRssSourceHealthAlerts(limit = SOURCE_ALERT_BATCH_SIZE): Promise<RssSourceHealthAlertRow[]> {
  const pool = getPostgresDatabase().getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT a.id
         FROM rss_source_health_alerts a
        WHERE (
          (a.state IN ('pending','retry_wait') AND a.next_attempt_at <= now())
          OR (a.state='leased' AND a.lease_expires_at < now())
        )
          AND NOT EXISTS (
            SELECT 1 FROM rss_source_health_alerts older
             WHERE older.source_id = a.source_id
               AND older.id < a.id
               AND older.state IN ('pending','leased','retry_wait')
          )
        ORDER BY a.id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (selected.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const ids = selected.rows.map((row: any) => row.id);
    const claimed = await client.query(
      `UPDATE rss_source_health_alerts
          SET state='leased', attempts=attempts+1,
              lease_owner=$2, lease_expires_at=now() + ($3 || ' seconds')::interval,
              updated_at=now()
        WHERE id = ANY($1::bigint[])
        RETURNING *`,
      [ids, SOURCE_ALERT_WORKER_ID, String(SOURCE_ALERT_LEASE_SECONDS)],
    );
    await client.query('COMMIT');
    return claimed.rows as RssSourceHealthAlertRow[];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markSourceAlertSent(id: string): Promise<void> {
  await getPostgresDatabase().query(
    `UPDATE rss_source_health_alerts
        SET state='sent', sent_at=now(), lease_owner=NULL, lease_expires_at=NULL,
            last_error=NULL, updated_at=now()
      WHERE id=$1`,
    [id],
  );
}

async function markSourceAlertFailure(alert: RssSourceHealthAlertRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = alert.attempts >= alert.max_attempts;
  await getPostgresDatabase().query(
    exhausted
      ? `UPDATE rss_source_health_alerts
            SET state='dead', lease_owner=NULL, lease_expires_at=NULL,
                last_error=$2, updated_at=now()
          WHERE id=$1`
      : `UPDATE rss_source_health_alerts
            SET state='retry_wait', lease_owner=NULL, lease_expires_at=NULL,
                next_attempt_at=now() + ($3 || ' milliseconds')::interval,
                last_error=$2, updated_at=now()
          WHERE id=$1`,
    exhausted
      ? [alert.id, message.slice(0, 1000)]
      : [alert.id, message.slice(0, 1000), String(sourceAlertBackoffMs(alert.attempts))],
  );
}

export async function dispatchPendingRssSourceHealthAlerts(
  options: { sendFn?: typeof sendBarkRssSourceAlert } = {},
): Promise<number> {
  const alerts = await claimRssSourceHealthAlerts();
  const sendFn = options.sendFn ?? sendBarkRssSourceAlert;
  for (const alert of alerts) {
    try {
      await sendFn(alert);
      await markSourceAlertSent(alert.id);
      console.log(`🔔 RSS source Bark sent: source=${alert.source_id} ${alert.from_health}→${alert.to_health}`);
    } catch (error) {
      await markSourceAlertFailure(alert, error);
      console.warn(
        `⚠️ RSS source Bark failed: source=${alert.source_id} ${alert.from_health}→${alert.to_health}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return alerts.length;
}

async function sourceAlertLoop(): Promise<void> {
  try {
    await getPostgresDatabase().initialize();
  } catch (error) {
    console.warn('RSS source health alert worker DB readiness failed, continuing:', error instanceof Error ? error.message : error);
  }
  while (sourceAlertWorkerRunning) {
    try {
      await dispatchPendingRssSourceHealthAlerts();
    } catch (error) {
      console.error('RSS source health alert worker tick error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, SOURCE_ALERT_TICK_MS));
  }
}

export function startRssSourceHealthAlertWorker(): void {
  if (sourceAlertWorkerRunning) return;
  sourceAlertWorkerRunning = true;
  console.log(`🔔 RSS source health alert worker started (id=${SOURCE_ALERT_WORKER_ID}, configured=${isBarkAlertsConfigured()})`);
  sourceAlertLoop().catch((error) => console.error('RSS source health alert worker loop crash:', error));
}

export function stopRssSourceHealthAlertWorker(): void {
  sourceAlertWorkerRunning = false;
}

export async function listRssSourceHealth(executor: QueryExecutor = getPostgresDatabase()): Promise<RssSourceHealthSummary[]> {
  const result = await executor.query(
    `SELECT source_id, health, last_success_at, last_failure_at,
            consecutive_failures, last_error, outage_started_at
       FROM rss_source_runtime_state`,
  );
  const runtime = new Map<string, any>(result.rows.map((row: any) => [String(row.source_id), row]));
  return Object.values(getRssSourceRegistry()).map((source) => {
    const row = runtime.get(source.id);
    return {
      sourceId: source.id,
      name: source.name,
      profile: source.profile,
      health: (row?.health || 'unknown') as RssSourceHealth,
      consecutiveFailures: Number(row?.consecutive_failures || 0),
      lastSuccessAt: iso(row?.last_success_at),
      lastFailureAt: iso(row?.last_failure_at),
      outageStartedAt: iso(row?.outage_started_at),
      lastError: typeof row?.last_error === 'string' ? row.last_error : null,
      alertable: source.profile === 'core',
    };
  });
}
