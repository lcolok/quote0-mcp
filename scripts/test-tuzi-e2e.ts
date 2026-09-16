/**
 * TuZi 出图链路 E2E —— 真调 copilot 网关（生产）生成 1 张 low quality 图并落盘。
 *
 * 覆盖路径：image-label-generator → tuzi-client → 上游 data[0].url → 下载原图 → dither 1-bit PNG。
 * 不连 DB / MinIO（只验证出图与抖动，落库由 job worker 负责）。
 *
 *   bun run scripts/test-tuzi-e2e.ts
 *
 * 产物：/tmp/tuzi-e2e-source.png（上游原图）、/tmp/tuzi-e2e-dithered.png（320×160 1-bit）
 */
import fs from 'fs';
import sharp from 'sharp';
import { imageLabelGenerator } from '../src/react-widgets/services/image-label-generator.js';
import type { RenderTarget } from '../src/react-widgets/core/render-targets.js';

const PROMPT = '一只可爱的卡通猫咪图标，圆润的线条，粗黑描边';
const MODEL = 'tuzi:gpt-image-2.5';
const SOURCE_OUT = '/tmp/tuzi-e2e-source.png';
const DITHERED_OUT = '/tmp/tuzi-e2e-dithered.png';

// 与 LABEL_T40X20_TARGET 同几何的 40×20mm / 203dpi 热敏标签
const target: RenderTarget = {
  id: 'label-tuzi-e2e-320x160',
  kind: 'thermal-label',
  widthPx: 320,
  heightPx: 160,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 40, heightMm: 20 },
  defaultFontStack: ['smiley-sans'],
};

const EXPECTED_BITMAP_BYTES = Math.ceil(target.widthPx / 8) * target.heightPx; // 320/8×160 = 6400

console.log(`[e2e] model=${MODEL} target=${target.widthPx}×${target.heightPx} (size 档由后端按纵横推导)`);
console.log(`[e2e] prompt=${PROMPT}`);

const startedAt = Date.now();
let result: Awaited<ReturnType<typeof imageLabelGenerator.generate>>;
try {
  result = await imageLabelGenerator.generate(PROMPT, MODEL, target);
} catch (e) {
  console.error(`[e2e] ❌ 出图失败（${Date.now() - startedAt}ms）:`, e instanceof Error ? e.message : e);
  process.exit(1);
}
const wallMs = Date.now() - startedAt;

// 上游原图另存：目视对比 dither 前后的损失
const srcRes = await fetch(result.sourceImageUrl, { signal: AbortSignal.timeout(60_000) });
if (!srcRes.ok) {
  console.error(`[e2e] ❌ 下载上游原图失败 HTTP ${srcRes.status} @ ${result.sourceImageUrl}`);
  process.exit(1);
}
const sourceBuffer = Buffer.from(await srcRes.arrayBuffer());
fs.writeFileSync(SOURCE_OUT, sourceBuffer);
fs.writeFileSync(DITHERED_OUT, result.pngBuffer);

const sourceMeta = await sharp(sourceBuffer).metadata();
const ditheredMeta = await sharp(result.pngBuffer).metadata();

// 校验 dither 结果是纯二值（黑/白两色）。注意 PNG 容器是 8-bit RGB —— 这是 sharp 在
// ditherToOutputs 里的既有编码选择（本任务未改动该路径）；语义上的 1-bit 由 bitmapBuffer 承载。
const { data: pixels, info: pixelInfo } = await sharp(result.pngBuffer)
  .raw()
  .toBuffer({ resolveWithObject: true });
const uniqueColors = new Set<string>();
for (let i = 0; i < pixels.length; i += pixelInfo.channels) {
  uniqueColors.add(Array.from(pixels.subarray(i, i + pixelInfo.channels)).join(','));
}

console.log(`[e2e] 上游原图 url = ${result.sourceImageUrl}`);
console.log(`[e2e] 耗时: 端到端 ${wallMs}ms（client 实测 ${result.bizyairLatencyMs}ms）`);
console.log(
  `[e2e] source   → ${SOURCE_OUT}  ${sourceBuffer.length}B  ${sourceMeta.width}×${sourceMeta.height} ${sourceMeta.format}`,
);
console.log(
  `[e2e] dithered → ${DITHERED_OUT}  ${result.pngBuffer.length}B  ` +
  `${ditheredMeta.width}×${ditheredMeta.height} ${ditheredMeta.format} 调色板=${uniqueColors.size}色`,
);
console.log(`[e2e] bitmap   → ${result.bitmapBuffer.length}B（期望 ${EXPECTED_BITMAP_BYTES}B，niimbot 直推用）`);

let failed = false;
if (ditheredMeta.width !== target.widthPx || ditheredMeta.height !== target.heightPx) {
  console.error(`[e2e] ❌ dither 尺寸不符: ${ditheredMeta.width}×${ditheredMeta.height} ≠ ${target.widthPx}×${target.heightPx}`);
  failed = true;
}
if (uniqueColors.size !== 2) {
  console.error(`[e2e] ❌ dither 结果非二值（应恰好黑/白两色）: ${uniqueColors.size} 色 → ${[...uniqueColors].slice(0, 6)}`);
  failed = true;
}
if (result.bitmapBuffer.length !== EXPECTED_BITMAP_BYTES) {
  console.error(`[e2e] ❌ bitmap 体积不符: ${result.bitmapBuffer.length} ≠ ${EXPECTED_BITMAP_BYTES}`);
  failed = true;
}
if (/^https?:\/\//.test(result.sourceImageUrl) === false) {
  console.error(`[e2e] ❌ sourceImageUrl 不是 http(s) 链接: ${result.sourceImageUrl}`);
  failed = true;
}

console.log(failed ? '[e2e] ❌ 校验未通过' : '[e2e] ✅ 通过');
process.exit(failed ? 1 : 0);
