import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  blindArtifactFrom,
  NEUROMANCER_PAIRED_REVIEW_VERSION,
  type BlindArtifact,
  type BlindSide,
  type NeuromancerReviewScores,
  type SemanticChoice,
} from './neuromancer-review-service.js';

export const NEUROMANCER_SYNTHETIC_EVALUATION_VERSION = 'neuromancer-synthetic-evaluation/v1';
export const NEUROMANCER_SYNTHETIC_JUDGE_PROMPT_VERSION = 'neuromancer-synthetic-judge/v1';

export interface SyntheticJudgeSideResult extends NeuromancerReviewScores {
  unsupportedClaims: string[];
  evidenceNotes: string[];
}

export interface SyntheticJudgeBlindResult {
  choice: BlindSide | 'tie';
  sideA: SyntheticJudgeSideResult;
  sideB: SyntheticJudgeSideResult;
  confidence: number;
  rationale: string;
}

export interface SyntheticEvaluationSubject {
  runId: string;
  sourceInventoryId: number;
  seed: Record<string, unknown>;
  direct: Record<string, unknown>;
  research: Record<string, unknown>;
  evidenceSnapshot: string;
  runtimeReceipt: Record<string, unknown>;
  humanChoice: SemanticChoice | null;
}

export interface SyntheticEvaluationRecord {
  id: number;
  runId: string;
  sourceInventoryId: number | null;
  comparisonVersion: string;
  promptVersion: string;
  judgeId: string;
  judgeFamily: string;
  providerId: string;
  researchSide: BlindSide;
  choice: SemanticChoice;
  directScores: NeuromancerReviewScores;
  researchScores: NeuromancerReviewScores;
  confidence: number;
  directUnsupportedClaims: string[];
  researchUnsupportedClaims: string[];
  rationale: string;
  rawResult: Record<string, unknown>;
  evidenceDigest: string;
  straylightJobId: string | null;
  straylightThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyntheticEvaluationAggregate {
  comparisonVersion: string;
  validEvaluations: number;
  judgeIds: string[];
  judgeFamilies: string[];
  votes: Record<SemanticChoice, number>;
  directScores: NeuromancerReviewScores;
  researchScores: NeuromancerReviewScores;
  scoreDelta: NeuromancerReviewScores;
  meanConfidence: number;
  directUnsupportedClaimCount: number;
  researchUnsupportedClaimCount: number;
  unanimousResearch: boolean;
  majorityResearch: boolean;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanStringArray(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, maxItems);
}

function integerScore(value: unknown, path: string): number {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error(`${path} 必须是 1..5 的整数`);
  }
  return score;
}

function normalizeConfidence(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence 必须是 0..1');
  }
  return Math.round(confidence * 1000) / 1000;
}

function parseSide(value: unknown, path: string): SyntheticJudgeSideResult {
  const side = asRecord(value);
  return {
    factualConfidence: integerScore(side.factualConfidence, `${path}.factualConfidence`),
    informationDensity: integerScore(side.informationDensity, `${path}.informationDensity`),
    einkSuitability: integerScore(side.einkSuitability, `${path}.einkSuitability`),
    unsupportedClaims: cleanStringArray(side.unsupportedClaims),
    evidenceNotes: cleanStringArray(side.evidenceNotes),
  };
}

function parseStrictJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') throw new Error('synthetic judge 返回值不是 JSON object/string');
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('synthetic judge 必须只返回一个 JSON object');
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('synthetic judge JSON 顶层必须是 object');
  }
  return parsed as Record<string, unknown>;
}

export function parseSyntheticJudgeResult(value: unknown): SyntheticJudgeBlindResult {
  const raw = parseStrictJsonObject(value);
  const choice = cleanString(raw.choice);
  if (choice !== 'a' && choice !== 'b' && choice !== 'tie') {
    throw new Error('choice 必须是 a / b / tie');
  }
  return {
    choice,
    sideA: parseSide(raw.sideA, 'sideA'),
    sideB: parseSide(raw.sideB, 'sideB'),
    confidence: normalizeConfidence(raw.confidence),
    rationale: cleanString(raw.rationale).slice(0, 4000),
  };
}

export function syntheticAssignmentForJudge(runId: string, judgeId: string): {
  researchSide: BlindSide;
  directSide: BlindSide;
} {
  const digest = createHash('sha256').update(`${runId}\n${judgeId}`).digest();
  const researchSide: BlindSide = (digest[0] & 1) === 0 ? 'a' : 'b';
  return { researchSide, directSide: researchSide === 'a' ? 'b' : 'a' };
}

export function judgeFamilyFromProvider(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized.startsWith('deepseek')) return 'deepseek';
  if (normalized.includes('kimi')) return 'kimi';
  if (normalized === 'hy3' || normalized.includes('codebuddy')) return 'hy3';
  return normalized || 'unknown';
}

