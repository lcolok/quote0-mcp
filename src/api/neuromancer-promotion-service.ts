import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import { renderingRegistry } from '../react-widgets/core/rendering-modules.js';
import { EINK_DEVICE_HEIGHT, EINK_DEVICE_WIDTH } from '../react-widgets/core/device-constants.js';
import { enqueueDeliveriesForContent } from './delivery-enqueue.js';
import { validateRenderableNews } from './renderable-news-intake.js';
import {
  aggregateSyntheticEvaluations,
  listSyntheticEvaluations,
  loadSyntheticEvaluationSubjects,
  type SyntheticEvaluationAggregate,
  type SyntheticEvaluationRecord,
  type SyntheticEvaluationSubject,
} from './neuromancer-synthetic-evaluation-service.js';

export const NEUROMANCER_SYNTHETIC_PROMOTION_POLICY_VERSION = 'neuromancer-synthetic-promotion/v1';
export const NEUROMANCER_PROMOTION_PUSH_LAYER = 'research-promoted';

export interface SyntheticPromotionGate {
  eligible: boolean;
  reasons: string[];
  aggregate: SyntheticEvaluationAggregate;
  supportedClaims: number;
  sourceCount: number;
  strongSourceCount: number;
  humanChoice: 'direct' | 'research' | 'tie' | null;
}

