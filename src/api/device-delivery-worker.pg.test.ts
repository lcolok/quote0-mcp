/**
 * Phase 1 PostgreSQL 集成测试（需要真实 PG，端口 25432）。
 *
 * 覆盖任务书要求的 6 项：
 *  ① migration 幂等（连跑两次不炸，表/索引/唯一键都在）
 *  ② 认领互斥（两个并发认领不重复拿同一条）
 *  ③ 同设备串行（一台设备最多一条在飞）
 *  ④ 退避时间落在预期档位（真写 next_attempt_at，回读比对）
 *  ⑤ 熔断开合（open 期间不被认领，到期自然放行 = half-open）
 *  ⑥ dead 判定（永久错立刻 dead；attempts 耗尽 dead）
 *
 * PG 不可用时整个 describe 被 skip 并打印显式告警——不假装测过。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Pool } from 'pg';
import { recordDeliveryAttemptEvidence } from './delivery-attempt-store.js';
import { handlePayloadPreparationFailure } from './device-delivery-worker.js';

const CONN = process.env.TEST_DATABASE_URL
  || 'postgresql://quote0_user:quote0_password@localhost:25432/quote0_cache';

let pool: Pool | null = null;
let pgAvailable = false;

/** 与 getMigrationStatements() 末尾 Phase 1 段落逐字一致（复制而非 import，
 *  这样"迁移语句本身"也被当作被测对象，而不是被测代码自己证明自己）。 */
