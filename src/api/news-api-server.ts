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
import { processNews } from './news-processing-service.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { ensureSchedulerStarted, getSchedulerInstance } from './scheduler-registry.js';
import type { NewsSchedulerJobConfig } from './news-types.js';
import annotationApp from './annotation-api.js';
import axTrainingApp from './ax-training-api.js';

// 时间格式化工具函数
function formatToChinaTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// RSS源信息
interface RSSSourceInfo {
  id: string;
  name: string;
  description: string;
  category: string;
}

// 创建Hono应用
const app = new Hono();
const postgres = getPostgresDatabase();
const schedulerEnabledByConfig = (process.env.NEWS_SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false';

// 中间件配置
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

app.use('*', logger());
app.use('*', prettyJSON());

// 静态文件服务 - 提供新闻预览图片
app.get('/images/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    const fs = await import('fs/promises');
    const path = await import('path');

    const imagePath = path.join('./processed-images/widgets/news', filename);

    // 检查文件是否存在
    try {
      await fs.access(imagePath);
    } catch {
      return c.text('Image not found', 404);
    }

    // 读取文件
    const fileBuffer = await fs.readFile(imagePath);

    // 设置正确的Content-Type
    return new Response(fileBuffer, {
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
  try {
    // 从请求路径中提取MinIO对象路径
    const fullPath = c.req.path;
    const path = fullPath.replace('/api/minio-proxy/', '');

    // 构建MinIO URL
    const minioUrl = `http://minio:9000/quote0-images/${path}`;
    console.log(`🔄 MinIO代理请求: ${minioUrl}`);

    // 从MinIO获取图片
    const response = await fetch(minioUrl);
    console.log(`📡 MinIO响应状态: ${response.status}`);

    if (!response.ok) {
      console.error(`❌ MinIO返回错误: ${response.status} ${response.statusText}`);
      return c.text('Image not found', 404);
    }

    // 获取图片数据
    const imageBuffer = await response.arrayBuffer();

    // 转发响应
    return new Response(imageBuffer, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'  // 允许CORS
      }
    });
  } catch (error) {
    console.error('❌ MinIO图片代理失败:', error);
    return c.text('Internal server error', 500);
  }
});

// 集成标注API
app.route('/', annotationApp);

// 集成AX训练管理API
app.route('/api/ax-training', axTrainingApp);

// RSS源数据配置
const RSS_SOURCES: Record<string, RSSSourceInfo> = {
  // 科技资讯
  solidot: {
    id: 'solidot',
    name: 'Solidot',
    description: '奇客的资讯，重要的东西',
    category: 'technology'
  },
  sspai: {
    id: 'sspai', 
    name: '少数派',
    description: '高效工作，品质生活',
    category: 'technology'
  },
  cnbeta: {
    id: 'cnbeta',
    name: 'cnBeta', 
    description: '中文业界资讯站',
    category: 'technology'
  },
  pingwest: {
    id: 'pingwest',
    name: 'PingWest',
    description: '科技媒体平台',
    category: 'technology'
  },
  techcrunch: {
    id: 'techcrunch',
    name: 'TechCrunch',
    description: '全球科技创业资讯',
    category: 'technology'
  },
  arstechnica: {
    id: 'arstechnica',
    name: 'Ars Technica',
    description: '深度科技分析',
    category: 'technology'
  },
  
  // 商业财经
  '36kr': {
    id: '36kr',
    name: '36氪',
    description: '创投媒体平台',
    category: 'business'
  },
  'reuters-tech': {
    id: 'reuters-tech',
    name: 'Reuters Tech',
    description: '路透社科技新闻',
    category: 'business'
  },
  
  // 设计创意
  'designer-news': {
    id: 'designer-news',
    name: 'Designer News',
    description: '设计师资讯平台',
    category: 'design'
  },
  
  // 开发者
  'github-trending': {
    id: 'github-trending',
    name: 'GitHub Trending',
    description: 'GitHub热门项目',
    category: 'programming'
  },
  'dev-to': {
    id: 'dev-to',
    name: 'DEV Community',
    description: '开发者技术分享',
    category: 'programming'
  },
  'hackernews': {
    id: 'hackernews',
    name: 'Hacker News',
    description: 'Hacker News首页热门文章',
    category: 'technology'
  }
};

// API路由

/**
 * 根路径 - API信息
 */
