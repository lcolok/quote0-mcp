import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { getEinkStatus, type EinkDevice } from './eink-converter.js';

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

// GET /api/devices/:id/status — 读取设备运行时规格（EPD1 /status），不返回 token
app.get('/api/devices/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const device: any = await postgres.getPushDeviceById(id);
    if (!device) return c.json({ success: false, error: '设备不存在' }, 404);
    if (device.kind !== 'eink-local') {
      return c.json({ success: false, error: '只有本地墨水屏支持运行时规格探测' }, 400);
    }

    const runtimeDevice: EinkDevice = {
      id: device.id,
      name: device.name,
      baseUrl: device.base_url,
      token: device.token,
      width: device.width,
      height: device.height,
      wireProtocol: device.wire_protocol,
      colorMode: device.color_mode,
      planeCount: device.plane_count,
    };
    const runtime = await getEinkStatus(runtimeDevice);
    return c.json({
      success: true,
      data: {
        configured: { width: device.width, height: device.height, wireProtocol: device.wire_protocol },
        runtime,
        effective: {
          width: runtime.width ?? device.width,
          height: runtime.height ?? device.height,
          planeCount: runtime.planeCount ?? device.plane_count,
          planeBytes: runtime.planeBytes ?? Math.ceil((runtime.width ?? device.width) / 8) * (runtime.height ?? device.height),
        },
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: `读取设备运行时规格失败: ${e?.message || String(e)}` }, 502);
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
