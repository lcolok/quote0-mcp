export type BizyAirModel = 'sd5' | 'sd5-3k' | 'nb2' | 'nbp' | 'gpt2';

export interface BizyAirRequest {
  prompt: string;
  model: BizyAirModel;
  options?: Record<string, any>;  // 透传 BizyAir CLI 额外字段（aspect_ratio / seed 等）
}

export interface BizyAirResponse {
  imageUrl: string;       // urls[0] 永久 OSS 链接
  elapsedMs: number;
  rawResponse: any;
}

export class BizyAirClient {
  private baseUrl = process.env.COPILOT_BIZYAIR_BASE_URL
    ?? 'https://copilot.logic.heiyu.space/providers/bizyair/v1/cli';

  async generate(req: BizyAirRequest): Promise<BizyAirResponse> {
    // sd5 和 sd5-3k 走同一 endpoint，仅 size 不同
    const endpointModel = req.model === 'sd5-3k' ? 'sd5' : req.model;
    const endpoint = `${this.baseUrl}/${endpointModel}`;
    const payload = this.buildPayload(req);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(75_000),  // 75s 上限（实测成功 ≤62s，留 headroom）
      });
    } catch (e: any) {
      // AbortSignal.timeout 触发 → TimeoutError/AbortError；标记成可识别前缀，供 worker 跳过重试
      const name = e?.name ?? '';
      const causeStr = `${e?.cause?.code ?? ''} ${e?.cause?.name ?? ''} ${e?.message ?? ''}`;
      if (name === 'TimeoutError' || name === 'AbortError' || /timed out|ETIMEDOUT|UND_ERR_CONNECT/i.test(causeStr)) {
        throw new Error('[BIZYAIR_TIMEOUT] BizyAir 请求超时（75s 上限，疑似 copilot 代理出网间歇断流）');
      }
      throw new Error(`BizyAir 网络错误: ${e?.message ?? String(e)}`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BizyAir HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    if (!data.urls || !data.urls[0]) {
      throw new Error(`BizyAir 返回无 urls 字段: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      imageUrl: data.urls[0],
      elapsedMs: data.elapsed_ms ?? 0,
      rawResponse: data,
    };
  }

  private buildPayload(req: BizyAirRequest): Record<string, any> {
    const base: Record<string, any> = { prompt: req.prompt, ...(req.options ?? {}) };
    // 模型默认参数 —— v1.8.1: 标签实际只需 320×160px，4K/3K 是浪费（dither 阶段强行下采样）
    // sd5 schema 最低 size 是 2K（doubao 不支持 1K，硬约束），其他统一默认 1K
    if (req.model === 'sd5-3k') base.size = '3K';                           // 用户主动选高清才上 3K
    else if (req.model === 'sd5' && !base.size) base.size = '2K';            // sd5 schema 最低档
    else if ((req.model === 'nb2' || req.model === 'nbp') && !base.resolution) base.resolution = '1K';  // ↓ 4K
    // gpt2 不强制默认（schema 选项 1k/2k/4k；用户可在 modelOptions 里指定）
    return base;
  }
}

export const bizyairClient = new BizyAirClient();
