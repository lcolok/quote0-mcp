import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { ADAPTIVE_LAYOUT_VERSION } from '../react-widgets/core/adaptive-layout.js';
import { ADAPTIVE_SATORI_RENDERER_VERSION } from '../react-widgets/core/adaptive-satori-renderer.js';
import {
  ADAPTIVE_REVIEW_TARGETS,
  CURRENT_NEWS_RENDERER_VERSION,
  renderAdaptiveComparison,
  resolveAdaptiveReviewTarget,
} from './adaptive-review-service.js';

const app = new Hono();
const postgres = getPostgresDatabase();

function serializeTarget(target: (typeof ADAPTIVE_REVIEW_TARGETS)[number]) {
  return {
    id: target.id,
    kind: target.kind,
    widthPx: target.widthPx,
    heightPx: target.heightPx,
    dpi: target.dpi,
    physical: target.physical ?? null,
  };
}

async function getLatestReview(newsId: number, targetId: string) {
  const result = await postgres.query(
    `SELECT id, news_id, target_id, layout_engine, primary_renderer, adaptive_renderer,
            choice, information_retention, readability, space_usage, physical_confidence,
            note, annotator, metrics_snapshot, created_at, updated_at
       FROM adaptive_layout_reviews
      WHERE news_id = $1 AND target_id = $2 AND layout_engine = $3`,
    [newsId, targetId, ADAPTIVE_LAYOUT_VERSION],
  );
  return result.rows[0] ?? null;
}

app.get('/api/review/adaptive/targets', (c) => {
  return c.json({
    success: true,
    data: ADAPTIVE_REVIEW_TARGETS.map(serializeTarget),
    layoutEngine: ADAPTIVE_LAYOUT_VERSION,
    primaryRenderer: CURRENT_NEWS_RENDERER_VERSION,
    adaptiveRenderer: ADAPTIVE_SATORI_RENDERER_VERSION,
    changesPhysicalDelivery: false,
  });
});

app.get('/api/review/adaptive/:id', async (c) => {
  const newsId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(newsId) || newsId <= 0) {
    return c.json({ success: false, error: '无效的 review subject id' }, 400);
  }
  const requestedTargetId = c.req.query('targetId');
  const target = resolveAdaptiveReviewTarget(requestedTargetId);
  if (requestedTargetId && target.id !== requestedTargetId) {
    return c.json({ success: false, error: `未知 RenderTarget: ${requestedTargetId}` }, 400);
  }

  try {
    await postgres.initialize();
    const result = await postgres.query('SELECT * FROM news_push_log WHERE id = $1', [newsId]);
    const row = result.rows[0];
    if (!row) return c.json({ success: false, error: '评审主体不存在' }, 404);

    const [comparison, review] = await Promise.all([
      renderAdaptiveComparison(row, target),
      getLatestReview(newsId, target.id),
    ]);
    return c.json({
      success: true,
      data: {
        ...comparison,
        review,
        authoritativeOutput: target.kind === 'eink' ? 'primary' : null,
        changesPhysicalDelivery: false,
      },
    });
  } catch (error) {
    console.error('Adaptive A/B 渲染失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Adaptive A/B 渲染失败',
    }, 500);
  }
});

app.put('/api/review/adaptive/:id/review', async (c) => {
  const newsId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(newsId) || newsId <= 0) {
    return c.json({ success: false, error: '无效的 review subject id' }, 400);
  }
  const body = await c.req.json().catch(() => null) as null | {
    targetId?: unknown;
    choice?: unknown;
    informationRetention?: unknown;
    readability?: unknown;
    spaceUsage?: unknown;
    physicalConfidence?: unknown;
    note?: unknown;
    metricsSnapshot?: unknown;
  };
  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  const target = resolveAdaptiveReviewTarget(targetId);
  if (!targetId || target.id !== targetId) {
    return c.json({ success: false, error: '需要有效 targetId' }, 400);
  }
  if (body?.choice !== 'primary' && body?.choice !== 'adaptive' && body?.choice !== 'tie') {
    return c.json({ success: false, error: 'choice 必须是 primary / adaptive / tie' }, 400);
  }

  const score = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : Number.NaN;
  };
  const informationRetention = score(body.informationRetention);
  const readability = score(body.readability);
  const spaceUsage = score(body.spaceUsage);
  const physicalConfidence = score(body.physicalConfidence);
  if ([informationRetention, readability, spaceUsage, physicalConfidence].some((value) => Number.isNaN(value))) {
    return c.json({ success: false, error: '评分必须是 1..5' }, 400);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  let metricsSnapshot: string | null = null;
  if (body.metricsSnapshot !== undefined) {
    try {
      metricsSnapshot = JSON.stringify(body.metricsSnapshot);
      if (metricsSnapshot.length > 32_768) return c.json({ success: false, error: 'metricsSnapshot 过大' }, 400);
    } catch {
      return c.json({ success: false, error: 'metricsSnapshot 必须可 JSON 序列化' }, 400);
    }
  }

  try {
    await postgres.initialize();
    const exists = await postgres.query('SELECT 1 FROM news_push_log WHERE id = $1', [newsId]);
    if (exists.rows.length === 0) return c.json({ success: false, error: '评审主体不存在' }, 404);

    const result = await postgres.query(
      `INSERT INTO adaptive_layout_reviews (
         news_id, target_id, layout_engine, primary_renderer, adaptive_renderer,
         choice, information_retention, readability, space_usage, physical_confidence,
         note, annotator, metrics_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human',$12::jsonb)
       ON CONFLICT (news_id, target_id, layout_engine) DO UPDATE SET
         primary_renderer = EXCLUDED.primary_renderer,
         adaptive_renderer = EXCLUDED.adaptive_renderer,
         choice = EXCLUDED.choice,
         information_retention = EXCLUDED.information_retention,
         readability = EXCLUDED.readability,
         space_usage = EXCLUDED.space_usage,
         physical_confidence = EXCLUDED.physical_confidence,
         note = EXCLUDED.note,
         metrics_snapshot = EXCLUDED.metrics_snapshot,
         updated_at = now()
       RETURNING *`,
      [
        newsId,
        target.id,
        ADAPTIVE_LAYOUT_VERSION,
        CURRENT_NEWS_RENDERER_VERSION,
        ADAPTIVE_SATORI_RENDERER_VERSION,
        body.choice,
        informationRetention,
        readability,
        spaceUsage,
        physicalConfidence,
        note || null,
        metricsSnapshot,
      ],
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('保存 Adaptive A/B 评审失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '保存 Adaptive A/B 评审失败',
    }, 500);
  }
});

export default app;