function compactEvidenceSnapshot(value: string, maxChars = 8_000): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 40)}\n[TRUNCATED ${text.length - maxChars + 40} chars]`;
}

function evidenceBundle(subject: SyntheticEvaluationSubject): Record<string, unknown> {
  const metadata = asRecord(subject.research.metadata);
  const receipt = asRecord(metadata.researchReceipt);
  // Blind judge gets evidence content, never producer/runtime identity. In particular,
  // agent/thread/run/usage fields would trivially reveal which side is Research.
  return {
    seed: subject.seed,
    evidencePacket: compactEvidenceSnapshot(subject.evidenceSnapshot),
    sourceRegistry: {
      sources: Array.isArray(receipt.sources) ? receipt.sources : [],
      claims: Array.isArray(receipt.claims) ? receipt.claims : [],
      ...(receipt.retrieval ? { retrieval: receipt.retrieval } : {}),
    },
  };
}

export function syntheticEvidenceDigest(subject: SyntheticEvaluationSubject): string {
  return createHash('sha256').update(JSON.stringify({
    seed: subject.seed,
    direct: blindArtifactFrom(subject.direct),
    research: blindArtifactFrom(subject.research),
    evidence: evidenceBundle(subject),
  })).digest('hex');
}

export function buildSyntheticJudgePrompt(
  subject: SyntheticEvaluationSubject,
  judgeId: string,
): { prompt: string; researchSide: BlindSide; sideA: BlindArtifact; sideB: BlindArtifact; evidenceDigest: string } {
  const assignment = syntheticAssignmentForJudge(subject.runId, judgeId);
  const direct = blindArtifactFrom(subject.direct);
  const research = blindArtifactFrom(subject.research);
  const sideA = assignment.researchSide === 'a' ? research : direct;
  const sideB = assignment.researchSide === 'b' ? research : direct;
  const digest = syntheticEvidenceDigest(subject);

  const prompt = `你是 Quote0 的独立内容质量评审员。你正在模拟一名严谨的人类编辑，但你的输出必须被标记为 synthetic evaluation，绝不能声称是真实人工标签。\n\n任务：对同一新闻主体的 A/B 两个墨水屏成品做盲评。不要猜测哪个来自 Direct 或 Research；只根据内容和统一证据包评分。\n\n评分维度（1 最差，5 最好）：\n1. factualConfidence：表述是否被证据支持、措辞是否诚实、是否把传闻/评论写成事实。\n2. informationDensity：有限字数内是否保留了关键实体、事件、数字、因果或行动信息，避免空话。\n3. einkSuitability：标题与正文是否清楚、紧凑、易扫读，是否适合约 296×152 的墨水屏。\n\n评审纪律：\n- A/B 使用同一证据包；证据包中的 search snippet 只能视为线索，crawl/primary/official 才是较强证据。\n- 同一转载链、同一 canonical URL、同一利益相关方的多个页面不能冒充独立交叉验证。\n- 仅列出真正影响结论的 unsupportedClaims；风格偏好不要写成事实错误。\n- 先分别评分，再给 choice。若各有明显优点且无稳定赢家，选择 tie。\n- 不调用工具，不输出 Markdown，不解释你的身份，不泄露推理过程。\n\n主体与统一证据包：\n${JSON.stringify({
  subjectTitle: cleanString(subject.seed.title),
  sideA,
  sideB,
  evidence: evidenceBundle(subject),
}, null, 2)}\n\n只输出一个可被 JSON.parse 直接解析的紧凑 JSON object：\n{"choice":"a|b|tie","sideA":{"factualConfidence":1,"informationDensity":1,"einkSuitability":1,"unsupportedClaims":[],"evidenceNotes":[]},"sideB":{"factualConfidence":1,"informationDensity":1,"einkSuitability":1,"unsupportedClaims":[],"evidenceNotes":[]},"confidence":0.0,"rationale":"不超过500字的可审计理由"}`;

  return { prompt, researchSide: assignment.researchSide, sideA, sideB, evidenceDigest: digest };
}

function semanticChoice(choice: BlindSide | 'tie', researchSide: BlindSide): SemanticChoice {
  if (choice === 'tie') return 'tie';
  return choice === researchSide ? 'research' : 'direct';
}

function semanticSides(
  result: SyntheticJudgeBlindResult,
  researchSide: BlindSide,
): { direct: SyntheticJudgeSideResult; research: SyntheticJudgeSideResult } {
  return researchSide === 'a'
    ? { research: result.sideA, direct: result.sideB }
    : { research: result.sideB, direct: result.sideA };
}

function fromRow(row: any): SyntheticEvaluationRecord {
  return {
    id: Number(row.id),
    runId: String(row.research_run_id),
    sourceInventoryId: row.source_inventory_id == null ? null : Number(row.source_inventory_id),
    comparisonVersion: String(row.comparison_version),
    promptVersion: String(row.prompt_version),
    judgeId: String(row.judge_id),
    judgeFamily: String(row.judge_family),
    providerId: String(row.provider_id),
    researchSide: row.research_side === 'a' ? 'a' : 'b',
    choice: row.choice as SemanticChoice,
    directScores: {
      factualConfidence: Number(row.direct_factual_confidence),
      informationDensity: Number(row.direct_information_density),
      einkSuitability: Number(row.direct_eink_suitability),
    },
    researchScores: {
      factualConfidence: Number(row.research_factual_confidence),
      informationDensity: Number(row.research_information_density),
      einkSuitability: Number(row.research_eink_suitability),
    },
    confidence: Number(row.confidence),
    directUnsupportedClaims: cleanStringArray(row.direct_unsupported_claims),
    researchUnsupportedClaims: cleanStringArray(row.research_unsupported_claims),
    rationale: cleanString(row.rationale),
    rawResult: asRecord(row.raw_result),
    evidenceDigest: String(row.evidence_digest),
    straylightJobId: row.straylight_job_id ? String(row.straylight_job_id) : null,
    straylightThreadId: row.straylight_thread_id ? String(row.straylight_thread_id) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function loadSyntheticEvaluationSubjects(
  db: PostgresDatabase,
  options: { runIds?: string[]; limit?: number } = {},
): Promise<SyntheticEvaluationSubject[]> {
  const runIds = [...new Set((options.runIds || []).map((id) => id.trim()).filter(Boolean))];
  const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 50)));
  const result = await db.query(
    `SELECT rr.id AS research_run_id,
            rr.source_inventory_id,
            rr.input_snapshot,
            rr.result_artifact,
            rr.evidence_snapshot,
            rr.runtime_receipt,
            COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content) AS processed_content,
            review.choice AS human_choice
       FROM research_runs rr
       JOIN content_inventory ci ON ci.id = rr.source_inventory_id
       LEFT JOIN LATERAL (
         SELECT promotion.previous_processed_content
           FROM neuromancer_artifact_promotions promotion
          WHERE promotion.research_run_id = rr.id
            AND promotion.state = 'active'
          ORDER BY promotion.promoted_at DESC
          LIMIT 1
       ) active_promotion ON true
       LEFT JOIN neuromancer_artifact_reviews review
         ON review.research_run_id = rr.id
        AND review.comparison_version = $1
      WHERE rr.state = 'completed'
        AND rr.result_artifact IS NOT NULL
        AND COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content) IS NOT NULL
        AND ($2::boolean = false OR rr.id::text = ANY($3::text[]))
      ORDER BY rr.completed_at DESC NULLS LAST, rr.created_at DESC
      LIMIT $4`,
    [NEUROMANCER_PAIRED_REVIEW_VERSION, runIds.length > 0, runIds, limit],
  );
  return result.rows.map((row: any) => ({
    runId: String(row.research_run_id),
    sourceInventoryId: Number(row.source_inventory_id),
    seed: asRecord(row.input_snapshot),
    direct: asRecord(row.processed_content),
    research: asRecord(row.result_artifact),
    evidenceSnapshot: cleanString(row.evidence_snapshot),
    runtimeReceipt: asRecord(row.runtime_receipt),
    humanChoice: row.human_choice ? row.human_choice as SemanticChoice : null,
  }));
}

export async function saveSyntheticEvaluation(
  db: PostgresDatabase,
  input: {
    subject: SyntheticEvaluationSubject;
    judgeId: string;
    providerId: string;
    blindResult: SyntheticJudgeBlindResult;
    researchSide: BlindSide;
    rawResult: Record<string, unknown>;
    evidenceDigest: string;
    straylightJobId?: string;
    straylightThreadId?: string;
  },
): Promise<SyntheticEvaluationRecord> {
  const semantic = semanticSides(input.blindResult, input.researchSide);
  const choice = semanticChoice(input.blindResult.choice, input.researchSide);
  const judgeFamily = judgeFamilyFromProvider(input.providerId);
  const result = await db.query(
    `INSERT INTO neuromancer_synthetic_evaluations (
       research_run_id, source_inventory_id, comparison_version, prompt_version,
       judge_id, judge_family, provider_id, research_side, choice,
       direct_factual_confidence, research_factual_confidence,
       direct_information_density, research_information_density,
       direct_eink_suitability, research_eink_suitability,
       confidence, direct_unsupported_claims, research_unsupported_claims,
       rationale, raw_result, evidence_digest, straylight_job_id, straylight_thread_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,
       $19,$20::jsonb,$21,$22,$23
     )
     ON CONFLICT (research_run_id, comparison_version, judge_id) DO UPDATE SET
       source_inventory_id = EXCLUDED.source_inventory_id,
       prompt_version = EXCLUDED.prompt_version,
       judge_family = EXCLUDED.judge_family,
       provider_id = EXCLUDED.provider_id,
       research_side = EXCLUDED.research_side,
       choice = EXCLUDED.choice,
       direct_factual_confidence = EXCLUDED.direct_factual_confidence,
       research_factual_confidence = EXCLUDED.research_factual_confidence,
       direct_information_density = EXCLUDED.direct_information_density,
       research_information_density = EXCLUDED.research_information_density,
       direct_eink_suitability = EXCLUDED.direct_eink_suitability,
       research_eink_suitability = EXCLUDED.research_eink_suitability,
       confidence = EXCLUDED.confidence,
       direct_unsupported_claims = EXCLUDED.direct_unsupported_claims,
       research_unsupported_claims = EXCLUDED.research_unsupported_claims,
       rationale = EXCLUDED.rationale,
       raw_result = EXCLUDED.raw_result,
       evidence_digest = EXCLUDED.evidence_digest,
       straylight_job_id = EXCLUDED.straylight_job_id,
       straylight_thread_id = EXCLUDED.straylight_thread_id,
       updated_at = now()
     RETURNING *`,
    [
      input.subject.runId,
      input.subject.sourceInventoryId,
      NEUROMANCER_SYNTHETIC_EVALUATION_VERSION,
      NEUROMANCER_SYNTHETIC_JUDGE_PROMPT_VERSION,
      input.judgeId,
      judgeFamily,
      input.providerId,
      input.researchSide,
      choice,
      semantic.direct.factualConfidence,
      semantic.research.factualConfidence,
      semantic.direct.informationDensity,
      semantic.research.informationDensity,
      semantic.direct.einkSuitability,
      semantic.research.einkSuitability,
      input.blindResult.confidence,
      JSON.stringify(semantic.direct.unsupportedClaims),
      JSON.stringify(semantic.research.unsupportedClaims),
      input.blindResult.rationale,
      JSON.stringify(input.rawResult),
      input.evidenceDigest,
      input.straylightJobId || null,
      input.straylightThreadId || null,
    ],
  );
  return fromRow(result.rows[0]);
}

export async function listSyntheticEvaluations(
  db: PostgresDatabase,
  runId: string,
): Promise<SyntheticEvaluationRecord[]> {
  const result = await db.query(
    `SELECT *
       FROM neuromancer_synthetic_evaluations
      WHERE research_run_id = $1
        AND comparison_version = $2
      ORDER BY judge_id`,
    [runId, NEUROMANCER_SYNTHETIC_EVALUATION_VERSION],
  );
  return result.rows.map(fromRow);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function meanScores(records: SyntheticEvaluationRecord[], side: 'directScores' | 'researchScores'): NeuromancerReviewScores {
  return {
    factualConfidence: mean(records.map((record) => record[side].factualConfidence)),
    informationDensity: mean(records.map((record) => record[side].informationDensity)),
    einkSuitability: mean(records.map((record) => record[side].einkSuitability)),
  };
}

export function aggregateSyntheticEvaluations(
  records: SyntheticEvaluationRecord[],
): SyntheticEvaluationAggregate {
  const directScores = meanScores(records, 'directScores');
  const researchScores = meanScores(records, 'researchScores');
  const votes: Record<SemanticChoice, number> = { direct: 0, research: 0, tie: 0 };
  for (const record of records) votes[record.choice] += 1;
  return {
    comparisonVersion: NEUROMANCER_SYNTHETIC_EVALUATION_VERSION,
    validEvaluations: records.length,
    judgeIds: [...new Set(records.map((record) => record.judgeId))].sort(),
    judgeFamilies: [...new Set(records.map((record) => record.judgeFamily))].sort(),
    votes,
    directScores,
    researchScores,
    scoreDelta: {
      factualConfidence: researchScores.factualConfidence - directScores.factualConfidence,
      informationDensity: researchScores.informationDensity - directScores.informationDensity,
      einkSuitability: researchScores.einkSuitability - directScores.einkSuitability,
    },
    meanConfidence: mean(records.map((record) => record.confidence)),
    directUnsupportedClaimCount: records.reduce((sum, record) => sum + record.directUnsupportedClaims.length, 0),
    researchUnsupportedClaimCount: records.reduce((sum, record) => sum + record.researchUnsupportedClaims.length, 0),
    unanimousResearch: records.length > 0 && votes.research === records.length,
    majorityResearch: votes.research > votes.direct && votes.research > votes.tie,
  };
}
