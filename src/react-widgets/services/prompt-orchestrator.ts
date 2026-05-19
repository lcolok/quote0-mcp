import { multimodalLLMClient, imageUrlToBase64, type VisionMessage, type VisionContentPart } from './multimodal-llm-client.js';
import type { ActiveLLMConfig } from '../core/llm-config.js';

export interface OrchestrateContext {
  /** 用户原始 prompt（textarea 内容） */
  userPrompt: string;
  /** 应用的 preset（含 source_image_url / prompt / style_mode / static_suffix_text）；无则 null */
  preset: AppliedPreset | null;
  /** 用户上传的 ref 图（MinIO URL 数组），无则空数组 */
  refImageUrls: string[];
  /** 当前打印目标（label 物理尺寸），影响 prompt 描述 */
  target: {
    widthMm?: number;
    heightMm?: number;
    widthPx: number;
    heightPx: number;
  };
  /** LLM 配置（多模态调用要用） */
  llmConfig: ActiveLLMConfig;
}

export interface AppliedPreset {
  id: string;
  name: string;
  /** preset 当时生成的原始 user prompt（oneshot 样本） */
  prompt: string;
  /** preset 的视觉样本图 URL（优先 source_image_url，没有就用 thumbnail_path） */
  sourceImageUrl: string;
  styleMode: 'oneshot' | 'static_suffix';
  staticSuffixText: string | null;
}

export interface OrchestrateResult {
  /** 最终给 BizyAir 的 prompt 字符串 */
  finalPrompt: string;
  /** 编排模式标识（用于 log/audit） */
  mode: 'plain' | 'static_suffix' | 'oneshot_preset' | 'oneshot_user_refs';
  /** LLM 调用 latency（无 LLM 调用时是 0） */
  llmLatencyMs: number;
}

export class PromptOrchestrator {
  /**
   * 根据 (preset, refImageUrls) 四种组合决定走哪条路径，返回最终 prompt。
   *
   * 决策表：
   * | preset | refImages | mode                |
   * | null   | []        | plain               |
   * | null   | [...]     | oneshot_user_refs   |
   * | static | (any)     | static_suffix       |
   * | oneshot| (any)     | oneshot_preset      |
   */
  async orchestrate(ctx: OrchestrateContext): Promise<OrchestrateResult> {
    const { preset, refImageUrls, userPrompt } = ctx;

    if (!preset && refImageUrls.length === 0) {
      // case A: 纯文生图
      return { finalPrompt: userPrompt, mode: 'plain', llmLatencyMs: 0 };
    }

    if (!preset && refImageUrls.length > 0) {
      // case B: 用户图生图（仅 ref 图，无 preset）
      return await this.imgToImgOneshot(ctx);
    }

    if (preset!.styleMode === 'static_suffix') {
      // case C: 系统/用户 static_suffix preset（无 LLM 调用）
      const suffix = preset!.staticSuffixText ?? '';
      const sizeNote = ctx.target.widthMm && ctx.target.heightMm
        ? `\nTarget: ${ctx.target.widthMm}×${ctx.target.heightMm}mm thermal label (${ctx.target.widthPx}×${ctx.target.heightPx}px).`
        : '';
      return {
        finalPrompt: `${userPrompt}\n\n${suffix}${sizeNote}`,
        mode: 'static_suffix',
        llmLatencyMs: 0,
      };
    }

    // case D: oneshot preset
    return await this.styleOneshot(ctx);
  }

