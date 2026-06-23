import { hostname } from 'node:os';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { imageLabelGenerator } from '../react-widgets/services/image-label-generator.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET } from '../react-widgets/core/render-targets.js';
import { niimbotClient } from '../react-widgets/services/niimbot-client.js';
import { promptOrchestrator } from '../react-widgets/services/prompt-orchestrator.js';
import { dpiForDeviceType } from '../react-widgets/core/device-dpi.js';
import type { RenderTarget } from '../react-widgets/core/render-targets.js';

const WORKER_ID = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const TICK_MS = 5000;
const LEASE_TTL_SECONDS = 120;
const HEARTBEAT_MS = 30_000;
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

let running = false;

export function startLabelJobWorker(): void {
  if (running) return;
  running = true;
  console.log(`🛠️ label-job worker started (id=${WORKER_ID})`);
  loop().catch((e) => console.error('label-job worker loop crash:', e));
}

async function loop(): Promise<void> {
  while (running) {
    try {
      const job = await claimJob();
      if (job) await executeJob(job);
      else await sleep(TICK_MS);
    } catch (e) {
      console.error('label-job worker tick error:', e);
      await sleep(TICK_MS);
    }
  }
}

async function claimJob(): Promise<any | null> {
  const pool = getPostgresDatabase().getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      SELECT * FROM label_jobs
       WHERE state = 'queued'
          OR (state = 'running' AND lease_expires_at < now())
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`);
    if (r.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const job = r.rows[0];
    await client.query(
      `UPDATE label_jobs
          SET state = 'running',
              lease_owner = $1,
              lease_expires_at = now() + ($2 || ' seconds')::interval,
              attempts = attempts + 1,
              started_at = COALESCE(started_at, now())
        WHERE id = $3`,
      [WORKER_ID, String(LEASE_TTL_SECONDS), job.id]
    );
    await client.query('COMMIT');
    return { ...job, attempts: job.attempts + 1 };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function renewLease(jobId: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE label_jobs SET lease_expires_at = now() + ($1 || ' seconds')::interval
      WHERE id = $2 AND lease_owner = $3`,
    [String(LEASE_TTL_SECONDS), jobId, WORKER_ID]
  );
}

