import { describe, expect, it } from 'bun:test';
import {
  buildServerOwnedDisplayProvenance,
  publisherLabelFromUrl,
} from './news-display-provenance.js';

describe('server-owned display provenance', () => {
  it('uses the configured publisher name for direct publisher feeds', () => {
    const provenance = buildServerOwnedDisplayProvenance({
      sourceId: 'infoq-cn',
      seedSource: 'InfoQ - 促进软件开发领域知识与创新的传播',
      seedLink: 'https://www.infoq.cn/article/abc?utm_source=rss',
      evidenceSources: [
        { url: 'https://www.infoq.cn/article/abc' },
        { url: 'https://bun.com/blog/bun-v1.4' },
        { url: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0' },
      ],
      research: { policyVersion: 'quote0-research-triage/v13', runId: 'run-1' },
    });

    expect(provenance.publisher).toEqual({
      label: 'InfoQ 中文',
      url: 'https://www.infoq.cn/article/abc?utm_source=rss',
      derivedFrom: 'rss-registry',
    });
    expect(provenance.discovery).toBeUndefined();
    expect(provenance.research).toEqual({
      agent: 'neuromancer',
      evidenceSourceCount: 3,
      evidenceDomains: ['infoq.cn', 'bun.com', 'github.com'],
      policyVersion: 'quote0-research-triage/v13',
      runId: 'run-1',
    });
  });

  it('uses the linked publisher for aggregator feeds and keeps HN as discovery only', () => {
    const provenance = buildServerOwnedDisplayProvenance({
      sourceId: 'hackernews',
      seedSource: 'Hacker News: Front Page',
      seedLink: 'https://au.pcmag.com/ai/116091/meta-security-researchers-ai-agent-accidentally-deleted-her-emails',
      evidenceSources: [{ url: 'https://x.com/summeryue0/status/1' }],
      research: { policyVersion: 'quote0-research-triage/v13', runId: 'run-2' },
    });

    expect(provenance.publisher.label).toBe('PCMag');
    expect(provenance.publisher.derivedFrom).toBe('seed-link');
    expect(provenance.discovery).toEqual({ sourceId: 'hackernews', label: 'Hacker News' });
    expect(provenance.research?.evidenceDomains).toEqual(['x.com']);
  });

  it('never lets an evidence domain replace the publisher', () => {
    const provenance = buildServerOwnedDisplayProvenance({
      sourceId: 'hackernews',
      seedSource: 'Hacker News: Front Page',
      seedLink: 'https://au.pcmag.com/ai/story',
      evidenceSources: [{ url: 'https://x.com/researcher/status/1' }],
      research: {},
    });
    expect(provenance.publisher.label).toBe('PCMag');
    expect(provenance.research?.evidenceDomains).toEqual(['x.com']);
  });

  it('falls back to a deterministic hostname instead of model-authored prose', () => {
    expect(publisherLabelFromUrl('https://dreamstation.systems/personal/ntppost.html')).toBe('dreamstation.systems');
  });
});
