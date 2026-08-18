/**
 * Hono API服务器 - 模块化新闻处理API
 * 提供REST API接口替代CLI命令行操作
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { validator } from 'hono/validator';
import type { NewsProcessRequest, NewsProcessResponse } from './news-types.js';
import { modularNewsPlugin } from '../react-widgets/plugins/modular-news-plugin.js';
import { computeNewsFingerprint, processNews } from './news-processing-service.js';
import { devicePusher } from './device-pusher.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { ensureSchedulerStarted, getSchedulerInstance } from './scheduler-registry.js';
import type { NewsSchedulerJobConfig } from './news-types.js';
import annotationApp from './annotation-api.js';
import axTrainingApp from './ax-training-api.js';
import { llmProvidersApp } from './llm-providers-api.js';
import { devicesApp } from './devices-api.js';
import inventoryApp from './inventory-api.js';
import researchCanaryApp from './research-canary-api.js';
import trmnlCanaryApp from './trmnl-canary-api.js';
import adaptiveReviewApp from './adaptive-review-api.js';
import rendererReviewApp from './renderer-review-api.js';
import labelsApp from './labels-api.js';
import labelBatchesApp from './label-batches-api.js';
import componentLabelsApp from './component-labels-api.js';
import componentLabelBatchesApp from './component-label-batches-api.js';
import labelSessionsApp from './label-sessions-api.js';
import memosApp from './memos-api.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../react-widgets/core/device-constants.js';
import { labelPrintOrchestrator } from '../react-widgets/core/label-print-orchestrator.js';
import { thermalLabelRenderer } from '../react-widgets/core/thermal-label-rendering-module.js';
import { BUILTIN_TARGETS, RenderTarget } from '../react-widgets/core/render-targets.js';
import { renderAndPushLocalEinkByTarget } from './target-aware-eink.js';
import {
  buildRenderablePushContent,
  minioImagePathFromRenderedImages,
  normalizeRenderableDeviceIds,
  RENDERABLE_NEWS_CONTRACT_VERSION,
  validateRenderableNews,
} from './renderable-news-intake.js';
import type { DevicePushResult, PushBatchStatus } from './push-results.js';
import { getDeviceFrame } from './device-frame-cache.js';
import { isBarkAlertsConfigured } from './device-health-alerts.js';
import {
  getRssSourceRegistry,
  RECOMMENDED_RSS_SOURCE_IDS,
} from '../react-widgets/core/data-sources/rss-source-registry.js';
import { decodeReviewCursor, getStableReviewStatistics, listReviewSubjectSummaries } from './review-subject-store.js';
import { triageResearchCandidate } from './research-triage.js';
import { NEWS_API_RELEASE_VERSION } from './release-version.js';

// 时间格式化工具函数
function formatToChinaTime(input: Date | string): string {
  const sourceDate = typeof input === 'string' ? new Date(input) : new Date(input.getTime());

  if (Number.isNaN(sourceDate.getTime())) {
    return '未知时间';
  }

  const utcMillis = sourceDate.getTime() + (sourceDate.getTimezoneOffset() * 60_000);
  const shanghaiMillis = utcMillis + (8 * 60 * 60 * 1_000);
  const shanghaiDate = new Date(shanghaiMillis);

  const pad = (value: number) => value.toString().padStart(2, '0');

  const year = shanghaiDate.getFullYear();
  const month = pad(shanghaiDate.getMonth() + 1);
  const day = pad(shanghaiDate.getDate());
  const hour = pad(shanghaiDate.getHours());
  const minute = pad(shanghaiDate.getMinutes());
  const second = pad(shanghaiDate.getSeconds());

  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

/**
 * 从 MinIO 内部 URL 下载图片到临时文件（绕过 devicePusher SSRF 防护）
 */
async function downloadMinioToTemp(imageUrl: string): Promise<string> {
  const path = await import('path');
  const { tmpdir } = await import('os');
  const https = await import('https');
  const http = await import('http');
  const { createWriteStream } = await import('fs');
  const { randomUUID } = await import('crypto');

  const tempFileName = `resend_${randomUUID()}.png`;
  const tempFilePath = path.join(tmpdir(), tempFileName);

  await new Promise<void>((resolve, reject) => {
    const client = imageUrl.startsWith('https:') ? https : http;
    const file = createWriteStream(tempFilePath);
    client.get(imageUrl, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', (err) => {
        file.close();
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });

  return tempFilePath;
}

/**
 * 解析 targetId 到 RenderTarget。优先 BUILTIN_TARGETS（内存常量），
 * 否则查 DB render_targets 表（允许后续运维通过 SQL 增删 target 无需改代码）。
 * 找不到返回 null。
 */
async function resolveLabelTarget(targetId: string): Promise<RenderTarget | null> {
  const builtin = BUILTIN_TARGETS.find(t => t.id === targetId);
  if (builtin) return builtin;

  try {
    const db = await getPostgresDatabase();
    const result = await db.getPool().query<{
      id: string;
      kind: string;
      width_px: number;
      height_px: number;
      dpi: number;
      color_mode: string;
      default_font_stack: string[];
      push_endpoint: string | null;
      physical_w_mm: number | null;
      physical_h_mm: number | null;
    }>(
      `SELECT id, kind, width_px, height_px, dpi, color_mode,
              default_font_stack, push_endpoint, physical_w_mm, physical_h_mm
       FROM render_targets WHERE id = $1`,
      [targetId]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      kind: r.kind as 'eink' | 'thermal-label',
      widthPx: r.width_px,
      heightPx: r.height_px,
      dpi: r.dpi,
      colorMode: r.color_mode as 'mono-1bit' | '3-color',
      defaultFontStack: r.default_font_stack,
      pushEndpoint: r.push_endpoint ?? undefined,
      physical: r.physical_w_mm != null && r.physical_h_mm != null
        ? { widthMm: r.physical_w_mm, heightMm: r.physical_h_mm }
        : undefined,
    };
  } catch (err) {
    console.error('❌ resolveLabelTarget DB 查询失败:', err);
    return null;
  }
}

// RSS源信息
interface RSSSourceInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  profile: 'core' | 'extended' | 'legacy';
}

// 创建Hono应用
const app = new Hono();
const postgres = getPostgresDatabase();
const schedulerEnabledByConfig = (process.env.NEWS_SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false';

// 中间件配置
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    return ALLOWED_ORIGINS.includes(origin) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

// 全局认证中间件：写操作需要 Bearer Token（向后兼容：未配置则跳过）
app.use('*', async (c, next) => {
  const authToken = process.env.API_AUTH_TOKEN;
  if (!authToken) return await next();

  const method = c.req.method;
  if (method === 'GET' || method === 'OPTIONS') return await next();

  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ') || header.slice(7) !== authToken) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  await next();
});

app.use('*', logger());
app.use('*', prettyJSON());

// 静态文件服务 - 提供新闻预览图片
app.get('/images/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    const fs = await import('fs/promises');
    const path = await import('path');

    // 防止路径遍历：规范化路径并限制在目标目录内
    const baseDir = path.resolve('./processed-images/widgets/news');
    const imagePath = path.resolve(baseDir, filename);
    if (!imagePath.startsWith(baseDir)) {
      return c.text('Forbidden', 403);
    }

    // 检查文件是否存在
    try {
      await fs.access(imagePath);
    } catch {
      return c.text('Image not found', 404);
    }

    // 读取文件
    const fileBuffer = await fs.readFile(imagePath);

    // 设置正确的Content-Type
    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000'
      }
    });
  } catch (error) {
    console.error('❌ 获取图片失败:', error);
    return c.text('Internal server error', 500);
  }
});

