#!/usr/bin/env bun

/**
 * Hono API服务器启动入口
 * 启动模块化新闻处理API服务
 */

import app from './news-api-server.js';
import { ensureSchedulerStarted } from './scheduler-registry.js';
import { runStartupAssertions } from './startup-assertions.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { startLabelJobWorker } from './label-jobs-worker.js';
import { startDeviceDeliveryWorker } from './device-delivery-worker.js';
import { startDeviceHealthAlertWorker } from './device-health-alerts.js';
import { startRssSourceHealthAlertWorker } from './rss-source-health.js';
import { startResearchCanaryWorker } from './research-canary-worker.js';
import { EINK_TARGET } from '../react-widgets/core/render-targets.js';
import { trmnlAdaptiveRenderer } from '../react-widgets/core/trmnl-adaptive-renderer.js';

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || 'localhost';

console.log('🚀 启动模块化新闻API服务器...');
console.log(`📡 服务地址: http://${HOST}:${PORT}`);
console.log(`📚 API文档: http://${HOST}:${PORT}/api/docs`);
console.log(`🔍 健康检查: http://${HOST}:${PORT}/api/health`);

const shouldStartScheduler = (process.env.NEWS_SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false';
const schedulerPromise = shouldStartScheduler ? ensureSchedulerStarted() : Promise.resolve(null);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};

// 如果直接运行此文件
if (import.meta.main) {
  console.log('✅ 服务器启动成功！');
  if (shouldStartScheduler) {
    schedulerPromise.then((instance) => {
      if (instance) {
        console.log('🛎️ 定时新闻更新已启用');
      }
    });
  }
  // 启动后自检（失败不阻断服务）
  runStartupAssertions(getPostgresDatabase()).catch(e => console.error('❌ 启动断言异常:', e));
  // 启动 label job worker（DB lease 模式，取代 setImmediate fire-and-forget）
  startLabelJobWorker();
  // 启动 device delivery worker（Phase 1：每台设备一条独立、幂等、可重试的投递）
  startDeviceDeliveryWorker();
  // 健康状态迁移通知独立 outbox worker；Bark 网络失败不阻塞 delivery hot path。
  startDeviceHealthAlertWorker();
  // 核心 RSS 源连续抓取失败同样走独立 outbox；避免 Solidot/Tailnet 这类链路静默停产数小时。
  startRssSourceHealthAlertWorker();
  // Research canary 独立于 producer/device hot path：每日硬上限 + 单并发，且绝不自动推屏。
  startResearchCanaryWorker();

  // TRMNL 仍只是 canary；生产权威保持 Current/Satori。生产环境异步预热
  // pinned Framework + Chromium Page，失败只记录日志，不影响 API 健康或真实推屏。
  const trmnlPrewarmEnabled = process.env.NODE_ENV === 'production'
    && (process.env.TRMNL_PREWARM_ENABLED || 'true').toLowerCase() !== 'false';
  if (trmnlPrewarmEnabled) {
    setTimeout(() => {
      void trmnlAdaptiveRenderer.prewarm(EINK_TARGET, { timeoutMs: 30_000 }).then((metrics) => {
        console.log(
          `🔥 TRMNL canary 预热完成: ${metrics.renderMs}ms source=${metrics.assetSource} framework=${metrics.frameworkLoadMs}ms terminalize=${metrics.terminalizeMs}ms`,
        );
      }).catch((error) => {
        console.warn('⚠️ TRMNL canary 预热失败（不影响 Current/Satori）:', error);
      });
    }, 500);
  }
}
