import { hostname } from 'node:os';
import type { PoolClient } from 'pg';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { DeviceHealth } from './delivery-policy.js';
import type { PushErrorCode } from './push-results.js';

export type DeviceAlertKind = 'warning' | 'critical' | 'recovery';
export type DeviceAlertLevel = 'info' | 'warning' | 'critical';
export type DeviceAlertState = 'pending' | 'leased' | 'retry_wait' | 'sent' | 'dead' | 'skipped';

export interface DeviceHealthTransition {
  deviceId: string;
  fromHealth: DeviceHealth;
  toHealth: DeviceHealth;
  errorCode?: PushErrorCode | null;
  consecutiveFailures?: number;
}

export interface DeviceHealthAlertRow {
  id: string;
  device_id: string;
  from_health: DeviceHealth;
  to_health: DeviceHealth;
  alert_kind: DeviceAlertKind;
  level: DeviceAlertLevel;
  error_code: string | null;
  consecutive_failures: number;
  state: DeviceAlertState;
  attempts: number;
  max_attempts: number;
}

const ALERT_WORKER_ID = `${hostname()}:${process.pid}:bark:${crypto.randomUUID().slice(0, 8)}`;
const ALERT_TICK_MS = 30_000;
const ALERT_LEASE_SECONDS = 60;
const ALERT_BATCH_SIZE = 4;
const ALERT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
let alertWorkerRunning = false;

/**
 * 只对“恶化”和“完全恢复”发通知。
 * offline/misconfigured → degraded 仍未恢复，避免为了中间态制造噪声。
 */
export function classifyDeviceHealthTransition(
  fromHealth: DeviceHealth,
  toHealth: DeviceHealth,
): { kind: DeviceAlertKind; level: DeviceAlertLevel } | null {
  if (fromHealth === toHealth) return null;

  const unhealthy = new Set<DeviceHealth>(['degraded', 'offline', 'misconfigured']);
  if (toHealth === 'healthy' && unhealthy.has(fromHealth)) {
    return { kind: 'recovery', level: 'info' };
  }
  if (toHealth === 'offline' || toHealth === 'misconfigured') {
    if (fromHealth === 'offline' || fromHealth === 'misconfigured') return null;
    return { kind: 'critical', level: 'critical' };
  }
  if (toHealth === 'degraded' && (fromHealth === 'healthy' || fromHealth === 'unknown')) {
    return { kind: 'warning', level: 'warning' };
  }
  return null;
}

function barkDeviceKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.BARK_DEVICE_KEY?.trim();
  if (!key || key === '<set-via-lazycat-console>') return null;
  const enabled = (env.BARK_ALERTS_ENABLED ?? 'true').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(enabled)) return null;
  return key;
}

export function isBarkAlertsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return barkDeviceKey(env) !== null;
}

export function formatDeviceHealthAlert(transition: DeviceHealthTransition): {
  kind: DeviceAlertKind;
  level: DeviceAlertLevel;
  title: string;
  body: string;
} | null {
  const classified = classifyDeviceHealthTransition(transition.fromHealth, transition.toHealth);
  if (!classified) return null;

  const prefix = classified.kind === 'recovery'
    ? '✅ E-Ink 设备恢复'
    : classified.kind === 'critical'
      ? '🚨 E-Ink 设备异常'
      : '⚠️ E-Ink 设备降级';
  const details = [
    `device=${transition.deviceId}`,
    `${transition.fromHealth}→${transition.toHealth}`,
    transition.errorCode ? `code=${transition.errorCode}` : null,
    transition.consecutiveFailures !== undefined
      ? `failures=${transition.consecutiveFailures}`
      : null,
  ].filter(Boolean).join(' · ');

  return { ...classified, title: prefix, body: details };
}

/**
 * 健康状态更新事务内调用。只有 meaningful transition 才落 outbox。
 * 若 Bark 未配置，仍记录 skipped 事件，便于证明“为什么没通知”；不会积压陈旧 pending。
 * pending/leased/retry_wait 对同一 device+target health 有唯一索引，天然防重复排队。
 */
