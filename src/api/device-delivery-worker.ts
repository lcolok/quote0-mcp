/**
 * Phase 1 持久化投递 worker。
 *
 * 第一性原理：投递是「每台设备一件独立的事」，不是「一次广播」。
 * Phase 0 把一次推送拆成了 N 个独立成败，但仍然是当轮推完即忘——
 * 离线设备错过的内容永远不补。Phase 1 把每台设备的投递落成一行
 * device_deliveries，于是它天然获得：幂等（唯一键）、可重试（退避）、
 * 可隔离（熔断）、可观测（状态机 + 错误归因）。
 *
 * 队列就是 PostgreSQL：认领用 FOR UPDATE SKIP LOCKED + lease，
 * 崩溃恢复靠 lease_expires_at 过期回收，与 label-jobs-worker 同一套模式。
 */

import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { renderSingleEinkTarget } from './target-aware-eink.js';
import {
  getEinkDevices,
  resolveEinkDeviceSpecWithStatus,
  pngTo1BitBitmap,
  pushToEinkDevice,
  type EinkDevice,
} from './eink-converter.js';
import { createEinkTarget } from '../react-widgets/core/render-targets.js';
import { classifyPushError, type PushErrorCode } from './push-results.js';
import { decideFailure, dedupeByDevice } from './delivery-policy.js';

const WORKER_ID = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const TICK_MS = 5000;
/** 租约时长。发送最坏是 5s /status + 30s push，120s 留足冗余。 */
export const LEASE_TTL_SECONDS = 120;
/** 心跳续租间隔 = 租约的 1/3（与 label-jobs-worker 一致）。 */
const HEARTBEAT_MS = (LEASE_TTL_SECONDS / 3) * 1000;
/** 单次认领批量上限。 */
export const CLAIM_BATCH_SIZE = 4;

let running = false;

export interface DeliveryRow {
  id: string;
  content_id: number;
  device_id: string;
  render_target: string;
  state: string;
  attempts: number;
  max_attempts: number;
  payload_version: number;
}

export function startDeviceDeliveryWorker(): void {
  if (running) return;
  running = true;
  console.log(`📮 device-delivery worker started (id=${WORKER_ID})`);
  loop().catch((e) => console.error('device-delivery worker loop crash:', e));
}

export function stopDeviceDeliveryWorker(): void {
  running = false;
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const claimed = await claimDeliveries();
      if (claimed.length === 0) {
        // 无到期任务：本 tick 只花了一次轻查询（走 idx_deliveries_due），直接睡。
        await sleep(TICK_MS);
        continue;
      }
      await executeBatch(claimed);
    } catch (e) {
      console.error('device-delivery worker tick error:', e);
      await sleep(TICK_MS);
    }
  }
}

/**
 * 认领到期 delivery。单条 SQL 完成三重过滤：
 *  ① 到期：queued/retry_wait 且 next_attempt_at <= now()，或 leased 但租约已过期（崩溃回收）
 *  ② 熔断门：设备 circuit_open_until > now() 的一律不认领。
 *     熔断到期后下一次认领自然放行 = half-open 探针，不需要额外状态位。
 *  ③ 同设备串行：排除「另有一条 leased 且租约未过期」的设备，保证一台设备最多一条在飞。
 * SKIP LOCKED 保证多 worker 并发认领不会拿到同一行。
 */
