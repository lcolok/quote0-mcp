import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';

export const NEUROMANCER_PAIRED_REVIEW_VERSION = 'neuromancer-paired-review/v1';

export type BlindSide = 'a' | 'b';
export type SemanticChoice = 'direct' | 'research' | 'tie';

export interface BlindArtifact {
  title: string;
  message: string;
}

export interface NeuromancerReviewScores {
  factualConfidence: number;
  informationDensity: number;
  einkSuitability: number;
}

export interface NeuromancerReviewAssignment {
  researchSide: BlindSide;
  directSide: BlindSide;
}

export interface NeuromancerReviewRecord {
  id: number;
  researchRunId: string;
  sourceInventoryId: number | null;
  comparisonVersion: string;
  researchSide: BlindSide;
  choice: SemanticChoice;
  directScores: NeuromancerReviewScores;
  researchScores: NeuromancerReviewScores;
  researchWorthCost: boolean | null;
  note: string | null;
  annotator: string;
  createdAt: string;
  updatedAt: string;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function assignmentForResearchRun(runId: string): NeuromancerReviewAssignment {
  const digest = createHash('sha256').update(runId).digest();
  const researchSide: BlindSide = (digest[0] & 1) === 0 ? 'a' : 'b';
  return { researchSide, directSide: researchSide === 'a' ? 'b' : 'a' };
}

export function blindArtifactFrom(value: unknown): BlindArtifact {
  const artifact = asRecord(value);
  const title = cleanString(artifact.title);
  const message = cleanString(artifact.message)
    || cleanString(artifact.summary)
    || cleanString(artifact.content);
  if (!title || !message) {
    throw new Error('paired review artifact 缺少 title/message');
  }
  return { title, message };
}

export function semanticChoiceFromBlind(choice: BlindSide | 'tie', assignment: NeuromancerReviewAssignment): SemanticChoice {
  if (choice === 'tie') return 'tie';
  return choice === assignment.researchSide ? 'research' : 'direct';
}

export function semanticScoresFromBlind(
  sideA: NeuromancerReviewScores,
  sideB: NeuromancerReviewScores,
  assignment: NeuromancerReviewAssignment,
): { directScores: NeuromancerReviewScores; researchScores: NeuromancerReviewScores } {
  return assignment.researchSide === 'a'
    ? { researchScores: sideA, directScores: sideB }
    : { researchScores: sideB, directScores: sideA };
}

function reviewFromRow(row: any): NeuromancerReviewRecord {
  return {
    id: Number(row.id),
    researchRunId: String(row.research_run_id),
    sourceInventoryId: row.source_inventory_id == null ? null : Number(row.source_inventory_id),
    comparisonVersion: String(row.comparison_version),
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
    researchWorthCost: typeof row.research_worth_cost === 'boolean' ? row.research_worth_cost : null,
    note: row.note ? String(row.note) : null,
    annotator: String(row.annotator || 'human'),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listNeuromancerReviewCandidates(
  db: PostgresDatabase,
  options: { limit?: number; unreviewedOnly?: boolean } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 50)));
  const unreviewedOnly = options.unreviewedOnly === true;
  const result = await db.query(
    `SELECT rr.id AS research_run_id,
            rr.source_inventory_id,
            rr.input_snapshot,
            rr.completed_at,
            rr.runtime_receipt,
            COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content) AS processed_content,
            review.id AS review_id,
            review.choice AS review_choice,
            review.updated_at AS review_updated_at
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
        AND ($2::boolean = false OR review.id IS NULL)
      ORDER BY rr.completed_at DESC NULLS LAST, rr.created_at DESC
      LIMIT $3`,
    [NEUROMANCER_PAIRED_REVIEW_VERSION, unreviewedOnly, limit],
  );

  return result.rows.flatMap((row: any) => {
    try {
      const seed = asRecord(row.input_snapshot);
      const direct = blindArtifactFrom(row.processed_content);
      return [{
        runId: String(row.research_run_id),
        sourceInventoryId: Number(row.source_inventory_id),
        subjectTitle: cleanString(seed.title) || direct.title,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        reviewed: row.review_id != null,
        reviewChoice: row.review_choice ? String(row.review_choice) as SemanticChoice : null,
        reviewUpdatedAt: row.review_updated_at ? new Date(row.review_updated_at).toISOString() : null,
      }];
    } catch {
      return [];
    }
  });
}

