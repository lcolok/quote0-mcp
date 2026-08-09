/**
 * Phase 1 纯逻辑单测（不依赖 PostgreSQL）：
 *  ① 退避档位 + ±20% jitter 边界
 *  ② 错误分类 → 状态转移 / 健康度 / 熔断 的完整映射
 *  ③ 认领批内同设备去重
 */

import { describe, it, expect } from 'bun:test';
import {
  BACKOFF_LADDER_MS,
  BACKOFF_JITTER_RATIO,
  CIRCUIT_OPEN_MS,
  backoffBaseMs,
  backoffWithJitterMs,
  isPermanentFailure,
  decideFailure,
  dedupeByDevice,
} from './delivery-policy.js';
import { classifyPushError } from './push-results.js';

describe('退避档位 15s → 1m → 5m → 15m → 1h', () => {
  it('attempts 从 1 起算，逐级取档', () => {
    expect(backoffBaseMs(1)).toBe(15_000);
    expect(backoffBaseMs(2)).toBe(60_000);
    expect(backoffBaseMs(3)).toBe(300_000);
    expect(backoffBaseMs(4)).toBe(900_000);
    expect(backoffBaseMs(5)).toBe(3_600_000);
  });

  it('超出表长按最后一档（1h）封顶，不会无限增长', () => {
    expect(backoffBaseMs(6)).toBe(3_600_000);
    expect(backoffBaseMs(50)).toBe(3_600_000);
    expect(backoffBaseMs(9999)).toBe(BACKOFF_LADDER_MS[BACKOFF_LADDER_MS.length - 1]);
  });

  it('attempts <= 0 兜底为第一档，不越界取到 undefined', () => {
    expect(backoffBaseMs(0)).toBe(15_000);
    expect(backoffBaseMs(-3)).toBe(15_000);
  });
});