// MinIO图片代理 - 将请求转发到MinIO
app.get('/api/minio-proxy/*', async (c) => {
  // 从请求路径中提取MinIO对象路径
  const fullPath = c.req.path;
  const requestPath = fullPath.replace('/api/minio-proxy/', '');

  // 防止路径遍历：拒绝包含 .. 的路径，只允许 widgets/ 和 labels/ 前缀
  if (requestPath.includes('..') || (!requestPath.startsWith('widgets/') && !requestPath.startsWith('labels/'))) {
    return c.text('Invalid path', 400);
  }

  // 构建MinIO URL
  const minioUrl = `http://minio:9000/quote0-images/${requestPath}`;
  if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production') {
    console.log(`🔄 MinIO代理请求: ${minioUrl}`);
  }

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(minioUrl, { signal: AbortSignal.timeout(10000) });
      console.log(`📡 MinIO响应状态: ${response.status} (尝试 ${attempt}/${maxAttempts})`);

      if (response.status === 404) {
        console.warn(`⚠️ MinIO未找到对象: ${minioUrl}`);
        return c.text('Image not found', 404);
      }

      if (!response.ok) {
        lastError = new Error(`MinIO responded with ${response.status} ${response.statusText}`);
        console.warn(`⚠️ MinIO返回非200: ${minioUrl} -> ${response.status} ${response.statusText}`);
      } else {
        const imageBuffer = await response.arrayBuffer();
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'image/png',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (error) {
      lastError = error;
      console.error(`❌ MinIO请求异常 (尝试 ${attempt}/${maxAttempts}):`, error);
    }

    if (attempt < maxAttempts) {
      const backoff = attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  console.error('❌ MinIO图片代理失败，已达到最大重试次数:', lastError);
  return c.text('Internal server error', 500);
});

// 集成标注API
app.route('/', annotationApp);

// 集成AX训练管理API
app.route('/api/ax-training', axTrainingApp);

// LLM Providers API
app.route('/', llmProvidersApp);

// Devices CRUD API
app.route('/', devicesApp);

// Inventory API
app.route('/', inventoryApp);
app.route('/', researchCanaryApp);
app.route('/', trmnlCanaryApp);
app.route('/', adaptiveReviewApp);
app.route('/', rendererReviewApp);
app.route('/api/labels', labelsApp);
app.route('/api/label-batches', labelBatchesApp);

// component-labels* 走懒猫 manifest public_path 放行 SSO(外部料号系统需要不登录直连)，
// 独立 Bearer token 鉴权，只作用于这两个路径——不能复用全局 API_AUTH_TOKEN 中间件，
// 那个中间件覆盖全站 /api/*，会连带打挂 label-web 前端走 SSO session 的其他写接口
// (2026-06-25 已有先例踩过这个坑，见 handoff ctx-sun8)。GET 保持公开只读不鉴权。
const requireComponentLabelsToken = async (c: any, next: () => Promise<void>) => {
  const token = process.env.COMPONENT_LABELS_API_TOKEN;
  if (!token) return await next();
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS') return await next();
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ') || header.slice(7) !== token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  await next();
};
app.use('/api/component-labels/*', requireComponentLabelsToken);
app.use('/api/component-label-batches/*', requireComponentLabelsToken);
app.route('/api/component-labels', componentLabelsApp);
app.route('/api/component-label-batches', componentLabelBatchesApp);
app.route('/api/label-sessions', labelSessionsApp);
app.route('/api/memos', memosApp);

// RSS源数据配置
const RSS_SOURCES: Record<string, RSSSourceInfo> = Object.fromEntries(
  Object.values(getRssSourceRegistry()).map((source) => [source.id, {
    id: source.id,
    name: source.name,
    description: source.description,
    category: source.category,
    profile: source.profile,
  }]),
);

// API路由

/**
 * 根路径 - API信息
 */
app.get('/', (c) => {
  return c.json({
    service: 'Modular News API',
    version: NEWS_API_RELEASE_VERSION,
    description: '模块化新闻处理API服务',
    endpoints: {
      'POST /api/news/process': '处理新闻请求',
      'POST /api/news/renderable/push': '接收外部 Agent 成品 JSON，校验、目标感知渲染、推送并写入标注历史',
      'POST /api/news/research/triage': '确定性判断候选内容是否应进入 bounded Neuromancer Research lane（无外部调用）',
      'POST /api/news/research/canary/jobs': '对 research-lane 候选创建 Quote0 持久 research_run，并异步 dispatch 到 Straylight /jobs canary',
      'GET /api/news/research/canary/jobs/:id': '读取 Quote0 持久 research_run 状态/制品',
      'POST /api/news/research/canary/jobs/:id/reconcile': '从 Straylight job + 持久 thread 对账，校验制品并最多执行一次 no-tools finalization retry',
      'GET /api/news/sources': '获取可用RSS源',
      'GET /api/news/scheduler/jobs': '获取所有调度任务',
      'POST /api/news/scheduler/jobs': '创建调度任务',
      'PUT /api/news/scheduler/jobs/:id': '更新调度任务',
      'DELETE /api/news/scheduler/jobs/:id': '删除调度任务',
      'POST /api/news/scheduler/jobs/:id/trigger': '手动触发任务',
      'PATCH /api/news/scheduler/jobs/:id/enabled': '启用/禁用任务',
      'GET /api/news/scheduler/history': '查看推送历史',
      'GET /api/health': '健康检查',
      'GET /api/health/modules': '模块健康状态',
      '--- 标注系统 ---': '---',
      'GET /api/annotation/news': '获取待标注新闻列表',
      'GET /api/annotation/news/:id': '获取新闻详情',
      'POST /api/annotation/news/:id/annotate': '提交标注',
      'PUT /api/annotation/annotations/:id': '更新标注',
      'DELETE /api/annotation/annotations/:id': '删除标注',
      'GET /api/annotation/samples/export': '导出训练样本',
      'POST /api/annotation/news/import/history': '从历史记录导入（推荐）',
      'POST /api/annotation/news/import/rss': '从RSS导入新闻',
      'GET /api/annotation/statistics': '获取标注统计',
      'GET /api/annotation/history': '获取标注历史',
      'POST /api/annotation/batch': '批量标注'
    }
  });
});

/**
 * 处理新闻请求 - 核心API
 */
app.post('/api/news/process', 
  validator('json', (value, c) => {
    const body = value as NewsProcessRequest;
    
    // 基本参数验证（不记录完整 body，避免日志泄露敏感信息）
    if (body.dataSource === 'rss' && body.rssSource && !RSS_SOURCES[body.rssSource]) {
      return c.json({ 
        success: false, 
        error: `不支持的RSS源: ${body.rssSource}。支持的RSS源: ${Object.keys(RSS_SOURCES).join(', ')}` 
      }, 400);
    }
    
    return body;
  }),
  async (c) => {
    const startTime = Date.now();
    
    try {
      const body = await c.req.json() as NewsProcessRequest;
      
      if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production') {
        console.log('🚀 API请求处理开始:', body);
      }

      const processingResult = await processNews(body);

      const response: NewsProcessResponse = {
        success: true,
        data: processingResult.result,
        metadata: {
          processingTime: processingResult.processingTime,
          workflow: processingResult.workflow,
          nodeTimings: {},
          cache: {
            hit: processingResult.cacheHit,
            source: processingResult.cacheSource,
            key: processingResult.cacheKey
          },
          context: processingResult.context
        }
      };

      return c.json(response);
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error('❌ API请求处理失败:', error);
      
      const response: NewsProcessResponse = {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        metadata: {
          processingTime,
          workflow: 'failed',
          nodeTimings: {}
        }
      };

      const status = error instanceof Error && ['参数验证失败', '配置验证失败'].includes(error.message)
        ? 400
        : 500;
      
      return c.json(response, status);
    }
  }
);

/**
 * Research lane 的确定性门禁。
 *
 * 这里只做 selection/budget，不调用 Straylight/Neuromancer，也不修改内容或 DB。
 * 自动 dispatch 必须复用该结果，避免 rich + low-risk 内容误入高成本 Research lane。
 */
app.post('/api/news/research/triage', async (c) => {
  try {
    const body = await c.req.json().catch(() => null) as {
      seed?: { title?: unknown; content?: unknown; source?: unknown; link?: unknown; category?: unknown };
      manual?: unknown;
      conflict?: unknown;
    } | null;
    if (!body?.seed || typeof body.seed.title !== 'string' || !body.seed.title.trim()) {
      return c.json({ success: false, error: 'seed.title 不能为空' }, 400);
    }

    const decision = triageResearchCandidate({
      seed: {
        title: body.seed.title,
        ...(typeof body.seed.content === 'string' ? { content: body.seed.content } : {}),
        ...(typeof body.seed.source === 'string' ? { source: body.seed.source } : {}),
        ...(typeof body.seed.link === 'string' ? { link: body.seed.link } : {}),
        ...(typeof body.seed.category === 'string' ? { category: body.seed.category } : {}),
      },
      manual: body.manual === true,
      conflict: body.conflict === true,
    });

    return c.json({ success: true, data: decision });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Research triage 失败' }, 400);
  }
});

/**
 * 外部 Agent 成品 JSON → Quote0 纯渲染/推送/标注历史。
 *
 * 内容编辑权属于 Neuromancer 等外部 Agent；Quote0 在这里仅负责：
 * schema/layout fail-closed 校验、target-aware render、设备推送、review SSoT 记账。
 */
