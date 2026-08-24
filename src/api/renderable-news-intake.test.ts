import { describe, expect, it } from 'bun:test';
import {
  buildRenderablePushContent,
  minioImagePathFromRenderedImages,
  normalizeNeuromancerFinalArtifact,
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

  it('uses real title geometry to admit denser copy instead of the old fixed 80-CJK ceiling', () => {
    const longTitle = '较长标题需要占用两行显示空间';
    const twoLineRich = validateRenderableNews({ ...VALID, title: longTitle, message: '事实'.repeat(50), highlights: [] });
    expect(twoLineRich.ok).toBe(true); // 200 message units <= 220 two-line budget

    const shortTitleRich = validateRenderableNews({ ...VALID, title: '短标题', message: '事实'.repeat(65), highlights: [] });
    expect(shortTitleRich.ok).toBe(true); // 260 message units <= 280 one-line budget
  });

  it('returns dynamic layout feedback instead of truncating an oversized message', () => {
    const longTitle = '较长标题需要占用两行显示空间';
    const result = validateRenderableNews({ ...VALID, title: longTitle, message: '很长'.repeat(60), highlights: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('message 超出墨水屏容量'))).toBe(true);
      expect(result.errors.some((error) => error.includes('最多 220 display units'))).toBe(true);
    }
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

  it('rejects the same evidence page when tracking params or source ids try to make it look like multiple sources', () => {
    const result = validateRenderableNews({
      ...VALID,
      metadata: {
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          sources: [
            { id: 'seed', url: 'https://www.infoq.cn/article/abc?utm_source=rss&utm_medium=article', role: 'seed' },
            { id: 'secondary', url: 'https://www.infoq.cn/article/abc', role: 'secondary' },
          ],
          claims: [{ text: '同一主张', sourceIds: ['seed'], status: 'supported' }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('canonical URL 重复'))).toBe(true);
    }
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

  it('normalizes the real universal digest failure shape without changing factual text', () => {
    const message = '生物学文章讨论科研体验，正文中的细胞、实验、学习和兴趣构成核心线索。';
    const normalized = normalizeNeuromancerFinalArtifact({
      ...VALID,
      message,
      highlights: ['生物学', '细胞', '实验', '学习', '兴趣', '不存在'],
      metadata: {
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          sources: [
            { id: 'seed', url: 'https://example.com/biology?utm_source=hn', role: 'seed' },
            { id: 'primary', url: 'https://example.com/biology', role: 'primary', title: 'Primary article' },
          ],
          claims: [
            { text: '正文主张', sourceIds: ['seed', 'primary'], status: 'supported' },
          ],
        },
      },
    }) as any;

    expect(normalized.message).toBe(message);
    expect(normalized.highlights).toEqual(['生物学', '细胞', '实验', '学习']);
    expect(normalized.metadata.researchReceipt.sources).toHaveLength(1);
    expect(normalized.metadata.researchReceipt.sources[0].id).toBe('seed');
    expect(normalized.metadata.researchReceipt.sources[0].role).toBe('primary');
    expect(normalized.metadata.researchReceipt.claims[0].sourceIds).toEqual(['seed']);
    const validation = validateRenderableNews(normalized);
    expect(validation.ok).toBe(true);
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
