/**
 * Phase 0 止血①验收：单次推送链路中每台设备最多探测一次 /status。
 *
 * 这里测的是真实 eink-converter 代码（不 mock resolve），只拦 fetch 计数。
 * 改动前：resolveEinkDeviceSpec 一次 + pushToEinkDevice 内 verifyEinkStatus 一次 = 2 次。
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import type { EinkDevice } from './eink-converter.js';

// 其他测试文件的 mock.module('./eink-converter.js') 在 bun 里是全局生效的，
// 这里必须拿 cache-busting 导入真实模块，否则全量跑时会拿到别人的 mock。
const einkConverter: any = await import('./eink-converter.ts?single-probe=' + Date.now());
const { pushToEinkDevice, resolveEinkDeviceSpecWithStatus, assertEinkStatusMatches } = einkConverter;

const DEVICE: EinkDevice = {
  id: 'eink-s3',
  name: 'S3自制板墨水屏',
  baseUrl: 'http://192.168.31.130',
  token: 'test-token',
  width: 296,
  height: 128,
  wireProtocol: 'epd1-v1',
  colorMode: 'mono-1bit',
  planeCount: 1,
};

const PLANE_BYTES = Math.ceil(296 / 8) * 128;

let statusCalls = 0;
let bitmapCalls = 0;
let lastBitmapHeaders: Record<string, string> = {};
let ackTraceOverride: string | undefined;
let ackCrcOverride: string | undefined;
let omitAckTrace = false;
let omitAckCrc = false;
let advertiseDiagnostics = true;

let realFetch: typeof fetch;

const stubFetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  if (url.endsWith('/status')) {
    statusCalls += 1;
    return new Response(JSON.stringify({
      width: 296,
      height: 128,
      colorMode: 'mono-1bit',
      planeCount: 1,
      planeBytes: PLANE_BYTES,
      ...(advertiseDiagnostics ? {
        wire_protocol: 'epd1-v1',
        protocol_diag: 1,
        trace_supported: true,
        crc32_supported: true,
      } : {}),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/display/bitmap')) {
    bitmapCalls += 1;
    lastBitmapHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({
      ok: true,
      ts: 12345,
      ...(!omitAckTrace ? { trace_id: ackTraceOverride ?? lastBitmapHeaders['x-epd-trace-id'] } : {}),
      ...(!omitAckCrc ? { crc32: ackCrcOverride ?? lastBitmapHeaders['x-epd-crc32'] } : {}),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-EPD-Trace-Id': lastBitmapHeaders['x-epd-trace-id'] ?? '',
      },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

afterAll(() => {
  if (realFetch) globalThis.fetch = realFetch;
});

describe('EPD1 /status 单快照', () => {
  beforeEach(() => {
    // 在每个用例里才接管 fetch，避免与其他测试文件的全局覆盖打架。
    if (globalThis.fetch !== stubFetch) realFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    statusCalls = 0;
    bitmapCalls = 0;
    lastBitmapHeaders = {};
    ackTraceOverride = undefined;
    ackCrcOverride = undefined;
    omitAckTrace = false;
    omitAckCrc = false;
    advertiseDiagnostics = true;
  });

  it('resolve + push 全链路只探测一次 /status', async () => {
    const { device: resolved, status } = await resolveEinkDeviceSpecWithStatus(DEVICE);
    expect(statusCalls).toBe(1);
    expect(resolved.width).toBe(296);
    expect(resolved.height).toBe(128);
    expect(status?.planeBytes).toBe(PLANE_BYTES);

    const result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'd123-a2',
    });

    expect(result.ok).toBe(true);
    expect(bitmapCalls).toBe(1);
    expect(lastBitmapHeaders['x-epd-trace-id']).toBe('d123-a2');
    expect(lastBitmapHeaders['x-epd-crc32']).toMatch(/^[0-9a-f]{8}$/);
    expect(result.traceId).toBe('d123-a2');
    expect(result.crc32).toBe(lastBitmapHeaders['x-epd-crc32']);
    // 关键断言：推送环节复用快照，没有发起第二次 /status
    expect(statusCalls).toBe(1);
  });

  it('新固件 ACK 的 trace/CRC 若与发送帧不一致，按失败返回而不是假成功', async () => {
    const { device: resolved, status } = await resolveEinkDeviceSpecWithStatus(DEVICE);

    ackTraceOverride = 'wrong-trace';
    let result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'd456-a1',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('code=ack_trace_mismatch');

    ackTraceOverride = undefined;
    ackCrcOverride = '00000000';
    result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'd456-a2',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('code=ack_crc_mismatch');
  });

  it('设备声明 protocol_diag=1 后缺少 ACK 证据会失败，不静默伪装成旧固件', async () => {
    const { device: resolved, status } = await resolveEinkDeviceSpecWithStatus(DEVICE);

    omitAckTrace = true;
    let result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'd789-a1',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('code=ack_trace_missing');

    omitAckTrace = false;
    omitAckCrc = true;
    result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'd789-a2',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('code=ack_crc_missing');
  });

  it('旧 EPD1 固件未声明 diagnostics 时，缺少 ACK trace/CRC 仍保持兼容', async () => {
    advertiseDiagnostics = false;
    omitAckTrace = true;
    omitAckCrc = true;
    const { device: resolved, status } = await resolveEinkDeviceSpecWithStatus(DEVICE);

    const result = await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES), {
      statusSnapshot: status,
      traceId: 'legacy-sender-test',
    });

    expect(result.ok).toBe(true);
  });

  it('未传快照时退回自行探测一次（向后兼容旧调用方）', async () => {
    const { device: resolved } = await resolveEinkDeviceSpecWithStatus(DEVICE);
    expect(statusCalls).toBe(1);

    await pushToEinkDevice(resolved, Buffer.alloc(PLANE_BYTES));

    expect(statusCalls).toBe(2);
  });

  it('legacy 设备完全不碰 /status', async () => {
    const legacy: EinkDevice = { ...DEVICE, id: 'eink-c3', wireProtocol: 'legacy-raw-v0', height: 152 };
    const { device: resolved, status } = await resolveEinkDeviceSpecWithStatus(legacy);

    expect(status).toBeUndefined();
    await pushToEinkDevice(resolved, Buffer.alloc(Math.ceil(296 / 8) * 152));

    expect(statusCalls).toBe(0);
    expect(bitmapCalls).toBe(1);
  });

  it('assertEinkStatusMatches 是纯比对：规格不符抛 spec 错误且零请求', () => {
    expect(() => assertEinkStatusMatches(DEVICE, {
      width: 296,
      height: 152,
      planeCount: 1,
      planeBytes: Math.ceil(296 / 8) * 152,
    })).toThrow('设备规格不匹配');
    expect(statusCalls).toBe(0);
  });
});
