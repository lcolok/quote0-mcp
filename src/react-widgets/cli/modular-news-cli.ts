#!/usr/bin/env tsx

/**
 * 模块化新闻组件CLI测试工具
 */

import { modularNewsPlugin } from '../plugins/modular-news-plugin.js';
import { readFileSync } from 'fs';

function loadEnvironment(): void {
  try {
    const envContent = readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.trim() && !line.trim().startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
    console.log('✅ 已加载环境变量:', process.cwd() + '/.env');
  } catch (error) {
    console.warn('警告：无法加载.env文件，MinIO和字体服务可能不可用');
  }
}

async function main() {
  // 首先加载环境变量
  loadEnvironment();
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

    // 执行数据获取（带超时处理）
    const startTime = Date.now();
    console.log('⚡ 开始执行数据获取...');
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('执行超时：操作时间超过60秒，请检查服务状态')), 60000);
    });
    
    const result = await Promise.race([
      modularNewsPlugin.getData(params),
      timeoutPromise
    ]);
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
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    
    if (error instanceof Error && error.message.includes('超时')) {
      console.log('\n🔧 故障排除建议:');
      console.log('1. 检查 Docker 服务是否正在运行: docker ps');
      console.log('2. 启动必要的服务: bun setup');
      console.log('3. 检查服务健康状态: bun widget:modular-news --health');
      console.log('4. 查看详细日志: docker-compose logs');
    } else if (error instanceof Error && error.message.includes('连接')) {
      console.log('\n🔧 网络连接问题:');
      console.log('1. 检查网络连接');
      console.log('2. 确认API服务可用');
      console.log('3. 检查防火墙设置');
    }
    
    process.exit(1);
  }
}

// 运行测试
if (import.meta.main) {
  main().catch(console.error);
}