app.post('/api/news/renderable/push', async (c) => {
  try {
    const body = await c.req.json().catch(() => null) as {
      data?: unknown;
      deviceIds?: unknown;
    } | null;
    const validation = validateRenderableNews(body?.data);
    if (!validation.ok) {
      return c.json({
        success: false,
        error: 'RenderableDataItem 校验失败',
        errors: validation.errors,
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
      }, 422);
    }

    const deviceIds = normalizeRenderableDeviceIds(body?.deviceIds);
    if (body && Object.prototype.hasOwnProperty.call(body, 'deviceIds') && deviceIds?.length === 0) {
      return c.json({ success: false, error: 'deviceIds 必须是至少包含一台设备的字符串数组' }, 400);
    }

    const data = validation.data;
    const fingerprint = computeNewsFingerprint({
      title: data.title,
      link: data.link,
      // 外部 Agent 的 publishTime 可能是生成时间；不让版面修订改变审阅主体身份。
      source: data.source,
      category: data.category,
      fallback: `renderable:${data.id}`,
    });

    const pushResult = await renderAndPushLocalEinkByTarget(data, deviceIds);
    const imagePath = minioImagePathFromRenderedImages(pushResult.renderedImages);
    if (!imagePath) {
      // 渲染失败时绝不能制造一个“已索引但没有预览图”的 review subject。
      // 把渲染反馈交回外部 Agent 修稿；只有真实可审阅制品才进入 Annotation SSoT。
      return c.json({
        success: false,
        error: 'RenderableDataItem 渲染失败，未写入标注历史',
        errors: pushResult.pushResults
          .filter((item) => !item.ok)
          .map((item) => item.error || item.errorCode || item.deviceId || item.device),
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
        review: { indexed: false },
      }, 422);
    }
    const { rawContent, processedContent } = buildRenderablePushContent(data);

    // Annotation / Review 页以 news_push_log 为审阅证据源；直推若不记账，屏上有图但 /annotate 永远找不到。
    await postgres.initialize();
    await postgres.recordPushResult({
      jobId: 'renderable-intake',
      fingerprint,
      title: data.title,
      link: data.link,
      source: data.source,
      category: data.category,
      metadata: {
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
        producer: 'external-renderable-agent',
        renderableId: data.id,
      },
      result: {
        status: pushResult.status,
        succeeded: pushResult.succeeded,
        failed: pushResult.failed,
        devices: pushResult.pushResults,
      },
      rawContent,
      processedContent,
      imagePath,
      layer: 'external-renderable',
      isFallback: false,
      strategySnapshot: {
        mode: 'agent-final-json',
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
      },
    });

    return c.json({
      success: pushResult.ok,
      data: {
        fingerprint,
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
        renderable: data,
        imagePath,
        push: {
          status: pushResult.status,
          succeeded: pushResult.succeeded,
          failed: pushResult.failed,
          devices: pushResult.pushResults,
          renderedImages: pushResult.renderedImages,
        },
        review: {
          indexed: true,
          searchTitle: data.title,
        },
      },
    }, pushResult.ok ? 200 : 502);
  } catch (error) {
    console.error('❌ Renderable intake 推送失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Renderable intake 推送失败',
    }, 500);
  }
});

/**
 * 调度任务管理
 */
app.get('/api/news/scheduler/jobs', async (c) => {
  const jobs = await postgres.getSchedulerJobs();
  const scheduler = schedulerEnabledByConfig ? await ensureSchedulerStarted() : await getSchedulerInstance();
  const summaryMap = new Map<string, any>();
  if (scheduler) {
    for (const summary of scheduler.getSummaries()) {
      summaryMap.set(summary.id, summary);
    }
  }

  const payload = jobs.map((job) => ({
    ...job,
    summary: summaryMap.get(job.id) || null
  }));

  return c.json({ jobs: payload });
});

app.post('/api/news/scheduler/jobs', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  try {
    const body = await c.req.json<NewsSchedulerJobConfig>();
    const scheduler = await ensureSchedulerStarted();
    if (!scheduler) {
      return c.json({ success: false, error: '调度器未启用' }, 503);
    }
    const job = await scheduler.upsertJob(body);
    return c.json({ success: true, job }, 201);
  } catch (error) {
    console.error('❌ 创建调度任务失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 400);
  }
});

app.put('/api/news/scheduler/jobs/:id', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  try {
    const id = c.req.param('id');
    const body = await c.req.json<NewsSchedulerJobConfig>();
    body.id = id;
    const scheduler = await ensureSchedulerStarted();
    if (!scheduler) {
      return c.json({ success: false, error: '调度器未启用' }, 503);
    }
    const job = await scheduler.upsertJob(body);
    return c.json({ success: true, job });
  } catch (error) {
    console.error('❌ 更新调度任务失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 400);
  }
});

app.patch('/api/news/scheduler/jobs/:id', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  try {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<NewsSchedulerJobConfig>>();
    const scheduler = await ensureSchedulerStarted();
    if (!scheduler) {
      return c.json({ success: false, error: '调度器未启用' }, 503);
    }
    const job = await scheduler.patchJob(id, body);
    return c.json({ success: true, job });
  } catch (error) {
    console.error('❌ PATCH 调度任务失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 400);
  }
});

app.delete('/api/news/scheduler/jobs/:id', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  const id = c.req.param('id');
  const scheduler = await ensureSchedulerStarted();
  if (!scheduler) {
    return c.json({ success: false, error: '调度器未启用' }, 503);
  }
  await scheduler.deleteJob(id);
  return c.json({ success: true });
});

app.post('/api/news/scheduler/jobs/:id/trigger', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  const id = c.req.param('id');
  const scheduler = await ensureSchedulerStarted();
  if (!scheduler) {
    return c.json({ success: false, error: '调度器未启用' }, 503);
  }
  try {
    // 支持可选的覆盖索引参数
    let overrideIndex: number | undefined;
    const contentType = c.req.header('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const body = await c.req.json<{ index?: number }>();
        if (typeof body.index === 'number') {
          overrideIndex = body.index;
        }
      } catch (jsonError) {
        console.warn('⚠️ JSON解析错误，使用默认索引:', jsonError instanceof Error ? jsonError.message : String(jsonError));
      }
    }

    await scheduler.triggerJob(id, overrideIndex);
    const result = {
      success: true,
      message: overrideIndex !== undefined
        ? `任务 ${id} 已手动触发，使用索引 ${overrideIndex}`
        : `任务 ${id} 已手动触发，使用调度器默认索引`
    };
    return c.json(result);
  } catch (error) {
    console.error('❌ 手动触发调度任务失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 400);
  }
});

app.patch('/api/news/scheduler/jobs/:id/enabled', async (c) => {
  if (!schedulerEnabledByConfig) {
    return c.json({ success: false, error: '调度器已在配置中禁用' }, 503);
  }
  const id = c.req.param('id');
  const body = await c.req.json<{ enabled: boolean }>();
  const scheduler = await ensureSchedulerStarted();
  if (!scheduler) {
    return c.json({ success: false, error: '调度器未启用' }, 503);
  }
  await scheduler.setJobEnabled(id, body.enabled !== false);
  return c.json({ success: true });
});

app.get('/api/news/scheduler/history', async (c) => {
  // 从环境变量读取最大限制，默认5000
  const MAX_HISTORY_LIMIT = parseInt(process.env.MAX_HISTORY_LIMIT || '5000', 10);

  const limit = Math.max(1, Math.min(Number.isNaN(parseInt(c.req.query('limit') || '50', 10)) ? 50 : parseInt(c.req.query('limit') || '50', 10), MAX_HISTORY_LIMIT));
  const offset = Math.max(0, Number.isNaN(parseInt(c.req.query('offset') || '0', 10)) ? 0 : parseInt(c.req.query('offset') || '0', 10));
  const includeContent = c.req.query('includeContent') === 'true';
  const deduplicate = c.req.query('deduplicate') === 'true'; // 是否去重
  const logs = await postgres.getRecentPushLogs(limit, includeContent, offset, deduplicate);

  // 转换时间为中国标准时间
  const logsWithCST = logs.map(log => ({
    ...log,
    pushedAt: formatToChinaTime(log.pushedAt),
    pushedAtUTC: log.pushedAt // 保留原始UTC时间供参考
  }));

  return c.json({
    logs: logsWithCST,
    timezone: 'Asia/Shanghai (CST)',
    includeContent
  });
});

/**
 * 获取可用RSS源
 */
