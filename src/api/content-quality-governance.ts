export const CONTENT_QUALITY_GOVERNANCE_VERSION = 'content-quality-governance-v1' as const;

export type QualityDatasetSplit = 'train' | 'validation' | 'holdout';
export type QualityCandidateKind =
  | 'deterministic-policy'
  | 'prompt-profile'
  | 'ax-optimizer'
  | 'agen-agent';

export interface QualityExecutionIdentity {
  system: 'local' | 'ax' | 'agen';
  agent?: string;
  harness?: string;
  model?: string;
  artifactDigest?: string;
}

export interface QualityDatasetSampleRef {
  fingerprint: string;
  split: QualityDatasetSplit;
}

export interface QualityDatasetSnapshot {
  version: typeof CONTENT_QUALITY_GOVERNANCE_VERSION;
  id: string;
  snapshotDigest: string;
  createdAt: string;
  samples: QualityDatasetSampleRef[];
}

export interface QualityCandidateArtifact {
  version: typeof CONTENT_QUALITY_GOVERNANCE_VERSION;
  id: string;
  parentPolicyVersion: string;
  artifactDigest: string;
  kind: QualityCandidateKind;
  generator: QualityExecutionIdentity;
  createdAt: string;
}

export interface QualityMetricVector {
  factualErrorRate: number;
  laneMacroF1: number;
  interventionPrecision: number;
  regressionCount: number;
  p95LatencyMs?: number;
  averageCostUsd?: number;
}

export interface QualityEvaluationRecord {
  version: typeof CONTENT_QUALITY_GOVERNANCE_VERSION;
  id: string;
  candidateId: string;
  datasetId: string;
  datasetDigest: string;
  blind: boolean;
  holdoutSampleCount: number;
  judges: QualityExecutionIdentity[];
  metrics: QualityMetricVector;
  evaluatedAt: string;
}

export interface QualityCanaryRecord {
  candidateId: string;
  mode: 'shadow' | 'limited';
  status: 'pending' | 'passed' | 'failed';
  sampleCount: number;
  regressionCount: number;
  startedAt: string;
  finishedAt?: string;
}

export interface QualityGatePolicy {
  version: string;
  minHoldoutSamples: number;
  minLaneMacroF1: number;
  minInterventionPrecision: number;
  maxFactualErrorRate: number;
  maxRegressionCount: number;
  minCanarySamples: number;
  requireHeterogeneousJudges: boolean;
}

export interface QualityPromotionRequest {
  candidate: QualityCandidateArtifact;
  dataset: QualityDatasetSnapshot;
  evaluation: QualityEvaluationRecord;
  canary: QualityCanaryRecord;
  gate: QualityGatePolicy;
  humanApproved: boolean;
}

export interface QualityPromotionAssessment {
  eligible: boolean;
  reasons: string[];
}

function identityKey(identity: QualityExecutionIdentity): string {
  return [
    identity.system,
    identity.agent || '',
    identity.harness || '',
    identity.model || '',
    identity.artifactDigest || '',
  ].join('|');
}

