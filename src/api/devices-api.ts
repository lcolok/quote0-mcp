import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';

const app = new Hono();
const postgres = getPostgresDatabase();

// GET /api/devices — 列出全部（含 disabled），token 脱敏
app.get('/api/devices', async (c) => {
  try {
    const rows = await postgres.getAllPushDevices();
    const data = rows.map((d: any) => ({ ...d, token: d.token ? '****' : '' }));
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /api/devices — 新建
app.post('/api/devices', async (c) => {
  try {
    const b = await c.req.json();
    if (!b.id || !b.name || !b.base_url || !b.width || !b.height) {
      return c.json({ success: false, error: 'id/name/base_url/width/height 必填' }, 400);
    }
    const row = await postgres.createPushDevice(b);
    return c.json({ success: true, data: { ...row, token: row.token ? '****' : '' } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// PATCH /api/devices/:id — 更新（token 传空字符串视为不改）
app.patch('/api/devices/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const b = await c.req.json();
    if (b.token === '' || b.token === undefined) delete b.token;
    const row = await postgres.updatePushDevice(id, b);
    if (!row) return c.json({ success: false, error: '设备不存在' }, 404);
    return c.json({ success: true, data: { ...row, token: row.token ? '****' : '' } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// DELETE /api/devices/:id
app.delete('/api/devices/:id', async (c) => {
  try {
    await postgres.deletePushDevice(c.req.param('id'));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export { app as devicesApp };
