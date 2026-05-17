#!/usr/bin/env tsx

/**
 * POC: LLM-Gen 热敏标签 — prompt → LLM → SVG → 1-bit pack → push 真机
 *
 * 用法:
 *   bun run scripts/poc-llm-label.ts "会议室 A 门牌" [endpoint]
 *   bun run scripts/poc-llm-label.ts "番茄 9.9 元 价签" http://192.168.31.186/api/print/raw
 *
 * 环境:
 *   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（从 .env 或 manifest env 读）
 *
 * 验证目标:
 *   1. sharp 渲染 LLM 出的 SVG 字体是否生效（应该用得意黑）
 *   2. threshold(128) 后 1-bit 化效果（噪点 / 笔画粗细）
 *   3. 真机出纸视觉质量
 */

import { promises as fs } from 'fs';
import sharp from 'sharp';
import { niimbotPush } from '../src/react-widgets/core/niimbot-push-module.js';
import { LABEL_T40X20_TARGET } from '../src/react-widgets/core/render-targets.js';

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

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function getLLMConfig(): LLMConfig {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'kimi-for-coding';
  if (!baseUrl || !apiKey) {
    throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY 环境变量');
  }
  return { baseUrl, apiKey, model };
}

async function generateSVG(userPrompt: string, cfg: LLMConfig): Promise<string> {
  const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
  console.log(`📡 LLM 调用: ${cfg.model} @ ${cfg.baseUrl}`);

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
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
  const elapsed = Date.now() - t0;
  console.log(`✅ LLM 响应 ${elapsed}ms，原始内容 ${content.length} 字符`);

  // 提取 SVG（去掉可能残留的 ```xml ... ``` 包裹）
  let svg = content.trim();
  const mdMatch = svg.match(/```(?:xml|svg)?\s*(<svg[\s\S]+?<\/svg>)\s*```/);
  if (mdMatch) svg = mdMatch[1];
  const svgMatch = svg.match(/<svg[\s\S]+?<\/svg>/);
  if (!svgMatch) {
    throw new Error(`LLM 输出未含合法 <svg>...</svg>，前 200 字符: ${content.slice(0, 200)}`);
  }
  return svgMatch[0];
}

async function svgToBitmap(svg: string): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
  const widthPx = LABEL_T40X20_TARGET.widthPx;
  const heightPx = LABEL_T40X20_TARGET.heightPx;

  const pngBuffer = await sharp(Buffer.from(svg), { density: 72 })
    .resize(widthPx, heightPx, { fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();

  const { data: raw } = await sharp(pngBuffer)
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bytesPerRow = widthPx / 8;
  const bitmap = Buffer.alloc(bytesPerRow * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (raw[y * widthPx + x] === 0) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bitmap[byteIdx] |= 1 << bitIdx;
      }
    }
  }
  return { pngBuffer, bitmapBuffer: bitmap };
}

async function main(): Promise<void> {
  const userPrompt = process.argv[2];
  if (!userPrompt) {
    console.error('用法: bun run scripts/poc-llm-label.ts "<中文描述>" [niimbot-endpoint]');
    console.error('例:  bun run scripts/poc-llm-label.ts "会议室 A 门牌"');
    process.exit(2);
  }
  const endpoint = process.argv[3];

  console.log(`🎯 用户输入: "${userPrompt}"`);
  console.log('');

  const cfg = getLLMConfig();
  const svg = await generateSVG(userPrompt, cfg);
  await fs.writeFile('/tmp/poc-llm-label.svg', svg);
  console.log(`💾 SVG 保存 /tmp/poc-llm-label.svg (${svg.length} 字符)`);

  const { pngBuffer, bitmapBuffer } = await svgToBitmap(svg);
  await fs.writeFile('/tmp/poc-llm-label.png', pngBuffer);
  await fs.writeFile('/tmp/poc-llm-label.bin', bitmapBuffer);
  console.log(`🖼️  PNG 保存 /tmp/poc-llm-label.png (${pngBuffer.length} bytes)`);
  console.log(`🧱 1-bit bin 保存 /tmp/poc-llm-label.bin (${bitmapBuffer.length} bytes，预期 6400)`);

  if (!endpoint) {
    console.log('');
    console.log('⏭️  未指定 endpoint，跳过 push。手动打开预览:');
    console.log('   open /tmp/poc-llm-label.png');
    return;
  }

  console.log('');
  console.log(`📤 推送 ${endpoint}`);
  const result = await niimbotPush.push(bitmapBuffer, LABEL_T40X20_TARGET, endpoint);
  console.log(`📋 推送结果:`, result);
  if (!result.queued) {
    console.error('❌ push 失败');
    process.exit(1);
  }
  console.log('🎉 已入队，等真机出纸');
}

main().catch(e => {
  console.error('💥 异常:', e);
  process.exit(1);
});