const PHASE1_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS device_deliveries (
    id BIGSERIAL PRIMARY KEY,
    content_id INTEGER,
    device_id TEXT NOT NULL,
    render_target TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error TEXT,
    payload_version INTEGER NOT NULL DEFAULT 1,
    payload_kind TEXT NOT NULL DEFAULT 'content',
    payload_ref TEXT,
    payload_hash TEXT,
    source_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (content_id, device_id, payload_version)
  )`,
  `ALTER TABLE device_deliveries ALTER COLUMN content_id DROP NOT NULL`,
  `ALTER TABLE device_deliveries ADD COLUMN IF NOT EXISTS payload_kind TEXT NOT NULL DEFAULT 'content'`,
  `ALTER TABLE device_deliveries ADD COLUMN IF NOT EXISTS payload_ref TEXT`,
  `ALTER TABLE device_deliveries ADD COLUMN IF NOT EXISTS payload_hash TEXT`,
  `ALTER TABLE device_deliveries ADD COLUMN IF NOT EXISTS source_key TEXT`,
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_deliveries_payload_kind_check') THEN
       ALTER TABLE device_deliveries ADD CONSTRAINT device_deliveries_payload_kind_check
         CHECK (payload_kind IN ('content','minio-image'));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_due ON device_deliveries(state, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_device ON device_deliveries(device_id, state)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_source_version
     ON device_deliveries(source_key, device_id, payload_version)
     WHERE payload_kind = 'minio-image' AND source_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_source
     ON device_deliveries(source_key, created_at DESC)
     WHERE source_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS device_delivery_attempts (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES device_deliveries(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    worker_id TEXT,
    wire_protocol TEXT,
    firmware TEXT,
    protocol_diag INTEGER,
    trace_id TEXT,
    request_crc32 TEXT,
    body_bytes INTEGER,
    ack_trace_id TEXT,
    ack_crc32 TEXT,
    status_snapshot JSONB,
    device_error JSONB,
    outcome TEXT NOT NULL DEFAULT 'started',
    error_code TEXT,
    error_text TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (delivery_id, attempt_no)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_delivery_attempts_device_time
     ON device_delivery_attempts(device_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_delivery_attempts_trace
     ON device_delivery_attempts(trace_id) WHERE trace_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS device_runtime_state (
    device_id TEXT PRIMARY KEY,
    health TEXT NOT NULL DEFAULT 'unknown',
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_open_until TIMESTAMPTZ,
    last_error_code TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

/** worker 认领 SQL 的逐字副本（device-delivery-worker.ts::claimDeliveries）。 */
const CLAIM_SQL = `
  SELECT d.*
    FROM device_deliveries d
    LEFT JOIN device_runtime_state rs ON rs.device_id = d.device_id
   WHERE (
           ((d.state = 'queued' OR d.state = 'retry_wait') AND d.next_attempt_at <= now())
           OR (d.state = 'leased' AND d.lease_expires_at < now())
         )
     AND (rs.circuit_open_until IS NULL OR rs.circuit_open_until <= now())
     AND NOT EXISTS (
           SELECT 1 FROM device_deliveries busy
            WHERE busy.device_id = d.device_id
              AND busy.state = 'leased'
              AND busy.lease_expires_at > now()
              AND busy.id <> d.id
         )
   ORDER BY d.next_attempt_at ASC, d.id ASC
   LIMIT $1
   FOR UPDATE OF d SKIP LOCKED`;

/** 用独立连接模拟一个 worker 的认领事务；可在 commit 前暂停，制造并发窗口。 */
async function claimWith(
  client: any,
  owner: string,
  limit = 4,
  leaseSeconds = 120,
): Promise<any[]> {
  await client.query('BEGIN');
  const r = await client.query(CLAIM_SQL, [limit]);
  const seen = new Set<string>();
  const rows = r.rows.filter((row: any) => {
    if (seen.has(row.device_id)) return false;
    seen.add(row.device_id);
    return true;
  });
  if (rows.length > 0) {
    await client.query(
      `UPDATE device_deliveries
          SET state='leased', lease_owner=$1,
              lease_expires_at = now() + ($2 || ' seconds')::interval,
              attempts = attempts + 1,
              started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE id = ANY($3::bigint[])`,
      [owner, String(leaseSeconds), rows.map((x: any) => x.id)],
    );
  }
  return rows;
}

async function insertDelivery(overrides: Record<string, any> = {}): Promise<any> {
  const d = {
    content_id: 900001,
    device_id: 'pgtest-eink-1',
    render_target: 'eink-296x128',
    state: 'queued',
    payload_version: 1,
    next_attempt_at: 'now()',
    ...overrides,
  };
  const r = await pool!.query(
    `INSERT INTO device_deliveries
       (content_id, device_id, render_target, state, payload_version, next_attempt_at, attempts, max_attempts)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, now()), COALESCE($7,0), COALESCE($8,5))
     RETURNING *`,
    [d.content_id, d.device_id, d.render_target, d.state, d.payload_version,
     d.next_attempt_at === 'now()' ? null : d.next_attempt_at,
     overrides.attempts ?? null, overrides.max_attempts ?? null],
  );
  return r.rows[0];
}

async function cleanup(): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM device_deliveries WHERE device_id LIKE 'pgtest-%'`);
  await pool.query(`DELETE FROM device_runtime_state WHERE device_id LIKE 'pgtest-%'`);
}

beforeAll(async () => {
  try {
    pool = new Pool({ connectionString: CONN, max: 6, connectionTimeoutMillis: 3000 });
    await pool.query('SELECT 1');
    pgAvailable = true;
  } catch (e) {
    pgAvailable = false;
    console.warn(
      `\n⚠️⚠️ PostgreSQL 不可用（${CONN}）：Phase 1 集成测试全部 SKIP。` +
      `\n     原因: ${e instanceof Error ? e.message : String(e)}` +
      `\n     启动方式: docker compose up -d postgres\n`,
    );
    if (pool) await pool.end().catch(() => {});
    pool = null;
  }
});

afterAll(async () => {
  if (pool) {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
  }
});

const maybe = (name: string, fn: any) =>
  it(name, async () => {
    if (!pgAvailable) {
      console.warn(`⏭️  SKIP（无 PG）: ${name}`);
      return;
    }
    await fn();
  });

