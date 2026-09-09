import { describe, expect, test } from 'bun:test';
import { renderableNewsToAdaptiveDocument } from './adaptive-document-adapters.js';
import type { RenderableDataItem } from './modular-architecture.js';

function baseItem(): RenderableDataItem {
  return {
    id: 'neuromancer-mcp-stateless',
    title: 'MCP 新规范取消会话',
    message: '新规范移除协议层会话和 initialize 握手，请求加入 Mcp-Method、Mcp-Name 等自描述头。',
    signature: '神经漫游者',
    source: 'MCP 官方规范',
    publishTime: '2026-07-28T00:00:00Z',
    category: 'news',
    highlights: ['Mcp-Method', 'Mcp-Name', '不会进入第三个关键词'],
  };
}

describe('RenderableNews -> AdaptiveDocument', () => {
  test('maps semantic content without target geometry or publishTime', () => {
    const item = baseItem();
    const document = renderableNewsToAdaptiveDocument(item);
    expect(document.id).toBe(item.id);
    expect(document.nodes.map((node) => node.role)).toEqual(['eyebrow', 'title', 'body', 'keyword', 'footer']);
    expect(document.nodes.find((node) => node.role === 'keyword')?.text).toBe('Mcp-Method · Mcp-Name');
    expect(JSON.stringify(document)).not.toContain(item.publishTime);
    expect(JSON.stringify(document)).not.toContain('widthPx');
    expect(JSON.stringify(document)).not.toContain('heightPx');
  });

  test('turns a compact Neuromancer Research Receipt into optional evidence metadata', () => {
    const item = baseItem();
    item.metadata = {
      researchReceipt: {
        agent: 'neuromancer',
        sources: [{ id: 'seed' }, { id: 'official' }, { id: 'primary' }],
        claims: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
      },
    };
    const document = renderableNewsToAdaptiveDocument(item);
    expect(document.nodes.find((node) => node.role === 'meta')?.text).toBe('3 sources · 4 claims');
  });
});
