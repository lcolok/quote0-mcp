import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import {
  buildRenderableFromPushRow,
  renderAdaptiveComparison,
  resolveAdaptiveReviewTarget,
} from './adaptive-review-service.js';
import { deriveAdaptiveDensity, planAdaptiveLayout } from '../react-widgets/core/adaptive-layout.js';
import { renderableNewsToAdaptiveDocument } from '../react-widgets/core/adaptive-document-adapters.js';

const ROW = {
  id: 42,
  fingerprint: 'fp-42',
  job_id: 'renderable-intake',
  layer: 'external-renderable',
  raw_content: {
    title: 'MCP 原始标题',
    content: '原始输入内容',
    source: 'InfoQ',
    link: 'https://example.com/mcp',
    publishTime: '2026-08-18T00:00:00Z',
    researchReceipt: {
      schemaVersion: 'neuromancer-research-receipt/v1',
      sources: [{ id: 's1', url: 'https://example.com/source', role: 'official' }],
      claims: [{ text: '协议变为无状态', status: 'supported', sourceIds: ['s1'] }],
    },
  },
  processed_content: {
    title: 'MCP 新规范取消会话',
    message: 'MCP 新规范移除协议层会话和 initialize 握手，请求加入 Mcp-Method 与 Mcp-Name 自描述头。',
    signature: '神经漫游者',
    source: 'MCP 官方',
    category: '技术',
    highlights: ['Mcp-Method', 'Mcp-Name'],
    metadata: {
      producer: 'external-renderable-agent',
      researchReceipt: {
        schemaVersion: 'neuromancer-research-receipt/v1',
        sources: [{ id: 's1', url: 'https://example.com/source', role: 'official' }],
        claims: [{ text: '协议变为无状态', status: 'supported', sourceIds: ['s1'] }],
        retrieval: { status: 'healthy' },
      },
    },
  },
  pushed_at: new Date('2026-08-18T00:10:00Z'),
};

describe('Adaptive review service', () => {
  test('keeps Neuromancer semantic evidence while layout stays target-neutral', () => {
    const renderable = buildRenderableFromPushRow(ROW);
    expect(renderable.metadata?.researchReceipt?.sources).toHaveLength(1);
    expect(renderable.highlights).toEqual(['Mcp-Method', 'Mcp-Name']);
    const document = renderableNewsToAdaptiveDocument(renderable);
    expect(document.nodes.map((node) => node.role)).toContain('meta');
    expect(document.nodes.map((node) => node.text).join(' ')).not.toContain('296');
  });

  test('derives different semantic density from geometry, not target SKU', () => {
    const renderable = buildRenderableFromPushRow(ROW);
    const document = renderableNewsToAdaptiveDocument(renderable);
    const compact = resolveAdaptiveReviewTarget('eink-296x128');
    const standard = resolveAdaptiveReviewTarget('eink-296x152');
    const micro = resolveAdaptiveReviewTarget('label-T20x8-160');
    expect(deriveAdaptiveDensity(compact)).toBe('compact');
    expect(deriveAdaptiveDensity(standard)).toBe('standard');
    expect(deriveAdaptiveDensity(micro)).toBe('micro');
    expect(planAdaptiveLayout(document, micro).hiddenNodeIds).toEqual(expect.arrayContaining(['eyebrow', 'meta', 'footer']));
  });

  test('real-renders Current and Adaptive into exact 1-bit-compatible PNGs', async () => {
    const target = resolveAdaptiveReviewTarget('eink-296x128');
    const result = await renderAdaptiveComparison(ROW, target);
    expect(result.subject.contentOrigin).toBe('neuromancer');
    expect(result.layoutPlan.density).toBe('compact');
    expect(result.layoutPlan.version).toBe('adaptive-layout/v2');
    expect(result.layoutPlan.visualGrammar.preset).toBe('news-research');
    expect(result.layoutPlan.visualGrammar.titleTreatment).toBe('inverse-banner');
    expect(result.layoutPlan.overflowRisk).toBe(false);
    expect(result.primary.baselineRole).toBe('authoritative-current');
    expect(result.primary.bitmapMetrics.bytes).toBe((296 / 8) * 128);
    expect(result.adaptive.bitmapMetrics.bytes).toBe((296 / 8) * 128);
    expect(result.primary.bitmapMetrics.burnBits).toBeGreaterThan(0);
    expect(result.adaptive.bitmapMetrics.burnBits).toBeGreaterThan(0);
    expect(result.adaptive.renderer).toBe('adaptive-satori/v2');

    const primaryPng = Buffer.from(result.primary.image.base64, 'base64');
    const adaptivePng = Buffer.from(result.adaptive.image.base64, 'base64');
    const [primaryMeta, adaptiveMeta] = await Promise.all([sharp(primaryPng).metadata(), sharp(adaptivePng).metadata()]);
    expect([primaryMeta.width, primaryMeta.height]).toEqual([296, 128]);
    expect([adaptiveMeta.width, adaptiveMeta.height]).toEqual([296, 128]);
  });

  test('labels thermal Current side as a legacy projection rather than an authoritative output', async () => {
    const target = resolveAdaptiveReviewTarget('label-T20x8-160');
    const result = await renderAdaptiveComparison(ROW, target);
    expect(result.primary.baselineRole).toBe('legacy-projection');
    expect(result.layoutPlan.density).toBe('micro');
  });
});