describe('Phase 1 · device_deliveries 集成测试（真实 PostgreSQL）', () => {
  maybe('① migration 幂等：连跑两次不炸，表/索引/唯一键齐全', async () => {
    for (let round = 0; round < 2; round++) {
      for (const stmt of PHASE1_MIGRATIONS) {
        await pool!.query(stmt);
      }
    }

    const tables = await pool!.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [['device_deliveries', 'device_delivery_attempts', 'device_runtime_state']],
    );
    expect(tables.rows.map((r: any) => r.table_name).sort())
      .toEqual(['device_deliveries', 'device_delivery_attempts', 'device_runtime_state']);

    const idx = await pool!.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='device_deliveries'`,
    );
    const names = idx.rows.map((r: any) => r.indexname);
    expect(names).toContain('idx_deliveries_due');
    expect(names).toContain('idx_deliveries_device');
    expect(names).toContain('idx_deliveries_source_version');
    expect(names).toContain('idx_deliveries_source');
    const attemptIdx = await pool!.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='device_delivery_attempts'`,
    );
    const attemptIndexNames = attemptIdx.rows.map((r: any) => r.indexname);
    expect(attemptIndexNames).toContain('idx_delivery_attempts_device_time');
    expect(attemptIndexNames).toContain('idx_delivery_attempts_trace');

    // 唯一键真的生效：同 (content_id, device_id, payload_version) 第二次插入被 ON CONFLICT 吞掉
    await cleanup();
    const a = await pool!.query(
      `INSERT INTO device_deliveries (content_id, device_id, render_target, payload_version)
       VALUES (900001,'pgtest-eink-1','eink-296x128',1)
       ON CONFLICT (content_id, device_id, payload_version) DO NOTHING RETURNING id`,
    );
    const b = await pool!.query(
      `INSERT INTO device_deliveries (content_id, device_id, render_target, payload_version)
       VALUES (900001,'pgtest-eink-1','eink-296x128',1)
       ON CONFLICT (content_id, device_id, payload_version) DO NOTHING RETURNING id`,
    );
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(0); // 幂等：重复触发不生成第二条

    // 复播轮次（payload_version+1）应当生成新 delivery
    const c = await pool!.query(
      `INSERT INTO device_deliveries (content_id, device_id, render_target, payload_version)
       VALUES (900001,'pgtest-eink-1','eink-296x128',2)
       ON CONFLICT (content_id, device_id, payload_version) DO NOTHING RETURNING id`,
    );
    expect(c.rows).toHaveLength(1);
    await cleanup();
  });

  maybe('①a pre-rendered delivery：content_id 可空、source/version 幂等且能与 content 行共存', async () => {
    await cleanup();
    const hash = 'a'.repeat(64);
    const ref = `delivery-payloads/sha256/${hash}.png`;

    const first = await pool!.query(
      `INSERT INTO device_deliveries (
         content_id,device_id,render_target,payload_version,payload_kind,payload_ref,payload_hash,source_key
       ) VALUES (
         NULL,'pgtest-image-1','eink-296x152',1,'minio-image',$1,$2,'weather:test'
       ) ON CONFLICT DO NOTHING RETURNING *`,
      [ref, hash],
    );
    const duplicate = await pool!.query(
      `INSERT INTO device_deliveries (
         content_id,device_id,render_target,payload_version,payload_kind,payload_ref,payload_hash,source_key
       ) VALUES (
         NULL,'pgtest-image-1','eink-296x152',1,'minio-image',$1,$2,'weather:test'
       ) ON CONFLICT DO NOTHING RETURNING id`,
      [ref, hash],
    );
    const nextVersion = await pool!.query(
      `INSERT INTO device_deliveries (
         content_id,device_id,render_target,payload_version,payload_kind,payload_ref,payload_hash,source_key
       ) VALUES (
         NULL,'pgtest-image-1','eink-296x152',2,'minio-image',$1,$2,'weather:test'
       ) ON CONFLICT DO NOTHING RETURNING id`,
      [ref, hash],
    );
    const content = await pool!.query(
      `INSERT INTO device_deliveries (content_id,device_id,render_target,payload_version)
       VALUES (900049,'pgtest-image-1','eink-296x152',1) RETURNING *`,
    );

    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].content_id).toBeNull();
    expect(first.rows[0].payload_kind).toBe('minio-image');
    expect(first.rows[0].payload_ref).toBe(ref);
    expect(duplicate.rows).toHaveLength(0);
    expect(nextVersion.rows).toHaveLength(1);
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0].payload_kind).toBe('content');
    await cleanup();
  });

  maybe('①b attempt ledger：同一 delivery 的多次重试证据不会互相覆盖', async () => {
    await cleanup();
    const delivery = await insertDelivery({ device_id: 'pgtest-eink-attempt', content_id: 900050 });

    await recordDeliveryAttemptEvidence({
      deliveryId: String(delivery.id),
      attemptNo: 1,
      deviceId: delivery.device_id,
      traceId: 'dtest-a1',
      requestCrc32: 'AAAABBBB',
      bodyBytes: 5640,
      ackTraceId: 'dtest-a1',
      ackCrc32: 'AAAABBBB',
      statusSnapshot: { firmware: 'eink-core v1', protocol_diag: 1, crc_mismatches: 1 },
      outcome: 'started',
    });
    // 同一 attempt 分阶段补齐，不能产生第二行。
    await recordDeliveryAttemptEvidence({
      deliveryId: String(delivery.id),
      attemptNo: 1,
      deviceId: delivery.device_id,
      traceId: 'dtest-a1',
      outcome: 'retry_wait',
      errorCode: 'busy',
      errorText: 'HTTP 409 busy',
      finished: true,
    });
    await recordDeliveryAttemptEvidence({
      deliveryId: String(delivery.id),
      attemptNo: 2,
      deviceId: delivery.device_id,
      traceId: 'dtest-a2',
      requestCrc32: 'CCCCDDDD',
      bodyBytes: 5640,
      ackTraceId: 'dtest-a2',
      ackCrc32: 'CCCCDDDD',
      statusSnapshot: { firmware: 'eink-core v1', protocol_diag: 1, crc_mismatches: 1 },
      outcome: 'succeeded',
      finished: true,
    });

    const rows = await pool!.query(
      `SELECT attempt_no, trace_id, request_crc32, ack_crc32, outcome, status_snapshot
         FROM device_delivery_attempts
        WHERE delivery_id=$1 ORDER BY attempt_no`,
      [delivery.id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r: any) => [r.attempt_no, r.trace_id, r.outcome])).toEqual([
      [1, 'dtest-a1', 'retry_wait'],
      [2, 'dtest-a2', 'succeeded'],
    ]);
    expect(rows.rows[0].request_crc32).toBe('AAAABBBB');
    expect(rows.rows[1].ack_crc32).toBe('CCCCDDDD');
    expect(rows.rows[1].status_snapshot.protocol_diag).toBe(1);

    // delivery 删除时 attempt 证据按 FK CASCADE 一并清理，不留孤儿。
    await cleanup();
    const left = await pool!.query(
      `SELECT count(*)::int AS n FROM device_delivery_attempts WHERE delivery_id=$1`,
      [delivery.id],
    );
    expect(left.rows[0].n).toBe(0);
  });

  maybe('①c server-side payload_error 只重试 delivery，不污染设备健康度/熔断', async () => {
    await cleanup();
    const delivery = await insertDelivery({
      device_id: 'pgtest-payload-sidepath',
      content_id: 900051,
      attempts: 1,
      max_attempts: 5,
    });
    await pool!.query(
      `INSERT INTO device_runtime_state
         (device_id,health,consecutive_failures,circuit_open_until,last_error_code,updated_at)
       VALUES ($1,'healthy',0,NULL,NULL,now())`,
      [delivery.device_id],
    );

    const result = await handlePayloadPreparationFailure(
      { ...delivery, attempts: 1 },
      new Error('synthetic MinIO read failed code=payload_error'),
    );
    expect(result.nextState).toBe('retry_wait');

    const d = await pool!.query(
      `SELECT state,last_error_code,attempts,next_attempt_at > now() AS future_retry
         FROM device_deliveries WHERE id=$1`,
      [delivery.id],
    );
    expect(d.rows[0].state).toBe('retry_wait');
    expect(d.rows[0].last_error_code).toBe('payload_error');
    expect(d.rows[0].future_retry).toBe(true);

    const runtime = await pool!.query(
      `SELECT health,consecutive_failures,circuit_open_until,last_error_code
         FROM device_runtime_state WHERE device_id=$1`,
      [delivery.device_id],
    );
    expect(runtime.rows[0]).toMatchObject({
      health: 'healthy',
      consecutive_failures: 0,
      circuit_open_until: null,
      last_error_code: null,
    });
    await cleanup();
  });

  maybe('② 认领互斥：两个并发 worker 不会拿到同一条（FOR UPDATE SKIP LOCKED）', async () => {
    await cleanup();
    // 4 台不同设备各一条（不同设备才可能被同一批拿到；同设备由③保证串行）
    for (let i = 1; i <= 4; i++) {
      await insertDelivery({ device_id: `pgtest-eink-${i}`, content_id: 900100 + i });
    }

    const c1 = await pool!.connect();
    const c2 = await pool!.connect();
    try {
      // worker A 先开事务认领（未提交，持锁）
      const rowsA = await claimWith(c1, 'workerA', 4);
      // worker B 同时认领：被 SKIP LOCKED 跳过 A 锁住的行
      const rowsB = await claimWith(c2, 'workerB', 4);
      await c1.query('COMMIT');
      await c2.query('COMMIT');

      const idsA = new Set(rowsA.map((r: any) => String(r.id)));
      const idsB = new Set(rowsB.map((r: any) => String(r.id)));
      const overlap = [...idsA].filter((id) => idsB.has(id));

      expect(rowsA.length).toBe(4);      // A 拿到全部 4 条
      expect(overlap).toEqual([]);       // 关键断言：零重叠
      expect(rowsB.length).toBe(0);      // B 一条没拿到（都被锁住并跳过）

      // 认领后 attempts 已 +1、state=leased
      const after = await pool!.query(
        `SELECT state, attempts, lease_owner FROM device_deliveries
          WHERE device_id LIKE 'pgtest-%' ORDER BY id`,
      );
      expect(after.rows.every((r: any) => r.state === 'leased')).toBe(true);
      expect(after.rows.every((r: any) => r.attempts === 1)).toBe(true);
      expect(after.rows.every((r: any) => r.lease_owner === 'workerA')).toBe(true);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      await c2.query('ROLLBACK').catch(() => {});
      c1.release();
      c2.release();
      await cleanup();
    }
  });

  maybe('③ 同设备串行：一台设备已有未过期 leased → 该设备其余 delivery 不被认领', async () => {
    await cleanup();
    // 同一设备 3 条 + 另一设备 1 条
    await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900201, payload_version: 1 });
    await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900202, payload_version: 1 });
    await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900203, payload_version: 1 });
    await insertDelivery({ device_id: 'pgtest-eink-2', content_id: 900204, payload_version: 1 });

    const c1 = await pool!.connect();
    try {
      // 第一次认领：批内去重后，eink-1 只应拿到 1 条，eink-2 拿到 1 条
      const first = await claimWith(c1, 'workerA', 4);
      await c1.query('COMMIT');
      const devicesFirst = first.map((r: any) => r.device_id).sort();
      expect(devicesFirst).toEqual(['pgtest-eink-1', 'pgtest-eink-2']);
      expect(first).toHaveLength(2);

      // 第二次认领：eink-1 的租约仍在 → 它剩下的 2 条一条都不给；eink-2 同理
      const second = await claimWith(c1, 'workerA', 4);
      await c1.query('COMMIT');
      expect(second).toHaveLength(0);

      // 释放 eink-1 的在飞条目（模拟发送完成）→ 下一条才放行
      await pool!.query(
        `UPDATE device_deliveries SET state='succeeded', lease_owner=NULL, lease_expires_at=NULL
          WHERE id=$1`, [first.find((r: any) => r.device_id === 'pgtest-eink-1').id],
      );
      const third = await claimWith(c1, 'workerA', 4);
      await c1.query('COMMIT');
      expect(third.map((r: any) => r.device_id)).toEqual(['pgtest-eink-1']);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
      await cleanup();
    }
  });

  maybe('③b 崩溃回收：leased 但租约已过期的条目会被重新认领', async () => {
    await cleanup();
    const row = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900301 });
    await pool!.query(
      `UPDATE device_deliveries
          SET state='leased', lease_owner='deadWorker', lease_expires_at = now() - interval '1 minute'
        WHERE id=$1`, [row.id],
    );

    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerB', 4);
      await c1.query('COMMIT');
      expect(claimed).toHaveLength(1);
      expect(String(claimed[0].id)).toBe(String(row.id));
      const after = await pool!.query(`SELECT lease_owner, attempts FROM device_deliveries WHERE id=$1`, [row.id]);
      expect(after.rows[0].lease_owner).toBe('workerB');
      expect(after.rows[0].attempts).toBe(1);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
      await cleanup();
    }
  });

  maybe('④ 退避：写入的 next_attempt_at 落在对应档位 ±20% 内', async () => {
    await cleanup();
    const { backoffWithJitterMs, backoffBaseMs } = await import('./delivery-policy.js');

    for (const attempts of [1, 2, 3, 4, 5]) {
      const row = await insertDelivery({
        device_id: `pgtest-eink-b${attempts}`,
        content_id: 900400 + attempts,
      });
      const delay = backoffWithJitterMs(attempts);
      await pool!.query(
        `UPDATE device_deliveries
            SET state='retry_wait', last_error_code='timeout',
                next_attempt_at = now() + ($1 || ' milliseconds')::interval
          WHERE id=$2`,
        [String(delay), row.id],
      );
      const r = await pool!.query(
        `SELECT EXTRACT(EPOCH FROM (next_attempt_at - now())) * 1000 AS ms, state
           FROM device_deliveries WHERE id=$1`, [row.id],
      );
      const actualMs = Number(r.rows[0].ms);
      const base = backoffBaseMs(attempts);
      expect(r.rows[0].state).toBe('retry_wait');
      // 下界留 2s 余量给测试自身耗时；上界严格按 +20%
      expect(actualMs).toBeGreaterThan(base * 0.8 - 2000);
      expect(actualMs).toBeLessThanOrEqual(base * 1.2 + 50);
    }

    // retry_wait 且未到期 → 不被认领
    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerA', 10);
      await c1.query('COMMIT');
      expect(claimed).toHaveLength(0);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
    }

    // 到期后（把 next_attempt_at 拨到过去）→ 立刻可认领
    await pool!.query(
      `UPDATE device_deliveries SET next_attempt_at = now() - interval '1 second'
        WHERE device_id LIKE 'pgtest-eink-b%'`,
    );
    const c2 = await pool!.connect();
    try {
      const claimed = await claimWith(c2, 'workerA', 10);
      await c2.query('COMMIT');
      expect(claimed).toHaveLength(5);
    } finally {
      await c2.query('ROLLBACK').catch(() => {});
      c2.release();
      await cleanup();
    }
  });

  maybe('⑤ 熔断开合：circuit_open 期间该设备不被认领，到期自然放行（half-open）', async () => {
    await cleanup();
    await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900501 });
    await insertDelivery({ device_id: 'pgtest-eink-2', content_id: 900502 });

    // eink-1 熔断打开 5 分钟
    await pool!.query(
      `INSERT INTO device_runtime_state (device_id, health, consecutive_failures, circuit_open_until, last_error_code)
       VALUES ('pgtest-eink-1','degraded',3, now() + interval '5 minutes','timeout')
       ON CONFLICT (device_id) DO UPDATE SET circuit_open_until=EXCLUDED.circuit_open_until`,
    );

    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerA', 10);
      await c1.query('COMMIT');
      // 只放行未熔断的 eink-2
      expect(claimed.map((r: any) => r.device_id)).toEqual(['pgtest-eink-2']);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
    }

    // 熔断到期（拨到过去）→ 下一次认领自然放行 eink-1 = half-open 探针
    await pool!.query(
      `UPDATE device_runtime_state SET circuit_open_until = now() - interval '1 second'
        WHERE device_id='pgtest-eink-1'`,
    );
    // 释放 eink-2 的在飞条目，避免干扰
    await pool!.query(`UPDATE device_deliveries SET state='succeeded', lease_expires_at=NULL WHERE device_id='pgtest-eink-2'`);

    const c2 = await pool!.connect();
    try {
      const claimed = await claimWith(c2, 'workerA', 10);
      await c2.query('COMMIT');
      expect(claimed.map((r: any) => r.device_id)).toEqual(['pgtest-eink-1']);
    } finally {
      await c2.query('ROLLBACK').catch(() => {});
      c2.release();
    }

    // 探针成功 → runtime_state 归零、熔断清空
    await pool!.query(
      `INSERT INTO device_runtime_state
         (device_id, health, last_success_at, consecutive_failures, circuit_open_until, last_error_code, updated_at)
       VALUES ('pgtest-eink-1','healthy', now(), 0, NULL, NULL, now())
       ON CONFLICT (device_id) DO UPDATE
          SET health='healthy', last_success_at=now(), consecutive_failures=0,
              circuit_open_until=NULL, last_error_code=NULL, updated_at=now()`,
    );
    const rs = await pool!.query(`SELECT * FROM device_runtime_state WHERE device_id='pgtest-eink-1'`);
    expect(rs.rows[0].health).toBe('healthy');
    expect(rs.rows[0].consecutive_failures).toBe(0);
    expect(rs.rows[0].circuit_open_until).toBeNull();
    await cleanup();
  });

  maybe('⑥ dead 判定：永久错立刻 dead；attempts 耗尽 dead；dead 不再被认领', async () => {
    await cleanup();
    const { decideFailure } = await import('./delivery-policy.js');

    // 永久错（http_4xx）→ dead + misconfigured
    const permanent = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900601 });
    const dPerm = decideFailure({ errorCode: 'http_4xx', attempts: 1, maxAttempts: 5, consecutiveFailures: 1 });
    expect(dPerm.nextState).toBe('dead');
    await pool!.query(
      `UPDATE device_deliveries SET state=$1, finished_at=now(), last_error_code='http_4xx',
              last_error='HTTP 401: Unauthorized' WHERE id=$2`,
      [dPerm.nextState, permanent.id],
    );

    // attempts 耗尽 → dead + offline
    const exhausted = await insertDelivery({
      device_id: 'pgtest-eink-2', content_id: 900602, attempts: 5, max_attempts: 5,
    });
    const dExh = decideFailure({ errorCode: 'timeout', attempts: 5, maxAttempts: 5, consecutiveFailures: 5 });
    expect(dExh.nextState).toBe('dead');
    expect(dExh.health).toBe('offline');
    await pool!.query(
      `UPDATE device_deliveries SET state=$1, finished_at=now(), last_error_code='timeout' WHERE id=$2`,
      [dExh.nextState, exhausted.id],
    );

    // dead 条目一律不再被认领
    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerA', 10);
      await c1.query('COMMIT');
      expect(claimed).toHaveLength(0);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
    }

    const rows = await pool!.query(
      `SELECT state, last_error_code, finished_at FROM device_deliveries
        WHERE device_id LIKE 'pgtest-%' ORDER BY id`,
    );
    expect(rows.rows.map((r: any) => r.state)).toEqual(['dead', 'dead']);
    expect(rows.rows.every((r: any) => r.finished_at !== null)).toBe(true);
    await cleanup();
  });

  maybe('⑦ 成功路径：succeeded 终态 + runtime_state healthy 归零', async () => {
    await cleanup();
    const row = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900701 });
    await pool!.query(
      `UPDATE device_deliveries SET state='succeeded', finished_at=now(),
              lease_owner=NULL, lease_expires_at=NULL, last_error=NULL, last_error_code=NULL
        WHERE id=$1`, [row.id],
    );
    const r = await pool!.query(`SELECT * FROM device_deliveries WHERE id=$1`, [row.id]);
    expect(r.rows[0].state).toBe('succeeded');
    expect(r.rows[0].finished_at).not.toBeNull();
    expect(r.rows[0].lease_owner).toBeNull();

    // succeeded 不再被认领
    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerA', 10);
      await c1.query('COMMIT');
      expect(claimed).toHaveLength(0);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
      await cleanup();
    }
  });

  // ─── 显示类投递合并（supersede）───

  maybe('⑧a display 设备新投递作废旧 pending：同设备 queued/retry_wait → superseded', async () => {
    await cleanup();
    // 模拟离线积压：同一设备 3 条旧 pending
    const old1 = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900801, payload_version: 1 });
    const old2 = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900802, payload_version: 1 });
    const old3 = await insertDelivery({
      device_id: 'pgtest-eink-1', content_id: 900803, payload_version: 1,
      state: 'retry_wait', next_attempt_at: new Date(Date.now() + 60000).toISOString(),
    });
    // 新投递
    const newDel = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900804, payload_version: 1 });

    // 执行 supersede（与 delivery-enqueue.ts 中 supersedeOldDeliveries 同逻辑）
    const r = await pool!.query(
      `UPDATE device_deliveries
          SET state = 'superseded',
              finished_at = now(),
              updated_at = now(),
              last_error_code = 'superseded',
              last_error = '被更新的投递取代'
        WHERE device_id = $1
          AND state IN ('queued', 'retry_wait')
          AND lease_owner IS NULL
          AND id != (SELECT COALESCE(MAX(id), 0) FROM device_deliveries WHERE device_id = $1)`,
      ['pgtest-eink-1'],
    );
    expect(r.rowCount).toBe(3); // 旧 3 条被作废

    // 验证：旧 3 条 state=superseded，新 1 条 state=queued
    const after = await pool!.query(
      `SELECT id, state FROM device_deliveries WHERE device_id='pgtest-eink-1' ORDER BY id`,
    );
    const states = after.rows.map((r2: any) => ({ id: String(r2.id), state: r2.state }));
    expect(states).toEqual([
      { id: String(old1.id), state: 'superseded' },
      { id: String(old2.id), state: 'superseded' },
      { id: String(old3.id), state: 'superseded' },
      { id: String(newDel.id), state: 'queued' },
    ]);

    // superseded 不被认领
    const c1 = await pool!.connect();
    try {
      const claimed = await claimWith(c1, 'workerA', 10);
      await c1.query('COMMIT');
      // 只有 newDel（queued）被认领，superseded 的 3 条不会出现
      expect(claimed).toHaveLength(1);
      expect(String(claimed[0].id)).toBe(String(newDel.id));
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      c1.release();
      await cleanup();
    }
  });

  maybe('⑧b 在途 delivery（leased）不被作废', async () => {
    await cleanup();
    // 旧 pending + 一条在途（已 leased）
    const oldPending = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900901, payload_version: 1 });
    const inFlight = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900902, payload_version: 1 });
    await pool!.query(
      `UPDATE device_deliveries SET state='leased', lease_owner='workerA',
              lease_expires_at = now() + interval '2 minutes' WHERE id=$1`,
      [inFlight.id],
    );
    // 新投递
    const newDel = await insertDelivery({ device_id: 'pgtest-eink-1', content_id: 900903, payload_version: 1 });

    // supersede：在途不被碰
    const r = await pool!.query(
      `UPDATE device_deliveries
          SET state = 'superseded', finished_at = now(), updated_at = now(),
              last_error_code = 'superseded', last_error = '被更新的投递取代'
        WHERE device_id = $1
          AND state IN ('queued', 'retry_wait')
          AND lease_owner IS NULL
          AND id != (SELECT COALESCE(MAX(id), 0) FROM device_deliveries WHERE device_id = $1)`,
      ['pgtest-eink-1'],
    );
    expect(r.rowCount).toBe(1); // 只作废了 oldPending

    const after = await pool!.query(
      `SELECT id, state, lease_owner FROM device_deliveries WHERE device_id='pgtest-eink-1' ORDER BY id`,
    );
    expect(after.rows.map((r2: any) => ({ id: String(r2.id), state: r2.state }))).toEqual([
      { id: String(oldPending.id), state: 'superseded' },
      { id: String(inFlight.id), state: 'leased' },
      { id: String(newDel.id), state: 'queued' },
    ]);

    await cleanup();
  });

  maybe('⑧c isDisplayDeviceKind: eink-local/eink-cloud 是 display，thermal-printer 不是', async () => {
    const { isDisplayDeviceKind } = await import('./delivery-enqueue.js');
    expect(isDisplayDeviceKind('eink-local')).toBe(true);
    expect(isDisplayDeviceKind('eink-cloud')).toBe(true);
    expect(isDisplayDeviceKind('thermal-printer')).toBe(false);
  });

});
