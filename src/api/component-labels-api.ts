// 元器件编号标签 API —— 与 labels-api.ts/label-batches-api.ts(LLM 图片批次)完全解耦。
// 设计原则：本项目只负责"给一个编号字符串 → 渲染+打印一张标签"，不存储任何元件元数据
// （型号/厂商/封装/库存等留在外部料号管理系统），component_labels 表只是渲染+打印的幂等索引。
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { BUILTIN_TARGETS, LABEL_T20X8_TARGET } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';
import { getSinkForKind, deviceKindMatchesTarget, type PushDeviceRow } from './output-sinks.js';

const componentLabelsApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';
const DEFAULT_TARGET_ID = 'label-T20x8-160';
const DEFAULT_FONT_FAMILY = 'saira-extra-condensed';

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 40);
}

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

interface RenderOneResult {
  code: string;
  labelId: string;
  pngUrl: string | null;
  cached: boolean;
}

/** 渲染或复用缓存：component_labels.code 是幂等键，同一编号默认不重复渲染 */
async function renderOne(code: string, targetId: string, force: boolean): Promise<RenderOneResult> {
  const db = getPostgresDatabase();
  const target = BUILTIN_TARGETS.find((t) => t.id === targetId) ?? LABEL_T20X8_TARGET;

  if (!force) {
    const existing = await db.getPool().query(
      `SELECT cl.label_id, l.png_path
         FROM component_labels cl
         LEFT JOIN labels l ON l.id = cl.label_id
        WHERE cl.code = $1 AND cl.target_id = $2 AND l.status != 'archived'`,
      [code, target.id]
    );
    if (existing.rows.length > 0 && existing.rows[0].label_id) {
      return { code, labelId: existing.rows[0].label_id, pngUrl: pngUrlOf(existing.rows[0].png_path), cached: true };
    }
  }

  const { pngBuffer } = await textLabelGenerator.rerenderWidget(
    'component-code',
    { code },
    DEFAULT_FONT_FAMILY,
    target
  );

  const insertRes = await db.getPool().query<{ id: string }>(
    `INSERT INTO labels (prompt, svg, target_id, source_type, status, widget_props, font_family, tags)
     VALUES ($1, '', $2, 'widget', 'approved', $3::jsonb, $4, $5) RETURNING id`,
    [`component-code:${code}`, target.id, JSON.stringify({ code }), DEFAULT_FONT_FAMILY, ['component-code']]
  );
  const labelId = insertRes.rows[0].id;
  const pngPath = `labels/${labelId}.png`;
  await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, pngBuffer, pngBuffer.length, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  });
  await db.getPool().query(`UPDATE labels SET png_path = $1 WHERE id = $2`, [pngPath, labelId]);

  await db.getPool().query(
    `INSERT INTO component_labels (code, target_id, label_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (code, target_id) DO UPDATE SET label_id = EXCLUDED.label_id, updated_at = now()`,
    [code, target.id, labelId]
  );

  return { code, labelId, pngUrl: pngUrlOf(pngPath), cached: false };
}