app.get('/api/news/sources', (c) => {
  const category = c.req.query('category');
  
  let sources = RSS_SOURCES;
  
  // 如果指定了分类，进行过滤
  if (category) {
    sources = Object.fromEntries(
      Object.entries(RSS_SOURCES).filter(([_, source]) => source.category === category)
    );
  }
  
  // 按分类分组
  const groupedSources: Record<string, RSSSourceInfo[]> = {};
  
  for (const [id, source] of Object.entries(sources)) {
    if (!groupedSources[source.category]) {
      groupedSources[source.category] = [];
    }
    groupedSources[source.category].push(source);
  }
  
  return c.json({
    sources: groupedSources,
    total: Object.keys(sources).length,
    categories: Object.keys(groupedSources),
    recommendedSources: RECOMMENDED_RSS_SOURCE_IDS,
  });
});

/**
 * 健康检查 - 基础状态
 */
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: formatToChinaTime(new Date()),
    service: 'Modular News API',
    version: NEWS_API_RELEASE_VERSION,
    timezone: 'Asia/Shanghai (CST)'
  });
});

/**
 * 健康检查 - 模块状态
 */
app.get('/api/health/modules', async (c) => {
  try {
    const healthStatus = await modularNewsPlugin.getModuleHealthStatus();
    
    return c.json({
      status: 'healthy',
      timestamp: formatToChinaTime(new Date()),
      timezone: 'Asia/Shanghai (CST)',
      modules: healthStatus
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: formatToChinaTime(new Date()),
      timezone: 'Asia/Shanghai (CST)',
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * API文档/帮助
 */
app.get('/api/docs', (c) => {
  return c.json({
    title: 'Modular News API 文档',
    version: NEWS_API_RELEASE_VERSION,
    baseUrl: '/api',
    endpoints: {
      'POST /news/process': {
        description: '处理新闻请求',
        parameters: {
          category: 'string (technology|finance|sports) - 新闻分类',
          dataSource: 'string (rss|mock|api|hackernews) - 数据源',
          rssSource: 'string - RSS订阅源ID，当dataSource=rss时使用',
          processor: 'string (passthrough|basic-llm|ax-optimized) - 处理器',
          index: 'number - 新闻条目索引',
          renderer: 'string (news|json|device) - 渲染器',
          options: {
            force: 'boolean - 强制刷新',
            border: 'string (0|1) - 边框设置',
            width: 'number - 图片宽度',
            height: 'number - 图片高度'
          }
        },
        example: {
          category: 'technology',
          dataSource: 'rss',
          rssSource: 'sspai',
          processor: 'ax-optimized', 
          index: 7,
          renderer: 'device',
          options: {
            force: false,
            border: '0'
          }
        }
      },
      'GET /news/sources': {
        description: '获取可用RSS源',
        parameters: {
          category: 'string (可选) - 按分类过滤'
        }
      },
      'GET /health': {
        description: '基础健康检查'
      },
      'GET /health/modules': {
        description: '模块健康状态检查'
      },
      'GET /news/scheduler/jobs': {
        description: '获取所有调度任务列表',
        response: {
          jobs: 'Array<SchedulerJob> - 调度任务列表，包含运行时状态'
        }
      },
      'POST /news/scheduler/jobs': {
        description: '创建新的调度任务',
        parameters: {
          id: 'string - 唯一任务ID',
          name: 'string (可选) - 任务名称',
          description: 'string (可选) - 任务描述',
          category: 'string - 新闻分类 (technology, business, design等)',
          dataSource: 'string - 数据源 (rss, mock等)',
          rssSource: 'string - RSS订阅源ID',
          processor: 'string - 处理器 (passthrough, basic-llm, ax-optimized)',
          renderer: 'string - 渲染器 (device, json, news)',
          intervalMs: 'number - 执行间隔毫秒数',
          intervalMinutes: 'number - 执行间隔分钟数 (与intervalMs二选一)',
          initialDelayMs: 'number (可选) - 初始延迟毫秒数',
          initialDelayMinutes: 'number (可选) - 初始延迟分钟数',
          indexStrategy: {
            type: 'string - 索引策略 (sequential, shuffle, random)',
            poolSize: 'number - 索引池大小',
            startIndex: 'number (可选) - 起始索引，默认0'
          },
          options: 'object (可选) - 额外配置选项',
          enabled: 'boolean (可选) - 是否启用，默认true'
        },
        example: {
          id: 'tech-news-hourly',
          name: '科技新闻每小时推送',
          description: '每小时推送一条优化后的科技新闻到设备',
          category: 'technology',
          dataSource: 'rss',
          rssSource: 'solidot',
          processor: 'ax-optimized',
          renderer: 'device',
          intervalMinutes: 60,
          initialDelayMinutes: 5,
          indexStrategy: {
            type: 'shuffle',
            poolSize: 20,
            startIndex: 0
          },
          options: { border: '0' },
          enabled: true
        }
      },
      'PUT /news/scheduler/jobs/:id': {
        description: '更新现有调度任务',
        parameters: '同创建任务，但id从URL路径获取'
      },
      'DELETE /news/scheduler/jobs/:id': {
        description: '删除调度任务',
        parameters: {
          id: 'string - 从URL路径获取的任务ID'
        }
      },
      'POST /news/scheduler/jobs/:id/trigger': {
        description: '手动触发调度任务执行',
        parameters: {
          id: 'string - 从URL路径获取的任务ID',
          index: 'number (可选) - 覆盖索引值'
        }
      },
      'PATCH /news/scheduler/jobs/:id/enabled': {
        description: '启用或禁用调度任务',
        parameters: {
          enabled: 'boolean - true启用，false禁用'
        }
      },
      'GET /news/scheduler/history': {
        description: '查看推送历史记录',
        parameters: {
          limit: 'number (可选) - 限制返回条数，最大200，默认50'
        }
      }
    },
    availableRSSSources: Object.keys(RSS_SOURCES),
    categories: [...new Set(Object.values(RSS_SOURCES).map(s => s.category))]
  });
});

// 404处理
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'API端点未找到',
    message: '请访问 /api/docs 查看可用的API端点'
  }, 404);
});

/**
 * 获取RSS新闻列表（用于Playground测试）
 */
app.get('/api/rss/list', async (c) => {
  try {
    const rssSource = c.req.query('rssSource') || 'solidot';
    const sourceInfo = RSS_SOURCES[rssSource];
    if (!sourceInfo) {
      return c.json({ success: false, error: `未知 RSS 源: ${rssSource}` }, 400);
    }
    const category = c.req.query('category') || sourceInfo.category;
    const count = Number.isNaN(parseInt(c.req.query('count') || '10', 10)) ? 10 : parseInt(c.req.query('count') || '10', 10);
    const startIndex = Number.isNaN(parseInt(c.req.query('startIndex') || '0', 10)) ? 0 : parseInt(c.req.query('startIndex') || '0', 10);

    // 动态导入RSS数据源
    const { RSSDataSourceModule } = await import('../react-widgets/core/data-sources/rss-data-source.js');
    const rssSourceModule = new RSSDataSourceModule();

    // 获取RSS新闻
    const news = await rssSourceModule.fetchRawData({
      category,
      source: rssSource,
      count,
      startIndex
    });

    // 转换格式
    const formattedNews = news.map((item: any) => ({
      title: item.title,
      description: item.content,
      link: item.metadata?.link || '',
      source: item.source,
      publishTime: item.publishTime
    }));

    return c.json({
      success: true,
      data: formattedNews,
      metadata: {
        category,
        rssSource,
        count: formattedNews.length
      }
    });
  } catch (error) {
    console.error('获取RSS列表失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取RSS列表失败'
    }, 500);
  }
});

// ==================== 调度器管理API ====================

/**
 * 人工评审轻量列表。
 *
 * 与历史 `/api/scheduler/push-history` 不同，这里以稳定 fingerprint 为主体，
 * 先在 news_push_stats 上分页，再只读取当前页主体的最新 delivery。
 * 默认不返回 raw/processed 大 JSON；选中一条后继续使用 detail API 按 id 懒加载。
 */
