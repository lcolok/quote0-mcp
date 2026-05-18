import React from 'react';
import satori from 'satori';
import sharp from 'sharp';
import { fontRegistry } from '../core/font-registry.js';
import { packFromPng } from '../core/bitmap-packer.js';
import { WIDGETS, getWidget, SUPPORTED_FONTS, type WidgetId, type SupportedFontFamily } from '../core/label-widget-registry.js';
import type { RenderTarget } from '../core/render-targets.js';
import type { ActiveLLMConfig } from '../core/llm-config.js';
import { executeDecorator, buildStandardContext, DecoratorSandboxError } from '../core/decorator-sandbox.js';

export interface TextLabelGenResult {
  widgetId: WidgetId;
  props: Record<string, any>;
  iconSvg: string | null;
  frameSvgPaths: string[] | null;
  decoratorCode: string | null;
  fontFamily: SupportedFontFamily;
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  llmLatencyMs: number;
  llmModel: string;
}

export interface TextLabelOverride {
  widgetId?: WidgetId;
  fontFamily?: SupportedFontFamily;
  forceDecoration?: boolean;  // v1.5.5: 强制 LLM 输出 decoratorCode 装饰
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
   - **iconSvg 字段值是 SVG <path> 元素的 d 属性字符串，不是完整 <svg> 标签**
   - 坐标系：viewBox 0 0 24 24（24×24 单位）
   - 单 path 描述完整图案（一笔画或多段子路径合并）
   - 用 lucide / heroicons 风格（geometric, minimal, single-path）
   - 笔画 / 填充足够粗实，保证 1-bit 二值化后清晰
6. 字体选择规则：
   - 价签 / 公告 / 庄重场景 → "alibaba-puhuiti"
   - 诗词 / 文学 / 优雅 → "lxgw-wenkai"
   - 时尚 / 标识 / 个性 → "smiley-sans"
7. 装饰 decoratorCode（可选）：
   - 字段值是 JS 代码字符串，含 function generate(ctx) { ... } 必须返回 string[]
   - 推荐用 ctx.draw 高层 API（不用手写几何）：

ctx.draw 提供的方法：
**Lucide 图标（1500+ 可用，会自动 scale/rotate/translate）**：
  ctx.draw.icon(name: string, x: number, y: number, size: number, opts?: {rotate?: number})

**几何 primitives**：
  ctx.draw.line(x1, y1, x2, y2)
  ctx.draw.circle(cx, cy, r)
  ctx.draw.ellipse(cx, cy, rx, ry)
  ctx.draw.rect(x, y, w, h)
  ctx.draw.polygon(cx, cy, r, sides)
  ctx.draw.star(cx, cy, r, points?, innerRatio?)
  ctx.draw.heart(cx, cy, r)
  ctx.draw.flower(cx, cy, r, petals?)

**重复 pattern helpers**：
  ctx.draw.dashedLine(x1, y1, x2, y2, dashLen?, gap?)
  ctx.draw.dots(x1, y1, x2, y2, count, radius?)
  ctx.draw.pearls(x1, y1, x2, y2, count, radius?)
  ctx.draw.zigzag(x1, y1, x2, y2, amplitude?, teeth?)
  ctx.draw.wave(x1, y1, x2, y2, amplitude?, cycles?)

**Lucide 核心 icon 推荐（50 个，可用更多名称试试）**：
- 自然：leaf, flower, flower-2, tree-deciduous, palm-tree, trees, sun, sun-medium, moon, moon-star, cloud, cloud-rain, cloud-snow, snowflake, sparkle, sparkles, star, stars, droplet, droplets, mountain, waves, wind, sprout, citrus
- 节日：cake, gift, party-popper, candy, candy-cane, bell, music, music-2, ribbon
- 食物：apple, cherry, grape, banana, coffee, beer, wine, pizza, cookie, ice-cream, croissant
- 心情：heart, heart-handshake, smile, frown
- 动物：cat, dog, rabbit, bird, fish, dove, bug, snail
- 工业：cog, settings, wrench, hammer, anchor, ship, plane, rocket
- 几何：circle, triangle, square, hexagon, octagon, diamond
- 商务：tag, ticket, shopping-bag, gem, crown, award, trophy
- 时间：clock, calendar, hourglass, alarm-clock

API 用法（必返回 paths）：
  function generate(ctx) {
    const d = ctx.draw;
    d.icon('leaf', 12, 12, 18, { rotate: 45 });
    d.flower(50, 8, 5);
    return d.getPaths();
  }

也保留的旧 ctx API（不用手写几何即可不读）：
- ctx.width=320, ctx.height=160
- ctx.safeZone={x:24,y:24,w:272,h:112}
- ctx.corners / ctx.edges
- ctx.Math: sin/cos/tan/PI/sqrt/pow/abs/floor/ceil/round/min/max/random/atan2

严禁：
- 全局 Math（用 ctx.Math 或 ctx.draw 替代）
- eval / Function / require / import / process / setTimeout / fetch / Buffer
- 直接输出 frameSvgPaths 字段（用 decoratorCode JS 函数）

【创造性】根据 prompt 主题挑选合适的 icon + 几何组合，每次输出**不同的算法**。

不适合输出 decoratorCode 场景：用户描述含"极简/简洁/纯文字/不要装饰" → 不输出此字段

[输出示例]
用户："请保持安静的提示，配安静图标"
输出: {"widgetId":"text-with-icon","fontFamily":"alibaba-puhuiti","props":{"title":"请保持安静","subtitle":"会议中","iconSvg":"M12 1c-2 0-3 1-3 3v8c0 2 1 3 3 3s3-1 3-3V4c0-2-1-3-3-3zm-7 11c0 4 3 7 6 7v3h2v-3c3 0 6-3 6-7h-2c0 3-2 5-5 5s-5-2-5-5H5z"}}

用户："警告，危险区域"
输出: {"widgetId":"text-with-icon","fontFamily":"alibaba-puhuiti","props":{"title":"危险区域","subtitle":"请勿进入","iconSvg":"M12 2L1 22h22L12 2zm0 6l8 14H4l8-14zm-1 4v5h2v-5h-2zm0 7v2h2v-2h-2z"}}
`;
}

export class TextLabelGenerator {
  async generate(
    userPrompt: string,
    target: RenderTarget,
    llmConfig: ActiveLLMConfig,
    override?: TextLabelOverride
  ): Promise<TextLabelGenResult> {
    // 1. LLM 调用 —— override 时把用户偏好塞进 user message，让 LLM 按对应 widget 的
    //    propsSchema 输出 props（否则 LLM 自由选 widget，override 替换 widgetId 后
    //    props 就和新 widget 的 propsSchema 不匹配，缺 required 字段触发验证失败）
    let userContent = userPrompt;
    const hints: string[] = [];
    if (override?.widgetId) {
      const w = getWidget(override.widgetId);
      hints.push(`【强制 widget】"${override.widgetId}"（${w?.displayName ?? ''}）—— 必须严格按该 widget 的 propsSchema 填 props 所有 required 字段`);
    }
    if (override?.fontFamily) {
      hints.push(`【强制字体】"${override.fontFamily}"`);
    }
    if (override?.forceDecoration) {
      hints.push(
        '【必须输出装饰】用户要求必须有装饰花纹。你**必须**输出 decoratorCode 字段（JS 函数代码字符串），调用 ctx.draw API 画图案。\n' +
        '- 必须用 ctx.draw.icon(...) / ctx.draw.flower / ctx.draw.star / ctx.draw.line 等 API（**禁止直接输出 frameSvgPaths 数组**）\n' +
        '- function generate(ctx) 必须 return ctx.draw.getPaths() 或自己累积的 string[]\n' +
        '- 参考主题：从用户 prompt 提取主题元素（番茄→leaf/apple/sprout、圣诞→snowflake/gift、节日→star/sparkles 等）'
      );
    }
    if (hints.length > 0) {
      userContent += '\n\n' + hints.join('\n');
    }

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
          { role: 'user', content: userContent },
        ],
        temperature: 0.9,
        max_tokens: 4000,
        presence_penalty: 0.4,
        frequency_penalty: 0.3,
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

    // 7. sanitize iconSvg（path d 值，仅允许 SVG path 命令字符）
    let iconSvg: string | null = null;
    if (widgetId === 'text-with-icon' && props.iconSvg) {
      iconSvg = this.sanitizePathD(props.iconSvg);
      props.iconSvg = iconSvg;
    }

    // 7.5 sanitize frameSvgPaths（数组，每个 path 单独 sanitize）—— 兼容 LLM 误回 path 数组
    if (Array.isArray(props.frameSvgPaths)) {
      props.frameSvgPaths = props.frameSvgPaths
        .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
        .map((p: string) => this.sanitizePathD(p))
        .filter((p: string) => p.length > 0)
        .slice(0, 24); // 最多 24 个 path 防 LLM 输出爆炸
    } else if (props.frameSvgPaths !== undefined) {
      // LLM 误输出非 array → 删除字段
      delete props.frameSvgPaths;
    }

    // 7.6 v1.5.1: decoratorCode 优先（按需生成）—— 沙箱执行 LLM JS 代码
    let decoratorCode: string | null = null;
    let sandboxFrames: string[] | null = null;
    if (typeof props.decoratorCode === 'string' && props.decoratorCode.trim().length > 0) {
      const code: string = props.decoratorCode;
      decoratorCode = code;
      try {
        const ctx = buildStandardContext(target.widthPx, target.heightPx);
        sandboxFrames = executeDecorator(code, ctx);
        if (sandboxFrames.length > 0) {
          // 覆盖 props.frameSvgPaths（sandbox 输出优先）
          props.frameSvgPaths = sandboxFrames;
        } else {
          // 空数组 → 视为无装饰
          delete props.frameSvgPaths;
        }
      } catch (e) {
        if (e instanceof DecoratorSandboxError) {
          console.warn(`⚠️ decoratorCode sandbox 失败 (${e.stage}): ${e.message.slice(0, 200)}`);
        } else {
          console.warn(`⚠️ decoratorCode 未知错误: ${e instanceof Error ? e.message : String(e)}`);
        }
        // 失败不阻塞 — 删 decoratorCode + frameSvgPaths（label 仍 OK 只是无装饰）
        decoratorCode = null;
        delete props.frameSvgPaths;
      }
      // 从 props 删除 decoratorCode 字段（不需要传给 widget）
      delete props.decoratorCode;
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
      frameSvgPaths: Array.isArray(props.frameSvgPaths) ? props.frameSvgPaths : null,
      decoratorCode,
      fontFamily,
      pngBuffer,
      bitmapBuffer,
      llmLatencyMs,
      llmModel: llmConfig.model,
    };
  }

  /**
   * 仅重渲染 widget（不调用 LLM），用于 regen-decoration 等场景。
   * 给定 widgetId + props + fontFamily + target，跑 satori → sharp → bitmap pack。
   */
  async rerenderWidget(
    widgetId: WidgetId,
    props: Record<string, any>,
    fontFamily: SupportedFontFamily,
    target: RenderTarget
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    const widget = getWidget(widgetId);
    if (!widget) {
      throw new Error(`未知 widget: ${widgetId}`);
    }
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
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const bitmapBuffer = await packFromPng(pngBuffer, target);
    return { pngBuffer, bitmapBuffer };
  }

  /** sanitize path d 值：剥离 LLM 偶尔多出来的 <svg>/<path> 包装，仅保留 d 属性字符 */
  private sanitizePathD(raw: string): string {
    let s = raw.trim();
    // 如果 LLM 误返回完整 <svg>...</svg>，抽出第一个 <path d="..."> 的 d 值
    const pathMatch = s.match(/<path[^>]*\bd\s*=\s*["']([^"']+)["']/i);
    if (pathMatch) {
      s = pathMatch[1];
    }
    // 仅保留 SVG path 命令合法字符：字母 (M/L/H/V/C/S/Q/T/A/Z 大小写) + 数字 + 空格 + 逗号 + 小数点 + 负号 + 指数 e/E
    s = s.replace(/[^a-zA-Z0-9\s,.\-+eE]/g, '');
    return s.trim();
  }
}

export const textLabelGenerator = new TextLabelGenerator();
