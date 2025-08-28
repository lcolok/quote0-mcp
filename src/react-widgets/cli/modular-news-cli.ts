#!/usr/bin/env tsx

/**
 * 模块化新闻组件CLI测试工具
 */

import { modularNewsPlugin } from '../plugins/modular-news-plugin.js';

async function main() {
  try {
    console.log('🧩 模块化新闻组件测试开始...\n');

    // 解析命令行参数
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
      console.log(modularNewsPlugin.getUsageHelp());
      return;
    }

    if (args.includes('--health')) {
      console.log('🔍 检查模块健康状态...\n');
      const health = await modularNewsPlugin.getModuleHealthStatus();
      
      console.log('📡 数据源模块状态:');
      for (const [name, status] of Object.entries(health.dataSources)) {
        const icon = status?.healthy ? '✅' : '❌';
        console.log(`  ${icon} ${name}: ${status?.message || '未知状态'}`);
      }
      
      console.log('\n🤖 处理器模块状态:');
      for (const [name, status] of Object.entries(health.processors)) {
        const icon = status?.healthy ? '✅' : '❌';
        console.log(`  ${icon} ${name}: ${status?.message || '未知状态'}`);
      }
      
      console.log('\n🎨 渲染器模块状态:');
      for (const [name, status] of Object.entries(health.renderers)) {
        const icon = status?.healthy ? '✅' : '❌';
        console.log(`  ${icon} ${name}: ${status?.message || '未知状态'}`);
      }
      return;
    }

    // 解析参数和配置
    const { params, config } = modularNewsPlugin.parseCliArgs(args);
    
    // 验证参数
    if (!modularNewsPlugin.validateParams(params)) {
      throw new Error('参数验证失败');
    }
    
    if (!modularNewsPlugin.validateConfig(config)) {
      throw new Error('配置验证失败');
    }

    console.log('🎯 插件:', modularNewsPlugin.meta.name);
    console.log('📋 参数:', params);
    console.log('⚙️  配置:', config);
    console.log('');

    // 执行数据获取
    const startTime = Date.now();
    const result = await modularNewsPlugin.getData(params);
    const duration = Date.now() - startTime;

    console.log(`\\n✅ 模块化新闻处理完成！`);
    console.log(`⏱️  总耗时: ${duration}ms`);
    console.log(`📄 结果类型: ${typeof result}`);
    
    if (typeof result === 'string') {
      if (result.startsWith('http')) {
        console.log(`🖼️  图片URL: ${result}`);
      } else {
        console.log(`📝 文本结果: ${result}`);
      }
    } else {
      console.log('📊 结果数据:', result);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}