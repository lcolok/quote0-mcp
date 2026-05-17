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

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),  // 120s 上限
    });
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
    // 模型默认参数
    if (req.model === 'sd5-3k') base.size = '3K';
    else if (req.model === 'sd5' && !base.size) base.size = '2K';
    else if ((req.model === 'nb2' || req.model === 'nbp') && !base.resolution) base.resolution = '4K';
    // gpt2 不强制默认参数（用户可在 options 里给 aspect_ratio / quality）
    return base;
  }
}

export const bizyairClient = new BizyAirClient();
