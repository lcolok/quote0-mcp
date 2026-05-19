import type { ActiveLLMConfig } from '../core/llm-config.js';

export interface VisionTextPart {
  type: 'text';
  text: string;
}

export interface VisionImagePart {
  type: 'image_url';
  image_url: { url: string };  // 必须是 data:image/...;base64,... inline，外网 URL 会被拒
}

export type VisionContentPart = VisionTextPart | VisionImagePart;

export interface VisionMessage {
  role: 'user' | 'system' | 'assistant';
  content: string | VisionContentPart[];
}

export interface MultimodalRequest {
  systemPrompt?: string;
  messages: VisionMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface MultimodalResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

const MULTIMODAL_TIMEOUT_MS = 60_000;

export class MultimodalLLMClient {
  /**
   * 调多模态 LLM（OpenAI Chat Completions v1 vision schema）。
   * 实测 kimi-for-coding 支持，但 image_url 必须是 base64 inline (data:...;base64,...)，
   * 不接受外网 URL。调用者负责把图片预先编码成 base64 data URL。
   */
  async chat(cfg: ActiveLLMConfig, req: MultimodalRequest): Promise<MultimodalResponse> {
    const t0 = Date.now();
    const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';

    // 拼 messages：systemPrompt 是 system message，其他从 req.messages
    const messages: VisionMessage[] = [];
    if (req.systemPrompt) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }
    messages.push(...req.messages);

    const body = {
      model: cfg.model,
      messages,
      max_tokens: req.maxTokens ?? 1000,
      temperature: req.temperature ?? 0.3,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MULTIMODAL_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Multimodal LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new Error(`Multimodal LLM 输出空 content: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      text,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - t0,
    };
  }
}

export const multimodalLLMClient = new MultimodalLLMClient();

/**
 * 把图片 URL（http/https）下载并转 base64 data URL。
 * 外网图、MinIO 内部图都通过 fetch 拉取 → encode。
 */
export async function imageUrlToBase64(url: string, defaultMime = 'image/png'): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`下载图片失败 HTTP ${res.status} @ ${url}`);
  }
  const contentType = res.headers.get('content-type')?.split(';')[0] || defaultMime;
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buf.toString('base64')}`;
}