export interface NeuromancerPromotionResult {
  promotionId: number;
  runId: string;
  sourceInventoryId: number;
  state: 'active' | 'rolled_back';
  idempotent: boolean;
  gate: SyntheticPromotionGate;
  approvedBy: string;
  promotedImagePath: string;
  delivery?: {
    payloadVersion: number;
    created: number;
    targeted: number;
    deviceIds: string[];
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function receiptFromResearch(subject: SyntheticEvaluationSubject): Record<string, any> {
  return asRecord(asRecord(subject.research.metadata).researchReceipt);
}

export function assessSyntheticPromotionGate(
  subject: SyntheticEvaluationSubject,
  evaluations: SyntheticEvaluationRecord[],
): SyntheticPromotionGate {
  const aggregate = aggregateSyntheticEvaluations(evaluations);
  const reasons: string[] = [];
  const validation = validateRenderableNews(subject.research);
  if (!validation.ok) reasons.push(...validation.errors.map((error) => `research-invalid:${error}`));

  const receipt = receiptFromResearch(subject);
  const claims = Array.isArray(receipt.claims) ? receipt.claims.map(asRecord) : [];
  const sources = Array.isArray(receipt.sources) ? receipt.sources.map(asRecord) : [];
  const supportedClaims = claims.filter((claim) => cleanString(claim.status) === 'supported').length;
  const nonSupportedClaims = claims.filter((claim) => cleanString(claim.status) !== 'supported').length;
  const strongSourceCount = sources.filter((source) => ['primary', 'official'].includes(cleanString(source.role))).length;

  if (subject.humanChoice === 'direct') reasons.push('human-review-prefers-direct');
  if (subject.humanChoice === 'tie') reasons.push('human-review-is-tie');
  if (aggregate.validEvaluations < 2) reasons.push('need-at-least-two-valid-synthetic-judges');
  if (aggregate.judgeFamilies.length < 2) reasons.push('need-at-least-two-independent-judge-families');
  if (aggregate.votes.research < 2) reasons.push('need-at-least-two-research-votes');
  if (aggregate.votes.direct > 0) reasons.push('synthetic-judge-direct-veto');
  if (aggregate.meanConfidence < 0.65) reasons.push('synthetic-confidence-below-0.65');
  if (aggregate.researchScores.factualConfidence < 4) reasons.push('research-factual-confidence-below-4');
  if (aggregate.scoreDelta.factualConfidence < 0) reasons.push('research-factual-regression');
  if (aggregate.scoreDelta.informationDensity < 0.5) reasons.push('research-density-gain-below-0.5');
  if (aggregate.scoreDelta.einkSuitability < -0.5) reasons.push('research-eink-regression-below--0.5');
  if (aggregate.researchUnsupportedClaimCount > 0) reasons.push('research-unsupported-claims-reported');
  if (claims.length < 1 || supportedClaims < 1) reasons.push('research-has-no-supported-claim');
  if (nonSupportedClaims > 0) reasons.push('research-receipt-has-unresolved-context-or-conflict');
  if (strongSourceCount < 1) reasons.push('research-has-no-primary-or-official-source');

  return {
    eligible: reasons.length === 0,
    reasons,
    aggregate,
    supportedClaims,
    sourceCount: sources.length,
    strongSourceCount,
    humanChoice: subject.humanChoice,
  };
}

function minioPathFromUrl(value: string): string {
  const parsed = new URL(value);
  const marker = '/quote0-images/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) throw new Error(`promotion render URL 不属于 quote0-images: ${parsed.pathname}`);
  return `/${parsed.pathname.slice(index + marker.length).replace(/^\/+/, '')}`;
}

function promotionMetadata(
  subject: SyntheticEvaluationSubject,
  gate: SyntheticPromotionGate,
  approvedBy: string,
): Record<string, unknown> {
  const researchMetadata = asRecord(subject.research.metadata);
  return {
    ...researchMetadata,
    producer: 'neuromancer-research-promoted',
    promotion: {
      schemaVersion: NEUROMANCER_SYNTHETIC_PROMOTION_POLICY_VERSION,
      researchRunId: subject.runId,
      evaluationVersion: gate.aggregate.comparisonVersion,
      syntheticEvaluation: true,
      approvalKind: 'operator-explicit',
      approvedBy,
      promotedAt: new Date().toISOString(),
      directArtifactDigest: digestJson(subject.direct),
      researchArtifactDigest: digestJson(subject.research),
      evaluationDigest: digestJson(gate.aggregate),
      votes: gate.aggregate.votes,
      scoreDelta: gate.aggregate.scoreDelta,
      judgeFamilies: gate.aggregate.judgeFamilies,
    },
  };
}

export function buildPromotedProcessedContent(
  subject: SyntheticEvaluationSubject,
  gate: SyntheticPromotionGate,
  approvedBy: string,
): RenderableDataItem {
  const validation = validateRenderableNews({
    ...subject.research,
    metadata: promotionMetadata(subject, gate, approvedBy),
  });
  if (!validation.ok) throw new Error(`Research promotion artifact 无效: ${validation.errors.join('; ')}`);
  return validation.data;
}

async function renderPromotedArtifact(artifact: RenderableDataItem): Promise<string> {
  const renderer = renderingRegistry.get('news');
  if (!renderer) throw new Error('news renderer 不存在');
  const imageUrl = await renderer.render(artifact, {
    border: '0',
    width: EINK_DEVICE_WIDTH,
    height: EINK_DEVICE_HEIGHT,
  });
  if (typeof imageUrl !== 'string') throw new Error('promotion render 未返回 MinIO URL');
  return minioPathFromUrl(imageUrl);
}

export async function promoteNeuromancerArtifact(
  db: PostgresDatabase,
  input: {
    runId: string;
    approvedBy: string;
    enqueueNow?: boolean;
  },
): Promise<NeuromancerPromotionResult> {
  const approvedBy = input.approvedBy.trim().slice(0, 200);
  if (!approvedBy) throw new Error('approvedBy 不能为空；synthetic judge 不能自行批准 promotion');

  const [subject] = await loadSyntheticEvaluationSubjects(db, { runIds: [input.runId], limit: 1 });
  if (!subject) throw new Error(`research_run ${input.runId} 不存在或不是 completed artifact`);
  const evaluations = await listSyntheticEvaluations(db, input.runId);
  const gate = assessSyntheticPromotionGate(subject, evaluations);
  if (!gate.eligible) throw new Error(`synthetic promotion gate 未通过: ${gate.reasons.join(', ')}`);

  const promoted = buildPromotedProcessedContent(subject, gate, approvedBy);
  const promotedImagePath = await renderPromotedArtifact(promoted);
  const client = await db.getClient();
  let promotionId = 0;
  let idempotent = false;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT rr.id AS research_run_id,
              rr.source_inventory_id,
              rr.result_artifact,
              ci.fingerprint,
              ci.title,
              ci.link,
              ci.source,
              ci.category,
              ci.raw_content,
              ci.processed_content,
              ci.image_path,
              ci.state,
              ci.replay_count,
              ci.last_pushed_at
         FROM research_runs rr
         JOIN content_inventory ci ON ci.id = rr.source_inventory_id
        WHERE rr.id = $1
          AND rr.state = 'completed'
          AND rr.result_artifact IS NOT NULL
        FOR UPDATE OF ci`,
      [input.runId],
    );
    const row = locked.rows[0];
    if (!row) throw new Error('promotion subject 在事务内已失效');

    const existing = await client.query(
      `SELECT * FROM neuromancer_artifact_promotions
        WHERE research_run_id = $1 AND policy_version = $2
        FOR UPDATE`,
      [input.runId, NEUROMANCER_SYNTHETIC_PROMOTION_POLICY_VERSION],
    );
    if (existing.rows[0]?.state === 'active') {
      promotionId = Number(existing.rows[0].id);
      idempotent = true;
      await client.query('COMMIT');
    } else {
      const inserted = await client.query(
        `INSERT INTO neuromancer_artifact_promotions (
           research_run_id, source_inventory_id, policy_version, state,
           approval_kind, approved_by, evaluation_summary,
           previous_processed_content, promoted_processed_content,
           previous_image_path, promoted_image_path,
           previous_inventory_state, previous_replay_count, previous_last_pushed_at
         ) VALUES (
           $1,$2,$3,'active','operator-explicit',$4,$5::jsonb,
           $6::jsonb,$7::jsonb,$8,$9,$10,$11,$12
         )
         ON CONFLICT (research_run_id, policy_version) DO UPDATE SET
           state = 'active',
           approval_kind = 'operator-explicit',
           approved_by = EXCLUDED.approved_by,
           evaluation_summary = EXCLUDED.evaluation_summary,
           previous_processed_content = EXCLUDED.previous_processed_content,
           promoted_processed_content = EXCLUDED.promoted_processed_content,
           previous_image_path = EXCLUDED.previous_image_path,
           promoted_image_path = EXCLUDED.promoted_image_path,
           previous_inventory_state = EXCLUDED.previous_inventory_state,
           previous_replay_count = EXCLUDED.previous_replay_count,
           previous_last_pushed_at = EXCLUDED.previous_last_pushed_at,
           rolled_back_at = NULL,
           rollback_reason = NULL,
           promoted_at = now(),
           updated_at = now()
         RETURNING id`,
        [
          input.runId,
          Number(row.source_inventory_id),
          NEUROMANCER_SYNTHETIC_PROMOTION_POLICY_VERSION,
          approvedBy,
          JSON.stringify(gate),
          JSON.stringify(row.processed_content),
          JSON.stringify(promoted),
          String(row.image_path),
          promotedImagePath,
          String(row.state),
          Number(row.replay_count || 0),
          row.last_pushed_at || null,
        ],
      );
      promotionId = Number(inserted.rows[0].id);
      await client.query(
        `UPDATE content_inventory
            SET processed_content = $2::jsonb,
                image_path = $3,
                state = 'ready',
                replay_count = 0,
                last_pushed_at = NULL
          WHERE id = $1`,
        [Number(row.source_inventory_id), JSON.stringify(promoted), promotedImagePath],
      );
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  let delivery: NeuromancerPromotionResult['delivery'];
  if (input.enqueueNow && !idempotent) {
    const enqueued = await enqueueDeliveriesForContent({ contentId: subject.sourceInventoryId });
    delivery = enqueued;
    const deliverySucceeded = enqueued.targeted > 0 && enqueued.created === enqueued.targeted;
    let pushLogRecorded = false;
    let pushLogError: string | undefined;
    if (deliverySucceeded) {
      await db.query(
        `UPDATE content_inventory
            SET state = 'pushed',
                replay_count = replay_count + 1,
                last_pushed_at = now()
          WHERE id = $1`,
        [subject.sourceInventoryId],
      );
      const inventory = await db.query('SELECT * FROM content_inventory WHERE id = $1', [subject.sourceInventoryId]);
      const row = inventory.rows[0];
      try {
        await db.recordPushResult({
          jobId: 'neuromancer-synthetic-promotion',
          fingerprint: String(row.fingerprint),
          title: promoted.title,
          link: promoted.link,
          source: promoted.source,
          category: promoted.category,
          rawContent: asRecord(row.raw_content),
          processedContent: promoted,
          imagePath: promotedImagePath,
          // news_push_log.layer is VARCHAR(20); keep the audit label stable and bounded.
          layer: NEUROMANCER_PROMOTION_PUSH_LAYER,
          isFallback: false,
          result: {
            source_inventory_id: subject.sourceInventoryId,
            research_run_id: subject.runId,
            promotion_id: promotionId,
            payload_version: enqueued.payloadVersion,
            synthetic_evaluation: true,
          },
        });
        pushLogRecorded = true;
      } catch (error) {
        // Delivery registration and the content promotion are authoritative. A secondary
        // push-log projection must not turn an already-applied production promotion into
        // an apparent total failure; preserve the projection error in the promotion ledger.
        pushLogError = error instanceof Error ? error.message : String(error);
        console.warn(`Neuromancer promotion push-log projection failed: ${pushLogError}`);
      }
    }
    await db.query(
      `UPDATE neuromancer_artifact_promotions
          SET delivery_summary = $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [promotionId, JSON.stringify({
        ...enqueued,
        fullyEnqueued: deliverySucceeded,
        pushLogRecorded,
        ...(pushLogError ? { pushLogError } : {}),
      })],
    );
  }

