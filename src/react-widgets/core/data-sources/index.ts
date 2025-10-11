/**
 * 数据源模块统一导出和注册管理
 */

// 导出基类
export { BaseDataSourceModule } from './base-data-source.js';

// 导出所有数据源模块
export { RSSDataSourceModule } from './rss-data-source.js';
export { MockDataSourceModule } from './mock-data-source.js';
export { APIDataSourceModule } from './api-data-source.js';
export { HackerNewsDataSourceModule } from './hackernews-data-source.js';

// 导入所有模块用于注册
import { RSSDataSourceModule } from './rss-data-source.js';
import { MockDataSourceModule } from './mock-data-source.js';
import { APIDataSourceModule } from './api-data-source.js';
import { HackerNewsDataSourceModule } from './hackernews-data-source.js';

import { 
  DataSourceModule, 
  DataSourceHealthStatus 
} from '../modular-architecture.js';

/**
 * 数据源模块注册表
 * 管理所有可用的数据源模块
 */
export class DataSourceRegistry {
  private modules: Map<string, DataSourceModule> = new Map();
  private readonly healthCheckTimeoutMs = Number(process.env.MODULE_HEALTH_TIMEOUT_MS ?? '5000');
  
  constructor() {
    // 自动注册所有数据源模块
    this.registerDefaultModules();
  }
  
  /**
   * 注册默认的数据源模块
   */
  private registerDefaultModules(): void {
    this.register('rss', new RSSDataSourceModule());
    this.register('mock', new MockDataSourceModule());
    this.register('api', new APIDataSourceModule());
    this.register('hackernews', new HackerNewsDataSourceModule());
    
    console.log(`✅ 数据源注册表初始化完成，共注册 ${this.modules.size} 个模块`);
  }
  
  /**
   * 注册新的数据源模块
   */
  register(name: string, module: DataSourceModule): void {
    this.modules.set(name, module);
    console.log(`✅ 数据源模块已注册: ${name} (${module.name} v${module.version})`);
  }
  
  /**
   * 获取指定名称的数据源模块
   */
  get(name: string): DataSourceModule | undefined {
    return this.modules.get(name);
  }

  /**
   * 获取所有可用的数据源模块名称
   */
  getAvailable(): string[] {
    return Array.from(this.modules.keys());
  }
  
  /**
   * 获取所有数据源模块的详细信息
   */
  getModulesInfo(): Array<{key: string; name: string; version: string; description: string}> {
    return Array.from(this.modules.entries()).map(([key, module]) => ({
      key,
      name: module.name,
      version: module.version,
      description: module.description
    }));
  }

  private createTimeoutStatus(name: string): DataSourceHealthStatus {
    return {
      healthy: false,
      message: `健康检查超时 (${this.healthCheckTimeoutMs}ms) - ${name}`,
      lastChecked: new Date().toISOString(),
      responseTime: this.healthCheckTimeoutMs,
      dataQuality: 0,
      connectionStatus: 'error'
    };
  }

  private createErrorStatus(error: unknown): DataSourceHealthStatus {
    return {
      healthy: false,
      message: `健康检查异常: ${error instanceof Error ? error.message : '未知错误'}`,
      lastChecked: new Date().toISOString(),
      responseTime: 0,
      dataQuality: 0,
      connectionStatus: 'error'
    };
  }

  private async withTimeout<T>(promise: Promise<T>, fallback: () => T): Promise<T> {
    const timeoutMs = this.healthCheckTimeoutMs;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback()), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * 获取指定模块的健康状态
   */
  async getModuleStatus(name: string): Promise<DataSourceHealthStatus | null> {
    const module = this.modules.get(name);
    if (!module) {
      return null;
    }

    try {
      return await this.withTimeout(module.getHealthStatus(), () => this.createTimeoutStatus(name));
    } catch (error) {
      return this.createErrorStatus(error);
    }
  }

  /**
   * 获取所有模块的健康状态
   */
  async getAllModulesStatus(): Promise<Record<string, DataSourceHealthStatus | null>> {
    const status: Record<string, DataSourceHealthStatus | null> = {};

    const statusPromises = Array.from(this.modules.entries()).map(async ([name, module]) => {
      try {
        status[name] = await this.withTimeout(module.getHealthStatus(), () => this.createTimeoutStatus(name));
      } catch (error) {
        status[name] = this.createErrorStatus(error);
      }
    });

    await Promise.all(statusPromises);
    return status;
  }
  
  /**
   * 验证数据源模块是否存在
   */
  exists(name: string): boolean {
    return this.modules.has(name);
  }
  
  /**
   * 移除数据源模块（用于动态管理）
   */
  unregister(name: string): boolean {
    const existed = this.modules.has(name);
    this.modules.delete(name);
    if (existed) {
      console.log(`❌ 数据源模块已移除: ${name}`);
    }
    return existed;
  }
}

// 导出默认的数据源注册表实例
export const dataSourceRegistry = new DataSourceRegistry();
