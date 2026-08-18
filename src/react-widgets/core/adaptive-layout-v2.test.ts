import { describe, expect, test } from 'bun:test';
import type { RenderableDataItem } from './modular-architecture.js';
import { renderableNewsToAdaptiveDocument } from './adaptive-document-adapters.js';
import { planAdaptiveLayout } from './adaptive-layout.js';
import { EINK_296X128_TARGET, EINK_TARGET, LABEL_T20X8_TARGET } from './render-targets.js';

const LONG_BODY = 'Adaptive v2 要继承成熟新闻卡的视觉语法，同时根据运行时画布动态计算正文可见行数。标题保持强视觉锚点，正文主动使用剩余空间，底部来源固定贴底；当内容较长时，不应再被标准密度硬性限制为三行，而应该在不溢出的前提下尽可能保留更多有效信息。';

function ordinaryNews(): RenderableDataItem {
  return {
    id: 'ordinary-1',
    title: 'Adaptive v2继承Current视觉语法',
    message: LONG_BODY,
    signature: 'AI优化·Q95',
    source: 'InfoQ',
    publishTime: '2026-08-18T00:00:00Z',
    category: 'news',
    highlights: ['视觉语法', '剩余空间'],
  };
}

function researchNews(): RenderableDataItem {
  return {
    ...ordinaryNews(),
    id: 'research-1',
    signature: '神经漫游者',
    metadata: {
      producer: 'external-renderable-agent',
      researchReceipt: {
        sources: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
        claims: [{ text: 'c1' }, { text: 'c2' }],
        retrieval: { status: 'healthy' },
      },
    },
  };
}

describe('Adaptive Layout v2 visual grammar', () => {
  test('ordinary news removes duplicate category/highlight chrome and selects the Current-inspired preset', () => {
    const document = renderableNewsToAdaptiveDocument(ordinaryNews());
    expect(document.visualPreset).toBe('news-current-inspired');
    expect(document.nodes.map((node) => node.role)).toEqual(['title', 'body', 'footer']);
    expect(document.nodes.map((node) => node.text).join(' ')).not.toContain('AI优化·Q95');
    expect(document.nodes.find((node) => node.role === 'footer')?.text).toBe('来源: InfoQ');
  });

  test('Research keeps evidence metadata inside the same Current-inspired three-region grammar', () => {
    const document = renderableNewsToAdaptiveDocument(researchNews());
    expect(document.visualPreset).toBe('news-research');
    expect(document.nodes.map((node) => node.role)).toEqual(['eyebrow', 'title', 'body', 'keyword', 'meta', 'footer']);
    expect(document.nodes.find((node) => node.role === 'meta')?.text).toContain('3 sources');
    expect(document.nodes.find((node) => node.role === 'meta')?.text).toContain('2 claims');
  });

  test('296x152 inherits Current typography and expands body line capacity into remaining space', () => {
    const document = renderableNewsToAdaptiveDocument(ordinaryNews());
    const plan = planAdaptiveLayout(document, EINK_TARGET);
    const title = plan.nodes.find((node) => node.role === 'title')!;
    const body = plan.nodes.find((node) => node.role === 'body')!;
    const footer = plan.nodes.find((node) => node.role === 'footer')!;

    expect(plan.version).toBe('adaptive-layout/v2');
    expect(plan.visualGrammar).toEqual({
      preset: 'news-current-inspired',
      titleTreatment: 'inverse-banner',
      bodyTreatment: 'fill',
      footerTreatment: 'bottom-rule',
      verticalAlign: 'top',
    });
    expect(title.fontPx).toBe(24);
    expect(body.fontPx).toBe(12);
    expect(footer.fontPx).toBe(12);
    expect(plan.regions?.footer.heightPx).toBe(16);
    expect(plan.bodyVisibleLines).toBeGreaterThan(3);
    expect(body.clampLines).toBeGreaterThan(3);
    expect(plan.contentUtilization).toBeGreaterThan(0.75);
    expect(plan.decisions.some((decision) => decision.includes('expand-to-fill'))).toBe(true);
    expect(plan.overflowRisk).toBe(false);
  });

  test('296x128 continuously scales the same visual grammar instead of switching templates', () => {
    const document = renderableNewsToAdaptiveDocument(ordinaryNews());
    const plan = planAdaptiveLayout(document, EINK_296X128_TARGET);
    const title = plan.nodes.find((node) => node.role === 'title')!;
    const body = plan.nodes.find((node) => node.role === 'body')!;
    const footer = plan.nodes.find((node) => node.role === 'footer')!;

    expect(plan.density).toBe('compact');
    expect(plan.visualGrammar.preset).toBe('news-current-inspired');
    expect(title.fontPx).toBe(20);
    expect(body.fontPx).toBe(10);
    expect(footer.fontPx).toBe(10);
    expect(plan.regions?.body.heightPx).toBeGreaterThan(0);
    expect(plan.bodyVisibleLines).toBeGreaterThanOrEqual(3);
    expect(plan.overflowRisk).toBe(false);
  });

  test('micro target degrades the grammar by dropping optional chrome before critical content', () => {
    const document = renderableNewsToAdaptiveDocument(researchNews());
    const plan = planAdaptiveLayout(document, LABEL_T20X8_TARGET);
    expect(plan.density).toBe('micro');
    expect(plan.hiddenNodeIds).toEqual(expect.arrayContaining(['eyebrow', 'keyword', 'meta', 'footer']));
    expect(plan.visibleNodeIds).toEqual(expect.arrayContaining(['title', 'body']));
    expect(plan.regions?.footer.heightPx).toBe(0);
    expect(plan.overflowRisk).toBe(false);
  });
});
