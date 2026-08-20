import { describe, expect, test } from 'bun:test';
import type { TrmnlPixelSnapPlan } from '../react-widgets/core/trmnl-satori-pixel-renderer.js';
import { buildTrmnlReviewContent, measureTitleBarUtilization } from './renderer-review-service.js';

const ORDINARY_ROW = {
  id: 1,
  processed_content: {
    title: '普通新闻标题',
    message: '普通新闻正文',
    source: 'InfoQ',
    signature: 'AI优化·Q95',
    category: '技术',
  },
};

const RESEARCH_ROW = {
  id: 2,
  layer: 'external-renderable',
  job_id: 'renderable-intake',
  processed_content: {
    title: 'MCP 新规范取消会话',
    message: '研究正文',
    source: 'MCP 官方',
    signature: '神经漫游者',
    metadata: {
      producer: 'external-renderable-agent',
      researchReceipt: {
        sources: [{ id: 's1' }, { id: 's2' }],
        claims: [{ text: 'c1' }],
      },
    },
  },
};

function clearPlanePixel(plane: Buffer, width: number, x: number, y: number): void {
  const bytesPerRow = Math.ceil(width / 8);
  const offset = y * bytesPerRow + (x >> 3);
  plane[offset] = (plane[offset] ?? 0) & ~(1 << (7 - (x & 7)));
}

function titlePlan(titleHeight: number): TrmnlPixelSnapPlan {
  return {
    version: 'trmnl-layout-satori-pixel/v2',
    targetId: 'label-T40x20-320',
    recipeVersion: 'quote0-news-recipe/v2',
    composition: 'standard',
    source: 'trmnl-dom-measurement',
    regions: {
      title: { x: 0, y: 0, width: 320, height: titleHeight },
      body: { x: 0, y: titleHeight, width: 320, height: 160 - titleHeight - 16 },
      footer: { x: 0, y: 144, width: 320, height: 16 },
    },
    padding: {
      title: { top: 4, right: 6, bottom: 4, left: 6 },
      body: { top: 2, right: 4, bottom: 2, left: 4 },
      footer: { top: 2, right: 4, bottom: 0, left: 4 },
    },
    typography: {
      eyebrow: null,
      title: { requestedFontPx: 24, fontPx: 24, lineHeightPx: 26, baseFontSize: 12, scaleFactor: 2, errorPx: 0 },
      body: { requestedFontPx: 12, fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1, errorPx: 0 },
      footer: { requestedFontPx: 12, fontPx: 12, lineHeightPx: 14, baseFontSize: 12, scaleFactor: 1, errorPx: 0 },
    },
    text: { eyebrow: '', title: '一行标题', body: '正文', footer: '来源' },
    quantization: {
      fractionalRegionEdges: 0,
      fractionalTypographyValues: 0,
      maxRegionSnapErrorPx: 0,
      maxFontSnapErrorPx: 0,
    },
  };
}

describe('renderer title bar self-check', () => {
  test('rejects a browser-sized two-line black region when the physical title only occupies one line', () => {
    const plane = Buffer.alloc((320 / 8) * 160, 0xff);
    for (let y = 7; y <= 28; y += 1) {
      for (let x = 10; x <= 40; x += 1) clearPlanePixel(plane, 320, x, y);
    }

    expect(measureTitleBarUtilization(plane, 320, 160, titlePlan(64))).toMatchObject({
      status: 'fail',
      occupiedTitleLines: 1,
      requiredHeight: 34,
      excessRows: 30,
    });
    expect(measureTitleBarUtilization(plane, 320, 160, titlePlan(34))).toMatchObject({
      status: 'pass',
      occupiedTitleLines: 1,
      requiredHeight: 34,
      excessRows: 0,
    });
  });
});

describe('renderer review TRMNL content adapter', () => {
  test('keeps ordinary news domain content thin and renderer-neutral', () => {
    const content = buildTrmnlReviewContent(ORDINARY_ROW);
    expect(content).toEqual({
      title: '普通新闻标题',
      body: '普通新闻正文',
      eyebrow: undefined,
      footer: '来源: InfoQ',
    });
  });

  test('preserves Research identity without importing Adaptive layout geometry', () => {
    const content = buildTrmnlReviewContent(RESEARCH_ROW);
    expect(content.eyebrow).toBe('NEUROMANCER · RESEARCH');
    expect(content.footer).toBe('MCP 官方 · 2 sources · 1 claims');
    expect(JSON.stringify(content)).not.toContain('fontPx');
    expect(JSON.stringify(content)).not.toContain('clampLines');
  });
});
