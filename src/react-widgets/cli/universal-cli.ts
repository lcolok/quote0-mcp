#!/usr/bin/env tsx

/**
 * 通用小组件CLI
 * 支持插件化的组件生成系统
 */

import { WidgetCLIEngine } from '../core/widget-cli-engine.js';
import { widgetRegistry } from '../core/widget-registry.js';
import { weatherPlugin } from '../plugins/weather-plugin.js';
import { newsPlugin } from '../plugins/news-plugin.js';
import { readFileSync } from 'fs';

/**
 * 加载环境变量
 */
function loadEnvironment(): void {
  try {
    const envContent = readFileSync('.env', 'utf8');
    envContent.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        const [key, value] = line.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      }
    });
  } catch (error) {
    console.warn('警告：无法加载.env文件，部分功能可能不可用');
  }
}

/**
 * 注册所有可用插件
 */
function registerPlugins(): void {
  // 注册天气插件
  widgetRegistry.register(weatherPlugin);
  
  // 注册新闻插件
  widgetRegistry.register(newsPlugin);
  
  // 这里可以注册更多插件
  // widgetRegistry.register(stockPlugin);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 加载环境变量
  loadEnvironment();
  
  // 注册插件
  registerPlugins();
  
  // 创建CLI引擎
  const engine = new WidgetCLIEngine(widgetRegistry);
  
  const args = process.argv.slice(2);
  
  // 无参数时显示帮助
  if (args.length === 0) {
    engine.showGeneralHelp();
    return;
  }
  
  const widgetType = args[0];
  
  // 检查帮助参数
  if (args.includes('--help') || args.includes('-h')) {
    engine.showPluginHelp(widgetType);
    return;
  }
  
  // 检查插件是否存在
  if (!widgetRegistry.has(widgetType)) {
    console.error(`❌ 未找到组件类型: ${widgetType}`);
    console.log('\n可用的组件类型:');
    console.log(widgetRegistry.getTypes().join(', '));
    process.exit(1);
  }
  
  // 执行组件生成
  const context = {
    widgetType,
    args: args.slice(1),
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