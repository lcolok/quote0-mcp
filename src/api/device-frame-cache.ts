/**
 * 拉模式帧缓存（Phase A）。
 *
 * 为每台 display 类设备维护最新一帧的位图缓存。
 * 写入点（双点）：
 *  ① 登记投递时（enqueue）——保证板子失联期间帧也在更新；
 *  ② 推送成功后（worker）——确保缓存与真实推送一致。
 *
 * 选择说明见报告 pull-mode-server-phase-a-20260805.md。
 */

import { createHash } from 'crypto';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { crc32Hex } from './eink-converter.js';
import { notifyDeviceFrameUpdated } from './device-frame-watch.js';
import { withLegacyDisplayPermit } from './display-governor-ownership.js';
import { configuredGovernorDevices } from './display-governor-config.js';
import { authorizedFrame, type State } from './display-governor.js';

export interface DeviceFrame {
  device_id: string;
  frame_data: Buffer;
  frame_id: string;
  frame_crc32: string | null;
  width: number;
  height: number;
  plane_count: number;
  updated_at: Date;
}

export interface DeviceFrameRow {
  device_id: string;
  frame_data: Buffer | null;
  frame_id: string | null;
  frame_crc32: string | null;
  width: number;
  height: number;
  plane_count: number;
  updated_at: Date;
}

/** payload sha256 前 16 位 hex */
export function computeFrameId(bitmap: Buffer): string {
  return createHash('sha256').update(bitmap).digest('hex').slice(0, 16);
}

/**
 * 将渲染出的帧写入 device_frames（upsert）。
 * 用于 enqueue 环节（提前写帧）和 worker 推送成功后（落地最终帧）。
 */
export async function upsertDeviceFrame(params: {
  deviceId: string;
  bitmap: Buffer;
  width: number;
  height: number;
}): Promise<void> {
  const db = getPostgresDatabase();
  const frameId = computeFrameId(params.bitmap);
  const frameCrc32 = crc32Hex(params.bitmap);
  const planeCount = 1; // 当前只支持单平面

  const permit = await withLegacyDisplayPermit(params.deviceId, db.getPool(), client => client.query(
    `INSERT INTO device_frames (device_id, frame_data, frame_id, frame_crc32, width, height, plane_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (device_id)
     DO UPDATE SET frame_data = $2, frame_id = $3, frame_crc32 = $4, width = $5, height = $6,
                   plane_count = $7, updated_at = now()`,
    [params.deviceId, params.bitmap, frameId, frameCrc32, params.width, params.height, planeCount],
  ));
  if (!permit.permitted) return; // ordinary producers/workers cannot overwrite a governed frame

  // Long-poll wakeup is a delivery optimization, not part of frame durability.
  // The DB upsert is already committed; a transient LISTEN/NOTIFY failure must
  // never make the producer believe the frame itself was lost.
  notifyDeviceFrameUpdated(params.deviceId, frameId).catch((error) => {
    console.warn(
      `E-Ink frame notify failed device=${params.deviceId} frame=${frameId}:`,
      error instanceof Error ? error.message : error,
    );
  });
}

/**
 * 读取设备最新帧（无帧返回 null）。
 */
export async function getDeviceFrame(deviceId: string): Promise<DeviceFrameRow | null> {
  const db = getPostgresDatabase();
  const r = await db.getPool().query<DeviceFrameRow & { governor_state: State | null; now_ms: string }>(
    `SELECT f.device_id, f.frame_data, f.frame_id, f.frame_crc32, f.width, f.height, f.plane_count, f.updated_at,
            g.state AS governor_state, floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms
     FROM device_frames f LEFT JOIN display_governor_states g ON g.device_id=f.device_id
     WHERE f.device_id = $1`,
    [deviceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.governor_state) {
    const approved = authorizedFrame(row.governor_state, Number(row.now_ms));
    if (!approved || approved.frame.ref !== `pg-frame:${row.frame_id}`) return null;
  } else if (configuredGovernorDevices().includes(deviceId)) {
    return null; // enrollment/drain pending: never expose a stale legacy cache entry
  }
  return row;
}