app.get('/api/review/subjects', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();
    try {
      const parsedLimit = Number.parseInt(c.req.query('limit') || '50', 10);
      const parsedOffset = Number.parseInt(c.req.query('offset') || '0', 10);
      const limit = Math.min(200, Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit));
      const offset = Math.max(0, Number.isNaN(parsedOffset) ? 0 : parsedOffset);
      const cursor = c.req.query('cursor');
      if (cursor && !decodeReviewCursor(cursor)) {
        return c.json({ success: false, error: '无效的分页游标' }, 400);
      }

      const result = await listReviewSubjectSummaries(client, {
        limit,
        offset,
        cursor,
        search: c.req.query('search'),
        // 保持旧 Pagination.total 契约；主体 count 在 ~10k stats 表上仅需数毫秒。
        includeTotal: true,
      });

      const records = result.rows.map((row) => {
        const pushedAt = row.pushed_at ? new Date(row.pushed_at) : null;
        const origin = row.layer === 'external-renderable' || row.job_id === 'renderable-intake'
          ? 'neuromancer'
          : row.signature || row.producer
            ? 'processed'
            : 'delivery';
        return {
          id: row.id,
          fingerprint: row.fingerprint,
          title: row.title || '未知标题',
          originalTitle: row.original_title || row.title,
          imagePath: row.image_path,
          pushedAt: pushedAt ? formatToChinaTime(pushedAt) : null,
          pushedAtUtc: pushedAt ? pushedAt.toISOString() : null,
          pushedAtEpoch: pushedAt ? pushedAt.getTime() : null,
          category: row.category || 'unknown',
          dataSource: row.source || row.job_id || 'unknown',
          annotationStatus: row.annotation_status || 'pending',
          contentOrigin: {
            kind: origin,
            signature: row.signature,
            producer: row.producer,
            jobId: row.job_id,
            layer: row.layer,
            contractVersion: row.contract_version,
          },
        };
      });

      return c.json({
        success: true,
        data: records,
        pagination: {
          total: result.total ?? 0,
          limit,
          offset,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('获取评审主体失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取评审主体失败',
    }, 500);
  }
});

/** 稳定内容主体统计，避免扫描 delivery JSONB。 */
app.get('/api/review/statistics', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();
    try {
      return c.json({ success: true, data: await getStableReviewStatistics(client) });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('获取评审统计失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取评审统计失败',
    }, 500);
  }
});

// 获取推送历史记录（兼容旧调用方；评审 UI 应使用 /api/review/subjects）
app.get('/api/scheduler/push-history', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();

    const limit = Number.isNaN(parseInt(c.req.query('limit') || '50', 10)) ? 50 : parseInt(c.req.query('limit') || '50', 10);
    const offset = Number.isNaN(parseInt(c.req.query('offset') || '0', 10)) ? 0 : parseInt(c.req.query('offset') || '0', 10);
    const search = c.req.query('search') || '';

    const params: any[] = [];
    let paramCount = 0;

    let searchCondition = '';
    if (search) {
      paramCount++;
      searchCondition = ` AND (
        raw_content->>'title' ILIKE $${paramCount}
        OR processed_content->>'title' ILIKE $${paramCount}
        OR processed_content->>'message' ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    const limitParam = paramCount + 1;
    const offsetParam = paramCount + 2;

    const query = `
      WITH latest_ids AS MATERIALIZED (
        SELECT DISTINCT ON (fingerprint) id
        FROM news_push_log
        WHERE fingerprint IS NOT NULL
        ${searchCondition}
        ORDER BY fingerprint, pushed_at DESC
      ), deduped AS (
        SELECT DISTINCT ON (fingerprint)
          log.id,
          log.raw_content,
          log.processed_content,
          log.image_path,
          log.pushed_at,
          log.pushed_at AT TIME ZONE 'UTC' AS pushed_at_utc,
          log.job_id,
          log.annotation_status
        FROM news_push_log AS log
        INNER JOIN latest_ids ON latest_ids.id = log.id
        ORDER BY fingerprint, pushed_at DESC
      ), without_fingerprint AS (
        SELECT
          id,
          raw_content,
          processed_content,
          image_path,
          pushed_at,
          pushed_at AT TIME ZONE 'UTC' AS pushed_at_utc,
          job_id,
          annotation_status
        FROM news_push_log
        WHERE fingerprint IS NULL
        ${searchCondition}
      ), combined AS (
        SELECT * FROM deduped
        UNION ALL
        SELECT * FROM without_fingerprint
      )
      SELECT * FROM combined
      ORDER BY pushed_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const queryParams = [...params, limit, offset];

    const result = await client.query(query, queryParams);

    // 获取总数（去重后）
    const countQuery = `
      SELECT COUNT(*) FROM (
        SELECT fingerprint AS k
        FROM news_push_log
        WHERE fingerprint IS NOT NULL
        ${searchCondition}
        GROUP BY fingerprint
        UNION ALL
        SELECT NULL AS k
        FROM news_push_log
        WHERE fingerprint IS NULL
        ${searchCondition}
      ) t
    `;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    client.release();

    const records = result.rows.map(row => {
      const pushedAtUtcDate = row.pushed_at_utc ? new Date(row.pushed_at_utc) : null;
      const pushedAtLocal = pushedAtUtcDate ? formatToChinaTime(pushedAtUtcDate) : null;
      return {
        id: row.id,
        title: row.processed_content?.title || row.raw_content?.title || '未知标题',
        originalTitle: row.raw_content?.title,
        summary: row.processed_content?.message || row.raw_content?.description,
        imagePath: row.image_path,
        publishTime: row.raw_content?.publishTime,
        pushedAt: pushedAtLocal,
        pushedAtUtc: pushedAtUtcDate ? pushedAtUtcDate.toISOString() : null,
        pushedAtEpoch: pushedAtUtcDate ? pushedAtUtcDate.getTime() : null,
        category: row.raw_content?.category || row.processed_content?.category || 'unknown',
        dataSource: row.raw_content?.source || row.processed_content?.source || row.job_id || 'unknown',
        annotationStatus: row.annotation_status || 'pending',
        rawContent: row.raw_content,
        processedContent: row.processed_content,
      };
    });

    return c.json({
      success: true,
      data: records,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('获取推送历史失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取推送历史失败'
    }, 500);
  }
});

// 获取指定推送记录的详细信息
app.get('/api/scheduler/push-history/:id', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();
    const id = parseInt(c.req.param('id'));

    const result = await client.query(
      'SELECT * FROM news_push_log WHERE id = $1',
      [id]
    );

    client.release();

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: '推送记录不存在'
      }, 404);
    }

    return c.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('获取推送详情失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取推送详情失败'
    }, 500);
  }
});

