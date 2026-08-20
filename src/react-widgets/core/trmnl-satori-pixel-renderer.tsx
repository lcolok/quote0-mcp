import React from 'react';
import type { RenderTarget } from './render-targets.js';
import {
  trmnlAdaptiveRenderer,
  type TrmnlAdaptiveContent,
  type TrmnlAdaptiveRenderOptions,
  type TrmnlAdaptiveRenderResult,
} from './trmnl-adaptive-renderer.js';
import {
  satoriRenderer,
  type SatoriBaseFontSize,
  type SatoriPipelineMetrics,
} from './satori-renderer.js';
import { selectOptimalFont } from '../smart-font-selector.js';
import { TRMNL_PIXEL_RENDERER_VERSION } from './renderer-governance.js';

export const TRMNL_SATORI_PIXEL_RENDERER_VERSION = TRMNL_PIXEL_RENDERER_VERSION;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PixelTypography {
  requestedFontPx: number;
  fontPx: number;
  lineHeightPx: number;
  baseFontSize: SatoriBaseFontSize;
  scaleFactor: number;
  errorPx: number;
}

export interface TrmnlPixelSnapPlan {
  version: typeof TRMNL_SATORI_PIXEL_RENDERER_VERSION;
  targetId: string;
  recipeVersion: string;
  composition: 'micro' | 'standard';
  source: 'trmnl-dom-measurement';
  regions: {
    title: PixelRect;
    body: PixelRect;
    footer: PixelRect | null;
  };
  padding: {
    title: PixelPadding;
    body: PixelPadding;
    footer: PixelPadding | null;
  };
  typography: {
    eyebrow: PixelTypography | null;
    title: PixelTypography;
    body: PixelTypography;
    footer: PixelTypography | null;
  };
  text: {
    eyebrow: string;
    title: string;
    body: string;
    footer: string;
  };
  quantization: {
    fractionalRegionEdges: number;
    fractionalTypographyValues: number;
    maxRegionSnapErrorPx: number;
    maxFontSnapErrorPx: number;
  };
}

