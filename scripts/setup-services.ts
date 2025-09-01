#!/usr/bin/env tsx

/**
 * 自动化服务部署和设置脚本
 * 在全新机器上一键部署所有必要的服务
 */

import { execSync, spawn } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ServiceStatus {
  name: string;
  running: boolean;
  port?: number;
  health?: 'healthy' | 'unhealthy' | 'unknown';
  message?: string;
}

class ServiceSetup {
  private projectRoot = process.cwd();
  
  /**
   * 主要设置流程
   */
  async setup() {
    console.log('🚀 Quote0-MCP 服务自动化部署开始...\n');
    
    try {
      // 1. 环境检查
      await this.checkEnvironment();
      
      // 2. 生成环境配置
      await this.setupEnvironment();
      
      // 3. 启动必要服务
      await this.startServices();
      
      // 4. 等待服务就绪
      await this.waitForServices();
      
      // 5. 健康检查
      await this.healthCheck();
      
      // 6. 显示使用指南
      this.showUsageGuide();
      
    } catch (error) {
      console.error('❌ 设置失败:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
  
  /**
   * 检查运行环境
   */
  private async checkEnvironment() {
    console.log('🔍 检查运行环境...');
    
    // 检查 Docker
    try {
      execSync('docker --version', { stdio: 'pipe' });
      console.log('✅ Docker 已安装');
    } catch {
      throw new Error('Docker 未安装，请先安装 Docker');
    }
    
    // 检查 Docker Compose
    try {
      execSync('docker-compose --version', { stdio: 'pipe' });
      console.log('✅ Docker Compose 已安装');
    } catch {
      console.log('⚠️  Docker Compose V1 未找到，尝试使用 docker compose');
      try {
        execSync('docker compose version', { stdio: 'pipe' });
        console.log('✅ Docker Compose V2 已安装');
      } catch {
        throw new Error('Docker Compose 未安装');
      }
    }
    
    // 检查 Bun
    try {
      execSync('bun --version', { stdio: 'pipe' });
      console.log('✅ Bun 已安装');
    } catch {
      throw new Error('Bun 未安装，请先安装 Bun');
    }
    
    console.log('');
  }
  
  /**
   * 设置环境配置
   */
  private async setupEnvironment() {
    console.log('📝 设置环境配置...');
    
    const envFile = join(this.projectRoot, '.env');
    
    if (!existsSync(envFile)) {
      console.log('📝 创建 .env 文件...');
      
      const envContent = `# 数据库配置 (使用非冲突端口)
DATABASE_URL=postgresql://quote0_user:quote0_password@localhost:25432/quote0_cache

# MinIO对象存储配置 (使用非冲突端口)
MINIO_ENDPOINT=localhost
MINIO_PORT=29000
MINIO_ACCESS_KEY=quote0_minio
MINIO_SECRET_KEY=quote0_minio_password
MINIO_BUCKET=quote0-images

# Redis缓存配置 (使用非冲突端口)
REDIS_URL=redis://localhost:26379

# 缓存配置
CACHE_DATA_TTL=1800000      # 数据缓存TTL: 30分钟
CACHE_IMAGE_TTL=86400000    # 图片缓存TTL: 24小时  
CACHE_RSS_TTL=600000        # RSS快照TTL: 10分钟
ENABLE_STAGED_CACHE=true    # 启用分阶段缓存

# LLM 服务配置
LLM_PROVIDER=custom
LLM_BASE_URL=https://copilot-api.segai.ltd/v1
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-5-mini
LLM_FAST_MODEL=gpt-4o
LLM_MAX_TOKENS=1000
LLM_TEMPERATURE=0.7

# MindReset 设备配置
MINDRESET_DEVICE_ID=E4B063CC0F10
MINDRESET_DEVICE_SECRET=dot_app_pVMhvUteeDqAnibZQtMofYnkJuyaMjEXzgcohArxPyJbEJgnYPTpUcRsalPnEDyr

# 应用配置
NODE_ENV=development
PORT=3000

# 日志配置
LOG_LEVEL=info
LOG_FORMAT=json
`;
      
      writeFileSync(envFile, envContent);
      console.log('✅ .env 文件已创建');
    } else {
      console.log('✅ .env 文件已存在');
    }
    
    console.log('');
  }
  
  /**
   * 启动必要服务
   */
  private async startServices() {
    console.log('🐳 启动 Docker 服务...');
    
    try {
      // 停止现有容器（如果有的话）
      console.log('⏹️  停止现有服务...');
      this.execCommand('docker-compose down', true);
      
      // 启动核心服务
      console.log('🚀 启动核心服务: PostgreSQL, MinIO, Redis...');
      this.execCommand('docker-compose up -d postgres minio redis');
      
      console.log('✅ 服务启动命令已执行');
      
    } catch (error) {
      throw new Error(`服务启动失败: ${error instanceof Error ? error.message : error}`);
    }
    
    console.log('');
  }
  
  /**
   * 等待服务就绪
   */
  private async waitForServices() {
    console.log('⏳ 等待服务就绪...');
    
    const services = [
      { name: 'PostgreSQL', port: 25432, timeout: 30 },
      { name: 'MinIO', port: 29000, timeout: 20 },
      { name: 'Redis', port: 26379, timeout: 15 }
    ];
    
    for (const service of services) {
      console.log(`   等待 ${service.name} (端口 ${service.port})...`);
      await this.waitForPort(service.port, service.timeout);
      console.log(`   ✅ ${service.name} 已就绪`);
    }
    
    console.log('');
  }
  
  /**
   * 健康检查
   */
  private async healthCheck() {
    console.log('🔍 执行健康检查...');
    
    const statuses = await this.getServiceStatuses();
    
    let allHealthy = true;
    for (const status of statuses) {
      const icon = status.running ? '✅' : '❌';
      console.log(`   ${icon} ${status.name}: ${status.running ? '运行中' : '未运行'}`);
      
      if (!status.running) {
        allHealthy = false;
      }
    }
    
    if (!allHealthy) {
      console.log('\n⚠️  部分服务未正常运行，请检查 Docker 状态');
    }
    
    console.log('');
  }
  
  /**
   * 显示使用指南
   */
  private showUsageGuide() {
    console.log('🎉 服务部署完成！');
    console.log('\n📖 快速开始指南:');
    console.log('');
    console.log('1. 检查服务状态:');
    console.log('   bun widget:modular-news --health');
    console.log('');
    console.log('2. 测试天气组件:');
    console.log('   bun widget weather 广州');
    console.log('');
    console.log('3. 测试新闻组件:');
    console.log('   bun widget:modular-news technology rss passthrough 1 json');
    console.log('');
    console.log('4. 使用LLM优化处理:');
    console.log('   bun widget:modular-news technology rss basic-llm 3 device');
    console.log('');
    console.log('5. 使用AX优化处理:');
    console.log('   bun widget:modular-news technology rss ax-optimized 5 device');
    console.log('');
    console.log('🔧 管理命令:');
    console.log('   bun setup         - 重新运行此设置脚本');
    console.log('   docker-compose logs - 查看服务日志');
    console.log('   docker-compose down - 停止所有服务');
    console.log('');
    console.log('🌐 Web界面:');
    console.log('   MinIO控制台: http://localhost:29001');
    console.log('   用户名: quote0_minio');
    console.log('   密码: quote0_minio_password');
    console.log('');
  }
  
  /**
   * 获取服务状态
   */
  private async getServiceStatuses(): Promise<ServiceStatus[]> {
    try {
      const output = execSync('docker ps --format "{{.Names}}:{{.Status}}"', { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      const runningContainers = new Set(
        output.split('\n')
          .filter(line => line.trim())
          .map(line => line.split(':')[0])
      );
      
      return [
        {
          name: 'PostgreSQL',
          running: runningContainers.has('quote0-postgres'),
          port: 25432
        },
        {
          name: 'MinIO',
          running: runningContainers.has('quote0-minio'),
          port: 29000
        },
        {
          name: 'Redis',
          running: runningContainers.has('quote0-redis'),
          port: 26379
        }
      ];
    } catch {
      return [
        { name: 'PostgreSQL', running: false },
        { name: 'MinIO', running: false },
        { name: 'Redis', running: false }
      ];
    }
  }
  
  /**
   * 等待端口可用
   */
  private async waitForPort(port: number, timeoutSeconds: number): Promise<void> {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;
    
    while (Date.now() - startTime < timeout) {
      try {
        execSync(`nc -z localhost ${port}`, { stdio: 'pipe' });
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error(`端口 ${port} 在 ${timeoutSeconds} 秒内未就绪`);
  }
  
  /**
   * 执行命令
   */
  private execCommand(command: string, silent: boolean = false) {
    try {
      return execSync(command, { 
        encoding: 'utf8',
        stdio: silent ? 'pipe' : 'inherit'
      });
    } catch (error) {
      if (!silent) {
        throw error;
      }
    }
  }
}

// 主程序入口
async function main() {
  const setup = new ServiceSetup();
  await setup.setup();
}

// 命令行参数处理
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🚀 Quote0-MCP 服务自动化部署工具

用法: bun setup [选项]

选项:
  -h, --help     显示帮助信息
  
功能:
  - 自动检查运行环境
  - 创建默认环境配置
  - 启动必要的 Docker 服务
  - 执行健康检查
  - 提供使用指南

依赖:
  - Docker
  - Docker Compose
  - Bun

示例:
  bun setup           # 运行完整设置
  `);
  process.exit(0);
}

// 运行设置
if (import.meta.main) {
  main().catch(console.error);
}