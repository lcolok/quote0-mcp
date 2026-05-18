import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import type { ActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { llmLabelGenerator } from '../react-widgets/services/llm-label-generator.js';
import { imageLabelGenerator } from '../react-widgets/services/image-label-generator.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { listWidgets, SUPPORTED_FONTS, getWidget } from '../react-widgets/core/label-widget-registry.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import { niimbotPush } from '../react-widgets/core/niimbot-push-module.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';

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
    }>();
    if (!body.prompt || body.prompt.trim() === '') {
      return c.json({ success: false, stage: 'validate', error: 'prompt 必填' }, 400);
    }
    if (!['sd5', 'sd5-3k', 'nb2', 'nbp', 'gpt2'].includes(body.model)) {
      return c.json({ success: false, stage: 'validate', error: `不支持的 model: ${body.model}` }, 400);
    }

    const target =
      BUILTIN_TARGETS.find((t) => t.id === (body.targetId ?? 'label-T40x20-320')) ??
      LABEL_T40X20_TARGET;

    const db = getPostgresDatabase();

    // 1) 立刻 INSERT row 占位（status='generating'）
    const insertRes = await db.getPool().query<{ id: string; created_at: Date }>(
      `INSERT INTO labels (prompt, svg, target_id, llm_model, bin_bytes, tags,
                            source_type, source_model, status)
       VALUES ($1, NULL, $2, $3, 0, $4, 'image', $5, 'generating')
       RETURNING id, created_at`,
      [body.prompt, target.id, body.model, body.tags ?? [], body.model]
    );
    const labelId = insertRes.rows[0].id;

    // 2) 立刻返回 id（前端开始轮询）
    const response = c.json({
      success: true,
      id: labelId,
      status: 'generating',
      sourceType: 'image',
      sourceModel: body.model,
      prompt: body.prompt,
      targetId: target.id,
      createdAt: insertRes.rows[0].created_at,
    }, 201);

    // 3) 后台 fire-and-forget BizyAir 调用 + dither + 入完整数据
    //    用 setImmediate 让 HTTP response 先发出（Hono 同步阶段结束）
    setImmediate(async () => {
      const t0 = Date.now();
      try {
        const result = await imageLabelGenerator.generate(body.prompt, body.model, target, body.modelOptions);

        // 上传 PNG 到 MinIO
        const pngPath = `labels/${labelId}.png`;
        await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        });

        // UPDATE row 成 draft
        await db.getPool().query(
          `UPDATE labels
           SET status = 'draft',
               png_path = $2,
               source_image_url = $3,
               llm_latency_ms = $4,
               bin_bytes = $5,
               last_error = NULL,
               updated_at = now()
           WHERE id = $1`,
          [labelId, pngPath, result.sourceImageUrl, result.bizyairLatencyMs, result.bitmapBuffer.length]
        );
        console.log(`✅ image label ${labelId} 完成 (${Date.now() - t0}ms)`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`❌ image label ${labelId} 失败:`, errMsg);
        // UPDATE row 成 failed + 错误信息
        await db.getPool().query(
          `UPDATE labels
           SET status = 'failed',
               last_error = $2,
               updated_at = now()
           WHERE id = $1`,
          [labelId, errMsg.slice(0, 500)]
        ).catch((dbErr) => console.error('failed update 也炸了:', dbErr));
      }
    });

    return response;
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
    const { pngBuffer, bitmapBuffer } = await imageLabelGenerator.redither(row.source_image_url, target);

    const pngPath = `labels/${id}.png`;
    await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, pngBuffer, pngBuffer.length, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    await db.getPool().query(
      `UPDATE labels SET png_path = $1, bin_bytes = $2, updated_at = now() WHERE id = $3`,
      [pngPath, bitmapBuffer.length, id]
    );

    return c.json({
      success: true,
      id,
      pngPath,
      pngUrl: `/api/minio-proxy/${pngPath}`,
    });
  } catch (error) {
    console.error('❌ POST /api/labels/:id/redither 失败:', error);
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

// POST /generate-text (widget 模板库 + LLM 智能填充，async fire-and-forget)
labelsApp.post('/generate-text', async (c) => {
  try {
    const body = await c.req.json<{
      prompt: string;
      targetId?: string;
      tags?: string[];
      preferredWidget?: string;
      preferredFont?: string;
      forceDecoration?: boolean;
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

    const target =
      BUILTIN_TARGETS.find((t) => t.id === (body.targetId ?? 'label-T40x20-320')) ??
      LABEL_T40X20_TARGET;

    const db = getPostgresDatabase();

    // 1) 立刻 INSERT row 占位
    const insertRes = await db.getPool().query<{ id: string; created_at: Date }>(
      `INSERT INTO labels (prompt, svg, target_id, llm_model, bin_bytes, tags,
                            source_type, status)
       VALUES ($1, NULL, $2, $3, 0, $4, 'widget', 'generating')
       RETURNING id, created_at`,
      [body.prompt, target.id, 'pending', body.tags ?? []]
    );
    const labelId = insertRes.rows[0].id;

    // 2) 立刻返回 id
    const response = c.json({
      success: true,
      id: labelId,
      status: 'generating',
      sourceType: 'widget',
      prompt: body.prompt,
      targetId: target.id,
      createdAt: insertRes.rows[0].created_at,
    }, 201);

    // 3) 后台 fire-and-forget LLM + satori 渲染
    setImmediate(async () => {
      const t0 = Date.now();
      try {
        const llmCfg = await getActiveLLMConfig(db);
        const result = await textLabelGenerator.generate(body.prompt, target, llmCfg, {
          widgetId: body.preferredWidget as any,
          fontFamily: body.preferredFont as any,
          forceDecoration: body.forceDecoration,
        });

        const pngPath = `labels/${labelId}.png`;
        await imageStorage.getClient().putObject(MINIO_BUCKET, pngPath, result.pngBuffer, result.pngBuffer.length, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        });

        await db.getPool().query(
          `UPDATE labels
           SET status = 'draft',
               png_path = $2,
               source_model = $3,
               widget_props = $4::jsonb,
               font_family = $5,
               icon_svg = $6,
               frame_svg_paths = $7::jsonb,
               decorator_code = $8,
               llm_model = $9,
               llm_latency_ms = $10,
               bin_bytes = $11,
               last_error = NULL,
               updated_at = now()
           WHERE id = $1`,
          [
            labelId,
            pngPath,
            result.widgetId,
            JSON.stringify(result.props),
            result.fontFamily,
            result.iconSvg,
            result.frameSvgPaths ? JSON.stringify(result.frameSvgPaths) : null,
            result.decoratorCode,
            result.llmModel,
            result.llmLatencyMs,
            result.bitmapBuffer.length,
          ]
        );
        console.log(`✅ widget label ${labelId} 完成 (${Date.now() - t0}ms)`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`❌ widget label ${labelId} 失败:`, errMsg);
        await db.getPool().query(
          `UPDATE labels SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
          [labelId, errMsg.slice(0, 500)]
        ).catch((dbErr) => console.error('failed update 也炸了:', dbErr));
      }
    });

    return response;
  } catch (error) {
    console.error('❌ POST /api/labels/generate-text 失败:', error);
    return c.json({
      success: false,
      stage: 'unknown',
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
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

// GET / (列表，支持 ?status= 和 ?tag= 筛选)
labelsApp.get('/', async (c) => {
  try {
    const status = c.req.query('status');
    const tag = c.req.query('tag');
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500));

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

    const target = BUILTIN_TARGETS.find((t) => t.id === label.target_id) ?? LABEL_T40X20_TARGET;

    // 按 source_type 分发 bitmap 获取
    let bitmapBuffer: Buffer;
    if (label.source_type === 'image' || label.source_type === 'widget') {
      // 从 MinIO 下载 dither 后 PNG → 重新 pack
      const pngObj = await imageStorage.getClient().getObject(MINIO_BUCKET, label.png_path);
      const chunks: Buffer[] = [];
      for await (const chunk of pngObj) chunks.push(chunk as Buffer);
      const pngBuffer = Buffer.concat(chunks);
      bitmapBuffer = await packFromPng(pngBuffer, target);
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
