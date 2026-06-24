import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import type { ActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { llmLabelGenerator } from '../react-widgets/services/llm-label-generator.js';
import { imageLabelGenerator } from '../react-widgets/services/image-label-generator.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { listWidgets, SUPPORTED_FONTS, getWidget } from '../react-widgets/core/label-widget-registry.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import { isDitherAlgorithm, DEFAULT_DITHER, DITHER_ALGORITHMS, type DitherAlgorithm } from '../react-widgets/core/dither-algorithms.js';
import { niimbotPush } from '../react-widgets/core/niimbot-push-module.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET, type RenderTarget } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';
import { niimbotClient } from '../react-widgets/services/niimbot-client.js';
import { deriveTargetForDevice, dpiForDeviceType, modelNameForDeviceType } from '../react-widgets/core/device-dpi.js';
import { createTurn, createStandaloneSession } from '../react-widgets/core/label-session-store.js';

const labelsApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

/**
 * 把 DB row (snake_case) 转成 API 输出 (camelCase)，与 label-web 前端 type 对齐。
 * print_history jsonb 数组内字段也要 transform：
 *   DB 写入 key 是 printed_at / endpoint / http_status / bytes
 *   前端 type 是  printedAt  / niimbotEndpoint / httpStatus / bytes
 */
function rowToLabel(row: any): any {
  return {
    id: row.id,
    prompt: row.prompt,
    svg: row.svg,
    pngPath: row.png_path,
    pngUrl: row.png_path ? `/api/minio-proxy/${row.png_path}` : null,
    binBytes: row.bin_bytes,
    targetId: row.target_id,
    llmModel: row.llm_model,
    llmLatencyMs: row.llm_latency_ms,
    status: row.status,
    printCount: row.print_count ?? 0,
    printHistory: Array.isArray(row.print_history)
      ? row.print_history.map((p: any) => ({
          printedAt: p.printed_at ?? p.printedAt,
          niimbotEndpoint: p.endpoint ?? p.niimbotEndpoint,
          httpStatus: p.http_status ?? p.httpStatus,
          bytes: p.bytes,
        }))
      : [],
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type ?? 'svg',
    sourceModel: row.source_model ?? null,
    sourceImageUrl: row.source_image_url ?? null,
    lastError: row.last_error ?? null,
    widgetProps: row.widget_props ?? null,
    fontFamily: row.font_family ?? null,
    iconSvg: row.icon_svg ?? null,
    frameSvgPaths: row.frame_svg_paths ?? null,
    decoratorCode: row.decorator_code ?? null,
    parentRevisionId: row.parent_revision_id ?? null,
    ditherAlgorithm: row.dither_algorithm ?? 'threshold',
  };
}

// POST /generate
labelsApp.post('/generate', async (c) => {
  try {
    const body = await c.req.json<{
      prompt: string;
      targetId?: string;
      tags?: string[];
    }>();
    if (!body.prompt || body.prompt.trim() === '') {
      return c.json({ success: false, error: 'prompt 必填' }, 400);
    }

    const target =
      BUILTIN_TARGETS.find((t) => t.id === (body.targetId ?? 'label-T40x20-320')) ??
      LABEL_T40X20_TARGET;

    const db = getPostgresDatabase();
    const llmCfg = await getActiveLLMConfig(db);

    const result = await llmLabelGenerator.generate(body.prompt, target, llmCfg);

    // 插 DB 拿 id
    const insertResult = await db.getPool().query<{ id: string; created_at: Date }>(
      `INSERT INTO labels (prompt, svg, target_id, llm_model, llm_latency_ms, bin_bytes, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        body.prompt,
        result.svg,
        target.id,
        result.llmModel,
        result.llmLatencyMs,
        result.bitmapBuffer.length,
        body.tags ?? [],
      ]
    );
    const labelId = insertResult.rows[0].id;

    // 上传 PNG 到 MinIO
    const pngPath = `labels/${labelId}.png`;
    await imageStorage
      .getClient()
      .putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });

    // 更新 DB png_path
    await db.getPool().query(`UPDATE labels SET png_path = $1 WHERE id = $2`, [
      pngPath,
      labelId,
    ]);

    return c.json(
      {
        success: true,
        id: labelId,
        prompt: body.prompt,
        svg: result.svg,
        pngPath,
        pngUrl: `/api/minio-proxy/${pngPath}`,
        targetId: target.id,
        llmLatencyMs: result.llmLatencyMs,
        llmModel: result.llmModel,
        status: 'draft',
      },
      201
    );
  } catch (error) {
    console.error('❌ POST /api/labels/generate 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// POST /generate-image
labelsApp.post('/generate-image', async (c) => {
  try {
    const body = await c.req.json<{
      prompt: string;
      model: 'sd5' | 'sd5-3k' | 'nb2' | 'nbp' | 'gpt2';
      targetId?: string;
      tags?: string[];
      modelOptions?: Record<string, any>;
      clientRequestId?: string;
      presetId?: string;          // 'none' / preset uuid / undefined（兼容老前端）
      refImageUrls?: string[];    // MinIO ref 图 URL 数组
      ditherAlgorithm?: string;   // 13 种抖动算法之一，缺省/非法 → DEFAULT_DITHER
    }>();
    if (!body.prompt || body.prompt.trim() === '') {
      return c.json({ success: false, stage: 'validate', error: 'prompt 必填' }, 400);
    }
    if (!['sd5', 'sd5-3k', 'nb2', 'nbp', 'gpt2'].includes(body.model)) {
      return c.json({ success: false, stage: 'validate', error: `不支持的 model: ${body.model}` }, 400);
    }

    const ditherAlgorithm: DitherAlgorithm = isDitherAlgorithm(body.ditherAlgorithm)
      ? body.ditherAlgorithm
      : DEFAULT_DITHER;

    // 收敛到 session/turn 总账(docs/Label-Session-Editor-Spec.md):单条设计 = standalone session 的 root turn
    const sessionId = await createStandaloneSession();
    const result = await createTurn({
      sessionId,
      parentTurnId: null,
      turnKind: 'root',
      genMode: body.refImageUrls?.length ? 'img2img' : 'template',
      refImageUrls: body.refImageUrls ?? null,
      params: { model: body.model, presetId: body.presetId ?? null, targetId: body.targetId ?? null },
      effectivePrompt: body.prompt,
      clientRequestId: body.clientRequestId ?? null,
      enqueue: {
        jobType: 'image',
        payload: {
          prompt: body.prompt,
          model: body.model,
          modelOptions: body.modelOptions,
          targetId: body.targetId,
          tags: body.tags,
          presetId: body.presetId ?? undefined,
          refImageUrls: body.refImageUrls ?? [],
          ditherAlgorithm,
        },
      },
    });

    return c.json(
      {
        success: true,
        jobId: result.jobId,
        sessionId,
        turnId: result.turnId,
        state: result.jobState,
        createdAt: result.jobCreatedAt,
      },
      result.deduped ? 200 : 201
    );
  } catch (error) {
    console.error('❌ POST /api/labels/generate-image 失败:', error);
    return c.json({
      success: false,
      stage: 'unknown',
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// POST /:id/redither
labelsApp.post('/:id/redither', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { algorithm?: string };
    const algorithm: DitherAlgorithm = isDitherAlgorithm(body.algorithm)
      ? body.algorithm
      : DEFAULT_DITHER;

    const db = getPostgresDatabase();
    const labelRes = await db.getPool().query(
      `SELECT target_id, source_type, source_image_url FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const row = labelRes.rows[0];
    if (row.source_type !== 'image') {
      return c.json({ success: false, error: 'redither 仅支持 source_type=image 的标签' }, 400);
    }
    if (!row.source_image_url) {
      return c.json({ success: false, error: '该标签缺 source_image_url' }, 400);
    }

    const target = BUILTIN_TARGETS.find((t) => t.id === row.target_id) ?? LABEL_T40X20_TARGET;
    const { pngBuffer, bitmapBuffer } = await imageLabelGenerator.redither(
      row.source_image_url,
      target,
      algorithm
    );

    const pngPath = `labels/${id}.png`;
    await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, pngBuffer, pngBuffer.length, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    await db.getPool().query(
      `UPDATE labels SET png_path = $1, bin_bytes = $2, dither_algorithm = $3, updated_at = now() WHERE id = $4`,
      [pngPath, bitmapBuffer.length, algorithm, id]
    );

    return c.json({
      success: true,
      id,
      pngPath,
      pngUrl: `/api/minio-proxy/${pngPath}`,
      ditherAlgorithm: algorithm,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/redither 失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// POST /:id/preview-dither-batch — 批量生成各抖动算法的预览图（纯只读，不写 MinIO/DB）
labelsApp.post('/:id/preview-dither-batch', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      algorithms?: string[];
      maxWidth?: number;
    };

    // 入参校验与缺省
    const algorithms: DitherAlgorithm[] = Array.isArray(body.algorithms)
      ? body.algorithms.filter(isDitherAlgorithm)
      : [...DITHER_ALGORITHMS];
    if (algorithms.length === 0) {
      return c.json({ success: false, error: 'algorithms 为空或全部非法' }, 400);
    }
    const maxWidth = typeof body.maxWidth === 'number' && body.maxWidth > 0
      ? Math.round(body.maxWidth)
      : 192;

    const db = getPostgresDatabase();
    const labelRes = await db.getPool().query(
      `SELECT target_id, source_type, source_image_url FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const row = labelRes.rows[0];
    if (row.source_type !== 'image') {
      return c.json({ success: false, error: 'preview-dither-batch 仅支持 source_type=image 的标签' }, 400);
    }
    if (!row.source_image_url) {
      return c.json({ success: false, error: '该标签缺 source_image_url' }, 400);
    }

    // 取设备信息并按真实机型派生打印 target
    const dev = await niimbotClient.getDeviceInfo();
    const storedTarget = BUILTIN_TARGETS.find((t) => t.id === row.target_id) ?? LABEL_T40X20_TARGET;
    const printTarget = deriveTargetForDevice(storedTarget, dev?.deviceType);

    // 按 maxWidth 保持比例缩放到预览 target
    const previewW = Math.min(maxWidth, printTarget.widthPx);
    const previewH = Math.round(printTarget.heightPx * (previewW / printTarget.widthPx));
    const previewTarget: RenderTarget = {
      ...printTarget,
      widthPx: previewW,
      heightPx: previewH,
    };

    // 只 fetch 一次源图 buffer，避免每个算法都拉图
    const imgRes = await fetch(row.source_image_url, { signal: AbortSignal.timeout(60_000) });
    if (!imgRes.ok) {
      throw new Error(`下载 OSS 原图失败 HTTP ${imgRes.status} @ ${row.source_image_url}`);
    }
    const sourceBuffer = Buffer.from(await imgRes.arrayBuffer());

    // 并行生成所有算法的预览 PNG（只读，不写 MinIO/DB）
    const previewResults = await Promise.all(
      algorithms.map(async (algo) => {
        const pngBuffer = await imageLabelGenerator.ditherPreview(sourceBuffer, previewTarget, algo);
        return {
          algorithm: algo,
          pngBase64: pngBuffer.toString('base64'),
        };
      })
    );

    return c.json({
      success: true,
      target: {
        deviceType: dev?.deviceType ?? null,
        dpi: printTarget.dpi,
        modelName: modelNameForDeviceType(dev?.deviceType),
        printWidthPx: printTarget.widthPx,
        printHeightPx: printTarget.heightPx,
        previewWidthPx: previewW,
        previewHeightPx: previewH,
      },
      previews: previewResults,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/preview-dither-batch 失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// POST /:id/regen-decoration (不调 LLM，仅 re-run sandbox 代码 → 新装饰)
labelsApp.post('/:id/regen-decoration', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const labelRes = await db.getPool().query(
      `SELECT decorator_code, target_id, source_type, widget_props, font_family, icon_svg, prompt, source_model
       FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const row = labelRes.rows[0];
    if (row.source_type !== 'widget') {
      return c.json({ success: false, error: '仅 widget 类型 label 支持' }, 400);
    }
    if (!row.decorator_code) {
      return c.json({ success: false, error: '该标签无 decoratorCode（生成时未带装饰）' }, 400);
    }

    const target = BUILTIN_TARGETS.find((t) => t.id === row.target_id) ?? LABEL_T40X20_TARGET;

    // re-run sandbox
    const { executeDecorator, buildStandardContext } = await import('../react-widgets/core/decorator-sandbox.js');
    const ctx = buildStandardContext(target.widthPx, target.heightPx);
    let newFrames: string[];
    try {
      newFrames = executeDecorator(row.decorator_code, ctx);
    } catch (e) {
      return c.json({ success: false, error: `sandbox 执行失败: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }

    // 重渲染 widget 用新 frames
    const props = { ...(row.widget_props ?? {}), frameSvgPaths: newFrames.length > 0 ? newFrames : undefined };
    if (row.icon_svg) {
      props.iconSvg = row.icon_svg;
    }

    const { pngBuffer, bitmapBuffer } = await textLabelGenerator.rerenderWidget(
      row.source_model,
      props,
      row.font_family ?? 'alibaba-puhuiti',
      target
    );

    const pngPath = `labels/${id}.png`;
    await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, pngBuffer, pngBuffer.length, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });

    await db.getPool().query(
      `UPDATE labels
       SET png_path = $2,
           widget_props = $3::jsonb,
           frame_svg_paths = $4::jsonb,
           bin_bytes = $5,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        pngPath,
        JSON.stringify(props),
        newFrames.length > 0 ? JSON.stringify(newFrames) : null,
        bitmapBuffer.length,
      ]
    );

    return c.json({
      success: true,
      id,
      frameSvgPaths: newFrames,
      pngUrl: `/api/minio-proxy/${pngPath}`,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/regen-decoration 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// POST /generate-text (widget 模板库 + LLM 智能填充，async DB job)
labelsApp.post('/generate-text', async (c) => {
  try {
    const body = await c.req.json<{
      prompt: string;
      targetId?: string;
      tags?: string[];
      preferredWidget?: string;
      preferredFont?: string;
      forceDecoration?: boolean;
      clientRequestId?: string;
    }>();
    if (!body.prompt || body.prompt.trim() === '') {
      return c.json({ success: false, stage: 'validate', error: 'prompt 必填' }, 400);
    }
    if (body.preferredWidget && !getWidget(body.preferredWidget)) {
      return c.json({ success: false, stage: 'validate', error: `未知 widget: ${body.preferredWidget}` }, 400);
    }
    if (body.preferredFont && !SUPPORTED_FONTS.some((f) => f.family === body.preferredFont)) {
      return c.json({ success: false, stage: 'validate', error: `未知字体: ${body.preferredFont}` }, 400);
    }

    // 收敛到 session/turn 总账:widget 单条设计 = standalone session 的 root turn
    const sessionId = await createStandaloneSession();
    const result = await createTurn({
      sessionId,
      parentTurnId: null,
      turnKind: 'root',
      genMode: null,
      params: { targetId: body.targetId ?? null },
      effectivePrompt: body.prompt,
      clientRequestId: body.clientRequestId ?? null,
      enqueue: {
        jobType: 'widget',
        payload: {
          prompt: body.prompt,
          preferredWidget: body.preferredWidget,
          preferredFont: body.preferredFont,
          forceDecoration: body.forceDecoration,
          targetId: body.targetId,
          tags: body.tags,
        },
      },
    });

    return c.json(
      {
        success: true,
        jobId: result.jobId,
        sessionId,
        turnId: result.turnId,
        state: result.jobState,
        createdAt: result.jobCreatedAt,
      },
      result.deduped ? 200 : 201
    );
  } catch (error) {
    console.error('❌ POST /api/labels/generate-text 失败:', error);
    return c.json({
      success: false,
      stage: 'unknown',
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// GET /jobs/:id
labelsApp.get('/jobs/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const r = await getPostgresDatabase().getPool().query(
      `SELECT id, job_type, state, attempts, max_attempts, last_error, label_id,
              created_at, started_at, finished_at
         FROM label_jobs WHERE id=$1`,
      [id]
    );
    if (!r.rows[0]) return c.json({ error: 'job not found' }, 404);
    const row = r.rows[0];
    return c.json({
      id: row.id,
      jobType: row.job_type,
      state: row.state,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      labelId: row.label_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });
  } catch (error) {
    console.error('❌ GET /api/labels/jobs/:id 失败:', error);
    return c.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      500
    );
  }
});

// GET /widgets
labelsApp.get('/widgets', async (c) => {
  return c.json({ success: true, widgets: listWidgets() });
});

// GET /fonts
labelsApp.get('/fonts', async (c) => {
  return c.json({ success: true, fonts: [...SUPPORTED_FONTS] });
});

// POST /api/labels/ref-images — 用户上传 ref 图，转发到 BizyAir OSS 拿公网 URL
// v1.11.0: 不再存 MinIO（BizyAir 服务端拿不到我们内网图）；走 BizyAir 一步上传
//   (POST https://copilot.logic.heiyu.space/providers/bizyair/v1/upload)
//   返回的 URL 形如 https://bizyair-prod.oss-cn-shanghai.aliyuncs.com/inputs/xxx.png
//   BizyAir 各 model 的 images[] 字段能直接 fetch 该 URL 做 image-to-image
const BIZYAIR_UPLOAD_URL =
  process.env.BIZYAIR_UPLOAD_URL ?? 'https://copilot.logic.heiyu.space/providers/bizyair/v1/upload';

labelsApp.post('/ref-images', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: '缺少 file 字段' }, 400);
    }
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ success: false, error: '文件 > 10MB（前端应已 resize）' }, 400);
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      return c.json({ success: false, error: `不支持的 content-type: ${file.type}` }, 400);
    }

    // 转发到 BizyAir 一步上传 endpoint
    const forwardFd = new FormData();
    forwardFd.append('file', file);
    const upRes = await fetch(BIZYAIR_UPLOAD_URL, {
      method: 'POST',
      body: forwardFd,
      signal: AbortSignal.timeout(30_000),
    });
    if (!upRes.ok) {
      const text = await upRes.text();
      console.error(`BizyAir upload HTTP ${upRes.status}: ${text.slice(0, 200)}`);
      return c.json({
        success: false,
        error: `BizyAir 上传失败 HTTP ${upRes.status}`,
      }, 502);
    }
    const data: any = await upRes.json();
    if (!data.success || !data.url) {
      console.error('BizyAir upload 异常响应:', JSON.stringify(data).slice(0, 300));
      return c.json({ success: false, error: 'BizyAir 上传无 URL 返回' }, 502);
    }

    return c.json({
      success: true,
      url: data.url,                  // BizyAir 公网 OSS URL（BizyAir image-gen 能直接 fetch）
      objectKey: data.object_key,
      sizeBytes: file.size,
      contentType: file.type,
    }, 201);
  } catch (e) {
    console.error('POST /ref-images 失败:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// GET /current-target — 查询当前 niimbot 装载标签
labelsApp.get('/current-target', async (c) => {
  try {
    const info = await niimbotClient.queryCurrentLabel();
    if (!info) {
      return c.json({
        success: false,
        error: 'niimbot 网关无响应或当前未装载 RFID 标签',
        fallback: {
          widthMm: 40,
          heightMm: 20,
          widthPx: 320,
          heightPx: 160,
          source: 'default',
        },
      });
    }

    // 复用设备 DPI/机型名工具，向后兼容补充字段
    const deviceType = info.device?.deviceType ?? null;
    const dpi = deviceType != null ? dpiForDeviceType(deviceType) : info.widthPx / (info.spec.w / 25.4);
    const modelName = modelNameForDeviceType(deviceType);

    return c.json({
      success: true,
      target: {
        widthMm: info.spec.w,
        heightMm: info.spec.h,
        widthPx: info.widthPx,
        heightPx: info.heightPx,
        deviceType,
        dpi,
        modelName,
        sku: info.spec.sku,
        rfidBarcode: info.rfid.barcode,
        totalMm: info.rfid.totalMm,
        usedMm: info.rfid.usedMm,
        remainingMm: info.rfid.totalMm - info.rfid.usedMm,
        device: info.device
          ? {
              model: info.device.deviceType === 775 ? 'NiimBot B21' : `device_type=${info.device.deviceType}`,
              battery: info.device.battery,
              serial: info.device.serial,
              swVersion: info.device.swVersion,
            }
          : null,
        source: info.source,
      },
    });
  } catch (e) {
    return c.json({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});

// ============ Image Presets ============
// ⚠️ 必须放在 GET/DELETE /:id 之前，否则 Hono 会把 "presets" 当成 :id 参数

// GET /api/labels/presets — 列表（system 优先，按 display_order ASC，然后 last_used_at NULLS LAST）
labelsApp.get('/presets', async (c) => {
  try {
    const db = getPostgresDatabase();
    const r = await db.getPool().query(`
      SELECT id, name, prompt, model, model_options,
             thumbnail_path, source_label_id,
             use_count, last_used_at, created_at, updated_at,
             is_system, style_mode, static_suffix_text, source_image_url, display_order
        FROM image_presets
       ORDER BY display_order ASC, last_used_at DESC NULLS LAST, created_at DESC
    `);
    const presets = r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      model: row.model,
      modelOptions: row.model_options,
      thumbnailUrl: row.thumbnail_path ? `/api/minio-proxy/${row.thumbnail_path}` : null,
      sourceImageUrl: row.source_image_url,
      sourceLabelId: row.source_label_id,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isSystem: row.is_system,
      styleMode: row.style_mode,
      staticSuffixText: row.static_suffix_text,
      displayOrder: row.display_order,
    }));
    return c.json({ success: true, presets });
  } catch (e) {
    console.error('GET /presets 失败:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// POST /api/labels/presets — 新建（必填 name + prompt；可选 sourceLabelId 自动取 model/png_path）
labelsApp.post('/presets', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ success: false, error: 'name 必填' }, 400);
    }
    if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return c.json({ success: false, error: 'prompt 必填' }, 400);
    }
    const db = getPostgresDatabase();

    // 如果给了 sourceLabelId，从 labels 表取 png_path / source_model / source_image_url 作为默认值
    let thumbnailPath: string | null = null;
    let sourceImageUrl: string | null = null;       // ← 新增
    let resolvedModel: string | null = body.model ?? null;
    if (body.sourceLabelId) {
      const lr = await db.getPool().query(
        `SELECT png_path, source_model, source_image_url FROM labels WHERE id = $1`,
        [body.sourceLabelId]
      );
      if (lr.rows[0]) {
        thumbnailPath = lr.rows[0].png_path ?? null;
        sourceImageUrl = lr.rows[0].source_image_url ?? null;
        if (!resolvedModel) resolvedModel = lr.rows[0].source_model ?? null;
      }
    }

    const r = await db.getPool().query(
      `INSERT INTO image_presets (name, prompt, model, model_options, thumbnail_path, source_label_id, source_image_url)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING id, created_at`,
      [
        body.name.trim().slice(0, 100),
        body.prompt.trim().slice(0, 4000),
        resolvedModel,
        body.modelOptions ? JSON.stringify(body.modelOptions) : null,
        thumbnailPath,
        body.sourceLabelId ?? null,
        sourceImageUrl,           // ← 新
      ]
    );
    return c.json({ success: true, id: r.rows[0].id, createdAt: r.rows[0].created_at }, 201);
  } catch (e) {
    console.error('POST /presets 失败:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// PATCH /api/labels/presets/:id — 编辑 name / prompt / model
labelsApp.patch('/presets/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    // 只允许改这三个字段；其他字段忽略
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (typeof body.name === 'string') {
      sets.push(`name = $${idx++}`);
      vals.push(body.name.trim().slice(0, 100));
    }
    if (typeof body.prompt === 'string') {
      sets.push(`prompt = $${idx++}`);
      vals.push(body.prompt.trim().slice(0, 4000));
    }
    if (body.model !== undefined) {  // 允许传 null 清空
      sets.push(`model = $${idx++}`);
      vals.push(body.model);
    }
    if (body.staticSuffixText !== undefined) {  // 允许传 null 清空
      sets.push(`static_suffix_text = $${idx++}`);
      vals.push(body.staticSuffixText === null ? null : String(body.staticSuffixText).slice(0, 4000));
    }
    if (sets.length === 0) {
      return c.json({ success: false, error: '无可更新字段' }, 400);
    }
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await getPostgresDatabase().getPool().query(
      `UPDATE image_presets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id`,
      vals
    );
    if (r.rowCount === 0) return c.json({ success: false, error: 'preset 不存在' }, 404);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// DELETE /api/labels/presets/:id
labelsApp.delete('/presets/:id', async (c) => {
  try {
    const id = c.req.param('id');
    // 防止删 system preset
    const check = await getPostgresDatabase().getPool().query(
      `SELECT is_system FROM image_presets WHERE id = $1`, [id]
    );
    if (check.rows[0]?.is_system) {
      return c.json({ success: false, error: '系统预设不可删除' }, 403);
    }
    const r = await getPostgresDatabase().getPool().query(
      `DELETE FROM image_presets WHERE id = $1`, [id]
    );
    if (r.rowCount === 0) return c.json({ success: false, error: 'preset 不存在' }, 404);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// POST /api/labels/presets/:id/duplicate — 复制为副本（保留 prompt/model/参考图/风格模式，置为可编辑的用户预设）
labelsApp.post('/presets/:id/duplicate', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const r = await db.getPool().query(
      `INSERT INTO image_presets
         (name, prompt, model, model_options, thumbnail_path, source_label_id,
          source_image_url, style_mode, static_suffix_text, is_system, display_order)
       SELECT
          left(name || ' 副本', 100), prompt, model, model_options, thumbnail_path, source_label_id,
          source_image_url, style_mode, static_suffix_text, false, display_order
       FROM image_presets WHERE id = $1
       RETURNING id, created_at`,
      [id]
    );
    if (r.rowCount === 0) return c.json({ success: false, error: 'preset 不存在' }, 404);
    return c.json({ success: true, id: r.rows[0].id, createdAt: r.rows[0].created_at }, 201);
  } catch (e) {
    console.error('POST /presets/:id/duplicate 失败:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// POST /api/labels/presets/:id/use — 记录使用（前端选 preset 时调，更新 use_count + last_used_at）
labelsApp.post('/presets/:id/use', async (c) => {
  try {
    const id = c.req.param('id');
    await getPostgresDatabase().getPool().query(
      `UPDATE image_presets
          SET use_count = use_count + 1,
              last_used_at = now()
        WHERE id = $1`,
      [id]
    );
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// GET / (列表，支持 ?status= 和 ?tag= 筛选)
labelsApp.get('/', async (c) => {
  try {
    const status = c.req.query('status');
    const tag = c.req.query('tag');
    const limit = Math.max(1, Math.min(Number.isNaN(parseInt(c.req.query('limit') ?? '50', 10)) ? 50 : parseInt(c.req.query('limit') ?? '50', 10), 500));

    const db = getPostgresDatabase();
    let sql = `SELECT id, prompt, png_path, target_id, status, print_count, tags, source_type, source_model, source_image_url, last_error,
               widget_props, font_family, icon_svg, frame_svg_paths, decorator_code, parent_revision_id,
               created_at, updated_at
               FROM labels WHERE 1=1`;
    const args: any[] = [];
    if (status) {
      args.push(status);
      sql += ` AND status = $${args.length}`;
    }
    if (tag) {
      args.push(tag);
      sql += ` AND $${args.length} = ANY(tags)`;
    }
    args.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${args.length}`;
    const result = await db.getPool().query(sql, args);
    return c.json({ success: true, labels: result.rows.map(rowToLabel) });
  } catch (error) {
    console.error('❌ GET /api/labels 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// GET /:id
labelsApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const result = await db.getPool().query(
      `SELECT * FROM labels WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在' }, 404);
    }
    return c.json({ success: true, label: rowToLabel(result.rows[0]) });
  } catch (error) {
    console.error('❌ GET /api/labels/:id 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// POST /:id/print (审批+打印)
labelsApp.post('/:id/print', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      niimbotEndpoint?: string;
    };
    const endpoint =
      body.niimbotEndpoint || process.env.NIIMBOT_ENDPOINT;
    if (!endpoint) {
      return c.json(
        { success: false, error: '缺少 niimbotEndpoint（body 或 NIIMBOT_ENDPOINT 环境变量）' },
        400
      );
    }

    const db = getPostgresDatabase();
    const labelRes = await db.getPool().query(
      `SELECT * FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const label = labelRes.rows[0];

    if (label.status === 'generating') {
      return c.json({ success: false, error: '标签生成中，请稍候再打印' }, 400);
    }
    if (label.status === 'failed') {
      return c.json({ success: false, error: `标签生成失败，无法打印: ${label.last_error ?? '未知错误'}` }, 400);
    }

    const storedTarget = BUILTIN_TARGETS.find((t) => t.id === label.target_id) ?? LABEL_T40X20_TARGET;
    let target = storedTarget;

    // 按目标打印机机型 DPI 派生正确像素（B1 Pro 300dpi vs B21 203dpi）。
    // 复用已有 niimbotClient（base URL 从 NIIMBOT_ENDPOINT 推导）。
    const _devInfo = await niimbotClient.getDeviceInfo();
    target = deriveTargetForDevice(target, _devInfo?.deviceType);
    console.log(`[print] device_type=${_devInfo?.deviceType ?? 'unknown'} → ${target.widthPx}x${target.heightPx}@${target.dpi}dpi`);

    // 按 source_type 分发 bitmap 获取
    let bitmapBuffer: Buffer;
    if (label.source_type === 'image' || label.source_type === 'widget') {
      const sizeMismatch = target.widthPx !== storedTarget.widthPx || target.heightPx !== storedTarget.heightPx;
      if (sizeMismatch && label.source_image_url) {
        // 派生尺寸与存储 PNG 不一致：从原图按设备 target 原生重新抖动，避免错位/越界
        console.log(`[print] re-dither from source ${storedTarget.widthPx}x${storedTarget.heightPx} -> ${target.widthPx}x${target.heightPx} algo=${label.dither_algorithm}`);
        const { bitmapBuffer: bmp } = await imageLabelGenerator.redither(label.source_image_url, target, label.dither_algorithm);
        bitmapBuffer = bmp;
      } else {
        if (sizeMismatch && !label.source_image_url) {
          console.warn('[print] size mismatch but no source_image_url, falling back to resize-pack (quality degraded)');
        }
        // 从 MinIO 下载 dither 后 PNG → 重新 pack（resize 防御）
        const pngObj = await imageStorage.getClient().getObject(MINIO_BUCKET, label.png_path);
        const chunks: Buffer[] = [];
        for await (const chunk of pngObj) chunks.push(chunk as Buffer);
        const pngBuffer = Buffer.concat(chunks);
        bitmapBuffer = await packFromPng(pngBuffer, target);
      }
    } else {
      // svg (老路径)
      const result = await llmLabelGenerator.svgToBitmap(label.svg, target);
      bitmapBuffer = result.bitmapBuffer;
    }

    // push 到 niimbot
    const pushResult = await niimbotPush.push(bitmapBuffer, target, endpoint, {
      printId: id,
    });

    if (!pushResult.queued) {
      return c.json(
        {
          success: false,
          printId: id,
          httpStatus: pushResult.status,
          error: pushResult.error || '推送失败',
        },
        502
      );
    }

    // 更新 DB
    await db.getPool().query(
      `UPDATE labels
       SET status = 'printed',
           print_count = print_count + 1,
           print_history = print_history || jsonb_build_object(
             'printed_at', now(),
             'endpoint', $2::text,
             'http_status', $3::int,
             'bytes', $4::int
           ),
           updated_at = now()
       WHERE id = $1`,
      [id, endpoint, pushResult.status ?? null, bitmapBuffer.length]
    );

    return c.json({
      success: true,
      printId: id,
      bytes: bitmapBuffer.length,
      httpStatus: pushResult.status,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/print 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// POST /:id/regenerate (用原 prompt 再调一次 LLM / BizyAir)
labelsApp.post('/:id/regenerate', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();

    const labelRes = await db.getPool().query(
      `SELECT prompt, target_id, source_type, source_model, llm_model FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const { prompt, target_id, source_type, source_model, llm_model, status } = labelRes.rows[0];

    if (status === 'generating') {
      return c.json({ success: false, error: '标签生成中，请稍候再重新生成' }, 400);
    }
    if (status === 'failed') {
      return c.json({ success: false, error: '标签生成失败，请先删除后重试' }, 400);
    }

    const target = BUILTIN_TARGETS.find((t) => t.id === target_id) ?? LABEL_T40X20_TARGET;

    if (source_type === 'image') {
      // BizyAir 路径
      const result = await imageLabelGenerator.generate(prompt, source_model, target);
      const pngPath = `labels/${id}.png`;
      await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });
      await db.getPool().query(
        `UPDATE labels
         SET png_path = $2, source_image_url = $3, llm_latency_ms = $4, bin_bytes = $5, updated_at = now()
         WHERE id = $1`,
        [id, pngPath, result.sourceImageUrl, result.bizyairLatencyMs, result.bitmapBuffer.length]
      );
      return c.json({
        success: true, id, sourceType: 'image', sourceModel: source_model,
        sourceImageUrl: result.sourceImageUrl, pngPath, pngUrl: `/api/minio-proxy/${pngPath}`,
        bizyairLatencyMs: result.bizyairLatencyMs,
      });
    }

    if (source_type === 'widget') {
      // v1.4.4 伴随任务记录：用 row.llm_model 反查 provider 调 LLM
      //（不用 active model，保持 label 原作的 model 一致性）
      const labelLlmModel = llm_model;
      let llmCfg: ActiveLLMConfig;
      if (labelLlmModel && labelLlmModel !== 'pending') {
        const cfgRes = await db.getPool().query(
          `SELECT p.base_url, p.api_key, p.api_type, m.model_id, m.context_window, m.max_tokens
           FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
           WHERE m.model_id = $1 AND m.enabled = true AND p.enabled = true LIMIT 1`,
          [labelLlmModel]
        );
        if (cfgRes.rows.length > 0) {
          const r = cfgRes.rows[0];
          llmCfg = { baseUrl: r.base_url, apiKey: r.api_key, model: r.model_id, apiType: r.api_type, contextWindow: r.context_window, maxTokens: r.max_tokens };
        } else {
          // 原 model 已被禁用/删除 → fallback 到 active
          llmCfg = await getActiveLLMConfig(db);
        }
      } else {
        llmCfg = await getActiveLLMConfig(db);
      }
      // 用原 prompt + 原 widget+font preference 重新 LLM 调用
      const result = await textLabelGenerator.generate(prompt, target, llmCfg, {
        widgetId: source_model as any,  // 保留原 widget 选择
      });
      const pngPath = `labels/${id}.png`;
      await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });
      await db.getPool().query(
        `UPDATE labels
         SET png_path = $2, widget_props = $3::jsonb, font_family = $4, icon_svg = $5,
             frame_svg_paths = $6::jsonb, decorator_code = $7, llm_latency_ms = $8, bin_bytes = $9, updated_at = now()
         WHERE id = $1`,
        [id, pngPath, JSON.stringify(result.props), result.fontFamily, result.iconSvg,
         result.frameSvgPaths ? JSON.stringify(result.frameSvgPaths) : null,
         result.decoratorCode,
         result.llmLatencyMs, result.bitmapBuffer.length]
      );
      return c.json({
        success: true, id, sourceType: 'widget', sourceModel: result.widgetId,
        widgetProps: result.props, fontFamily: result.fontFamily, iconSvg: result.iconSvg,
        frameSvgPaths: result.frameSvgPaths,
        decoratorCode: result.decoratorCode,
        pngPath, pngUrl: `/api/minio-proxy/${pngPath}`, llmLatencyMs: result.llmLatencyMs,
      });
    }

    // 默认 / svg：原逻辑
    const llmCfg = await getActiveLLMConfig(db);
    const result = await llmLabelGenerator.generate(prompt, target, llmCfg);

    // 覆盖上传 PNG
    const pngPath = `labels/${id}.png`;
    await imageStorage
      .getClient()
      .putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });

    // 更新 DB
    await db.getPool().query(
      `UPDATE labels
       SET svg = $2,
           png_path = $3,
           llm_model = $4,
           llm_latency_ms = $5,
           bin_bytes = $6,
           updated_at = now()
       WHERE id = $1`,
      [id, result.svg, pngPath, result.llmModel, result.llmLatencyMs, result.bitmapBuffer.length]
    );

    return c.json({
      success: true,
      id,
      svg: result.svg,
      pngPath,
      pngUrl: `/api/minio-proxy/${pngPath}`,
      llmLatencyMs: result.llmLatencyMs,
      llmModel: result.llmModel,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/regenerate 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// DELETE /:id (soft delete: status=archived)
labelsApp.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();
    const result = await db.getPool().query(
      `UPDATE labels SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在' }, 404);
    }
    return c.json({ success: true, id });
  } catch (error) {
    console.error('❌ DELETE /api/labels/:id 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      500
    );
  }
});

// LLM 管理端点已存在于 src/api/llm-providers-api.ts（pre-existing，v1.0.36 引入）
// catalog/active GET+POST/test/providers CRUD 都在那里挂载 /api/llm/*
// 本文件不重复实现，前端调用走 /api/llm/* 而非 /api/labels/llm/*

export default labelsApp;
