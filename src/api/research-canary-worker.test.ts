import { describe, expect, it } from 'bun:test';
import {
  chooseAutoResearchCandidate,
  getResearchAutoWorkerConfig,
  inventoryRowToResearchSeed,
  runResearchAutoTick,
  researchSelectionBucketForCount,
} from './research-canary-worker.js';

describe('research auto-canary worker policy', () => {
  it('is disabled by default and clamps production guardrails', async () => {
    expect(getResearchAutoWorkerConfig({})).toEqual({
      enabled: false,
      universal: false,
      dailyLimit: 1,
      lookbackHours: 24,
      tickMs: 30_000,
      scanLimit: 25,
    });
    expect(getResearchAutoWorkerConfig({
      QUOTE0_RESEARCH_AUTO_ENABLED: 'true',
      QUOTE0_RESEARCH_UNIVERSAL_ENABLED: 'true',
      QUOTE0_RESEARCH_AUTO_DAILY_LIMIT: '999',
      QUOTE0_RESEARCH_AUTO_LOOKBACK_HOURS: '0',
      QUOTE0_RESEARCH_AUTO_TICK_MS: '100',
      QUOTE0_RESEARCH_AUTO_SCAN_LIMIT: '2',
    })).toEqual({
      enabled: true,
      universal: true,
      dailyLimit: 20,
      lookbackHours: 1,
      tickMs: 5_000,
      scanLimit: 5,
    });
    expect(await runResearchAutoTick({
      enabled: false,
      universal: false,
      dailyLimit: 1,
      lookbackHours: 24,
      tickMs: 30_000,
      scanLimit: 25,
    })).toEqual({ action: 'disabled' });
  });

  it('derives the seed from raw_content first and preserves inventory fallback fields', () => {
    expect(inventoryRowToResearchSeed({
      id: 10,
      title: 'fallback title',
      source: 'fallback-source',
      category: 'technology',
      raw_content: {
        title: 'raw title',
        content: '点击查看原文>',
        source: 'InfoQ',
        link: 'https://example.com/raw',
      },
    })).toEqual({
      title: 'raw title',
      content: '点击查看原文>',
      source: 'InfoQ',
      link: 'https://example.com/raw',
      category: 'technology',
    });
  });

  it('skips adequate low-risk inventory and selects a seed-only evidence gap in legacy mode', () => {
    const selected = chooseAutoResearchCandidate([
      {
        id: 1,
        raw_content: {
          title: 'rich item',
          content: '这是已经很完整的普通新闻正文。'.repeat(30),
          source: 'DEV',
          link: 'https://example.com/rich',
        },
      },
      {
        id: 2,
        raw_content: {
          title: 'thin item',
          content: '点击查看原文>',
          source: 'InfoQ',
          link: 'https://example.com/thin',
        },
      },
    ]);

    expect(selected?.inventoryId).toBe(2);
    expect(selected?.triage.lane).toBe('research');
    expect(selected?.triage.reasons).toContain('seed-only');
  });

  it('admits adequate low-risk inventory in universal mode and assigns a digest budget', () => {
    const selected = chooseAutoResearchCandidate([
      {
        id: 1,
        research_attempts: 2,
        raw_content: {
          title: 'rich item',
          content: '这是已经很完整的普通新闻正文。'.repeat(30),
          source: 'DEV',
          link: 'https://example.com/rich',
        },
        processed_content: { title: 'Direct', message: 'Direct draft' },
      },
      {
        id: 2,
        raw_content: {
          title: 'thin item',
          content: '点击查看原文>',
          source: 'InfoQ',
          link: 'https://example.com/thin',
        },
      },
    ], 'exploration', true);

    expect(selected?.inventoryId).toBe(1);
    expect(selected?.triage.reasons).toContain('universal-evidence');
    expect(selected?.triage.researchMode).toBe('digest');
    expect(selected?.triage.budget?.maxToolCalls).toBe(4);
    expect(selected?.priorRuns).toBe(2);
    expect(selected?.directSnapshot?.message).toBe('Direct draft');
  });

  it('rotates the bounded daily Research budget across quality, high-risk and exploratory slots', () => {
    expect([0, 1, 2, 3, 4, 5].map(researchSelectionBucketForCount)).toEqual([
      'quality-gap', 'high-risk', 'exploration', 'quality-gap', 'high-risk', 'exploration',
    ]);
  });

  it('selects a mandatory content-quality HOLD in the quality-resolution slot', () => {
    const selected = chooseAutoResearchCandidate([
      {
        id: 20,
        raw_content: {
          title: '普通技术新闻',
          content: '点击查看原文>',
          source: 'InfoQ',
        },
        processed_content: {
          title: '普通技术新闻',
          message: '点击查看原文>',
          metadata: {
            contentQuality: {
              disposition: 'hold',
              recommendation: 'research-required',
            },
          },
        },
      },
      {
        id: 19,
        raw_content: {
          title: 'CVE-2026-65400 正遭主动利用',
          content: '这是一段长度超过八十字符但仍然需要安全核验的摘要。'.repeat(5),
          source: 'Ars',
        },
      },
    ], 'quality-gap');

    expect(selected?.inventoryId).toBe(20);
    expect(selected?.triage.lane).toBe('research');
    expect(selected?.triage.reasons).toContain('seed-only');
  });

  it('prioritizes a high-risk research candidate in the high-risk slot', () => {
    const selected = chooseAutoResearchCandidate([
      {
        id: 20,
        raw_content: {
          title: '普通技术新闻',
          content: '点击查看原文>',
          source: 'InfoQ',
        },
      },
      {
        id: 19,
        raw_content: {
          title: 'CVE-2026-65400 正遭主动利用',
          content: '这是一段长度超过八十字符但仍然需要安全核验的摘要。'.repeat(5),
          source: 'Ars',
        },
      },
    ], 'high-risk');

    expect(selected?.inventoryId).toBe(19);
    expect(selected?.triage.signals.highRisk).toBe(true);
    expect(selected?.triage.reasons).toContain('high-risk');
  });
});
