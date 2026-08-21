import { describe, expect, test } from 'bun:test';
import {
  markUniversalResearchPending,
  markUniversalResearchReady,
  researchGateFrom,
  UNIVERSAL_RESEARCH_POLICY_VERSION,
  universalResearchEnabled,
} from './universal-research-policy.js';

describe('universal evidence research policy', () => {
  test('is opt-in and does not overload the old daily-limit switch', () => {
    expect(universalResearchEnabled({})).toBe(false);
    expect(universalResearchEnabled({ QUOTE0_RESEARCH_AUTO_DAILY_LIMIT: '999' })).toBe(false);
    expect(universalResearchEnabled({ QUOTE0_RESEARCH_UNIVERSAL_ENABLED: 'true' })).toBe(true);
  });

  test('marks a Direct draft pending without erasing existing quality metadata', () => {
    const queuedAt = new Date('2026-08-21T00:00:00.000Z');
    const next = markUniversalResearchPending({
      title: 'Direct',
      message: 'draft',
      metadata: { contentQuality: { disposition: 'deliver' } },
    }, queuedAt);
    expect(next.metadata.contentQuality.disposition).toBe('deliver');
    expect(next.metadata.researchGate).toEqual({
      schemaVersion: UNIVERSAL_RESEARCH_POLICY_VERSION,
      required: true,
      state: 'pending',
      queuedAt: queuedAt.toISOString(),
    });
    expect(researchGateFrom(next)?.state).toBe('pending');
  });

  test('turns the evidence-grounded final artifact into the only ready version', () => {
    const ready = markUniversalResearchReady({
      id: 'r1',
      title: 'Research',
      message: 'grounded',
      signature: '神经漫游者',
      source: 'official',
      publishTime: '2026-08-21T00:00:00.000Z',
      category: 'news',
      metadata: { researchReceipt: { claims: [] } },
    } as any, {
      id: 'run-1',
      triage: { researchMode: 'digest' } as any,
      runtimeReceipt: { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 },
      evidenceSnapshot: 'evidence',
      completedAt: '2026-08-21T00:01:00.000Z',
    });
    expect(ready.metadata?.researchReceipt).toBeDefined();
    expect((ready.metadata as any).researchGate).toEqual(expect.objectContaining({
      state: 'ready',
      researchRunId: 'run-1',
      researchMode: 'digest',
      toolCalls: 3,
      evidenceChars: 8,
    }));
  });
});
