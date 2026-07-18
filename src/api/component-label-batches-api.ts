// 元器件编号标签「批次管理」层 —— 对齐 label-batches-api.ts(盲盒 LLM 批次)给用户的批量录入/
// 进度查看/批量打印体验，但生成路径走 component-labels-api.ts 的确定性 widget 渲染(无 LLM/job 队列)。
// 依旧刻意与元件元数据解耦：条目只存 widget_id+props(渲染用) + code_key(幂等键)，不存型号/厂商/
// 封装以外的元件元数据。
//
// 2026-07-19 硬化重构（原先按"code 字符串 JOIN 全局 component_bindings 表"实现配对打印，
// 是个 workaround；批次条目结构也只认 code 字符串，装不了纯 component-value 条目）：
//   - 条目泛化为 widget_id+props，跟单条渲染层 renderGeneric(codeKey,widgetId,props,...) 同构，
//     直接调用 renderGeneric/printGeneric，不用为每种 widget 各写一份逻辑。
//   - 配对关系(料号+数值封装一起打印)用 pair_item_id 自引用表达，是批次内部显式关系，
//     不再依赖"按 code 字符串查全局表"这种脆弱旁路；不同批次可以有各自独立的配对，互不影响。
//   - 打印统计不在这里存，单一数据源是 labels 表(经 label_id 关联查)——之前 labels/
//     component_labels/批次条目三处各记一遍打印次数，理论上会漂移。
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  normalizeCode,
  valuePackageKey,
  renderGeneric,
  resolveDeviceAndSink,
  printGeneric,
  DEFAULT_TARGET_ID,
} from './component-labels-api.js';

const componentLabelBatchesApp = new Hono();

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

