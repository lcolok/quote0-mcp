import sharp from 'sharp';
import type { ActiveLLMConfig } from '../core/llm-config.js';
import type { RenderTarget } from '../core/render-targets.js';
import { packMonoBuffer } from '../core/bitmap-packer.js';
import { ditherGrayscaleToMono, DEFAULT_DITHER, type DitherAlgorithm } from '../core/dither-algorithms.js';

export interface LLMLabelGenResult {
  svg: string;
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  llmLatencyMs: number;
  llmModel: string;
}

const SYSTEM_PROMPT = `你是热敏标签设计师。用户给你一句中文描述，你输出一段 SVG 字符串用于打印到 40mm×20mm 的 Niimbot 热敏标签纸。

【硬性约束】
1. 输出且仅输出一段合法 SVG XML，不要 markdown 代码块，不要解释，不要 \`\`\`。第一个字符必须是 <。
2. 根元素 <svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">
3. 字体仅可用 font-family="Smiley Sans Oblique"，禁用其他字体
4. 颜色仅可用 #000000（黑）和 #ffffff（白），禁渐变 / 透明 / 灰色 / opacity 属性
5. 所有元素必须完全在 (0,0)-(320,160) 矩形内，禁溢出
6. 安全子集：仅允许 <rect> <text> <line> <path> <polyline> <polygon> <circle>。禁 <script> <foreignObject> <image> <use>
7. 背景：默认整张 320×160 白底 <rect fill="#ffffff"/>
8. 中文字符可正常使用（得意黑支持简繁中文）
9. 笔画粗细：text font-size 至少 16；stroke-width 至少 2（热敏太细烧不出）
10. 不要文本嵌套 <tspan>，直接 <text> 单行（多行用多个 <text> 元素）

【设计原则】
- 自适应布局：根据用户文案的字数、信息密度自动决定字号、行数、是否加图形装饰
- 视觉重点：主信息字号最大，次要信息小
- 中英混排时英文 / 数字略小于中文以视觉协调
- 可加简单装饰：矩形边框 / 横线分隔 / 圆角矩形高亮 / 几何图形 / 简单图标用 path 画
- 禁止照搬模板，根据内容判断最合适布局

【输出示例（仅作格式参考，不照抄）】
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" fill="#ffffff"/><text x="160" y="95" text-anchor="middle" font-family="Smiley Sans Oblique" font-size="72" fill="#000000">会议室 A</text></svg>`;

export class LLMLabelGenerator {
  async generate(
    userPrompt: string,
    target: RenderTarget,
    llmConfig: ActiveLLMConfig
  ): Promise<LLMLabelGenResult> {
    // 1. LLM 调用
    const url = llmConfig.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const t0 = Date.now();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(llmConfig.apiKey && llmConfig.apiKey !== 'dummy' ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const llmLatencyMs = Date.now() - t0;

    // 2. 提取 SVG
    let svg = content.trim();
    const mdMatch = svg.match(/```(?:xml|svg)?\s*(<svg[\s\S]+?<\/svg>)\s*```/);
    if (mdMatch) svg = mdMatch[1];
    const svgMatch = svg.match(/<svg[\s\S]+?<\/svg>/);
    if (!svgMatch) {
      throw new Error(
        `LLM 输出未含合法 <svg>...</svg>，前 200 字符: ${content.slice(0, 200)}`
      );
    }
    let rawSvg = svgMatch[0];

    // 3. sanitize SVG（轻量正则黑名单）
    rawSvg = this.sanitizeSVG(rawSvg);

    // 4. sharp 渲染 PNG + 1-bit pack
    const { pngBuffer, bitmapBuffer } = await this.svgToBitmap(rawSvg, target);

    return {
      svg: rawSvg,
      pngBuffer,
      bitmapBuffer,
      llmLatencyMs,
      llmModel: llmConfig.model,
    };
  }

  /** 轻量 SVG 黑名单清理（无 DOMPurify 依赖） */
  private sanitizeSVG(svg: string): string {
    // 删除 <script>...</script> 和 <script />
    svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
    svg = svg.replace(/<script\s*\/>/gi, '');
    // 删除 <foreignObject>...</foreignObject> 和 <foreignObject />
    svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    svg = svg.replace(/<foreignObject\s*\/>/gi, '');
    // 删除 javascript: href
    svg = svg.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
    // 删除事件处理器 on...="..."
    svg = svg.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    return svg;
  }

  /** SVG → PNG → dither → MSB-first 1-bit pack */
  async svgToBitmap(
    svg: string,
    target: RenderTarget,
    ditherAlgo: DitherAlgorithm = DEFAULT_DITHER
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    const { data: raw } = await sharp(Buffer.from(svg), { density: 72 })
      .resize(target.widthPx, target.heightPx, {
        fit: 'contain',
        background: '#ffffff',
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mono = ditherGrayscaleToMono(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.length),
      target.widthPx,
      target.heightPx,
      ditherAlgo
    );
    const pngBuffer = await sharp(Buffer.from(mono), {
      raw: { width: target.widthPx, height: target.heightPx, channels: 1 },
    })
      .png()
      .toBuffer();
    const bitmapBuffer = packMonoBuffer(mono, target);
    return { pngBuffer, bitmapBuffer };
  }
}

export const llmLabelGenerator = new LLMLabelGenerator();
