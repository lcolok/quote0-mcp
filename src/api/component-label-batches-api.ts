// 元器件编号标签「批次管理」层 —— 对齐 label-batches-api.ts(盲盒 LLM 批次)给用户的批量录入/
// 进度查看/批量打印体验，但生成路径走 component-labels-api.ts 的确定性 widget 渲染(无 LLM/job 队列)。
// 依旧刻意与元件元数据解耦：批次+item 只存 code 字符串 + 渲染/打印状态，不存型号/厂商/封装等信息。
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  normalizeCode,
  renderOne,
  resolveDeviceAndSink,
  printOneCode,
  DEFAULT_TARGET_ID,
} from './component-labels-api.js';

const componentLabelBatchesApp = new Hono();

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

// ============ POST / —— 创建批次(批量录入编号) ============
componentLabelBatchesApp.post('/', async (c) => {
  try {
    const body = await c.req.json<{ name: string; codes: string[]; targetId?: string }>();
    if (!body.name || !body.name.trim()) return c.json({ success: false, error: 'name 必填' }, 400);
    if (!Array.isArray(body.codes) || body.codes.length === 0)
      return c.json({ success: false, error: 'codes 不能为空' }, 400);

    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    const codes = body.codes.map(normalizeCode).filter(Boolean);

    const db = getPostgresDatabase();
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const bRes = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO component_label_batches (name, target_id) VALUES ($1, $2) RETURNING id, created_at`,
        [body.name.trim().slice(0, 200), targetId]
      );
      const batchId = bRes.rows[0].id;
      for (let i = 0; i < codes.length; i++) {
        await client.query(
          `INSERT INTO component_label_batch_items (batch_id, idx, code) VALUES ($1, $2, $3)`,
          [batchId, i, codes[i]]
        );
      }
      await client.query('COMMIT');
      return c.json({ success: true, id: batchId, createdAt: bRes.rows[0].created_at, count: codes.length }, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/component-label-batches 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET / —— 批次列表(带进度计数) ============
componentLabelBatchesApp.get('/', async (c) => {
  try {
    const db = getPostgresDatabase();
    const r = await db.getPool().query(`
      SELECT b.id, b.name, b.target_id, b.status, b.created_at, b.updated_at,
             count(i.*) AS total,
             count(i.*) FILTER (WHERE i.label_id IS NOT NULL) AS rendered,
             count(i.*) FILTER (WHERE i.print_count > 0) AS printed
        FROM component_label_batches b
        LEFT JOIN component_label_batch_items i ON i.batch_id = b.id
       WHERE b.status != 'archived'
       GROUP BY b.id
       ORDER BY b.created_at DESC
    `);
    const batches = r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      targetId: row.target_id,
      status: row.status,
      counts: { total: Number(row.total), rendered: Number(row.rendered), printed: Number(row.printed) },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return c.json({ success: true, batches });
  } catch (error) {
    console.error('❌ GET /api/component-label-batches 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET /:id —— 批次详情(每个 item 的渲染/打印状态) ============
componentLabelBatchesApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM component_label_batches WHERE id = $1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);

    const iRes = await db.getPool().query(
      `SELECT i.*, l.png_path, l.status AS label_status
         FROM component_label_batch_items i
         LEFT JOIN labels l ON l.id = i.label_id
        WHERE i.batch_id = $1
        ORDER BY i.idx ASC`,
      [id]
    );
    const items = iRes.rows.map((row) => ({
      id: row.id,
      idx: row.idx,
      code: row.code,
      labelId: row.label_id,
      pngUrl: pngUrlOf(row.png_path),
      labelStatus: row.label_status,
      printCount: row.print_count,
      lastPrintedAt: row.last_printed_at,
    }));
    const b = bRes.rows[0];
    return c.json({
      success: true,
      batch: { id: b.id, name: b.name, targetId: b.target_id, status: b.status, createdAt: b.created_at, updatedAt: b.updated_at },
      items,
    });
  } catch (error) {
    console.error('❌ GET /api/component-label-batches/:id 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/render —— 渲染批次内尚未渲染的 item(幂等，可反复调) ============
componentLabelBatchesApp.post('/:id/render', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM component_label_batches WHERE id = $1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const batch = bRes.rows[0];

    const iRes = await db.getPool().query(
      `SELECT * FROM component_label_batch_items WHERE batch_id = $1 AND label_id IS NULL ORDER BY idx ASC`,
      [id]
    );

    const results: Array<{ itemId: string; code: string; ok: boolean; labelId?: string; error?: string }> = [];
    for (const item of iRes.rows) {
      try {
        const rendered = await renderOne(item.code, batch.target_id, false);
        await db.getPool().query(
          `UPDATE component_label_batch_items SET label_id = $1, updated_at = now() WHERE id = $2`,
          [rendered.labelId, item.id]
        );
        results.push({ itemId: item.id, code: item.code, ok: true, labelId: rendered.labelId });
      } catch (e) {
        results.push({ itemId: item.id, code: item.code, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({ success: true, rendered: results.filter((r) => r.ok).length, results });
  } catch (error) {
    console.error('❌ POST /api/component-label-batches/:id/render 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/print —— 批量打印(scope 未渲染的 item 会先自动渲染) ============
componentLabelBatchesApp.post('/:id/print', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { scope?: any; deviceId: string };
    if (!body.deviceId) return c.json({ success: false, error: 'deviceId 必填' }, 400);

    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM component_label_batches WHERE id = $1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const batch = bRes.rows[0];

    let items;
    if (body.scope && typeof body.scope === 'object' && Array.isArray(body.scope.itemIds)) {
      const r = await db.getPool().query(
        `SELECT * FROM component_label_batch_items WHERE batch_id = $1 AND id = ANY($2::uuid[]) ORDER BY idx ASC`,
        [id, body.scope.itemIds]
      );
      items = r.rows;
    } else {
      const r = await db.getPool().query(
        `SELECT * FROM component_label_batch_items WHERE batch_id = $1 ORDER BY idx ASC`,
        [id]
      );
      items = r.rows;
    }
    if (items.length === 0) return c.json({ success: true, printed: 0, results: [] });

    let resolved;
    try {
      resolved = await resolveDeviceAndSink(body.deviceId, batch.target_id);
    } catch (e) {
      return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }

    const results: Array<{ itemId: string; code: string; ok: boolean; httpStatus?: number; error?: string }> = [];
    for (const item of items) {
      const r = await printOneCode(item.code, resolved);
      if (r.ok) {
        await db.getPool().query(
          `UPDATE component_label_batch_items
              SET label_id = COALESCE($1, label_id), print_count = print_count + 1, last_printed_at = now(), updated_at = now()
            WHERE id = $2`,
          [r.labelId ?? null, item.id]
        );
      }
      results.push({ itemId: item.id, code: item.code, ok: r.ok, httpStatus: r.httpStatus, error: r.error });
    }

    const printed = results.filter((r) => r.ok).length;
    await db.getPool().query(
      `UPDATE component_label_batches SET status = 'printing', updated_at = now() WHERE id = $1`,
      [id]
    );
    return c.json({ success: true, printed, results });
  } catch (error) {
    console.error('❌ POST /api/component-label-batches/:id/print 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

export default componentLabelBatchesApp;
