import { describe, expect, it } from 'bun:test';
import { assessContentQuality } from './content-quality.js';

const NOW = Date.parse('2026-08-16T03:00:00.000Z');

describe('content quality shadow assessment', () => {
  it('flags thin InfoQ feed bodies for source expansion instead of pretending confidence', () => {
    const result = assessContentQuality({
      sourceId: 'infoq-cn',
      title: 'MCP 走向无状态，开发者追问：这不就又变回 API 了吗？',
      content: '点击查看原文>',
      publishTime: '2026-08-16T02:00:00.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('reported-news');
    expect(result.recommendation).toBe('needs-source-expansion');
    expect(result.reasons).toContain('thin-source-body');
    expect(result.reasons).toContain('editorial-source');
  });

  it('downranks stale low-engagement Hacker News project posts', () => {
    const result = assessContentQuality({
      sourceId: 'hackernews',
      title: 'Big Pickle on SWE Atlas – Codebase QnA',
      content: 'Article URL: https://github.com/PhillipChaffee/big-pickle-swe-atlas Comments URL: https://news.ycombinator.com/item?id=49315563 Points: 4 # Comments: 0',
      link: 'https://github.com/PhillipChaffee/big-pickle-swe-atlas',
      publishTime: '2026-08-16T00:10:48.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('community-post');
    expect(result.recommendation).toBe('downrank-news');
    expect(result.reasons).toContain('hn-low-engagement');
    expect(result.evidence.hnPoints).toBe(4);
    expect(result.evidence.hnComments).toBe(0);
  });

  it('keeps healthy-engagement Hacker News reporting preferred', () => {
    const result = assessContentQuality({
      sourceId: 'hackernews',
      title: 'Credit card debt rises to $1.26T, nearing all-time record',
      content: 'Article URL: https://abc7.com/story/x Comments URL: https://news.ycombinator.com/item?id=1 Points: 38 # Comments: 36',
      link: 'https://abc7.com/story/x',
      publishTime: '2026-08-15T23:22:59.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('reported-news');
    expect(result.recommendation).toBe('prefer-news');
    expect(result.reasons).toContain('hn-healthy-engagement');
  });

  it('classifies DEV tutorials as technical reading rather than bad content', () => {
    const result = assessContentQuality({
      sourceId: 'dev-to',
      title: 'Bloom Filters',
      content: 'One-liner: A probabilistic data structure that tells you if an element is definitely not in a set. Practical guide and examples.',
      publishTime: '2026-08-16T02:00:00.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('technical-reading');
    expect(result.recommendation).toBe('route-reading');
    expect(result.reasons).toContain('community-tutorial');
  });

  it('downranks obvious DEV self-promotion from the news lane', () => {
    const result = assessContentQuality({
      sourceId: 'dev-to',
      title: 'Shipping a five-mission offline Android FPS with Camo Scan',
      content: 'I built and shipped my app to Google Play. Here is what I learned.',
      publishTime: '2026-08-16T02:30:00.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('community-post');
    expect(result.recommendation).toBe('downrank-news');
    expect(result.reasons).toContain('community-self-promo');
  });

  it('downranks events and promo-shaped editorial items', () => {
    const result = assessContentQuality({
      sourceId: 'infoq-cn',
      title: '面向多模态推理的高效长上下文建模｜AICon深圳',
      content: '大会分享议题介绍与报名信息',
      publishTime: '2026-08-16T01:00:00.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('promo-event');
    // 该样本正文同样极薄；shadow 阶段优先暴露“需要补源”，同时保留 promo reason。
    expect(result.recommendation).toBe('needs-source-expansion');
    expect(result.reasons).toContain('event-or-promo');
    expect(result.reasons).toContain('thin-source-body');
  });

  it('does not confuse ordinary Chinese “活动” wording with event promotion', () => {
    const result = assessContentQuality({
      sourceId: 'solidot',
      title: '科技巨头想要收集你的思想',
      content: '消费级神经技术正进入工作与家庭场景，可监测或解读大脑活动。研究人员担忧精神隐私、身份与自主权边界，需要新的数据保护规则。',
      publishTime: '2026-08-15T20:00:00.000Z',
      nowMs: NOW,
    });

    expect(result.recommendation).toBe('prefer-news');
    expect(result.reasons).not.toContain('event-or-promo');
  });

  it('routes DEV opinion/analysis to reading without falsely calling it self-promotion', () => {
    const result = assessContentQuality({
      sourceId: 'dev-to',
      title: 'Your Company Has AI Tribes. Send an Engineer as Emissary',
      content: 'This is an exploration of whether a forward-deployed engineer mindset helps internal AI adoption.',
      publishTime: '2026-08-16T02:30:00.000Z',
      nowMs: NOW,
    });

    expect(result.recommendation).toBe('route-reading');
    expect(result.reasons).not.toContain('community-self-promo');
  });

  it('treats vendor changelogs as product updates, not hard news', () => {
    const result = assessContentQuality({
      sourceId: 'github-changelog',
      title: 'Block users from comments in personal repositories',
      content: 'You can now block or unblock users directly from comments on pull requests and issues.',
      publishTime: '2026-08-13T19:02:46.000Z',
      nowMs: NOW,
    });

    expect(result.contentClass).toBe('product-update');
    expect(result.recommendation).toBe('route-product-update');
    expect(result.reasons).toContain('vendor-product-update');
  });
});
