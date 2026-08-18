/**
 * Pure protocol helpers for Quote0 E-Ink cloud pull v2.
 * Kept dependency-free so malformed public requests are rejected before any DB
 * work and the contract can be unit-tested without starting the API server.
 */

// LazyCat ingress currently closes upstream requests at ~10.3s. Keep a
// deliberate safety margin: event delivery remains immediate via NOTIFY; this
// cap only controls how often an unchanged device renews its waiting request.
export const DEFAULT_LONG_POLL_WAIT_SEC = 8;
export const MAX_LONG_POLL_WAIT_SEC = 8;

export function parseLongPollWaitMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0; // legacy immediate GET
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_LONG_POLL_WAIT_SEC, value) * 1000;
}

export type DisplayAckResult = 'displayed' | 'failed';

export interface DisplayAckPayload {
  frameId: string;
  crc32: string;
  result: DisplayAckResult;
  refreshMs?: number;
  firmware?: string;
  rssi?: number;
  freeHeap?: number;
}

export interface DisplayAckParseResult {
  ok: boolean;
  value?: DisplayAckPayload;
  error?: string;
}

function finiteInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.trunc(n);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

export function parseDisplayAckPayload(input: unknown): DisplayAckParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'body 必须是 JSON object' };
  }
  const body = input as Record<string, unknown>;
  const frameId = typeof body.frame_id === 'string' ? body.frame_id.trim().toLowerCase() : '';
  const crc32 = typeof body.crc32 === 'string' ? body.crc32.trim().toLowerCase() : '';
  const result = body.result;

  if (!/^[0-9a-f]{16}$/.test(frameId)) return { ok: false, error: 'frame_id 必须是 16 位 hex' };
  if (!/^[0-9a-f]{8}$/.test(crc32)) return { ok: false, error: 'crc32 必须是 8 位 hex' };
  if (result !== 'displayed' && result !== 'failed') {
    return { ok: false, error: 'result 必须是 displayed 或 failed' };
  }

  const refreshMs = finiteInt(body.refresh_ms, 0, 120_000);
  if (body.refresh_ms !== undefined && refreshMs === undefined) {
    return { ok: false, error: 'refresh_ms 超出范围' };
  }
  const rssi = finiteInt(body.rssi, -127, 0);
  if (body.rssi !== undefined && rssi === undefined) return { ok: false, error: 'rssi 超出范围' };
  const freeHeap = finiteInt(body.free_heap, 0, 16 * 1024 * 1024);
  if (body.free_heap !== undefined && freeHeap === undefined) {
    return { ok: false, error: 'free_heap 超出范围' };
  }
  const firmware = typeof body.firmware === 'string' ? body.firmware.trim().slice(0, 96) : undefined;

  return {
    ok: true,
    value: {
      frameId,
      crc32,
      result,
      refreshMs,
      firmware: firmware || undefined,
      rssi,
      freeHeap,
    },
  };
}
