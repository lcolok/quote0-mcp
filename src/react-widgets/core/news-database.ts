/**
 * SQLite数据库缓存系统
 * 统一管理新闻内容缓存、处理任务状态和RSS快照
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { NewsData } from '../components/NewsWidget.js';

export interface CacheKey {
  source: string;
  category?: string;
  index?: number;
  extra?: Record<string, any>;
}

export interface CacheEntry {
  id: number;
  key: string;
  source: string;
  category?: string;
  index?: number;
  data: NewsData;
  created_at: Date;
  expires_at: Date;
  processing_time?: number;
  metadata?: Record<string, any>;
}

export interface ProcessingTask {
  id: string;
  type: 'news_processing' | 'rss_fetch' | 'llm_optimization';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_params: Record<string, any>;
  output_data?: any;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
  processing_time?: number;
}

export interface RSSSnapshot {
  id: number;
  url: string;
  title: string;
  items_count: number;
  items_hash: string;
  raw_data: any;
  created_at: Date;
  expires_at: Date;
}

export class NewsDatabase {
  private db?: Database;
  private dbPath: string;
  private defaultTTL: number = 30 * 60 * 1000; // 30分钟

  constructor(options: {
    dbPath?: string;
    defaultTTL?: number;
  } = {}) {
    this.dbPath = options.dbPath || resolve(process.cwd(), '.cache', 'news.db');
    this.defaultTTL = options.defaultTTL || this.defaultTTL;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async initialize(): Promise<void> {
    try {
      // 确保目录存在
      const { dirname } = await import('path');
      const { mkdir } = await import('fs/promises');
      await mkdir(dirname(this.dbPath), { recursive: true });

      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.createTables();
      console.log(`🗄️ SQLite数据库已初始化: ${this.dbPath}`);
    } catch (error) {
      console.error('❌ 数据库初始化失败:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('数据库未初始化');

    // 创建新闻缓存表
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS news_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL,
        category TEXT,
        index_num INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        signature TEXT NOT NULL,
        source_name TEXT NOT NULL,
        publish_time TEXT NOT NULL,
        category_name TEXT NOT NULL,
        link TEXT,
        highlights TEXT, -- JSON string
        processing_time INTEGER,
        metadata TEXT, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    // 创建处理任务表
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS processing_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input_params TEXT NOT NULL, -- JSON string
        output_data TEXT, -- JSON string
        error_message TEXT,
        processing_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建RSS快照表
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS rss_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        items_count INTEGER NOT NULL,
        items_hash TEXT NOT NULL,
        raw_data TEXT NOT NULL, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    // 创建索引
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_news_cache_key ON news_cache(key);
      CREATE INDEX IF NOT EXISTS idx_news_cache_source ON news_cache(source, category, index_num);
      CREATE INDEX IF NOT EXISTS idx_news_cache_expires ON news_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON processing_tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_rss_url ON rss_snapshots(url, expires_at);
    `);
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(params: CacheKey): string {
    const keyObject = {
      source: params.source,
      category: params.category || 'default',
      index: params.index ?? 'auto',
      extra: params.extra || {}
    };
    
    const keyString = JSON.stringify(keyObject, Object.keys(keyObject).sort());
    return createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * 获取缓存的新闻数据
   */
  async getCachedNews(cacheKey: CacheKey, force: boolean = false): Promise<NewsData | null> {
    if (!this.db) {
      console.warn('⚠️ 数据库未初始化，跳过缓存查询');
      return null;
    }

    if (force) {
      console.log('🔄 强制刷新，跳过缓存查询');
      return null;
    }

    try {
      const key = this.generateCacheKey(cacheKey);
      const now = new Date().toISOString();

      const row = await this.db.get(`
        SELECT * FROM news_cache 
        WHERE key = ? AND expires_at > ?
      `, [key, now]);

      if (!row) {
        console.log(`📭 缓存未命中: ${key}`);
        return null;
      }

      console.log(`💾 缓存命中: ${key} (来源: ${row.source}, 创建时间: ${row.created_at})`);

      const newsData: NewsData = {
        title: row.title,
        message: row.message,
        signature: row.signature,
        source: row.source_name,
        publishTime: row.publish_time,
        category: row.category_name,
        link: row.link || undefined,
        highlights: row.highlights ? JSON.parse(row.highlights) : undefined
      };

      return newsData;
    } catch (error) {
      console.error('❌ 缓存查询失败:', error);
      return null;
    }
  }

  /**
   * 保存新闻数据到缓存
   */
  async setCachedNews(
    cacheKey: CacheKey, 
    newsData: NewsData, 
    options: {
      ttl?: number;
      processingTime?: number;
    } = {}
  ): Promise<void> {
    if (!this.db) {
      console.warn('⚠️ 数据库未初始化，跳过缓存保存');
      return;
    }

    try {
      const key = this.generateCacheKey(cacheKey);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (options.ttl || this.defaultTTL));

      await this.db.run(`
        INSERT OR REPLACE INTO news_cache (
          key, source, category, index_num, title, message, signature,
          source_name, publish_time, category_name, link, highlights,
          processing_time, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        key,
        cacheKey.source,
        cacheKey.category,
        cacheKey.index,
        newsData.title,
        newsData.message,
        newsData.signature,
        newsData.source,
        newsData.publishTime,
        newsData.category,
        newsData.link,
        newsData.highlights ? JSON.stringify(newsData.highlights) : null,
        options.processingTime,
        expiresAt.toISOString()
      ]);

      const ttlMinutes = Math.round((options.ttl || this.defaultTTL) / 60000);
      console.log(`💾 新闻已缓存: ${key} (TTL: ${ttlMinutes}分钟, 处理时间: ${options.processingTime}ms)`);
    } catch (error) {
      console.error('❌ 缓存保存失败:', error);
    }
  }

  /**
   * 创建处理任务
   */
  async createTask(
    type: ProcessingTask['type'],
    inputParams: Record<string, any>
  ): Promise<string> {
    if (!this.db) throw new Error('数据库未初始化');

    const taskId = createHash('sha256')
      .update(`${type}-${JSON.stringify(inputParams)}-${Date.now()}`)
      .digest('hex')
      .substring(0, 12);

    await this.db.run(`
      INSERT INTO processing_tasks (id, type, input_params, status)
      VALUES (?, ?, ?, 'pending')
    `, [taskId, type, JSON.stringify(inputParams)]);

    console.log(`📝 处理任务已创建: ${taskId} (类型: ${type})`);
    return taskId;
  }

  /**
   * 更新处理任务状态
   */
  async updateTask(
    taskId: string,
    updates: {
      status?: ProcessingTask['status'];
      outputData?: any;
      errorMessage?: string;
      processingTime?: number;
    }
  ): Promise<void> {
    if (!this.db) return;

    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.status) {
      updateFields.push('status = ?');
      updateValues.push(updates.status);
    }
    if (updates.outputData) {
      updateFields.push('output_data = ?');
      updateValues.push(JSON.stringify(updates.outputData));
    }
    if (updates.errorMessage) {
      updateFields.push('error_message = ?');
      updateValues.push(updates.errorMessage);
    }
    if (updates.processingTime) {
      updateFields.push('processing_time = ?');
      updateValues.push(updates.processingTime);
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(taskId);

    await this.db.run(`
      UPDATE processing_tasks 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues);

    console.log(`📝 任务状态更新: ${taskId} → ${updates.status || 'updated'}`);
  }

  /**
   * 保存RSS快照
   */
  async saveRSSSnapshot(url: string, feedData: any, ttl: number = 10 * 60 * 1000): Promise<void> {
    if (!this.db) return;

    const itemsHash = createHash('md5')
      .update(JSON.stringify(feedData.items || []))
      .digest('hex');

    const expiresAt = new Date(Date.now() + ttl);

    await this.db.run(`
      INSERT OR REPLACE INTO rss_snapshots (
        url, title, items_count, items_hash, raw_data, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      url,
      feedData.title || 'Unknown Feed',
      feedData.items?.length || 0,
      itemsHash,
      JSON.stringify(feedData),
      expiresAt.toISOString()
    ]);

    console.log(`📡 RSS快照已保存: ${url} (${feedData.items?.length || 0}条)`);
  }

  /**
   * 获取RSS快照
   */
  async getRSSSnapshot(url: string): Promise<any | null> {
    if (!this.db) return null;

    const row = await this.db.get(`
      SELECT * FROM rss_snapshots 
      WHERE url = ? AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `, [url, new Date().toISOString()]);

    if (row) {
      console.log(`📡 RSS快照命中: ${url} (${row.items_count}条, 创建时间: ${row.created_at})`);
      return JSON.parse(row.raw_data);
    }

    return null;
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<void> {
    if (!this.db) return;

    const now = new Date().toISOString();

    const result1 = await this.db.run(`DELETE FROM news_cache WHERE expires_at < ?`, [now]);
    const result2 = await this.db.run(`DELETE FROM rss_snapshots WHERE expires_at < ?`, [now]);
    
    // 清理7天前的已完成任务
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result3 = await this.db.run(`
      DELETE FROM processing_tasks 
      WHERE status IN ('completed', 'failed') AND created_at < ?
    `, [weekAgo]);

    console.log(`🧹 数据库清理完成: 新闻${result1.changes}条, RSS${result2.changes}条, 任务${result3.changes}条`);
  }

  /**
   * 获取数据库统计信息
   */
  async getStats(): Promise<{
    cachedNews: number;
    activeTasks: number;
    rssSnapshots: number;
  }> {
    if (!this.db) return { cachedNews: 0, activeTasks: 0, rssSnapshots: 0 };

    const now = new Date().toISOString();

    const [news, tasks, rss] = await Promise.all([
      this.db.get(`SELECT COUNT(*) as count FROM news_cache WHERE expires_at > ?`, [now]),
      this.db.get(`SELECT COUNT(*) as count FROM processing_tasks WHERE status IN ('pending', 'running')`),
      this.db.get(`SELECT COUNT(*) as count FROM rss_snapshots WHERE expires_at > ?`, [now])
    ]);

    return {
      cachedNews: news?.count || 0,
      activeTasks: tasks?.count || 0,
      rssSnapshots: rss?.count || 0
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      console.log('🗄️ 数据库连接已关闭');
    }
  }
}

// 导出单例实例
export const newsDatabase = new NewsDatabase();