// 手动推送指定记录 - 直接从 history 渲染，不再走 RSS 拉取
app.post('/api/scheduler/push-history/:id/resend', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();
    const id = parseInt(c.req.param('id'));

    const body = await c.req.json().catch(() => ({})) as {
      renderer?: 'device' | 'local-eink' | 'both';
      /** 仅对 local-eink 生效；省略时推送到全部启用的墨水屏。 */
      deviceIds?: unknown;
    };
    const targetRenderer = body.renderer || 'device';
    const targetDeviceIds = Array.isArray(body.deviceIds)
      ? [...new Set(body.deviceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : undefined;

    if (!['device', 'local-eink', 'both'].includes(targetRenderer)) {
      return c.json({ success: false, error: `不支持的推送目标: ${targetRenderer}` }, 400);
    }
    if (['local-eink', 'both'].includes(targetRenderer) && Array.isArray(body.deviceIds) && targetDeviceIds?.length === 0) {
      return c.json({ success: false, error: '请至少选择一台本地墨水屏' }, 400);
    }

    const result = await client.query(
      'SELECT * FROM news_push_log WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      client.release();
      return c.json({ success: false, error: '推送记录不存在' }, 404);
    }

    const record = result.rows[0];
    client.release();

    // v1.0.19: 天气类型记录走专属路径 — 触发对应 weather job 重新拉数据并渲染
    if (typeof record.fingerprint === 'string' && record.fingerprint.startsWith('weather:')) {
      const city = record.fingerprint.split(':')[1] || '';
      const allJobs = await postgres.getSchedulerJobs();
      const weatherJob = allJobs.find((j: any) =>
        j.dataSource === 'weather' && (j.rssSource === city || (typeof j.id === 'string' && j.id.includes(city)))
      );
      if (!weatherJob) {
        return c.json({
          success: false,
          error: `未找到匹配城市 "${city}" 的 weather job`
        }, 404);
      }
      const scheduler = await getSchedulerInstance();
      if (!scheduler) {
        return c.json({ success: false, error: '调度器未启动' }, 400);
      }
      try {
        await scheduler.triggerJob(weatherJob.id);
        return c.json({
          success: true,
          message: `天气任务 ${weatherJob.id} 已触发重新推送`,
          data: { results: [{ renderer: 'weather-job-trigger', success: true }] }
        });
      } catch (err) {
        return c.json({
          success: false,
          error: `触发 weather job 失败: ${err instanceof Error ? err.message : String(err)}`
        }, 500);
      }
    }

    const { renderingRegistry } = await import('../react-widgets/core/rendering-modules.js');

    const renderers = targetRenderer === 'both' ? ['device', 'local-eink'] : [targetRenderer];
    const results: Array<{
      renderer: string;
      /** 向后兼容：语义为“至少一台设备成功”（= status !== 'failure'）。 */
      success: boolean;
      /** success 全成功 / partial_success 部分成功 / failure 全失败。 */
      status?: PushBatchStatus;
      succeeded?: number;
      failed?: number;
      error?: string;
      /** 逐设备结果；旧字段 device/ok/error 保留，新增 deviceId/errorCode/durationMs。 */
      devices?: DevicePushResult[];
    }> = [];

    const raw = record.raw_content || {};
    const processed = record.processed_content || {};
    const renderableData = {
      id: String(record.id),
      title: processed.title || raw.title || '未知标题',
      message: processed.message || processed.summary || raw.description || raw.content || '',
      signature: processed.signature || 'RSS智能',
      source: processed.source || raw.source || 'unknown',
      publishTime: processed.publishTime || raw.publishTime || record.pushed_at?.toISOString?.() || new Date().toISOString(),
      category: processed.category || raw.category || '新闻',
      link: raw.link,
    };

    // 优先解析原图 URL，避免重渲染导致英文 fallback
    let originalImageUrl: string | null = null;
    if (record.image_path) {
      try {
        const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
        const imageStorage = getImageStorage();
        const objectKey = String(record.image_path).startsWith('/')
          ? String(record.image_path).substring(1)
          : String(record.image_path);
        const existsResult = await imageStorage.imageExistsByObjectKey(objectKey);
        if (existsResult && existsResult.url) {
          originalImageUrl = existsResult.url;
        }
      } catch (e) {
        console.warn('⚠️ resend 解析原图失败，回退重渲染:', e);
      }
    }

    for (const rendererName of renderers) {
      // local-eink 路径按设备运行时真值重新排版；不复用历史 296x152 PNG。
      if (rendererName === 'local-eink') {
        try {
          const pushResult = await renderAndPushLocalEinkByTarget(renderableData as any, targetDeviceIds);
          results.push({
            renderer: rendererName,
            success: pushResult.ok,
            status: pushResult.status,
            succeeded: pushResult.succeeded,
            failed: pushResult.failed,
            error: pushResult.status === 'success' ? undefined : pushResult.deviceResult,
            devices: pushResult.pushResults,
          });
        } catch (error) {
          results.push({ renderer: rendererName, success: false, status: 'failure', succeeded: 0, failed: 0, error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      // 路径 A：有原图 → 下载 temp 再推（不重渲染，杜绝英文 fallback）
      if (originalImageUrl) {
        let tempFilePath: string | null = null;
        try {
          tempFilePath = await downloadMinioToTemp(originalImageUrl);
          const pushResult = await devicePusher.push(
            tempFilePath,
            rendererName as 'device' | 'local-eink',
            rendererName === 'local-eink' && targetDeviceIds ? { deviceIds: targetDeviceIds } : undefined
          );
          results.push({
            renderer: rendererName,
            success: pushResult.ok,
            status: pushResult.status,
            succeeded: pushResult.succeeded,
            failed: pushResult.failed,
            error: pushResult.error,
            devices: pushResult.pushResults,
          });
        } catch (err) {
          results.push({ renderer: rendererName, success: false, status: 'failure', succeeded: 0, failed: 0, error: err instanceof Error ? err.message : String(err) });
        } finally {
          if (tempFilePath) {
            try {
              const fs = await import('fs/promises');
              await fs.unlink(tempFilePath);
            } catch {
              // ignore cleanup error
            }
          }
        }
        continue;
      }

      // 路径 B：无原图 → 保留现有重渲染回退
      const rendererModule = renderingRegistry.get(rendererName);
      if (!rendererModule) {
        results.push({ renderer: rendererName, success: false, error: `渲染器 ${rendererName} 不存在` });
        continue;
      }

      try {
        const renderConfig = { border: '0', width: EINK_DEVICE_WIDTH, height: EINK_DEVICE_HEIGHT };

        console.log(`🔄 重新推送 #${id} → ${rendererName}: "${renderableData.title}"`);
        const renderResult = await rendererModule.render(renderableData as any, renderConfig);

        // 渲染器只生成图片，推送由 DevicePusher 统一处理
        const pusherInput = renderResult.localImagePath || renderResult.imageUrl;
        const pushResult = await devicePusher.push(
          pusherInput,
          rendererName as 'device' | 'local-eink',
          rendererName === 'local-eink' && targetDeviceIds ? { deviceIds: targetDeviceIds } : undefined
        );
        results.push({
          renderer: rendererName,
          success: pushResult.ok,
          status: pushResult.status,
          succeeded: pushResult.succeeded,
          failed: pushResult.failed,
          error: pushResult.error,
          devices: pushResult.pushResults,
        });
      } catch (err) {
        results.push({ renderer: rendererName, success: false, status: 'failure', succeeded: 0, failed: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // 逐设备展平，方便前端直接展示“哪台失败、为什么失败”。
    const deviceResults = results.flatMap((r) => (r.devices ?? []).map((d) => ({ renderer: r.renderer, ...d })));
    const succeededDevices = deviceResults.filter((d) => d.ok).length;
    const failedDevices = deviceResults.length - succeededDevices;

    // 汇总语义：全部 renderer 都 success → success；全部失败 → failure；其余 partial_success。
    const rendererStatuses = results.map((r) => r.status ?? (r.success ? 'success' : 'failure'));
    const overallStatus: PushBatchStatus =
      rendererStatuses.length > 0 && rendererStatuses.every((s) => s === 'success') ? 'success'
      : rendererStatuses.every((s) => s === 'failure') ? 'failure'
      : 'partial_success';
    const allOk = results.every(r => r.success);

    // HTTP 状态码保持 200，部分成功靠 body 表达。
    return c.json({
      success: allOk,
      status: overallStatus,
      message: overallStatus === 'success' ? '重新推送成功'
        : overallStatus === 'partial_success' ? '部分设备推送成功'
        : '推送失败',
      data: {
        results,
        status: overallStatus,
        deviceResults,
        succeeded: succeededDevices,
        failed: failedDevices,
      }
    });
  } catch (error) {
    console.error('重新推送失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '重新推送失败'
    }, 500);
  }
});

// 获取所有调度任务状态
app.get('/api/scheduler/jobs', async (c) => {
  try {
    const scheduler = await getSchedulerInstance();

    if (!scheduler) {
      return c.json({
        success: false,
        error: '调度器未启动',
        data: []
      });
    }

    const summaries = scheduler.getSummaries();

    return c.json({
      success: true,
      data: summaries,
      count: summaries.length
    });
  } catch (error) {
    console.error('获取调度器状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取调度器状态失败'
    }, 500);
  }
});

// 手动触发调度任务
app.post('/api/scheduler/jobs/:jobId/trigger', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const body = await c.req.json().catch(() => ({}));
    const overrideIndex = body.index;

    const scheduler = await getSchedulerInstance();

    if (!scheduler) {
      return c.json({
        success: false,
        error: '调度器未启动'
      }, 400);
    }

    await scheduler.triggerJob(jobId, overrideIndex);

    return c.json({
      success: true,
      message: `任务 ${jobId} 已触发执行`
    });
  } catch (error) {
    console.error('触发调度任务失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '触发调度任务失败'
    }, 500);
  }
});

// 启用/禁用调度任务
app.patch('/api/scheduler/jobs/:jobId/enabled', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const body = await c.req.json();
    const enabled = body.enabled;

    if (typeof enabled !== 'boolean') {
      return c.json({
        success: false,
        error: 'enabled参数必须是布尔值'
      }, 400);
    }

    const scheduler = await getSchedulerInstance();

    if (!scheduler) {
      return c.json({
        success: false,
        error: '调度器未启动'
      }, 400);
    }

    await scheduler.setJobEnabled(jobId, enabled);

    return c.json({
      success: true,
      message: `任务 ${jobId} 已${enabled ? '启用' : '禁用'}`
    });
  } catch (error) {
    console.error('更新调度任务状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '更新调度任务状态失败'
    }, 500);
  }
});

// 重新加载所有调度任务
app.post('/api/scheduler/reload', async (c) => {
  try {
    const scheduler = await getSchedulerInstance();

    if (!scheduler) {
      return c.json({
        success: false,
        error: '调度器未启动'
      }, 400);
    }

    await scheduler.reloadJobs();

    return c.json({
      success: true,
      message: '调度任务已重新加载'
    });
  } catch (error) {
    console.error('重新加载调度任务失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '重新加载调度任务失败'
    }, 500);
  }
});

// 获取单个调度任务的完整信息（包含rssSources）
app.get('/api/scheduler/jobs/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const job = await postgres.getSchedulerJob(jobId);

    if (!job) {
      return c.json({
        success: false,
        error: `未找到任务: ${jobId}`
      }, 404);
    }

    return c.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('获取调度任务失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取调度任务失败'
    }, 500);
  }
});

