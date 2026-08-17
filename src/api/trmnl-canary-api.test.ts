import { describe, expect, test } from 'bun:test';
import { normalizeTrmnlCanaryRequest } from './trmnl-canary-api.js';

describe('TRMNL canary request normalization', () => {
  test('accepts a built-in e-ink target without changing the content contract', () => {
    const request = normalizeTrmnlCanaryRequest({
      targetId: 'eink-296x128',
      content: {
        eyebrow: 'Quote0',
        title: '同一份内容',
        body: '适配不同输出介质',
        footer: 'canary',
      },
    });
    expect(request?.target).toMatchObject({ kind: 'eink', widthPx: 296, heightPx: 128 });
    expect(request?.content.title).toBe('同一份内容');
  });

  test('accepts a runtime thermal target so new paper sizes do not require a named template', () => {
    const request = normalizeTrmnlCanaryRequest({
      target: {
        kind: 'thermal-label',
        widthPx: 400,
        heightPx: 240,
        dpi: 203,
        physical: { widthMm: 50, heightMm: 30 },
      },
      content: { title: '动态标签尺寸' },
    });
    expect(request?.target).toMatchObject({
      kind: 'thermal-label',
      widthPx: 400,
      heightPx: 240,
      physical: { widthMm: 50, heightMm: 30 },
    });
  });

  test('fails closed for empty content and pathological render sizes', () => {
    expect(normalizeTrmnlCanaryRequest({ targetId: 'eink-296x128', content: { title: '   ' } })).toBeUndefined();
    expect(normalizeTrmnlCanaryRequest({
      target: { kind: 'thermal-label', widthPx: 4000, heightPx: 4000 },
      content: { title: 'too large' },
    })).toBeUndefined();
  });
});
