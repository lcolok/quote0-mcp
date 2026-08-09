import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import type { EinkDevice, EinkStatus } from './eink-converter.js';

const realFetch = globalThis.fetch;
const einkConverter: any = await import('./eink-converter.ts?serialization=' + Date.now());
const { pushToEinkDevice } = einkConverter;

const STATUS: EinkStatus = {
  width: 296,
  height: 152,
  colorMode: 'bw',
  planeCount: 1,
  planeBytes: Math.ceil(296 / 8) * 152,
  firmware: 'eink-core v1',
  protocol_diag: 1,
  trace_supported: true,
  crc32_supported: true,
};

const bitmap = Buffer.alloc(STATUS.planeBytes!, 0xa5);

function device(id: string, baseUrl: string): EinkDevice {
  return {
    id,
    name: id,
    baseUrl,
    token: 'test-token',
    width: 296,
    height: 152,
    wireProtocol: 'epd1-v1',
    colorMode: 'mono-1bit',
    planeCount: 1,
  };
}

let active = 0;
let maxActive = 0;
let callCount = 0;
let failFirst = false;

const stubFetch = (async (_input: any, init?: RequestInit) => {
  callCount += 1;
  active += 1;
  maxActive = Math.max(maxActive, active);
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (failFirst && callCount === 1) {
      return new Response('synthetic failure', { status: 500 });
    }
    const headers = new Headers(init?.headers);
    const traceId = headers.get('X-EPD-Trace-Id') ?? '';
    const crc32 = headers.get('X-EPD-CRC32') ?? '';
    return new Response(JSON.stringify({ ok: true, queued: true, trace_id: traceId, crc32 }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-EPD-Trace-Id': traceId,
      },
    });
  } finally {
    active -= 1;
  }
}) as typeof fetch;

beforeEach(() => {
  globalThis.fetch = stubFetch;
  active = 0;
  maxActive = 0;
  callCount = 0;
  failFirst = false;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('EPD physical endpoint push serialization', () => {
  it('同一设备的多个 push 永远只有一个 POST 在途', async () => {
    const d = device('eink-2', 'http://192.168.31.130:80');
    const results = await Promise.all([
      pushToEinkDevice(d, bitmap, { statusSnapshot: STATUS, traceId: 'serial-a1' }),
      pushToEinkDevice(d, bitmap, { statusSnapshot: STATUS, traceId: 'serial-a2' }),
      pushToEinkDevice(d, bitmap, { statusSnapshot: STATUS, traceId: 'serial-a3' }),
    ]);

    expect(results.every((r: any) => r.ok)).toBe(true);
    expect(callCount).toBe(3);
    expect(maxActive).toBe(1);
  });

  it('不同 device id 只要指向同一物理 endpoint 也必须串行', async () => {
    const a = device('eink-alias-a', 'http://192.168.31.130');
    const b = device('eink-alias-b', 'http://192.168.31.130:80/');
    await Promise.all([
      pushToEinkDevice(a, bitmap, { statusSnapshot: STATUS, traceId: 'alias-a' }),
      pushToEinkDevice(b, bitmap, { statusSnapshot: STATUS, traceId: 'alias-b' }),
    ]);
    expect(maxActive).toBe(1);
  });

  it('不同物理设备仍可并发，不把全局吞吐退化成串行', async () => {
    const a = device('eink-1', 'http://192.168.31.26:80');
    const b = device('eink-2', 'http://192.168.31.130:80');
    const results = await Promise.all([
      pushToEinkDevice(a, bitmap, { statusSnapshot: STATUS, traceId: 'parallel-a' }),
      pushToEinkDevice(b, bitmap, { statusSnapshot: STATUS, traceId: 'parallel-b' }),
    ]);
    expect(results.every((r: any) => r.ok)).toBe(true);
    expect(maxActive).toBe(2);
  });

  it('前一次失败也会释放锁，后续 push 不死锁', async () => {
    failFirst = true;
    const d = device('eink-2', 'http://192.168.31.130:80');
    const results = await Promise.all([
      pushToEinkDevice(d, bitmap, { statusSnapshot: STATUS, traceId: 'failure-a1' }),
      pushToEinkDevice(d, bitmap, { statusSnapshot: STATUS, traceId: 'failure-a2' }),
    ]);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
    expect(callCount).toBe(2);
    expect(maxActive).toBe(1);
  });
});
