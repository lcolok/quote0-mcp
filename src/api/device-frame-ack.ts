/**
 * Persistent application-level ACK for cloud-pulled E-Ink frames.
 *
 * HTTP 200 only proves that bytes reached the device. A display ACK is written
 * after the panel refresh completes, with the device-computed CRC32. When the
 * ACK still refers to the server's current latest frame, the CRC is verified
 * against the exact bitmap bytes in device_frames.
 */

import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { crc32Hex } from './eink-converter.js';
import { getDeviceFrame } from './device-frame-cache.js';
import type { DisplayAckPayload } from './eink-pull-protocol.js';

export interface RecordedDisplayAck {
  deviceId: string;
  frameId: string;
  serverFrameId: string | null;
  currentMatch: boolean;
  crcVerified: boolean | null;
  ackedAt: Date;
}

export async function recordDisplayAck(deviceId: string, ack: DisplayAckPayload): Promise<RecordedDisplayAck> {
  const frame = await getDeviceFrame(deviceId);
  const serverFrameId = frame?.frame_id ?? null;
  const currentMatch = Boolean(serverFrameId && serverFrameId === ack.frameId);

  let crcVerified: boolean | null = null;
  if (currentMatch && frame?.frame_data) {
    const expectedCrc = (frame.frame_crc32 || crc32Hex(frame.frame_data)).toLowerCase();
    crcVerified = expectedCrc === ack.crc32;
  }

  const db = getPostgresDatabase();
  const r = await db.getPool().query<{ acked_at: Date }>(
    `INSERT INTO device_frame_acks
       (device_id, frame_id, frame_crc32, result, refresh_ms, firmware, rssi, free_heap,
        current_match, crc_verified, acked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (device_id, frame_id)
     DO UPDATE SET frame_crc32 = EXCLUDED.frame_crc32,
                   result = EXCLUDED.result,
                   refresh_ms = EXCLUDED.refresh_ms,
                   firmware = EXCLUDED.firmware,
                   rssi = EXCLUDED.rssi,
                   free_heap = EXCLUDED.free_heap,
                   current_match = EXCLUDED.current_match,
                   crc_verified = EXCLUDED.crc_verified,
                   acked_at = now()
     RETURNING acked_at`,
    [
      deviceId,
      ack.frameId,
      ack.crc32,
      ack.result,
      ack.refreshMs ?? null,
      ack.firmware ?? null,
      ack.rssi ?? null,
      ack.freeHeap ?? null,
      currentMatch,
      crcVerified,
    ],
  );

  return {
    deviceId,
    frameId: ack.frameId,
    serverFrameId,
    currentMatch,
    crcVerified,
    ackedAt: r.rows[0]?.acked_at ?? new Date(),
  };
}

export async function getLatestDisplayAck(deviceId: string): Promise<Record<string, unknown> | null> {
  const r = await getPostgresDatabase().getPool().query(
    `SELECT device_id, frame_id, frame_crc32, result, refresh_ms, firmware, rssi, free_heap,
            current_match, crc_verified, acked_at
       FROM device_frame_acks
      WHERE device_id = $1
      ORDER BY acked_at DESC
      LIMIT 1`,
    [deviceId],
  );
  return r.rows[0] ?? null;
}
