/**
 * Phase 1：为一条内容的每台目标设备创建一条持久化 delivery。
 *
 * consumer 从此不再物理推送，只负责「登记这轮该发给谁」。
 * 幂等的两道锁：
 *  ① UNIQUE (content_id, device_id, payload_version) + ON CONFLICT DO NOTHING
 *     → 同一轮次重复触发（scheduler 抖动 / 手动 trigger 撞车）不会生成第二条；
 *  ② payload_version = replay_count + 1
 *     → 复播是「新的一轮」，拿到新的 payload_version，因此会生成新的 delivery，
 *       而不是被①误判成重复。
 */

import { getEinkDevices } from './eink-converter.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';

export interface EnqueueDeliveriesInput {
  contentId: number;
  /** 取 content_inventory.replay_count；payload_version = 该值 + 1。 */
  replayCount: number;
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

export async function enqueueDeliveriesForContent(
  input: EnqueueDeliveriesInput,
): Promise<EnqueueDeliveriesResult> {
  const payloadVersion = (input.replayCount || 0) + 1;
  const devices = await getEinkDevices(
    input.deviceIds?.length ? { deviceIds: input.deviceIds } : {},
  );

  if (devices.length === 0) {
    return { payloadVersion, created: 0, targeted: 0, deviceIds: [] };
  }

  const db = getPostgresDatabase();
  let created = 0;
  for (const device of devices) {
    const r = await db.getPool().query(
      `INSERT INTO device_deliveries (content_id, device_id, render_target, payload_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_id, device_id, payload_version) DO NOTHING
       RETURNING id`,
      [input.contentId, device.id, renderTargetIdForDevice(device), payloadVersion],
    );
    if (r.rows.length > 0) created += 1;
  }

  return {
    payloadVersion,
    created,
    targeted: devices.length,
    deviceIds: devices.map((d) => d.id),
  };
}
