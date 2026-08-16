import { describe, expect, it } from 'bun:test';
import {
  buildRenderablePushContent,
  minioImagePathFromRenderedImages,
  normalizeRenderableDeviceIds,
  validateRenderableNews,
} from './renderable-news-intake.js';

const VALID = {
  id: 'neuromancer-mcp-stateless-20260816',
  title: 'MCP 新规范取消会话',
  message: 'MCP 2026-07-28 规范取消协议会话与 initialize 握手；请求须带 Mcp-Method 和 Mcp-Name 标头，网关无需解析正文即可路由、限流。',
  signature: '神经漫游者',
  source: 'MCP官方·InfoQ',
  publishTime: '2026-08-16T08:59:17Z',
  category: 'news',
  link: 'https://www.infoq.cn/article/412hbBva0NF0AYP0CjzD',
  highlights: ['2026-07-28', 'Mcp-Method', 'Mcp-Name'],
  metadata: { agent: 'neuromancer', threadId: 'test-thread' },
};

describe('validateRenderableNews', () => {
  it('accepts an eink-sized Neuromancer renderable payload', () => {
    const result = validateRenderableNews(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe(VALID.title);
      expect(result.data.highlights).toEqual(VALID.highlights);
      expect(result.data.publishTime).toBe('2026-08-16T08:59:17.000Z');
    }
  });

  it('fails closed when a highlight is not in the rendered message', () => {
    const result = validateRenderableNews({ ...VALID, highlights: [...VALID.highlights, '无状态'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('highlight 不在 message 中: 无状态');
  });

  it('returns layout feedback instead of truncating an oversized message', () => {
    const result = validateRenderableNews({ ...VALID, message: '很长'.repeat(100) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.includes('message 超出墨水屏容量'))).toBe(true);
  });

  it('accepts a compact research receipt and normalizes runtime evidence', () => {
    const result = validateRenderableNews({
      ...VALID,
      metadata: {
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          threadId: 'thread-1',
          runId: 'run-1',
          generatedAt: '2026-08-16T09:00:00Z',
          seed: {
            title: 'MCP 走向无状态，开发者追问：这不就又变回 API 了吗？',
            content: '点击查看原文>',
            source: 'InfoQ',
            link: 'https://www.infoq.cn/article/412hbBva0NF0AYP0CjzD',
          },
          sources: [
            { id: 's1', url: 'https://blog.modelcontextprotocol.io/posts/2026-07-28', role: 'official', title: 'The 2026-07-28 Specification' },
            { id: 's2', url: 'https://www.infoq.com/news/2026/08/mcp-stateless-gateway/', role: 'secondary', title: 'MCP Goes Stateless' },
          ],
          claims: [
            { text: 'MCP 2026-07-28 规范取消协议会话与 initialize 握手', sourceIds: ['s1', 's2'], status: 'supported' },
          ],
          retrieval: { status: 'healthy', enginesUsed: ['scrapling', 'bing', 'anysearch'] },
          usage: {
            providerReportedTokens: { status: 'unavailable' },
            llmCalls: 1,
            toolCalls: 4,
            searchRequests: 1,
            crawlRequests: 3,
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metadata?.researchReceipt?.sources).toHaveLength(2);
    expect(result.data.metadata?.researchReceipt?.usage?.toolCalls).toBe(4);
    expect(result.data.metadata?.researchReceipt?.generatedAt).toBe('2026-08-16T09:00:00.000Z');
    expect(result.data.metadata?.researchReceipt?.seed?.content).toBe('点击查看原文>');
  });

  it('fails closed when a claim cites an unknown source id', () => {
    const result = validateRenderableNews({
      ...VALID,
      metadata: {
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          sources: [{ id: 's1', url: 'https://example.com/source', role: 'primary' }],
          claims: [{ text: '一条主张', sourceIds: ['missing'], status: 'supported' }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('metadata.researchReceipt.claims[0] 引用了未知 sourceId: missing');
  });
});

describe('renderable intake helpers', () => {
  it('deduplicates selected device ids and rejects a non-array as explicit empty selection', () => {
    expect(normalizeRenderableDeviceIds(['eink-2', 'eink-2', ' ', 'eink-3'])).toEqual(['eink-2', 'eink-3']);
    expect(normalizeRenderableDeviceIds('eink-2')).toEqual([]);
    expect(normalizeRenderableDeviceIds(undefined)).toBeUndefined();
  });

  it('maps the rendered MinIO URL to the image_path consumed by annotation preview', () => {
    expect(minioImagePathFromRenderedImages([
      { imageUrl: 'http://minio:9000/quote0-images/widgets/news/2026/08/16/test.png' },
    ])).toBe('/widgets/news/2026/08/16/test.png');
  });

  it('stores the exact renderable content in raw and processed review evidence', () => {
    const result = validateRenderableNews(VALID);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const content = buildRenderablePushContent(result.data);
    expect(content.rawContent.content).toBe(VALID.message);
    expect(content.processedContent.message).toBe(VALID.message);
    expect(content.processedContent.title).toBe(VALID.title);
    expect(content.processedContent.metadata.producer).toBe('external-renderable-agent');
  });

  it('persists researchReceipt and derives compact provenance from receipt sources', () => {
    const result = validateRenderableNews({
      ...VALID,
      metadata: {
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          seed: { title: 'MCP 走向无状态', content: '点击查看原文>', source: 'InfoQ' },
          sources: [{ id: 'official', url: 'https://blog.modelcontextprotocol.io/posts/2026-07-28', role: 'official' }],
          claims: [{ text: 'MCP 取消协议会话', sourceIds: ['official'], status: 'supported' }],
        },
      },
    });
    if (!result.ok) throw new Error(result.errors.join('; '));
    const content = buildRenderablePushContent(result.data);
    expect(content.processedContent.metadata.researchReceipt?.schemaVersion).toBe('neuromancer-research/v1');
    expect(content.processedContent.metadata.provenance).toEqual(result.data.metadata?.researchReceipt?.sources);
    expect(content.rawContent.researchReceipt?.claims).toHaveLength(1);
    expect(content.rawContent.title).toBe('MCP 走向无状态');
    expect(content.rawContent.content).toBe('点击查看原文>');
    expect(content.processedContent.title).toBe(VALID.title);
  });
});
