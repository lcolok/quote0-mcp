import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import type { RenderTarget } from './render-targets.js';
import {
  createAdaptiveTextCardDocument,
  planAdaptiveLayout,
  type AdaptiveDocument,
  type AdaptiveLayoutPlan,
  type AdaptivePlannedNode,
  type AdaptiveTextCardContent,
} from './adaptive-layout.js';

export const TRMNL_FRAMEWORK_VERSION = '3.2.0';
export const TRMNL_FRAMEWORK_CSS_URL = `https://trmnl.com/css/${TRMNL_FRAMEWORK_VERSION}/plugins.min.css`;
export const TRMNL_FRAMEWORK_JS_URL = `https://trmnl.com/js/${TRMNL_FRAMEWORK_VERSION}/plugins.min.js`;

const DEFAULT_CJK_FONT_PATH = path.join(
  'assets',
  'fonts',
  'fusion-pixel-12px-monospaced-zh_hans.otf.woff2',
);

export interface TrmnlAdaptiveContent extends AdaptiveTextCardContent {
  title: string;
}

export interface TrmnlTargetProfile {
  size: 'sm' | 'md' | 'lg';
  uiScale: number;
  gapScale: number;
  colorDepth: 1 | 2 | 4;
  densityTier: '1x' | '2x';
  screenClasses: string[];
}

export interface TrmnlRenderMetrics {
  frameworkVersion: string;
  frameworkBuild: string | null;
  renderMs: number;
  terminalizeStats: unknown;
  terminalizeStatsHistory: unknown[];
  viewport: { width: number; height: number };
  screen: {
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
  };
  document: {
    scrollWidth: number;
    scrollHeight: number;
  };
  overflow: {
    horizontal: boolean;
    vertical: boolean;
  };
  visibleText: {
    title: string;
    body: string;
  };
}

export interface TrmnlAdaptiveRenderResult {
  pngBuffer: Buffer;
  target: RenderTarget;
  profile: TrmnlTargetProfile;
  layoutPlan: AdaptiveLayoutPlan;
  metrics: TrmnlRenderMetrics;
}

