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

export interface DeviceFrame {
  device_id: string;
  frame_data: Buffer;
  frame_id: string;
  width: number;
  height: number;
  plane_count: number;
  updated_at: Date;
}

export interface DeviceFrameRow {
  device_id: string;
  frame_data: Buffer | null;
  frame_id: string | null;
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
  const planeCount = 1; // 当前只支持单平面

  await db.getPool().query(
    `INSERT INTO device_frames (device_id, frame_data, frame_id, width, height, plane_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (device_id)
     DO UPDATE SET frame_data = $2, frame_id = $3, width = $4, height = $5,
                   plane_count = $6, updated_at = now()`,
    [params.deviceId, params.bitmap, frameId, params.width, params.height, planeCount],
  );
}

/**
 * 读取设备最新帧（无帧返回 null）。
 */
export async function getDeviceFrame(deviceId: string): Promise<DeviceFrameRow | null> {
  const db = getPostgresDatabase();
  const r = await db.getPool().query(
    `SELECT device_id, frame_data, frame_id, width, height, plane_count, updated_at
     FROM device_frames WHERE device_id = $1`,
    [deviceId],
  );
  if (r.rows.length === 0) return null;
  return r.rows[0];
}
