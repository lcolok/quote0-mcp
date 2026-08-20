import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { RenderTarget } from './render-targets.js';
import { selectOptimalFont } from '../smart-font-selector.js';

export const TRMNL_FRAMEWORK_VERSION = '3.2.0';
export const TRMNL_NEWS_RECIPE_VERSION = 'quote0-news-recipe/v2';
export const TRMNL_FRAMEWORK_ORIGIN = 'https://trmnl.com';
export const TRMNL_FRAMEWORK_CSS_URL = `${TRMNL_FRAMEWORK_ORIGIN}/css/${TRMNL_FRAMEWORK_VERSION}/plugins.min.css`;
export const TRMNL_FRAMEWORK_JS_URL = `${TRMNL_FRAMEWORK_ORIGIN}/js/${TRMNL_FRAMEWORK_VERSION}/plugins.min.js`;

const DEFAULT_TRMNL_ASSET_DIR = path.join('assets', 'trmnl', TRMNL_FRAMEWORK_VERSION);
const TRMNL_ASSET_MANIFEST = {
  '/css/3.2.0/plugins.min.css': {
    file: 'plugins.min.css',
    contentType: 'text/css; charset=utf-8',
    sha256: 'a3202dc3eadf5dcebf71e73d6b6bc6439e2202ce7e1ac7dcd6579e69a42f8c7f',
  },
  '/js/3.2.0/plugins.min.js': {
    file: 'plugins.min.js',
    contentType: 'application/javascript; charset=utf-8',
    sha256: '656928777af83a04902e3945dfeb06416990565d62b89a6de314b83ad4d15e0b',
  },
  '/fonts/TRMNL21-Bold.woff2': {
    file: 'TRMNL21-Bold.woff2',
    contentType: 'font/woff2',
    sha256: '7d31442286de794e4626d5eeb43152921ece56ac1455c548ed7bf455f4ede0fe',
  },
  '/fonts/TRMNL16-Regular.woff2': {
    file: 'TRMNL16-Regular.woff2',
    contentType: 'font/woff2',
    sha256: 'b2028391dce2cc9fbaaf830ce48cb31851bfa748af4bdbacf2fc132b762b163d',
  },
} as const;

const DEFAULT_CJK_FONT_PATH = path.join(
  'assets',
  'fonts',
  'fusion-pixel-12px-monospaced-zh_hans.otf.woff2',
);

export interface TrmnlAdaptiveContent {
  title: string;
  body?: string;
  eyebrow?: string;
  footer?: string;
}

export interface TrmnlTargetProfile {
  size: 'sm' | 'md' | 'lg';
  uiScale: number;
  gapScale: number;
  composition: 'micro' | 'standard';
  textScale: 'regular' | 'large';
  colorDepth: 1 | 2 | 4;
  densityTier: '1x' | '2x';
  screenClasses: string[];
}

export interface TrmnlTypographyMeasurement {
  eyebrowFontPx: number | null;
  eyebrowLineHeightPx: number | null;
  titleFontPx: number | null;
  titleLineHeightPx: number | null;
  bodyFontPx: number | null;
  bodyLineHeightPx: number | null;
  footerFontPx: number | null;
  footerLineHeightPx: number | null;
}

export interface TrmnlPhysicalTypographySnapEntry {
  requestedFontPx: number;
  requestedLineHeightPx: number | null;
  fontPx: number;
  lineHeightPx: number;
  baseFontSize: 8 | 10 | 12;
  scaleFactor: number;
}

export interface TrmnlPhysicalTypographySnap {
  eyebrow: TrmnlPhysicalTypographySnapEntry | null;
  title: TrmnlPhysicalTypographySnapEntry | null;
  body: TrmnlPhysicalTypographySnapEntry | null;
  footer: TrmnlPhysicalTypographySnapEntry | null;
}

