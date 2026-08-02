/**
 * Phase 0 止血验收测试：多设备墨水屏推送的故障隔离。
 *
 * 覆盖：
 *  ① 单次推送链路中每台设备只探测一次 /status（fetch 计数）
 *  ② 发送环节并发不突破上限 4（记录在飞峰值）
 *  ③ 3 台设备 1 台失败 → partial_success，成功设备结果完整保留、失败设备 errorCode 正确
 *  ④ 全部失败 → failure
 */

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ---- 被 mock 的设备表 ----
interface TestDevice {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  width: number;
  height: number;
  wireProtocol: 'epd1-v1' | 'legacy-raw-v0';
  colorMode: 'mono-1bit';
  planeCount: number;
}

let mockDevices: TestDevice[] = [];

/** 每台设备的推送行为：ok / 抛错。 */
let pushBehavior: Record<string, 'ok' | 'timeout' | 'http500'> = {};

/** /status 探测计数（按 baseUrl）。 */
let statusProbeCount: Record<string, number> = {};

/** 发送并发观测。 */
let inFlight = 0;
let peakInFlight = 0;
/** 每台设备的发送次数（验证同一设备不并发/不重复发送）。 */
let sendCount: Record<string, number> = {};
/** 用于人为拉长发送时长，逼出并发峰值。 */
let sendDelayMs = 0;

const getEinkDevicesMock = mock(async (options?: { deviceIds?: string[] }) => {
  if (!options?.deviceIds) return mockDevices;
  return mockDevices.filter((d) => options.deviceIds!.includes(d.id));
});

// 真实的 status 探测函数：走 fetch，便于计数。
async function fakeGetEinkStatus(device: TestDevice) {
  const res = await fetch(`${device.baseUrl}/status`);
  return await res.json();
}

const resolveEinkRenderTargetMock = mock(async (device: TestDevice) => {
  const status: any = device.wireProtocol === 'epd1-v1' ? await fakeGetEinkStatus(device) : undefined;
  const width = status?.width ?? device.width;
  const height = status?.height ?? device.height;
  return {
    device: { ...device, width, height },
    status,
    target: {
      id: `eink-${width}x${height}`,
      kind: 'eink',
      widthPx: width,
      heightPx: height,
      colorMode: 'mono-1bit',
    },
  };
});

// 保留 eink-converter 的其余真实导出，只覆盖本测试需要的两个（降低全局 mock 的爆炸半径）。
const realEinkConverter = await import('./eink-converter.js');
mock.module('./eink-converter.js', () => ({
  ...realEinkConverter,
  getEinkDevices: getEinkDevicesMock,
  resolveEinkRenderTarget: resolveEinkRenderTargetMock,
}));

// 渲染器：不真渲染，直接给一个假的本地路径（分组数由 target 尺寸决定）。
// 注意：不能用 mock.module 换掉整个 rendering-modules（bun 的 mock.module 全局生效，
// 会把 news-api-server.test.ts 的真渲染器注册表一并干掉）。
// 改为向真实 registry 临时注入 local-eink 假渲染器，跑完还原。
const renderMock = mock(async (_data: any, config: any) => ({
  localImagePath: `/tmp/fake-${config.width}x${config.height}.png`,
  imageUrl: `http://minio/fake-${config.width}x${config.height}.png`,
}));

const { renderingRegistry } = await import('../react-widgets/core/rendering-modules.js');
const originalLocalEinkRenderer = renderingRegistry.get('local-eink');
renderingRegistry.register('local-eink', { render: renderMock } as any);

// devicePusher：模拟真实的“一次调用发一台设备”，并观测并发。
const devicePusherPushMock = mock(async (_input: string, _renderer: string, options?: any) => {
  const entry = options?.preResolvedDevices?.[0];
  const deviceId: string = entry?.device?.id ?? options?.deviceIds?.[0];

  inFlight += 1;
  peakInFlight = Math.max(peakInFlight, inFlight);
  sendCount[deviceId] = (sendCount[deviceId] ?? 0) + 1;
  try {
    if (sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs));

    const behavior = pushBehavior[deviceId] ?? 'ok';
    if (behavior === 'timeout') {
      return {
        ok: false,
        status: 'failure',
        succeeded: 0,
        failed: 1,
        error: 'The operation timed out.',
        pushResults: [{
          device: deviceId,
          deviceId,
          ok: false,
          error: 'The operation timed out.',
          errorCode: 'timeout',
          durationMs: 1,
        }],
      };
    }
    if (behavior === 'http500') {
      return {
        ok: false,
        status: 'failure',
        succeeded: 0,
        failed: 1,
        error: 'HTTP 500: internal error',
        pushResults: [{
          device: deviceId,
          deviceId,
          ok: false,
          error: 'HTTP 500: internal error',
          errorCode: 'http_5xx',
          durationMs: 1,
        }],
      };
    }
    return {
      ok: true,
      status: 'success',
      succeeded: 1,
      failed: 0,
      deviceResult: 'e-ink 推送完成: 1/1 成功',
      pushResults: [{ device: deviceId, deviceId, ok: true, error: undefined, durationMs: 1 }],
    };
  } finally {
    inFlight -= 1;
  }
});

// 同理：不换整个 device-pusher 模块，只临时接管单例的 push 方法。
const { devicePusher } = await import('./device-pusher.js');
const originalDevicePusherPush = devicePusher.push;
(devicePusher as any).push = devicePusherPushMock;