export interface TrmnlAdaptiveRenderOptions {
  executablePath?: string;
  timeoutMs?: number;
  debug?: boolean;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Translate Quote0's pixel target into the public device variables consumed by
 * TRMNL Framework. The released framework only has a generic BYOD profile for
 * arbitrary panels, so Phase A keeps its generated capability classes and
 * overrides the public geometry/scale variables at the screen boundary.
 *
 * uiScale is continuous rather than a per-target lookup: the same rule covers
 * e-ink and thermal labels, including runtime-discovered thermal dimensions.
 */
export function deriveTrmnlTargetProfile(target: RenderTarget): TrmnlTargetProfile {
  const minDimensionScale = Math.min(target.widthPx / 400, target.heightPx / 200);
  const uiScale = round2(clampNumber(minDimensionScale, 0.5, 1.25));
  const gapScale = round2(clampNumber(uiScale, 0.45, 1));
  const size: TrmnlTargetProfile['size'] =
    target.widthPx >= 1024 ? 'lg' : target.widthPx >= 800 ? 'md' : 'sm';
  const colorDepth: 1 | 2 | 4 = target.colorMode === 'mono-1bit' ? 1 : 4;
  const densityTier: '1x' | '2x' = '1x';

  return {
    size,
    uiScale,
    gapScale,
    colorDepth,
    densityTier,
    screenClasses: [
      'screen',
      'screen--byod_custom',
      `screen--${size}`,
      `screen--${colorDepth}bit`,
      `screen--${densityTier}`,
      ...(target.heightPx > target.widthPx ? ['screen--portrait'] : []),
    ],
  };
}

function escapeHtml(value: string | undefined): string {
  if (!value) return '';
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function trmnlContentToAdaptiveDocument(content: TrmnlAdaptiveContent): AdaptiveDocument {
  return createAdaptiveTextCardDocument({
    id: content.id || 'trmnl-adaptive-card',
    title: content.title,
    body: content.body,
    eyebrow: content.eyebrow,
    keyword: content.keyword,
    meta: content.meta,
    footer: content.footer,
  });
}

function renderPlannedNode(node: AdaptivePlannedNode): string {
  if (!node.visible || node.clampLines <= 0) return '';
  const id = escapeHtml(node.id);
  const text = escapeHtml(node.text);
  const style = `font-size:${node.fontPx}px!important;line-height:${node.lineHeightPx}px!important`;
  const common = `data-adaptive-node="${id}" data-adaptive-role="${node.role}" data-clamp="${node.clampLines}" style="${style}"`;

  if (node.role === 'title') {
    return `<span class="title quote0-title quote0-node" ${common}>${text}</span>`;
  }
  if (node.role === 'body') {
    return `<div class="content quote0-body quote0-node" data-adaptive-node="${id}" data-adaptive-role="body" data-content-limiter="true" style="${style}"><p data-clamp="${node.clampLines}">${text}</p></div>`;
  }

  return `<span class="label quote0-${node.role} quote0-node" ${common}>${text}</span>`;
}

export function buildTrmnlAdaptiveDocumentHtml(
  document: AdaptiveDocument,
  target: RenderTarget,
  cjkFontDataUri: string,
  layoutPlan: AdaptiveLayoutPlan = planAdaptiveLayout(document, target),
): string {
  const profile = deriveTrmnlTargetProfile(target);
  const screenStyle = [
    `--screen-w:${target.widthPx}px`,
    `--screen-h:${target.heightPx}px`,
    `--screen-w-original:${target.widthPx}px`,
    `--screen-h-original:${target.heightPx}px`,
    '--pixel-ratio:1',
    '--dither-pixel-ratio:1',
    `--device-ui-scale:${profile.uiScale}`,
    `--gap-scale:${profile.gapScale}`,
    `--color-depth:${profile.colorDepth}`,
    `--density-tier:${profile.densityTier}`,
  ].join(';');
  const nodes = layoutPlan.nodes.map(renderPlannedNode).filter(Boolean).join('\n          ');
  const justifyContent = layoutPlan.density === 'micro' || layoutPlan.density === 'compact'
    ? 'flex-start'
    : 'center';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="${TRMNL_FRAMEWORK_CSS_URL}" />
  <style>
    @font-face {
      font-family: "Quote0 Fusion Pixel";
      src: url("${cjkFontDataUri}") format("woff2");
      font-weight: 400 700;
      font-style: normal;
      font-display: block;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: ${target.widthPx}px;
      height: ${target.heightPx}px;
      overflow: hidden;
      background: #fff;
    }
    body.environment.trmnl { width: ${target.widthPx}px; height: ${target.heightPx}px; }
    .quote0-adaptive-screen {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
    }
    .quote0-adaptive-screen .view,
    .quote0-adaptive-screen .layout {
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      box-sizing: border-box;
    }
    .quote0-adaptive-screen .layout { padding: 0 !important; }
    .quote0-stack {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: ${justifyContent};
      align-items: stretch;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      box-sizing: border-box;
      padding: ${layoutPlan.paddingYPx}px ${layoutPlan.paddingXPx}px;
      gap: ${layoutPlan.gapPx}px;
    }
    .quote0-node,
    .quote0-node p {
      font-family: "TRMNL16", "Quote0 Fusion Pixel", monospace !important;
      min-width: 0;
      box-sizing: border-box;
    }
    .quote0-title {
      font-family: "TRMNL21", "Quote0 Fusion Pixel", monospace !important;
      text-align: left;
      flex: 0 0 auto;
    }
    .quote0-body {
      min-height: 0;
      overflow: hidden;
      flex: 0 1 auto;
    }
    .quote0-body p { margin: 0; }
    .quote0-eyebrow,
    .quote0-keyword,
    .quote0-meta,
    .quote0-footer { flex: 0 0 auto; }
    .quote0-meta,
    .quote0-footer { opacity: 0.72; }
  </style>
  <script>
    window.__QUOTE0_TRMNL_STATS__ = [];
    window.addEventListener('trmnl:terminalize:stats', function (event) {
      window.__QUOTE0_TRMNL_STATS__.push(event.detail);
    });
  </script>
  <script src="${TRMNL_FRAMEWORK_JS_URL}" defer></script>
</head>
<body class="environment trmnl">
  <div class="${profile.screenClasses.join(' ')} quote0-adaptive-screen" style="${screenStyle}">
    <div class="view view--full">
      <div class="layout layout--col">
        <div class="quote0-stack" data-adaptive-density="${layoutPlan.density}" data-adaptive-version="${layoutPlan.version}">
          ${nodes}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function buildTrmnlAdaptiveHtml(
  content: TrmnlAdaptiveContent,
  target: RenderTarget,
  cjkFontDataUri: string,
): string {
  const document = trmnlContentToAdaptiveDocument(content);
  return buildTrmnlAdaptiveDocumentHtml(document, target, cjkFontDataUri);
}

async function firstExecutable(candidates: Array<string | undefined>): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return undefined;
}

export async function resolveTrmnlBrowserExecutable(explicit?: string): Promise<string> {
  const executable = await firstExecutable([
    explicit,
    process.env.TRMNL_BROWSER_EXECUTABLE_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]);
  if (!executable) {
    throw new Error(
      'TRMNL renderer requires Chromium/Chrome; set TRMNL_BROWSER_EXECUTABLE_PATH or PUPPETEER_EXECUTABLE_PATH',
    );
  }
  return executable;
}

let cjkFontDataUriPromise: Promise<string> | null = null;

async function loadCjkFontDataUri(): Promise<string> {
  if (!cjkFontDataUriPromise) {
    cjkFontDataUriPromise = readFile(path.resolve(process.cwd(), DEFAULT_CJK_FONT_PATH)).then(
      (buffer) => `data:font/woff2;base64,${buffer.toString('base64')}`,
    );
  }
  return cjkFontDataUriPromise;
}

export class TrmnlAdaptiveRenderer {
  private browser: Browser | null = null;
  private executablePath: string | null = null;

  async initialize(executablePath?: string): Promise<void> {
    const resolved = await resolveTrmnlBrowserExecutable(executablePath);
    if (this.browser && this.executablePath === resolved) return;
    if (this.browser) await this.close();

    this.browser = await puppeteer.launch({
      headless: true,
      executablePath: resolved,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    this.executablePath = resolved;
  }

  async render(
    content: TrmnlAdaptiveContent,
    target: RenderTarget,
    options: TrmnlAdaptiveRenderOptions = {},
  ): Promise<TrmnlAdaptiveRenderResult> {
    if (!content.title.trim()) throw new Error('TRMNL adaptive content title must not be empty');
    return this.renderDocument(trmnlContentToAdaptiveDocument(content), target, options);
  }

  async renderDocument(
    adaptiveDocument: AdaptiveDocument,
    target: RenderTarget,
    options: TrmnlAdaptiveRenderOptions = {},
  ): Promise<TrmnlAdaptiveRenderResult> {
    const titleNode = adaptiveDocument.nodes.find((node) => node.role === 'title' && node.text.trim());
    if (!titleNode) throw new Error('TRMNL AdaptiveDocument must contain a non-empty title node');
    if (target.widthPx <= 0 || target.heightPx <= 0) {
      throw new Error(`Invalid TRMNL target dimensions: ${target.widthPx}x${target.heightPx}`);
    }

    await this.initialize(options.executablePath);
    const page = await this.browser!.newPage();
    const timeoutMs = options.timeoutMs ?? 20_000;
    const startedAt = performance.now();

    try {
      await page.setViewport({
        width: target.widthPx,
        height: target.heightPx,
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      });

      const cjkFontDataUri = await loadCjkFontDataUri();
      const layoutPlan = planAdaptiveLayout(adaptiveDocument, target);
      const html = buildTrmnlAdaptiveDocumentHtml(adaptiveDocument, target, cjkFontDataUri, layoutPlan);
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // TRMNL ships external CSS/fonts plus its JS runtime. Waiting for networkidle0
      // is both slower and less truthful than waiting for the framework's own
      // readiness contract: first make sure terminalize() is installed, then run it.
      await page.waitForFunction(
        () => typeof (globalThis as typeof globalThis & { terminalize?: unknown }).terminalize === 'function',
        { timeout: timeoutMs },
      );

      await page.evaluate(async (debug) => {
        const runtime = globalThis as typeof globalThis & {
          __TRMNL_DEBUG__?: boolean;
          TRMNL_PLUGINS_READY?: boolean;
          terminalize?: () => Promise<void>;
        };
        runtime.__TRMNL_DEBUG__ = debug;
        await document.fonts.ready;
        if (typeof runtime.terminalize !== 'function') {
          throw new Error('TRMNL Framework runtime did not expose terminalize()');
        }
        await runtime.terminalize();
      }, options.debug ?? false);

      await page.waitForFunction(
        () => (globalThis as typeof globalThis & { TRMNL_PLUGINS_READY?: boolean }).TRMNL_PLUGINS_READY === true,
        { timeout: timeoutMs },
      );

      const runtimeMetrics = await page.evaluate(() => {
        const runtime = globalThis as typeof globalThis & {
          __TRMNL_BUILD__?: string;
          __TRMNL_LAST_STATS__?: unknown;
          __QUOTE0_TRMNL_STATS__?: unknown[];
        };
        const screen = document.querySelector<HTMLElement>('.quote0-adaptive-screen');
        const title = document.querySelector<HTMLElement>('.quote0-title');
        const body = document.querySelector<HTMLElement>('.quote0-body');
        if (!screen) throw new Error('TRMNL screen missing after render');
        return {
          frameworkBuild: runtime.__TRMNL_BUILD__ ?? null,
          terminalizeStats: runtime.__TRMNL_LAST_STATS__ ?? null,
          terminalizeStatsHistory: runtime.__QUOTE0_TRMNL_STATS__ ?? [],
          screen: {
            clientWidth: screen.clientWidth,
            clientHeight: screen.clientHeight,
            scrollWidth: screen.scrollWidth,
            scrollHeight: screen.scrollHeight,
          },
          document: {
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
          },
          visibleText: {
            title: title?.textContent?.trim() ?? '',
            body: body?.textContent?.trim() ?? '',
          },
        };
      });

      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: target.widthPx, height: target.heightPx },
        captureBeyondViewport: false,
      });
      const renderMs = round2(performance.now() - startedAt);
      const horizontal =
        runtimeMetrics.screen.scrollWidth > target.widthPx + 1 ||
        runtimeMetrics.document.scrollWidth > target.widthPx + 1;
      const vertical =
        runtimeMetrics.screen.scrollHeight > target.heightPx + 1 ||
        runtimeMetrics.document.scrollHeight > target.heightPx + 1;

      return {
        pngBuffer: Buffer.from(png),
        target,
        profile: deriveTrmnlTargetProfile(target),
        layoutPlan,
        metrics: {
          frameworkVersion: TRMNL_FRAMEWORK_VERSION,
          frameworkBuild: runtimeMetrics.frameworkBuild,
          renderMs,
          terminalizeStats: runtimeMetrics.terminalizeStats,
          terminalizeStatsHistory: runtimeMetrics.terminalizeStatsHistory,
          viewport: { width: target.widthPx, height: target.heightPx },
          screen: runtimeMetrics.screen,
          document: runtimeMetrics.document,
          overflow: { horizontal, vertical },
          visibleText: runtimeMetrics.visibleText,
        },
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.executablePath = null;
    }
  }
}

export const trmnlAdaptiveRenderer = new TrmnlAdaptiveRenderer();
