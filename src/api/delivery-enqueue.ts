/**
 * Phase 1：为一条内容的每台目标设备创建一条持久化 delivery。
 *
 * consumer 从此不再物理推送，只负责「登记这轮该发给谁」。
 * 幂等的两道锁：
 *  ① 每台设备的 payload_version 取自 DB 中该 (content_id, device_id) 已有的最大值 +1，
 *     而不是内存里的 replay_count，避免 replay_count 被重置后回头踩旧版本；
 *  ② UNIQUE (content_id, device_id, payload_version) + ON CONFLICT DO NOTHING
 *     → 同一轮次重复触发（scheduler 抖动 / 手动 trigger 撞车 / 并发race）不会生成第二条。
 *
 * 显示类设备（display）投递合并：登记新 delivery 时作废同设备旧的 pending 投递。
 * 这样断线数小时后重连的设备不会逐条排空历史积压（曾在 eink-2 上产生 259 条、
 * 连续闪屏 ~1h 的事故），只收到最新一帧。
 * 打印类设备（print）保持逐条投递——每条都必须送达。
 */

import { getEinkDevices, pngTo1BitBitmap, type EinkDevice } from './eink-converter.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { upsertDeviceFrame } from './device-frame-cache.js';
import { loadContent } from './device-delivery-worker.js';
import { createEinkTarget } from '../react-widgets/core/render-targets.js';
import { renderSingleEinkTarget } from './target-aware-eink.js';
import { readFile } from 'node:fs/promises';
import { persistDeliveryPngPayload } from './delivery-payload-store.js';

export interface EnqueueDeliveriesInput {
  contentId: number;
  /** 限定目标设备；不传则取全部已启用的 eink-local 设备（与 Phase 0 同一取数口径）。 */
  deviceIds?: string[];
}

export interface EnqueueDeliveriesResult {
  payloadVersion: number;
  /** 本次真正插入的 delivery 数（ON CONFLICT 命中的不计）。 */
  created: number;
  /** 本次覆盖到的目标设备总数（含因幂等未插入的）。 */
  targeted: number;
  deviceIds: string[];
}

export interface EnqueuePreRenderedImageInput {
  /** 业务源身份，不含版本；例如 weather:<job-id> / memo:<memo-id>。 */
  sourceKey: string;
  /** 已完成业务版式的 PNG；enqueue 会写入内容寻址的 MinIO delivery snapshot。 */
  pngBuffer: Buffer;
  /** 限定目标设备；不传则取全部已启用 eink-local。 */
  deviceIds?: string[];
}

export interface EnqueuePreRenderedImageResult extends EnqueueDeliveriesResult {
  payloadRef?: string;
  payloadHash?: string;
}

/**
 * render_target 用登记规格推导（`eink-<w>x<h>`），不在 consumer 里探 /status。
 *
 * 这是刻意的：consumer 是「登记者」，探测设备是 worker 的职责。
 * 若设备运行时规格与登记不同，worker 会用 resolveEinkDeviceSpecWithStatus 的
 * 真值重新渲染，render_target 字段仅作为同 tick 渲染缓存的分组键与观测标签。
 */
export function renderTargetIdForDevice(device: { width: number; height: number }): string {
  return `eink-${device.width}x${device.height}`;
}

/**
 * 显示类设备判定：kind 映射。
 * eink-local / eink-cloud → display, thermal-printer → print。
 * 选用 kind 而非 capabilities 的原因：getEnabledPushDevices 返回的字段不含 capabilities，
 * 增加查询会增加复杂度，而 kind 已能准确区分设备类型。
 */
export function isDisplayDeviceKind(kind: string): boolean {
  return kind === 'eink-local' || kind === 'eink-cloud';
}

/**
 * 作废同设备旧的 pending delivery（显示类投递合并）。
 * 只碰 state IN ('queued','retry_wait') AND lease_owner IS NULL 的条目：
 *  - 在途（已认领、持有租约）不动——worker 正在处理
 *  - 已终态（succeeded/dead/superseded）不动
 *  - 保留最新一条（id 最大），不作废自己刚插的行
 */
