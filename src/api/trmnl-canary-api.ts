import { Hono } from 'hono';
import {
  trmnlAdaptiveRenderer,
  type TrmnlAdaptiveContent,
} from '../react-widgets/core/trmnl-adaptive-renderer.js';
import { BUILTIN_TARGETS, type RenderTarget } from '../react-widgets/core/render-targets.js';

const app = new Hono();

const MAX_RENDER_PIXELS = 1_500_000;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 48;
const MAX_DIMENSION = 1_600;

interface CanaryTargetInput {
  id?: unknown;
  kind?: unknown;
  widthPx?: unknown;
  heightPx?: unknown;
  dpi?: unknown;
  physical?: { widthMm?: unknown; heightMm?: unknown } | null;
}

interface CanaryRequestBody {
  targetId?: unknown;
  target?: CanaryTargetInput;
  content?: {
    title?: unknown;
    body?: unknown;
    eyebrow?: unknown;
    footer?: unknown;
  };
}

export interface NormalizedTrmnlCanaryRequest {
  target: RenderTarget;
  content: TrmnlAdaptiveContent;
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeCustomTarget(value: CanaryTargetInput | undefined): RenderTarget | undefined {
  if (!value) return undefined;
  const widthPx = finiteNumber(value.widthPx);
  const heightPx = finiteNumber(value.heightPx);
  if (!widthPx || !heightPx) return undefined;
  const width = Math.round(widthPx);
  const height = Math.round(heightPx);
  if (
    width < MIN_WIDTH ||
    height < MIN_HEIGHT ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_RENDER_PIXELS
  ) {
    return undefined;
  }

  const kind = value.kind === 'eink' || value.kind === 'thermal-label' ? value.kind : undefined;
  if (!kind) return undefined;
  const dpi = Math.round(finiteNumber(value.dpi) ?? (kind === 'thermal-label' ? 203 : 250));
  if (dpi < 72 || dpi > 600) return undefined;

  const physicalWidth = finiteNumber(value.physical?.widthMm);
  const physicalHeight = finiteNumber(value.physical?.heightMm);
  const physical =
    physicalWidth && physicalHeight && physicalWidth > 0 && physicalHeight > 0
      ? { widthMm: physicalWidth, heightMm: physicalHeight }
      : undefined;

  return {
    id: cleanString(value.id, 80) || `trmnl-canary-${kind}-${width}x${height}`,
    kind,
    widthPx: width,
    heightPx: height,
    dpi,
    colorMode: 'mono-1bit',
    ...(physical ? { physical } : {}),
    defaultFontStack: ['fusion-pixel-12'],
  };
}

export function normalizeTrmnlCanaryRequest(body: CanaryRequestBody | null): NormalizedTrmnlCanaryRequest | undefined {
  if (!body?.content) return undefined;
  const title = cleanString(body.content.title, 1_000);
  if (!title) return undefined;

  const targetId = cleanString(body.targetId, 80);
  const builtin = targetId ? BUILTIN_TARGETS.find((target) => target.id === targetId) : undefined;
  const target = builtin ?? normalizeCustomTarget(body.target);
  if (!target) return undefined;

  const bodyText = cleanString(body.content.body, 5_000);
  const eyebrow = cleanString(body.content.eyebrow, 500);
  const footer = cleanString(body.content.footer, 500);

  return {
    target,
    content: {
      title,
      ...(bodyText ? { body: bodyText } : {}),
      ...(eyebrow ? { eyebrow } : {}),
      ...(footer ? { footer } : {}),
    },
  };
}

function isCanaryEnabled(): boolean {
  return process.env.QUOTE0_TRMNL_CANARY_ENABLED === 'true';
}

let renderInFlight = false;

app.get('/api/renderers/trmnl/canary/status', (c) => {
  return c.json({
    success: true,
    enabled: isCanaryEnabled(),
    renderer: 'trmnl-framework-browser-canary/v1',
    concurrency: 1,
    inFlight: renderInFlight,
    autoSelected: false,
    replacesSatori: false,
  });
});

app.post('/api/renderers/trmnl/canary/render', async (c) => {
  if (!isCanaryEnabled()) {
    return c.json({ success: false, error: 'QUOTE0_TRMNL_CANARY_ENABLED 未启用' }, 503);
  }
  if (renderInFlight) {
    return c.json({ success: false, error: 'TRMNL canary renderer busy; concurrency is fixed at 1' }, 429);
  }

  const body = await c.req.json().catch(() => null) as CanaryRequestBody | null;
  const normalized = normalizeTrmnlCanaryRequest(body);
  if (!normalized) {
    return c.json({
      success: false,
      error: '需要有效 content.title 与 targetId，或 80..1600px / <=1.5MP 的 mono target',
    }, 400);
  }

  renderInFlight = true;
  try {
    const result = await trmnlAdaptiveRenderer.render(normalized.content, normalized.target, {
      timeoutMs: 30_000,
    });
    return c.json({
      success: true,
      renderer: 'trmnl-framework-browser-canary/v1',
      target: {
        id: result.target.id,
        kind: result.target.kind,
        widthPx: result.target.widthPx,
        heightPx: result.target.heightPx,
        dpi: result.target.dpi,
        physical: result.target.physical ?? null,
      },
      profile: result.profile,
      metrics: result.metrics,
      image: {
        mimeType: 'image/png',
        bytes: result.pngBuffer.length,
        base64: result.pngBuffer.toString('base64'),
      },
      autoSelected: false,
      replacesSatori: false,
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'TRMNL canary render failed',
    }, 500);
  } finally {
    renderInFlight = false;
  }
});

export default app;
