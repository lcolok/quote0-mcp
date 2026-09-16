/**
 * VisionHub 内化链路 E2E —— 真调 TuZi 出 1 张图，验证「出图 → 立即转存 VisionHub → 体系内公网取回」。
 *
 * 覆盖路径：image-label-generator.generate → tuzi-client → 上游 data[0].url → 下载原图
 *          → visionHubClient.uploadSourceImage → sourceImageUrl(VH 公网 URL) → 裸 URL / ?f=png 取回
 * 不连 DB / MinIO（只验证内化与取回，落库由 job worker 负责）。
 *
 * 开发机运行（容器内网地址不可达时用公网入口做上传）：
 *   VISION_HUB_INTERNAL_BASE=https://vision-hub.logic.heiyu.space bun run scripts/test-vision-hub-e2e.ts
 * 容器内运行时缺省即为内网地址 http://web.me.friday.vision-hub.lzcapp:3000，无需额外 env。
 *
 * 产物：/tmp/vh-e2e-source.png（?f=png 强制无损版）、/tmp/vh-e2e-dithered.png（320×160 1-bit）
 */
import fs from 'fs';
import sharp from 'sharp';
import { imageLabelGenerator } from '../src/react-widgets/services/image-label-generator.js';
import { resolveInternalBase, resolvePublicBase } from '../src/react-widgets/services/vision-hub-client.js';
import type { RenderTarget } from '../src/react-widgets/core/render-targets.js';

const PROMPT = '一只可爱的卡通猫咪图标，圆润的线条，粗黑描边';
const MODEL = 'tuzi:gpt-image-2.5';
const SOURCE_OUT = '/tmp/vh-e2e-source.png';
const DITHERED_OUT = '/tmp/vh-e2e-dithered.png';

/** PNG 文件魔数（f=png 强制无损重编码后应原样保留） */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 与 LABEL_T40X20_TARGET 同几何的 40×20mm / 203dpi 热敏标签
const target: RenderTarget = {
  id: 'label-vh-e2e-320x160',
  kind: 'thermal-label',
  widthPx: 320,
  heightPx: 160,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 40, heightMm: 20 },
  defaultFontStack: ['smiley-sans'],
};

const internalBase = resolveInternalBase();
const publicBase = resolvePublicBase();
const PUBLIC_PREFIX = `${publicBase}/api/images/`;

console.log(`[vh-e2e] model=${MODEL} target=${target.widthPx}×${target.heightPx}`);
console.log(`[vh-e2e] 上传入口 = ${internalBase}  公网入口 = ${publicBase}`);
console.log(`[vh-e2e] prompt=${PROMPT}`);

// ── 1. 出图 + 内化（generate 内部已完成 VH 转存）──
const genStartedAt = Date.now();
let result: Awaited<ReturnType<typeof imageLabelGenerator.generate>>;
try {
  result = await imageLabelGenerator.generate(PROMPT, MODEL, target);
} catch (e) {
  console.error(`[vh-e2e] ❌ 出图/内化失败（${Date.now() - genStartedAt}ms）:`, e instanceof Error ? e.message : e);
  process.exit(1);
}
const genMs = Date.now() - genStartedAt;

let failed = false;

// ── 2. sourceImageUrl 必须是体系内 VH URL ──
console.log(`[vh-e2e] sourceImageUrl = ${result.sourceImageUrl}`);
if (!result.sourceImageUrl.startsWith(PUBLIC_PREFIX)) {
  console.error(`[vh-e2e] ❌ sourceImageUrl 不是 VisionHub 公网 URL（期望前缀 ${PUBLIC_PREFIX}）`);
  failed = true;
}

// ── 3. 裸 URL 取回（浏览器展示路径）──
const bareStartedAt = Date.now();
const bareRes = await fetch(result.sourceImageUrl, { signal: AbortSignal.timeout(60_000) });
const bareMs = Date.now() - bareStartedAt;
const bareBuffer = Buffer.from(await bareRes.arrayBuffer());
console.log(
  `[vh-e2e] 裸 URL    → HTTP ${bareRes.status}  ${bareBuffer.length}B  ${bareRes.headers.get('content-type')}  ${bareMs}ms`
);
if (!bareRes.ok || bareBuffer.length === 0) {
  console.error(`[vh-e2e] ❌ 裸 URL 取回失败: HTTP ${bareRes.status} / ${bareBuffer.length}B`);
  failed = true;
}

// ── 4. ?f=png 保真取回（redither 下载路径）──
const fidelityUrl = `${result.sourceImageUrl}?f=png`;
const pngStartedAt = Date.now();
const pngRes = await fetch(fidelityUrl, { signal: AbortSignal.timeout(60_000) });
const pngMs = Date.now() - pngStartedAt;
const sourceBuffer = Buffer.from(await pngRes.arrayBuffer());
console.log(
  `[vh-e2e] ?f=png     → HTTP ${pngRes.status}  ${sourceBuffer.length}B  ${pngRes.headers.get('content-type')}  ${pngMs}ms`
);
if (!pngRes.ok || sourceBuffer.length === 0) {
  console.error(`[vh-e2e] ❌ ?f=png 取回失败: HTTP ${pngRes.status} / ${sourceBuffer.length}B`);
  failed = true;
}
if (!sourceBuffer.subarray(0, 8).equals(PNG_MAGIC)) {
  console.error(`[vh-e2e] ❌ ?f=png 返回非 PNG（魔数不符）: ${sourceBuffer.subarray(0, 8).toString('hex')}`);
  failed = true;
}

// ── 5. 落盘 + 元数据 ──
fs.writeFileSync(SOURCE_OUT, sourceBuffer);
fs.writeFileSync(DITHERED_OUT, result.pngBuffer);

const sourceMeta = await sharp(sourceBuffer).metadata();
const ditheredMeta = await sharp(result.pngBuffer).metadata();

console.log(
  `[vh-e2e] source   → ${SOURCE_OUT}  ${sourceBuffer.length}B  ${sourceMeta.width}×${sourceMeta.height} ${sourceMeta.format}`
);
console.log(
  `[vh-e2e] dithered → ${DITHERED_OUT}  ${result.pngBuffer.length}B  ${ditheredMeta.width}×${ditheredMeta.height} ${ditheredMeta.format}`
);
console.log(`[vh-e2e] 耗时: 出图+内化 ${genMs}ms（上游 ${result.bizyairLatencyMs}ms） / 裸取回 ${bareMs}ms / 保真取回 ${pngMs}ms`);

if (ditheredMeta.width !== target.widthPx || ditheredMeta.height !== target.heightPx) {
  console.error(`[vh-e2e] ❌ dither 尺寸不符: ${ditheredMeta.width}×${ditheredMeta.height} ≠ ${target.widthPx}×${target.heightPx}`);
  failed = true;
}

console.log(failed ? '[vh-e2e] ❌ 校验未通过' : '[vh-e2e] ✅ 通过');
process.exit(failed ? 1 : 0);
