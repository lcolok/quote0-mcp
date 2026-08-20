import { describe, expect, test } from 'bun:test';
import { EINK_TARGET, LABEL_T20X8_TARGET } from './render-targets.js';
import type { TrmnlAdaptiveRenderResult } from './trmnl-adaptive-renderer.js';
import {
  TRMNL_SATORI_PIXEL_RENDERER_VERSION,
  buildTrmnlPixelSnapPlan,
} from './trmnl-satori-pixel-renderer.js';

function measurement(overrides: Partial<TrmnlAdaptiveRenderResult> = {}): TrmnlAdaptiveRenderResult {
  return {
    pngBuffer: Buffer.alloc(0),
    target: EINK_TARGET,
    profile: {
      size: 'sm',
      uiScale: 0.74,
      gapScale: 0.74,
      composition: 'standard',
      textScale: 'large',
      colorDepth: 1,
      densityTier: '1x',
      screenClasses: ['screen'],
    },
    metrics: {
      frameworkVersion: '3.2.0',
      recipeVersion: 'quote0-news-recipe/v2',
      frameworkBuild: 'plugins.js v3.2.0',
      renderMs: 500,
      pageReused: true,
      browserInitMs: 0,
      frameworkLoadMs: 200,
      domMutationMs: 0,
      physicalTypographySnap: {
        eyebrow: null,
        title: { requestedFontPx: 24.05, requestedLineHeightPx: 25.974, fontPx: 24, lineHeightPx: 26, baseFontSize: 12, scaleFactor: 2 },
        body: { requestedFontPx: 11.1, requestedLineHeightPx: 12.987, fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1 },
        footer: { requestedFontPx: 11.1, requestedLineHeightPx: 11.988, fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1 },
      },
      terminalizeMs: 250,
      screenshotMs: 25,
      assetSource: 'local-pinned',
      terminalizeStats: null,
      terminalizeStatsHistory: [],
      viewport: { width: 296, height: 152 },
      screen: { clientWidth: 296, clientHeight: 152, scrollWidth: 296, scrollHeight: 152 },
      document: { scrollWidth: 296, scrollHeight: 152 },
      overflow: { horizontal: false, vertical: false },
      visibleText: {
        eyebrow: '',
        title: 'KMP鸿蒙渲染内存降95%',
        body: '正文',
        footer: '来源: InfoQ',
      },
      boxModel: {
        title: { paddingTop: 4, paddingRight: 6, paddingBottom: 4, paddingLeft: 6 },
        body: { paddingTop: 2, paddingRight: 4, paddingBottom: 2, paddingLeft: 4 },
        footer: { paddingTop: 1, paddingRight: 4, paddingBottom: 1, paddingLeft: 4 },
      },
      regions: {
        title: { x: 0, y: 0, width: 296, height: 33.96875 },
        body: { x: 0, y: 33.96875, width: 296, height: 102.03125 },
        footer: { x: 0, y: 136, width: 296, height: 16 },
      },
      typography: {
        eyebrowFontPx: null,
        eyebrowLineHeightPx: null,
        titleFontPx: 24.05,
        titleLineHeightPx: 25.974,
        bodyFontPx: 11.1,
        bodyLineHeightPx: 12.987,
        footerFontPx: 11.1,
        footerLineHeightPx: 11.988,
      },
    },
    ...overrides,
  };
}

describe('TRMNL → Satori pixel snap bridge', () => {
  test('snaps fractional 296×152 DOM geometry into an exact contiguous integer lattice', () => {
    const plan = buildTrmnlPixelSnapPlan(measurement());

    expect(plan.version).toBe(TRMNL_SATORI_PIXEL_RENDERER_VERSION);
    expect(plan.source).toBe('trmnl-dom-measurement');
    expect(plan.regions).toEqual({
      title: { x: 0, y: 0, width: 296, height: 34 },
      body: { x: 0, y: 34, width: 296, height: 102 },
      footer: { x: 0, y: 136, width: 296, height: 16 },
    });
    expect(plan.regions.title.height + plan.regions.body.height + plan.regions.footer!.height).toBe(152);
    expect(plan.typography.title).toMatchObject({ fontPx: 24, lineHeightPx: 26, baseFontSize: 12, scaleFactor: 2 });
    expect(plan.typography.body).toMatchObject({ fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1 });
    expect(plan.typography.footer).toMatchObject({ fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1 });
    expect(plan.padding.footer).toEqual({ top: 2, right: 4, bottom: 0, left: 4 });
    expect(plan.quantization.fractionalRegionEdges).toBeGreaterThan(0);
    expect(plan.quantization.fractionalTypographyValues).toBeGreaterThan(0);
    expect(plan.quantization.maxRegionSnapErrorPx).toBeLessThanOrEqual(0.5);
    expect(plan.quantization.maxFontSnapErrorPx).toBeLessThanOrEqual(1);
  });

  test('keeps TRMNL micro semantics while removing unsupported fractional typography', () => {
    const micro = measurement({
      target: LABEL_T20X8_TARGET,
      profile: {
        size: 'sm',
        uiScale: 0.5,
        gapScale: 0.5,
        composition: 'micro',
        textScale: 'regular',
        colorDepth: 1,
        densityTier: '1x',
        screenClasses: ['screen', 'quote0-screen--micro'],
      },
      metrics: {
        ...measurement().metrics,
        viewport: { width: 160, height: 64 },
        screen: { clientWidth: 160, clientHeight: 64, scrollWidth: 160, scrollHeight: 64 },
        document: { scrollWidth: 160, scrollHeight: 64 },
        visibleText: { eyebrow: '', title: '20×8压力测试', body: '同一 Recipe 微型排版', footer: '' },
        boxModel: {
          title: { paddingTop: 2, paddingRight: 4, paddingBottom: 2, paddingLeft: 4 },
          body: { paddingTop: 1, paddingRight: 3, paddingBottom: 1, paddingLeft: 3 },
          footer: null,
        },
        regions: {
          title: { x: 0, y: 0, width: 160, height: 17.640625 },
          body: { x: 0, y: 17.640625, width: 160, height: 46.359375 },
          footer: null,
        },
        typography: {
          eyebrowFontPx: null,
          eyebrowLineHeightPx: null,
          titleFontPx: 13,
          titleLineHeightPx: 13.65,
          bodyFontPx: 8,
          bodyLineHeightPx: 9.36,
          footerFontPx: null,
          footerLineHeightPx: null,
        },
      },
    });

    const plan = buildTrmnlPixelSnapPlan(micro, LABEL_T20X8_TARGET);
    expect(plan.composition).toBe('micro');
    expect(plan.regions).toEqual({
      title: { x: 0, y: 0, width: 160, height: 18 },
      body: { x: 0, y: 18, width: 160, height: 46 },
      footer: null,
    });
    expect(plan.typography.title).toMatchObject({ requestedFontPx: 13, fontPx: 12, baseFontSize: 12 });
    expect(plan.typography.body).toMatchObject({ requestedFontPx: 8, fontPx: 8, lineHeightPx: 10, baseFontSize: 8 });
    expect(plan.typography.footer).toBeNull();
    expect(plan.text.footer).toBe('');
  });

  test('fails closed when a measurement is reused for a different target', () => {
    expect(() => buildTrmnlPixelSnapPlan(measurement(), LABEL_T20X8_TARGET)).toThrow('does not match measurement target');
  });
});