// 局部更新调度任务（PATCH 语义，未传字段保留原值）
app.patch('/api/scheduler/jobs/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const body = await c.req.json<Partial<NewsSchedulerJobConfig>>();
    const scheduler = await getSchedulerInstance();
    if (!scheduler) {
      return c.json({ success: false, error: '调度器未启动' }, 400);
    }
    const job = await scheduler.patchJob(jobId, body);
    return c.json({ success: true, data: job });
  } catch (error) {
    console.error('PATCH 调度任务失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : 'PATCH 调度任务失败' }, 500);
  }
});

// 更新调度任务的RSS源列表
app.post('/api/scheduler/jobs/:jobId/update-sources', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const body = await c.req.json();
    const rssSources = body.rssSources;

    if (!Array.isArray(rssSources) || rssSources.length === 0) {
      return c.json({
        success: false,
        error: 'rssSources必须是非空数组'
      }, 400);
    }

    // 更新数据库
    await postgres.query(
      'UPDATE news_scheduler_jobs SET rss_sources = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(rssSources), jobId]
    );

    return c.json({
      success: true,
      message: `任务 ${jobId} 的RSS源已更新`
    });
  } catch (error) {
    console.error('更新RSS源失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '更新RSS源失败'
    }, 500);
  }
});

// 禁用/启用单个RSS源
app.post('/api/scheduler/jobs/:jobId/toggle-source', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const body = await c.req.json();
    const { source, enabled } = body;

    if (!source || typeof enabled !== 'boolean') {
      return c.json({
        success: false,
        error: 'source和enabled参数必填'
      }, 400);
    }

    // 获取当前禁用列表
    const result = await postgres.query(
      'SELECT disabled_sources FROM news_scheduler_jobs WHERE id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      return c.json({
        success: false,
        error: `未找到任务: ${jobId}`
      }, 404);
    }

    let disabledSources: string[] = result.rows[0].disabled_sources || [];

    if (enabled) {
      // 启用：从禁用列表中移除
      disabledSources = disabledSources.filter(s => s !== source);
    } else {
      // 禁用：添加到禁用列表
      if (!disabledSources.includes(source)) {
        disabledSources.push(source);
      }
    }

    // 更新数据库
    await postgres.query(
      'UPDATE news_scheduler_jobs SET disabled_sources = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(disabledSources), jobId]
    );

    return c.json({
      success: true,
      message: `RSS源 ${source} 已${enabled ? '启用' : '禁用'}`
    });
  } catch (error) {
    console.error('切换RSS源状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '切换RSS源状态失败'
    }, 500);
  }
});

/**
 * 热敏标签打印 — ADR-0002 Phase C
 * 调用链: REST → labelPrintOrchestrator → thermal-label-rendering → niimbot-push → ESP32
 */