app.get('/', (c) => {
  return c.json({
    service: 'Modular News API',
    version: '1.0.0',
    description: '模块化新闻处理API服务',
    endpoints: {
      'POST /api/news/process': '处理新闻请求',
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
    
    // 基本参数验证
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
      
      console.log('🚀 API请求处理开始:', body);

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
        // 忽略JSON解析错误，使用默认索引
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

  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10), MAX_HISTORY_LIMIT));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
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
    categories: Object.keys(groupedSources)
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
    version: '1.0.0',
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
    version: '1.0.0',
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
    const category = c.req.query('category') || 'technology';
    const rssSource = c.req.query('rssSource') || 'solidot';
    const count = parseInt(c.req.query('count') || '10', 10);
    const startIndex = parseInt(c.req.query('startIndex') || '0', 10);

    // 动态导入RSS数据源
    const { RSSDataSourceModule } = await import('../react-widgets/core/data-sources/rss-data-source.js');
    const rssSourceModule = new RSSDataSourceModule();

    // 获取RSS新闻
    const news = await rssSourceModule.fetchRawData({
      category,
      rssSource,
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

// 获取推送历史记录
app.get('/api/scheduler/push-history', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();

    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const search = c.req.query('search') || '';

    let query = `
      SELECT
        id,
        raw_content,
        processed_content,
        image_path,
        pushed_at,
        job_id,
        annotation_status
      FROM news_push_log
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (
        raw_content->>'title' ILIKE $${paramCount}
        OR processed_content->>'title' ILIKE $${paramCount}
        OR processed_content->>'message' ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY pushed_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await client.query(query, params);

    // 获取总数
    let countQuery = 'SELECT COUNT(*) FROM news_push_log WHERE 1=1';
    const countParams: any[] = [];
    if (search) {
      countQuery += ` AND (
        raw_content->>'title' ILIKE $1
        OR processed_content->>'title' ILIKE $1
        OR processed_content->>'message' ILIKE $1
      )`;
      countParams.push(`%${search}%`);
    }
    const countResult = await client.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    client.release();

    const records = result.rows.map(row => {
      const pushedAtDate = row.pushed_at ? new Date(row.pushed_at) : null;
      return {
        id: row.id,
        title: row.processed_content?.title || row.raw_content?.title || '未知标题',
        originalTitle: row.raw_content?.title,
        summary: row.processed_content?.message || row.raw_content?.description,
        imagePath: row.image_path,
        publishTime: row.raw_content?.publishTime,
        pushedAt: pushedAtDate ? formatToChinaTime(pushedAtDate) : null,
        pushedAtUtc: pushedAtDate ? pushedAtDate.toISOString() : null,
        pushedAtEpoch: pushedAtDate ? pushedAtDate.getTime() : null,
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

// 手动推送指定记录
app.post('/api/scheduler/push-history/:id/resend', async (c) => {
  try {
    await postgres.initialize();
    const client = await postgres.getClient();
    const id = parseInt(c.req.param('id'));

    // 获取原始记录
    const result = await client.query(
      'SELECT * FROM news_push_log WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      client.release();
      return c.json({
        success: false,
        error: '推送记录不存在'
      }, 404);
    }

    const record = result.rows[0];

    // 使用现有的processNews函数重新推送
    const response = await processNews({
      category: record.category || 'technology',
      dataSource: record.data_source || 'rss',
      processor: 'passthrough', // 使用原有数据，不重新处理
      index: 0,
      renderer: 'device',
      options: {
        // 传递原有的处理结果
        preProcessedData: {
          title: record.processed_content?.title || record.raw_content?.title,
          description: record.processed_content?.message || record.raw_content?.description,
          link: record.raw_content?.link,
          imagePath: record.image_path,
        }
      }
    });

    client.release();

    return c.json({
      success: true,
      message: '重新推送成功',
      data: response
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
    await postgres.pool.query(
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
    const result = await postgres.pool.query(
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
    await postgres.pool.query(
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

// 获取所有RSS源的元数据
app.get('/api/rss-sources/metadata', async (c) => {
  try {
    const result = await postgres.pool.query(
      'SELECT source_id, display_name, description FROM rss_source_metadata ORDER BY source_id'
    );

    const metadata: Record<string, { displayName: string; description: string }> = {};
    result.rows.forEach(row => {
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
    await postgres.pool.query(
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

// 错误处理
app.onError((error, c) => {
  console.error('API服务器错误:', error);

  return c.json({
    success: false,
    error: '内部服务器错误',
    message: error.message
  }, 500);
});

export default app;
