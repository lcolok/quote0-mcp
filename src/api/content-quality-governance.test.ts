import { describe, expect, it } from 'bun:test';
import {
  CONTENT_QUALITY_GOVERNANCE_VERSION,
  assessQualityPromotion,
  validateQualityDatasetSnapshot,
  type QualityCandidateArtifact,
  type QualityDatasetSnapshot,
  type QualityEvaluationRecord,
  type QualityGatePolicy,
  type QualityPromotionRequest,
} from './content-quality-governance.js';

function dataset(): QualityDatasetSnapshot {
  return {
    version: CONTENT_QUALITY_GOVERNANCE_VERSION,
    id: 'dataset-20260816-a',
    snapshotDigest: 'sha256:dataset-a',
    createdAt: '2026-08-16T04:00:00.000Z',
    samples: [
      { fingerprint: 'train-a', split: 'train' },
      { fingerprint: 'validation-a', split: 'validation' },
      { fingerprint: 'holdout-a', split: 'holdout' },
      { fingerprint: 'holdout-b', split: 'holdout' },
    ],
  };
}

function candidate(): QualityCandidateArtifact {
  return {
    version: CONTENT_QUALITY_GOVERNANCE_VERSION,
    id: 'candidate-a',
    parentPolicyVersion: 'content-quality-shadow-v1',
    artifactDigest: 'sha256:candidate-a',
    kind: 'agen-agent',
    generator: {
      system: 'agen',
      agent: 'insights-analyst',
      harness: 'pi',
      model: 'DeepSeek/deepseek-v4-pro',
    },
    createdAt: '2026-08-16T04:10:00.000Z',
  };
}

function evaluation(): QualityEvaluationRecord {
  return {
    version: CONTENT_QUALITY_GOVERNANCE_VERSION,
    id: 'eval-a',
    candidateId: 'candidate-a',
    datasetId: 'dataset-20260816-a',
    datasetDigest: 'sha256:dataset-a',
    blind: true,
    holdoutSampleCount: 80,
    judges: [
      { system: 'agen', agent: 'insights-analyst', harness: 'pi', model: 'CodeBuddy/hy3' },
      { system: 'agen', agent: 'insights-analyst', harness: 'cmd', model: 'deepseek/deepseek-v4-flash' },
    ],
    metrics: {
      factualErrorRate: 0.01,
      laneMacroF1: 0.91,
      interventionPrecision: 0.96,
      regressionCount: 0,
      p95LatencyMs: 1200,
      averageCostUsd: 0.004,
    },
    evaluatedAt: '2026-08-16T04:20:00.000Z',
  };
}

function gate(): QualityGatePolicy {
  return {
    version: 'quality-gate-v1',
    minHoldoutSamples: 50,
    minLaneMacroF1: 0.85,
    minInterventionPrecision: 0.9,
    maxFactualErrorRate: 0.02,
    maxRegressionCount: 0,
    minCanarySamples: 30,
    requireHeterogeneousJudges: true,
  };
}

function request(): QualityPromotionRequest {
  return {
    candidate: candidate(),
    dataset: dataset(),
    evaluation: evaluation(),
    canary: {
      candidateId: 'candidate-a',
      mode: 'shadow',
      status: 'passed',
      sampleCount: 60,
      regressionCount: 0,
      startedAt: '2026-08-16T04:30:00.000Z',
      finishedAt: '2026-08-16T05:30:00.000Z',
    },
    gate: gate(),
    humanApproved: true,
  };
}

describe('content quality governance contract', () => {
  it('rejects dataset leakage when one fingerprint appears in multiple splits', () => {
    const value = dataset();
    value.samples.push({ fingerprint: 'holdout-a', split: 'train' });

    expect(validateQualityDatasetSnapshot(value)).toContain('sample_split_overlap:holdout-a');
  });

  it('allows AX only as another candidate artifact kind, not as an implicit production owner', () => {
    const value = request();
    value.candidate.kind = 'ax-optimizer';
    value.candidate.generator = { system: 'ax', model: 'ax-optimize-v23', artifactDigest: 'sha256:ax-run' };

    const result = assessQualityPromotion(value);
    expect(result.eligible).toBe(true);
  });

  it('allows Agen Pi/DeepSeek to generate a candidate when independent judges and all gates pass', () => {
    const result = assessQualityPromotion(request());

    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it('fails closed when a generator is its own sole judge', () => {
    const value = request();
    value.gate.requireHeterogeneousJudges = false;
    value.evaluation.judges = [{ ...value.candidate.generator }];

    const result = assessQualityPromotion(value);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('generator_is_sole_judge');
  });

  it('requires heterogeneous judge families when the gate asks for them', () => {
    const value = request();
    value.evaluation.judges = [
      { system: 'agen', harness: 'pi', model: 'CodeBuddy/hy3' },
      { system: 'agen', harness: 'pi', model: 'CodeBuddy/hy3', agent: 'second-persona' },
    ];

    const result = assessQualityPromotion(value);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('heterogeneous_judges_required');
  });

  it('requires a blind held-out evaluation and matching frozen dataset digest', () => {
    const value = request();
    value.evaluation.blind = false;
    value.evaluation.datasetDigest = 'sha256:mutated-after-eval';

    const result = assessQualityPromotion(value);
    expect(result.reasons).toContain('holdout_not_blind');
    expect(result.reasons).toContain('dataset_evaluation_mismatch');
  });

  it('blocks promotion on factual regressions even if preference metrics are high', () => {
    const value = request();
    value.evaluation.metrics.factualErrorRate = 0.03;
    value.evaluation.metrics.laneMacroF1 = 0.99;
    value.evaluation.metrics.interventionPrecision = 0.99;

    const result = assessQualityPromotion(value);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('factual_error_rate_above_gate');
  });

  it('requires canary evidence after held-out success', () => {
    const value = request();
    value.canary.status = 'pending';
    value.canary.sampleCount = 0;

    const result = assessQualityPromotion(value);
    expect(result.reasons).toContain('canary_not_passed');
    expect(result.reasons).toContain('canary_too_small');
  });

  it('never promotes autonomously even when every numeric gate passes', () => {
    const value = request();
    value.humanApproved = false;

    const result = assessQualityPromotion(value);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['human_approval_required']);
  });
});
