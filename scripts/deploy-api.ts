#!/usr/bin/env bun

/**
 * 一键部署模块化新闻API服务
 * 自动构建和启动完整的容器化服务栈
 */

import { $ } from 'bun';

interface ServiceInfo {
  name: string;
  container: string;
  port: number;
  healthEndpoint?: string;
  description: string;
}

class APIDeploymentManager {
  private services: ServiceInfo[] = [
    { 
      name: 'PostgreSQL数据库', 
      container: 'quote0-postgres', 
      port: 25432, 
      description: '数据缓存和存储'
    },
    { 
      name: 'MinIO对象存储', 
      container: 'quote0-minio', 
      port: 29000, 
      description: '图片和字体存储'
    },
    { 
      name: 'Redis缓存', 
      container: 'quote0-redis', 
      port: 26379, 
      description: '内存缓存服务'
    },
    { 
      name: '新闻API服务', 
      container: 'quote0-news-api', 
      port: 3001, 
      healthEndpoint: '/api/health',
      description: '模块化新闻处理API'
    }
  ];

  async deploy() {
    console.log('🚀 开始部署模块化新闻API服务栈...\n');
    
    try {
      // 检查Docker环境
      await this.checkDockerEnvironment();
      
      // 停止现有服务
      await this.stopExistingServices();
      
      // 构建和启动服务
      await this.buildAndStartServices();
      
      // 等待服务就绪
      await this.waitForServices();
      
      // 服务健康检查
      await this.performHealthChecks();
      
      // 显示部署结果
      this.showDeploymentSummary();
      
    } catch (error) {
      console.error('❌ 部署失败:', error);
      process.exit(1);
    }
  }

  private async checkDockerEnvironment() {
    console.log('🔍 检查Docker环境...');
    
    try {
      await $`docker --version`.quiet();
      await $`docker-compose --version`.quiet();
      console.log('✅ Docker环境检查通过');
    } catch (error) {
      throw new Error('Docker或Docker Compose未安装，请先安装后再试');
    }
  }

  private async stopExistingServices() {
    console.log('⏹️ 停止现有服务...');
    
    try {
      // 停止特定服务（如果在运行）
      await $`docker-compose down`.quiet();
      console.log('✅ 现有服务已停止');
    } catch (error) {
      console.log('ℹ️ 没有正在运行的服务需要停止');
    }
  }

  private async buildAndStartServices() {
    console.log('🔨 构建并启动服务...');
    console.log('⚠️ 首次构建可能需要几分钟，请耐心等待...\n');
    
    // 启动基础服务
    console.log('1️⃣ 启动基础服务 (PostgreSQL, MinIO, Redis)...');
    await $`docker-compose up -d postgres minio redis`;
    
    // 构建并启动API服务
    console.log('2️⃣ 构建并启动API服务...');
    await $`docker-compose up -d --build news-api`;
    
    console.log('✅ 所有服务启动命令已执行');
  }

  private async waitForServices() {
    console.log('⏳ 等待服务就绪...');
    
    for (const service of this.services) {
      console.log(`   等待 ${service.name} (端口 ${service.port})...`);
      
      let attempts = 0;
      const maxAttempts = 30; // 最多等待30次，每次2秒
      
      while (attempts < maxAttempts) {
        try {
          if (service.healthEndpoint) {
            // API服务使用HTTP健康检查
            const response = await fetch(`http://localhost:${service.port}${service.healthEndpoint}`);
            if (response.ok) {
              console.log(`   ✅ ${service.name} 已就绪`);
              break;
            }
          } else {
            // 基础服务使用端口检查
            await $`nc -z localhost ${service.port}`.quiet();
            console.log(`   ✅ ${service.name} 已就绪`);
            break;
          }
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            console.log(`   ⚠️ ${service.name} 启动超时，但继续部署...`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  private async performHealthChecks() {
    console.log('🔍 执行健康检查...');
    
    // 检查容器状态
    const containers = ['quote0-postgres', 'quote0-minio', 'quote0-redis', 'quote0-news-api'];
    
    for (const container of containers) {
      try {
        const result = await $`docker ps --filter name=${container} --format "table {{.Names}}\\t{{.Status}}"`.text();
        if (result.includes(container)) {
          console.log(`   ✅ 容器 ${container}: 运行中`);
        } else {
          console.log(`   ⚠️ 容器 ${container}: 未运行`);
        }
      } catch (error) {
        console.log(`   ❌ 容器 ${container}: 检查失败`);
      }
    }

    // 检查API服务
    try {
      const response = await fetch('http://localhost:3001/api/health');
      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ API服务: ${data.status} (${data.service} ${data.version})`);
      }
    } catch (error) {
      console.log(`   ⚠️ API服务: 健康检查失败`);
    }
  }

  private showDeploymentSummary() {
    console.log('\n🎉 部署完成！');
    console.log('\n📊 服务概览:');
    
    this.services.forEach(service => {
      console.log(`  • ${service.name}: http://localhost:${service.port}`);
      console.log(`    ${service.description}`);
    });
    
    console.log('\n🔗 重要链接:');
    console.log('  📡 API服务: http://localhost:3001');
    console.log('  📚 API文档: http://localhost:3001/api/docs');
    console.log('  🔍 健康检查: http://localhost:3001/api/health');
    console.log('  📋 RSS源列表: http://localhost:3001/api/news/sources');
    console.log('  🗄️ MinIO控制台: http://localhost:29001 (quote0_minio/quote0_minio_password)');
    
    console.log('\n💡 使用示例:');
    console.log('  # 获取RSS源列表');
    console.log('  curl http://localhost:3001/api/news/sources');
    console.log('');
    console.log('  # 处理新闻 (Mock数据)');
    console.log(`  curl -X POST http://localhost:3001/api/news/process \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"dataSource": "mock", "renderer": "json"}'`);
    console.log('');
    console.log('  # 处理RSS新闻并推送到设备');
    console.log(`  curl -X POST http://localhost:3001/api/news/process \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{`);
    console.log(`      "category": "technology",`);
    console.log(`      "dataSource": "rss",`);
    console.log(`      "rssSource": "sspai",`);
    console.log(`      "processor": "ax-optimized",`);
    console.log(`      "index": 7,`);
    console.log(`      "renderer": "device"`);
    console.log(`    }'`);
    
    console.log('\n🛠️ 管理命令:');
    console.log('  bun run scripts/deploy-api.ts  # 重新部署');
    console.log('  docker-compose logs news-api  # 查看API日志');
    console.log('  docker-compose down          # 停止所有服务');
    console.log('  docker-compose ps            # 查看服务状态');
  }
}

// 主函数
async function main() {
  const manager = new APIDeploymentManager();
  await manager.deploy();
}

if (import.meta.main) {
  main().catch(console.error);
}