function judgeFamilyKey(identity: QualityExecutionIdentity): string {
  return [identity.system, identity.harness || '', identity.model || ''].join('|');
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateQualityDatasetSnapshot(snapshot: QualityDatasetSnapshot): string[] {
  const reasons: string[] = [];
  if (snapshot.version !== CONTENT_QUALITY_GOVERNANCE_VERSION) reasons.push('dataset_version_mismatch');
  if (!snapshot.id.trim()) reasons.push('dataset_id_missing');
  if (!snapshot.snapshotDigest.trim()) reasons.push('dataset_digest_missing');
  if (!snapshot.samples.length) reasons.push('dataset_empty');

  const seen = new Set<string>();
  const splitCounts: Record<QualityDatasetSplit, number> = { train: 0, validation: 0, holdout: 0 };
  for (const sample of snapshot.samples) {
    const fingerprint = sample.fingerprint.trim();
    if (!fingerprint) {
      reasons.push('sample_fingerprint_missing');
      continue;
    }
    if (seen.has(fingerprint)) reasons.push(`sample_split_overlap:${fingerprint}`);
    seen.add(fingerprint);
    splitCounts[sample.split] += 1;
  }

  if (splitCounts.train === 0) reasons.push('train_split_empty');
  if (splitCounts.validation === 0) reasons.push('validation_split_empty');
  if (splitCounts.holdout === 0) reasons.push('holdout_split_empty');
  return Array.from(new Set(reasons));
}

export function validateQualityEvaluationRecord(record: QualityEvaluationRecord): string[] {
  const reasons: string[] = [];
  if (record.version !== CONTENT_QUALITY_GOVERNANCE_VERSION) reasons.push('evaluation_version_mismatch');
  if (!record.id.trim()) reasons.push('evaluation_id_missing');
  if (!record.candidateId.trim()) reasons.push('evaluation_candidate_missing');
  if (!record.datasetId.trim() || !record.datasetDigest.trim()) reasons.push('evaluation_dataset_identity_missing');
  if (!record.blind) reasons.push('holdout_not_blind');
  if (record.holdoutSampleCount <= 0) reasons.push('holdout_sample_count_invalid');
  if (!record.judges.length) reasons.push('judge_missing');
  if (!isUnitInterval(record.metrics.factualErrorRate)) reasons.push('factual_error_rate_invalid');
  if (!isUnitInterval(record.metrics.laneMacroF1)) reasons.push('lane_macro_f1_invalid');
  if (!isUnitInterval(record.metrics.interventionPrecision)) reasons.push('intervention_precision_invalid');
  if (!Number.isInteger(record.metrics.regressionCount) || record.metrics.regressionCount < 0) {
    reasons.push('regression_count_invalid');
  }
  return reasons;
}

export function assessQualityPromotion(request: QualityPromotionRequest): QualityPromotionAssessment {
  const reasons: string[] = [];
  reasons.push(...validateQualityDatasetSnapshot(request.dataset));
  reasons.push(...validateQualityEvaluationRecord(request.evaluation));

  if (request.candidate.version !== CONTENT_QUALITY_GOVERNANCE_VERSION) reasons.push('candidate_version_mismatch');
  if (!request.candidate.id.trim() || !request.candidate.artifactDigest.trim()) reasons.push('candidate_identity_missing');
  if (request.evaluation.candidateId !== request.candidate.id) reasons.push('candidate_evaluation_mismatch');
  if (request.evaluation.datasetId !== request.dataset.id || request.evaluation.datasetDigest !== request.dataset.snapshotDigest) {
    reasons.push('dataset_evaluation_mismatch');
  }

  const generator = identityKey(request.candidate.generator);
  const judgeKeys = request.evaluation.judges.map(identityKey);
  if (judgeKeys.length === 1 && judgeKeys[0] === generator) reasons.push('generator_is_sole_judge');

  if (request.gate.requireHeterogeneousJudges) {
    const judgeFamilies = new Set(request.evaluation.judges.map(judgeFamilyKey));
    if (judgeFamilies.size < 2) reasons.push('heterogeneous_judges_required');
  }

  const metrics = request.evaluation.metrics;
  if (request.evaluation.holdoutSampleCount < request.gate.minHoldoutSamples) reasons.push('holdout_too_small');
  if (metrics.laneMacroF1 < request.gate.minLaneMacroF1) reasons.push('lane_macro_f1_below_gate');
  if (metrics.interventionPrecision < request.gate.minInterventionPrecision) reasons.push('intervention_precision_below_gate');
  if (metrics.factualErrorRate > request.gate.maxFactualErrorRate) reasons.push('factual_error_rate_above_gate');
  if (metrics.regressionCount > request.gate.maxRegressionCount) reasons.push('holdout_regression_gate_failed');

  if (request.canary.candidateId !== request.candidate.id) reasons.push('candidate_canary_mismatch');
  if (request.canary.status !== 'passed') reasons.push('canary_not_passed');
  if (request.canary.sampleCount < request.gate.minCanarySamples) reasons.push('canary_too_small');
  if (request.canary.regressionCount > request.gate.maxRegressionCount) reasons.push('canary_regression_gate_failed');

  // Promotion is intentionally never autonomous. An agent/optimizer can only
  // produce/evaluate a candidate; the final production edge is human-gated.
  if (!request.humanApproved) reasons.push('human_approval_required');

  return {
    eligible: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
  };
}
