/**
 * 分阶段缓存管理器
 * 集成PostgreSQL + MinIO + Redis的多层缓存架构
 */

import { getPostgresDatabase, CacheKey } from './postgres-database.js';
import { getImageStorage, ImageCacheMetadata } from './image-storage.js';
import { NewsData } from '../components/NewsWidget.js';
import { createHash } from 'crypto';
import { existsSync } from 'fs';

export interface CacheConfig {
  // 数据缓存TTL
  dataCacheTTL: number;
  // 图片缓存TTL  
  imageCacheTTL: number;
  // RSS快照TTL
  rssSnapshotTTL: number;
  // 是否启用分阶段缓存
  enableStagedCache: boolean;
}

export interface CacheResult<T> {
  data: T;
  source: 'memory' | 'database' | 'storage' | 'original';
  cacheKey: string;
  metadata?: {
    hitTime: number;
    processingTime?: number;
    stage: 'data' | 'image' | 'complete';
  };
}

export class StagedCacheManager {
  private postgres = getPostgresDatabase();
  private imageStorage = getImageStorage();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      dataCacheTTL: 30 * 60 * 1000, // 30分钟
      imageCacheTTL: 24 * 60 * 60 * 1000, // 24小时
      rssSnapshotTTL: 10 * 60 * 1000, // 10分钟
      enableStagedCache: true,
      ...config
    };
  }

  /**
   * 初始化缓存系统
   */
  async initialize(): Promise<void> {
    console.log('🚀 初始化分阶段缓存系统...');
    
    try {
      // 初始化PostgreSQL
      await this.postgres.initialize();
      
      console.log('✅ 分阶段缓存系统初始化完成');
    } catch (error) {
      console.error('❌ 分阶段缓存系统初始化失败:', error);
      throw error;
    }
  }

  /**
   * Stage 1: 获取或缓存新闻数据
   */
  async getOrCacheNewsData(
    cacheKey: CacheKey,
    dataFetcher: () => Promise<NewsData>,
    force: boolean = false
  ): Promise<CacheResult<NewsData>> {
    const startTime = Date.now();
    const key = this.postgres.generateCacheKey(cacheKey);

    try {
      // 1. 尝试从数据库缓存获取
      if (!force) {
        const cachedData = await this.postgres.getCachedNews(cacheKey, false);
        if (cachedData) {
          return {
            data: cachedData,
            source: 'database',
            cacheKey: key,
            metadata: {
              hitTime: Date.now() - startTime,
              stage: 'data'
            }
          };
        }
      }

      // 2. 缓存未命中，获取新数据
      console.log(`🔄 数据缓存未命中，获取原始数据: ${key}`);
      
      // 创建处理任务
      const taskId = await this.postgres.createTask('news_processing', {
        source: cacheKey.source,
        category: cacheKey.category,
        index: cacheKey.index,
        force
      });

      await this.postgres.updateTask(taskId, { status: 'running' });

      try {
        const data = await dataFetcher();
        const processingTime = Date.now() - startTime;

        // 3. 保存到数据库缓存
        const newsCacheId = await this.postgres.setCachedNews(cacheKey, data, {
          ttl: this.config.dataCacheTTL,
          processingTime
        });

        await this.postgres.updateTask(taskId, {
          status: 'completed',
          outputData: { newsCacheId, ...data },
          processingTime
        });

        return {
          data,
          source: 'original',
          cacheKey: key,
          metadata: {
            hitTime: Date.now() - startTime,
            processingTime,
            stage: 'data'
          }
        };

      } catch (error) {
        const processingTime = Date.now() - startTime;
        await this.postgres.updateTask(taskId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          processingTime
        });
        throw error;
      }

    } catch (error) {
      console.error('❌ Stage 1 数据缓存失败:', error);
      throw error;
    }
  }

  /**
   * Stage 2: 获取或缓存渲染图片
   */
  async getOrCacheRenderedImage(
    newsCacheResult: CacheResult<NewsData>,
    renderConfig: Record<string, any>,
    imageRenderer: (data: NewsData, config: Record<string, any>) => Promise<string>,
    force: boolean = false
  ): Promise<CacheResult<string>> {
    const startTime = Date.now();
    
    // 生成图片缓存键（基于新闻数据和渲染配置）
    const imageCacheKey = this.generateImageCacheKey(
      newsCacheResult.cacheKey,
      renderConfig
    );

    try {
      // 1. 检查数据库中的图片缓存记录
      if (!force) {
        const cachedImageInfo = await this.postgres.getCachedImage(imageCacheKey);
        if (cachedImageInfo) {
          console.log(`🖼️ 图片缓存命中: ${imageCacheKey} (对象: ${cachedImageInfo.objectKey})`);
          
          // 2. 验证MinIO中的图片是否存在（使用数据库中的确切路径）
          const imageResult = await this.imageStorage.imageExistsByObjectKey(cachedImageInfo.objectKey);
          
          if (imageResult) {
            console.log(`🖼️ 图片完全缓存命中: ${imageCacheKey} → ${imageResult.url}`);
            return {
              data: imageResult.url,
              source: 'storage',
              cacheKey: imageCacheKey,
              metadata: {
                hitTime: Date.now() - startTime,
                stage: 'complete'
              }
            };
          } else {
            // 数据库记录存在但MinIO对象丢失，清理数据库记录
            console.log(`⚠️ 图片对象丢失，清理数据库记录: ${imageCacheKey} (${cachedImageInfo.objectKey})`);
            // TODO: 这里可以添加清理逻辑删除数据库中的无效记录
          }
        }
      }

      // 3. 缓存未命中，执行图片渲染
      console.log(`🎨 图片缓存未命中，开始渲染: ${imageCacheKey}`);
      
      const renderTaskId = await this.postgres.createTask('image_render', {
        newsCacheKey: newsCacheResult.cacheKey,
        renderConfig,
        force
      });

      await this.postgres.updateTask(renderTaskId, { status: 'running' });

      try {
        const imagePath = await imageRenderer(newsCacheResult.data, renderConfig);
        
        if (!existsSync(imagePath)) {
          throw new Error(`渲染的图片文件不存在: ${imagePath}`);
        }

        // 4. 上传图片到MinIO
        const imageMetadata: ImageCacheMetadata = {
          widgetType: renderConfig.widgetType || 'news',
          cacheKey: imageCacheKey,
          renderConfig,
          originalPath: imagePath
        };

        const uploadResult = await this.imageStorage.uploadImage(imagePath, imageMetadata);
        
        // 5. 保存图片缓存信息到数据库
        const imageCacheId = await this.postgres.setCachedImage({
          cacheKey: imageCacheKey,
          bucketName: uploadResult.bucket,
          objectKey: uploadResult.objectKey,
          objectSize: uploadResult.size,
          contentType: uploadResult.contentType,
          etag: uploadResult.etag,
          widgetType: imageMetadata.widgetType,
          renderConfig,
          ttl: this.config.imageCacheTTL
        });

        const processingTime = Date.now() - startTime;
        
        await this.postgres.updateTask(renderTaskId, {
          status: 'completed',
          outputData: { 
            imageCacheId,
            url: uploadResult.url,
            objectKey: uploadResult.objectKey 
          },
          processingTime
        });

        console.log(`✅ 图片渲染和缓存完成: ${imageCacheKey} → ${uploadResult.url}`);

        return {
          data: uploadResult.url,
          source: 'original',
          cacheKey: imageCacheKey,
          metadata: {
            hitTime: Date.now() - startTime,
            processingTime,
            stage: 'complete'
          }
        };

      } catch (error) {
        const processingTime = Date.now() - startTime;
        await this.postgres.updateTask(renderTaskId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          processingTime
        });
        throw error;
      }

    } catch (error) {
      console.error('❌ Stage 2 图片缓存失败:', error);
      throw error;
    }
  }

  /**
   * 完整的分阶段缓存流程
   */
  async processWithStagedCache(
    cacheKey: CacheKey,
    renderConfig: Record<string, any>,
    dataFetcher: () => Promise<NewsData>,
    imageRenderer: (data: NewsData, config: Record<string, any>) => Promise<string>,
    force: boolean = false
  ): Promise<{
    newsData: CacheResult<NewsData>;
    imageUrl: CacheResult<string>;
    totalTime: number;
    cacheEfficiency: {
      dataStage: 'hit' | 'miss';
      imageStage: 'hit' | 'miss';
      overallHit: boolean;
    };
  }> {
    const totalStartTime = Date.now();

    try {
      console.log('🔄 开始分阶段缓存处理流程...');

      // Stage 1: 新闻数据缓存
      const newsResult = await this.getOrCacheNewsData(cacheKey, dataFetcher, force);
      
      // Stage 2: 图片渲染缓存
      const imageResult = await this.getOrCacheRenderedImage(
        newsResult,
        renderConfig,
        imageRenderer,
        force
      );

      const totalTime = Date.now() - totalStartTime;
      
      const cacheEfficiency = {
        dataStage: newsResult.source === 'database' ? 'hit' : 'miss' as 'hit' | 'miss',
        imageStage: imageResult.source === 'storage' ? 'hit' : 'miss' as 'hit' | 'miss',
        overallHit: newsResult.source !== 'original' && imageResult.source !== 'original'
      };

      console.log(`✅ 分阶段缓存完成: 总耗时${totalTime}ms, 数据缓存${cacheEfficiency.dataStage}, 图片缓存${cacheEfficiency.imageStage}`);

      return {
        newsData: newsResult,
        imageUrl: imageResult,
        totalTime,
        cacheEfficiency
      };

    } catch (error) {
      console.error('❌ 分阶段缓存流程失败:', error);
      throw error;
    }
  }

  /**
   * 获取RSS快照（集成原有逻辑）
   */
  async getOrCacheRSSSnapshot(
    url: string,
    rssFetcher: () => Promise<any>
  ): Promise<any> {
    // 先尝试从数据库获取RSS快照
    let feed = await this.postgres.getRSSSnapshot(url);
    
    if (!feed) {
      // 快照未命中，获取新的RSS数据
      console.log(`📡 RSS快照未命中，获取新数据: ${url}`);
      feed = await rssFetcher();
      
      // 保存RSS快照到数据库
      await this.postgres.saveRSSSnapshot(url, feed, this.config.rssSnapshotTTL);
    } else {
      console.log(`📡 RSS快照命中: ${url}`);
    }
    
    return feed;
  }

  /**
   * 生成图片缓存键
   */
  private generateImageCacheKey(
    newsCacheKey: string,
    renderConfig: Record<string, any>
  ): string {
    const keyObject = {
      news: newsCacheKey,
      config: renderConfig
    };
    
    const keyString = JSON.stringify(keyObject, Object.keys(keyObject).sort());
    return createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * 强制清空所有缓存
   */
  async clearAllCache(): Promise<void> {
    console.log('🧹 开始清空所有缓存...');
    
    try {
      // 清理数据库缓存
      const dbCleanup = await this.postgres.cleanup();
      
      // 清理MinIO过期图片
      const minioCleanup = await this.imageStorage.cleanupExpiredImages();
      
      console.log(`✅ 缓存清理完成: 数据库${dbCleanup.news + dbCleanup.rss + dbCleanup.images + dbCleanup.tasks}条, MinIO${minioCleanup}个文件`);
    } catch (error) {
      console.error('❌ 清空缓存失败:', error);
      throw error;
    }
  }

  /**
   * 获取缓存系统统计信息
   */
  async getCacheStats(): Promise<{
    database: any;
    storage: any;
    performance: {
      avgDataFetchTime: number;
      avgImageRenderTime: number;
      cacheHitRate: {
        data: string;
        image: string;
        overall: string;
      };
    };
  }> {
    try {
      const [dbStats, storageStats] = await Promise.all([
        this.postgres.getStats(),
        this.imageStorage.getStorageStats()
      ]);

      // 计算性能指标（简化版）
      const performance = {
        avgDataFetchTime: 0,
        avgImageRenderTime: 0,
        cacheHitRate: {
          data: dbStats.cacheStats.news?.hitRate || '0%',
          image: dbStats.cacheStats.image?.hitRate || '0%',
          overall: '0%'
        }
      };

      return {
        database: dbStats,
        storage: storageStats,
        performance
      };
    } catch (error) {
      console.error('❌ 获取缓存统计失败:', error);
      throw error;
    }
  }

  /**
   * 关闭缓存系统
   */
  async close(): Promise<void> {
    await this.postgres.close();
    console.log('🔻 分阶段缓存系统已关闭');
  }
}

// 单例导出
export const stagedCacheManager = new StagedCacheManager();