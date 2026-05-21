import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { renderMemoToEink } from '../react-widgets/services/memo-renderer.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';

const memosApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

function rowToMemo(row: any): any {
  return {
    id: row.id,
    text: row.text,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    pngPath: row.png_path,
    pngUrl: row.png_path ? `/api/minio-proxy/${row.png_path}` : null,
    targetId: row.target_id,
    widgetId: row.widget_id,
    fontFamily: row.font_family,
    status: row.status,
    lastError: row.last_error ?? null,
    renderLatencyMs: row.render_latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 渲染并更新 memo 行；失败时写 status=failed + last_error */
async function renderAndUpdateMemo(
  memoId: string,
  text: string,
  override?: { widgetId?: string; fontFamily?: string }
): Promise<{ success: boolean; error?: string }> {
  const db = getPostgresDatabase();
  try {
    const result = await renderMemoToEink(text, memoId, override);
    await db.getPool().query(
      `UPDATE memos
       SET png_path = $2,
           widget_id = $3,
           font_family = $4,
           render_latency_ms = $5,
           status = 'ready',
           last_error = NULL,
           updated_at = now()
       WHERE id = $1`,
      [memoId, result.pngPath, result.widgetId, result.fontFamily, result.latencyMs]
    );
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知渲染错误';
    console.error(`❌ Memo ${memoId} 渲染失败:`, message);
    await db.getPool().query(
      `UPDATE memos
       SET status = 'failed',
           last_error = $2,
           updated_at = now()
       WHERE id = $1`,
      [memoId, message]
    );
    return { success: false, error: message };
  }
}

// GET / — 列出所有 memo
memosApp.get('/', async (c) => {
  try {
    const db = getPostgresDatabase();
    const result = await db.getPool().query(
      `SELECT id, text, enabled, sort_order, png_path, target_id, widget_id, font_family,
              status, last_error, render_latency_ms, created_at, updated_at
       FROM memos
       ORDER BY sort_order ASC, created_at ASC`
    );
    return c.json({ success: true, memos: result.rows.map(rowToMemo) });
  } catch (error) {
    console.error('❌ GET /api/memos 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// GET /:id — 取单条
memosApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const result = await db.getPool().query(
      `SELECT id, text, enabled, sort_order, png_path, target_id, widget_id, font_family,
              status, last_error, render_latency_ms, created_at, updated_at
       FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '备忘不存在' }, 404);
    }
    return c.json({ success: true, memo: rowToMemo(result.rows[0]) });
  } catch (error) {
    console.error('❌ GET /api/memos/:id 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// POST / — 新建 memo 并渲染
memosApp.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      text: string;
      enabled?: boolean;
      sortOrder?: number;
      widgetId?: string;
      fontFamily?: string;
    }>();

    if (!body.text || body.text.trim() === '') {
      return c.json({ success: false, error: 'text 必填' }, 400);
    }

    const memoId = crypto.randomUUID();
    const db = getPostgresDatabase();

    await db.getPool().query(
      `INSERT INTO memos (id, text, enabled, sort_order, widget_id, font_family, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
      [
        memoId,
        body.text.trim(),
        body.enabled !== false,
        typeof body.sortOrder === 'number' ? body.sortOrder : 0,
        body.widgetId ?? null,
        body.fontFamily ?? null,
      ]
    );

    const renderResult = await renderAndUpdateMemo(memoId, body.text.trim(), {
      widgetId: body.widgetId,
      fontFamily: body.fontFamily as any,
    });

    const refreshed = await db.getPool().query(
      `SELECT id, text, enabled, sort_order, png_path, target_id, widget_id, font_family,
              status, last_error, render_latency_ms, created_at, updated_at
       FROM memos WHERE id = $1 LIMIT 1`,
      [memoId]
    );

    return c.json(
      {
        success: true,
        memo: rowToMemo(refreshed.rows[0]),
        renderOk: renderResult.success,
        renderError: renderResult.error ?? null,
      },
      201
    );
  } catch (error) {
    console.error('❌ POST /api/memos 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// PATCH /:id — 更新 text/enabled/sortOrder；text 变化则重新渲染
memosApp.patch('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      text?: string;
      enabled?: boolean;
      sortOrder?: number;
    }>();

    const db = getPostgresDatabase();

    // 先查出当前 memo，确认存在并对比 text
    const currentRes = await db.getPool().query(
      `SELECT text, widget_id, font_family FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (currentRes.rows.length === 0) {
      return c.json({ success: false, error: '备忘不存在' }, 404);
    }

    const current = currentRes.rows[0];
    const newText = body.text?.trim();
    const textChanged = newText !== undefined && newText !== current.text;

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (newText !== undefined) {
      sets.push(`text = $${idx++}`);
      vals.push(newText);
    }
    if (typeof body.enabled === 'boolean') {
      sets.push(`enabled = $${idx++}`);
      vals.push(body.enabled);
    }
    if (typeof body.sortOrder === 'number') {
      sets.push(`sort_order = $${idx++}`);
      vals.push(body.sortOrder);
    }

    if (sets.length === 0) {
      return c.json({ success: false, error: '无可更新字段' }, 400);
    }

    sets.push(`updated_at = now()`);
    vals.push(id);

    await db.getPool().query(
      `UPDATE memos SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals
    );

    let renderResult: { success: boolean; error?: string } | undefined;
    if (textChanged) {
      renderResult = await renderAndUpdateMemo(id, newText!, {
        widgetId: current.widget_id,
        fontFamily: current.font_family,
      });
    }

    const refreshed = await db.getPool().query(
      `SELECT id, text, enabled, sort_order, png_path, target_id, widget_id, font_family,
              status, last_error, render_latency_ms, created_at, updated_at
       FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );

    return c.json({
      success: true,
      memo: rowToMemo(refreshed.rows[0]),
      renderOk: renderResult?.success ?? null,
      renderError: renderResult?.error ?? null,
    });
  } catch (error) {
    console.error('❌ PATCH /api/memos/:id 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// DELETE /:id — 删除（同时尽量删 MinIO 对象）
memosApp.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();

    const currentRes = await db.getPool().query(
      `SELECT png_path FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (currentRes.rows.length === 0) {
      return c.json({ success: false, error: '备忘不存在' }, 404);
    }

    const pngPath = currentRes.rows[0].png_path;
    if (pngPath) {
      try {
        await imageStorage.getClient().removeObject(MINIO_BUCKET, pngPath);
      } catch (e) {
        console.warn(`⚠️ 删除 MinIO 对象 ${pngPath} 失败（非阻塞）:`, e instanceof Error ? e.message : String(e));
      }
    }

    await db.getPool().query(`DELETE FROM memos WHERE id = $1`, [id]);
    return c.json({ success: true, id });
  } catch (error) {
    console.error('❌ DELETE /api/memos/:id 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// POST /:id/render — 手动重新渲染
memosApp.post('/:id/render', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();

    const currentRes = await db.getPool().query(
      `SELECT text, widget_id, font_family FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (currentRes.rows.length === 0) {
      return c.json({ success: false, error: '备忘不存在' }, 404);
    }

    const current = currentRes.rows[0];
    const renderResult = await renderAndUpdateMemo(id, current.text, {
      widgetId: current.widget_id,
      fontFamily: current.font_family,
    });

    const refreshed = await db.getPool().query(
      `SELECT id, text, enabled, sort_order, png_path, target_id, widget_id, font_family,
              status, last_error, render_latency_ms, created_at, updated_at
       FROM memos WHERE id = $1 LIMIT 1`,
      [id]
    );

    return c.json({
      success: true,
      memo: rowToMemo(refreshed.rows[0]),
      renderOk: renderResult.success,
      renderError: renderResult.error ?? null,
    });
  } catch (error) {
    console.error('❌ POST /api/memos/:id/render 失败:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

export default memosApp;
