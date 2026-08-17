import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  TrmnlAdaptiveRenderer,
  type TrmnlAdaptiveContent,
} from '../src/react-widgets/core/trmnl-adaptive-renderer.js';
import {
  EINK_296X128_TARGET,
  EINK_TARGET,
  LABEL_T20X8_TARGET,
  LABEL_T40X20_TARGET,
  type RenderTarget,
} from '../src/react-widgets/core/render-targets.js';

const runtimeT50x30: RenderTarget = {
  id: 'thermal-runtime-T50x30-400x240',
  kind: 'thermal-label',
  widthPx: 400,
  heightPx: 240,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 50, heightMm: 30 },
  defaultFontStack: ['smiley-sans'],
};

const content: TrmnlAdaptiveContent = {
  eyebrow: 'QUOTE0 · ADAPTIVE CONTENT',
  title: '同一份内容模型，自动适配墨水屏、窄热敏标签与宽热敏标签',
  body: '这是一段故意超过最小画布容量的压力文本。TRMNL Runtime 应根据目标空间重新测量、限制正文并处理换行，而不是要求 Quote0 为每一种纸张尺寸复制模板。内容模型保持完全不变，设备只提供宽高、位深与缩放参数；当空间不足时应由 Framework 的 Clamp 或 Content Limiter 有损降级，但绝不能把画布撑出目标边界。',
  footer: 'TRMNL 3.2 · Quote0 canary',
};

const targets: RenderTarget[] = [
  LABEL_T20X8_TARGET,
  EINK_296X128_TARGET,
  EINK_TARGET,
  LABEL_T40X20_TARGET,
  runtimeT50x30,
];

async function foregroundBounds(buffer: Buffer) {
  const { data, info } = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let darkPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] >= 245) continue;
      darkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    darkPixels,
    bounds: maxX < 0 ? null : { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

async function main() {
  const outputDir = path.resolve('processed-images', 'trmnl-adaptive-smoke');
  await mkdir(outputDir, { recursive: true });
  const renderer = new TrmnlAdaptiveRenderer();
  const rows: Array<Record<string, unknown>> = [];

  try {
    for (const target of targets) {
      const result = await renderer.render(content, target, { timeoutMs: 30_000 });
      const pngPath = path.join(outputDir, `${target.id}.png`);
      await writeFile(pngPath, result.pngBuffer);
      const metadata = await sharp(result.pngBuffer).metadata();
      const foreground = await foregroundBounds(result.pngBuffer);
      const row = {
        targetId: target.id,
        kind: target.kind,
        widthPx: target.widthPx,
        heightPx: target.heightPx,
        physical: target.physical ?? null,
        profile: result.profile,
        png: { width: metadata.width, height: metadata.height, bytes: result.pngBuffer.length },
        foreground,
        metrics: result.metrics,
        output: pngPath,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await renderer.close();
  }

  const report = {
    content,
    targetCount: rows.length,
    allExactDimensions: rows.every((row) => {
      const png = row.png as { width?: number; height?: number };
      return png.width === row.widthPx && png.height === row.heightPx;
    }),
    allNoOverflow: rows.every((row) => {
      const metrics = row.metrics as { overflow: { horizontal: boolean; vertical: boolean } };
      return !metrics.overflow.horizontal && !metrics.overflow.vertical;
    }),
    rows,
  };
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ summary: { targetCount: report.targetCount, allExactDimensions: report.allExactDimensions, allNoOverflow: report.allNoOverflow } }));

  if (!report.allExactDimensions || !report.allNoOverflow) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