// fetch 拦截：统计 /status 探测次数。只在本文件的用例期间接管，跑完还回去，
// 避免全量 bun test 时污染其他测试文件。
let realFetch: typeof fetch = globalThis.fetch;
const stubFetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  if (url.endsWith('/status')) {
    const base = url.slice(0, -'/status'.length);
    statusProbeCount[base] = (statusProbeCount[base] ?? 0) + 1;
    const device = mockDevices.find((d) => d.baseUrl === base);
    return new Response(JSON.stringify({
      width: device?.width ?? 296,
      height: device?.height ?? 128,
      colorMode: 'mono-1bit',
      planeCount: 1,
      planeBytes: Math.ceil((device?.width ?? 296) / 8) * (device?.height ?? 128),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { renderAndPushLocalEinkByTarget } = await import('./target-aware-eink.ts?target-aware=' + Date.now());

function makeDevice(id: string, overrides: Partial<TestDevice> = {}): TestDevice {
  return {
    id,
    name: `设备 ${id}`,
    baseUrl: `http://192.168.31.${id.replace(/\D/g, '') || '1'}`,
    token: `token-${id}`,
    width: 296,
    height: 128,
    wireProtocol: 'epd1-v1',
    colorMode: 'mono-1bit',
    planeCount: 1,
    ...overrides,
  };
}

const NEWS = {
  id: 'news-1',
  title: '测试标题',
  message: '测试正文',
  signature: 'RSS智能',
  source: 'solidot',
  publishTime: new Date().toISOString(),
  category: '科技',
} as any;

describe('renderAndPushLocalEinkByTarget — Phase 0 故障隔离', () => {
  afterAll(() => {
    globalThis.fetch = realFetch;
    if (originalLocalEinkRenderer) renderingRegistry.register('local-eink', originalLocalEinkRenderer);
    (devicePusher as any).push = originalDevicePusherPush;
  });

  beforeEach(() => {
    if (globalThis.fetch !== stubFetch) realFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    mockDevices = [];
    pushBehavior = {};
    statusProbeCount = {};
    sendCount = {};
    inFlight = 0;
    peakInFlight = 0;
    sendDelayMs = 0;
    getEinkDevicesMock.mockClear();
    resolveEinkRenderTargetMock.mockClear();
    renderMock.mockClear();
    devicePusherPushMock.mockClear();
  });

  it('3 台设备 1 台失败 → partial_success，成功设备结果完整保留，失败设备 errorCode 正确', async () => {
    mockDevices = [makeDevice('eink-1'), makeDevice('eink-2'), makeDevice('eink-3')];
    pushBehavior['eink-2'] = 'timeout';

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('partial_success');
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    // 向后兼容：ok === (status !== 'failure')
    expect(result.ok).toBe(true);
    expect(result.pushResults).toHaveLength(3);

    const byId = Object.fromEntries(result.pushResults.map((r: any) => [r.deviceId, r]));
    expect(byId['eink-1']).toMatchObject({ device: 'eink-1', deviceId: 'eink-1', ok: true });
    expect(byId['eink-3']).toMatchObject({ device: 'eink-3', deviceId: 'eink-3', ok: true });
    expect(byId['eink-2'].ok).toBe(false);
    expect(byId['eink-2'].errorCode).toBe('timeout');
    expect(byId['eink-2'].error).toContain('timed out');

    // 失败设备没有拖垮其他设备的发送
    expect(sendCount['eink-1']).toBe(1);
    expect(sendCount['eink-3']).toBe(1);
  });

  it('全部失败 → failure，且 ok=false', async () => {
    mockDevices = [makeDevice('eink-1'), makeDevice('eink-2')];
    pushBehavior['eink-1'] = 'timeout';
    pushBehavior['eink-2'] = 'http500';

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('failure');
    expect(result.ok).toBe(false);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.pushResults.map((r: any) => r.errorCode).sort()).toEqual(['http_5xx', 'timeout']);
  });

  it('单次推送链路中每台设备的 /status 只被 fetch 一次', async () => {
    mockDevices = [makeDevice('eink-1'), makeDevice('eink-2'), makeDevice('eink-3')];

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('success');
    for (const device of mockDevices) {
      expect(statusProbeCount[device.baseUrl]).toBe(1);
    }
  });

  it('发送并发不突破上限 4（6 台设备）', async () => {
    mockDevices = Array.from({ length: 6 }, (_, i) => makeDevice(`eink-${i + 1}`));
    sendDelayMs = 25; // 拉长发送，确保能观测到真实的在飞峰值

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('success');
    expect(result.pushResults).toHaveLength(6);
    // 真并发（不是串行），且不超上限
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(4);
    // 同一设备不得并发/重复发送
    for (const device of mockDevices) {
      expect(sendCount[device.id]).toBe(1);
    }
  });

  it('同规格设备共享一次渲染；不同规格才分组各渲染一次', async () => {
    mockDevices = [
      makeDevice('eink-1', { width: 296, height: 128 }),
      makeDevice('eink-2', { width: 296, height: 128 }),
      makeDevice('eink-3', { width: 296, height: 152 }),
    ];

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('success');
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(result.renderedImages).toHaveLength(2);
  });

  it('设备 /status 探测失败只记该台，其余设备照常推送', async () => {
    mockDevices = [makeDevice('eink-1'), makeDevice('eink-2')];
    resolveEinkRenderTargetMock.mockImplementationOnce(async (device: TestDevice) => {
      throw new Error('The operation timed out.');
    });

    const result = await renderAndPushLocalEinkByTarget(NEWS);

    expect(result.status).toBe('partial_success');
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    const failed = result.pushResults.find((r: any) => !r.ok);
    expect(failed.errorCode).toBe('timeout');
  });
});
