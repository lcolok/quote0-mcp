/**
 * Inventory API - 内容素材库管理
 */

import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';

const app = new Hono();
const postgres = getPostgresDatabase();

// GET /api/inventory - 列表
app.get('/api/inventory', async (c) => {
  try {
    const state = c.req.query('state');
    const source = c.req.query('source');
    const sortBy = c.req.query('sort_by') || 'created_at';
    const limit = Math.max(1, Math.min(Number.isNaN(parseInt(c.req.query('limit') || '50', 10)) ? 50 : parseInt(c.req.query('limit') || '50', 10), 500));
    const offset = Math.max(0, Number.isNaN(parseInt(c.req.query('offset') || '0', 10)) ? 0 : parseInt(c.req.query('offset') || '0', 10));

    const allowedSort = ['created_at', 'last_pushed_at', 'replay_count'];
    const orderBy = allowedSort.includes(sortBy) ? sortBy : 'created_at';

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (state) {
      params.push(state);
      where += ` AND state=$${params.length}`;
    }
    if (source) {
      params.push(source);
      where += ` AND source=$${params.length}`;
    }

    const countResult = await postgres.query(
      `SELECT COUNT(*) FROM content_inventory ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await postgres.query(
      `SELECT * FROM content_inventory ${where} ORDER BY ${orderBy} DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return c.json({
      success: true,
      data: dataResult.rows,
      pagination: { total, limit, offset, hasMore: offset + limit < total }
    });
  } catch (error) {
    console.error('获取素材库列表失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// GET /api/inventory/stats - 统计
app.get('/api/inventory/stats', async (c) => {
  try {
    const stateResult = await postgres.query(`
      SELECT state, COUNT(*) as count FROM content_inventory GROUP BY state ORDER BY state
    `);
    const sourceResult = await postgres.query(`
      SELECT source, COUNT(*) as count FROM content_inventory WHERE source IS NOT NULL GROUP BY source ORDER BY count DESC
    `);
    return c.json({
      success: true,
      data: {
        byState: stateResult.rows,
        bySource: sourceResult.rows
      }
    });
  } catch (error) {
    console.error('获取素材库统计失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// GET /api/inventory/:id - 详情
app.get('/api/inventory/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (Number.isNaN(id)) {
      return c.json({ success: false, error: '无效ID' }, 400);
    }
    const result = await postgres.query('SELECT * FROM content_inventory WHERE id=$1', [id]);
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '素材不存在' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('获取素材详情失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// DELETE /api/inventory/:id - 删除
app.delete('/api/inventory/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (Number.isNaN(id)) {
      return c.json({ success: false, error: '无效ID' }, 400);
    }
    await postgres.query('DELETE FROM content_inventory WHERE id=$1', [id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('删除素材失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// PATCH /api/inventory/:id/state - 手动改状态
app.patch('/api/inventory/:id/state', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (Number.isNaN(id)) {
      return c.json({ success: false, error: '无效ID' }, 400);
    }
    const body = await c.req.json<{ state: string }>();
    if (!body.state || !['ready', 'pushed', 'expired'].includes(body.state)) {
      return c.json({ success: false, error: 'state 必须是 ready/pushed/expired 之一' }, 400);
    }
    await postgres.query('UPDATE content_inventory SET state=$1 WHERE id=$2', [body.state, id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('更新素材状态失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// PATCH /api/inventory/:id/expire - 标记 expired
app.patch('/api/inventory/:id/expire', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (Number.isNaN(id)) {
      return c.json({ success: false, error: '无效ID' }, 400);
    }
    await postgres.query("UPDATE content_inventory SET state='expired' WHERE id=$1", [id]);
    return c.json({ success: true });
  } catch (error) {
    console.error('标记素材过期失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// POST /api/inventory/cleanup-expired - 手动清理 expired
app.post('/api/inventory/cleanup-expired', async (c) => {
  try {
    const result = await postgres.query("DELETE FROM content_inventory WHERE state='expired'");
    return c.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error) {
    console.error('清理过期素材失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

export default app;
