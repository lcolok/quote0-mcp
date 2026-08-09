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
}
