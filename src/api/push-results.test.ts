/**
 * Phase 0 止血③的纯函数单测：错误归因、聚合语义、有界并发。
 */

import { describe, it, expect } from 'bun:test';
import {
  PUSH_CONCURRENCY_LIMIT,
  classifyPushError,
  mapWithConcurrency,
  summarizePushResults,
  type DevicePushResult,
} from './push-results.js';

function r(deviceId: string, ok: boolean): DevicePushResult {
  return { device: deviceId, deviceId, ok };
}

describe('classifyPushError', () => {
  it('识别超时', () => {
    expect(classifyPushError(new Error('The operation timed out.'))).toBe('timeout');
    expect(classifyPushError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(classifyPushError('推送超时')).toBe('timeout');
  });

  it('识别连接类错误', () => {
    expect(classifyPushError(new Error('fetch failed: ECONNREFUSED'))).toBe('connection');
    expect(classifyPushError(new Error('getaddrinfo ENOTFOUND eink.local'))).toBe('connection');
  });

  it('识别 HTTP 4xx / 5xx / 409 busy', () => {
    expect(classifyPushError(new Error('HTTP 404: not found'))).toBe('http_4xx');
    expect(classifyPushError(new Error('HTTP 401: unauthorized'))).toBe('http_4xx');
    expect(classifyPushError(new Error('HTTP 500: internal'))).toBe('http_5xx');
    expect(classifyPushError(new Error('status HTTP 503'))).toBe('http_5xx');
  });

  it('识别 409 busy（设备正在刷新，暂时性）', () => {
    expect(classifyPushError(new Error('HTTP 409: {"error":"busy, refreshing"}'))).toBe('busy');
    expect(classifyPushError(new Error('status 409 conflict'))).toBe('busy');
  });

  it('识别 bad magic 为可恢复的板端拒收，而不是永久 4xx', () => {
    expect(classifyPushError(new Error('HTTP 400: {"error":"bad magic"}'))).toBe('device_reject');
    expect(classifyPushError(new Error('HTTP 400: BAD MAGIC'))).toBe('device_reject');
    expect(classifyPushError(new Error('HTTP 400: {"error":"invalid request"}'))).toBe('http_4xx');
  });

  it('识别规格不匹配', () => {
    expect(classifyPushError(new Error('设备规格不匹配: 登记=296x128'))).toBe('spec_mismatch');
    expect(classifyPushError(new Error('位图大小不匹配: expect 4736, got 5624'))).toBe('spec_mismatch');
  });

  it('兜底 unknown', () => {
    expect(classifyPushError(new Error('莫名其妙'))).toBe('unknown');
    expect(classifyPushError(undefined)).toBe('unknown');
  });
});

describe('summarizePushResults', () => {
  it('全成功 → success', () => {
    const s = summarizePushResults([r('a', true), r('b', true)]);
    expect(s).toMatchObject({ status: 'success', succeeded: 2, failed: 0 });
  });

  it('有成功有失败 → partial_success', () => {
    const s = summarizePushResults([r('a', true), r('b', false), r('c', false)]);
    expect(s).toMatchObject({ status: 'partial_success', succeeded: 1, failed: 2 });
  });

  it('全部失败 → failure', () => {
    const s = summarizePushResults([r('a', false)]);
    expect(s).toMatchObject({ status: 'failure', succeeded: 0, failed: 1 });
  });

  it('零设备 → failure（没推到任何设备就不算成功）', () => {
    const s = summarizePushResults([]);
    expect(s).toMatchObject({ status: 'failure', succeeded: 0, failed: 0 });
  });
});

describe('mapWithConcurrency', () => {
  it('不突破上限，且保持输入顺序', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const settled = await mapWithConcurrency(items, PUSH_CONCURRENCY_LIMIT, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return n * 2;
    });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(settled.map((s) => (s.status === 'fulfilled' ? s.value : null))).toEqual(items.map((n) => n * 2));
  });

  it('单个任务抛错不影响其他任务', async () => {
    const settled = await mapWithConcurrency([1, 2, 3], 4, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });

    expect(settled[0]).toMatchObject({ status: 'fulfilled', value: 1 });
    expect(settled[1].status).toBe('rejected');
    expect(settled[2]).toMatchObject({ status: 'fulfilled', value: 3 });
  });

  it('空输入返回空数组', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
