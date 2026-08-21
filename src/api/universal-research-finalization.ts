import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import { renderingRegistry } from '../react-widgets/core/rendering-modules.js';
import { EINK_DEVICE_HEIGHT, EINK_DEVICE_WIDTH } from '../react-widgets/core/device-constants.js';
import type { ResearchRunRecord } from './research-run-store.js';
import { validateRenderableNews } from './renderable-news-intake.js';
import {
  markUniversalResearchReady,
  researchGateFrom,
  UNIVERSAL_RESEARCH_POLICY_VERSION,
} from './universal-research-policy.js';

export interface UniversalResearchApplyResult {
  applied: boolean;
  idempotent: boolean;
  inventoryId?: number;
  imagePath?: string;
  reason?: 'not-inventory-auto' | 'missing-inventory' | 'not-universal-pending' | 'already-ready';
}

export function universalGroundingErrors(artifact: RenderableDataItem): string[] {
  const metadata = artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
    ? artifact.metadata as Record<string, any>
    : {};
  const receipt = metadata.researchReceipt && typeof metadata.researchReceipt === 'object' && !Array.isArray(metadata.researchReceipt)
    ? metadata.researchReceipt as Record<string, any>
    : {};
  const claims = Array.isArray(receipt.claims) ? receipt.claims : [];
  const errors: string[] = [];
  if (claims.length === 0) errors.push('universal final artifact 必须至少有 1 个 supported claim');
  for (const [index, claim] of claims.entries()) {
    const status = claim && typeof claim === 'object' && !Array.isArray(claim)
      ? String((claim as Record<string, unknown>).status || '')
      : '';
    if (status !== 'supported') {
      errors.push(`universal final claim[${index}] status=${status || 'missing'}；最终可推送卡片只允许 supported claim`);
    }
  }
  return errors;
}

function minioPathFromUrl(value: string): string {
  const parsed = new URL(value);
  const marker = '/quote0-images/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) throw new Error(`universal research render URL 不属于 quote0-images: ${parsed.pathname}`);
  return `/${parsed.pathname.slice(index + marker.length).replace(/^\/+/, '')}`;
}

async function renderGroundedArtifact(artifact: RenderableDataItem): Promise<string> {
  const renderer = renderingRegistry.get('news');
  if (!renderer) throw new Error('news renderer 不存在');
  const imageUrl = await renderer.render(artifact, {
    border: '0',
    width: EINK_DEVICE_WIDTH,
    height: EINK_DEVICE_HEIGHT,
  });
  if (typeof imageUrl !== 'string') throw new Error('universal research render 未返回 MinIO URL');
  return minioPathFromUrl(imageUrl);
}

export async function applyUniversalResearchArtifact(
  db: PostgresDatabase,
  input: {
    run: ResearchRunRecord;
    artifact: RenderableDataItem;
    now?: Date;
    renderArtifact?: (artifact: RenderableDataItem) => Promise<string>;
  },
): Promise<UniversalResearchApplyResult> {
  const run = input.run;
  if (run.trigger !== 'inventory-auto' || !run.sourceInventoryId) {
    return { applied: false, idempotent: false, reason: 'not-inventory-auto' };
  }

  const currentResult = await db.query(
    `SELECT id, processed_content, image_path
       FROM content_inventory
      WHERE id = $1`,
    [run.sourceInventoryId],
  );
  const current = currentResult.rows[0];
  if (!current) return { applied: false, idempotent: false, reason: 'missing-inventory' };

  const gate = researchGateFrom(current.processed_content);
  if (gate?.state === 'ready') {
    return {
      applied: false,
      idempotent: gate.researchRunId === run.id,
      inventoryId: run.sourceInventoryId,
      imagePath: current.image_path ? String(current.image_path) : undefined,
      reason: 'already-ready',
    };
  }
  if (!gate || gate.schemaVersion !== UNIVERSAL_RESEARCH_POLICY_VERSION || gate.state !== 'pending') {
    return { applied: false, idempotent: false, inventoryId: run.sourceInventoryId, reason: 'not-universal-pending' };
  }

  const now = input.now || new Date();
  const readyArtifact = markUniversalResearchReady(input.artifact, run, now);
  const validation = validateRenderableNews(readyArtifact);
  const groundingErrors = validation.ok ? universalGroundingErrors(validation.data) : [];
  if (!validation.ok || groundingErrors.length > 0) {
    const errors = validation.ok ? groundingErrors : validation.errors;
    throw new Error(`universal Research final artifact 无效: ${errors.join('; ')}`);
  }
  const renderArtifact = input.renderArtifact || renderGroundedArtifact;
  const imagePath = await renderArtifact(validation.data);

  const updated = await db.query(
    `UPDATE content_inventory
        SET processed_content = $2::jsonb,
            image_path = $3,
            state = 'ready',
            replay_count = 0,
            last_pushed_at = NULL
      WHERE id = $1
        AND processed_content->'metadata'->'researchGate'->>'schemaVersion' = $4
        AND processed_content->'metadata'->'researchGate'->>'state' = 'pending'
      RETURNING id`,
    [run.sourceInventoryId, JSON.stringify(validation.data), imagePath, UNIVERSAL_RESEARCH_POLICY_VERSION],
  );
  if (!updated.rows[0]) {
    const after = await db.query('SELECT processed_content, image_path FROM content_inventory WHERE id=$1', [run.sourceInventoryId]);
    const afterGate = researchGateFrom(after.rows[0]?.processed_content);
    return {
      applied: false,
      idempotent: afterGate?.state === 'ready' && afterGate.researchRunId === run.id,
      inventoryId: run.sourceInventoryId,
      imagePath: after.rows[0]?.image_path ? String(after.rows[0].image_path) : undefined,
      reason: afterGate?.state === 'ready' ? 'already-ready' : 'not-universal-pending',
    };
  }

  return {
    applied: true,
    idempotent: false,
    inventoryId: run.sourceInventoryId,
    imagePath,
  };
}