app.post('/api/labels/print', async (c) => {
  try {
    const body = await c.req.json<{
      targetId?: string;
      content: { title: string; subtitle?: string };
      niimbotEndpoint?: string;
      timeout?: number;
      /** 打印浓度 1-5，透传给 niimbot 推送。不传则推送模块默认 1。 */
      density?: number;
    }>();

    // 输入校验
    if (!body.content || typeof body.content.title !== 'string' || body.content.title.trim() === '') {
      return c.json({ success: false, error: 'content.title 必填，且不能为空字符串' }, 400);
    }

    // Target 解析（默认 label-T40x20-320）
    const targetId = body.targetId ?? 'label-T40x20-320';
    const target = await resolveLabelTarget(targetId);
    if (!target) {
      return c.json({ success: false, error: `未知 targetId: ${targetId}` }, 400);
    }
    if (target.kind !== 'thermal-label') {
      return c.json({ success: false, error: `target ${targetId} kind=${target.kind} 不是热敏标签` }, 400);
    }

    // Endpoint 4 级 fallback
    const endpoint =
      body.niimbotEndpoint
      ?? target.pushEndpoint
      ?? process.env.NIIMBOT_ENDPOINT
      ?? null;
    if (!endpoint) {
      return c.json({
        success: false,
        error: '缺少 niimbot endpoint：请提供 body.niimbotEndpoint、配置 render_targets.push_endpoint 列、或设置 NIIMBOT_ENDPOINT 环境变量',
      }, 400);
    }

    console.log(`🏷️  REST 打印请求: targetId=${targetId} title="${body.content.title}" endpoint=${endpoint}`);

    const res = await labelPrintOrchestrator.print({
      data: { title: body.content.title, subtitle: body.content.subtitle },
      target,
      endpoint,
      timeout: body.timeout,
      density: body.density,
    });

    if (res.success) {
      return c.json({
        success: true,
        printId: res.printId,
        bytes: res.bytes,
        httpStatus: res.httpStatus,
        targetId,
        endpoint,
      }, 200);
    }

    // 失败：render 阶段 → 500 (内部错误)，push 阶段 → 502 (下游不可达)
    const statusCode = res.stage === 'render' ? 500 : 502;
    return c.json({
      success: false,
      error: res.error,
      stage: res.stage,
      printId: res.printId,
      httpStatus: res.httpStatus,
    }, statusCode);
  } catch (error) {
    console.error('❌ POST /api/labels/print 失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// ============================================================
// POST /api/labels/voice — 语音标签闭环(供 ESP32-S3 小智调用)
// 输入: { text, targetId? }；输出: packed 1-bit 位图二进制(application/octet-stream)
// 与 /api/labels/print 不同：不 push 给打印机，而是把位图回给设备，由设备自己
// (S3 BLE niimbot) 预览确认后打印。P1 先把语音文本当标题渲染；
// P3 再接 LLM 分析需求 / BizyAir 生图。
// ============================================================
app.post('/api/labels/voice', async (c) => {
  try {
    const body = await c.req.json<{ text: string; targetId?: string }>();
    if (!body.text || typeof body.text !== 'string' || body.text.trim() === '') {
      return c.json({ success: false, error: 'text 必填，且不能为空字符串' }, 400);
    }

    const targetId = body.targetId ?? 'label-T40x20-320';
    const target = await resolveLabelTarget(targetId);
    if (!target) {
      return c.json({ success: false, error: `未知 targetId: ${targetId}` }, 400);
    }
    if (target.kind !== 'thermal-label') {
      return c.json({ success: false, error: `target ${targetId} kind=${target.kind} 不是热敏标签` }, 400);
    }

    // P1: 直接把语音文本当标题渲染（P3 接 LLM 分析/AI 生图后替换这里）
    const data = { title: body.text.trim() };
    console.log(`🎙️  语音标签请求: targetId=${targetId} text="${data.title}"`);
    const r = await thermalLabelRenderer.render(data, target);
    console.log(`✅ 渲染完成回传: ${r.bitmapBuffer.length} bytes / printId=${r.printId}`);

    // 回传 packed 位图二进制 + 尺寸/预览头(S3 据此 BLE 打印)
    const buf = r.bitmapBuffer;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    c.header('Content-Type', 'application/octet-stream');
    c.header('X-Width-Px', String(target.widthPx));
    c.header('X-Height-Px', String(target.heightPx));
    c.header('X-Print-Id', r.printId);
    c.header('X-Title', encodeURIComponent(data.title));
    return c.body(ab as ArrayBuffer);
  } catch (error) {
    console.error('❌ POST /api/labels/voice 失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }, 500);
  }
});

// 获取所有RSS源的元数据
app.get('/api/rss-sources/metadata', async (c) => {
  try {
    const result = await postgres.query(
      'SELECT source_id, display_name, description FROM rss_source_metadata ORDER BY source_id'
    );

    const metadata: Record<string, { displayName: string; description: string }> = {};
    result.rows.forEach((row: { source_id: string; display_name: string | null; description: string | null }) => {
      metadata[row.source_id] = {
        displayName: row.display_name || row.source_id,
        description: row.description || ''
      };
    });

    return c.json({
      success: true,
      data: metadata
    });
  } catch (error) {
    console.error('获取RSS源元数据失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取RSS源元数据失败'
    }, 500);
  }
});

// 更新RSS源元数据
app.post('/api/rss-sources/:sourceId/metadata', async (c) => {
  try {
    const sourceId = c.req.param('sourceId');
    const body = await c.req.json();
    const { displayName, description } = body;

    if (!displayName && !description) {
      return c.json({
        success: false,
        error: 'displayName或description至少需要一个'
      }, 400);
    }

    // 使用 UPSERT
    await postgres.query(
      `INSERT INTO rss_source_metadata (source_id, display_name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_id)
       DO UPDATE SET
         display_name = COALESCE($2, rss_source_metadata.display_name),
         description = COALESCE($3, rss_source_metadata.description),
         updated_at = CURRENT_TIMESTAMP`,
      [sourceId, displayName || null, description || null]
    );

    return c.json({
      success: true,
      message: `RSS源 ${sourceId} 元数据已更新`
    });
  } catch (error) {
    console.error('更新RSS源元数据失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '更新RSS源元数据失败'
    }, 500);
  }
});

// ─── Phase 1 投递可观测（只读）─────────────────────────────────────────

// 投递任务列表。state / device_id 可选过滤，默认最近 50 条。
app.get('/api/deliveries', async (c) => {
  try {
    const state = c.req.query('state');
    const deviceId = c.req.query('device_id');
    const limitRaw = parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

    const conditions: string[] = [];
    const params: any[] = [];
    if (state) {
      params.push(state);
      conditions.push(`state = $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    params.push(limit);

    const result = await postgres.query(
      `SELECT * FROM device_deliveries
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT $${params.length}`,
      params
    );

    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      filters: { state: state || null, deviceId: deviceId || null, limit }
    });
  } catch (error) {
    console.error('获取投递任务列表失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取投递任务列表失败'
    }, 500);
  }
});

// delivery attempt 证据账本：每次重试一行，保留 trace/CRC/ACK/设备状态快照。
app.get('/api/delivery-attempts', async (c) => {
  try {
    const deliveryId = c.req.query('delivery_id');
    const deviceId = c.req.query('device_id');
    const traceId = c.req.query('trace_id');
    const errorCode = c.req.query('error_code');
    const outcome = c.req.query('outcome');
    const limitRaw = parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

    const conditions: string[] = [];
    const params: any[] = [];
    if (deliveryId) {
      if (!/^[1-9]\d*$/.test(deliveryId)) {
        return c.json({ success: false, error: 'delivery_id 必须是正整数' }, 400);
      }
      params.push(deliveryId);
      conditions.push(`delivery_id = $${params.length}::bigint`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (traceId) {
      params.push(traceId);
      conditions.push(`trace_id = $${params.length}`);
    }
    if (errorCode) {
      params.push(errorCode);
      conditions.push(`error_code = $${params.length}`);
    }
    if (outcome) {
      const allowedOutcomes = new Set(['started', 'succeeded', 'retry_wait', 'dead']);
      if (!allowedOutcomes.has(outcome)) {
        return c.json({ success: false, error: 'outcome 必须是 started/succeeded/retry_wait/dead' }, 400);
      }
      params.push(outcome);
      conditions.push(`outcome = $${params.length}`);
    }
    params.push(limit);

    const result = await postgres.query(
      `SELECT * FROM device_delivery_attempts
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT $${params.length}`,
      params,
    );

    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      filters: {
        deliveryId: deliveryId || null,
        deviceId: deviceId || null,
        traceId: traceId || null,
        errorCode: errorCode || null,
        outcome: outcome || null,
        limit,
      },
    });
  } catch (error) {
    console.error('获取 delivery attempt 证据失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取 delivery attempt 证据失败',
    }, 500);
  }
});

// 设备健康告警 outbox：只读诊断，不暴露 Bark key/base 等 secret。
app.get('/api/device-alerts', async (c) => {
  try {
    const deviceId = c.req.query('device_id');
    const state = c.req.query('state');
    const level = c.req.query('level');
    const limitRaw = parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;
    const allowedStates = new Set(['pending', 'leased', 'retry_wait', 'sent', 'dead', 'skipped']);
    const allowedLevels = new Set(['info', 'warning', 'critical']);
    if (state && !allowedStates.has(state)) {
      return c.json({ success: false, error: 'state 非法' }, 400);
    }
    if (level && !allowedLevels.has(level)) {
      return c.json({ success: false, error: 'level 非法' }, 400);
    }

    const conditions: string[] = [];
    const params: any[] = [];
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (state) {
      params.push(state);
      conditions.push(`state = $${params.length}`);
    }
    if (level) {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    params.push(limit);

    const result = await postgres.query(
      `SELECT * FROM device_health_alerts
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT $${params.length}`,
      params,
    );
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      filters: { deviceId: deviceId || null, state: state || null, level: level || null, limit },
    });
  } catch (error) {
    console.error('获取设备健康告警失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '获取设备健康告警失败' }, 500);
  }
});

app.get('/api/device-alerts/status', async (c) => {
  try {
    const result = await postgres.query(
      `SELECT state, count(*)::int AS count
         FROM device_health_alerts
        GROUP BY state ORDER BY state`,
    );
    const states = Object.fromEntries(result.rows.map((row: any) => [row.state, Number(row.count)]));
    return c.json({
      success: true,
      barkConfigured: isBarkAlertsConfigured(),
      states,
    });
  } catch (error) {
    console.error('获取设备健康告警状态失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '获取设备健康告警状态失败' }, 500);
  }
});

// 设备运行时观察值全表。注意：这是观察值，与 push_devices（登记期望值）是两回事。
app.get('/api/devices/runtime', async (c) => {
  try {
    const result = await postgres.query(
      `SELECT * FROM device_runtime_state ORDER BY device_id`
    );
    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('获取设备运行时状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取设备运行时状态失败'
    }, 500);
  }
});

// ============================================================
// GET /api/eink/frame — 拉模式帧缓存端点（Phase A，双栈并存）
// 设备主动轮询拉取最新帧 bitmap，与现有推送路径并存。
// ============================================================
app.get('/api/eink/frame', async (c) => {
  const deviceId = c.req.query('device_id');
  if (!deviceId) {
    return c.json({ success: false, error: 'device_id 必填' }, 400);
  }

  // 鉴权：token 可从 query 或 Authorization header 传入（对齐现有 push 机制）
  const db = getPostgresDatabase();
  let row: any;
  try {
    row = await db.getPushDeviceById(deviceId);
  } catch {
    return c.json({ success: false, error: '查询设备失败' }, 500);
  }
  if (!row) {
    return c.body(null, 404);
  }
  // 仅 display 类设备（eink-local / eink-cloud）
  if (row.kind !== 'eink-local' && row.kind !== 'eink-cloud') {
    return c.body(null, 404);
  }

  // token 验：query token 优先 → Authorization Bearer → 无 token 时设备也未设 token 则放行
  const authHeader = c.req.header('Authorization');
  let presentedToken = c.req.query('token') || '';
  if (!presentedToken && authHeader?.startsWith('Bearer ')) {
    presentedToken = authHeader.slice(7);
  }
  const deviceToken = row.token || '';
  if (deviceToken && presentedToken !== deviceToken) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // 遥测头（可选，记录日志）
  const telemetry = {
    frameId: c.req.header('X-Frame-Id') || undefined,
    firmware: c.req.header('X-Firmware') || undefined,
    freeHeap: c.req.header('X-Free-Heap') || undefined,
    uptime: c.req.header('X-Uptime') || undefined,
    rssi: c.req.header('X-RSSI') || undefined,
    wdReboots: c.req.header('X-Wd-Reboots') || undefined,
  };
  if (Object.values(telemetry).some(v => v !== undefined)) {
    console.log(`📡 设备 ${deviceId} 遥测:`, JSON.stringify(telemetry));
  }

  // 读帧缓存
  const frame = await getDeviceFrame(deviceId);
  if (!frame || !frame.frame_data) {
    return c.body(null, 204);
  }

  // 去重：请求头 X-Frame-Id 与当前帧指纹一致 → 304
  const requestFrameId = c.req.header('X-Frame-Id');
  if (requestFrameId && requestFrameId === frame.frame_id) {
    c.header('X-Frame-Id', frame.frame_id!);
    return c.body(null, 304);
  }

  // 200：返回帧数据
  const refreshSec = parseInt(process.env.EINK_FRAME_REFRESH_SEC || '60', 10);
  c.header('Content-Type', 'application/octet-stream');
  c.header('X-Frame-Id', frame.frame_id!);
  c.header('X-Refresh-Sec', String(refreshSec));
  // frame_data 可能是 Buffer 或 pg 返回的 bytea hex——统一转 Buffer
  const frameData = Buffer.isBuffer(frame.frame_data)
    ? frame.frame_data
    : Buffer.from(frame.frame_data as any, 'hex');
  return c.body(new Uint8Array(frameData));
});

// 错误处理
app.onError((error, c) => {
  console.error('API服务器错误:', error);

  return c.json({
    success: false,
    error: '内部服务器错误'
  }, 500);
});

export default app;
