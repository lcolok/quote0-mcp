import { describe, expect, it } from 'bun:test';
import { MAX_LONG_POLL_WAIT_SEC, parseDisplayAckPayload, parseLongPollWaitMs } from './eink-pull-protocol.js';

describe('parseLongPollWaitMs', () => {
  it('legacy request without wait stays immediate', () => {
    expect(parseLongPollWaitMs(undefined)).toBe(0);
    expect(parseLongPollWaitMs('')).toBe(0);
    expect(parseLongPollWaitMs('0')).toBe(0);
  });

  it('seconds are converted to milliseconds', () => {
    expect(parseLongPollWaitMs('20')).toBe(20_000);
    expect(parseLongPollWaitMs('0.5')).toBe(500);
  });

  it('invalid/negative values fall back to immediate and long waits are clamped', () => {
    expect(parseLongPollWaitMs('-1')).toBe(0);
    expect(parseLongPollWaitMs('wat')).toBe(0);
    expect(parseLongPollWaitMs('999')).toBe(MAX_LONG_POLL_WAIT_SEC * 1000);
  });
});

describe('parseDisplayAckPayload', () => {
  it('accepts a complete displayed ACK and normalizes hex', () => {
    const parsed = parseDisplayAckPayload({
      frame_id: 'A1B2C3D4E5F60718',
      crc32: 'DEADBEEF',
      result: 'displayed',
      refresh_ms: 2123,
      firmware: 'driver-board-hybrid-v2',
      rssi: -52,
      free_heap: 158000,
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({
      frameId: 'a1b2c3d4e5f60718',
      crc32: 'deadbeef',
      result: 'displayed',
      refreshMs: 2123,
      firmware: 'driver-board-hybrid-v2',
      rssi: -52,
      freeHeap: 158000,
    });
  });

  it('rejects malformed frame ids, CRC and telemetry ranges', () => {
    expect(parseDisplayAckPayload({ frame_id: 'bad', crc32: 'deadbeef', result: 'displayed' }).ok).toBe(false);
    expect(parseDisplayAckPayload({ frame_id: '0123456789abcdef', crc32: 'bad', result: 'displayed' }).ok).toBe(false);
    expect(parseDisplayAckPayload({ frame_id: '0123456789abcdef', crc32: 'deadbeef', result: 'wat' }).ok).toBe(false);
    expect(parseDisplayAckPayload({ frame_id: '0123456789abcdef', crc32: 'deadbeef', result: 'displayed', rssi: 5 }).ok).toBe(false);
    expect(parseDisplayAckPayload({ frame_id: '0123456789abcdef', crc32: 'deadbeef', result: 'displayed', refresh_ms: 999999 }).ok).toBe(false);
  });

  it('accepts a minimal failed ACK for diagnostics', () => {
    const parsed = parseDisplayAckPayload({
      frame_id: '0123456789abcdef',
      crc32: '00000000',
      result: 'failed',
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.result).toBe('failed');
  });
});
