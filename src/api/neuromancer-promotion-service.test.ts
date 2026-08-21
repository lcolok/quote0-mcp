import { describe, expect, it } from 'bun:test';
import {
  assessSyntheticPromotionGate,
  buildPromotedProcessedContent,
  NEUROMANCER_PROMOTION_PUSH_LAYER,
} from './neuromancer-promotion-service.js';
import type {
  SyntheticEvaluationRecord,
  SyntheticEvaluationSubject,
} from './neuromancer-synthetic-evaluation-service.js';

const subject: SyntheticEvaluationSubject = {
  runId: 'run-1',
  sourceInventoryId: 42,
  seed: { title: '原始标题', content: '一条原始证据。另一条原始证据。', source: 'Seed' },
  direct: { title: '直接版', message: '直接版正文', signature: 'AI优化' },
  research: {
    id: 'research-run-1',
    title: '研究版标题',
    message: '研究版正文包含两条经来源核验的核心信息。',
    signature: '神经漫游者',
    source: 'Primary/Official',
    publishTime: '2026-08-20T00:00:00.000Z',
    category: 'news',
    link: 'https://example.com/primary',
    metadata: {
      researchReceipt: {
        schemaVersion: 'neuromancer-research/v1',
        agent: 'neuromancer',
        sources: [
          { id: 'primary', url: 'https://example.com/primary', role: 'primary' },
          { id: 'official', url: 'https://official.example/doc', role: 'official' },
        ],
        claims: [
          { text: '研究版正文包含两条经来源核验的核心信息', sourceIds: ['primary', 'official'], status: 'supported' },
        ],
      },
    },
  },
  evidenceSnapshot: 'evidence packet',
  runtimeReceipt: { toolCalls: 4 },
  humanChoice: null,
};

function evaluation(overrides: Partial<SyntheticEvaluationRecord> = {}): SyntheticEvaluationRecord {
  return {
    id: 1,
    runId: 'run-1',
    sourceInventoryId: 42,
    comparisonVersion: 'neuromancer-synthetic-evaluation/v1',
    promptVersion: 'neuromancer-synthetic-judge/v1',
    judgeId: 'hy3',
    judgeFamily: 'hy3',
    providerId: 'hy3',
    researchSide: 'a',
    choice: 'research',
    directScores: { factualConfidence: 3, informationDensity: 2, einkSuitability: 4 },
    researchScores: { factualConfidence: 5, informationDensity: 5, einkSuitability: 4 },
    confidence: 0.9,
    directUnsupportedClaims: [],
    researchUnsupportedClaims: [],
    rationale: 'research wins',
    rawResult: {},
    evidenceDigest: 'digest',
    straylightJobId: null,
    straylightThreadId: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('synthetic promotion gate', () => {
  it('keeps the push audit layer within the production VARCHAR(20) contract', () => {
    expect(NEUROMANCER_PROMOTION_PUSH_LAYER.length).toBeLessThanOrEqual(20);
  });

  it('allows a cross-family, high-confidence research consensus with supported provenance', () => {
    const gate = assessSyntheticPromotionGate(subject, [
      evaluation(),
      evaluation({
        id: 2,
        judgeId: 'deepseek-v4-pro',
        judgeFamily: 'deepseek',
        providerId: 'deepseek-v4-pro',
        confidence: 0.8,
        directScores: { factualConfidence: 3, informationDensity: 3, einkSuitability: 4 },
        researchScores: { factualConfidence: 4, informationDensity: 5, einkSuitability: 4 },
      }),
    ]);
    expect(gate.eligible).toBe(true);
    expect(gate.reasons).toEqual([]);
    expect(gate.aggregate.votes.research).toBe(2);
    expect(gate.strongSourceCount).toBe(2);

    const promoted = buildPromotedProcessedContent(subject, gate, 'logic-explicit');
    expect(promoted.title).toBe('研究版标题');
    expect(promoted.metadata?.producer).toBe('neuromancer-research-promoted');
    expect(promoted.metadata?.promotion?.syntheticEvaluation).toBe(true);
    expect(promoted.metadata?.promotion?.approvalKind).toBe('operator-explicit');
  });

  it('blocks a synthetic-only cohort from one model family', () => {
    const gate = assessSyntheticPromotionGate(subject, [
      evaluation({ judgeId: 'deepseek-v4-pro', judgeFamily: 'deepseek', providerId: 'deepseek-v4-pro' }),
      evaluation({ id: 2, judgeId: 'deepseek-v4-flash', judgeFamily: 'deepseek', providerId: 'deepseek-v4-flash' }),
    ]);
    expect(gate.eligible).toBe(false);
    expect(gate.reasons).toContain('need-at-least-two-independent-judge-families');
  });

  it('treats one direct vote, unsupported research claims, or human direct preference as vetoes', () => {
    const vetoSubject = { ...subject, humanChoice: 'direct' as const };
    const gate = assessSyntheticPromotionGate(vetoSubject, [
      evaluation(),
      evaluation({
        id: 2,
        judgeId: 'deepseek-v4-pro',
        judgeFamily: 'deepseek',
        providerId: 'deepseek-v4-pro',
        choice: 'direct',
        researchUnsupportedClaims: ['unsupported'],
      }),
    ]);
    expect(gate.eligible).toBe(false);
    expect(gate.reasons).toContain('human-review-prefers-direct');
    expect(gate.reasons).toContain('synthetic-judge-direct-veto');
    expect(gate.reasons).toContain('research-unsupported-claims-reported');
  });

  it('blocks context/unresolved receipt claims from automatic production promotion', () => {
    const contextSubject = structuredClone(subject);
    (contextSubject.research.metadata as any).researchReceipt.claims[0].status = 'context';
    const gate = assessSyntheticPromotionGate(contextSubject, [
      evaluation(),
      evaluation({ id: 2, judgeId: 'deepseek-v4-pro', judgeFamily: 'deepseek', providerId: 'deepseek-v4-pro' }),
    ]);
    expect(gate.eligible).toBe(false);
    expect(gate.reasons).toContain('research-has-no-supported-claim');
    expect(gate.reasons).toContain('research-receipt-has-unresolved-context-or-conflict');
  });
});
