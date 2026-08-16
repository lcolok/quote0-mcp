import { describe, expect, it } from 'bun:test';
import {
  chooseAutoResearchCandidate,
  getResearchAutoWorkerConfig,
  inventoryRowToResearchSeed,
  runResearchAutoTick,
} from './research-canary-worker.js';

describe('research auto-canary worker policy', () => {
  it('is disabled by default and clamps production guardrails', async () => {
    expect(getResearchAutoWorkerConfig({})).toEqual({
      enabled: false,
      dailyLimit: 1,
      lookbackHours: 24,
      tickMs: 30_000,
      scanLimit: 25,
    });
    expect(getResearchAutoWorkerConfig({
      QUOTE0_RESEARCH_AUTO_ENABLED: 'true',
      QUOTE0_RESEARCH_AUTO_DAILY_LIMIT: '999',
      QUOTE0_RESEARCH_AUTO_LOOKBACK_HOURS: '0',
      QUOTE0_RESEARCH_AUTO_TICK_MS: '100',
      QUOTE0_RESEARCH_AUTO_SCAN_LIMIT: '2',
    })).toEqual({
      enabled: true,
      dailyLimit: 20,
      lookbackHours: 1,
      tickMs: 5_000,
      scanLimit: 5,
    });
    expect(await runResearchAutoTick({
      enabled: false,
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

  it('skips rich low-risk inventory and selects a thin candidate', () => {
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
    expect(selected?.triage.reasons).toContain('thin');
  });

  it('prioritizes a high-risk research candidate over a newer ordinary thin stub', () => {
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
    ]);

    expect(selected?.inventoryId).toBe(19);
    expect(selected?.triage.signals.highRisk).toBe(true);
    expect(selected?.triage.reasons).toContain('high-risk');
  });
});
