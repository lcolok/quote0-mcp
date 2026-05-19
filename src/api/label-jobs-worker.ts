import { hostname } from 'node:os';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { textLabelGenerator } from '../react-widgets/services/text-label-generator.js';
import { imageLabelGenerator } from '../react-widgets/services/image-label-generator.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { getImageStorage } from '../react-widgets/core/image-storage.js';
import { BUILTIN_TARGETS, LABEL_T40X20_TARGET } from '../react-widgets/core/render-targets.js';
import { niimbotClient } from '../react-widgets/services/niimbot-client.js';
import { buildThermalLabelPrompt, type ThermalLabelContext } from '../react-widgets/services/thermal-prompt-injector.js';
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
    console.error(`❌ job ${job.id} attempt ${job.attempts} failed:`, errMsg);
    if (job.attempts < job.max_attempts) {
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
  let labelMeta: ThermalLabelContext;
  if (currentLabel) {
    target = {
      id: `niimbot-rfid-${currentLabel.spec.sku || `${currentLabel.spec.w}x${currentLabel.spec.h}`}`,
      kind: 'thermal-label',
      widthPx: currentLabel.widthPx,
      heightPx: currentLabel.heightPx,
      dpi: 203,
      colorMode: 'mono-1bit',
      physical: { widthMm: currentLabel.spec.w, heightMm: currentLabel.spec.h },
      defaultFontStack: ['smiley-sans'],
    };
    labelMeta = {
      widthMm: currentLabel.spec.w,
      heightMm: currentLabel.spec.h,
      widthPx: currentLabel.widthPx,
      heightPx: currentLabel.heightPx,
    };
    console.log(`🏷️ niimbot RFID 检测到: ${currentLabel.spec.w}×${currentLabel.spec.h}mm (${currentLabel.spec.sku}) [${currentLabel.source}]`);
  } else {
    target = BUILTIN_TARGETS.find((t) => t.id === (payload.targetId ?? 'label-T40x20-320')) ?? LABEL_T40X20_TARGET;
    labelMeta = {
      widthMm: target.physical?.widthMm,
      heightMm: target.physical?.heightMm,
      widthPx: target.widthPx,
      heightPx: target.heightPx,
    };
    console.warn(`⚠️ niimbot RFID 不可用，fallback target=${target.id}`);
  }

  // 3. 注入热敏标签约束到 prompt
  const enhancedPrompt = buildThermalLabelPrompt(payload.prompt, labelMeta);
  console.log(`📝 enhanced prompt (${enhancedPrompt.length} chars): ${enhancedPrompt.slice(0, 100)}...`);

  // 4. 调 BizyAir 生成（passing enhanced prompt）
  const result = await imageLabelGenerator.generate(
    enhancedPrompt,
    payload.model,
    target,
    payload.modelOptions
  );

  // 5. INSERT labels — 注意 prompt 字段存**原始用户 prompt**（让 preset/UI 显示干净）
  //    enhanced prompt 不持久化（每次 redither/regenerate 重新构造，自动适配最新装载）
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
                          source_type, source_model, png_path, source_image_url, llm_latency_ms, status)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'image', $7, $8, $9, $10, 'draft')`,
    [
      labelId,
      payload.prompt,            // ← 原始 prompt
      target.id,
      payload.model,
      result.bitmapBuffer.length,
      payload.tags ?? [],
      payload.model,
      pngPath,
      result.sourceImageUrl,
      result.bizyairLatencyMs,
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