export async function claimDeliveries(limit = CLAIM_BATCH_SIZE): Promise<DeliveryRow[]> {
  const pool = getPostgresDatabase().getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT d.*
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
        FOR UPDATE OF d SKIP LOCKED`,
      [limit],
    );

    // 同一批 SELECT 里仍可能有多行指向同一台设备（SQL 的 NOT EXISTS 只挡得住
    // 已 leased 的），批内再去一次重，一设备只留一条，其余留到下一 tick。
    const rows = dedupeByDevice(r.rows as DeliveryRow[]);
    if (rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    await client.query(
      `UPDATE device_deliveries
          SET state = 'leased',
              lease_owner = $1,
              lease_expires_at = now() + ($2 || ' seconds')::interval,
              attempts = attempts + 1,
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE id = ANY($3::bigint[])`,
      [WORKER_ID, String(LEASE_TTL_SECONDS), rows.map((row) => row.id)],
    );
    await client.query('COMMIT');
    return rows.map((row) => ({ ...row, attempts: Number(row.attempts) + 1 }));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function renewLeases(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getPostgresDatabase().getPool().query(
    `UPDATE device_deliveries
        SET lease_expires_at = now() + ($1 || ' seconds')::interval, updated_at = now()
      WHERE id = ANY($2::bigint[]) AND lease_owner = $3`,
    [String(LEASE_TTL_SECONDS), ids, WORKER_ID],
  );
}

/**
 * 执行一批已认领的 delivery。
 * 同 tick 内按 (content_id, render_target) 缓存渲染结果：同规格设备共享一张 PNG，
 * 避免同一条内容在同一批里被排版 N 次。
 */
async function executeBatch(deliveries: DeliveryRow[]): Promise<void> {
  const heartbeat = setInterval(() => {
    renewLeases(deliveries.map((d) => d.id)).catch((e) => console.warn('delivery lease renew failed:', e));
  }, HEARTBEAT_MS);

  const renderCache = new Map<string, Promise<string>>();
  try {
    // 逐条串行执行：批量上限 4，每条对应不同设备（已去重），
    // 串行的代价是最坏 4×35s，换来的是渲染缓存命中简单且日志顺序可读。
    for (const delivery of deliveries) {
      await executeDelivery(delivery, renderCache);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeDelivery(
  delivery: DeliveryRow,
  renderCache: Map<string, Promise<string>>,
): Promise<void> {
  try {
    // 1. 查设备（复用 Phase 0 的 deviceIds 过滤能力）
    const devices = await getEinkDevices({ deviceIds: [delivery.device_id] });
    const device = devices.find((d) => d.id === delivery.device_id);
    if (!device) {
      // 设备已被下线/删除：这是配置事实，不是暂时性故障，重试没有意义。
      await markDead(delivery, 'spec_mismatch', `设备不存在或已停用: ${delivery.device_id}`);
      await recordRuntimeFailure(delivery.device_id, 'spec_mismatch', 'misconfigured', null);
      return;
    }

    // 2. 解析运行时规格 —— 本次投递唯一一次 /status 探测，快照随发送一路传下去。
    const { device: resolvedDevice, status } = await resolveEinkDeviceSpecWithStatus(device);

    // 3. 渲染（同 tick 内按 content_id + render_target 复用）
    const cacheKey = `${delivery.content_id}:${delivery.render_target}`;
    let pngPath = renderCache.get(cacheKey);
    if (!pngPath) {
      pngPath = renderContentForTarget(delivery, resolvedDevice);
      renderCache.set(cacheKey, pngPath);
    }
    const localImagePath = await pngPath;

    // 4. 物理发送
    const pngBuffer = await readFile(localImagePath);
    const bitmap = await pngTo1BitBitmap(pngBuffer, resolvedDevice.width, resolvedDevice.height);
    const result = await pushToEinkDevice(resolvedDevice, bitmap, { statusSnapshot: status });
    if (!result.ok) throw new Error(result.error || '设备推送失败（无错误信息）');

    await markSucceeded(delivery);
    await recordRuntimeSuccess(delivery.device_id);
    console.log(
      `✅ delivery ${delivery.id} 成功: content=${delivery.content_id} device=${delivery.device_id} ` +
      `target=${delivery.render_target} attempt=${delivery.attempts}/${delivery.max_attempts}`,
    );
  } catch (error) {
    await handleFailure(delivery, error);
  }
}

/** 渲染缓存 miss 时真正排版。返回本地 PNG 路径。 */
async function renderContentForTarget(delivery: DeliveryRow, device: EinkDevice): Promise<string> {
  const content = await loadContent(delivery.content_id);
  const target = createEinkTarget(device.width, device.height);
  const rendered = await renderSingleEinkTarget(content, target);
  if (!rendered.localImagePath) {
    throw new Error(`渲染未产出本地 PNG: content=${delivery.content_id} target=${target.id}`);
  }
  return rendered.localImagePath;
}

/**
 * 从 content_inventory 取出可渲染内容。
 * 字段映射与 news-scheduler consumer 原路径保持一致（同一组 fallback 链），
 * 保证 worker 渲染出的版面与 Phase 0 同步路径一致。
 */
export async function loadContent(contentId: number): Promise<any> {
  const r = await getPostgresDatabase().getPool().query(
    `SELECT * FROM content_inventory WHERE id = $1`,
    [contentId],
  );
  const item = r.rows[0];
  if (!item) throw new Error(`content_inventory ${contentId} 不存在`);
  return buildRenderableFromInventory(item);
}

/** 纯映射：inventory 行 → RenderableDataItem。与 consumer 原有映射逐字段一致。 */
export function buildRenderableFromInventory(item: any): any {
  const raw = item.raw_content || {};
  const processed = item.processed_content || {};
  return {
    id: String(item.id),
    title: processed.title || item.title || raw.title || '未知标题',
    message: processed.message || processed.summary || raw.description || raw.content || '',
    signature: processed.signature || 'RSS智能',
    source: processed.source || item.source || raw.source || 'unknown',
    publishTime: processed.publishTime || raw.publishTime || new Date().toISOString(),
    category: processed.category || item.category || raw.category || '新闻',
    link: processed.link || item.link || raw.link,
  };
}

async function handleFailure(delivery: DeliveryRow, error: unknown): Promise<void> {
  const errorCode = classifyPushError(error);
  const message = error instanceof Error ? error.message : String(error);

  // 先把连续失败次数记上，判决要用到它（熔断/健康度阈值）。
  const consecutiveFailures = await bumpConsecutiveFailures(delivery.device_id);
  const decision = decideFailure({
    errorCode,
    attempts: delivery.attempts,
    maxAttempts: delivery.max_attempts,
    consecutiveFailures,
  });

  if (decision.nextState === 'dead') {
    await markDead(delivery, errorCode, message);
  } else {
    await markRetryWait(delivery, errorCode, message, decision.retryDelayMs!);
  }
  await recordRuntimeFailure(delivery.device_id, errorCode, decision.health, decision.circuitOpenMs);

  console.warn(
    `⚠️ delivery ${delivery.id} 失败(${decision.reason}): device=${delivery.device_id} ` +
    `code=${errorCode} attempt=${delivery.attempts}/${delivery.max_attempts} ` +
    `next=${decision.nextState}${decision.retryDelayMs !== null ? ` in ${Math.round(decision.retryDelayMs / 1000)}s` : ''} ` +
    `consecutiveFailures=${consecutiveFailures} error=${message}`,
  );
}

async function markSucceeded(delivery: DeliveryRow): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE device_deliveries
        SET state='succeeded', finished_at=now(), updated_at=now(),
            lease_owner=NULL, lease_expires_at=NULL,
            last_error=NULL, last_error_code=NULL
      WHERE id=$1`,
    [delivery.id],
  );
}

