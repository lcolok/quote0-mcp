#!/usr/bin/env tsx

/**
 * 新闻组件CLI - 使用新的插件系统
 */

import { WidgetCLIEngine } from '../core/widget-cli-engine.js';
import { widgetRegistry } from '../core/widget-registry.js';
import { newsPlugin } from '../plugins/news-plugin.js';

async function main(): Promise<void> {
  // 注册新闻插件
  widgetRegistry.register(newsPlugin);
  
  // 创建CLI引擎
  const engine = new WidgetCLIEngine(widgetRegistry);
  
  const args = process.argv.slice(2);
  
  // 无参数时显示帮助
  if (args.length === 0) {
    engine.showPluginHelp('news');
    return;
  }
  
  // 检查帮助参数
  if (args.includes('--help') || args.includes('-h')) {
    engine.showPluginHelp('news');
    return;
  }
  
  // 执行新闻组件生成
  const context = {
    widgetType: 'news',
    args,
    outputDir: './processed-images/widgets',
    timestamp: Date.now()
  };
  
  const result = await engine.execute(context);
  
  if (!result.success) {
    process.exit(1);
  }
}

// 处理未捕获的错误
process.on('unhandledRejection', (error) => {
  console.error('❌ 未处理的错误:', error);
  process.exit(1);
});

main().catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});