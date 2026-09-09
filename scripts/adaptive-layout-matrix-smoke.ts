import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { planAdaptiveLayout } from '../src/react-widgets/core/adaptive-layout.js';
import { renderableNewsToAdaptiveDocument } from '../src/react-widgets/core/adaptive-document-adapters.js';
import type { RenderableDataItem } from '../src/react-widgets/core/modular-architecture.js';
import { renderAdaptiveDocumentWithSatori } from '../src/react-widgets/core/adaptive-satori-renderer.js';
import { packFromPng } from '../src/react-widgets/core/bitmap-packer.js';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';
import { TrmnlAdaptiveRenderer } from '../src/react-widgets/core/trmnl-adaptive-renderer.js';
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

const renderable: RenderableDataItem = {
  id: 'neuromancer-mcp-stateless',
  signature: '神经漫游者',
  title: 'MCP 新规范取消会话',
  message: 'MCP 2026-07-28 新规范移除协议层会话和 initialize 握手，请求加入 Mcp-Method、Mcp-Name 等自描述头，便于网关做路由、限流与计量。',
  source: 'MCP 官方规范 · Quote0',
  publishTime: '2026-07-28T00:00:00Z',
  category: 'news',
  highlights: ['Mcp-Method', 'Mcp-Name'],
  metadata: {
    researchReceipt: {
      agent: 'neuromancer',
      sources: [{ id: 'seed' }, { id: 'official' }, { id: 'primary' }],
      claims: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    },
  },
};

const document = renderableNewsToAdaptiveDocument(renderable);
const targets: RenderTarget[] = [
  LABEL_T20X8_TARGET,
  EINK_296X128_TARGET,
  EINK_TARGET,
  LABEL_T40X20_TARGET,
  runtimeT50x30,
];

async function pngIdentity(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  return { width: metadata.width, height: metadata.height, bytes: buffer.length };
}

