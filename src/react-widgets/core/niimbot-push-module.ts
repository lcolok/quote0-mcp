import { RenderTarget } from './render-targets.js';

export interface NiimbotPushOptions {
  timeoutMs?: number;
  printId?: string;
  /** 503(固件队列满)时的最大尝试次数(含首次),默认 6。退避等固件打印队列腾空。 */
  maxAttempts?: number;
  /** 打印浓度 1-5。固件不带时默认 3；本服务统一默认 1，可被请求覆盖。 */
  density?: number;
}

export interface NiimbotPushResult {
  printId: string;
  queued: boolean;
  status?: number;
  error?: string;
}

class NiimbotPushModule {
  async push(
    bitmap: Buffer,
    target: RenderTarget,
    endpoint: string,
    options: NiimbotPushOptions = {}
  ): Promise<NiimbotPushResult> {
    const { timeoutMs = 10000 } = options;
    const printId = options.printId ?? crypto.randomUUID();

    // 浓度默认 1，clamp 到 1-5 整数
    const density = Math.min(5, Math.max(1, Math.round(options.density ?? 1)));

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Width-Px': String(target.widthPx),
      'X-Height-Px': String(target.heightPx),
      'X-Sku': target.id,
      'X-Print-Id': printId,
      'X-Density': String(density),
    };

    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: new Uint8Array(bitmap),
          signal: controller.signal,
        });
        return res;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let res = await doFetch();

      // 503 = 固件打印队列满(ESP32 队列深度仅 2,单张热敏打印 6-12s)。线性退避重试,
      // 等前面打印完、队列腾空再发 —— 否则批量打印第 3+ 张会被固件直接拒绝并【永久漏打】。
      // 退避 2/4/6/8/10s,累计约 30s,覆盖「队列 2 个 × 单张最长 12s」的等待窗口。
      const maxAttempts = options.maxAttempts ?? 6;
      let attempt = 1;
      while (res.status === 503 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        res = await doFetch();
        attempt++;
      }

      if (!res.ok) {
        return {
          printId,
          queued: false,
          status: res.status,
          error: `HTTP ${res.status}: ${res.statusText}`,
        };
      }

      return { printId, queued: true, status: res.status };
    } catch (err: any) {
      return {
        printId,
        queued: false,
        error: err?.name === 'AbortError' ? 'Request timeout' : String(err),
      };
    }
  }
}

export const niimbotPush = new NiimbotPushModule();