export async function getNeuromancerReviewPair(db: PostgresDatabase, runId: string) {
  const result = await db.query(
    `SELECT rr.*,
            COALESCE(rr.direct_snapshot, active_promotion.previous_processed_content, ci.processed_content) AS processed_content,
            ci.raw_content,
            ci.title AS inventory_title,
            review.id AS review_id,
            review.research_run_id AS review_research_run_id,
            review.source_inventory_id AS review_source_inventory_id,
            review.comparison_version AS review_comparison_version,
            review.research_side AS review_research_side,
            review.choice AS review_choice,
            review.direct_factual_confidence,
            review.research_factual_confidence,
            review.direct_information_density,
            review.research_information_density,
            review.direct_eink_suitability,
            review.research_eink_suitability,
            review.research_worth_cost,
            review.note AS review_note,
            review.annotator AS review_annotator,
            review.created_at AS review_created_at,
            review.updated_at AS review_updated_at
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
        AND review.comparison_version = $2
      WHERE rr.id = $1
        AND rr.state = 'completed'
        AND rr.result_artifact IS NOT NULL`,
    [runId, NEUROMANCER_PAIRED_REVIEW_VERSION],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  const direct = blindArtifactFrom(row.processed_content);
  const research = blindArtifactFrom(row.result_artifact);
  const assignment = assignmentForResearchRun(runId);
  const review = row.review_id == null ? null : reviewFromRow({
    id: row.review_id,
    research_run_id: row.review_research_run_id,
    source_inventory_id: row.review_source_inventory_id,
    comparison_version: row.review_comparison_version,
    research_side: row.review_research_side,
    choice: row.review_choice,
    direct_factual_confidence: row.direct_factual_confidence,
    research_factual_confidence: row.research_factual_confidence,
    direct_information_density: row.direct_information_density,
    research_information_density: row.research_information_density,
    direct_eink_suitability: row.direct_eink_suitability,
    research_eink_suitability: row.research_eink_suitability,
    research_worth_cost: row.research_worth_cost,
    note: row.review_note,
    annotator: row.review_annotator,
    created_at: row.review_created_at,
    updated_at: row.review_updated_at,
  });
  const sideA = assignment.researchSide === 'a' ? research : direct;
  const sideB = assignment.researchSide === 'b' ? research : direct;
  const seed = asRecord(row.input_snapshot);

  return {
    version: NEUROMANCER_PAIRED_REVIEW_VERSION,
    runId,
    sourceInventoryId: Number(row.source_inventory_id),
    subject: {
      title: cleanString(seed.title) || cleanString(row.inventory_title) || direct.title,
      source: cleanString(seed.source),
    },
    sideA,
    sideB,
    review,
    reveal: review ? {
      researchSide: assignment.researchSide,
      direct: asRecord(row.processed_content),
      research: asRecord(row.result_artifact),
      researchReceipt: asRecord(asRecord(row.result_artifact).metadata).researchReceipt ?? null,
      runtimeReceipt: row.runtime_receipt ?? null,
      straylightThreadId: row.straylight_thread_id ? String(row.straylight_thread_id) : null,
      straylightThreadIds: Array.isArray(row.straylight_thread_ids) ? row.straylight_thread_ids.map(String) : [],
    } : null,
    changesPhysicalDelivery: false,
  };
}

export async function saveNeuromancerReview(
  db: PostgresDatabase,
  input: {
    runId: string;
    sourceInventoryId: number;
    blindChoice: BlindSide | 'tie';
    sideA: NeuromancerReviewScores;
    sideB: NeuromancerReviewScores;
    note?: string;
  },
): Promise<NeuromancerReviewRecord> {
  const assignment = assignmentForResearchRun(input.runId);
  const choice = semanticChoiceFromBlind(input.blindChoice, assignment);
  const { directScores, researchScores } = semanticScoresFromBlind(input.sideA, input.sideB, assignment);
  const result = await db.query(
    `INSERT INTO neuromancer_artifact_reviews (
       research_run_id, source_inventory_id, comparison_version, research_side, choice,
       direct_factual_confidence, research_factual_confidence,
       direct_information_density, research_information_density,
       direct_eink_suitability, research_eink_suitability,
       note, annotator
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'human')
     ON CONFLICT (research_run_id, comparison_version) DO UPDATE SET
       source_inventory_id = EXCLUDED.source_inventory_id,
       research_side = EXCLUDED.research_side,
       choice = EXCLUDED.choice,
       direct_factual_confidence = EXCLUDED.direct_factual_confidence,
       research_factual_confidence = EXCLUDED.research_factual_confidence,
       direct_information_density = EXCLUDED.direct_information_density,
       research_information_density = EXCLUDED.research_information_density,
       direct_eink_suitability = EXCLUDED.direct_eink_suitability,
       research_eink_suitability = EXCLUDED.research_eink_suitability,
       note = EXCLUDED.note,
       updated_at = now()
     RETURNING *`,
    [
      input.runId,
      input.sourceInventoryId,
      NEUROMANCER_PAIRED_REVIEW_VERSION,
      assignment.researchSide,
      choice,
      directScores.factualConfidence,
      researchScores.factualConfidence,
      directScores.informationDensity,
      researchScores.informationDensity,
      directScores.einkSuitability,
      researchScores.einkSuitability,
      input.note?.trim().slice(0, 2000) || null,
    ],
  );
  return reviewFromRow(result.rows[0]);
}

export async function saveNeuromancerWorthCost(
  db: PostgresDatabase,
  runId: string,
  worthCost: boolean,
): Promise<NeuromancerReviewRecord | undefined> {
  const result = await db.query(
    `UPDATE neuromancer_artifact_reviews
        SET research_worth_cost = $3,
            updated_at = now()
      WHERE research_run_id = $1 AND comparison_version = $2
      RETURNING *`,
    [runId, NEUROMANCER_PAIRED_REVIEW_VERSION, worthCost],
  );
  return result.rows[0] ? reviewFromRow(result.rows[0]) : undefined;
}
