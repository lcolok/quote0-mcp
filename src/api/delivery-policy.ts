/**
 * Phase 1 投递策略：退避 / 错误归因 → 状态转移 / 认领批内去重。
 *
 * 全部是纯函数，不碰 DB、不碰时钟以外的外部状态，
 * 这样退避档位、熔断阈值、dead 判定都能在没有 PostgreSQL 的环境里被独立验证。
 * worker（device-delivery-worker.ts）只负责把这些决策落成 SQL。
 */

import type { PushErrorCode } from './push-results.js';

/** delivery 生命周期。queued/leased/retry_wait 是在途，succeeded/dead/cancelled 是终态。 */
export type DeliveryState = 'queued' | 'leased' | 'retry_wait' | 'succeeded' | 'dead' | 'cancelled';

/** 设备健康观察值（device_runtime_state.health）。 */
export type DeviceHealth = 'unknown' | 'healthy' | 'degraded' | 'offline' | 'misconfigured';

/**
 * 退避档位：15s → 1m → 5m → 15m → 1h。
 * 索引按「本次失败后已累计的 attempts」取：attempts=1 用 15s，attempts=2 用 1m …
 * 超出表长按最后一档（1h）封顶。
 */
export const BACKOFF_LADDER_MS: readonly number[] = [
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
];

/** jitter 幅度 ±20%，打散同一批设备同时到期造成的惊群。 */
export const BACKOFF_JITTER_RATIO = 0.2;

/** 连续失败达到该次数即打开熔断。 */
export const CIRCUIT_FAILURE_THRESHOLD = 3;

/** 熔断打开时长。到期后自然放行下一次认领 = half-open 探针，无需额外状态位。 */
export const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

/** 连续失败达到该次数，健康度从 degraded 降为 offline。 */
export const OFFLINE_FAILURE_THRESHOLD = 5;

/** 取退避基准档位（不含 jitter）。attempts 从 1 起算。 */
export function backoffBaseMs(attempts: number): number {
  const index = Math.max(1, Math.floor(attempts)) - 1;
  const clamped = Math.min(index, BACKOFF_LADDER_MS.length - 1);
  return BACKOFF_LADDER_MS[clamped];
}

/**
 * 取加了 ±20% jitter 的退避时长。
 * random 可注入，便于测试断言边界（0 → -20%，1 → +20%，0.5 → 基准）。
 */
export function backoffWithJitterMs(attempts: number, random: () => number = Math.random): number {
  const base = backoffBaseMs(attempts);
  const factor = 1 + (random() * 2 - 1) * BACKOFF_JITTER_RATIO;
  return Math.round(base * factor);
}

/**
 * 永久性失败：配置层面就错了，重试只会白打 token / 白刷设备。
 * - http_4xx：401/403 之类的鉴权与请求错误，设备不会因为再试一次就接受
 * - spec_mismatch：登记规格与板端自报规格不符，必须人改配置
 */
export function isPermanentFailure(code: PushErrorCode): boolean {
  return code === 'http_4xx' || code === 'spec_mismatch';
}

export interface FailureDecisionInput {
  /** classifyPushError 的归因结果。 */
  errorCode: PushErrorCode;
  /** 本次失败「之后」的累计尝试次数（worker 认领时已 +1）。 */
  attempts: number;
  /** 该 delivery 的重试上限。 */
  maxAttempts: number;
  /** 本次失败「之后」该设备的连续失败次数。 */
  consecutiveFailures: number;
}

export interface FailureDecision {
  /** delivery 下一状态。 */
  nextState: Extract<DeliveryState, 'retry_wait' | 'dead'>;
  /** 距下次尝试的毫秒数；nextState='dead' 时为 null。 */
  retryDelayMs: number | null;
  /** 设备健康观察值。 */
  health: DeviceHealth;
  /** 熔断需要打开的时长（毫秒）；不熔断为 null。 */
  circuitOpenMs: number | null;
  /** 判决理由，写进日志/报告方便追溯。 */
  reason: 'permanent' | 'exhausted' | 'retry';
}

/**
 * 失败后的完整判决：delivery 状态 + 退避 + 设备健康 + 熔断。
 *
 * 三条互斥分支：
 * ① 永久错（4xx / spec_mismatch）→ dead + misconfigured，不重试、不熔断
 *    （熔断是为了保护「暂时性故障的设备」，配置错的设备熔断没有意义，
 *     而且它会连累同设备其他 delivery 的正常判决）
 * ② 重试次数耗尽 → dead + offline
 * ③ 其余 → retry_wait + 退避；连续失败 ≥3 打开熔断，≥5 判 offline
 */
export function decideFailure(
  input: FailureDecisionInput,
  random: () => number = Math.random,
): FailureDecision {
  if (isPermanentFailure(input.errorCode)) {
    return {
      nextState: 'dead',
      retryDelayMs: null,
      health: 'misconfigured',
      circuitOpenMs: null,
      reason: 'permanent',
    };
  }

  const exhausted = input.attempts >= input.maxAttempts;
  const health: DeviceHealth = exhausted
    ? 'offline'
    : input.consecutiveFailures >= OFFLINE_FAILURE_THRESHOLD
      ? 'offline'
      : input.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
        ? 'degraded'
        : 'unknown';

  const circuitOpenMs = input.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    ? CIRCUIT_OPEN_MS
    : null;

  if (exhausted) {
    return {
      nextState: 'dead',
      retryDelayMs: null,
      health: 'offline',
      circuitOpenMs,
      reason: 'exhausted',
    };
  }

  return {
    nextState: 'retry_wait',
    retryDelayMs: backoffWithJitterMs(input.attempts, random),
    health,
    circuitOpenMs,
    reason: 'retry',
  };
}

/**
 * 认领批内同设备去重：一台设备同时最多一条 delivery 在飞。
 *
 * SQL 侧已经排除了「别的 worker 持有未过期租约」的设备，但同一条 SELECT
 * 返回的 LIMIT N 行里仍可能有多条指向同一台设备（同一轮给同一设备排了多条），
 * 这里按输入顺序保留每台设备的第一条，其余留到下一 tick。
 */
export function dedupeByDevice<T extends { device_id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    if (seen.has(row.device_id)) continue;
    seen.add(row.device_id);
    kept.push(row);
  }
  return kept;
}
