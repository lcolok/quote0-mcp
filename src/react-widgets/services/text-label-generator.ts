import React from 'react';
import satori from 'satori';
import sharp from 'sharp';
import { fontRegistry } from '../core/font-registry.js';
import { packFromPng } from '../core/bitmap-packer.js';
import { WIDGETS, getWidget, SUPPORTED_FONTS, type WidgetId, type SupportedFontFamily } from '../core/label-widget-registry.js';
import type { RenderTarget } from '../core/render-targets.js';
import type { ActiveLLMConfig } from '../core/llm-config.js';

export interface TextLabelGenResult {
  widgetId: WidgetId;
  props: Record<string, any>;
  iconSvg: string | null;
  fontFamily: SupportedFontFamily;
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  llmLatencyMs: number;
  llmModel: string;
}

export interface TextLabelOverride {
  widgetId?: WidgetId;
  fontFamily?: SupportedFontFamily;
}

function buildSystemPrompt(): string {
  const widgetList = Object.values(WIDGETS).map((w) => {
    const propsDesc = w.propsSchema.map((p) => `${p.name}(${p.type}${p.required ? '*' : ''}${p.maxLength ? `, max ${p.maxLength}` : ''}): ${p.description}`).join('; ');
    return `- "${w.id}" (${w.displayName}): ${w.description}\n  Props: ${propsDesc}`;
  }).join('\n');
  const fontList = SUPPORTED_FONTS.map((f) => `- "${f.family}" (${f.displayName}): ${f.description}`).join('\n');

  return `你是热敏标签设计师。根据用户描述选择合适的 widget + 字体 + 填写 props，生成 JSON。

[可用 widget]
${widgetList}

[可用字体]
${fontList}

[硬性约束]
1. 输出严格 JSON（无 markdown 代码块，第一个字符必须是 \`{\`）
2. 字段：{ "widgetId": "<id>", "fontFamily": "<family>", "props": { ... } }
3. props 字段名必须精确匹配 widget 的 propsSchema
4. 字符串长度严格遵守 propsSchema 的 maxLength
5. 仅 text-with-icon widget 需要 iconSvg：
   - 格式：<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="..." fill="currentColor"/></svg>
   - 笔画粗（stroke-width >= 2）保证 1-bit 二值化后清晰
   - 使用 currentColor 让 SVG 继承文字颜色
   - 禁用：<script> <foreignObject> on*= javascript:
6. 字体选择规则：
   - 价签 / 公告 / 庄重场景 → "alibaba-puhuiti"
   - 诗词 / 文学 / 优雅 → "lxgw-wenkai"
   - 时尚 / 标识 / 个性 → "smiley-sans"

[输出示例]
用户："请保持安静的提示，配安静图标"
输出: {"widgetId":"text-with-icon","fontFamily":"alibaba-puhuiti","props":{"title":"请保持安静","subtitle":"会议中","iconSvg":"<svg viewBox=\\"0 0 24 24\\" xmlns=\\"http://www.w3.org/2000/svg\\"><path d=\\"M12 1c-2 0-3 1-3 3v8c0 2 1 3 3 3s3-1 3-3V4c0-2-1-3-3-3zm-7 11c0 4 3 7 6 7v3h2v-3c3 0 6-3 6-7h-2c0 3-2 5-5 5s-5-2-5-5H5z\\" fill=\\"currentColor\\" stroke=\\"currentColor\\" stroke-width=\\"0.5\\"/></svg>"}}
`;
}

export class TextLabelGenerator {
  async generate(
    userPrompt: string,
    target: RenderTarget,
    llmConfig: ActiveLLMConfig,
    override?: TextLabelOverride
  ): Promise<TextLabelGenResult> {
    // 1. LLM 调用
    const t0 = Date.now();
    const url = llmConfig.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data: any = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const llmLatencyMs = Date.now() - t0;

    // 2. 解析 JSON
    let parsed: any;
    try {
      const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`LLM 输出非合法 JSON，前 200 字符: ${content.slice(0, 200)}`);
    }

    // 3. 应用 override（用户手动指定优先）
    const widgetId = (override?.widgetId ?? parsed.widgetId) as WidgetId;
    const fontFamily = (override?.fontFamily ?? parsed.fontFamily) as SupportedFontFamily;
    const props = parsed.props ?? {};

    // 4. 验证 widget 存在
    const widget = getWidget(widgetId);
    if (!widget) {
      throw new Error(`LLM 选择了未知 widget: ${widgetId}`);
    }

    // 5. 验证 font 在允许列表
    if (!SUPPORTED_FONTS.some((f) => f.family === fontFamily)) {
      throw new Error(`LLM 选择了未知字体: ${fontFamily}`);
    }

    // 6. 验证 props required 字段都在 + maxLength
    for (const field of widget.propsSchema) {
      const val = props[field.name];
      if (field.required && (val === undefined || val === null || val === '')) {
        throw new Error(`widget ${widgetId} 缺 required prop: ${field.name}`);
      }
      if (field.maxLength && typeof val === 'string' && val.length > field.maxLength) {
        // 截断不报错（容错）
        props[field.name] = val.slice(0, field.maxLength);
      }
    }

    // 7. sanitize iconSvg（如果 widget 用到）
    let iconSvg: string | null = null;
    if (widgetId === 'text-with-icon' && props.iconSvg) {
      iconSvg = this.sanitizeSVG(props.iconSvg);
      props.iconSvg = iconSvg;
    }

    // 8. satori 渲染（复用 thermal-label-rendering-module 的模式）
    const fonts = await fontRegistry.getSatoriFonts([fontFamily]);
    if (fonts.length === 0) {
      throw new Error(`字体加载失败: ${fontFamily} (assets/fonts/${fontFamily}/ 目录是否有 ttf 文件?)`);
    }

    const element = React.createElement(widget.component, {
      data: props,
      target,
      fontFamily,
    });

    const svg = await satori(element, {
      width: target.widthPx,
      height: target.heightPx,
      fonts,
      embedFont: true,
    });

    // 9. sharp render PNG + 1-bit pack（复用 bitmap-packer）
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const bitmapBuffer = await packFromPng(pngBuffer, target);

    return {
      widgetId,
      props,
      iconSvg,
      fontFamily,
      pngBuffer,
      bitmapBuffer,
      llmLatencyMs,
      llmModel: llmConfig.model,
    };
  }

  /** 复用 llm-label-generator 的轻量 SVG 黑名单清理 */
  private sanitizeSVG(svg: string): string {
    svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
    svg = svg.replace(/<script\s*\/>/gi, '');
    svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    svg = svg.replace(/<foreignObject\s*\/>/gi, '');
    svg = svg.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
    svg = svg.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    return svg;
  }
}

export const textLabelGenerator = new TextLabelGenerator();