export interface TrmnlRenderMetrics {
  frameworkVersion: string;
  recipeVersion: string;
  frameworkBuild: string | null;
  renderMs: number;
  pageReused: boolean;
  browserInitMs: number;
  frameworkLoadMs: number;
  domMutationMs: number;
  physicalTypographySnap: TrmnlPhysicalTypographySnap;
  terminalizeMs: number;
  screenshotMs: number;
  assetSource: 'local-pinned' | 'remote';
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
    eyebrow: string;
    title: string;
    body: string;
    footer: string;
  };
  boxModel: {
    title: { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number } | null;
    body: { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number } | null;
    footer: { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number } | null;
  };
  regions: {
    title: { x: number; y: number; width: number; height: number } | null;
    body: { x: number; y: number; width: number; height: number } | null;
    footer: { x: number; y: number; width: number; height: number } | null;
  };
  typography: {
    eyebrowFontPx: number | null;
    eyebrowLineHeightPx: number | null;
    titleFontPx: number | null;
    titleLineHeightPx: number | null;
    bodyFontPx: number | null;
    bodyLineHeightPx: number | null;
    footerFontPx: number | null;
    footerLineHeightPx: number | null;
  };
}

export interface TrmnlAdaptiveRenderResult {
  pngBuffer: Buffer;
  target: RenderTarget;
  profile: TrmnlTargetProfile;
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

function snapTypographyEntry(
  fontPx: number | null,
  lineHeightPx: number | null,
): TrmnlPhysicalTypographySnapEntry | null {
  if (!Number.isFinite(fontPx) || (fontPx as number) <= 0) return null;
  const requestedFontPx = fontPx as number;
  const selection = selectOptimalFont(requestedFontPx);
  const snappedFontPx = Math.max(1, selection.actualSize);
  return {
    requestedFontPx,
    requestedLineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx as number : null,
    fontPx: snappedFontPx,
    lineHeightPx: snappedFontPx + 2,
    baseFontSize: selection.baseFontSize,
    scaleFactor: selection.scaleFactor,
  };
}

/**
 * Quantize the browser-computed TRMNL typography before terminalize() runs.
 *
 * TRMNL still chooses responsive classes and semantic regions. The snap only
 * makes its line wrapping / Clamp measurement use the exact font sizes that the
 * physical Satori/Fusion Pixel raster can reproduce. Without this step a 26px
 * browser title can wrap to two lines while its final 24px pixel title fits one,
 * leaving a large empty black tail on 40×20 and 20×8 thermal targets.
 */
export function snapTrmnlTypographyToPhysicalGrid(
  typography: TrmnlTypographyMeasurement,
): TrmnlPhysicalTypographySnap {
  return {
    eyebrow: snapTypographyEntry(typography.eyebrowFontPx, typography.eyebrowLineHeightPx),
    title: snapTypographyEntry(typography.titleFontPx, typography.titleLineHeightPx),
    body: snapTypographyEntry(typography.bodyFontPx, typography.bodyLineHeightPx),
    footer: snapTypographyEntry(typography.footerFontPx, typography.footerLineHeightPx),
  };
}

type PinnedTrmnlAsset = {
  body: Buffer;
  contentType: string;
};

type PinnedTrmnlAssetMap = Map<string, PinnedTrmnlAsset>;

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function loadPinnedTrmnlAssets(): Promise<PinnedTrmnlAssetMap | null> {
  const assetDir = path.resolve(process.cwd(), process.env.TRMNL_FRAMEWORK_ASSET_DIR || DEFAULT_TRMNL_ASSET_DIR);
  const assets: PinnedTrmnlAssetMap = new Map();
  try {
    for (const [requestPath, descriptor] of Object.entries(TRMNL_ASSET_MANIFEST)) {
      const body = await readFile(path.join(assetDir, descriptor.file));
      const actual = sha256(body);
      if (actual !== descriptor.sha256) {
        throw new Error(`TRMNL pinned asset checksum mismatch: ${descriptor.file} expected=${descriptor.sha256} actual=${actual}`);
      }
      assets.set(requestPath, { body, contentType: descriptor.contentType });
    }
    return assets;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
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
  const composition: TrmnlTargetProfile['composition'] = uiScale <= 0.5 ? 'micro' : 'standard';
  const textScale: TrmnlTargetProfile['textScale'] = composition === 'micro'
    ? 'regular'
    : uiScale <= 0.8 ? 'large' : 'regular';
  const size: TrmnlTargetProfile['size'] =
    target.widthPx >= 1024 ? 'lg' : target.widthPx >= 800 ? 'md' : 'sm';
  const colorDepth: 1 | 2 | 4 = target.colorMode === 'mono-1bit' ? 1 : 4;
  const densityTier: '1x' | '2x' = '1x';

  return {
    size,
    uiScale,
    gapScale,
    composition,
    textScale,
    colorDepth,
    densityTier,
    screenClasses: [
      'screen',
      'screen--byod_custom',
      'screen--no-bleed',
      `screen--text-scale-${textScale}`,
      `screen--${size}`,
      ...(composition === 'micro' ? ['quote0-screen--micro'] : []),
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

export function buildTrmnlAdaptiveHtml(
  content: TrmnlAdaptiveContent,
  target: RenderTarget,
  cjkFontDataUri: string,
  frameworkOrigin: string = TRMNL_FRAMEWORK_ORIGIN,
): string {
  const profile = deriveTrmnlTargetProfile(target);
  const frameworkCssUrl = `${frameworkOrigin}/css/${TRMNL_FRAMEWORK_VERSION}/plugins.min.css`;
  const frameworkJsUrl = `${frameworkOrigin}/js/${TRMNL_FRAMEWORK_VERSION}/plugins.min.js`;
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

  const isMicro = profile.composition === 'micro';
  const eyebrowVisible = Boolean(content.eyebrow) && !isMicro;
  const footerVisible = Boolean(content.footer) && !isMicro;
  const bodyTextClass = isMicro ? 'text--base' : 'text--small';
  const bodyClamp = isMicro ? 3 : 6;
  const eyebrow = `<span class="label label--small quote0-eyebrow" data-clamp="1"${eyebrowVisible ? '' : ' hidden'}>${escapeHtml(content.eyebrow)}</span>`;
  const body = `<div class="content grow quote0-body-region" data-content-limiter="true"${content.body ? '' : ' hidden'}><p class="${bodyTextClass} quote0-body-text" data-clamp="${bodyClamp}">${escapeHtml(content.body)}</p></div>`;
  const footer = `<div class="flex flex--center flex-none quote0-footer-region"${footerVisible ? '' : ' hidden'}><span class="text--small quote0-footer" data-clamp="1">${escapeHtml(content.footer)}</span></div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="${frameworkCssUrl}" />
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
    .quote0-adaptive-screen .layout { box-sizing: border-box; }
    .quote0-news-layout {
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .quote0-news-stack {
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .quote0-news-layout [hidden] { display: none !important; }
    .quote0-title-region {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      gap: 1px;
      min-width: 0;
      overflow: hidden;
    }
    .quote0-title,
    .quote0-eyebrow,
    .quote0-footer,
    .quote0-body-text {
      font-family: "Quote0 Fusion Pixel", "TRMNL16", monospace !important;
    }
    .quote0-title {
      font-family: "Quote0 Fusion Pixel", "TRMNL21", monospace !important;
      width: 100%;
      min-width: 0;
      text-align: left;
      line-height: 1.08;
      font-weight: 400;
    }
    .quote0-eyebrow {
      color: inherit;
      opacity: 0.86;
    }
    .quote0-body-region {
      width: 100%;
      min-width: 0;
      min-height: 0;
      box-sizing: border-box;
      padding: 2px 4px;
      overflow: hidden;
    }
    .quote0-body-text {
      margin: 0;
      width: 100%;
      line-height: 1.17;
      text-align: left;
    }
    .quote0-footer-region {
      width: 100%;
      min-height: 16px;
      box-sizing: border-box;
      padding: 1px 4px;
      border-top: 1px solid var(--framework-border-muted, rgba(0, 0, 0, 0.12));
      overflow: hidden;
    }
    .quote0-footer {
      width: 100%;
      text-align: center;
      line-height: 1.08;
      opacity: 0.86;
    }
    .quote0-screen--micro .quote0-title-region {
      padding: 2px 4px;
    }
    .quote0-screen--micro .quote0-title {
      line-height: 1.05;
    }
    .quote0-screen--micro .quote0-body-region {
      padding: 1px 3px;
    }
  </style>
  <script>
    window.__QUOTE0_TRMNL_STATS__ = [];
    window.addEventListener('trmnl:terminalize:stats', function (event) {
      window.__QUOTE0_TRMNL_STATS__.push(event.detail);
    });
  </script>
  <script src="${frameworkJsUrl}" defer></script>
</head>
<body class="environment trmnl">
  <div class="${profile.screenClasses.join(' ')} quote0-adaptive-screen" style="${screenStyle}">
    <div class="view view--full">
      <div class="layout layout--col layout--top layout--stretch gap--none quote0-news-layout">
        <div class="flex flex--col gap--none quote0-news-stack">
          <div class="inverse flex flex--col shrink-0 quote0-title-region">
            ${eyebrow}
            <span class="text--xlarge quote0-title" data-clamp="2">${escapeHtml(content.title)}</span>
          </div>
          ${body}
          ${footer}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
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
  private page: Page | null = null;
  private executablePath: string | null = null;
  private assetServer: Server | null = null;
  private assetBaseUrl = TRMNL_FRAMEWORK_ORIGIN;
  private assetSource: 'local-pinned' | 'remote' = 'remote';
  private assetInitialization: Promise<void> | null = null;
  private renderTail: Promise<void> = Promise.resolve();

  private async withRenderLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.renderTail;
    let release!: () => void;
    this.renderTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async resetPage(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => undefined);
    }
    this.page = null;
  }

  private async ensureFrameworkAssetOrigin(): Promise<string> {
    if (!this.assetInitialization) {
      this.assetInitialization = (async () => {
        const assets = await loadPinnedTrmnlAssets();
        if (!assets) {
          this.assetSource = 'remote';
          this.assetBaseUrl = TRMNL_FRAMEWORK_ORIGIN;
          return;
        }

        const server = createServer((request, response) => {
          const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
          const asset = assets.get(requestPath);
          if (!asset) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
          }
          response.writeHead(200, {
            'content-type': asset.contentType,
            'content-length': String(asset.body.length),
            'cache-control': 'public, max-age=31536000, immutable',
            'access-control-allow-origin': '*',
          });
          response.end(asset.body);
        });

        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            server.off('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(0, '127.0.0.1');
        });

        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          throw new Error('TRMNL local asset server did not expose a TCP port');
        }
        this.assetServer = server;
        this.assetBaseUrl = `http://127.0.0.1:${address.port}`;
        this.assetSource = 'local-pinned';
      })().catch((error) => {
        this.assetInitialization = null;
        throw error;
      });
    }
    await this.assetInitialization;
    return this.assetBaseUrl;
  }

  async initialize(executablePath?: string): Promise<void> {
    if (this.browser && this.executablePath && !executablePath) return;
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
    if (target.widthPx <= 0 || target.heightPx <= 0) {
      throw new Error(`Invalid TRMNL target dimensions: ${target.widthPx}x${target.heightPx}`);
    }

    return this.withRenderLock(() => this.renderLocked(content, target, options));
  }

  async prewarm(target: RenderTarget, options: TrmnlAdaptiveRenderOptions = {}): Promise<TrmnlRenderMetrics> {
    const result = await this.render(
      {
        title: 'Quote0 TRMNL 预热',
        body: '墨水屏中文字体与 pinned Framework runtime 预热',
        footer: 'Quote0 canary',
      },
      target,
      options,
    );
    return result.metrics;
  }

  private async renderLocked(
    content: TrmnlAdaptiveContent,
    target: RenderTarget,
    options: TrmnlAdaptiveRenderOptions,
  ): Promise<TrmnlAdaptiveRenderResult> {
    const timeoutMs = options.timeoutMs ?? 20_000;
    const debug = options.debug ?? false;
    const startedAt = performance.now();

    const browserInitStartedAt = performance.now();
    await this.initialize(options.executablePath);
    const browserInitMs = round2(performance.now() - browserInitStartedAt);
    const frameworkOrigin = await this.ensureFrameworkAssetOrigin();

    const pageReused = Boolean(this.page && !this.page.isClosed());
    let frameworkLoadMs = 0;
    let domMutationMs = 0;

    try {
      if (!pageReused) {
        await this.resetPage();
        this.page = await this.browser!.newPage();
      }

      await this.page!.setViewport({
        width: target.widthPx,
        height: target.heightPx,
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      });

      const frameworkLoadStartedAt = performance.now();
      const cjkFontDataUri = await loadCjkFontDataUri();
      const html = buildTrmnlAdaptiveHtml(content, target, cjkFontDataUri, frameworkOrigin);
      await this.page!.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await this.page!.waitForFunction(
        () => typeof (globalThis as typeof globalThis & { terminalize?: unknown }).terminalize === 'function',
        { timeout: timeoutMs },
      );
      await this.page!.evaluate(async (debugEnabled) => {
        const runtime = globalThis as typeof globalThis & {
          __TRMNL_DEBUG__?: boolean;
          __TRMNL_LAST_STATS__?: unknown;
          __QUOTE0_TRMNL_STATS__?: unknown[];
          TRMNL_PLUGINS_READY?: boolean;
        };
        await document.fonts.ready;
        runtime.__TRMNL_DEBUG__ = debugEnabled;
        runtime.__TRMNL_LAST_STATS__ = undefined;
        runtime.__QUOTE0_TRMNL_STATS__ = [];
        runtime.TRMNL_PLUGINS_READY = false;
      }, debug);
      frameworkLoadMs = round2(performance.now() - frameworkLoadStartedAt);

      const requestedTypography = await this.page!.evaluate((): TrmnlTypographyMeasurement => {
        const typographyOf = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return { fontPx: null, lineHeightPx: null };
          const style = getComputedStyle(element);
          const fontPx = Number.parseFloat(style.fontSize);
          const lineHeightPx = Number.parseFloat(style.lineHeight);
          return {
            fontPx: Number.isFinite(fontPx) ? fontPx : null,
            lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : null,
          };
        };
        const eyebrow = typographyOf('.quote0-eyebrow');
        const title = typographyOf('.quote0-title');
        const body = typographyOf('.quote0-body-text');
        const footer = typographyOf('.quote0-footer');
        return {
          eyebrowFontPx: eyebrow.fontPx,
          eyebrowLineHeightPx: eyebrow.lineHeightPx,
          titleFontPx: title.fontPx,
          titleLineHeightPx: title.lineHeightPx,
          bodyFontPx: body.fontPx,
          bodyLineHeightPx: body.lineHeightPx,
          footerFontPx: footer.fontPx,
          footerLineHeightPx: footer.lineHeightPx,
        };
      });
      const physicalTypographySnap = snapTrmnlTypographyToPhysicalGrid(requestedTypography);
      const domMutationStartedAt = performance.now();
      await this.page!.evaluate((snap) => {
        const apply = (
          selector: string,
          value: TrmnlPhysicalTypographySnapEntry | null,
        ) => {
          if (!value) return;
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return;
          element.style.setProperty('font-size', `${value.fontPx}px`, 'important');
          element.style.setProperty('line-height', `${value.lineHeightPx}px`, 'important');
        };
        apply('.quote0-eyebrow', snap.eyebrow);
        apply('.quote0-title', snap.title);
        apply('.quote0-body-text', snap.body);
        apply('.quote0-footer', snap.footer);
      }, physicalTypographySnap);
      domMutationMs = round2(performance.now() - domMutationStartedAt);

      const terminalizeStartedAt = performance.now();
      await this.page!.evaluate(async (debugEnabled) => {
        const runtime = globalThis as typeof globalThis & {
          __TRMNL_DEBUG__?: boolean;
          terminalize?: () => Promise<void>;
        };
        runtime.__TRMNL_DEBUG__ = debugEnabled;
        if (typeof runtime.terminalize !== 'function') {
          throw new Error('TRMNL Framework runtime did not expose terminalize()');
        }
        await runtime.terminalize();
      }, debug);
      await this.page!.waitForFunction(
        () => (globalThis as typeof globalThis & { TRMNL_PLUGINS_READY?: boolean }).TRMNL_PLUGINS_READY === true,
        { timeout: timeoutMs },
      );
      const terminalizeMs = round2(performance.now() - terminalizeStartedAt);

      const runtimeMetrics = await this.page!.evaluate(() => {
        const runtime = globalThis as typeof globalThis & {
          __TRMNL_BUILD__?: string;
          __TRMNL_LAST_STATS__?: unknown;
          __QUOTE0_TRMNL_STATS__?: unknown[];
        };
        const screen = document.querySelector<HTMLElement>('.quote0-adaptive-screen');
        if (!screen) throw new Error('TRMNL screen missing after render');
        const eyebrow = screen.querySelector<HTMLElement>('.quote0-eyebrow');
        const title = screen.querySelector<HTMLElement>('.quote0-title');
        const bodyText = screen.querySelector<HTMLElement>('.quote0-body-text');
        const footer = screen.querySelector<HTMLElement>('.quote0-footer');
        const titleRegion = screen.querySelector<HTMLElement>('.quote0-title-region');
        const bodyRegion = screen.querySelector<HTMLElement>('.quote0-body-region');
        const footerRegion = screen.querySelector<HTMLElement>('.quote0-footer-region');
        const rectOf = (element: HTMLElement | null) => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const typographyOf = (element: HTMLElement | null) => {
          if (!element) return { fontPx: null, lineHeightPx: null };
          const style = getComputedStyle(element);
          const fontPx = Number.parseFloat(style.fontSize);
          const lineHeightPx = Number.parseFloat(style.lineHeight);
          return {
            fontPx: Number.isFinite(fontPx) ? fontPx : null,
            lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : null,
          };
        };
        const boxModelOf = (element: HTMLElement | null) => {
          if (!element) return null;
          const style = getComputedStyle(element);
          const parse = (value: string) => {
            const number = Number.parseFloat(value);
            return Number.isFinite(number) ? number : 0;
          };
          return {
            paddingTop: parse(style.paddingTop),
            paddingRight: parse(style.paddingRight),
            paddingBottom: parse(style.paddingBottom),
            paddingLeft: parse(style.paddingLeft),
          };
        };
        const visibleTextOf = (element: HTMLElement | null) => {
          if (!element || element.hidden || element.closest('[hidden]') || getComputedStyle(element).display === 'none') return '';
          return element.textContent?.trim() ?? '';
        };
        const eyebrowType = typographyOf(eyebrow);
        const titleType = typographyOf(title);
        const bodyType = typographyOf(bodyText);
        const footerType = typographyOf(footer);
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
            eyebrow: visibleTextOf(eyebrow),
            title: visibleTextOf(title),
            body: visibleTextOf(bodyText),
            footer: visibleTextOf(footer),
          },
          boxModel: {
            title: boxModelOf(titleRegion),
            body: boxModelOf(bodyRegion),
            footer: boxModelOf(footerRegion),
          },
          regions: {
            title: rectOf(titleRegion),
            body: rectOf(bodyRegion),
            footer: rectOf(footerRegion),
          },
          typography: {
            eyebrowFontPx: eyebrowType.fontPx,
            eyebrowLineHeightPx: eyebrowType.lineHeightPx,
            titleFontPx: titleType.fontPx,
            titleLineHeightPx: titleType.lineHeightPx,
            bodyFontPx: bodyType.fontPx,
            bodyLineHeightPx: bodyType.lineHeightPx,
            footerFontPx: footerType.fontPx,
            footerLineHeightPx: footerType.lineHeightPx,
          },
        };
      });

