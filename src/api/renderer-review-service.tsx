import type { RenderTarget } from '../react-widgets/core/render-targets.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import {
  trmnlAdaptiveRenderer,
  type TrmnlAdaptiveContent,
  type TrmnlAdaptiveRenderResult,
  type TrmnlRenderMetrics,
} from '../react-widgets/core/trmnl-adaptive-renderer.js';
import {
  ADAPTIVE_REFERENCE_RENDERER_VERSION,
  CURRENT_SATORI_RENDERER_VERSION,
  RENDERER_GOVERNANCE_VERSION,
  RENDERER_TRACKS,
  TRMNL_FRAMEWORK_RENDERER_VERSION,
  TRMNL_PROMOTION_GATE,
  rendererGovernanceForTarget,
} from '../react-widgets/core/renderer-governance.js';
import {
  ADAPTIVE_REVIEW_TARGETS,
  buildRenderableFromPushRow,
  measurePackedBitmap,
  renderAdaptiveComparison,
  resolveAdaptiveReviewTarget,
  type AdaptiveComparisonSide,
  type BitmapMetrics,
} from './adaptive-review-service.js';

export const RENDERER_REVIEW_VERSION = 'renderer-review/v1';
export { ADAPTIVE_REVIEW_TARGETS as RENDERER_REVIEW_TARGETS, resolveAdaptiveReviewTarget as resolveRendererReviewTarget };

export interface RendererComparisonSide {
  renderer: string;
  lifecycle: 'authoritative' | 'canary' | 'reference';
  image: {
    mimeType: 'image/png';
    bytes: number;
    base64: string;
  };
  renderMetrics: {
    totalMs: number;
    frameworkVersion?: string;
    recipeVersion?: string;
    frameworkBuild?: string | null;
    overflow?: { horizontal: boolean; vertical: boolean };
    regions?: TrmnlRenderMetrics['regions'];
    typography?: TrmnlRenderMetrics['typography'];
    pageReused?: boolean;
    assetSource?: 'local-pinned' | 'remote';
    browserInitMs?: number;
    frameworkLoadMs?: number;
    domMutationMs?: number;
    terminalizeMs?: number;
    screenshotMs?: number;
  };
  bitmapMetrics: BitmapMetrics;
  frameworkMetrics?: unknown;
}

export interface RendererComparisonResult {
  version: typeof RENDERER_REVIEW_VERSION;
  governanceVersion: typeof RENDERER_GOVERNANCE_VERSION;
  subject: {
    id: number;
    fingerprint: string | null;
    title: string;
    source: string;
    contentOrigin: 'neuromancer' | 'processed' | 'delivery';
  };
  target: RenderTarget;
  governance: {
    tracks: typeof RENDERER_TRACKS;
    target: ReturnType<typeof rendererGovernanceForTarget>;
    promotionGate: typeof TRMNL_PROMOTION_GATE;
  };
  primary: RendererComparisonSide & {
    baselineRole: 'authoritative-current' | 'legacy-projection';
  };
  candidate: RendererComparisonSide;
  reference: RendererComparisonSide & {
    frozen: true;
  };
  comparison: {
    blackBitsDelta: number;
    blackRatioDelta: number;
    candidateToPrimaryBlackRatio: number | null;
    renderMsDelta: number;
    candidateToPrimaryRenderRatio: number | null;
  };
  changesPhysicalDelivery: false;
}

const TRMNL_CACHE_TTL_MS = 5 * 60_000;
const TRMNL_CACHE_MAX_ENTRIES = 128;
const trmnlResultCache = new Map<string, { expiresAt: number; result: TrmnlAdaptiveRenderResult }>();
const trmnlInFlight = new Map<string, Promise<TrmnlAdaptiveRenderResult>>();
let trmnlQueueTail: Promise<void> = Promise.resolve();

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function buildTrmnlReviewContent(row: Record<string, any>): TrmnlAdaptiveContent {
  const renderable = buildRenderableFromPushRow(row);
  const metadata = asRecord(renderable.metadata);
  const receipt = asRecord(metadata?.researchReceipt);
  const isResearch = Boolean(receipt)
    || renderable.signature === '神经漫游者'
    || metadata?.producer === 'external-renderable-agent';
  const sources = Array.isArray(receipt?.sources) ? receipt.sources.length : 0;
  const claims = Array.isArray(receipt?.claims) ? receipt.claims.length : 0;

  return {
    title: renderable.title,
    body: renderable.message,
    eyebrow: isResearch ? 'NEUROMANCER · RESEARCH' : undefined,
    footer: isResearch && (sources > 0 || claims > 0)
      ? `${renderable.source} · ${sources} sources · ${claims} claims`
      : `来源: ${renderable.source}`,
  };
}

function trmnlCacheKey(row: Record<string, any>, target: RenderTarget): string {
  return [row.id, row.fingerprint ?? '', target.id, TRMNL_FRAMEWORK_RENDERER_VERSION].join(':');
}

function pruneTrmnlCache(now = Date.now()): void {
  for (const [key, entry] of trmnlResultCache) {
    if (entry.expiresAt <= now) trmnlResultCache.delete(key);
  }
  while (trmnlResultCache.size >= TRMNL_CACHE_MAX_ENTRIES) {
    const oldestKey = trmnlResultCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    trmnlResultCache.delete(oldestKey);
  }
}

