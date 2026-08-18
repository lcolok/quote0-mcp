import React from 'react';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import {
  BUILTIN_TARGETS,
  type RenderTarget,
} from '../react-widgets/core/render-targets.js';
import { SatoriNewsWidget } from '../react-widgets/components/SatoriNewsWidget.js';
import { toHighlightedWords } from '../react-widgets/core/rendering-modules.js';
import {
  satoriRenderer,
  type SatoriPipelineMetrics,
} from '../react-widgets/core/satori-renderer.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import { planAdaptiveLayout, type AdaptiveLayoutPlan } from '../react-widgets/core/adaptive-layout.js';
import { renderableNewsToAdaptiveDocument } from '../react-widgets/core/adaptive-document-adapters.js';
import {
  ADAPTIVE_SATORI_RENDERER_VERSION,
  renderAdaptiveDocumentWithSatori,
} from '../react-widgets/core/adaptive-satori-renderer.js';

export const ADAPTIVE_REVIEW_VERSION = 'adaptive-review/v2';
export const CURRENT_NEWS_RENDERER_VERSION = 'current-satori-news/v1';

export interface BitmapMetrics {
  bytes: number;
  expectedBytes: number;
  burnBits: number;
  burnRatio: number;
  bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

export interface AdaptiveComparisonSide {
  renderer: string;
  image: {
    mimeType: 'image/png';
    bytes: number;
    base64: string;
  };
  renderMetrics: SatoriPipelineMetrics;
  bitmapMetrics: BitmapMetrics;
}

export interface AdaptiveComparisonResult {
  version: typeof ADAPTIVE_REVIEW_VERSION;
  subject: {
    id: number;
    fingerprint: string | null;
    title: string;
    source: string;
    contentOrigin: 'neuromancer' | 'processed' | 'delivery';
  };
  target: RenderTarget;
  layoutPlan: AdaptiveLayoutPlan;
  primary: AdaptiveComparisonSide & {
    baselineRole: 'authoritative-current' | 'legacy-projection';
  };
  adaptive: AdaptiveComparisonSide;
  comparison: {
    burnBitsDelta: number;
    burnRatioDelta: number;
    adaptiveToPrimaryBurnRatio: number | null;
    renderMsDelta: number;
    adaptiveToPrimaryRenderRatio: number | null;
  };
}

const RUNTIME_T50X30_TARGET: RenderTarget = {
  id: 'thermal-runtime-T50x30-400x240',
  kind: 'thermal-label',
  widthPx: 400,
  heightPx: 240,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 50, heightMm: 30 },
  defaultFontStack: ['smiley-sans'],
};

export const ADAPTIVE_REVIEW_TARGETS: RenderTarget[] = [
  ...BUILTIN_TARGETS,
  RUNTIME_T50X30_TARGET,
];

