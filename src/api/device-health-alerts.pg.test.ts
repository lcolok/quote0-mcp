import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybe = TEST_DATABASE_URL ? it : it.skip;
let pool: Pool | null = null;
let alerts: typeof import('./device-health-alerts.js');
let deliveryWorker: typeof import('./device-delivery-worker.js');

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.BARK_ALERTS_ENABLED = 'true';
  process.env.BARK_DEVICE_KEY = 'pg-test-key';
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_runtime_state (
      device_id TEXT PRIMARY KEY,
      health TEXT NOT NULL DEFAULT 'unknown',
      last_success_at TIMESTAMPTZ,
      last_failure_at TIMESTAMPTZ,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      circuit_open_until TIMESTAMPTZ,
      last_error_code TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS device_health_alerts (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      from_health TEXT NOT NULL,
      to_health TEXT NOT NULL,
      alert_kind TEXT NOT NULL,
      level TEXT NOT NULL,
      error_code TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_device_health_alerts_due
      ON device_health_alerts(state, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_device_health_alerts_device_time
      ON device_health_alerts(device_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_health_alerts_one_pending_target
      ON device_health_alerts(device_id, to_health)
      WHERE state IN ('pending','leased','retry_wait');
  `);
  alerts = await import('./device-health-alerts.js?pg=' + Date.now());
  deliveryWorker = await import('./device-delivery-worker.js?pg=' + Date.now());
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM device_health_alerts WHERE device_id LIKE 'pg-alert-%'`);
  await pool.query(`DELETE FROM device_runtime_state WHERE device_id LIKE 'pg-alert-%'`);
  await pool.end();
});

describe('device health alert outbox · real PostgreSQL', () => {
  maybe('meaningful transition 入队；同 target pending 去重；recovery 独立成对', async () => {
    const client = await pool!.connect();
    try {
      let inserted = await alerts.enqueueDeviceHealthTransition(client, {
        deviceId: 'pg-alert-eink-2',
        fromHealth: 'healthy',
        toHealth: 'degraded',
        errorCode: 'connection',
        consecutiveFailures: 3,
      });
      expect(inserted).toBe(true);

      inserted = await alerts.enqueueDeviceHealthTransition(client, {
        deviceId: 'pg-alert-eink-2',
        fromHealth: 'healthy',
        toHealth: 'degraded',
        errorCode: 'connection',
        consecutiveFailures: 4,
      });
      expect(inserted).toBe(false);

      inserted = await alerts.enqueueDeviceHealthTransition(client, {
        deviceId: 'pg-alert-eink-2',
        fromHealth: 'degraded',
        toHealth: 'healthy',
        errorCode: 'connection',
        consecutiveFailures: 3,
      });
      expect(inserted).toBe(true);
    } finally {
      client.release();
    }

    const rows = await pool!.query(
      `SELECT from_health,to_health,alert_kind,level,state
         FROM device_health_alerts WHERE device_id='pg-alert-eink-2' ORDER BY id`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      from_health: 'healthy', to_health: 'degraded', alert_kind: 'warning', level: 'warning', state: 'pending',
    });
    expect(rows.rows[1]).toMatchObject({
      from_health: 'degraded', to_health: 'healthy', alert_kind: 'recovery', level: 'info', state: 'pending',
    });
  });

  maybe('未配置 Bark 时直接记 skipped，不制造永远发不掉的 pending', async () => {
    const client = await pool!.connect();
    try {
      const inserted = await alerts.enqueueDeviceHealthTransition(client, {
        deviceId: 'pg-alert-disabled',
        fromHealth: 'healthy',
        toHealth: 'offline',
        errorCode: 'timeout',
        consecutiveFailures: 5,
      }, {
        BARK_ALERTS_ENABLED: 'true',
        BARK_DEVICE_KEY: '<set-via-lazycat-console>',
      });
      expect(inserted).toBe(true);
    } finally {
      client.release();
    }
    const row = await pool!.query(
      `SELECT state,last_error FROM device_health_alerts WHERE device_id='pg-alert-disabled'`,
    );
    expect(row.rows[0].state).toBe('skipped');
    expect(row.rows[0].last_error).toContain('not configured');
  });

  maybe('claim 使用 lease + attempts，并保持同设备事件严格串行', async () => {
    const claimed = await alerts.claimDeviceHealthAlerts(10);
    const ours = claimed.filter((row) => row.device_id.startsWith('pg-alert-'));
    expect(ours.length).toBeGreaterThanOrEqual(1);
    expect(ours.every((row) => row.state === 'leased' && row.attempts === 1)).toBe(true);
    expect(new Set(ours.map((row) => row.device_id)).size).toBe(ours.length);

    // pg-alert-eink-2 同时有 warning + recovery，第一条 leased 时 recovery 必须仍 pending，不能倒序发送。
    const paired = await pool!.query(
      `SELECT to_health,state,attempts FROM device_health_alerts
        WHERE device_id='pg-alert-eink-2' ORDER BY id`,
    );
    expect(paired.rows).toHaveLength(2);
    expect(paired.rows[0]).toMatchObject({ to_health: 'degraded', state: 'leased', attempts: 1 });
    expect(paired.rows[1]).toMatchObject({ to_health: 'healthy', state: 'pending', attempts: 0 });

    const second = await alerts.claimDeviceHealthAlerts(10);
    expect(second.filter((row) => row.device_id.startsWith('pg-alert-'))).toHaveLength(0);
  });

  maybe('runtime 状态迁移与 outbox 同事务：degraded→offline→healthy 只产生三条有意义事件', async () => {
    await pool!.query(
      `INSERT INTO device_runtime_state (device_id,health,consecutive_failures)
       VALUES ('pg-alert-runtime','healthy',0)`,
    );

    await deliveryWorker.recordRuntimeFailure('pg-alert-runtime', 'connection', 'degraded', 300_000, 3);
    await deliveryWorker.recordRuntimeFailure('pg-alert-runtime', 'connection', 'degraded', 300_000, 4);
    await deliveryWorker.recordRuntimeFailure('pg-alert-runtime', 'timeout', 'offline', 300_000, 5);
    await deliveryWorker.recordRuntimeSuccess('pg-alert-runtime');

    const runtime = await pool!.query(
      `SELECT health,consecutive_failures,last_error_code FROM device_runtime_state WHERE device_id='pg-alert-runtime'`,
    );
    expect(runtime.rows[0]).toMatchObject({ health: 'healthy', consecutive_failures: 0, last_error_code: null });

    const rows = await pool!.query(
      `SELECT from_health,to_health,alert_kind,level,error_code,state
         FROM device_health_alerts WHERE device_id='pg-alert-runtime' ORDER BY id`,
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.map((row: any) => [row.from_health, row.to_health, row.alert_kind, row.level])).toEqual([
      ['healthy', 'degraded', 'warning', 'warning'],
      ['degraded', 'offline', 'critical', 'critical'],
      ['offline', 'healthy', 'recovery', 'info'],
    ]);
    expect(rows.rows[2].error_code).toBe('timeout');
  });

  maybe('alert outbox SQL 故障不会回滚 runtime health（SAVEPOINT 旁路保护）', async () => {
    await pool!.query(
      `INSERT INTO device_runtime_state (device_id,health,consecutive_failures)
       VALUES ('pg-alert-sidepath','healthy',2)`,
    );
    await pool!.query(`ALTER TABLE device_health_alerts RENAME TO device_health_alerts_broken`);
    try {
      await expect(
        deliveryWorker.recordRuntimeFailure('pg-alert-sidepath', 'connection', 'degraded', 300_000, 3),
      ).resolves.toBeUndefined();
      const runtime = await pool!.query(
        `SELECT health,consecutive_failures,last_error_code FROM device_runtime_state WHERE device_id='pg-alert-sidepath'`,
      );
      expect(runtime.rows[0]).toMatchObject({
        health: 'degraded',
        consecutive_failures: 3,
        last_error_code: 'connection',
      });
    } finally {
      await pool!.query(`ALTER TABLE device_health_alerts_broken RENAME TO device_health_alerts`);
    }
  });

  maybe('dispatcher 发送失败进入 retry_wait；到期后成功发送并标 sent', async () => {
    const client = await pool!.connect();
    try {
      await alerts.enqueueDeviceHealthTransition(client, {
        deviceId: 'pg-alert-retry',
        fromHealth: 'healthy',
        toHealth: 'degraded',
        errorCode: 'timeout',
        consecutiveFailures: 3,
      });
    } finally {
      client.release();
    }

    await alerts.dispatchPendingDeviceHealthAlerts({
      sendFn: async () => { throw new Error('synthetic Bark outage'); },
    });
    let row = await pool!.query(
      `SELECT state,attempts,last_error,next_attempt_at > now() AS in_future
         FROM device_health_alerts WHERE device_id='pg-alert-retry'`,
    );
    expect(row.rows[0]).toMatchObject({ state: 'retry_wait', attempts: 1, in_future: true });
    expect(row.rows[0].last_error).toContain('synthetic Bark outage');

    await pool!.query(
      `UPDATE device_health_alerts SET next_attempt_at=now() - interval '1 second'
        WHERE device_id='pg-alert-retry'`,
    );
    await alerts.dispatchPendingDeviceHealthAlerts({ sendFn: async () => {} });
    row = await pool!.query(
      `SELECT state,attempts,sent_at IS NOT NULL AS sent FROM device_health_alerts WHERE device_id='pg-alert-retry'`,
    );
    expect(row.rows[0]).toMatchObject({ state: 'sent', attempts: 2, sent: true });
  });
});