async function markDead(delivery: DeliveryRow, code: PushErrorCode, err: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE device_deliveries
        SET state='dead', finished_at=now(), updated_at=now(),
            lease_owner=NULL, lease_expires_at=NULL,
            last_error_code=$1, last_error=$2
      WHERE id=$3`,
    [code, err.slice(0, 1000), delivery.id],
  );
}

async function markRetryWait(
  delivery: DeliveryRow,
  code: PushErrorCode,
  err: string,
  delayMs: number,
): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE device_deliveries
        SET state='retry_wait', updated_at=now(),
            lease_owner=NULL, lease_expires_at=NULL,
            next_attempt_at = now() + ($1 || ' milliseconds')::interval,
            last_error_code=$2, last_error=$3
      WHERE id=$4`,
    [String(Math.round(delayMs)), code, err.slice(0, 1000), delivery.id],
  );
}

/** 失败即 +1 并返回新值。UPSERT 保证首次失败也能建行。 */
async function bumpConsecutiveFailures(deviceId: string): Promise<number> {
  const r = await getPostgresDatabase().getPool().query(
    `INSERT INTO device_runtime_state (device_id, consecutive_failures, last_failure_at, updated_at)
     VALUES ($1, 1, now(), now())
     ON CONFLICT (device_id) DO UPDATE
        SET consecutive_failures = device_runtime_state.consecutive_failures + 1,
            last_failure_at = now(),
            updated_at = now()
     RETURNING consecutive_failures`,
    [deviceId],
  );
  return Number(r.rows[0]?.consecutive_failures ?? 1);
}

async function recordRuntimeFailure(
  deviceId: string,
  code: PushErrorCode,
  health: string,
  circuitOpenMs: number | null,
): Promise<void> {
  // health='unknown' 表示「本次判决不改变健康度」（失败次数还没到降级阈值），
  // 此时保留既有 health，避免把一台 healthy 设备的一次抖动直接抹成 unknown。
  await getPostgresDatabase().getPool().query(
    `UPDATE device_runtime_state
        SET health = CASE WHEN $2 = 'unknown' THEN health ELSE $2 END,
            last_error_code = $3,
            circuit_open_until = CASE
              WHEN $4::bigint IS NULL THEN circuit_open_until
              ELSE now() + ($4 || ' milliseconds')::interval
            END,
            updated_at = now()
      WHERE device_id = $1`,
    [deviceId, health, code, circuitOpenMs === null ? null : String(Math.round(circuitOpenMs))],
  );
}

async function recordRuntimeSuccess(deviceId: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `INSERT INTO device_runtime_state
       (device_id, health, last_success_at, consecutive_failures, circuit_open_until, last_error_code, updated_at)
     VALUES ($1, 'healthy', now(), 0, NULL, NULL, now())
     ON CONFLICT (device_id) DO UPDATE
        SET health='healthy',
            last_success_at=now(),
            consecutive_failures=0,
            circuit_open_until=NULL,
            last_error_code=NULL,
            updated_at=now()`,
    [deviceId],
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
