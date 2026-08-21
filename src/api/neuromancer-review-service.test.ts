import { describe, expect, test } from 'bun:test';
import {
  assignmentForResearchRun,
  blindArtifactFrom,
  semanticChoiceFromBlind,
  semanticScoresFromBlind,
  getNeuromancerReviewPair,
  listNeuromancerReviewCandidates,
  saveNeuromancerReview,
  NEUROMANCER_PAIRED_REVIEW_VERSION,
} from './neuromancer-review-service.js';

describe('Neuromancer paired review blind assignment', () => {
  test('is deterministic and always maps direct/research to opposite sides', () => {
    const runId = '82306199-5030-47db-a3f8-e3046cbc8d96';
    const first = assignmentForResearchRun(runId);
    const second = assignmentForResearchRun(runId);
    expect(first).toEqual(second);
    expect(['a', 'b']).toContain(first.researchSide);
    expect(first.directSide).not.toBe(first.researchSide);
  });

  test('maps a blind preference back to semantic direct/research truth', () => {
    const assignment = { researchSide: 'b' as const, directSide: 'a' as const };
    expect(semanticChoiceFromBlind('a', assignment)).toBe('direct');
    expect(semanticChoiceFromBlind('b', assignment)).toBe('research');
    expect(semanticChoiceFromBlind('tie', assignment)).toBe('tie');
  });

  test('maps blind side scores into semantic cohorts without swapping dimensions', () => {
    const sideA = { factualConfidence: 2, informationDensity: 3, einkSuitability: 4 };
    const sideB = { factualConfidence: 5, informationDensity: 4, einkSuitability: 3 };
    expect(semanticScoresFromBlind(sideA, sideB, { researchSide: 'a', directSide: 'b' })).toEqual({
      researchScores: sideA,
      directScores: sideB,
    });
    expect(semanticScoresFromBlind(sideA, sideB, { researchSide: 'b', directSide: 'a' })).toEqual({
      researchScores: sideB,
      directScores: sideA,
    });
  });
});

describe('Neuromancer paired review service projection', () => {
  test('keeps the original Direct artifact after an active Research promotion', async () => {
    let sql = '';
    const fakeDb = {
      query: async (statement: string) => {
        sql = statement;
        return { rows: [] };
      },
    } as any;
    await listNeuromancerReviewCandidates(fakeDb, { limit: 1 });
    expect(sql).toContain('active_promotion.previous_processed_content');
    expect(sql).toContain("promotion.state = 'active'");
    expect(sql).toContain('COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content)');
  });

  test('returns only blind title/message before a human review exists', async () => {
    const runId = '82306199-5030-47db-a3f8-e3046cbc8d96';
    const fakeDb = {
      query: async () => ({ rows: [{
        id: runId,
        source_inventory_id: 18246,
        input_snapshot: { title: 'Seed title', source: 'DEV Community' },
        processed_content: { title: 'Direct title', message: 'Direct body', signature: 'AI优化·Q95' },
        result_artifact: {
          title: 'Research title',
          message: 'Research body',
          signature: '神经漫游者',
          metadata: { researchReceipt: { sources: [{ id: 's1' }] } },
        },
        runtime_receipt: { toolCalls: 6 },
        straylight_thread_id: 'thread-final',
        straylight_thread_ids: ['thread-a', 'thread-final'],
        review_id: null,
      }] }),
    } as any;
    const pair = await getNeuromancerReviewPair(fakeDb, runId);
    expect(pair?.review).toBeNull();
    expect(pair?.reveal).toBeNull();
    expect(pair?.sideA).toEqual(expect.objectContaining({ title: expect.any(String), message: expect.any(String) }));
    expect(pair?.sideB).toEqual(expect.objectContaining({ title: expect.any(String), message: expect.any(String) }));
    expect(Object.keys(pair?.sideA || {}).sort()).toEqual(['message', 'title']);
    expect(Object.keys(pair?.sideB || {}).sort()).toEqual(['message', 'title']);
  });

  test('persists semantic winner and scores rather than blind A/B labels', async () => {
    const runId = '8eaba5f5-ea31-42f9-aca5-eb44b8b2f358';
    const assignment = assignmentForResearchRun(runId);
    let params: unknown[] = [];
    const now = new Date().toISOString();
    const fakeDb = {
      query: async (_sql: string, values: unknown[]) => {
        params = values;
        const researchIsA = assignment.researchSide === 'a';
        return { rows: [{
          id: 7,
          research_run_id: runId,
          source_inventory_id: 18243,
          comparison_version: NEUROMANCER_PAIRED_REVIEW_VERSION,
          research_side: assignment.researchSide,
          choice: 'research',
          direct_factual_confidence: researchIsA ? 2 : 5,
          research_factual_confidence: researchIsA ? 5 : 2,
          direct_information_density: researchIsA ? 3 : 4,
          research_information_density: researchIsA ? 4 : 3,
          direct_eink_suitability: researchIsA ? 2 : 5,
          research_eink_suitability: researchIsA ? 5 : 2,
          research_worth_cost: null,
          note: null,
          annotator: 'human',
          created_at: now,
          updated_at: now,
        }] };
      },
    } as any;
    const sideA = { factualConfidence: 5, informationDensity: 4, einkSuitability: 5 };
    const sideB = { factualConfidence: 2, informationDensity: 3, einkSuitability: 2 };
    const review = await saveNeuromancerReview(fakeDb, {
      runId,
      sourceInventoryId: 18243,
      blindChoice: assignment.researchSide,
      sideA,
      sideB,
    });
    expect(review.choice).toBe('research');
    expect(params[4]).toBe('research');
    expect(params[3]).toBe(assignment.researchSide);
    expect(review.researchScores).toEqual(assignment.researchSide === 'a' ? sideA : sideB);
    expect(review.directScores).toEqual(assignment.researchSide === 'a' ? sideB : sideA);
  });
});

describe('Neuromancer paired review artifact normalization', () => {
  test('uses title + message and falls back to summary/content for direct artifacts', () => {
    expect(blindArtifactFrom({ title: '直接版', message: 'direct message', signature: 'AI优化·Q95' })).toEqual({
      title: '直接版',
      message: 'direct message',
    });
    expect(blindArtifactFrom({ title: '摘要版', summary: 'summary fallback' })).toEqual({
      title: '摘要版',
      message: 'summary fallback',
    });
  });

  test('fails closed instead of creating an empty blind candidate', () => {
    expect(() => blindArtifactFrom({ title: '只有标题' })).toThrow('缺少 title/message');
    expect(() => blindArtifactFrom({ message: '只有正文' })).toThrow('缺少 title/message');
  });
});
