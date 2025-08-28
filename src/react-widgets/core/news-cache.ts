/**
 * 新闻组件缓存系统
 * 支持基于请求参数的智能缓存和强制刷新
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { NewsData } from '../components/NewsWidget.js';

export interface CacheKey {
  category?: string;
  index?: number;
  source: string;
  /** 额外参数，用于区分不同的请求配置 */
  extra?: Record<string, any>;
}

export interface CacheEntry {
  key: string;
  data: NewsData;
  timestamp: number;
  ttl: number; // 生存时间（毫秒）
  metadata: {
    source: string;
    category?: string;
    index?: number;
    processingTime?: number;
  };
}

export class NewsCache {
  private cachePath: string;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private defaultTTL: number;

  constructor(options: {
    cacheDir?: string;
    defaultTTL?: number; // 默认TTL：30分钟
  } = {}) {
    const cacheDir = options.cacheDir || '.cache/news';
    this.cachePath = resolve(process.cwd(), cacheDir);
    this.defaultTTL = options.defaultTTL || 30 * 60 * 1000; // 30分钟
    this.ensureCacheDir();
  }

  /**
   * 生成缓存键
   */
  generateKey(cacheKey: CacheKey): string {
    const keyObject = {
      source: cacheKey.source,
      category: cacheKey.category || 'default',
      index: cacheKey.index ?? 'random',
      extra: cacheKey.extra || {}
    };
    
    const keyString = JSON.stringify(keyObject, Object.keys(keyObject).sort());
    return createHash('md5').update(keyString).digest('hex').substring(0, 12);
  }

  /**
   * 获取缓存数据
   */
  async get(cacheKey: CacheKey, force: boolean = false): Promise<NewsData | null> {
    if (force) {
      console.log('🔄 强制刷新，跳过缓存');
      return null;
    }

    const key = this.generateKey(cacheKey);
    
    // 先检查内存缓存
    let entry = this.memoryCache.get(key);
    
    // 如果内存没有，尝试从磁盘加载
    if (!entry) {
      entry = await this.loadFromDisk(key) || undefined;
      if (entry) {
        this.memoryCache.set(key, entry);
      }
    }

    if (!entry) {
      console.log(`📭 缓存未命中: ${key}`);
      return null;
    }

    // 检查是否过期
    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      console.log(`⏰ 缓存已过期: ${key} (${Math.round((now - entry.timestamp) / 1000)}s 前)`);
      await this.delete(key);
      return null;
    }

    const ageSeconds = Math.round((now - entry.timestamp) / 1000);
    console.log(`💾 缓存命中: ${key} (${ageSeconds}s 前, 来源: ${entry.metadata.source})`);
    
    return entry.data;
  }

  /**
   * 设置缓存数据
   */
  async set(
    cacheKey: CacheKey, 
    data: NewsData, 
    options: { 
      ttl?: number;
      processingTime?: number;
    } = {}
  ): Promise<void> {
    const key = this.generateKey(cacheKey);
    const now = Date.now();
    
    const entry: CacheEntry = {
      key,
      data,
      timestamp: now,
      ttl: options.ttl || this.defaultTTL,
      metadata: {
        source: cacheKey.source,
        category: cacheKey.category,
        index: cacheKey.index,
        processingTime: options.processingTime
      }
    };

    // 存储到内存
    this.memoryCache.set(key, entry);
    
    // 同步存储到磁盘（等待完成）
    try {
      await this.saveToDisk(key, entry);
      const ttlMinutes = Math.round(entry.ttl / 60000);
      console.log(`💾 缓存已保存: ${key} (TTL: ${ttlMinutes}分钟, 来源: ${entry.metadata.source})`);
    } catch (err: any) {
      console.warn(`⚠️ 缓存写入磁盘失败: ${err.message}`);
    }
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    
    try {
      const filePath = resolve(this.cachePath, `${key}.json`);
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`⚠️ 删除缓存文件失败: ${err.message}`);
      }
    }
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    
    try {
      const files = await fs.readdir(this.cachePath);
      await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.unlink(resolve(this.cachePath, f)))
      );
      console.log(`🗑️ 已清空缓存目录: ${this.cachePath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`⚠️ 清空缓存失败: ${err.message}`);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    memoryEntries: number;
    diskEntries: number;
    totalSize: number;
    oldestEntry?: { key: string; age: number };
    newestEntry?: { key: string; age: number };
  }> {
    const stats = {
      memoryEntries: this.memoryCache.size,
      diskEntries: 0,
      totalSize: 0,
      oldestEntry: undefined as any,
      newestEntry: undefined as any
    };

    try {
      const files = await fs.readdir(this.cachePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      stats.diskEntries = jsonFiles.length;

      let oldest: { key: string; timestamp: number } | undefined;
      let newest: { key: string; timestamp: number } | undefined;

      for (const file of jsonFiles) {
        const filePath = resolve(this.cachePath, file);
        const stat = await fs.stat(filePath);
        stats.totalSize += stat.size;

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry: CacheEntry = JSON.parse(content);
          
          if (!oldest || entry.timestamp < oldest.timestamp) {
            oldest = { key: entry.key, timestamp: entry.timestamp };
          }
          if (!newest || entry.timestamp > newest.timestamp) {
            newest = { key: entry.key, timestamp: entry.timestamp };
          }
        } catch (err) {
          // 忽略解析错误的文件
        }
      }

      if (oldest) {
        stats.oldestEntry = { 
          key: oldest.key, 
          age: Math.round((Date.now() - oldest.timestamp) / 1000) 
        };
      }
      if (newest) {
        stats.newestEntry = { 
          key: newest.key, 
          age: Math.round((Date.now() - newest.timestamp) / 1000) 
        };
      }
    } catch (err) {
      // 缓存目录不存在或无法读取
    }

    return stats;
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cachePath, { recursive: true });
    } catch (err: any) {
      console.warn(`⚠️ 无法创建缓存目录 ${this.cachePath}: ${err.message}`);
    }
  }

  private async loadFromDisk(key: string): Promise<CacheEntry | null> {
    try {
      const filePath = resolve(this.cachePath, `${key}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  }

  private async saveToDisk(key: string, entry: CacheEntry): Promise<void> {
    try {
      const filePath = resolve(this.cachePath, `${key}.json`);
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (err: any) {
      throw new Error(`缓存写入失败: ${err.message}`);
    }
  }
}

// 导出默认缓存实例
export const defaultNewsCache = new NewsCache();