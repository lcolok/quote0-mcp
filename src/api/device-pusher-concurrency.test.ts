/**
 * Phase 0 止血②③验收（DevicePusher.pushToLocalEink 层）：
 * - 串行 for...of 改并发，上限 4；
 * - 逐设备结果 + partial_success / failure 聚合语义；
 * - 一台设备抛异常不影响其他设备。
 */

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { writeFile, unlink } from 'fs/promises';

const TEMP_PNG = '/tmp/device-pusher-concurrency-test.png';

let mockEinkDevices: Array<any> = [];
let behavior: Record<string, 'ok' | 'timeout' | 'throw' | 'http500'> = {};
let inFlight = 0;
let peakInFlight = 0;
let sendCount: Record<string, number> = {};
let sendDelayMs = 0;

const getEinkDevicesMock = mock(async (options?: { deviceIds?: string[] }) => {
  if (!options?.deviceIds) return mockEinkDevices;
  return mockEinkDevices.filter((d) => options.deviceIds!.includes(d.id));
});

const pushToEinkDeviceMock = mock(async (device: any) => {
  inFlight += 1;
  peakInFlight = Math.max(peakInFlight, inFlight);
  sendCount[device.id] = (sendCount[device.id] ?? 0) + 1;
  try {
    if (sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs));
    const mode = behavior[device.id] ?? 'ok';
    if (mode === 'throw') throw new Error('fetch failed: ECONNREFUSED 192.168.31.99:80');
    if (mode === 'timeout') return { ok: false, error: 'The operation timed out.' };
    if (mode === 'http500') return { ok: false, error: 'HTTP 500: boom' };
    return { ok: true, ts: 1 };
  } finally {
    inFlight -= 1;
  }
});

mock.module('./eink-converter.js', () => ({
  pngTo1BitBitmap: mock(async () => Buffer.from('bitmap')),
  getEinkDevices: getEinkDevicesMock,
  resolveEinkDeviceSpec: mock(async (d: any) => d),
  resolveEinkDeviceSpecWithStatus: mock(async (d: any) => ({ device: d, status: undefined })),
  pushToEinkDevice: pushToEinkDeviceMock,
}));

const { DevicePusher } = await import('./device-pusher.js?concurrency=' + Date.now());

function makeDevice(id: string) {
  return {
    id,
    name: `设备 ${id}`,
    baseUrl: `http://192.168.31.${id.replace(/\D/g, '')}`,
    token: `t-${id}`,
    width: 296,
    height: 128,
  };
}

describe('DevicePusher.pushToLocalEink — 并发与聚合语义', () => {
  const pusher = new DevicePusher();

  beforeEach(async () => {
    await writeFile(TEMP_PNG, Buffer.from('fake-png'));
    mockEinkDevices = [];
    behavior = {};
    inFlight = 0;
    peakInFlight = 0;
    sendCount = {};
    sendDelayMs = 0;
    getEinkDevicesMock.mockClear();
    pushToEinkDeviceMock.mockClear();
  });

  afterAll(async () => {
    try { await unlink(TEMP_PNG); } catch {}
  });

  it('3 台 1 台失败 → partial_success，成功设备结果完整保留', async () => {
    mockEinkDevices = [makeDevice('eink-1'), makeDevice('eink-2'), makeDevice('eink-3')];
    behavior['eink-2'] = 'timeout';

    const result = await pusher.push(TEMP_PNG, 'local-eink');

    expect(result.status).toBe('partial_success');
    expect(result.ok).toBe(true); // 向后兼容：ok === (status !== 'failure')
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const byId = Object.fromEntries(result.pushResults!.map((r: any) => [r.deviceId, r]));
    expect(byId['eink-1'].ok).toBe(true);
    expect(byId['eink-1'].device).toBe('eink-1'); // 旧字段名保留
    expect(typeof byId['eink-1'].durationMs).toBe('number');
    expect(byId['eink-3'].ok).toBe(true);
    expect(byId['eink-2']).toMatchObject({ ok: false, errorCode: 'timeout' });
  });

  it('抛异常的设备被归类为 connection，不影响其他设备', async () => {
    mockEinkDevices = [makeDevice('eink-1'), makeDevice('eink-2')];
    behavior['eink-1'] = 'throw';

    const result = await pusher.push(TEMP_PNG, 'local-eink');

    expect(result.status).toBe('partial_success');
    const failed = result.pushResults!.find((r: any) => !r.ok)!;
    expect(failed.deviceId).toBe('eink-1');
    expect(failed.errorCode).toBe('connection');
    expect(sendCount['eink-2']).toBe(1);
  });

  it('全部失败 → failure，ok=false', async () => {
    mockEinkDevices = [makeDevice('eink-1'), makeDevice('eink-2')];
    behavior['eink-1'] = 'http500';
    behavior['eink-2'] = 'timeout';

    const result = await pusher.push(TEMP_PNG, 'local-eink');

    expect(result.status).toBe('failure');
    expect(result.ok).toBe(false);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.pushResults!.map((r: any) => r.errorCode).sort()).toEqual(['http_5xx', 'timeout']);
  });

  it('并发不突破上限 4（8 台设备）', async () => {
    mockEinkDevices = Array.from({ length: 8 }, (_, i) => makeDevice(`eink-${i + 1}`));
    sendDelayMs = 20;

    const result = await pusher.push(TEMP_PNG, 'local-eink');

    expect(result.status).toBe('success');
    expect(result.pushResults).toHaveLength(8);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(4);
    for (const d of mockEinkDevices) expect(sendCount[d.id]).toBe(1);
  });

  it('单台设备时并发上限退化为 1，行为不变', async () => {
    mockEinkDevices = [makeDevice('eink-1')];
    sendDelayMs = 5;

    const result = await pusher.push(TEMP_PNG, 'local-eink');

    expect(result.status).toBe('success');
    expect(peakInFlight).toBe(1);
  });

  it('preResolvedDevices 提供时直接使用，不再查设备表', async () => {
    mockEinkDevices = [makeDevice('eink-1'), makeDevice('eink-2')];
    const only = makeDevice('eink-2');

    const result = await pusher.push(TEMP_PNG, 'local-eink', {
      deviceIds: ['eink-2'],
      preResolvedDevices: [{ device: only as any, status: undefined }],
    });

    expect(result.status).toBe('success');
    expect(result.pushResults).toHaveLength(1);
    expect(result.pushResults![0].deviceId).toBe('eink-2');
    expect(getEinkDevicesMock).not.toHaveBeenCalled();
  });
});