// ============ POST / —— 创建批次(批量录入编号，可选顺带绑定数值+封装) ============
componentLabelBatchesApp.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      targetId?: string;
      codes?: string[]; // 向后兼容：纯料号数组
      items?: Array<{ code?: string; value?: string; package?: string }>; // 通用形式，可混合料号/数值封装/两者配对
    }>();
    if (!body.name || !body.name.trim()) return c.json({ success: false, error: 'name 必填' }, 400);

    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    const rawItems: Array<{ code?: string; value?: string; package?: string }> = [
      ...(Array.isArray(body.codes) ? body.codes.map((code) => ({ code })) : []),
      ...(Array.isArray(body.items) ? body.items : []),
    ];
    if (rawItems.length === 0) return c.json({ success: false, error: 'codes 或 items 不能为空' }, 400);

    const db = getPostgresDatabase();
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const bRes = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO component_label_batches (name, target_id) VALUES ($1, $2) RETURNING id, created_at`,
        [body.name.trim().slice(0, 200), targetId]
      );
      const batchId = bRes.rows[0].id;

      let idx = 0;
      let count = 0;
      for (const raw of rawItems) {
        const hasCode = !!(raw.code && raw.code.trim());
        const hasValue = !!(raw.value && raw.value.trim() && raw.package && raw.package.trim());
        if (!hasCode && !hasValue) continue;

        let codeItemId: string | null = null;
        if (hasCode) {
          const code = normalizeCode(raw.code!);
          const r = await client.query<{ id: string }>(
            `INSERT INTO component_label_batch_items (batch_id, idx, widget_id, code_key, props)
             VALUES ($1, $2, 'component-code', $3, $4::jsonb) RETURNING id`,
            [batchId, idx++, code, JSON.stringify({ code })]
          );
          codeItemId = r.rows[0].id;
          count++;
        }
        if (hasValue) {
          const codeKey = valuePackageKey(raw.value!, raw.package!);
          const vRes = await client.query<{ id: string }>(
            `INSERT INTO component_label_batch_items (batch_id, idx, widget_id, code_key, props, pair_item_id)
             VALUES ($1, $2, 'component-value', $3, $4::jsonb, $5) RETURNING id`,
            [batchId, idx++, codeKey, JSON.stringify({ value: raw.value, package: raw.package }), codeItemId]
          );
          count++;
          if (codeItemId) {
            await client.query(`UPDATE component_label_batch_items SET pair_item_id = $1 WHERE id = $2`, [vRes.rows[0].id, codeItemId]);
          }
        }
      }
      await client.query('COMMIT');
      return c.json({ success: true, id: batchId, createdAt: bRes.rows[0].created_at, count }, 201);
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
             count(i.*) FILTER (WHERE l.print_count > 0) AS printed
        FROM component_label_batches b
        LEFT JOIN component_label_batch_items i ON i.batch_id = b.id
        LEFT JOIN labels l ON l.id = i.label_id
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

// ============ GET /:id —— 批次详情(每个 item 的渲染/打印状态 + 配对的数值封装) ============
// 只返回"主"条目(component-code，或没有配对的独立 component-value 条目)；已配对的
// component-value 条目通过主条目的 binding 字段内嵌展示，不单独出现在列表里。
componentLabelBatchesApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM component_label_batches WHERE id = $1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);

    const iRes = await db.getPool().query(
      `SELECT i.*, l.png_path, l.status AS label_status, l.print_count, l.print_history,
              pi.widget_id AS pair_widget_id, pi.props AS pair_props
         FROM component_label_batch_items i
         LEFT JOIN labels l ON l.id = i.label_id
         LEFT JOIN component_label_batch_items pi ON pi.id = i.pair_item_id
        WHERE i.batch_id = $1
        ORDER BY i.idx ASC`,
      [id]
    );
    const items = iRes.rows
      .filter((row) => !(row.widget_id === 'component-value' && row.pair_item_id))
      .map((row) => {
        const lastPrinted = Array.isArray(row.print_history) && row.print_history.length > 0
          ? row.print_history[row.print_history.length - 1]?.printed_at ?? null
          : null;
        return {
          id: row.id,
          idx: row.idx,
          widgetId: row.widget_id,
          code: row.code_key,
          labelId: row.label_id,
          pngUrl: pngUrlOf(row.png_path),
          labelStatus: row.label_status,
          printCount: row.print_count ?? 0,
          lastPrintedAt: lastPrinted,
          binding: row.pair_widget_id === 'component-value'
            ? { value: row.pair_props?.value, package: row.pair_props?.package }
            : null,
        };
      });
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

// ============ POST /:id/items/:itemId/pair —— 给条目建/改「数值+封装」配对 ============
componentLabelBatchesApp.post('/:id/items/:itemId/pair', async (c) => {
  try {
    const id = c.req.param('id');
    const itemId = c.req.param('itemId');
    const body = await c.req.json<{ value: string; package: string }>();
    if (!body.value?.trim() || !body.package?.trim()) {
      return c.json({ success: false, error: 'value/package 都必填' }, 400);
    }

    const db = getPostgresDatabase();
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const itemRes = await client.query(
        `SELECT * FROM component_label_batch_items WHERE id = $1 AND batch_id = $2`,
        [itemId, id]
      );
      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({ success: false, error: '条目不存在' }, 404);
      }
      const item = itemRes.rows[0];
      const codeKey = valuePackageKey(body.value, body.package);
      const props = JSON.stringify({ value: body.value, package: body.package });

      if (item.pair_item_id) {
        // 已有配对：更新配对条目内容，清掉旧 label_id 逼下次打印重新渲染
        await client.query(
          `UPDATE component_label_batch_items
              SET code_key = $1, props = $2::jsonb, label_id = NULL, updated_at = now()
            WHERE id = $3`,
          [codeKey, props, item.pair_item_id]
        );
      } else {
        const idxRes = await client.query(
          `SELECT COALESCE(MAX(idx), -1) + 1 AS next_idx FROM component_label_batch_items WHERE batch_id = $1`,
          [id]
        );
        const nextIdx = idxRes.rows[0].next_idx;
        const pairRes = await client.query<{ id: string }>(
          `INSERT INTO component_label_batch_items (batch_id, idx, widget_id, code_key, props, pair_item_id)
           VALUES ($1, $2, 'component-value', $3, $4::jsonb, $5) RETURNING id`,
          [id, nextIdx, codeKey, props, itemId]
        );
        await client.query(`UPDATE component_label_batch_items SET pair_item_id = $1 WHERE id = $2`, [pairRes.rows[0].id, itemId]);
      }
      await client.query('COMMIT');
      return c.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/component-label-batches/:id/items/:itemId/pair 失败:', error);
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
        const rendered = await renderGeneric(item.code_key, item.widget_id, item.props, batch.target_id, false);
        await db.getPool().query(
          `UPDATE component_label_batch_items SET label_id = $1, updated_at = now() WHERE id = $2`,
          [rendered.labelId, item.id]
        );
        results.push({ itemId: item.id, code: item.code_key, ok: true, labelId: rendered.labelId });
      } catch (e) {
        results.push({ itemId: item.id, code: item.code_key, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({ success: true, rendered: results.filter((r) => r.ok).length, results });
  } catch (error) {
    console.error('❌ POST /api/component-label-batches/:id/render 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/print —— 批量打印(scope 未渲染的 item 会先自动渲染) ============
// 选中的条目如果有配对(pair_item_id)，配对条目会自动一起补进打印列表——不用调用方
// 手动同时勾两个 id，天然实现"一起打印，然后一起贴"。
componentLabelBatchesApp.post('/:id/print', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { scope?: any; deviceId: string };
    if (!body.deviceId) return c.json({ success: false, error: 'deviceId 必填' }, 400);

    const db = getPostgresDatabase();
    const bRes = await db.getPool().query(`SELECT * FROM component_label_batches WHERE id = $1`, [id]);
    if (bRes.rows.length === 0) return c.json({ success: false, error: '批次不存在' }, 404);
    const batch = bRes.rows[0];

    let scopedItems;
    if (body.scope && typeof body.scope === 'object' && Array.isArray(body.scope.itemIds)) {
      const r = await db.getPool().query(
        `SELECT * FROM component_label_batch_items WHERE batch_id = $1 AND id = ANY($2::uuid[]) ORDER BY idx ASC`,
        [id, body.scope.itemIds]
      );
      scopedItems = r.rows;
    } else {
      const r = await db.getPool().query(`SELECT * FROM component_label_batch_items WHERE batch_id = $1 ORDER BY idx ASC`, [id]);
      scopedItems = r.rows;
    }
    if (scopedItems.length === 0) return c.json({ success: true, printed: 0, results: [] });

    // 补全配对条目(选中了料号条目，配对的数值封装条目没被显式选中也要一起打印)
    const byId = new Map<string, any>(scopedItems.map((it: any) => [it.id, it]));
    const missingPairIds = scopedItems
      .map((it: any) => it.pair_item_id)
      .filter((pid: string | null) => pid && !byId.has(pid));
    if (missingPairIds.length > 0) {
      const pr = await db.getPool().query(`SELECT * FROM component_label_batch_items WHERE id = ANY($1::uuid[])`, [missingPairIds]);
      for (const row of pr.rows) byId.set(row.id, row);
    }
    const printItems = Array.from(byId.values());

    let resolved;
    try {
      resolved = await resolveDeviceAndSink(body.deviceId, batch.target_id);
    } catch (e) {
      return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }

    const results: Array<{ itemId: string; code: string; widgetId: string; ok: boolean; httpStatus?: number; error?: string }> = [];
    for (const item of printItems) {
      const r = await printGeneric(item.code_key, item.widget_id, item.props, resolved);
      if (r.ok && r.labelId && r.labelId !== item.label_id) {
        await db.getPool().query(
          `UPDATE component_label_batch_items SET label_id = $1, updated_at = now() WHERE id = $2`,
          [r.labelId, item.id]
        );
      }
      results.push({ itemId: item.id, code: item.code_key, widgetId: item.widget_id, ok: r.ok, httpStatus: r.httpStatus, error: r.error });
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
