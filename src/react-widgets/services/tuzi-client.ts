/**
 * TuZi 图像生成后端（OpenAI images API 兼容），经 copilot 网关转发。
 *
 * 与 bizyair-client 的关系：模型选择器并存，`tuzi:<model>` 前缀路由到本客户端。
 * 硬约束：TuZi 无图像输入（无 images[]/image-to-image），仅文生图，
 * 参考图互斥由调用方（labels-api / label-jobs-worker / image-label-generator）拦截。
 */

/** DB source_model / API model 字段里的 TuZi 前缀（剥离后透传给上游） */
export const TUZI_MODEL_PREFIX = 'tuzi:';

/** 上游模型名字符集（gpt-image-2.5 / vendor/model 这类路径都要能过） */
const UPSTREAM_MODEL_RE = /^[a-z0-9.\-\/]+$/i;

/** ASCII 图像尺寸档（TuZi 仅支持这四档；320×160 这类超宽标签靠 dither 阶段 contain 缩放兜住） */
export type TuziSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';

export interface TuziRequest {
  prompt: string;
  /** 已剥离 tuzi: 前缀的上游模型名 */
  model: string;
  /** 透传/覆盖上游字段（size / quality / background / output_format 等） */
  options?: Record<string, any>;
  /** 打印目标像素尺寸 → 推导 size 档位 */
  aspect?: { widthPx: number; heightPx: number };
}

export interface TuziResponse {
  /** 上游返回的图片 URL（OpenAI images schema data[0].url） */
  imageUrl: string;
  /** 本地实测的端到端耗时（上游响应无 elapsed 字段） */
  elapsedMs: number;
  rawResponse: any;
}

/** 剥离并校验 tuzi: 前缀；非法（无前缀 / 剥离后为空 / 字符集越界）返回 null */
export function upstreamModelFromTuzi(model: string): string | null {
  if (typeof model !== 'string' || !model.startsWith(TUZI_MODEL_PREFIX)) return null;
  const upstream = model.slice(TUZI_MODEL_PREFIX.length);
  return upstream.length > 0 && UPSTREAM_MODEL_RE.test(upstream) ? upstream : null;
}

/** 是否为合法 TuZi 模型串（白名单判据，供 labels-api / worker / generator 共用） */
export function isTuziModel(model: unknown): boolean {
  return typeof model === 'string' && upstreamModelFromTuzi(model) !== null;
}

/** 按 target 纵横推导 size；未知纵横退回正方形 */
export function deriveTuziSize(aspect?: { widthPx: number; heightPx: number }): TuziSize {
  if (!aspect) return '1024x1024';
  if (aspect.widthPx > aspect.heightPx) return '1536x1024';
  if (aspect.widthPx < aspect.heightPx) return '1024x1536';
  return '1024x1024';
}

/** gpt-image 低质量实测几十秒，180s 上限留足 headroom（job 异步执行，不阻塞请求） */
const TUZI_TIMEOUT_MS = 180_000;

export class TuziClient {
  private baseUrl = process.env.COPILOT_TUZI_BASE_URL
    ?? 'https://copilot.logic.heiyu.space/providers/tuzi/v1';

  async generate(req: TuziRequest): Promise<TuziResponse> {
    const endpoint = `${this.baseUrl}/images/generations`;
    const payload = this.buildPayload(req);
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TUZI_TIMEOUT_MS),
      });
    } catch (e: any) {
      // AbortSignal.timeout 触发 → TimeoutError/AbortError；标记成可识别前缀，供 worker 跳过重试
      const name = e?.name ?? '';
      const causeStr = `${e?.cause?.code ?? ''} ${e?.cause?.name ?? ''} ${e?.message ?? ''}`;
      if (name === 'TimeoutError' || name === 'AbortError' || /timed out|ETIMEDOUT|UND_ERR_CONNECT/i.test(causeStr)) {
        throw new Error('[TUZI_TIMEOUT] TuZi 请求超时（180s 上限，疑似 copilot 代理出网间歇断流）');
      }
      throw new Error(`TuZi 网络错误: ${e?.message ?? String(e)}`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TuZi HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error(`TuZi 返回无 data[0].url: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      imageUrl,
      elapsedMs: Date.now() - startedAt,
      rawResponse: data,
    };
  }

  private buildPayload(req: TuziRequest): Record<string, any> {
    const options = req.options ?? {};
    return {
      ...options,
      // 以下四项不接受 options 覆盖：模型/prompt 由调用方决定，n 恒为 1，URL 形式取图
      model: req.model,
      prompt: req.prompt,
      n: 1,
      response_format: 'url',
      // 标签实际只需 320×160px，low 质量最快且够用；下游 dither 会把彩图压成 1-bit
      size: options.size ?? deriveTuziSize(req.aspect),
      quality: options.quality ?? 'low',
      background: options.background ?? 'auto',
      output_format: options.output_format ?? 'png',
    };
  }
}

export const tuziClient = new TuziClient();
