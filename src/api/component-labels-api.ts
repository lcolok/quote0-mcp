// 元器件编号标签 API —— 与 labels-api.ts/label-batches-api.ts(LLM 图片批次)完全解耦。
// 设计原则：本项目只负责"给一段标识字符串 → 渲染+打印一张标签"，不存储任何元件元数据
// （型号/厂商/封装/库存等留在外部料号管理系统），component_labels 表只是渲染+打印的幂等索引。
//
// 支持两种 widget：
//  - component-code：料号编号(如嘉立创 LCSC "C25168826")，codeKey 就是编号本身
//  - component-value：主参数+封装(如 "10kΩ"+"0603")，codeKey 是 `${value}[${package}]` 拼接串
//
// 2026-07-19：component_labels 加了 widget_id 列并入主键(code,target_id,widget_id)——
// 之前 code 命名空间在两种 widget 间共享，理论上存在撞键后返回错误 widget 渲染结果的风险
// (哪怕字符串巧合相同也不该混用)。现在同一个 code 字符串在不同 widget 下是完全独立的行，
// 结构上杜绝跨 widget 撞键，不再依赖"字符串凑巧不一样"这种脆弱假设。
//
// renderGeneric/renderOne/resolveDeviceAndSink/printOneCode 导出，供
// component-label-batches-api.ts（批量录入/进度管理层）复用，避免渲染+打印逻辑重复实现。
import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { BUILTIN_TARGETS, LABEL_T20X8_TARGET, type RenderTarget } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';
import { getSinkForKind, deviceKindMatchesTarget, type PushDeviceRow, type OutputSink } from './output-sinks.js';
import type { WidgetId } from '../react-widgets/core/label-widget-registry.js';

const componentLabelsApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';
export const DEFAULT_TARGET_ID = 'label-T20x8-160';
const DEFAULT_FONT_FAMILY = 'saira-extra-condensed';
const DEFAULT_WIDGET_ID: WidgetId = 'component-code';

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 40);
}

/** value/package 拼成幂等键，如 "10KΩ[0603]"。跟 normalizeCode 一样统一转大写、限长 */
export function valuePackageKey(value: string, pkg: string): string {
  return normalizeCode(`${value}[${pkg}]`);
}

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

export interface RenderOneResult {
  code: string;
  widgetId: WidgetId;
  labelId: string;
  pngUrl: string | null;
  cached: boolean;
}

/**
 * 渲染或复用缓存：component_labels.(code,target_id,widget_id) 是幂等键，widget_id 参与主键
 * 保证不同 widget 之间即使 codeKey 字符串巧合相同也不会互相覆盖/读到对方的渲染结果。
 */
export async function renderGeneric(
  codeKey: string,
  widgetId: WidgetId,
  props: Record<string, any>,
  targetId: string,
  force: boolean
): Promise<RenderOneResult> {
  const db = getPostgresDatabase();
  const target = BUILTIN_TARGETS.find((t) => t.id === targetId) ?? LABEL_T20X8_TARGET;

  if (!force) {
    const existing = await db.getPool().query(
      `SELECT cl.label_id, l.png_path
         FROM component_labels cl
         LEFT JOIN labels l ON l.id = cl.label_id
        WHERE cl.code = $1 AND cl.target_id = $2 AND cl.widget_id = $3 AND l.status != 'archived'`,
      [codeKey, target.id, widgetId]
    );
    if (existing.rows.length > 0 && existing.rows[0].label_id) {
      return { code: codeKey, widgetId, labelId: existing.rows[0].label_id, pngUrl: pngUrlOf(existing.rows[0].png_path), cached: true };
    }
  }

  const { pngBuffer } = await textLabelGenerator.rerenderWidget(widgetId, props, DEFAULT_FONT_FAMILY, target);

  const insertRes = await db.getPool().query<{ id: string }>(
    `INSERT INTO labels (prompt, svg, target_id, source_type, status, widget_props, font_family, tags)
     VALUES ($1, '', $2, 'widget', 'approved', $3::jsonb, $4, $5) RETURNING id`,
    [`${widgetId}:${codeKey}`, target.id, JSON.stringify(props), DEFAULT_FONT_FAMILY, [widgetId]]
  );
  const labelId = insertRes.rows[0].id;
  const pngPath = `labels/${labelId}.png`;
  await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, pngBuffer, pngBuffer.length, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  });
  await db.getPool().query(`UPDATE labels SET png_path = $1 WHERE id = $2`, [pngPath, labelId]);

  await db.getPool().query(
    `INSERT INTO component_labels (code, target_id, widget_id, label_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code, target_id, widget_id) DO UPDATE SET label_id = EXCLUDED.label_id, updated_at = now()`,
    [codeKey, target.id, widgetId, labelId]
  );

  return { code: codeKey, widgetId, labelId, pngUrl: pngUrlOf(pngPath), cached: false };
}