export async function enqueueDeviceHealthTransition(
  client: Pick<PoolClient, 'query'>,
  transition: DeviceHealthTransition,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const formatted = formatDeviceHealthAlert(transition);
  if (!formatted) return false;

  const configured = isBarkAlertsConfigured(env);
  const state: DeviceAlertState = configured ? 'pending' : 'skipped';
  const lastError = configured ? null : 'Bark disabled or BARK_DEVICE_KEY not configured';
  const result = await client.query(
    `INSERT INTO device_health_alerts (
       device_id, from_health, to_health, alert_kind, level,
       error_code, consecutive_failures, state, last_error, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      transition.deviceId,
      transition.fromHealth,
      transition.toHealth,
      formatted.kind,
      formatted.level,
      transition.errorCode ?? null,
      transition.consecutiveFailures ?? 0,
      state,
      lastError,
    ],
  );
  return result.rowCount === 1;
}

function alertBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1) - 1, ALERT_BACKOFF_MS.length - 1);
  return ALERT_BACKOFF_MS[index];
}

export async function sendBarkDeviceAlert(
  alert: Pick<DeviceHealthAlertRow,
    'device_id' | 'from_health' | 'to_health' | 'alert_kind' | 'level' | 'error_code' | 'consecutive_failures'>,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const key = barkDeviceKey(env);
  if (!key) throw new Error('Bark disabled or BARK_DEVICE_KEY not configured');

  const formatted = formatDeviceHealthAlert({
    deviceId: alert.device_id,
    fromHealth: alert.from_health,
    toHealth: alert.to_health,
    errorCode: (alert.error_code as PushErrorCode | null) ?? undefined,
    consecutiveFailures: alert.consecutive_failures,
  });
  if (!formatted) throw new Error('alert transition is not notifiable');

  const base = (env.BARK_BASE || 'https://bark.logic.heiyu.space').replace(/\/+$/, '');
  const group = env.BARK_GROUP || 'quote0-eink';
  const params = new URLSearchParams({
    title: formatted.title,
    body: formatted.body,
    group,
  });
  if (formatted.level !== 'info') params.set('level', formatted.level);
  if (formatted.level === 'critical') params.set('volume', '5');

  const response = await (options.fetchFn ?? fetch)(`${base}/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new Error(`Bark HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { code?: number } | null;
    if (typeof payload?.code === 'number' && payload.code !== 200) {
      throw new Error(`Bark response code ${payload.code}`);
    }
  }
}

export async function claimDeviceHealthAlerts(limit = ALERT_BATCH_SIZE): Promise<DeviceHealthAlertRow[]> {
  const pool = getPostgresDatabase().getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT a.id
         FROM device_health_alerts a
        WHERE (
          (a.state IN ('pending','retry_wait') AND a.next_attempt_at <= now())
          OR (a.state='leased' AND a.lease_expires_at < now())
        )
          AND NOT EXISTS (
            SELECT 1
              FROM device_health_alerts older
             WHERE older.device_id = a.device_id
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
      `UPDATE device_health_alerts
          SET state='leased', attempts=attempts+1,
              lease_owner=$2, lease_expires_at=now() + ($3 || ' seconds')::interval,
              updated_at=now()
        WHERE id = ANY($1::bigint[])
        RETURNING *`,
      [ids, ALERT_WORKER_ID, String(ALERT_LEASE_SECONDS)],
    );
    await client.query('COMMIT');
    return claimed.rows as DeviceHealthAlertRow[];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markAlertSent(id: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE device_health_alerts
        SET state='sent', sent_at=now(), lease_owner=NULL, lease_expires_at=NULL,
            last_error=NULL, updated_at=now()
      WHERE id=$1`,
    [id],
  );
}

async function markAlertFailure(alert: DeviceHealthAlertRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = alert.attempts >= alert.max_attempts;
  await getPostgresDatabase().getPool().query(
    exhausted
      ? `UPDATE device_health_alerts
            SET state='dead', lease_owner=NULL, lease_expires_at=NULL,
                last_error=$2, updated_at=now()
          WHERE id=$1`
      : `UPDATE device_health_alerts
            SET state='retry_wait', lease_owner=NULL, lease_expires_at=NULL,
                next_attempt_at=now() + ($3 || ' milliseconds')::interval,
                last_error=$2, updated_at=now()
          WHERE id=$1`,
    exhausted
      ? [alert.id, message.slice(0, 1000)]
      : [alert.id, message.slice(0, 1000), String(alertBackoffMs(alert.attempts))],
  );
}

export async function dispatchPendingDeviceHealthAlerts(
  options: { sendFn?: typeof sendBarkDeviceAlert } = {},
): Promise<number> {
  const alerts = await claimDeviceHealthAlerts();
  const sendFn = options.sendFn ?? sendBarkDeviceAlert;
  for (const alert of alerts) {
    try {
      await sendFn(alert);
      await markAlertSent(alert.id);
      console.log(`🔔 device health Bark sent: device=${alert.device_id} ${alert.from_health}→${alert.to_health}`);
    } catch (error) {
      await markAlertFailure(alert, error);
      console.warn(
        `⚠️ device health Bark failed: device=${alert.device_id} ${alert.from_health}→${alert.to_health}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return alerts.length;
}

async function alertLoop(): Promise<void> {
  try {
    await getPostgresDatabase().initialize();
  } catch (error) {
    console.warn('device health alert worker DB readiness failed, continuing:', error instanceof Error ? error.message : error);
  }
  while (alertWorkerRunning) {
    try {
      await dispatchPendingDeviceHealthAlerts();
    } catch (error) {
      console.error('device health alert worker tick error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, ALERT_TICK_MS));
  }
}

export function startDeviceHealthAlertWorker(): void {
  if (alertWorkerRunning) return;
  alertWorkerRunning = true;
  console.log(`🔔 device health alert worker started (id=${ALERT_WORKER_ID}, configured=${isBarkAlertsConfigured()})`);
  alertLoop().catch((error) => console.error('device health alert worker loop crash:', error));
}

export function stopDeviceHealthAlertWorker(): void {
  alertWorkerRunning = false;
}
