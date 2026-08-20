import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  getNeuromancerReviewPair,
  listNeuromancerReviewCandidates,
  saveNeuromancerReview,
  saveNeuromancerWorthCost,
  type NeuromancerReviewScores,
} from './neuromancer-review-service.js';

const app = new Hono();
const postgres = getPostgresDatabase();

function score(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined;
}

function parseScores(value: unknown): NeuromancerReviewScores | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const factualConfidence = score(record.factualConfidence);
  const informationDensity = score(record.informationDensity);
  const einkSuitability = score(record.einkSuitability);
  if (!factualConfidence || !informationDensity || !einkSuitability) return undefined;
  return { factualConfidence, informationDensity, einkSuitability };
}

app.get('/api/review/neuromancer/candidates', async (c) => {
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50;
  const unreviewedOnly = ['1', 'true', 'yes'].includes((c.req.query('unreviewed') || '').toLowerCase());
  try {
    await postgres.initialize();
    const data = await listNeuromancerReviewCandidates(postgres, { limit, unreviewedOnly });
    return c.json({ success: true, data, count: data.length, changesPhysicalDelivery: false });
  } catch (error) {
    console.error('加载 Neuromancer paired Review 候选失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '加载候选失败' }, 500);
  }
});

app.get('/api/review/neuromancer/:runId', async (c) => {
  const runId = c.req.param('runId').trim();
  if (!runId) return c.json({ success: false, error: 'runId 不能为空' }, 400);
  try {
    await postgres.initialize();
    const pair = await getNeuromancerReviewPair(postgres, runId);
    if (!pair) return c.json({ success: false, error: 'Neuromancer paired Review 主体不存在' }, 404);
    return c.json({ success: true, data: pair });
  } catch (error) {
    console.error('加载 Neuromancer paired Review 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '加载 paired Review 失败' }, 500);
  }
});

app.put('/api/review/neuromancer/:runId/review', async (c) => {
  const runId = c.req.param('runId').trim();
  const body = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  const choice = body?.choice;
  const sideA = parseScores(body?.sideA);
  const sideB = parseScores(body?.sideB);
  if (choice !== 'a' && choice !== 'b' && choice !== 'tie') {
    return c.json({ success: false, error: 'choice 必须是 a / b / tie' }, 400);
  }
  if (!sideA || !sideB) {
    return c.json({ success: false, error: 'A/B 的事实信心、信息密度、墨水屏适配评分都必须是 1..5' }, 400);
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';

  try {
    await postgres.initialize();
    const pair = await getNeuromancerReviewPair(postgres, runId);
    if (!pair) return c.json({ success: false, error: 'Neuromancer paired Review 主体不存在' }, 404);
    await saveNeuromancerReview(postgres, {
      runId,
      sourceInventoryId: pair.sourceInventoryId,
      blindChoice: choice,
      sideA,
      sideB,
      note,
    });
    const revealed = await getNeuromancerReviewPair(postgres, runId);
    return c.json({ success: true, data: revealed, revealNow: true, changesPhysicalDelivery: false });
  } catch (error) {
    console.error('保存 Neuromancer paired Review 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '保存 paired Review 失败' }, 500);
  }
});

app.patch('/api/review/neuromancer/:runId/cost', async (c) => {
  const runId = c.req.param('runId').trim();
  const body = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  if (typeof body?.worthCost !== 'boolean') {
    return c.json({ success: false, error: 'worthCost 必须是 boolean' }, 400);
  }
  try {
    await postgres.initialize();
    const updated = await saveNeuromancerWorthCost(postgres, runId, body.worthCost);
    if (!updated) return c.json({ success: false, error: '请先完成盲测 A/B 评审' }, 409);
    const pair = await getNeuromancerReviewPair(postgres, runId);
    return c.json({ success: true, data: pair, changesPhysicalDelivery: false });
  } catch (error) {
    console.error('保存 Neuromancer Research 成本评价失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '保存 Research 成本评价失败' }, 500);
  }
});

export default app;
