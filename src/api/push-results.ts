/**
 * 多设备推送的逐设备结果与聚合语义（Phase 0 止血 ③）。
 *
 * 第一性原理：一次推送面向 N 台物理设备，就有 N 个独立成败。
 * 把它们 every() 抹平成单一 bool 会同时丢两样东西：
 *   1. 失败设备的归因（谁失败、为什么失败）
 *   2. 成功设备的事实（导致上游整批回滚 / 重复刷新）
 * 所以推送层一律返回逐设备结果 + 汇总状态，由调用方自己决定容忍度。
 */

/** 失败归因分类。只做分类，不做重试/退避/熔断（那些是 Phase 1）。 */
export type PushErrorCode =
  | 'timeout'
  | 'connection'
  | 'http_4xx'
  | 'http_5xx'
  | 'busy'
  | 'spec_mismatch'
  | 'unknown';

export interface DevicePushResult {
  /** 设备 id。字段名 `device` 为向后兼容保留（旧调用方读的是 device）。 */
  device: string;
  /** 与 device 同值，新调用方用这个名字。 */
  deviceId: string;
  ok: boolean;
  errorCode?: PushErrorCode;
  error?: string;
  durationMs?: number;
}

/** success=全成功；partial_success=有成功也有失败；failure=全部失败（或无设备）。 */
export type PushBatchStatus = 'success' | 'partial_success' | 'failure';

export interface PushBatchSummary {
  status: PushBatchStatus;
  results: DevicePushResult[];
  succeeded: number;
  failed: number;
}

/** 单次推送链路的全局并发上限（Phase 0 止血 ②）。 */
export const PUSH_CONCURRENCY_LIMIT = 4;

/**
 * 从任意异常/HTTP 错误文本推断 errorCode。
 * 纯启发式：底层 fetch/AbortSignal 抛的是普通 Error，没有结构化 code 可用。
 */
export function classifyPushError(error: unknown): PushErrorCode {
  const name = (error as any)?.name ? String((error as any).name) : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();

  if (name === 'TimeoutError' || name === 'AbortError' ||
      lower.includes('timeout') || lower.includes('timed out') || lower.includes('超时')) {
    return 'timeout';
  }
  if (lower.includes('设备规格不匹配') || lower.includes('位图大小不匹配') ||
      lower.includes('spec mismatch') || lower.includes('只支持 epd1-v1')) {
    return 'spec_mismatch';
  }
  const httpMatch = message.match(/(?:HTTP|status)\s*(\d{3})/i);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    if (code === 409) return 'busy';
    if (code >= 500) return 'http_5xx';
    if (code >= 400) return 'http_4xx';
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('ehostunreach') ||
      lower.includes('econnreset') || lower.includes('network') || lower.includes('fetch failed') ||
      lower.includes('connection') || lower.includes('unable to connect')) {
    return 'connection';
  }
  return 'unknown';
}

/** 由逐设备结果算出汇总状态。空结果视为 failure（没推到任何设备 = 没成功）。 */
export function summarizePushResults(results: DevicePushResult[]): PushBatchSummary {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  let status: PushBatchStatus;
  if (results.length === 0 || succeeded === 0) status = 'failure';
  else if (failed === 0) status = 'success';
  else status = 'partial_success';
  return { status, results, succeeded, failed };
}

/**
 * 有界并发映射：最多 limit 个任务同时在飞，任何一个任务抛错都不影响其他任务。
 * 返回顺序与输入顺序一致。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.allSettled(runners);
  return results;
}
