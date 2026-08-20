import type { RenderTarget } from '../react-widgets/core/render-targets.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import {
  buildPhysicalBitplaneArtifact,
  comparePhysicalBitplanes,
  type BitplaneDiffRegionSpec,
  type PhysicalBitplaneArtifact,
  type PhysicalBitplaneDiff,
  type PhysicalBitplanePreview,
} from './renderer-physical-preview.js';
import {
  trmnlAdaptiveRenderer,
  type TrmnlAdaptiveContent,
  type TrmnlAdaptiveRenderResult,
  type TrmnlRenderMetrics,
} from '../react-widgets/core/trmnl-adaptive-renderer.js';
import {
  TRMNL_SATORI_PIXEL_RENDERER_VERSION,
  renderMeasuredTrmnlLayoutWithSatoriPixels,
  type TrmnlPixelSnapPlan,
} from '../react-widgets/core/trmnl-satori-pixel-renderer.js';
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

export const RENDERER_REVIEW_VERSION = 'renderer-review/v5';
export const RENDERER_SELF_CHECK_VERSION = 'renderer-self-check/v2';
export { ADAPTIVE_REVIEW_TARGETS as RENDERER_REVIEW_TARGETS, resolveAdaptiveReviewTarget as resolveRendererReviewTarget };

export interface RendererComparisonSide {
  renderer: string;
  lifecycle: 'authoritative' | 'canary' | 'experimental' | 'reference';
  image: {
    mimeType: 'image/png';
    bytes: number;
    base64: string;
  };
  renderMetrics: {
    totalMs: number;
    layoutMeasureMs?: number;
    rasterMs?: number;
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
    pixelSnapPlan?: TrmnlPixelSnapPlan;
  };
  bitmapMetrics: BitmapMetrics;
  physicalPreview: PhysicalBitplanePreview;
  frameworkMetrics?: unknown;
}

export interface RendererTitleBarCheck {
  status: 'pass' | 'fail';
  titleHeight: number;
  requiredHeight: number;
  occupiedTitleLines: number;
  maxTitleLines: number;
  excessRows: number;
  clippedRows: number;
  allowedExcessRows: number;
  reason: string;
}

