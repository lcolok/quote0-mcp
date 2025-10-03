/**
 * AX模型热重载管理器
 * 监控模型文件变化，自动重新加载，实现零停机更新
 */

import { watch, FSWatcher } from 'fs';
import { readFile, access } from 'fs/promises';
import { EventEmitter } from 'events';

export interface ModelReloadEvent {
  timestamp: string;
  version: string;
  success: boolean;
  error?: string;
}

export class ModelHotReloadManager extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private modelPath: string;
  private isReloading: boolean = false;
  private reloadCallback: (modelData: any) => Promise<boolean>;
  private lastReloadTime: number = 0;
  private debounceMs: number = 1000; // 防抖1秒

  constructor(
    modelPath: string,
    reloadCallback: (modelData: any) => Promise<boolean>
  ) {
    super();
    this.modelPath = modelPath;
    this.reloadCallback = reloadCallback;
  }

  /**
   * 启动热重载监控
   */
  async start(): Promise<void> {
    try {
      // 检查文件是否存在
      await access(this.modelPath);

      // 首次加载模型
      await this.reloadModel();

      // 启动文件监控
      this.watcher = watch(this.modelPath, async (eventType) => {
        if (eventType === 'change') {
          await this.handleFileChange();
        }
      });

      console.log(`🔥 模型热重载已启动: ${this.modelPath}`);
      this.emit('started', { modelPath: this.modelPath });
    } catch (error) {
      console.error(`❌ 热重载启动失败:`, error);
      throw error;
    }
  }

  /**
   * 停止热重载监控
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('🛑 模型热重载已停止');
      this.emit('stopped');
    }
  }

  /**
   * 处理文件变化事件
   */
  private async handleFileChange(): Promise<void> {
    const now = Date.now();

    // 防抖：避免短时间内多次触发
    if (now - this.lastReloadTime < this.debounceMs) {
      return;
    }

    this.lastReloadTime = now;
    await this.reloadModel();
  }

  /**
   * 重新加载模型
   */
  private async reloadModel(): Promise<void> {
    if (this.isReloading) {
      console.log('⏳ 模型正在重载中，跳过此次请求');
      return;
    }

    this.isReloading = true;
    const startTime = Date.now();

    try {
      console.log(`🔄 开始重载模型: ${this.modelPath}`);

      // 读取模型文件
      const fileContent = await readFile(this.modelPath, 'utf-8');
      const modelData = JSON.parse(fileContent);

      // 调用回调函数加载模型
      const success = await this.reloadCallback(modelData);

      if (success) {
        const duration = Date.now() - startTime;
        console.log(`✅ 模型重载成功 (耗时 ${duration}ms)`);

        const event: ModelReloadEvent = {
          timestamp: new Date().toISOString(),
          version: modelData.metadata?.version || 'unknown',
          success: true
        };

        this.emit('reloaded', event);
      } else {
        throw new Error('模型加载回调返回失败');
      }
    } catch (error) {
      console.error(`❌ 模型重载失败:`, error);

      const event: ModelReloadEvent = {
        timestamp: new Date().toISOString(),
        version: 'unknown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };

      this.emit('reload-failed', event);
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * 手动触发重载
   */
  async manualReload(): Promise<boolean> {
    try {
      await this.reloadModel();
      return true;
    } catch (error) {
      console.error('手动重载失败:', error);
      return false;
    }
  }

  /**
   * 获取当前监控状态
   */
  getStatus() {
    return {
      isActive: this.watcher !== null,
      isReloading: this.isReloading,
      modelPath: this.modelPath,
      lastReloadTime: this.lastReloadTime
    };
  }
}