export function resolveAdaptiveReviewTarget(targetId: string | undefined): RenderTarget {
  return ADAPTIVE_REVIEW_TARGETS.find((target) => target.id === targetId)
    ?? ADAPTIVE_REVIEW_TARGETS.find((target) => target.id === 'eink-296x152')!;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function buildRenderableFromPushRow(row: Record<string, any>): RenderableDataItem {
  const raw = asRecord(row.raw_content);
  const processed = asRecord(row.processed_content);
  const metadata = asRecord(processed.metadata);
  const title = cleanString(processed.title) || cleanString(row.title) || cleanString(raw.title) || '未知标题';
  const message = cleanString(processed.message)
    || cleanString(processed.summary)
    || cleanString(raw.content)
    || cleanString(raw.description);
  const signature = cleanString(processed.signature) || (metadata.producer === 'external-renderable-agent' ? '神经漫游者' : 'RSS智能');
  const source = cleanString(processed.source) || cleanString(row.source) || cleanString(raw.source) || cleanString(row.job_id) || 'unknown';
  const category = cleanString(processed.category) || cleanString(row.category) || cleanString(raw.category) || '新闻';
  const link = cleanString(processed.link) || cleanString(row.link) || cleanString(raw.link) || undefined;
  const publishTime = cleanString(processed.publishTime)
    || cleanString(raw.publishTime)
    || (row.pushed_at ? new Date(row.pushed_at).toISOString() : new Date().toISOString());
  return {
    id: String(row.id),
    title,
    message,
    signature,
    source,
    publishTime,
    category,
    link,
    highlights: Array.isArray(processed.highlights)
      ? processed.highlights.filter((item: unknown): item is string => typeof item === 'string')
      : undefined,
    metadata: {
      ...metadata,
      ...(metadata.researchReceipt ? {} : raw.researchReceipt ? { researchReceipt: raw.researchReceipt } : {}),
    },
  };
}

export function measurePackedBitmap(buffer: Buffer, target: RenderTarget): BitmapMetrics {
  if (target.widthPx % 8 !== 0) throw new Error(`Target width must be divisible by 8: ${target.widthPx}`);
  const bytesPerRow = target.widthPx / 8;
  const expectedBytes = bytesPerRow * target.heightPx;
  if (buffer.length !== expectedBytes) {
    throw new Error(`Bitmap size mismatch: got ${buffer.length}, expected ${expectedBytes}`);
  }
  let burnBits = 0;
  let minX = target.widthPx;
  let minY = target.heightPx;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < target.heightPx; y += 1) {
    for (let byteX = 0; byteX < bytesPerRow; byteX += 1) {
      const byte = buffer[y * bytesPerRow + byteX] ?? 0;
      if (byte === 0) continue;
      for (let bit = 0; bit < 8; bit += 1) {
        if ((byte & (1 << (7 - bit))) === 0) continue;
        const x = byteX * 8 + bit;
        burnBits += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const totalPixels = target.widthPx * target.heightPx;
  return {
    bytes: buffer.length,
    expectedBytes,
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

function originForRow(row: Record<string, any>): 'neuromancer' | 'processed' | 'delivery' {
  const processed = asRecord(row.processed_content);
  const metadata = asRecord(processed.metadata);
  if (row.layer === 'external-renderable' || row.job_id === 'renderable-intake' || metadata.producer === 'external-renderable-agent' || processed.signature === '神经漫游者') {
    return 'neuromancer';
  }
  if (processed.title || processed.message || processed.signature) return 'processed';
  return 'delivery';
}

export async function renderAdaptiveComparison(
  row: Record<string, any>,
  target: RenderTarget,
): Promise<AdaptiveComparisonResult> {
  const renderable = buildRenderableFromPushRow(row);
  const currentNewsData = {
    title: renderable.title,
    message: renderable.message,
    signature: renderable.signature,
    source: renderable.source,
    publishTime: renderable.publishTime,
    category: renderable.category,
    link: renderable.link,
    highlights: toHighlightedWords(renderable.message, renderable.highlights),
  };
  const document = renderableNewsToAdaptiveDocument(renderable);
  const layoutPlan = planAdaptiveLayout(document, target);

  const [primaryRendered, adaptiveRendered] = await Promise.all([
    satoriRenderer.renderToImageWithMetrics(
      React.createElement(SatoriNewsWidget, { data: currentNewsData, target }),
      { width: target.widthPx, height: target.heightPx, backgroundColor: '#ffffff' },
    ),
    renderAdaptiveDocumentWithSatori(document, target, layoutPlan),
  ]);
  const [primaryBitmap, adaptiveBitmap] = await Promise.all([
    packFromPng(primaryRendered.pngBuffer, target),
    packFromPng(adaptiveRendered.pngBuffer, target),
  ]);
  const primaryBitmapMetrics = measurePackedBitmap(primaryBitmap, target);
  const adaptiveBitmapMetrics = measurePackedBitmap(adaptiveBitmap, target);
  const primaryMs = primaryRendered.metrics.totalMs;
  const adaptiveMs = adaptiveRendered.metrics.totalMs;

  return {
    version: ADAPTIVE_REVIEW_VERSION,
    subject: {
      id: Number(row.id),
      fingerprint: cleanString(row.fingerprint) || null,
      title: renderable.title,
      source: renderable.source,
      contentOrigin: originForRow(row),
    },
    target,
    layoutPlan,
    primary: {
      renderer: CURRENT_NEWS_RENDERER_VERSION,
      baselineRole: target.kind === 'eink' ? 'authoritative-current' : 'legacy-projection',
      image: {
        mimeType: 'image/png',
        bytes: primaryRendered.pngBuffer.length,
        base64: primaryRendered.pngBuffer.toString('base64'),
      },
      renderMetrics: primaryRendered.metrics,
      bitmapMetrics: primaryBitmapMetrics,
    },
    adaptive: {
      renderer: ADAPTIVE_SATORI_RENDERER_VERSION,
      image: {
        mimeType: 'image/png',
        bytes: adaptiveRendered.pngBuffer.length,
        base64: adaptiveRendered.pngBuffer.toString('base64'),
      },
      renderMetrics: adaptiveRendered.metrics,
      bitmapMetrics: adaptiveBitmapMetrics,
    },
    comparison: {
      burnBitsDelta: adaptiveBitmapMetrics.burnBits - primaryBitmapMetrics.burnBits,
      burnRatioDelta: Math.round((adaptiveBitmapMetrics.burnRatio - primaryBitmapMetrics.burnRatio) * 10_000) / 10_000,
      adaptiveToPrimaryBurnRatio: primaryBitmapMetrics.burnBits > 0
        ? Math.round((adaptiveBitmapMetrics.burnBits / primaryBitmapMetrics.burnBits) * 10_000) / 10_000
        : null,
      renderMsDelta: Math.round((adaptiveMs - primaryMs) * 100) / 100,
      adaptiveToPrimaryRenderRatio: primaryMs > 0
        ? Math.round((adaptiveMs / primaryMs) * 10_000) / 10_000
        : null,
    },
  };
}