export interface RendererSelfCheck {
  version: typeof RENDERER_SELF_CHECK_VERSION;
  physicalCandidate: {
    status: 'pass' | 'fail';
    pointToPoint: boolean;
    resizeApplied: boolean;
    criticalOverflow: boolean;
    exactVsPrimary: boolean;
    changedPixels: number;
    changedRatio: number;
    titleBar: RendererTitleBarCheck;
    reasons: string[];
  };
  browserProbe: {
    status: 'pass' | 'rejected';
    pointToPoint: boolean;
    resizeApplied: boolean;
    exactVsPhysicalCandidate: boolean;
    changedPixels: number;
    changedRatio: number;
    reason: string;
  };
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
  candidate: RendererComparisonSide & {
    layoutEngine: typeof TRMNL_FRAMEWORK_RENDERER_VERSION;
    browserProbeRenderer: typeof TRMNL_FRAMEWORK_RENDERER_VERSION;
    sharesLayoutWithBrowserProbe: true;
  };
  browserProbe: RendererComparisonSide & {
    diagnosticOnly: true;
    layoutAuthorityForCandidate: true;
  };
  /** One-release compatibility alias. The physical candidate is now candidate. */
  pixelBridge: RendererComparisonResult['candidate'];
  reference: RendererComparisonSide & {
    frozen: true;
  };
  comparison: {
    blackBitsDelta: number;
    blackRatioDelta: number;
    candidateToPrimaryBlackRatio: number | null;
    renderMsDelta: number;
    candidateToPrimaryRenderRatio: number | null;
    exactPlaneEqual: boolean;
    changedPixels: number;
    changedRatio: number;
    changedBounds: PhysicalBitplaneDiff['bounds'];
    changedByRegion: PhysicalBitplaneDiff['regions'];
    browserBlackRatioDelta: number;
    browserToPrimaryBlackRatio: number | null;
    browserRenderMsDelta: number;
    browserChangedPixelsVsCandidate: number;
    browserChangedRatioVsCandidate: number;
    // Compatibility fields retained for v3 clients.
    pixelBridgeBlackRatioDelta: number;
    pixelBridgeToPrimaryBlackRatio: number | null;
    pixelBridgeRasterMs: number;
  };
  diffs: {
    candidateVsPrimary: PhysicalBitplaneDiff;
    browserVsCandidate: PhysicalBitplaneDiff;
    browserVsPrimary: PhysicalBitplaneDiff;
  };
  selfCheck: RendererSelfCheck;
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

type RendererSideWithoutPhysicalPreview = Omit<RendererComparisonSide, 'physicalPreview'>;
type SideArtifact<T extends RendererSideWithoutPhysicalPreview> = {
  side: T & { physicalPreview: PhysicalBitplanePreview };
  artifact: PhysicalBitplaneArtifact;
};

async function attachPhysicalArtifact<T extends RendererSideWithoutPhysicalPreview>(
  side: T,
  target: RenderTarget,
): Promise<SideArtifact<T>> {
  const pngBuffer = Buffer.from(side.image.base64, 'base64');
  const artifact = await buildPhysicalBitplaneArtifact(pngBuffer, target);
  return {
    side: { ...side, physicalPreview: artifact.preview },
    artifact,
  };
}

function satoriSideToGeneric(
  side: AdaptiveComparisonSide,
  lifecycle: 'authoritative' | 'reference',
): RendererSideWithoutPhysicalPreview {
  return {
    renderer: side.renderer,
    lifecycle,
    image: side.image,
    renderMetrics: side.renderMetrics,
    bitmapMetrics: side.bitmapMetrics,
  };
}

function snappedTypography(plan: TrmnlPixelSnapPlan): TrmnlRenderMetrics['typography'] {
  return {
    eyebrowFontPx: plan.typography.eyebrow?.fontPx ?? null,
    eyebrowLineHeightPx: plan.typography.eyebrow?.lineHeightPx ?? null,
    titleFontPx: plan.typography.title.fontPx,
    titleLineHeightPx: plan.typography.title.lineHeightPx,
    bodyFontPx: plan.typography.body.fontPx,
    bodyLineHeightPx: plan.typography.body.lineHeightPx,
    footerFontPx: plan.typography.footer?.fontPx ?? null,
    footerLineHeightPx: plan.typography.footer?.lineHeightPx ?? null,
  };
}

async function trmnlSides(row: Record<string, any>, target: RenderTarget): Promise<{
  browserProbe: SideArtifact<RendererComparisonResult['browserProbe'] extends infer T ? Omit<T & RendererComparisonSide, 'physicalPreview'> : never>;
  candidate: SideArtifact<RendererComparisonResult['candidate'] extends infer T ? Omit<T & RendererComparisonSide, 'physicalPreview'> : never>;
}> {
  const rendered = await renderTrmnlCached(row, target);
  const [browserBitmap, pixel] = await Promise.all([
    packFromPng(rendered.pngBuffer, target),
    renderMeasuredTrmnlLayoutWithSatoriPixels(rendered, target),
  ]);
  const pixelBitmap = await packFromPng(pixel.pngBuffer, target);

  const browserProbe = await attachPhysicalArtifact({
    renderer: TRMNL_FRAMEWORK_RENDERER_VERSION,
    lifecycle: 'canary' as const,
    diagnosticOnly: true as const,
    layoutAuthorityForCandidate: true as const,
    image: {
      mimeType: 'image/png' as const,
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
    bitmapMetrics: measurePackedBitmap(browserBitmap, target),
    frameworkMetrics: rendered.metrics,
  }, target);

  const totalMs = Math.round((rendered.metrics.renderMs + pixel.renderMs) * 100) / 100;
  const candidate = await attachPhysicalArtifact({
    renderer: TRMNL_SATORI_PIXEL_RENDERER_VERSION,
    lifecycle: 'canary' as const,
    layoutEngine: TRMNL_FRAMEWORK_RENDERER_VERSION,
    browserProbeRenderer: TRMNL_FRAMEWORK_RENDERER_VERSION,
    sharesLayoutWithBrowserProbe: true as const,
    image: {
      mimeType: 'image/png' as const,
      bytes: pixel.pngBuffer.length,
      base64: pixel.pngBuffer.toString('base64'),
    },
    renderMetrics: {
      totalMs,
      layoutMeasureMs: rendered.metrics.renderMs,
      rasterMs: pixel.renderMs,
      frameworkVersion: rendered.metrics.frameworkVersion,
      recipeVersion: rendered.metrics.recipeVersion,
      frameworkBuild: rendered.metrics.frameworkBuild,
      overflow: rendered.metrics.overflow,
      regions: {
        title: pixel.layoutPlan.regions.title,
        body: pixel.layoutPlan.regions.body,
        footer: pixel.layoutPlan.regions.footer,
      },
      typography: snappedTypography(pixel.layoutPlan),
      pageReused: rendered.metrics.pageReused,
      assetSource: rendered.metrics.assetSource,
      browserInitMs: rendered.metrics.browserInitMs,
      frameworkLoadMs: rendered.metrics.frameworkLoadMs,
      domMutationMs: rendered.metrics.domMutationMs,
      terminalizeMs: rendered.metrics.terminalizeMs,
      screenshotMs: rendered.metrics.screenshotMs,
      pixelSnapPlan: pixel.layoutPlan,
    },
    bitmapMetrics: measurePackedBitmap(pixelBitmap, target),
    frameworkMetrics: {
      layoutAuthority: TRMNL_FRAMEWORK_RENDERER_VERSION,
      rasterAuthority: 'satori/fusion-pixel',
      pixelSnapPlan: pixel.layoutPlan,
      browserMeasurement: rendered.metrics,
      satoriMetrics: pixel.satoriMetrics,
    },
  }, target);

  return { browserProbe, candidate } as any;
}

function diffRegions(plan: TrmnlPixelSnapPlan): BitplaneDiffRegionSpec[] {
  const regions: BitplaneDiffRegionSpec[] = [
    { name: 'title', ...plan.regions.title },
    { name: 'body', ...plan.regions.body },
  ];
  if (plan.regions.footer) regions.push({ name: 'footer', ...plan.regions.footer });
  return regions;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function planePixelIsBlack(plane: Uint8Array, width: number, x: number, y: number): boolean {
  const bytesPerRow = Math.ceil(width / 8);
  const byte = plane[y * bytesPerRow + (x >> 3)] ?? 0;
  return (byte & (1 << (7 - (x & 7)))) !== 0;
}

/**
 * Verify that the inverted title region is actually occupied by the snapped
 * pixel title. A browser-sized two-line region with a one-line physical title
 * produces a visually obvious empty black tail even though geometry is 1:1.
 */
export function measureTitleBarUtilization(
  plane: Uint8Array,
  width: number,
  height: number,
  plan: TrmnlPixelSnapPlan,
): RendererTitleBarCheck {
  const expectedBytes = Math.ceil(width / 8) * height;
  if (plane.byteLength !== expectedBytes) {
    throw new Error(`Title bar check plane mismatch: expected=${expectedBytes} actual=${plane.byteLength}`);
  }

  const title = plan.regions.title;
  const padding = plan.padding.title;
  const titleType = plan.typography.title;
  const eyebrowHeight = plan.text.eyebrow && plan.typography.eyebrow
    ? plan.typography.eyebrow.lineHeightPx
    : 0;
  const contentStartY = title.y + padding.top + eyebrowHeight;
  const contentEndY = title.y + title.height - padding.bottom;
  const availableHeight = Math.max(0, contentEndY - contentStartY);
  const maxTitleLines = Math.max(1, Math.min(2, Math.ceil(availableHeight / titleType.lineHeightPx)));
  const xStart = Math.max(title.x, title.x + padding.left);
  const xEnd = Math.min(title.x + title.width, title.x + title.width - padding.right);
  let occupiedTitleLines = 0;

  for (let line = 0; line < maxTitleLines; line += 1) {
    const yStart = Math.max(title.y, Math.floor(contentStartY + line * titleType.lineHeightPx));
    const yEnd = Math.min(
      title.y + title.height,
      Math.ceil(contentStartY + (line + 1) * titleType.lineHeightPx),
    );
    let hasWhiteGlyph = false;
    for (let y = yStart; y < yEnd && !hasWhiteGlyph; y += 1) {
      for (let x = xStart; x < xEnd; x += 1) {
        if (!planePixelIsBlack(plane, width, x, y)) {
          hasWhiteGlyph = true;
          break;
        }
      }
    }
    if (hasWhiteGlyph) occupiedTitleLines = line + 1;
  }

  const effectiveLines = Math.max(1, occupiedTitleLines);
  const requiredHeight = padding.top
    + eyebrowHeight
    + effectiveLines * titleType.lineHeightPx
    + padding.bottom;
  const excessRows = Math.max(0, title.height - requiredHeight);
  const clippedRows = Math.max(0, requiredHeight - title.height);
  const allowedExcessRows = Math.max(2, padding.bottom);
  const failed = occupiedTitleLines === 0 || excessRows > allowedExcessRows || clippedRows > 1;

  let reason = 'title region matches the occupied physical pixel lines';
  if (occupiedTitleLines === 0) {
    reason = 'title region contains no visible white title glyphs';
  } else if (excessRows > allowedExcessRows) {
    reason = `title region has ${excessRows}px of avoidable empty black tail`;
  } else if (clippedRows > 1) {
    reason = `title region is ${clippedRows}px shorter than the occupied pixel line box`;
  }

  return {
    status: failed ? 'fail' : 'pass',
    titleHeight: title.height,
    requiredHeight,
    occupiedTitleLines,
    maxTitleLines,
    excessRows,
    clippedRows,
    allowedExcessRows,
    reason,
  };
}

function buildSelfCheck(
  candidate: RendererComparisonResult['candidate'],
  browserProbe: RendererComparisonResult['browserProbe'],
  candidateVsPrimary: PhysicalBitplaneDiff,
  browserVsCandidate: PhysicalBitplaneDiff,
  titleBar: RendererTitleBarCheck,
): RendererSelfCheck {
  const criticalOverflow = Boolean(
    candidate.renderMetrics.overflow?.horizontal || candidate.renderMetrics.overflow?.vertical,
  );
  const candidateReasons: string[] = [];
  if (!candidate.physicalPreview.pointToPoint || candidate.physicalPreview.resizeApplied) {
    candidateReasons.push('physical candidate source geometry required a resize');
  }
  if (criticalOverflow) candidateReasons.push('TRMNL layout measurement reported critical overflow');
  if (titleBar.status === 'fail') candidateReasons.push(titleBar.reason);
  if (candidateVsPrimary.exact) {
    candidateReasons.push('final physical plane is byte-for-byte identical to Current/Satori');
  } else {
    candidateReasons.push('final physical plane differs from Current; review the XOR map and target/content semantics');
  }

  const candidateFailed = !candidate.physicalPreview.pointToPoint
    || candidate.physicalPreview.resizeApplied
    || criticalOverflow
    || titleBar.status === 'fail';
  const browserRejected = !browserProbe.physicalPreview.pointToPoint
    || browserProbe.physicalPreview.resizeApplied
    || !browserVsCandidate.exact;

  return {
    version: RENDERER_SELF_CHECK_VERSION,
    physicalCandidate: {
      status: candidateFailed ? 'fail' : 'pass',
      pointToPoint: candidate.physicalPreview.pointToPoint,
      resizeApplied: candidate.physicalPreview.resizeApplied,
      criticalOverflow,
      exactVsPrimary: candidateVsPrimary.exact,
      changedPixels: candidateVsPrimary.changedPixels,
      changedRatio: candidateVsPrimary.changedRatio,
      titleBar,
      reasons: candidateReasons,
    },
    browserProbe: {
      status: browserRejected ? 'rejected' : 'pass',
      pointToPoint: browserProbe.physicalPreview.pointToPoint,
      resizeApplied: browserProbe.physicalPreview.resizeApplied,
      exactVsPhysicalCandidate: browserVsCandidate.exact,
      changedPixels: browserVsCandidate.changedPixels,
      changedRatio: browserVsCandidate.changedRatio,
      reason: browserRejected
        ? 'Browser PNG only measures TRMNL layout. Its antialiased raster differs from the physical pixel candidate and is excluded from A/B voting.'
        : 'Browser probe and physical candidate produce the same final plane.',
    },
  };
}

export async function renderRendererComparison(
  row: Record<string, any>,
  target: RenderTarget,
): Promise<RendererComparisonResult> {
  const [legacyComparison, trmnl] = await Promise.all([
    renderAdaptiveComparison(row, target),
    trmnlSides(row, target),
  ]);

  const [primaryArtifact, referenceArtifact] = await Promise.all([
    attachPhysicalArtifact({
      ...satoriSideToGeneric(legacyComparison.primary, target.kind === 'eink' ? 'authoritative' : 'reference'),
      renderer: CURRENT_SATORI_RENDERER_VERSION,
      baselineRole: legacyComparison.primary.baselineRole,
    }, target),
    attachPhysicalArtifact({
      ...satoriSideToGeneric(legacyComparison.adaptive, 'reference'),
      renderer: ADAPTIVE_REFERENCE_RENDERER_VERSION,
      frozen: true as const,
    }, target),
  ]);

  const primary = primaryArtifact.side as RendererComparisonResult['primary'];
  const reference = referenceArtifact.side as RendererComparisonResult['reference'];
  const candidate = trmnl.candidate.side as RendererComparisonResult['candidate'];
  const browserProbe = trmnl.browserProbe.side as RendererComparisonResult['browserProbe'];
  const regions = diffRegions(candidate.renderMetrics.pixelSnapPlan!);
  const [candidateVsPrimary, browserVsCandidate, browserVsPrimary] = await Promise.all([
    comparePhysicalBitplanes(primaryArtifact.artifact.plane, trmnl.candidate.artifact.plane, target.widthPx, target.heightPx, regions),
    comparePhysicalBitplanes(trmnl.candidate.artifact.plane, trmnl.browserProbe.artifact.plane, target.widthPx, target.heightPx, regions),
    comparePhysicalBitplanes(primaryArtifact.artifact.plane, trmnl.browserProbe.artifact.plane, target.widthPx, target.heightPx, regions),
  ]);

  const titleBar = measureTitleBarUtilization(
    trmnl.candidate.artifact.plane,
    target.widthPx,
    target.heightPx,
    candidate.renderMetrics.pixelSnapPlan!,
  );
  const primaryMs = primary.renderMetrics.totalMs;
  const candidateMs = candidate.renderMetrics.totalMs;
  const browserMs = browserProbe.renderMetrics.totalMs;
  const candidateBlackRatioDelta = Math.round((candidate.bitmapMetrics.burnRatio - primary.bitmapMetrics.burnRatio) * 10_000) / 10_000;
  const browserBlackRatioDelta = Math.round((browserProbe.bitmapMetrics.burnRatio - primary.bitmapMetrics.burnRatio) * 10_000) / 10_000;

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
    browserProbe,
    pixelBridge: candidate,
    reference,
    comparison: {
      blackBitsDelta: candidate.bitmapMetrics.burnBits - primary.bitmapMetrics.burnBits,
      blackRatioDelta: candidateBlackRatioDelta,
      candidateToPrimaryBlackRatio: ratio(candidate.bitmapMetrics.burnBits, primary.bitmapMetrics.burnBits),
      renderMsDelta: Math.round((candidateMs - primaryMs) * 100) / 100,
      candidateToPrimaryRenderRatio: ratio(candidateMs, primaryMs),
      exactPlaneEqual: candidateVsPrimary.exact,
      changedPixels: candidateVsPrimary.changedPixels,
      changedRatio: candidateVsPrimary.changedRatio,
      changedBounds: candidateVsPrimary.bounds,
      changedByRegion: candidateVsPrimary.regions,
      browserBlackRatioDelta,
      browserToPrimaryBlackRatio: ratio(browserProbe.bitmapMetrics.burnBits, primary.bitmapMetrics.burnBits),
      browserRenderMsDelta: Math.round((browserMs - primaryMs) * 100) / 100,
      browserChangedPixelsVsCandidate: browserVsCandidate.changedPixels,
      browserChangedRatioVsCandidate: browserVsCandidate.changedRatio,
      pixelBridgeBlackRatioDelta: candidateBlackRatioDelta,
      pixelBridgeToPrimaryBlackRatio: ratio(candidate.bitmapMetrics.burnBits, primary.bitmapMetrics.burnBits),
      pixelBridgeRasterMs: Math.round((candidate.renderMetrics.rasterMs ?? 0) * 100) / 100,
    },
    diffs: {
      candidateVsPrimary,
      browserVsCandidate,
      browserVsPrimary,
    },
    selfCheck: buildSelfCheck(candidate, browserProbe, candidateVsPrimary, browserVsCandidate, titleBar),
    changesPhysicalDelivery: false,
  };
}
