import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { llmLabelGenerator } from '../react-widgets/services/llm-label-generator.js';
import { niimbotPush } from '../react-widgets/core/niimbot-push-module.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET } from '../react-widgets/core/render-targets.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';

const labelsApp = new Hono();
const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

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

// GET / (列表，支持 ?status= 和 ?tag= 筛选)
labelsApp.get('/', async (c) => {
  try {
    const status = c.req.query('status');
    const tag = c.req.query('tag');
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500));

    const db = getPostgresDatabase();
    let sql = `SELECT id, prompt, png_path, target_id, status, print_count, tags, created_at, updated_at
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
    return c.json({ success: true, labels: result.rows });
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
    return c.json({ success: true, label: result.rows[0] });
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

    const target = BUILTIN_TARGETS.find((t) => t.id === label.target_id) ?? LABEL_T40X20_TARGET;

    // SVG → 1-bit bitmap
    const { bitmapBuffer } = await llmLabelGenerator.svgToBitmap(label.svg, target);

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

// POST /:id/regenerate (用原 prompt 再调一次 LLM)
labelsApp.post('/:id/regenerate', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getPostgresDatabase();

    const labelRes = await db.getPool().query(
      `SELECT prompt, target_id FROM labels WHERE id = $1 AND status != 'archived' LIMIT 1`,
      [id]
    );
    if (labelRes.rows.length === 0) {
      return c.json({ success: false, error: '标签不存在或已归档' }, 404);
    }
    const { prompt, target_id } = labelRes.rows[0];

    const target = BUILTIN_TARGETS.find((t) => t.id === target_id) ?? LABEL_T40X20_TARGET;
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

export default labelsApp;
