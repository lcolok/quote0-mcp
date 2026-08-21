import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybe = TEST_DATABASE_URL ? it : it.skip;
let pool: Pool | null = null;
let sourceHealth: typeof import('./rss-source-health.js');

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.BARK_ALERTS_ENABLED = 'true';
  process.env.BARK_DEVICE_KEY = 'pg-test-key';
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rss_source_runtime_state (
      source_id TEXT PRIMARY KEY,
      health TEXT NOT NULL DEFAULT 'unknown',
      last_success_at TIMESTAMPTZ,
      last_failure_at TIMESTAMPTZ,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      outage_started_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rss_source_health_alerts (
      id BIGSERIAL PRIMARY KEY,
      source_id TEXT NOT NULL,
      from_health TEXT NOT NULL,
      to_health TEXT NOT NULL,
      alert_kind TEXT NOT NULL,
      level TEXT NOT NULL,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      outage_started_at TIMESTAMPTZ,
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
    CREATE INDEX IF NOT EXISTS idx_rss_source_health_alerts_due
      ON rss_source_health_alerts(state, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_rss_source_health_alerts_source_time
      ON rss_source_health_alerts(source_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_source_health_alerts_one_pending_target
      ON rss_source_health_alerts(source_id, to_health)
      WHERE state IN ('pending','leased','retry_wait');
  `);
  sourceHealth = await import('./rss-source-health.js?pg=' + Date.now());
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM rss_source_health_alerts WHERE source_id LIKE 'pg-rss-%'`);
  await pool.query(`DELETE FROM rss_source_runtime_state WHERE source_id LIKE 'pg-rss-%'`);
  await pool.end();
});

describe('RSS source health outbox · real PostgreSQL', () => {
  maybe('threshold failure → one degraded incident → success recovery, all persisted atomically', async () => {
    const sourceId = 'pg-rss-solidot';
    const db = { query: (sql: string, params?: any[]) => pool!.query(sql, params) };

    let inserted = await sourceHealth.recordRssSourceFailure(db, {
      sourceId,
      consecutiveFailures: 1,
      threshold: 3,
      reason: 'timeout-1',
      observedAt: new Date('2026-08-21T09:00:00Z'),
    });
    expect(inserted).toBe(false);

    let state = await pool!.query(
      `SELECT health, consecutive_failures, last_error, outage_started_at
         FROM rss_source_runtime_state WHERE source_id=$1`,
      [sourceId],
    );
    expect(state.rows[0]).toMatchObject({
      health: 'unknown',
      consecutive_failures: 1,
      last_error: 'timeout-1',
      outage_started_at: null,
    });

    inserted = await sourceHealth.recordRssSourceFailure(db, {
      sourceId,
      consecutiveFailures: 3,
      threshold: 3,
      reason: 'timeout-3',
      observedAt: new Date('2026-08-21T09:20:00Z'),
    });
    // pg-rss-* is intentionally not a registry core source, so transition persists
    // but no notification is produced. Use real solidot below to assert the outbox path.
    expect(inserted).toBe(false);
    state = await pool!.query(
      `SELECT health, consecutive_failures, last_error, outage_started_at
         FROM rss_source_runtime_state WHERE source_id=$1`,
      [sourceId],
    );
    expect(state.rows[0].health).toBe('degraded');
    expect(state.rows[0].consecutive_failures).toBe(3);
    expect(state.rows[0].last_error).toBe('timeout-3');
    expect(state.rows[0].outage_started_at).not.toBeNull();

    // Use a real core source id to exercise the atomic outbox transition.
    await pool!.query(`DELETE FROM rss_source_health_alerts WHERE source_id='solidot'`);
    await pool!.query(`DELETE FROM rss_source_runtime_state WHERE source_id='solidot'`);
    inserted = await sourceHealth.recordRssSourceFailure(db, {
      sourceId: 'solidot',
      consecutiveFailures: 3,
      threshold: 3,
      reason: 'Request timed out after 8000ms',
      observedAt: new Date('2026-08-21T09:30:00Z'),
    });
    expect(inserted).toBe(true);

    // Repeated failures remain the same incident and must not enqueue another pending outage.
    inserted = await sourceHealth.recordRssSourceFailure(db, {
      sourceId: 'solidot',
      consecutiveFailures: 4,
      threshold: 3,
      reason: 'Request timed out after 8000ms',
      observedAt: new Date('2026-08-21T09:40:00Z'),
    });
    expect(inserted).toBe(false);

    let alerts = await pool!.query(
      `SELECT alert_kind, from_health, to_health, state, consecutive_failures
         FROM rss_source_health_alerts WHERE source_id='solidot' ORDER BY id`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]).toMatchObject({
      alert_kind: 'outage',
      from_health: 'unknown',
      to_health: 'degraded',
      state: 'pending',
      consecutive_failures: 3,
    });

    inserted = await sourceHealth.recordRssSourceSuccess(
      db,
      'solidot',
      new Date('2026-08-21T10:00:00Z'),
    );
    expect(inserted).toBe(true);

    state = await pool!.query(
      `SELECT health, consecutive_failures, last_error, outage_started_at, last_success_at
         FROM rss_source_runtime_state WHERE source_id='solidot'`,
    );
    expect(state.rows[0].health).toBe('healthy');
    expect(state.rows[0].consecutive_failures).toBe(0);
    expect(state.rows[0].last_error).toBeNull();
    expect(state.rows[0].outage_started_at).toBeNull();
    expect(state.rows[0].last_success_at).not.toBeNull();

    alerts = await pool!.query(
      `SELECT alert_kind, from_health, to_health, state
         FROM rss_source_health_alerts WHERE source_id='solidot' ORDER BY id`,
    );
    expect(alerts.rows).toHaveLength(2);
    expect(alerts.rows[1]).toMatchObject({
      alert_kind: 'recovery',
      from_health: 'degraded',
      to_health: 'healthy',
      state: 'pending',
    });

    await pool!.query(`DELETE FROM rss_source_health_alerts WHERE source_id='solidot'`);
    await pool!.query(`DELETE FROM rss_source_runtime_state WHERE source_id='solidot'`);
  });
});
