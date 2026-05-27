import { RenderTarget } from './render-targets.js';

export interface NiimbotPushOptions {
  timeoutMs?: number;
  printId?: string;
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Width-Px': String(target.widthPx),
      'X-Height-Px': String(target.heightPx),
      'X-Sku': target.id,
      'X-Print-Id': printId,
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

      // 503 retry once after 1s
      if (res.status === 503) {
        await new Promise((r) => setTimeout(r, 1000));
        res = await doFetch();
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
