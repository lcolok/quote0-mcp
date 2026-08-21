import { describe, expect, it } from 'bun:test';
import {
  aggregateSyntheticEvaluations,
  buildSyntheticJudgePrompt,
  judgeFamilyFromProvider,
  loadSyntheticEvaluationSubjects,
  parseSyntheticJudgeResult,
  syntheticAssignmentForJudge,
  type SyntheticEvaluationRecord,
  type SyntheticEvaluationSubject,
} from './neuromancer-synthetic-evaluation-service.js';

const subject: SyntheticEvaluationSubject = {
  runId: 'run-1',
  sourceInventoryId: 42,
  seed: { title: '原始标题', content: '原始证据正文', source: 'Seed' },
  direct: { title: '直接版', message: '直接版正文', signature: 'AI优化·Q95' },
  research: {
    title: '研究版',
    message: '研究版正文',
    signature: '神经漫游者',
    metadata: {
      researchReceipt: {
        sources: [{ id: 'primary', url: 'https://example.com/primary', role: 'primary' }],
        claims: [{ text: '研究版正文', sourceIds: ['primary'], status: 'supported' }],
      },
    },
  },
  evidenceSnapshot: 'version=packet\n[EVIDENCE 1] official evidence',
  runtimeReceipt: { toolCalls: 4 },
  humanChoice: null,
};

function record(overrides: Partial<SyntheticEvaluationRecord>): SyntheticEvaluationRecord {
  return {
    id: 1,
    runId: 'run-1',
    sourceInventoryId: 42,
    comparisonVersion: 'neuromancer-synthetic-evaluation/v1',
    promptVersion: 'neuromancer-synthetic-judge/v1',
    judgeId: 'judge-hy3',
    judgeFamily: 'hy3',
    providerId: 'hy3',
    researchSide: 'a',
    choice: 'research',
    directScores: { factualConfidence: 3, informationDensity: 2, einkSuitability: 4 },
    researchScores: { factualConfidence: 5, informationDensity: 5, einkSuitability: 4 },
    confidence: 0.9,
    directUnsupportedClaims: [],
    researchUnsupportedClaims: [],
    rationale: 'research stronger',
    rawResult: {},
    evidenceDigest: 'digest',
    straylightJobId: null,
    straylightThreadId: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('synthetic judge contract', () => {
  it('evaluates against the preserved pre-promotion Direct artifact', async () => {
    let sql = '';
    const fakeDb = {
      query: async (statement: string) => {
        sql = statement;
        return { rows: [] };
      },
    } as any;
    await loadSyntheticEvaluationSubjects(fakeDb, { limit: 1 });
    expect(sql).toContain('active_promotion.previous_processed_content');
    expect(sql).toContain("promotion.state = 'active'");
    expect(sql).toContain('COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content)');
  });

  it('uses deterministic judge-specific blind assignment', () => {
    expect(syntheticAssignmentForJudge('run-1', 'hy3')).toEqual(syntheticAssignmentForJudge('run-1', 'hy3'));
    const assignment = syntheticAssignmentForJudge('run-1', 'hy3');
    expect(assignment.directSide).not.toBe(assignment.researchSide);
  });

  it('builds a blind prompt without leaking producer signatures', () => {
    const built = buildSyntheticJudgePrompt(subject, 'judge-hy3');
    expect(built.prompt).toContain('sideA');
    expect(built.prompt).toContain('sideB');
    expect(built.prompt).toContain('official evidence');
    expect(built.prompt).not.toContain('AI优化·Q95');
    expect(built.prompt).not.toContain('神经漫游者');
    expect(built.evidenceDigest).toHaveLength(64);
  });

  it('parses strict scored JSON and rejects malformed scores', () => {
    const parsed = parseSyntheticJudgeResult(JSON.stringify({
      choice: 'b',
      sideA: {
        factualConfidence: 3,
        informationDensity: 2,
        einkSuitability: 4,
        unsupportedClaims: ['claim-a'],
        evidenceNotes: ['note-a'],
      },
      sideB: {
        factualConfidence: 5,
        informationDensity: 5,
        einkSuitability: 4,
        unsupportedClaims: [],
        evidenceNotes: ['note-b'],
      },
      confidence: 0.86,
      rationale: 'B 更强',
    }));
    expect(parsed.choice).toBe('b');
    expect(parsed.sideB.factualConfidence).toBe(5);
    expect(parsed.confidence).toBe(0.86);
    expect(() => parseSyntheticJudgeResult({
      choice: 'a',
      sideA: { factualConfidence: 6, informationDensity: 1, einkSuitability: 1 },
      sideB: { factualConfidence: 1, informationDensity: 1, einkSuitability: 1 },
      confidence: 1,
    })).toThrow();
  });

  it('maps provider ids into independent judge families', () => {
    expect(judgeFamilyFromProvider('hy3')).toBe('hy3');
    expect(judgeFamilyFromProvider('deepseek-v4-pro')).toBe('deepseek');
    expect(judgeFamilyFromProvider('kimi-for-coding')).toBe('kimi');
  });
});

describe('synthetic evaluation aggregate', () => {
  it('computes semantic vote and score deltas without calling it human gold', () => {
    const aggregate = aggregateSyntheticEvaluations([
      record({ judgeId: 'hy3', judgeFamily: 'hy3', providerId: 'hy3' }),
      record({
        id: 2,
        judgeId: 'deepseek-v4-pro',
        judgeFamily: 'deepseek',
        providerId: 'deepseek-v4-pro',
        directScores: { factualConfidence: 3, informationDensity: 3, einkSuitability: 4 },
        researchScores: { factualConfidence: 4, informationDensity: 5, einkSuitability: 4 },
        confidence: 0.8,
      }),
    ]);
    expect(aggregate.validEvaluations).toBe(2);
    expect(aggregate.judgeFamilies).toEqual(['deepseek', 'hy3']);
    expect(aggregate.votes.research).toBe(2);
    expect(aggregate.unanimousResearch).toBe(true);
    expect(aggregate.scoreDelta.factualConfidence).toBe(1.5);
    expect(aggregate.scoreDelta.informationDensity).toBe(2.5);
    expect(aggregate.meanConfidence).toBeCloseTo(0.85);
  });
});
