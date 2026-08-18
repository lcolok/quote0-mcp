import { describe, expect, test } from 'bun:test';
import { buildTrmnlReviewContent } from './renderer-review-service.js';

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