      const screenshotStartedAt = performance.now();
      const png = await this.page!.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: target.widthPx, height: target.heightPx },
        captureBeyondViewport: false,
      });
      const screenshotMs = round2(performance.now() - screenshotStartedAt);
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
        metrics: {
          frameworkVersion: TRMNL_FRAMEWORK_VERSION,
          recipeVersion: TRMNL_NEWS_RECIPE_VERSION,
          frameworkBuild: runtimeMetrics.frameworkBuild,
          renderMs,
          pageReused,
          browserInitMs,
          frameworkLoadMs,
          domMutationMs,
          physicalTypographySnap,
          terminalizeMs,
          screenshotMs,
          assetSource: this.assetSource,
          terminalizeStats: runtimeMetrics.terminalizeStats,
          terminalizeStatsHistory: runtimeMetrics.terminalizeStatsHistory,
          viewport: { width: target.widthPx, height: target.heightPx },
          screen: runtimeMetrics.screen,
          document: runtimeMetrics.document,
          overflow: { horizontal, vertical },
          visibleText: runtimeMetrics.visibleText,
          boxModel: runtimeMetrics.boxModel,
          regions: runtimeMetrics.regions,
          typography: runtimeMetrics.typography,
        },
      };
    } catch (error) {
      await this.resetPage();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.resetPage();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.executablePath = null;
    }
    if (this.assetServer) {
      await new Promise<void>((resolve) => this.assetServer!.close(() => resolve()));
      this.assetServer = null;
    }
    this.assetInitialization = null;
    this.assetBaseUrl = TRMNL_FRAMEWORK_ORIGIN;
    this.assetSource = 'remote';
  }
}

export const trmnlAdaptiveRenderer = new TrmnlAdaptiveRenderer();