// ============ POST /render —— 批量渲染(幂等，默认复用已渲染过的编号) ============
componentLabelsApp.post('/render', async (c) => {
  try {
    const body = await c.req.json<{ codes: string[]; targetId?: string; force?: boolean }>();
    if (!Array.isArray(body.codes) || body.codes.length === 0) {
      return c.json({ success: false, error: 'codes 不能为空' }, 400);
    }
    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    const codes = Array.from(new Set(body.codes.map(normalizeCode).filter(Boolean)));

    const results: Array<RenderOneResult | { code: string; error: string }> = [];
    for (const code of codes) {
      try {
        results.push(await renderOne(code, targetId, body.force ?? false));
      } catch (e) {
        results.push({ code, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({ success: true, results });
  } catch (error) {
    console.error('❌ POST /api/component-labels/render 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /print —— 按编号批量打印(编号未渲染过会先自动渲染) ============
componentLabelsApp.post('/print', async (c) => {
  try {
    const body = await c.req.json<{ codes: string[]; deviceId: string; targetId?: string }>();
    if (!Array.isArray(body.codes) || body.codes.length === 0) {
      return c.json({ success: false, error: 'codes 不能为空' }, 400);
    }
    if (!body.deviceId) return c.json({ success: false, error: 'deviceId 必填' }, 400);

    const db = getPostgresDatabase();
    const device = (await db.getPushDeviceById(body.deviceId)) as PushDeviceRow | null;
    if (!device) return c.json({ success: false, error: '设备不存在' }, 404);

    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    const target = BUILTIN_TARGETS.find((t) => t.id === targetId) ?? LABEL_T20X8_TARGET;
    if (!deviceKindMatchesTarget(device.kind, target.kind)) {
      return c.json({ success: false, error: `设备类型 ${device.kind} 与标签 kind=${target.kind} 不匹配` }, 400);
    }
    const sink = getSinkForKind(device.kind);
    if (!sink) return c.json({ success: false, error: `无 ${device.kind} 对应的输出通道` }, 400);

    const codes = Array.from(new Set(body.codes.map(normalizeCode).filter(Boolean)));
    const results: Array<{ code: string; ok: boolean; httpStatus?: number; error?: string }> = [];

    for (const code of codes) {
      try {
        const rendered = await renderOne(code, targetId, false);
        const pngObj = await imageStorage.getClient().getObject(
          MINIO_BUCKET,
          rendered.pngUrl!.replace('/api/minio-proxy/', '')
        );
        const chunks: Buffer[] = [];
        for await (const chunk of pngObj) chunks.push(chunk as Buffer);
        const pngBuffer = Buffer.concat(chunks);

        const sendResult = await sink.send(pngBuffer, device, target);
        if (!sendResult.ok) {
          results.push({ code, ok: false, httpStatus: sendResult.status, error: sendResult.error || '推送失败' });
          continue;
        }
        await db.getPool().query(
          `UPDATE labels SET status='printed', print_count=print_count+1,
              print_history = print_history || jsonb_build_object(
                'printed_at', now(), 'endpoint', $2::text, 'http_status', $3::int, 'bytes', $4::int),
              updated_at = now()
           WHERE id = $1`,
          [rendered.labelId, device.base_url || device.id, sendResult.status ?? null, pngBuffer.length]
        );
        await db.getPool().query(
          `UPDATE component_labels SET print_count = print_count + 1,
              print_history = print_history || jsonb_build_object('printed_at', now(), 'device_id', $2::text),
              updated_at = now()
           WHERE code = $1 AND target_id = $3`,
          [code, device.id, target.id]
        );
        results.push({ code, ok: true, httpStatus: sendResult.status });
      } catch (e) {
        results.push({ code, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const printed = results.filter((r) => r.ok).length;
    return c.json({ success: true, printed, results });
  } catch (error) {
    console.error('❌ POST /api/component-labels/print 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET /:code —— 单个编号状态查询 ============
componentLabelsApp.get('/:code', async (c) => {
  try {
    const code = normalizeCode(c.req.param('code'));
    const targetId = c.req.query('targetId') ?? DEFAULT_TARGET_ID;
    const db = getPostgresDatabase();
    const r = await db.getPool().query(
      `SELECT cl.*, l.png_path, l.status AS label_status
         FROM component_labels cl LEFT JOIN labels l ON l.id = cl.label_id
        WHERE cl.code = $1 AND cl.target_id = $2`,
      [code, targetId]
    );
    if (r.rows.length === 0) return c.json({ success: false, error: '该编号尚未渲染过' }, 404);
    const row = r.rows[0];
    return c.json({
      success: true,
      code: row.code,
      labelId: row.label_id,
      pngUrl: pngUrlOf(row.png_path),
      labelStatus: row.label_status,
      printCount: row.print_count,
      printHistory: row.print_history,
    });
  } catch (error) {
    console.error('❌ GET /api/component-labels/:code 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

export default componentLabelsApp;
