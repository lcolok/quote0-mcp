// @ts-nocheck
/**
 * Legacy candidate-snapshot API.
 *
 * Historical routes are retained for compatibility, but automatic "training"
 * and deployment are disabled until a held-out evaluation gate exists.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// 动态导入SnapshotManager（避免构建时的模块解析问题）
let SnapshotManager: any;
let snapshotManagerInstance: any;

async function getSnapshotManager() {
  if (!SnapshotManager) {
    const module = await import('../../scripts/ax-training/snapshot-manager.js');
    SnapshotManager = module.SnapshotManager;
  }

  if (!snapshotManagerInstance) {
    snapshotManagerInstance = new SnapshotManager();
    await snapshotManagerInstance.initialize();
  }

  return snapshotManagerInstance;
}

const app = new Hono();

// CORS配置
app.use('/*', cors());

/**
 * 获取所有训练版本列表
 */
app.get('/versions', async (c) => {
  try {
    const manager = await getSnapshotManager();
    const versions = await manager.listVersions();
    const currentVersion = await manager.getCurrentVersion();

    return c.json({
      success: true,
      data: {
        versions: versions.map((v: any) => ({
          ...v,
          isCurrent: v.version === currentVersion
        })),
        currentVersion
      }
    });
  } catch (error) {
    console.error('获取版本列表失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 获取特定版本的详细信息
 */
app.get('/versions/:version', async (c) => {
  try {
    const version = c.req.param('version');
    const manager = await getSnapshotManager();

    const details = await manager.getVersionDetails(version);

    if (!details) {
      return c.json({
        success: false,
        error: '版本不存在'
      }, 404);
    }

    return c.json({
      success: true,
      data: details
    });
  } catch (error) {
    console.error('获取版本详情失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 从评审系统创建不可变数据快照（自动版本号）
 */
app.post('/versions/create', async (c) => {
  try {
    const body = await c.req.json();
    const { description, minScore, maxScore, tags, createdBy } = body;

    // 从标注API获取样本
    const apiUrl = process.env.API_URL || 'http://localhost:3001';
    const samplesUrl = `${apiUrl}/api/annotation/samples/export?minScore=${minScore || 0}&maxScore=${maxScore || 100}`;

    const response = await fetch(samplesUrl);
    if (!response.ok) {
      throw new Error('获取标注样本失败');
    }

    const annotationSamples = await response.json();

    if (annotationSamples.length === 0) {
      return c.json({
        success: false,
        error: '没有符合条件的标注样本'
      }, 400);
    }

    // 转换为评估/提示候选所需的可追溯样本格式。
    const trainingSamples = annotationSamples.map((sample: any, index: number) => ({
      sampleId: index + 1,
      title: sample.original_title,
      newsId: sample.news_id,
      fingerprint: sample.fingerprint,
      newsContent: sample.original_content || sample.original_description || sample.original_title,
      optimizedTitle: sample.optimized_title || sample.processed_title || sample.original_title,
      optimizedSummary: sample.optimized_summary || sample.processed_summary || sample.original_description || '',
      annotatedAt: sample.created_at,
      annotator: sample.annotator,
      score: sample.overall_score,
      source: '标注系统',
      link: sample.link,
      qualityLevel: sample.quality_level
    }));

    // 创建快照（自动生成版本号）
    const manager = await getSnapshotManager();
    const version = await manager.createSnapshot(
      trainingSamples,
      description || '',
      createdBy || 'web-admin',
      tags || []
    );

    return c.json({
      success: true,
      data: {
        version,
        sampleCount: trainingSamples.length
      }
    });
  } catch (error) {
    console.error('创建版本失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 旧“激活”入口已停用；数据快照不能绕过评估门禁进入生产。
 */
app.post('/versions/:version/activate', async (c) => {
  return c.json({
    success: false,
    error: '自动激活已停用：数据快照必须先通过独立留出集评估，不能直接改变生产提示配置。',
    data: { version: c.req.param('version'), requiredGate: 'held-out-evaluation' },
  }, 410);
});

/**
 * 旧“训练”入口已停用：静态示例选择和随机准确率不是模型训练。
 */
app.post('/versions/:version/train', async (c) => {
  const version = c.req.param('version');
  return c.json({
    success: false,
    error: '自动训练已停用：当前实现只是选择 few-shot 示例，且没有独立留出集评估，不能生成可信准确率或自动部署。',
    data: {
      version,
      requiredGate: 'held-out-evaluation',
      replacement: '/api/annotation/samples/export',
    },
  }, 410);
});

/**
 * 比较两个版本
 */
app.get('/versions/compare', async (c) => {
  try {
    const v1 = c.req.query('v1');
    const v2 = c.req.query('v2');

    if (!v1 || !v2) {
      return c.json({
        success: false,
        error: '必须提供两个版本号'
      }, 400);
    }

    const manager = await getSnapshotManager();
    const diff = await manager.compareVersions(v1, v2);

    return c.json({
      success: true,
      data: diff
    });
  } catch (error) {
    console.error('比较版本失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 获取训练统计信息
 */
app.get('/statistics', async (c) => {
  try {
    const manager = await getSnapshotManager();
    const versions = await manager.listVersions();
    const currentVersion = await manager.getCurrentVersion();

    const stats = {
      totalVersions: versions.length,
      currentVersion,
      totalSamples: versions.reduce((sum: number, v: any) => sum + v.sampleCount, 0),
      avgScore: versions.length > 0
        ? versions.reduce((sum: number, v: any) => sum + v.avgScore, 0) / versions.length
        : 0,
      latestVersion: versions[0] || null
    };

    return c.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 更新版本描述
 */
app.patch('/versions/:version/description', async (c) => {
  try {
    const version = c.req.param('version');
    const body = await c.req.json();
    const { description } = body;

    if (description === undefined) {
      return c.json({
        success: false,
        error: '必须提供描述内容'
      }, 400);
    }

    const manager = await getSnapshotManager();
    await manager.updateVersionDescription(version, description);

    return c.json({
      success: true,
      data: {
        version,
        description
      }
    });
  } catch (error) {
    console.error('更新描述失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 重启API服务
 */
app.post('/restart', async (c) => {
  try {
    const { spawn } = await import('child_process');

    // 在后台执行重启命令
    const restartProcess = spawn('docker-compose', ['restart', 'news-api'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore'
    });

    restartProcess.unref();

    return c.json({
      success: true,
      data: {
        message: 'API服务重启命令已发送，服务将在几秒钟后重启',
        estimatedTime: '5-10秒'
      }
    });
  } catch (error) {
    console.error('重启服务失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 检查服务状态
 */
app.get('/status', async (c) => {
  try {
    // 简单的健康检查 - 如果能响应说明服务正在运行
    return c.json({
      success: true,
      data: {
        status: 'running',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

export default app;