function monoBitmapMetrics(buffer: Buffer, target: RenderTarget) {
  const bytesPerRow = target.widthPx / 8;
  let burnBits = 0;
  let minX = target.widthPx;
  let minY = target.heightPx;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < target.heightPx; y += 1) {
    for (let x = 0; x < target.widthPx; x += 1) {
      const byte = buffer[y * bytesPerRow + Math.floor(x / 8)] ?? 0;
      const burned = (byte & (1 << (7 - (x % 8)))) !== 0;
      if (!burned) continue;
      burnBits += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const totalPixels = target.widthPx * target.heightPx;
  return {
    bytes: buffer.length,
    expectedBytes: bytesPerRow * target.heightPx,
    burnBits,
    burnRatio: Math.round((burnBits / totalPixels) * 10_000) / 10_000,
    bounds: maxX < 0 ? null : {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

async function main() {
  const outputDir = path.resolve('processed-images', 'adaptive-layout-matrix');
  await mkdir(outputDir, { recursive: true });
  const trmnlRenderer = new TrmnlAdaptiveRenderer();
  const rows: Array<Record<string, unknown>> = [];

  try {
    for (const target of targets) {
      const layoutPlan = planAdaptiveLayout(document, target);
      const satori = await renderAdaptiveDocumentWithSatori(document, target, layoutPlan);
      const trmnl = await trmnlRenderer.renderDocument(document, target, { timeoutMs: 30_000 });
      if (target.widthPx % 8 !== 0) throw new Error(`1-bit harness requires width divisible by 8: ${target.id}`);
      const [satoriBitmap, trmnlBitmap] = await Promise.all([
        packFromPng(satori.pngBuffer, target),
        packFromPng(trmnl.pngBuffer, target),
      ]);
      const satoriPath = path.join(outputDir, `${target.id}-satori.png`);
      const trmnlPath = path.join(outputDir, `${target.id}-trmnl.png`);
      const satoriBitmapPath = path.join(outputDir, `${target.id}-satori.bin`);
      const trmnlBitmapPath = path.join(outputDir, `${target.id}-trmnl.bin`);
      await Promise.all([
        writeFile(satoriPath, satori.pngBuffer),
        writeFile(trmnlPath, trmnl.pngBuffer),
        writeFile(satoriBitmapPath, satoriBitmap),
        writeFile(trmnlBitmapPath, trmnlBitmap),
      ]);

      const satoriPng = await pngIdentity(satori.pngBuffer);
      const trmnlPng = await pngIdentity(trmnl.pngBuffer);
      const satoriMono = monoBitmapMetrics(satoriBitmap, target);
      const trmnlMono = monoBitmapMetrics(trmnlBitmap, target);
      const planParity = JSON.stringify(layoutPlan) === JSON.stringify(trmnl.layoutPlan);
      const row = {
        targetId: target.id,
        kind: target.kind,
        dimensions: `${target.widthPx}x${target.heightPx}`,
        density: layoutPlan.density,
        visibleNodeIds: layoutPlan.visibleNodeIds,
        hiddenNodeIds: layoutPlan.hiddenNodeIds,
        decisions: layoutPlan.decisions,
        planParity,
        satori: {
          renderMs: satori.renderMs,
          metrics: satori.metrics,
          png: satoriPng,
          mono: satoriMono,
          output: satoriPath,
          bitmapOutput: satoriBitmapPath,
        },
        trmnl: {
          renderMs: trmnl.metrics.renderMs,
          png: trmnlPng,
          mono: trmnlMono,
          overflow: trmnl.metrics.overflow,
          frameworkBuild: trmnl.metrics.frameworkBuild,
          output: trmnlPath,
          bitmapOutput: trmnlBitmapPath,
        },
        speedRatioTrmnlToSatori: Math.round((trmnl.metrics.renderMs / Math.max(satori.renderMs, 0.01)) * 100) / 100,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await trmnlRenderer.close();
    await satoriRenderer.close();
  }

  const report = {
    renderable,
    adaptiveDocument: document,
    targetCount: rows.length,
    allPlanParity: rows.every((row) => row.planParity === true),
    allExactDimensions: rows.every((row) => {
      const target = targets.find((candidate) => candidate.id === row.targetId)!;
      const satori = (row.satori as { png: { width?: number; height?: number } }).png;
      const trmnl = (row.trmnl as { png: { width?: number; height?: number } }).png;
      return satori.width === target.widthPx && satori.height === target.heightPx
        && trmnl.width === target.widthPx && trmnl.height === target.heightPx;
    }),
    allTrmnlNoOverflow: rows.every((row) => {
      const overflow = (row.trmnl as { overflow: { horizontal: boolean; vertical: boolean } }).overflow;
      return !overflow.horizontal && !overflow.vertical;
    }),
    allPackedExact: rows.every((row) => {
      const satori = (row.satori as { mono: { bytes: number; expectedBytes: number } }).mono;
      const trmnl = (row.trmnl as { mono: { bytes: number; expectedBytes: number } }).mono;
      return satori.bytes === satori.expectedBytes && trmnl.bytes === trmnl.expectedBytes;
    }),
    allBitmapsNonBlank: rows.every((row) => {
      const satori = (row.satori as { mono: { burnBits: number } }).mono;
      const trmnl = (row.trmnl as { mono: { burnBits: number } }).mono;
      return satori.burnBits > 0 && trmnl.burnBits > 0;
    }),
    rows,
  };
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ summary: {
    targetCount: report.targetCount,
    allPlanParity: report.allPlanParity,
    allExactDimensions: report.allExactDimensions,
    allTrmnlNoOverflow: report.allTrmnlNoOverflow,
    allPackedExact: report.allPackedExact,
    allBitmapsNonBlank: report.allBitmapsNonBlank,
  } }));

  if (
    !report.allPlanParity ||
    !report.allExactDimensions ||
    !report.allTrmnlNoOverflow ||
    !report.allPackedExact ||
    !report.allBitmapsNonBlank
  ) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