/** component-code widget 的便捷封装，向后兼容旧调用方(component-label-batches-api.ts) */
export async function renderOne(code: string, targetId: string, force: boolean): Promise<RenderOneResult> {
  return renderGeneric(code, 'component-code', { code }, targetId, force);
}

/** component-value widget 的便捷封装：value+package → 拼接幂等键 */
export async function renderValuePackage(
  value: string,
  pkg: string,
  targetId: string,
  force: boolean
): Promise<RenderOneResult> {
  return renderGeneric(valuePackageKey(value, pkg), 'component-value', { value, package: pkg }, targetId, force);
}

export interface ResolvedDevice {
  device: PushDeviceRow;
  target: RenderTarget;
  sink: OutputSink;
}

/** 校验 deviceId + targetId 能不能配对打印，返回复用给多次 printOneCode 调用的上下文 */
export async function resolveDeviceAndSink(deviceId: string, targetId: string): Promise<ResolvedDevice> {
  const db = getPostgresDatabase();
  const device = (await db.getPushDeviceById(deviceId)) as PushDeviceRow | null;
  if (!device) throw new Error('设备不存在');

  const target = BUILTIN_TARGETS.find((t) => t.id === targetId) ?? LABEL_T20X8_TARGET;
  if (!deviceKindMatchesTarget(device.kind, target.kind)) {
    throw new Error(`设备类型 ${device.kind} 与标签 kind=${target.kind} 不匹配`);
  }
  const sink = getSinkForKind(device.kind);
  if (!sink) throw new Error(`无 ${device.kind} 对应的输出通道`);
  return { device, target, sink };
}

export interface PrintOneResult {
  code: string;
  ok: boolean;
  labelId?: string;
  httpStatus?: number;
  error?: string;
}