async function supersedeOldDeliveries(deviceId: string): Promise<number> {
  const db = getPostgresDatabase();
  const r = await db.getPool().query(
    `UPDATE device_deliveries
        SET state = 'superseded',
            finished_at = now(),
            updated_at = now(),
            last_error_code = 'superseded',
            last_error = '被更新的投递取代'
      WHERE device_id = $1
        AND state IN ('queued', 'retry_wait')
        AND lease_owner IS NULL
        AND id != (
          SELECT COALESCE(MAX(id), 0) FROM device_deliveries
           WHERE device_id = $1
        )`,
    [deviceId],
  );
  return r.rowCount ?? 0;
}

function normalizeSourceKey(sourceKey: string): string {
  const normalized = sourceKey.trim();
  if (!normalized || normalized.length > 256 || /[\u0000\r\n]/.test(normalized)) {
    throw new Error('delivery sourceKey 非法');
  }
  return normalized;
}

/** 把一张已渲染 PNG 按各设备几何转 1-bit 后写进 pull 帧缓存（直推路径也要调用，否则 pull 会用旧帧覆盖刚推的内容）。 */
export async function writeFramesFromPngBuffer(devices: EinkDevice[], pngBuffer: Buffer): Promise<void> {
  for (const device of devices) {
    try {
      const bitmap = await pngTo1BitBitmap(pngBuffer, device.width, device.height);
      await upsertDeviceFrame({
        deviceId: device.id,
        bitmap,
        width: device.width,
        height: device.height,
      });
    } catch (e) {
      console.warn(`⚠️ 设备 ${device.id} enqueue 帧写入失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function enqueueDeliveriesForContent(
  input: EnqueueDeliveriesInput,
): Promise<EnqueueDeliveriesResult> {
  const devices = await getEinkDevices(
    input.deviceIds?.length ? { deviceIds: input.deviceIds } : {},
  );

  if (devices.length === 0) {
    return { payloadVersion: 0, created: 0, targeted: 0, deviceIds: [] };
  }

  const db = getPostgresDatabase();
  let created = 0;
  let maxPayloadVersion = 0;
  /** 本批实际新增 delivery 的设备（ON CONFLICT 命中的不算）。 */
  const supersededDevices = new Set<string>();
  for (const device of devices) {
    // 每台设备独立从 DB 取真实最大 payload_version，避免 replayCount 重置导致撞约束。
    const versionResult = await db.getPool().query(
      `SELECT COALESCE(MAX(payload_version), 0) + 1 AS next_version
       FROM device_deliveries
       WHERE content_id = $1 AND device_id = $2`,
      [input.contentId, device.id],
    );
    const payloadVersion = versionResult.rows[0]?.next_version || 1;
    maxPayloadVersion = Math.max(maxPayloadVersion, payloadVersion);

    const r = await db.getPool().query(
      `INSERT INTO device_deliveries (content_id, device_id, render_target, payload_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_id, device_id, payload_version) DO NOTHING
       RETURNING id`,
      [input.contentId, device.id, renderTargetIdForDevice(device), payloadVersion],
    );
    if (r.rows.length > 0) {
      created += 1;
      supersededDevices.add(device.id);
    }
  }

  // 显示类设备投递合并：新 delivery 落库后作废旧 pending
  let superseded = 0;
  for (const deviceId of supersededDevices) {
    superseded += await supersedeOldDeliveries(deviceId);
  }
  if (superseded > 0) {
    console.log(
      `🧹 投递合并: ${superseded} 条旧 pending 被作废，` +
      `设备=[${[...supersededDevices].join(', ')}]`
    );
  }

  // ── 拉模式 Phase A：登记投递时即写帧缓存（保证板子失联期间帧也在更新）──
  // 按设备 unique target 分组，每组渲染一次，再为组内每台设备 convert + upsert。
  try {
    const content = await loadContent(input.contentId);
    const targetGroups = new Map<string, EinkDevice[]>();
    for (const device of devices) {
      const key = `${device.width}x${device.height}`;
      const group = targetGroups.get(key);
      if (group) {
        group.push(device);
      } else {
        targetGroups.set(key, [device]);
      }
    }
    for (const [, group] of targetGroups) {
      const refDevice = group[0];
      const target = createEinkTarget(refDevice.width, refDevice.height);
      try {
        const rendered = await renderSingleEinkTarget(content, target);
        if (!rendered.localImagePath) continue;
        const pngBuffer = await readFile(rendered.localImagePath);
        for (const device of group) {
          try {
            const bitmap = await pngTo1BitBitmap(pngBuffer, device.width, device.height);
            await upsertDeviceFrame({
              deviceId: device.id,
              bitmap,
              width: device.width,
              height: device.height,
            });
          } catch (e) {
            console.warn(`⚠️ 设备 ${device.id} enqueue 帧写入失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ target ${target.id} enqueue 渲染失败，跳过帧写入: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    // enqueue 帧写入失败不阻断投递登记
    console.warn(`⚠️ enqueue 帧写入失败（投递已登记）: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    payloadVersion: maxPayloadVersion,
    created,
    targeted: devices.length,
    deviceIds: devices.map((d) => d.id),
  };
}

/**
 * 把已经完成业务版式的 PNG 纳入 Phase 1 持久 delivery。
 *
 * 与 content delivery 的区别只有 payload 来源：
 * - content：worker 从 content_inventory 重新按 runtime RenderTarget 排版；
 * - minio-image：enqueue 先把字节保存成 SHA-256 内容寻址快照，worker 重试时读取同一字节。
 *
 * 两种 delivery 共享同一套 per-device lease / retry / circuit / supersede / attempt ledger。
 */
export async function enqueuePreRenderedImageDeliveries(
  input: EnqueuePreRenderedImageInput,
): Promise<EnqueuePreRenderedImageResult> {
  const sourceKey = normalizeSourceKey(input.sourceKey);
  const devices = await getEinkDevices(
    input.deviceIds?.length ? { deviceIds: input.deviceIds } : {},
  );
  if (devices.length === 0) {
    return { payloadVersion: 0, created: 0, targeted: 0, deviceIds: [] };
  }

  // 先确保不可变 payload 已落 MinIO，再写 delivery；禁止制造“队列有任务但 payload 不存在”的必死行。
  const payload = await persistDeliveryPngPayload(input.pngBuffer);
  const db = getPostgresDatabase();
  let created = 0;
  let maxPayloadVersion = 0;
  const supersededDevices = new Set<string>();

  for (const device of devices) {
    const versionResult = await db.getPool().query(
      `SELECT COALESCE(MAX(payload_version), 0) + 1 AS next_version
         FROM device_deliveries
        WHERE source_key = $1
          AND device_id = $2
          AND payload_kind = 'minio-image'`,
      [sourceKey, device.id],
    );
    const payloadVersion = Number(versionResult.rows[0]?.next_version ?? 1);
    maxPayloadVersion = Math.max(maxPayloadVersion, payloadVersion);

    const r = await db.getPool().query(
      `INSERT INTO device_deliveries (
         content_id, device_id, render_target, payload_version,
         payload_kind, payload_ref, payload_hash, source_key
       ) VALUES (
         NULL, $1, $2, $3,
         'minio-image', $4, $5, $6
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        device.id,
        renderTargetIdForDevice(device),
        payloadVersion,
        payload.objectKey,
        payload.sha256,
        sourceKey,
      ],
    );
    if (r.rows.length > 0) {
      created += 1;
      supersededDevices.add(device.id);
    }
  }

  // 显示类统一遵循“只保留最新待显示帧”；正在 leased 的条目仍不碰。
  let superseded = 0;
  for (const deviceId of supersededDevices) {
    superseded += await supersedeOldDeliveries(deviceId);
  }
  if (superseded > 0) {
    console.log(
      `🧹 预渲染投递合并: ${superseded} 条旧 pending 被作废，` +
      `source=${sourceKey} 设备=[${[...supersededDevices].join(', ')}]`,
    );
  }

  // pull-mode frame cache 也立即更新；失败只是旁路告警，delivery 本身已经安全持久化。
  try {
    await writeFramesFromPngBuffer(devices, input.pngBuffer);
  } catch (error) {
    console.warn(
      `⚠️ 预渲染 enqueue 帧写入失败（投递已登记）: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    payloadVersion: maxPayloadVersion,
    created,
    targeted: devices.length,
    deviceIds: devices.map((device) => device.id),
    payloadRef: payload.objectKey,
    payloadHash: payload.sha256,
  };
}
