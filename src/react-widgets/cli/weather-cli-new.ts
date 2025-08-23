#!/usr/bin/env tsx

/**
 * 天气组件CLI - 使用新的插件系统
 * 保持与原有weather-cli.ts相同的接口
 */

import { WidgetCLIEngine } from '../core/widget-cli-engine.js';
import { widgetRegistry } from '../core/widget-registry.js';
import { weatherPlugin } from '../plugins/weather-plugin.js';
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
    console.warn('警告：无法加载.env文件，高德API功能可能不可用');
  }
}

async function main(): Promise<void> {
  // 加载环境变量
  loadEnvironment();
  
  // 注册天气插件
  widgetRegistry.register(weatherPlugin);
  
  // 创建CLI引擎
  const engine = new WidgetCLIEngine(widgetRegistry);
  
  const args = process.argv.slice(2);
  
  // 无参数时显示帮助
  if (args.length === 0) {
    engine.showPluginHelp('weather');
    return;
  }
  
  // 执行天气组件生成
  const context = {
    widgetType: 'weather',
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