/** 打印一个已渲染(或即将渲染)结果 + 写回 labels/component_labels 的打印统计(带 widget_id 精确匹配) */
async function printRendered(rendered: RenderOneResult, resolved: ResolvedDevice): Promise<PrintOneResult> {
  const { device, target, sink } = resolved;
  const db = getPostgresDatabase();
  try {
    const pngObj = await imageStorage.getClient().getObject(
      MINIO_BUCKET,
      rendered.pngUrl!.replace('/api/minio-proxy/', '')
    );
    const chunks: Buffer[] = [];
    for await (const chunk of pngObj) chunks.push(chunk as Buffer);
    const pngBuffer = Buffer.concat(chunks);

    const sendResult = await sink.send(pngBuffer, device, target);
    if (!sendResult.ok) {
      return { code: rendered.code, ok: false, labelId: rendered.labelId, httpStatus: sendResult.status, error: sendResult.error || '推送失败' };
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
       WHERE code = $1 AND target_id = $3 AND widget_id = $4`,
      [rendered.code, device.id, target.id, rendered.widgetId]
    );
    return { code: rendered.code, ok: true, labelId: rendered.labelId, httpStatus: sendResult.status };
  } catch (e) {
    return { code: rendered.code, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 打印单个编号(component-code widget，未渲染过会先自动渲染)，向后兼容旧调用方 */
export async function printOneCode(code: string, resolved: ResolvedDevice): Promise<PrintOneResult> {
  try {
    const rendered = await renderOne(code, resolved.target.id, false);
    return await printRendered(rendered, resolved);
  } catch (e) {
    return { code, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 打印单个 value/package(component-value widget，未渲染过会先自动渲染) */
export async function printOneValuePackage(value: string, pkg: string, resolved: ResolvedDevice): Promise<PrintOneResult> {
  const codeKey = valuePackageKey(value, pkg);
  try {
    const rendered = await renderValuePackage(value, pkg, resolved.target.id, false);
    return await printRendered(rendered, resolved);
  } catch (e) {
    return { code: codeKey, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============ POST /render —— 批量渲染(幂等，默认复用已渲染过的编号) ============
componentLabelsApp.post('/render', async (c) => {
  try {
    const body = await c.req.json<{
      codes?: string[];
      values?: Array<{ value: string; package: string }>;
      targetId?: string;
      force?: boolean;
    }>();
    const hasCodes = Array.isArray(body.codes) && body.codes.length > 0;
    const hasValues = Array.isArray(body.values) && body.values.length > 0;
    if (!hasCodes && !hasValues) {
      return c.json({ success: false, error: 'codes 或 values 至少填一个' }, 400);
    }
    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    const force = body.force ?? false;

    const results: Array<RenderOneResult | { code: string; error: string }> = [];
    if (hasCodes) {
      const codes = Array.from(new Set(body.codes!.map(normalizeCode).filter(Boolean)));
      for (const code of codes) {
        try {
          results.push(await renderOne(code, targetId, force));
        } catch (e) {
          results.push({ code, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    if (hasValues) {
      for (const item of body.values!) {
        const codeKey = valuePackageKey(item.value ?? '', item.package ?? '');
        try {
          results.push(await renderValuePackage(item.value, item.package, targetId, force));
        } catch (e) {
          results.push({ code: codeKey, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return c.json({ success: true, results });
  } catch (error) {
    console.error('❌ POST /api/component-labels/render 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /print —— 批量打印(未渲染过会先自动渲染) ============
componentLabelsApp.post('/print', async (c) => {
  try {
    const body = await c.req.json<{
      codes?: string[];
      values?: Array<{ value: string; package: string }>;
      deviceId: string;
      targetId?: string;
    }>();
    const hasCodes = Array.isArray(body.codes) && body.codes.length > 0;
    const hasValues = Array.isArray(body.values) && body.values.length > 0;
    if (!hasCodes && !hasValues) {
      return c.json({ success: false, error: 'codes 或 values 至少填一个' }, 400);
    }
    if (!body.deviceId) return c.json({ success: false, error: 'deviceId 必填' }, 400);

    const targetId = body.targetId ?? DEFAULT_TARGET_ID;
    let resolved: ResolvedDevice;
    try {
      resolved = await resolveDeviceAndSink(body.deviceId, targetId);
    } catch (e) {
      return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }

    const results: PrintOneResult[] = [];
    if (hasCodes) {
      const codes = Array.from(new Set(body.codes!.map(normalizeCode).filter(Boolean)));
      for (const code of codes) {
        results.push(await printOneCode(code, resolved));
      }
    }
    if (hasValues) {
      for (const item of body.values!) {
        results.push(await printOneValuePackage(item.value, item.package, resolved));
      }
    }

    const printed = results.filter((r) => r.ok).length;
    return c.json({ success: true, printed, results });
  } catch (error) {
    console.error('❌ POST /api/component-labels/print 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET /:code —— 单个编号状态查询(widgetId 可选，默认 component-code) ============
componentLabelsApp.get('/:code', async (c) => {
  try {
    const code = normalizeCode(c.req.param('code'));
    const targetId = c.req.query('targetId') ?? DEFAULT_TARGET_ID;
    const widgetId = (c.req.query('widgetId') as WidgetId) ?? DEFAULT_WIDGET_ID;
    const db = getPostgresDatabase();
    const r = await db.getPool().query(
      `SELECT cl.*, l.png_path, l.status AS label_status
         FROM component_labels cl LEFT JOIN labels l ON l.id = cl.label_id
        WHERE cl.code = $1 AND cl.target_id = $2 AND cl.widget_id = $3`,
      [code, targetId, widgetId]
    );
    if (r.rows.length === 0) return c.json({ success: false, error: '该编号尚未渲染过' }, 404);
    const row = r.rows[0];
    return c.json({
      success: true,
      code: row.code,
      widgetId: row.widget_id,
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