  return {
    promotionId,
    runId: subject.runId,
    sourceInventoryId: subject.sourceInventoryId,
    state: 'active',
    idempotent,
    gate,
    approvedBy,
    promotedImagePath,
    ...(delivery ? { delivery } : {}),
  };
}

export async function rollbackNeuromancerPromotion(
  db: PostgresDatabase,
  input: { promotionId: number; reason: string; approvedBy: string },
): Promise<{ promotionId: number; sourceInventoryId: number; state: 'rolled_back' }> {
  const reason = input.reason.trim().slice(0, 2000);
  const approvedBy = input.approvedBy.trim().slice(0, 200);
  if (!reason || !approvedBy) throw new Error('rollback reason / approvedBy 不能为空');
  const client = await db.getClient();
  let sourceInventoryId = 0;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT * FROM neuromancer_artifact_promotions WHERE id = $1 FOR UPDATE`,
      [input.promotionId],
    );
    const promotion = result.rows[0];
    if (!promotion) throw new Error(`promotion ${input.promotionId} 不存在`);
    sourceInventoryId = Number(promotion.source_inventory_id);
    if (promotion.state === 'rolled_back') {
      await client.query('COMMIT');
      return { promotionId: input.promotionId, sourceInventoryId, state: 'rolled_back' };
    }
    await client.query(
      `UPDATE content_inventory
          SET processed_content = $2::jsonb,
              image_path = $3,
              state = 'ready',
              replay_count = 0,
              last_pushed_at = NULL
        WHERE id = $1`,
      [sourceInventoryId, JSON.stringify(promotion.previous_processed_content), String(promotion.previous_image_path)],
    );
    await client.query(
      `UPDATE neuromancer_artifact_promotions
          SET state = 'rolled_back',
              rolled_back_at = now(),
              rollback_reason = $2,
              updated_at = now()
        WHERE id = $1`,
      [input.promotionId, `${reason}\nrolled back by ${approvedBy}`],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { promotionId: input.promotionId, sourceInventoryId, state: 'rolled_back' };
}