export interface TrmnlSatoriPixelRenderResult {
  pngBuffer: Buffer;
  target: RenderTarget;
  rendererVersion: typeof TRMNL_SATORI_PIXEL_RENDERER_VERSION;
  layoutPlan: TrmnlPixelSnapPlan;
  trmnlMeasurement: TrmnlAdaptiveRenderResult;
  satoriMetrics: SatoriPipelineMetrics;
  renderMs: number;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function integerPadding(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function snapPadding(value: {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
} | null): PixelPadding {
  return {
    top: integerPadding(value?.paddingTop),
    right: integerPadding(value?.paddingRight),
    bottom: integerPadding(value?.paddingBottom),
    left: integerPadding(value?.paddingLeft),
  };
}

function snapTypography(fontPx: number | null, _lineHeightPx: number | null, fallbackPx: number): PixelTypography {
  const requestedFontPx = Number.isFinite(fontPx) && (fontPx as number) > 0 ? fontPx as number : fallbackPx;
  const selection = selectOptimalFont(requestedFontPx);
  const fontPxSnapped = Math.max(1, selection.actualSize);
  return {
    requestedFontPx,
    fontPx: fontPxSnapped,
    // Pixel fonts have a canonical integer baseline step. Rounding TRMNL's
    // fractional browser line-height (for example 12.987 -> 13) causes every
    // subsequent text row to drift from the proven Current/Satori pixel grid.
    lineHeightPx: fontPxSnapped + 2,
    baseFontSize: selection.baseFontSize,
    scaleFactor: selection.scaleFactor,
    errorPx: Math.round(Math.abs(requestedFontPx - fontPxSnapped) * 100) / 100,
  };
}

function fractional(value: number | null | undefined): boolean {
  return Number.isFinite(value) && Math.abs((value as number) - Math.round(value as number)) > 1e-6;
}

function rectBoundaryError(rect: { x: number; y: number; width: number; height: number } | null): number[] {
  if (!rect) return [];
  const values = [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
  return values.map((value) => Math.abs(value - Math.round(value)));
}

export function buildTrmnlPixelSnapPlan(
  measurement: TrmnlAdaptiveRenderResult,
  target: RenderTarget = measurement.target,
): TrmnlPixelSnapPlan {
  if (measurement.target.id !== target.id
    || measurement.target.widthPx !== target.widthPx
    || measurement.target.heightPx !== target.heightPx) {
    throw new Error('TRMNL pixel snap target does not match measurement target');
  }
  const { metrics } = measurement;
  const titleMeasured = metrics.regions.title;
  const bodyMeasured = metrics.regions.body;
  if (!titleMeasured || !bodyMeasured) {
    throw new Error('TRMNL pixel snap requires measured title and body regions');
  }

  const titleBottom = clampInteger(titleMeasured.y + titleMeasured.height, 0, target.heightPx);
  const footerVisible = Boolean(metrics.visibleText.footer) && Boolean(metrics.regions.footer && metrics.regions.footer.height > 0.5);
  const footerTop = footerVisible
    ? clampInteger(metrics.regions.footer!.y, titleBottom, target.heightPx)
    : target.heightPx;
  const bodyTop = titleBottom;
  const bodyBottom = Math.max(bodyTop, footerTop);

  const title: PixelRect = { x: 0, y: 0, width: target.widthPx, height: titleBottom };
  const body: PixelRect = { x: 0, y: bodyTop, width: target.widthPx, height: bodyBottom - bodyTop };
  const footer: PixelRect | null = footerVisible
    ? { x: 0, y: footerTop, width: target.widthPx, height: target.heightPx - footerTop }
    : null;

  const titleType = snapTypography(metrics.typography.titleFontPx, metrics.typography.titleLineHeightPx, 12);
  const bodyType = snapTypography(metrics.typography.bodyFontPx, metrics.typography.bodyLineHeightPx, 8);
  const footerType = footerVisible
    ? snapTypography(metrics.typography.footerFontPx, metrics.typography.footerLineHeightPx, 8)
    : null;
  const eyebrowType = metrics.visibleText.eyebrow
    ? snapTypography(metrics.typography.eyebrowFontPx, metrics.typography.eyebrowLineHeightPx, 8)
    : null;

  const regionErrors = [
    ...rectBoundaryError(metrics.regions.title),
    ...rectBoundaryError(metrics.regions.body),
    ...rectBoundaryError(metrics.regions.footer),
  ];
  const typographyValues = [
    metrics.typography.eyebrowFontPx,
    metrics.typography.eyebrowLineHeightPx,
    metrics.typography.titleFontPx,
    metrics.typography.titleLineHeightPx,
    metrics.typography.bodyFontPx,
    metrics.typography.bodyLineHeightPx,
    metrics.typography.footerFontPx,
    metrics.typography.footerLineHeightPx,
  ];
  const fontErrors = [eyebrowType, titleType, bodyType, footerType]
    .filter((value): value is PixelTypography => Boolean(value))
    .map((value) => value.errorPx);

  const footerPadding = footerVisible ? snapPadding(metrics.boxModel.footer) : null;
  if (footerPadding && footerPadding.bottom > 0) {
    // Satori's pixel-font baseline sits one raster row higher than the browser
    // footer box for the symmetric 1px/1px TRMNL padding. Preserve the same
    // total vertical padding but move that one row above the text so the final
    // 1-bit footer baseline matches the physical Current/Satori reference.
    footerPadding.top += 1;
    footerPadding.bottom -= 1;
  }

  return {
    version: TRMNL_SATORI_PIXEL_RENDERER_VERSION,
    targetId: target.id,
    recipeVersion: metrics.recipeVersion,
    composition: measurement.profile.composition,
    source: 'trmnl-dom-measurement',
    regions: { title, body, footer },
    padding: {
      title: snapPadding(metrics.boxModel.title),
      body: snapPadding(metrics.boxModel.body),
      footer: footerPadding,
    },
    typography: {
      eyebrow: eyebrowType,
      title: titleType,
      body: bodyType,
      footer: footerType,
    },
    text: {
      eyebrow: metrics.visibleText.eyebrow,
      title: metrics.visibleText.title,
      body: metrics.visibleText.body,
      footer: metrics.visibleText.footer,
    },
    quantization: {
      fractionalRegionEdges: regionErrors.filter((value) => value > 1e-6).length,
      fractionalTypographyValues: typographyValues.filter(fractional).length,
      maxRegionSnapErrorPx: Math.round(Math.max(0, ...regionErrors) * 1000) / 1000,
      maxFontSnapErrorPx: Math.round(Math.max(0, ...fontErrors) * 100) / 100,
    },
  };
}

function fontStyle(type: PixelTypography) {
  return {
    fontFamily: `FusionPixelFont-${type.baseFontSize}px`,
    fontSize: `${type.fontPx}px`,
    lineHeight: `${type.lineHeightPx}px`,
  } as const;
}

export function TrmnlPixelSnapDocument({ plan, target }: { plan: TrmnlPixelSnapPlan; target: RenderTarget }) {
  const { title, body, footer } = plan.regions;
  const titlePadding = plan.padding.title;
  const bodyPadding = plan.padding.body;
  const footerPadding = plan.padding.footer;
  return (
    <div
      style={{
        width: `${target.widthPx}px`,
        height: `${target.heightPx}px`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: `${title.width}px`,
          height: `${title.height}px`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          paddingTop: `${titlePadding.top}px`,
          paddingRight: `${titlePadding.right}px`,
          paddingBottom: `${titlePadding.bottom}px`,
          paddingLeft: `${titlePadding.left}px`,
          backgroundColor: '#000000',
          color: '#FFFFFF',
        }}
      >
        {plan.text.eyebrow && plan.typography.eyebrow && (
          <div
            style={{
              display: 'flex',
              width: '100%',
              flexShrink: 0,
              overflow: 'hidden',
              color: '#FFFFFF',
              ...fontStyle(plan.typography.eyebrow),
            }}
          >
            <span>{plan.text.eyebrow}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            width: '100%',
            flexShrink: 0,
            overflow: 'hidden',
            color: '#FFFFFF',
            fontWeight: 'normal',
            ...fontStyle(plan.typography.title),
          }}
        >
          <span>{plan.text.title}</span>
        </div>
      </div>

      <div
        style={{
          width: `${body.width}px`,
          height: `${body.height}px`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          paddingTop: `${bodyPadding.top}px`,
          paddingRight: `${bodyPadding.right}px`,
          paddingBottom: `${bodyPadding.bottom}px`,
          paddingLeft: `${bodyPadding.left}px`,
          backgroundColor: '#FFFFFF',
          color: '#333333',
          ...fontStyle(plan.typography.body),
        }}
      >
        <span>{plan.text.body}</span>
      </div>

      {footer && plan.typography.footer && footerPadding && (
        <div
          style={{
            width: `${footer.width}px`,
            height: `${footer.height}px`,
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
            overflow: 'hidden',
            paddingTop: `${footerPadding.top}px`,
            paddingRight: `${footerPadding.right}px`,
            paddingBottom: `${footerPadding.bottom}px`,
            paddingLeft: `${footerPadding.left}px`,
            backgroundColor: '#FFFFFF',
            color: '#333333',
            textAlign: 'center',
            ...fontStyle(plan.typography.footer),
          }}
        >
          <span>{plan.text.footer}</span>
        </div>
      )}
    </div>
  );
}

export function trmnlPixelSnapFontBaseSizes(plan: TrmnlPixelSnapPlan): SatoriBaseFontSize[] {
  const sizes = new Set<SatoriBaseFontSize>();
  sizes.add(plan.typography.title.baseFontSize);
  sizes.add(plan.typography.body.baseFontSize);
  if (plan.typography.eyebrow) sizes.add(plan.typography.eyebrow.baseFontSize);
  if (plan.typography.footer) sizes.add(plan.typography.footer.baseFontSize);
  return [...sizes].sort((a, b) => a - b);
}

export async function renderMeasuredTrmnlLayoutWithSatoriPixels(
  measurement: TrmnlAdaptiveRenderResult,
  target: RenderTarget = measurement.target,
): Promise<TrmnlSatoriPixelRenderResult> {
  const startedAt = performance.now();
  const layoutPlan = buildTrmnlPixelSnapPlan(measurement, target);
  const rendered = await satoriRenderer.renderToImageWithMetrics(
    <TrmnlPixelSnapDocument plan={layoutPlan} target={target} />,
    {
      width: target.widthPx,
      height: target.heightPx,
      fontBaseSizes: trmnlPixelSnapFontBaseSizes(layoutPlan),
    },
  );
  return {
    pngBuffer: rendered.pngBuffer,
    target,
    rendererVersion: TRMNL_SATORI_PIXEL_RENDERER_VERSION,
    layoutPlan,
    trmnlMeasurement: measurement,
    satoriMetrics: rendered.metrics,
    renderMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

export async function renderTrmnlLayoutWithSatoriPixels(
  content: TrmnlAdaptiveContent,
  target: RenderTarget,
  options: TrmnlAdaptiveRenderOptions = {},
): Promise<TrmnlSatoriPixelRenderResult> {
  const startedAt = performance.now();
  const measurement = await trmnlAdaptiveRenderer.render(content, target, options);
  const result = await renderMeasuredTrmnlLayoutWithSatoriPixels(measurement, target);
  return {
    ...result,
    renderMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}