  /** Case D: oneshot — preset 图 + preset 原 prompt + 用户新意图（可叠加用户 ref 图）→ LLM 生成新 BizyAir prompt */
  private async styleOneshot(ctx: OrchestrateContext): Promise<OrchestrateResult> {
    const { preset, userPrompt, refImageUrls, target, llmConfig } = ctx;

    // 下载 preset 图 → base64
    const presetB64 = await imageUrlToBase64(preset!.sourceImageUrl);

    // 用户额外 ref 图（如有）→ base64
    const userRefB64s: string[] = [];
    for (const url of refImageUrls.slice(0, 6)) { // 最多 6 张额外 ref（留 token 余量）
      try {
        userRefB64s.push(await imageUrlToBase64(this.resolveInternalUrl(url)));
      } catch (e) {
        console.warn('[orchestrator] 用户 ref 图下载失败，跳过:', e instanceof Error ? e.message : e);
      }
    }

    const sizeNote = target.widthMm && target.heightMm
      ? ` Target physical size: ${target.widthMm}×${target.heightMm}mm (${target.widthPx}×${target.heightPx}px thermal label).`
      : '';

    const systemPrompt = `You are an expert image-generation prompt engineer for thermal label printing.

Your task: Given a REFERENCE image with its original user prompt, extract ONLY the visual style features
(line weight, composition aesthetic, color palette mode, dithering treatment, shape language, etc.).
Then write a NEW prompt that applies the same visual style to the USER's new content request.

CRITICAL RULES:
1. Do NOT copy the content of the reference image. Only inherit the visual style/aesthetic.
2. The output must be a single English prompt string suitable for direct input to image-generation models (BizyAir / SDXL / Gemini).
3. Keep the prompt concise (under 200 words). Focus on subject + style descriptors.
4. If the user mentions extra reference images, also consider their style.
5. Output ONLY the prompt string. No quotes, no markdown, no explanation, no leading "Prompt:" prefix.${sizeNote}`;

    const userContent: VisionContentPart[] = [
      { type: 'text', text: `REFERENCE image — generated for original prompt: "${preset!.prompt}"` },
      { type: 'image_url', image_url: { url: presetB64 } },
    ];
    if (userRefB64s.length > 0) {
      userContent.push({ type: 'text', text: `\n\nAdditional user-provided reference image(s):` });
      for (const b64 of userRefB64s) {
        userContent.push({ type: 'image_url', image_url: { url: b64 } });
      }
    }
    userContent.push({
      type: 'text',
      text: `\n\nUSER's new content request: "${userPrompt}"\n\nWrite the new image-generation prompt now:`,
    });

    const res = await multimodalLLMClient.chat(llmConfig, {
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 500,
      temperature: 0.4,
    });

    return {
      finalPrompt: res.text.trim(),
      mode: 'oneshot_preset',
      llmLatencyMs: res.latencyMs,
    };
  }

  /** Case B: 仅用户 ref 图（无 preset），LLM 看 refs + 理解风格 → 生成新 prompt */
  private async imgToImgOneshot(ctx: OrchestrateContext): Promise<OrchestrateResult> {
    const { userPrompt, refImageUrls, target, llmConfig } = ctx;

    const refB64s: string[] = [];
    for (const url of refImageUrls.slice(0, 6)) {
      try {
        refB64s.push(await imageUrlToBase64(this.resolveInternalUrl(url)));
      } catch (e) {
        console.warn('[orchestrator] ref 图下载失败:', e instanceof Error ? e.message : e);
      }
    }
    if (refB64s.length === 0) {
      // 全部下载失败 → fallback 到纯文生图
      return { finalPrompt: userPrompt, mode: 'plain', llmLatencyMs: 0 };
    }

    const sizeNote = target.widthMm && target.heightMm
      ? ` Target physical size: ${target.widthMm}×${target.heightMm}mm (${target.widthPx}×${target.heightPx}px thermal label).`
      : '';

    const systemPrompt = `You are an expert image-generation prompt engineer for thermal label printing.

You will be shown 1 or more REFERENCE images. Extract their common visual style features
(line weight, composition, color palette, treatment) and write a NEW prompt that applies this style to the user's content request.

CRITICAL RULES:
1. Do NOT copy the content of references. Only inherit visual style.
2. Output a single English prompt string (under 200 words).
3. Output ONLY the prompt. No quotes, no markdown, no explanation.${sizeNote}`;

    const userContent: VisionContentPart[] = [
      { type: 'text', text: `${refB64s.length} reference image(s) for style:` },
      ...refB64s.map((b64) => ({ type: 'image_url' as const, image_url: { url: b64 } })),
      { type: 'text', text: `\n\nUSER's content request: "${userPrompt}"\n\nWrite the new prompt:` },
    ];

    const res = await multimodalLLMClient.chat(llmConfig, {
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 500,
      temperature: 0.4,
    });

    return {
      finalPrompt: res.text.trim(),
      mode: 'oneshot_user_refs',
      llmLatencyMs: res.latencyMs,
    };
  }

  /**
   * 内部 URL 处理：把 /api/minio-proxy/xxx 形式转成容器内可访问的 http://minio:9000/<bucket>/xxx
   * 因为后端跑在 news-api 容器内，调 MinIO 走容器网络。
   */
  private resolveInternalUrl(url: string): string {
    if (url.startsWith('/api/minio-proxy/')) {
      const path = url.replace('/api/minio-proxy/', '');
      const bucket = process.env.MINIO_BUCKET || 'quote0-images';
      const endpoint = process.env.MINIO_ENDPOINT || 'minio';
      const port = process.env.MINIO_PORT || '9000';
      return `http://${endpoint}:${port}/${bucket}/${path}`;
    }
    return url;
  }
}

export const promptOrchestrator = new PromptOrchestrator();
