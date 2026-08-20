import { describe, expect, test } from 'bun:test';

const TRMNL_PIXEL_BRIDGE_VISUAL_SMOKE = String.raw`
import React from 'react';
import sharp from 'sharp';
import { EINK_TARGET, LABEL_T20X8_TARGET } from './src/react-widgets/core/render-targets.ts';
import { SatoriNewsWidget } from './src/react-widgets/components/SatoriNewsWidget.tsx';
import { satoriRenderer } from './src/react-widgets/core/satori-renderer.ts';
import { pngTo1BitBitmap } from './src/api/eink-converter.ts';
import {
  buildTrmnlPixelSnapPlan,
  TrmnlPixelSnapDocument,
  trmnlPixelSnapFontBaseSizes,
} from './src/react-widgets/core/trmnl-satori-pixel-renderer.tsx';

function measurement(target, micro = false) {
  return {
    pngBuffer: Buffer.alloc(0),
    target,
    profile: {
      size: 'sm',
      uiScale: micro ? 0.5 : 0.74,
      gapScale: micro ? 0.5 : 0.74,
      composition: micro ? 'micro' : 'standard',
      textScale: micro ? 'regular' : 'large',
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
      terminalizeMs: 250,
      screenshotMs: 25,
      assetSource: 'local-pinned',
      terminalizeStats: null,
      terminalizeStatsHistory: [],
      viewport: { width: target.widthPx, height: target.heightPx },
      screen: { clientWidth: target.widthPx, clientHeight: target.heightPx, scrollWidth: target.widthPx, scrollHeight: target.heightPx },
      document: { scrollWidth: target.widthPx, scrollHeight: target.heightPx },
      overflow: { horizontal: false, vertical: false },
      visibleText: micro
        ? { eyebrow: '', title: '20×8压力测试', body: 'TRMNL负责排版，Satori负责点阵。', footer: '' }
        : { eyebrow: '', title: 'KMP鸿蒙渲染内存降95%', body: 'KMP在鸿蒙系统实现高效运行：渲染内存降95%，GC卡顿率降90%，显著提升性能与流畅度。', footer: '来源: InfoQ' },
      boxModel: micro
        ? { title: { paddingTop: 2, paddingRight: 4, paddingBottom: 2, paddingLeft: 4 }, body: { paddingTop: 1, paddingRight: 3, paddingBottom: 1, paddingLeft: 3 }, footer: null }
        : { title: { paddingTop: 4, paddingRight: 6, paddingBottom: 4, paddingLeft: 6 }, body: { paddingTop: 2, paddingRight: 4, paddingBottom: 2, paddingLeft: 4 }, footer: { paddingTop: 1, paddingRight: 4, paddingBottom: 1, paddingLeft: 4 } },
      regions: micro
        ? { title: { x: 0, y: 0, width: 160, height: 17.640625 }, body: { x: 0, y: 17.640625, width: 160, height: 46.359375 }, footer: null }
        : { title: { x: 0, y: 0, width: 296, height: 33.96875 }, body: { x: 0, y: 33.96875, width: 296, height: 102.03125 }, footer: { x: 0, y: 136, width: 296, height: 16 } },
      typography: micro
        ? { eyebrowFontPx: 6, eyebrowLineHeightPx: 6, titleFontPx: 13, titleLineHeightPx: 13.65, bodyFontPx: 8, bodyLineHeightPx: 9.36, footerFontPx: 6, footerLineHeightPx: 6.48 }
        : { eyebrowFontPx: 11.1, eyebrowLineHeightPx: 11.1, titleFontPx: 24.05, titleLineHeightPx: 25.974, bodyFontPx: 11.1, bodyLineHeightPx: 12.987, footerFontPx: 11.1, footerLineHeightPx: 11.988 },
    },
  };
}

async function render(target, micro) {
  const plan = buildTrmnlPixelSnapPlan(measurement(target, micro), target);
  const rendered = await satoriRenderer.renderToImageWithMetrics(
    React.createElement(TrmnlPixelSnapDocument, { plan, target }),
    { width: target.widthPx, height: target.heightPx, fontBaseSizes: trmnlPixelSnapFontBaseSizes(plan) },
  );
  const raw = await sharp(rendered.pngBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  const histogram = new Uint32Array(256);
  for (const value of raw.data) histogram[value] += 1;
  const values = [];
  for (let i = 0; i < 256; i += 1) if (histogram[i]) values.push(i);
  const intermediate = values.filter((value) => value !== 0 && value !== 255);
  return { plan, raw, values, intermediate, renderMs: rendered.metrics.totalMs, pngBuffer: rendered.pngBuffer };
}

const standard = await render(EINK_TARGET, false);
if (standard.raw.info.width !== 296 || standard.raw.info.height !== 152) throw new Error('standard geometry regressed');
if (standard.plan.regions.title.height !== 34 || standard.plan.regions.body.height !== 102 || standard.plan.regions.footer?.height !== 16) throw new Error('standard snap geometry regressed');
if (standard.plan.typography.title.fontPx !== 24 || standard.plan.typography.body.fontPx !== 12) throw new Error('standard pixel typography regressed');
if (standard.plan.typography.body.lineHeightPx !== 14 || standard.plan.typography.footer?.lineHeightPx !== 14) throw new Error('standard pixel line-height regressed');
if (standard.values.length > 4 || standard.intermediate.length > 2) throw new Error('standard raster gained browser-like grayscale: ' + JSON.stringify(standard.values));

const current = await satoriRenderer.renderToImageWithMetrics(
  React.createElement(SatoriNewsWidget, {
    data: {
      title: 'KMP鸿蒙渲染内存降95%',
      message: 'KMP在鸿蒙系统实现高效运行：渲染内存降95%，GC卡顿率降90%，显著提升性能与流畅度。',
      signature: '',
      source: 'InfoQ',
    },
    target: EINK_TARGET,
  }),
  { width: 296, height: 152 },
);
const [currentPlane, bridgePlane] = await Promise.all([
  pngTo1BitBitmap(current.pngBuffer, 296, 152),
  pngTo1BitBitmap(standard.pngBuffer, 296, 152),
]);
if (!currentPlane.equals(bridgePlane)) throw new Error('standard physical plane no longer matches Current/Satori bit-for-bit');

const micro = await render(LABEL_T20X8_TARGET, true);
if (micro.raw.info.width !== 160 || micro.raw.info.height !== 64) throw new Error('micro geometry regressed');
if (micro.plan.regions.title.height !== 18 || micro.plan.regions.body.height !== 46 || micro.plan.regions.footer !== null) throw new Error('micro snap geometry regressed');
if (micro.plan.typography.title.fontPx !== 12 || micro.plan.typography.body.fontPx !== 8) throw new Error('micro pixel typography regressed');
if (micro.values.length > 4 || micro.intermediate.length > 2) throw new Error('micro raster gained browser-like grayscale: ' + JSON.stringify(micro.values));

console.log('TRMNL_PIXEL_BRIDGE_VISUAL_OK=' + JSON.stringify({
  standard: { values: standard.values, regions: standard.plan.regions, typography: standard.plan.typography, renderMs: standard.renderMs },
  micro: { values: micro.values, regions: micro.plan.regions, typography: micro.plan.typography, renderMs: micro.renderMs },
}));
await satoriRenderer.close();
`;

describe('TRMNL layout → Satori pixel bridge visual regression', () => {
  test('real Satori/resvg output stays on a low-grayscale integer pixel lattice for standard and micro targets', async () => {
    const child = Bun.spawn(['bun', '-e', TRMNL_PIXEL_BRIDGE_VISUAL_SMOKE], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('panicked');
    expect(stdout).toContain('TRMNL_PIXEL_BRIDGE_VISUAL_OK=');
  });
});
