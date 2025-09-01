#!/usr/bin/env bun

/**
 * Hono API服务器启动入口
 * 启动模块化新闻处理API服务
 */

import app from './news-api-server.js';

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || 'localhost';

console.log('🚀 启动模块化新闻API服务器...');
console.log(`📡 服务地址: http://${HOST}:${PORT}`);
console.log(`📚 API文档: http://${HOST}:${PORT}/api/docs`);
console.log(`🔍 健康检查: http://${HOST}:${PORT}/api/health`);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};

// 如果直接运行此文件
if (import.meta.main) {
  console.log('✅ 服务器启动成功！');
}