async function executeJob(job: any): Promise<void> {
  const heartbeat = setInterval(() => {
    renewLease(job.id).catch((e) => console.warn('lease renew failed:', e));
  }, HEARTBEAT_MS);
  try {
    let labelId: string;
    if (job.job_type === 'widget') {
      labelId = await executeWidgetJob(job.payload);
    } else {
      labelId = await executeImageJob(job.payload);
    }
    await markSucceeded(job.id, labelId);
    console.log(`✅ job ${job.id} succeeded → label ${labelId}`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // 超时类（代理间歇断流）重试也大概率再等满超时，止损：一次即 fail，不占 3×75s
    const nonRetryable = errMsg.includes('[BIZYAIR_TIMEOUT]');
    console.error(`❌ job ${job.id} attempt ${job.attempts} failed${nonRetryable ? ' (non-retryable)' : ''}:`, errMsg);
    if (!nonRetryable && job.attempts < job.max_attempts) {
      await markRequeued(job.id, errMsg);
    } else {
      await markFailed(job.id, errMsg);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeWidgetJob(payload: any): Promise<string> {
  const db = getPostgresDatabase();
  const llmCfg = await getActiveLLMConfig(db);
  const target =
    BUILTIN_TARGETS.find((t) => t.id === (payload.targetId ?? 'label-T40x20-320')) ??
    LABEL_T40X20_TARGET;

  const result = await textLabelGenerator.generate(payload.prompt, target, llmCfg, {
    widgetId: payload.preferredWidget,
    fontFamily: payload.preferredFont,
    forceDecoration: payload.forceDecoration,
  });

  const labelId = crypto.randomUUID();
  const pngPath = `labels/${labelId}.png`;
  const imageStorage = getImageStorage();
  await imageStorage.getClient().putObject(
    MINIO_BUCKET,
    pngPath,
    result.pngBuffer,
    result.pngBuffer.length,
    { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  );

  await db.getPool().query(
    `INSERT INTO labels (id, prompt, svg, target_id, llm_model, llm_latency_ms, bin_bytes,
                          source_type, source_model, png_path, widget_props, font_family, icon_svg,
                          frame_svg_paths, decorator_code, status, tags)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'widget', $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, 'draft', $14)`,
    [
      labelId,
      payload.prompt,
      target.id,
      result.llmModel,
      result.llmLatencyMs,
      result.bitmapBuffer.length,
      result.widgetId,
      pngPath,
      JSON.stringify(result.props),
      result.fontFamily,
      result.iconSvg,
      result.frameSvgPaths ? JSON.stringify(result.frameSvgPaths) : null,
      result.decoratorCode,
      payload.tags ?? [],
    ]
  );
  return labelId;
}

async function executeImageJob(payload: any): Promise<string> {
  const db = getPostgresDatabase();

  // 1. 查询 niimbot 当前装载（best-effort，失败 fallback）
  const currentLabel = await niimbotClient.queryCurrentLabel();

  // 2. resolve target —— 优先 RFID 推导，fallback BUILTIN_TARGETS
  let target: RenderTarget;
  let targetMeta: { widthMm?: number; heightMm?: number; widthPx: number; heightPx: number };
  if (currentLabel) {
    target = {
      id: `niimbot-rfid-${currentLabel.spec.sku || `${currentLabel.spec.w}x${currentLabel.spec.h}`}`,
      kind: 'thermal-label',
      widthPx: currentLabel.widthPx,
      heightPx: currentLabel.heightPx,
      dpi: dpiForDeviceType(currentLabel?.device?.deviceType),
      colorMode: 'mono-1bit',
      physical: { widthMm: currentLabel.spec.w, heightMm: currentLabel.spec.h },
      defaultFontStack: ['smiley-sans'],
    };
    targetMeta = {
      widthMm: currentLabel.spec.w,
      heightMm: currentLabel.spec.h,
      widthPx: currentLabel.widthPx,
      heightPx: currentLabel.heightPx,
    };
    console.log(`🏷️ niimbot RFID 检测到: ${currentLabel.spec.w}×${currentLabel.spec.h}mm (${currentLabel.spec.sku})`);
  } else {
    target = BUILTIN_TARGETS.find((t) => t.id === (payload.targetId ?? 'label-T40x20-320')) ?? LABEL_T40X20_TARGET;
    targetMeta = {
      widthMm: target.physical?.widthMm,
      heightMm: target.physical?.heightMm,
      widthPx: target.widthPx,
      heightPx: target.heightPx,
    };
    console.warn(`⚠️ niimbot RFID 不可用，fallback target=${target.id}`);
  }

  // 3. 解析 presetId —— v1.9.0 兼容策略：
  //    - payload.presetId === 'none' → 不应用任何 preset（前端 v1.10 显式传）
  //    - payload.presetId === undefined → 老前端兼容，自动应用系统 "热敏默认"
  //    - payload.presetId === <uuid> → 应用指定 preset
  let appliedPreset: import('../react-widgets/services/prompt-orchestrator.js').AppliedPreset | null = null;
  let appliedPresetId: string | null = null;

  if (payload.presetId === 'none') {
    appliedPreset = null;
  } else if (payload.presetId && typeof payload.presetId === 'string') {
    // 显式 preset
    const pr = await db.getPool().query(
      `SELECT id, name, prompt, source_image_url, thumbnail_path, style_mode, static_suffix_text
         FROM image_presets WHERE id = $1`,
      [payload.presetId]
    );
    if (pr.rows[0]) {
      const p = pr.rows[0];
      const srcUrl = p.source_image_url
        ?? (p.thumbnail_path ? `/api/minio-proxy/${p.thumbnail_path}` : null);
      if (!srcUrl && p.style_mode === 'oneshot') {
        console.warn(`⚠️ preset ${p.id} (oneshot) 无 source image，回退 static_suffix 默认`);
      } else {
        appliedPreset = {
          id: p.id,
          name: p.name,
          prompt: p.prompt,
          sourceImageUrl: srcUrl ?? '',
          styleMode: p.style_mode,
          staticSuffixText: p.static_suffix_text,
        };
        appliedPresetId = p.id;
      }
    }
  } else {
    // payload.presetId 未传 (老前端 v1.7/1.8) → 自动应用系统 "热敏默认"
    const pr = await db.getPool().query(
      `SELECT id, name, prompt, source_image_url, thumbnail_path, style_mode, static_suffix_text
         FROM image_presets WHERE is_system = true AND name = '🌡️ 热敏默认' LIMIT 1`
    );
    if (pr.rows[0]) {
      const p = pr.rows[0];
      appliedPreset = {
        id: p.id,
        name: p.name,
        prompt: p.prompt,
        sourceImageUrl: '',
        styleMode: 'static_suffix',
        staticSuffixText: p.static_suffix_text,
      };
      appliedPresetId = p.id;
    }
  }

  // 4. ref image URLs（v1.10 前端会传，老前端不传）
  const refImageUrls: string[] = Array.isArray(payload.refImageUrls) ? payload.refImageUrls : [];

  // 5. 编排 final prompt（4 分支决策由 orchestrator 处理）
  const llmCfg = await getActiveLLMConfig(db);
  const orchestrated = await promptOrchestrator.orchestrate({
    userPrompt: payload.prompt,
    preset: appliedPreset,
    refImageUrls,
    target: targetMeta,
    llmConfig: llmCfg,
  });
  console.log(
    `🎨 orchestrate mode=${orchestrated.mode}, llm=${orchestrated.llmLatencyMs}ms, ` +
    `prompt len=${orchestrated.finalPrompt.length}, ` +
    `bizyairImages=${orchestrated.bizyairImages?.length ?? 0}`,
  );

  // 6. 调 BizyAir 生成（passing final prompt + 可选 images[] 直传走 image-to-image）
  //    v1.11.0: orchestrator 在有 ref 图时把 BizyAir 公网 URL 数组放在 bizyairImages
  //    bizyair-client buildPayload 用 ...options 透传，所以这里塞进 modelOptions.images 即可
  const mergedOptions: Record<string, any> = { ...(payload.modelOptions ?? {}) };
  if (orchestrated.bizyairImages && orchestrated.bizyairImages.length > 0) {
    // 用户传的 modelOptions.images 优先；orchestrator 给的作为 default
    if (!mergedOptions.images) {
      mergedOptions.images = orchestrated.bizyairImages;
    }
  }
  const result = await imageLabelGenerator.generate(
    orchestrated.finalPrompt,
    payload.model,
    target,
    mergedOptions,
  );

  // 7. INSERT labels — prompt 字段存原始用户 prompt（让历史 / preset 复用清晰）
  const labelId = crypto.randomUUID();
  const pngPath = `labels/${labelId}.png`;
  const imageStorage = getImageStorage();
  await imageStorage.getClient().putObject(
    MINIO_BUCKET,
    pngPath,
    result.pngBuffer,
    result.pngBuffer.length,
    { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  );

  await db.getPool().query(
    `INSERT INTO labels (id, prompt, svg, target_id, llm_model, bin_bytes, tags,
                          source_type, source_model, png_path, source_image_url, llm_latency_ms,
                          applied_preset_id, status)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'image', $7, $8, $9, $10, $11, 'draft')`,
    [
      labelId,
      payload.prompt,                  // 原始用户 prompt
      target.id,
      payload.model,
      result.bitmapBuffer.length,
      payload.tags ?? [],
      payload.model,
      pngPath,
      result.sourceImageUrl,
      result.bizyairLatencyMs + orchestrated.llmLatencyMs,  // 总 latency 含 LLM 编排
      appliedPresetId,                 // 追溯应用了哪个 preset
    ]
  );
  return labelId;
}

async function markSucceeded(jobId: string, labelId: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE label_jobs SET state='succeeded', label_id=$1, finished_at=now(), last_error=NULL
      WHERE id=$2`,
    [labelId, jobId]
  );
}

async function markRequeued(jobId: string, err: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE label_jobs
        SET state='queued', lease_owner=NULL, lease_expires_at=NULL,
            last_error=$1
      WHERE id=$2`,
    [err.slice(0, 1000), jobId]
  );
}

async function markFailed(jobId: string, err: string): Promise<void> {
  await getPostgresDatabase().getPool().query(
    `UPDATE label_jobs
        SET state='failed', last_error=$1, finished_at=now()
      WHERE id=$2`,
    [err.slice(0, 1000), jobId]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
