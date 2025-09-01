#!/usr/bin/env tsx

/**
 * 服务状态检查和诊断工具
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

interface ServiceInfo {
  name: string;
  container: string;
  port: number;
  healthEndpoint?: string;
  required: boolean;
}

class ServiceChecker {
  private services: ServiceInfo[] = [
    {
      name: 'PostgreSQL数据库',
      container: 'quote0-postgres',
      port: 25432,
      required: true
    },
    {
      name: 'MinIO对象存储',
      container: 'quote0-minio',
      port: 29000,
      healthEndpoint: 'http://localhost:29000/minio/health/live',
      required: true
    },
    {
      name: 'Redis缓存',
      container: 'quote0-redis',
      port: 26379,
      required: true
    }
  ];
  
  async checkAll() {
    console.log('🔍 Quote0-MCP 服务状态检查\n');
    
    // 检查Docker
    await this.checkDocker();
    
    // 检查环境文件
    await this.checkEnvironment();
    
    // 检查各个服务
    let allHealthy = true;
    for (const service of this.services) {
      const healthy = await this.checkService(service);
      if (service.required && !healthy) {
        allHealthy = false;
      }
    }
    
    // 总结
    this.showSummary(allHealthy);
    
    return allHealthy;
  }
  
  private async checkDocker() {
    console.log('🐳 Docker 环境检查:');
    
    try {
      execSync('docker --version', { stdio: 'pipe' });
      console.log('   ✅ Docker 已安装');
    } catch {
      console.log('   ❌ Docker 未安装');
      return;
    }
    
    try {
      const output = execSync('docker ps', { encoding: 'utf8', stdio: 'pipe' });
      console.log('   ✅ Docker 服务正在运行');
    } catch {
      console.log('   ❌ Docker 服务未运行，请启动 Docker');
    }
    
    console.log('');
  }
  
  private async checkEnvironment() {
    console.log('📝 环境配置检查:');
    
    const envFile = '.env';
    if (existsSync(envFile)) {
      console.log('   ✅ .env 文件存在');
    } else {
      console.log('   ❌ .env 文件不存在，运行 bun setup 创建');
    }
    
    const composeFile = 'docker-compose.yml';
    if (existsSync(composeFile)) {
      console.log('   ✅ docker-compose.yml 存在');
    } else {
      console.log('   ❌ docker-compose.yml 不存在');
    }
    
    console.log('');
  }
  
  private async checkService(service: ServiceInfo): Promise<boolean> {
    console.log(`🔍 ${service.name}:`);
    
    // 检查容器状态
    const containerRunning = this.isContainerRunning(service.container);
    
    if (!containerRunning) {
      console.log(`   ❌ 容器 ${service.container} 未运行`);
      console.log(`   💡 启动命令: docker-compose up -d ${service.container.replace('quote0-', '')}`);
      return false;
    }
    
    console.log(`   ✅ 容器 ${service.container} 正在运行`);
    
    // 检查端口
    const portOpen = await this.checkPort(service.port);
    if (!portOpen) {
      console.log(`   ⚠️  端口 ${service.port} 不可访问`);
      return false;
    }
    
    console.log(`   ✅ 端口 ${service.port} 可访问`);
    
    // 检查健康状态
    if (service.healthEndpoint) {
      const healthy = await this.checkHealth(service.healthEndpoint);
      if (!healthy) {
        console.log(`   ⚠️  健康检查失败: ${service.healthEndpoint}`);
        return false;
      }
      console.log(`   ✅ 健康检查通过`);
    }
    
    console.log('');
    return true;
  }
  
  private isContainerRunning(containerName: string): boolean {
    try {
      const output = execSync(`docker ps --format "{{.Names}}" --filter "name=${containerName}"`, {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return output.trim().includes(containerName);
    } catch {
      return false;
    }
  }
  
  private async checkPort(port: number): Promise<boolean> {
    return new Promise(resolve => {
      try {
        execSync(`nc -z localhost ${port}`, { stdio: 'pipe' });
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }
  
  private async checkHealth(endpoint: string): Promise<boolean> {
    return new Promise(resolve => {
      try {
        execSync(`curl -f "${endpoint}"`, { stdio: 'pipe' });
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }
  
  private showSummary(allHealthy: boolean) {
    console.log('📊 总结:');
    
    if (allHealthy) {
      console.log('   ✅ 所有必要服务运行正常');
      console.log('');
      console.log('🚀 可以开始使用:');
      console.log('   bun widget:modular-news technology rss passthrough 1 json');
      console.log('   bun widget weather 广州');
    } else {
      console.log('   ❌ 部分服务未正常运行');
      console.log('');
      console.log('🔧 修复建议:');
      console.log('   1. 运行完整设置: bun setup');
      console.log('   2. 查看服务日志: docker-compose logs');
      console.log('   3. 重启所有服务: docker-compose restart');
      console.log('   4. 查看详细状态: bun status');
    }
    
    console.log('');
  }
}

// 主程序
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔍 Quote0-MCP 服务状态检查工具

用法: bun run check-services [选项]

选项:
  -h, --help     显示帮助信息
  --json         以JSON格式输出结果
  
功能:
  - 检查Docker环境
  - 检查环境配置文件
  - 检查各服务运行状态
  - 提供修复建议

示例:
  bun run check-services           # 标准检查
  bun run check-services --json    # JSON输出
    `);
    process.exit(0);
  }
  
  const checker = new ServiceChecker();
  const healthy = await checker.checkAll();
  
  process.exit(healthy ? 0 : 1);
}

if (import.meta.main) {
  main().catch(console.error);
}