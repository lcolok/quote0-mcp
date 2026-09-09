import { describe, expect, test } from 'bun:test';
import { buildRenderableFromInventory } from './device-delivery-worker.js';

describe('device delivery inventory -> RenderableDataItem fidelity', () => {
  test('preserves Neuromancer receipt and highlights for Adaptive shadow/layout consumers', () => {
    const receipt = {
      schemaVersion: 'neuromancer-research/v1',
      sources: [{ id: 'official', url: 'https://example.com/official', role: 'official' }],
      claims: [{ text: '受支持事实', sourceIds: ['official'], status: 'supported' }],
    };
    const result = buildRenderableFromInventory({
      id: 18000,
      title: 'seed title',
      source: 'infoq-cn',
      category: 'news',
      link: 'https://example.com/seed',
      raw_content: {
        title: 'raw title',
        content: 'raw content',
        publishTime: '2026-08-17T00:00:00Z',
      },
      processed_content: {
        title: 'MCP 新规范取消会话',
        message: '请求加入 Mcp-Method 与 Mcp-Name。',
        signature: '神经漫游者',
        source: 'MCP官方·InfoQ',
        publishTime: '2026-08-17T01:00:00Z',
        highlights: ['Mcp-Method', 'Mcp-Name'],
        metadata: {
          contractVersion: 'renderable-news/v1',
          researchReceipt: receipt,
        },
      },
    });

    expect(result).toMatchObject({
      id: '18000',
      title: 'MCP 新规范取消会话',
      message: '请求加入 Mcp-Method 与 Mcp-Name。',
      signature: '神经漫游者',
      highlights: ['Mcp-Method', 'Mcp-Name'],
      metadata: {
        contractVersion: 'renderable-news/v1',
        researchReceipt: receipt,
      },
    });
  });

  test('falls back to raw researchReceipt for older renderable-intake rows', () => {
    const receipt = {
      schemaVersion: 'neuromancer-research/v1',
      sources: [{ id: 'seed', url: 'https://example.com', role: 'seed' }],
      claims: [{ text: '事实', sourceIds: ['seed'], status: 'context' }],
    };
    const result = buildRenderableFromInventory({
      id: 7,
      source: 'legacy',
      raw_content: {
        title: '旧数据',
        content: '正文',
        publishTime: '2026-08-17T00:00:00Z',
        researchReceipt: receipt,
      },
      processed_content: { title: '旧数据', message: '正文' },
    });
    expect(result.metadata.researchReceipt).toEqual(receipt);
  });
});