function enqueueTrmnlRender(task: () => Promise<TrmnlAdaptiveRenderResult>): Promise<TrmnlAdaptiveRenderResult> {
  const result = trmnlQueueTail.then(task);
  trmnlQueueTail = result.then(() => undefined, () => undefined);
  return result;
}

async function renderTrmnlCached(row: Record<string, any>, target: RenderTarget): Promise<TrmnlAdaptiveRenderResult> {
  const key = trmnlCacheKey(row, target);
  const now = Date.now();
  pruneTrmnlCache(now);
  const cached = trmnlResultCache.get(key);
  if (cached && cached.expiresAt > now) {
    trmnlResultCache.delete(key);
    trmnlResultCache.set(key, cached);
    return cached.result;
  }
  const pending = trmnlInFlight.get(key);
  if (pending) return pending;

  const promise = enqueueTrmnlRender(() => trmnlAdaptiveRenderer.render(buildTrmnlReviewContent(row), target, { timeoutMs: 30_000 }))
    .then((result) => {
      pruneTrmnlCache();
      trmnlResultCache.set(key, { expiresAt: Date.now() + TRMNL_CACHE_TTL_MS, result });
      return result;
    })
    .finally(() => trmnlInFlight.delete(key));
  trmnlInFlight.set(key, promise);
  return promise;
}

function satoriSideToGeneric(side: AdaptiveComparisonSide, lifecycle: 'authoritative' | 'reference'): RendererComparisonSide {
  return {
    renderer: side.renderer,
    lifecycle,
    image: side.image,
    renderMetrics: side.renderMetrics,
    bitmapMetrics: side.bitmapMetrics,
  };
}

async function trmnlSide(row: Record<string, any>, target: RenderTarget): Promise<RendererComparisonSide> {
  const rendered = await renderTrmnlCached(row, target);
  const bitmap = await packFromPng(rendered.pngBuffer, target);
  return {
    renderer: TRMNL_FRAMEWORK_RENDERER_VERSION,
    lifecycle: 'canary',
    image: {
      mimeType: 'image/png',
      bytes: rendered.pngBuffer.length,
      base64: rendered.pngBuffer.toString('base64'),
    },
    renderMetrics: {
      totalMs: rendered.metrics.renderMs,
      frameworkVersion: rendered.metrics.frameworkVersion,
      recipeVersion: rendered.metrics.recipeVersion,
      frameworkBuild: rendered.metrics.frameworkBuild,
      overflow: rendered.metrics.overflow,
      regions: rendered.metrics.regions,
      typography: rendered.metrics.typography,
      pageReused: rendered.metrics.pageReused,
      assetSource: rendered.metrics.assetSource,
      browserInitMs: rendered.metrics.browserInitMs,
      frameworkLoadMs: rendered.metrics.frameworkLoadMs,
      domMutationMs: rendered.metrics.domMutationMs,
      terminalizeMs: rendered.metrics.terminalizeMs,
      screenshotMs: rendered.metrics.screenshotMs,
    },
    bitmapMetrics: measurePackedBitmap(bitmap, target),
    frameworkMetrics: rendered.metrics,
  };
}

export async function renderRendererComparison(
  row: Record<string, any>,
  target: RenderTarget,
): Promise<RendererComparisonResult> {
  const [legacyComparison, candidate] = await Promise.all([
    renderAdaptiveComparison(row, target),
    trmnlSide(row, target),
  ]);

  const primary = {
    ...satoriSideToGeneric(legacyComparison.primary, target.kind === 'eink' ? 'authoritative' : 'reference'),
    renderer: CURRENT_SATORI_RENDERER_VERSION,
    baselineRole: legacyComparison.primary.baselineRole,
  } as RendererComparisonResult['primary'];
  const reference = {
    ...satoriSideToGeneric(legacyComparison.adaptive, 'reference'),
    renderer: ADAPTIVE_REFERENCE_RENDERER_VERSION,
    frozen: true as const,
  };
  const primaryMs = primary.renderMetrics.totalMs;
  const candidateMs = candidate.renderMetrics.totalMs;

  return {
    version: RENDERER_REVIEW_VERSION,
    governanceVersion: RENDERER_GOVERNANCE_VERSION,
    subject: legacyComparison.subject,
    target,
    governance: {
      tracks: RENDERER_TRACKS,
      target: rendererGovernanceForTarget(target),
      promotionGate: TRMNL_PROMOTION_GATE,
    },
    primary,
    candidate,
    reference,
    comparison: {
      blackBitsDelta: candidate.bitmapMetrics.burnBits - primary.bitmapMetrics.burnBits,
      blackRatioDelta: Math.round((candidate.bitmapMetrics.burnRatio - primary.bitmapMetrics.burnRatio) * 10_000) / 10_000,
      candidateToPrimaryBlackRatio: primary.bitmapMetrics.burnBits > 0
        ? Math.round((candidate.bitmapMetrics.burnBits / primary.bitmapMetrics.burnBits) * 10_000) / 10_000
        : null,
      renderMsDelta: Math.round((candidateMs - primaryMs) * 100) / 100,
      candidateToPrimaryRenderRatio: primaryMs > 0
        ? Math.round((candidateMs / primaryMs) * 10_000) / 10_000
        : null,
    },
    changesPhysicalDelivery: false,
  };
}