describe('jitter ±20%', () => {
  it('random=0 → 基准 -20%；random=1 → 基准 +20%；random=0.5 → 恰好基准', () => {
    expect(backoffWithJitterMs(1, () => 0)).toBe(Math.round(15_000 * 0.8));
    expect(backoffWithJitterMs(1, () => 1)).toBe(Math.round(15_000 * 1.2));
    expect(backoffWithJitterMs(1, () => 0.5)).toBe(15_000);
  });

  it('随机采样 500 次，全部落在 [基准×0.8, 基准×1.2] 内', () => {
    for (let attempts = 1; attempts <= 6; attempts++) {
      const base = backoffBaseMs(attempts);
      const lo = base * (1 - BACKOFF_JITTER_RATIO);
      const hi = base * (1 + BACKOFF_JITTER_RATIO);
      for (let i = 0; i < 500; i++) {
        const v = backoffWithJitterMs(attempts);
        expect(v).toBeGreaterThanOrEqual(Math.floor(lo));
        expect(v).toBeLessThanOrEqual(Math.ceil(hi));
      }
    }
  });

  it('jitter 确实打散（不是常量）', () => {
    const seen = new Set(Array.from({ length: 200 }, () => backoffWithJitterMs(3)));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('永久性失败判定', () => {
  it('普通 http_4xx / spec_mismatch / protocol_mismatch 是永久错；busy / device_reject / 其余可重试', () => {
    expect(isPermanentFailure('http_4xx')).toBe(true);
    expect(isPermanentFailure('spec_mismatch')).toBe(true);
    expect(isPermanentFailure('protocol_mismatch')).toBe(true);
    expect(isPermanentFailure('busy')).toBe(false);
    expect(isPermanentFailure('device_reject')).toBe(false);
    expect(isPermanentFailure('timeout')).toBe(false);
    expect(isPermanentFailure('connection')).toBe(false);
    expect(isPermanentFailure('http_5xx')).toBe(false);
    expect(isPermanentFailure('unknown')).toBe(false);
  });

  it('与 classifyPushError 串起来：真实 401/规格不匹配文本 → 永久错', () => {
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 401: Unauthorized')))).toBe(true);
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 403: Forbidden')))).toBe(true);
    expect(isPermanentFailure(classifyPushError(new Error('设备规格不匹配: 登记=296x128')))).toBe(true);
    // 5xx / 超时 / 连接错是暂时性的，必须留给退避
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 500: internal error')))).toBe(false);
    expect(isPermanentFailure(classifyPushError(new Error('The operation timed out.')))).toBe(false);
    expect(isPermanentFailure(classifyPushError(new Error('fetch failed ECONNREFUSED')))).toBe(false);
    // 409 → busy 不是永久错；400 bad magic → device_reject，也必须可恢复重试
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 409: {"error":"busy, refreshing"}')))).toBe(false);
    expect(classifyPushError(new Error('HTTP 400: {"error":"bad magic"}'))).toBe('device_reject');
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 400: {"error":"bad magic"}')))).toBe(false);
    expect(classifyPushError(new Error('HTTP 400: {"error":"empty body"}'))).toBe('device_reject');
    expect(isPermanentFailure(classifyPushError(new Error('HTTP 400: {"error":"empty body"}')))).toBe(false);
    // CRC 已验证完整送达但 header 仍非法 → protocol_mismatch，也必须永久失败
    expect(classifyPushError(new Error(
      'HTTP 400: {"code":"bad_magic","crc_verified":true}'
    ))).toBe('protocol_mismatch');
    expect(isPermanentFailure(classifyPushError(new Error(
      'HTTP 400: {"code":"bad_magic","crc_verified":true}'
    )))).toBe(true);
    // 其它没有专门恢复语义的 400 仍保持永久 4xx
    expect(classifyPushError(new Error('HTTP 400: {"error":"invalid request"}'))).toBe('http_4xx');
  });
});

describe('decideFailure — 错误分类 → 状态转移映射', () => {
  const base = { attempts: 1, maxAttempts: 5, consecutiveFailures: 1 };

  it('永久错 → dead + misconfigured，不重试、不熔断（即使连续失败很多）', () => {
    for (const code of ['http_4xx', 'spec_mismatch', 'protocol_mismatch'] as const) {
      const d = decideFailure({ ...base, errorCode: code, consecutiveFailures: 99 });
      expect(d.nextState).toBe('dead');
      expect(d.retryDelayMs).toBeNull();
      expect(d.health).toBe('misconfigured');
      expect(d.circuitOpenMs).toBeNull();
      expect(d.reason).toBe('permanent');
    }
  });

  it('暂时性错 + 未耗尽 → retry_wait + 对应档位退避', () => {
    for (const code of ['timeout', 'connection', 'http_5xx', 'unknown'] as const) {
      const d = decideFailure({ ...base, errorCode: code }, () => 0.5);
      expect(d.nextState).toBe('retry_wait');
      expect(d.retryDelayMs).toBe(15_000);
      expect(d.reason).toBe('retry');
    }
  });

  it('退避随 attempts 走档位（jitter 固定 0.5 时等于基准）', () => {
    const delays = [1, 2, 3, 4, 5].map(
      (attempts) => decideFailure({ errorCode: 'timeout', attempts, maxAttempts: 99, consecutiveFailures: 1 }, () => 0.5).retryDelayMs
    );
    expect(delays).toEqual([15_000, 60_000, 300_000, 900_000, 3_600_000]);
  });

  it('attempts >= max_attempts → dead + offline（不再排下一次）', () => {
    const d = decideFailure({ errorCode: 'timeout', attempts: 5, maxAttempts: 5, consecutiveFailures: 5 });
    expect(d.nextState).toBe('dead');
    expect(d.retryDelayMs).toBeNull();
    expect(d.health).toBe('offline');
    expect(d.reason).toBe('exhausted');
  });

  it('连续失败 <3 不熔断；==3 起熔断 5min 且 degraded', () => {
    const f2 = decideFailure({ errorCode: 'timeout', attempts: 1, maxAttempts: 5, consecutiveFailures: 2 });
    expect(f2.circuitOpenMs).toBeNull();
    expect(f2.health).toBe('unknown'); // 未到阈值 → 不改动既有 health

    for (const n of [3, 4]) {
      const d = decideFailure({ errorCode: 'timeout', attempts: 1, maxAttempts: 5, consecutiveFailures: n });
      expect(d.circuitOpenMs).toBe(CIRCUIT_OPEN_MS);
      expect(d.circuitOpenMs).toBe(5 * 60 * 1000);
      expect(d.health).toBe('degraded');
    }
  });

  it('连续失败 >=5 → offline（仍继续退避重试，直到 attempts 耗尽）', () => {
    const d = decideFailure({ errorCode: 'connection', attempts: 2, maxAttempts: 5, consecutiveFailures: 5 });
    expect(d.health).toBe('offline');
    expect(d.nextState).toBe('retry_wait');
    expect(d.circuitOpenMs).toBe(CIRCUIT_OPEN_MS);
  });

  it('健康度阈值边界完整表', () => {
    const health = (n: number) =>
      decideFailure({ errorCode: 'timeout', attempts: 1, maxAttempts: 9, consecutiveFailures: n }).health;
    expect([1, 2].map(health)).toEqual(['unknown', 'unknown']);
    expect([3, 4].map(health)).toEqual(['degraded', 'degraded']);
    expect([5, 6, 20].map(health)).toEqual(['offline', 'offline', 'offline']);
  });

  // ---------- 409 busy ----------

  it('busy 不是永久错→retry_wait，首退避 ≥30s', () => {
    const d = decideFailure({ errorCode: 'busy', attempts: 1, maxAttempts: 5, consecutiveFailures: 1 }, () => 0.5);
    expect(d.nextState).toBe('retry_wait');
    expect(d.reason).toBe('retry');
    // jitter=0.5 → 基准；标准退避第一档 15s，busy 兜底 ≥30s
    expect(d.retryDelayMs).toBe(30_000);
  });

  it('busy 退避随 attempts 走标准档位（≥30s 仅兜底首档）', () => {
    const delays = [1, 2, 3].map(
      (attempts) => decideFailure({ errorCode: 'busy', attempts, maxAttempts: 99, consecutiveFailures: 1 }, () => 0.5).retryDelayMs
    );
    // attempts=1: max(15k, 30k)=30k; attempts=2: max(60k, 30k)=60k; attempts=3: max(300k, 30k)=300k
    expect(delays).toEqual([30_000, 60_000, 300_000]);
  });

  it('busy 从不进 misconfigured；health 最多 degraded', () => {
    // 即使连续失败很多，busy 也绝不判 misconfigured
    const health = (n: number) =>
      decideFailure({ errorCode: 'busy', attempts: 1, maxAttempts: 9, consecutiveFailures: n }).health;
    expect([1, 2].map(health)).toEqual(['unknown', 'unknown']);
    expect([3, 4].map(health)).toEqual(['degraded', 'degraded']);
    expect([5, 6, 20].map(health)).toEqual(['degraded', 'degraded', 'degraded']);
  });

  it('busy 不打开熔断（即使连续失败 ≥3）', () => {
    for (const n of [3, 4, 10]) {
      const d = decideFailure({ errorCode: 'busy', attempts: 1, maxAttempts: 5, consecutiveFailures: n });
      expect(d.circuitOpenMs).toBeNull();
    }
  });

  it('busy + 耗尽 → dead + degraded（非 offline）', () => {
    const d = decideFailure({ errorCode: 'busy', attempts: 5, maxAttempts: 5, consecutiveFailures: 5 });
    expect(d.nextState).toBe('dead');
    expect(d.retryDelayMs).toBeNull();
    expect(d.health).toBe('degraded');
    expect(d.circuitOpenMs).toBeNull();
    expect(d.reason).toBe('exhausted');
  });

  // ---------- device_reject / bad magic ----------

  it('device_reject 可重试；连续拒收时开熔断但最多 degraded', () => {
    const first = decideFailure(
      { errorCode: 'device_reject', attempts: 1, maxAttempts: 5, consecutiveFailures: 1 },
      () => 0.5,
    );
    expect(first.nextState).toBe('retry_wait');
    expect(first.retryDelayMs).toBe(15_000);
    expect(first.health).toBe('unknown');
    expect(first.circuitOpenMs).toBeNull();

    const repeated = decideFailure(
      { errorCode: 'device_reject', attempts: 3, maxAttempts: 5, consecutiveFailures: 5 },
      () => 0.5,
    );
    expect(repeated.nextState).toBe('retry_wait');
    expect(repeated.health).toBe('degraded');
    expect(repeated.circuitOpenMs).toBe(CIRCUIT_OPEN_MS);

    const exhausted = decideFailure({
      errorCode: 'device_reject', attempts: 5, maxAttempts: 5, consecutiveFailures: 9,
    });
    expect(exhausted.nextState).toBe('dead');
    expect(exhausted.health).toBe('degraded');
    expect(exhausted.reason).toBe('exhausted');
  });
});

describe('dedupeByDevice — 认领批内同设备去重', () => {
  it('一设备只留第一条，其余留到下一 tick', () => {
    const rows = [
      { id: '1', device_id: 'eink-1' },
      { id: '2', device_id: 'eink-2' },
      { id: '3', device_id: 'eink-1' },
      { id: '4', device_id: 'eink-3' },
      { id: '5', device_id: 'eink-2' },
    ];
    const kept = dedupeByDevice(rows);
    expect(kept.map((r) => r.id)).toEqual(['1', '2', '4']);
    expect(new Set(kept.map((r) => r.device_id)).size).toBe(kept.length);
  });

  it('无重复时原样返回；空数组返回空', () => {
    const rows = [{ id: '1', device_id: 'a' }, { id: '2', device_id: 'b' }];
    expect(dedupeByDevice(rows)).toEqual(rows);
    expect(dedupeByDevice([])).toEqual([]);
  });

  it('全部同一设备 → 只剩一条', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), device_id: 'same' }));
    expect(dedupeByDevice(rows)).toHaveLength(1);
  });
});
