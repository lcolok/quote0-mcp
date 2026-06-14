import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { renderTemplate } from '../react-widgets/core/label-job-queue.js';
import { createTurn, ensureBatchItemSession } from '../react-widgets/core/label-session-store.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import { niimbotPush } from '../react-widgets/core/niimbot-push-module.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';

const labelBatchesApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

/** item 对外状态：无 job → pending；否则映射 job.state（queued/running/succeeded/failed） */
function itemState(jobState: string | null, hasLabel: boolean): string {
  if (!jobState) return 'pending';
  if (jobState === 'queued') return 'pending';
  if (jobState === 'running') return 'running';
  if (jobState === 'succeeded') return hasLabel ? 'succeeded' : 'running';
  if (jobState === 'failed') return 'failed';
  return jobState;
}

// ============ POST / —— 创建批次 ============
labelBatchesApp.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      generator?: 'image' | 'widget' | 'svg';
      model?: string;
      presetId?: string | null;
      targetId?: string;
      promptTemplate: string;
      items: Array<{ name: string; vars?: Record<string, any>; refImageUrls?: string[] }>;
    }>();

    if (!body.name || !body.name.trim()) return c.json({ success: false, error: 'name 必填' }, 400);
    if (!body.promptTemplate || !body.promptTemplate.trim())
      return c.json({ success: false, error: 'promptTemplate 必填' }, 400);
    if (!Array.isArray(body.items) || body.items.length === 0)
      return c.json({ success: false, error: 'items 不能为空' }, 400);

    const db = getPostgresDatabase();
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const bRes = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO label_batches (name, generator, model, preset_id, target_id, prompt_template)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          body.name.trim().slice(0, 200),
          body.generator ?? 'image',
          body.model ?? null,
          body.presetId && body.presetId !== 'none' ? body.presetId : null,
          body.targetId ?? 'label-T40x20-320',
          body.promptTemplate,
        ]
      );
      const batchId = bRes.rows[0].id;

      for (let i = 0; i < body.items.length; i++) {
        const it = body.items[i];
        await client.query(
          `INSERT INTO label_batch_items (batch_id, idx, name, vars, ref_image_urls)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            batchId,
            i,
            (it.name ?? '').toString().slice(0, 500),
            it.vars ? JSON.stringify(it.vars) : null,
            it.refImageUrls && it.refImageUrls.length ? JSON.stringify(it.refImageUrls) : null,
          ]
        );
      }
      await client.query('COMMIT');
      return c.json({ success: true, id: batchId, createdAt: bRes.rows[0].created_at }, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/label-batches 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET / —— 列表（带进度计数） ============
labelBatchesApp.get('/', async (c) => {
  try {
    const db = getPostgresDatabase();
    const r = await db.getPool().query(`
      SELECT b.id, b.name, b.generator, b.model, b.status, b.template_rev, b.created_at, b.updated_at,
             count(i.*) AS total,
             count(i.*) FILTER (WHERE i.label_id IS NOT NULL) AS done
        FROM label_batches b
        LEFT JOIN label_batch_items i ON i.batch_id = b.id
       WHERE b.status != 'archived'
       GROUP BY b.id
       ORDER BY b.created_at DESC
    `);
    const batches = r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      generator: row.generator,
      model: row.model,
      status: row.status,
      templateRev: row.template_rev,
      counts: { total: Number(row.total), done: Number(row.done) },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return c.json({ success: true, batches });
  } catch (error) {
    console.error('❌ GET /api/label-batches 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET /:id —— 详情（join job+label，回填 label_id） ============
labelBatchesApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();

    const bRes = await db.getPool().query(`SELECT * FROM label_batches WHERE id = $1 LIMIT 1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const b = bRes.rows[0];

    // 回填：job 成功的 item 把 label_id 落到 items 表
    await db.getPool().query(
      `UPDATE label_batch_items i
          SET label_id = j.label_id, updated_at = now()
         FROM label_jobs j
        WHERE i.job_id = j.id AND i.batch_id = $1
          AND i.label_id IS NULL AND j.state = 'succeeded' AND j.label_id IS NOT NULL`,
      [id]
    );

    const iRes = await db.getPool().query(
      `SELECT i.id, i.idx, i.name, i.vars, i.ref_image_urls, i.job_id, i.label_id, i.review,
              j.state AS job_state, j.last_error AS job_error,
              l.id AS l_id, l.png_path, l.status AS label_status,
              (SELECT count(*) FROM label_gen_turns t WHERE t.session_id = i.session_id) AS turn_count,
              (SELECT count(*) FROM label_gen_turns t
                WHERE t.session_id = i.session_id
                  AND (t.created_at, t.id) <= (SELECT ct.created_at, ct.id
                                                 FROM label_gen_turns ct
                                                WHERE ct.id = s.current_turn_id)
              ) AS current_no
         FROM label_batch_items i
         LEFT JOIN label_sessions s ON s.id = i.session_id
         LEFT JOIN label_jobs j ON j.id = i.job_id
         LEFT JOIN labels l ON l.id = COALESCE(i.label_id, j.label_id)
        WHERE i.batch_id = $1
        ORDER BY i.idx ASC`,
      [id]
    );

    const items = iRes.rows.map((row) => ({
      id: row.id,
      idx: row.idx,
      name: row.name,
      vars: row.vars,
      refImageUrls: row.ref_image_urls ?? [],
      review: row.review,
      state: itemState(row.job_state, !!row.l_id),
      lastError: row.job_error ?? null,
      versionCount: Number(row.turn_count ?? 0),
      versionNo: Number(row.current_no ?? 0) || null,
      label: row.l_id
        ? { id: row.l_id, pngUrl: pngUrlOf(row.png_path), status: row.label_status }
        : null,
    }));

    return c.json({
      success: true,
      batch: {
        id: b.id,
        name: b.name,
        generator: b.generator,
        model: b.model,
        presetId: b.preset_id,
        targetId: b.target_id,
        promptTemplate: b.prompt_template,
        templateRev: b.template_rev,
        status: b.status,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      },
      items,
    });
  } catch (error) {
    console.error('❌ GET /api/label-batches/:id 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ PATCH /:id —— 改配置（模板变则 template_rev+1） ============
labelBatchesApp.patch('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      model?: string | null;
      presetId?: string | null;
      targetId?: string;
      promptTemplate?: string;
    }>();

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (typeof body.name === 'string') { sets.push(`name = $${idx++}`); vals.push(body.name.trim().slice(0, 200)); }
    if (body.model !== undefined) { sets.push(`model = $${idx++}`); vals.push(body.model); }
    if (body.presetId !== undefined) { sets.push(`preset_id = $${idx++}`); vals.push(body.presetId && body.presetId !== 'none' ? body.presetId : null); }
    if (typeof body.targetId === 'string') { sets.push(`target_id = $${idx++}`); vals.push(body.targetId); }
    if (typeof body.promptTemplate === 'string') {
      sets.push(`prompt_template = $${idx++}`); vals.push(body.promptTemplate);
      sets.push(`template_rev = template_rev + 1`);
    }
    if (sets.length === 0) return c.json({ success: false, error: '无可更新字段' }, 400);
    sets.push(`updated_at = now()`);
    vals.push(id);

    const r = await getPostgresDatabase().getPool().query(
      `UPDATE label_batches SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, template_rev`,
      vals
    );
    if (r.rowCount === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    return c.json({ success: true, id, templateRev: r.rows[0].template_rev });
  } catch (error) {
    console.error('❌ PATCH /api/label-batches/:id 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// 内部：解析 scope → 目标 items
async function resolveItems(batchId: string, scope: any, sampleSize: number) {
  const db = getPostgresDatabase();
  if (scope && typeof scope === 'object' && Array.isArray(scope.itemIds)) {
    const r = await db.getPool().query(
      `SELECT * FROM label_batch_items WHERE batch_id = $1 AND id = ANY($2::uuid[]) ORDER BY idx ASC`,
      [batchId, scope.itemIds]
    );
    return r.rows;
  }
  if (scope === 'sample') {
    const r = await db.getPool().query(
      `SELECT * FROM label_batch_items WHERE batch_id = $1 AND label_id IS NULL ORDER BY idx ASC LIMIT $2`,
      [batchId, Math.max(1, sampleSize)]
    );
    return r.rows;
  }
  if (scope === 'failed') {
    const r = await db.getPool().query(
      `SELECT i.* FROM label_batch_items i
         LEFT JOIN label_jobs j ON j.id = i.job_id
        WHERE i.batch_id = $1 AND i.label_id IS NULL
          AND (i.job_id IS NULL OR j.state = 'failed')
        ORDER BY i.idx ASC`,
      [batchId]
    );
    return r.rows;
  }
  // 'all'
  const r = await db.getPool().query(
    `SELECT * FROM label_batch_items WHERE batch_id = $1 AND label_id IS NULL ORDER BY idx ASC`,
    [batchId]
  );
  return r.rows;
}

// 内部：对一批 items 渲染模板 + 入队
// 收敛到 session/turn 总账(docs/Label-Session-Editor-Spec.md):createTurn 负责入队、
// 注入 session:/turn: tags、推进 current_turn_id、同步 item 的 job_id/label_id
async function enqueueItems(batch: any, items: any[], opts: { idempotent: boolean }) {
  const results: Array<{ itemId: string; jobId: string | null; deduped: boolean }> = [];
  for (const it of items) {
    const prompt = renderTemplate(batch.prompt_template, { name: it.name, ...(it.vars ?? {}) });
    const clientRequestId = opts.idempotent
      ? `batch:${batch.id}:item:${it.id}:rev${batch.template_rev}`
      : null;
    const session = await ensureBatchItemSession(it.id);
    const res = await createTurn({
      sessionId: session.sessionId,
      parentTurnId: session.currentTurnId,
      turnKind: session.currentTurnId ? 'refine' : 'root',
      genMode: 'template',
      refImageUrls: it.ref_image_urls ?? null,
      params: {
        model: batch.model,
        presetId: batch.preset_id ?? null,
        targetId: batch.target_id,
        templateRev: batch.template_rev,
      },
      effectivePrompt: prompt,
      clientRequestId,
      enqueue: {
        jobType: 'image',
        payload: {
          prompt,
          model: batch.model,
          targetId: batch.target_id,
          presetId: batch.preset_id ?? undefined,
          refImageUrls: it.ref_image_urls ?? [],
          tags: [`batch:${batch.id}`, `item:${it.id}`],
        },
      },
    });
    results.push({ itemId: it.id, jobId: res.jobId, deduped: res.deduped });
  }
  return results;
}

// ============ POST /:id/run —— 放量 ============
labelBatchesApp.post('/:id/run', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { scope?: any; sampleSize?: number };
    const scope = body.scope ?? 'all';
    const sampleSize = body.sampleSize ?? 3;

    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM label_batches WHERE id = $1 LIMIT 1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const batch = bRes.rows[0];

    const items = await resolveItems(id, scope, sampleSize);
    if (items.length === 0) return c.json({ success: true, enqueued: 0, results: [] });

    const results = await enqueueItems(batch, items, { idempotent: true });
    await db.getPool().query(`UPDATE label_batches SET status = 'running', updated_at = now() WHERE id = $1`, [id]);
    return c.json({ success: true, enqueued: results.length, results });
  } catch (error) {
    console.error('❌ POST /api/label-batches/:id/run 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/retry —— 重试（全新 job） ============
labelBatchesApp.post('/:id/retry', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { scope?: any };
    const scope = body.scope ?? 'failed';

    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM label_batches WHERE id = $1 LIMIT 1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const batch = bRes.rows[0];

    const items = await resolveItems(id, scope, 0);
    if (items.length === 0) return c.json({ success: true, enqueued: 0, results: [] });

    const results = await enqueueItems(batch, items, { idempotent: false });
    await db.getPool().query(`UPDATE label_batches SET status = 'running', updated_at = now() WHERE id = $1`, [id]);
    return c.json({ success: true, enqueued: results.length, results });
  } catch (error) {
    console.error('❌ POST /api/label-batches/:id/retry 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/items/:itemId/review —— 单条审批 ============
labelBatchesApp.post('/:id/items/:itemId/review', async (c) => {
  try {
    const itemId = c.req.param('itemId');
    const body = await c.req.json<{ review: 'approved' | 'rejected' | 'pending' }>();
    if (!['approved', 'rejected', 'pending'].includes(body.review))
      return c.json({ success: false, error: 'review 取值非法' }, 400);

    const r = await getPostgresDatabase().getPool().query(
      `UPDATE label_batch_items SET review = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [body.review, itemId]
    );
    if (r.rowCount === 0) return c.json({ success: false, error: 'item 不存在' }, 404);
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ POST review 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/print —— 批量打印（复用 niimbot 推送，image 路径） ============
labelBatchesApp.post('/:id/print', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { scope?: any; niimbotEndpoint?: string };
    const endpoint = body.niimbotEndpoint || process.env.NIIMBOT_ENDPOINT;
    if (!endpoint) return c.json({ success: false, error: '缺少 niimbotEndpoint（body 或 NIIMBOT_ENDPOINT）' }, 400);

    const db = getPostgresDatabase();

    // 打印前回填 label_id:刚生成完的 item 可能 label_id 还没落到 items 表(原本仅 GET 详情时才回填),
    // 否则下面 IS NOT NULL 查询会把它们静默跳过 → 漏打。复用 GET 详情的回填逻辑。
    await db.getPool().query(
      `UPDATE label_batch_items i
          SET label_id = j.label_id, updated_at = now()
         FROM label_jobs j
        WHERE i.job_id = j.id AND i.batch_id = $1
          AND i.label_id IS NULL AND j.state = 'succeeded' AND j.label_id IS NOT NULL`,
      [id]
    );

    // 取目标 item 的 label（scope: 'approved' | {itemIds}）
    let labelRows: any[];
    if (body.scope && typeof body.scope === 'object' && Array.isArray(body.scope.itemIds)) {
      const r = await db.getPool().query(
        `SELECT l.* FROM label_batch_items i JOIN labels l ON l.id = i.label_id
          WHERE i.batch_id = $1 AND i.id = ANY($2::uuid[]) AND i.label_id IS NOT NULL`,
        [id, body.scope.itemIds]
      );
      labelRows = r.rows;
    } else {
      const r = await db.getPool().query(
        `SELECT l.* FROM label_batch_items i JOIN labels l ON l.id = i.label_id
          WHERE i.batch_id = $1 AND i.review = 'approved' AND i.label_id IS NOT NULL`,
        [id]
      );
      labelRows = r.rows;
    }

    if (labelRows.length === 0) return c.json({ success: true, printed: 0, results: [] });

    const results: Array<{ labelId: string; ok: boolean; httpStatus?: number; error?: string }> = [];
    for (const label of labelRows) {
      try {
        const target = BUILTIN_TARGETS.find((t) => t.id === label.target_id) ?? LABEL_T40X20_TARGET;
        // image / widget 路径：从 MinIO 下 png → pack
        const pngObj = await imageStorage.getClient().getObject(MINIO_BUCKET, label.png_path);
        const chunks: Buffer[] = [];
        for await (const chunk of pngObj) chunks.push(chunk as Buffer);
        const pngBuffer = Buffer.concat(chunks);
        const bitmapBuffer = await packFromPng(pngBuffer, target);

        const pushResult = await niimbotPush.push(bitmapBuffer, target, endpoint, { printId: label.id });
        if (!pushResult.queued) {
          results.push({ labelId: label.id, ok: false, httpStatus: pushResult.status, error: pushResult.error || '推送失败' });
          continue;
        }
        await db.getPool().query(
          `UPDATE labels
              SET status = 'printed', print_count = print_count + 1,
                  print_history = print_history || jsonb_build_object(
                    'printed_at', now(), 'endpoint', $2::text, 'http_status', $3::int, 'bytes', $4::int),
                  updated_at = now()
            WHERE id = $1`,
          [label.id, endpoint, pushResult.status ?? null, bitmapBuffer.length]
        );
        results.push({ labelId: label.id, ok: true, httpStatus: pushResult.status });
      } catch (e) {
        results.push({ labelId: label.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const printed = results.filter((r) => r.ok).length;
    return c.json({ success: true, printed, results });
  } catch (error) {
    console.error('❌ POST /api/label-batches/:id/print 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

export default labelBatchesApp;
