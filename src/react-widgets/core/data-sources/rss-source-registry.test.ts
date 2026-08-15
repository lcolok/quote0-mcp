import { describe, expect, it } from 'bun:test';
import {
  RSS_SOURCE_REGISTRY,
  RECOMMENDED_RSS_SOURCE_IDS,
  getRssSourceDefinition,
} from './rss-source-registry.js';

describe('RSS source registry', () => {
  it('核心池是 8 个平衡源，且全部存在于单一 registry', () => {
    expect(RECOMMENDED_RSS_SOURCE_IDS).toEqual([
      'solidot',
      'sspai',
      'hackernews',
      'arstechnica',
      'infoq-cn',
      'the-verge',
      'dev-to',
      'github-changelog',
    ]);
    for (const id of RECOMMENDED_RSS_SOURCE_IDS) {
      expect(getRssSourceDefinition(id)?.profile).toBe('core');
    }
  });

  it('legacy 源仍可被旧 DB 配置解析，但不会进入推荐池', () => {
    for (const id of ['36kr', 'cnbeta', 'techcrunch', 'reuters-tech', 'designer-news', 'github-trending']) {
      expect(RSS_SOURCE_REGISTRY[id]).toBeDefined();
      expect(RSS_SOURCE_REGISTRY[id].profile).toBe('legacy');
      expect(RECOMMENDED_RSS_SOURCE_IDS).not.toContain(id);
    }
  });

  it('所有 registry key、source.id 与 URL 都保持唯一且自洽', () => {
    const entries = Object.entries(RSS_SOURCE_REGISTRY);
    expect(new Set(entries.map(([, source]) => source.url)).size).toBe(entries.length);
    for (const [id, source] of entries) {
      expect(source.id).toBe(id);
      expect(source.url).toMatch(/^https?:\/\//);
    }
  });
});
