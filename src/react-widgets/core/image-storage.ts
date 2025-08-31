/**
 * MinIO对象存储服务
 * 负责图片缓存的存储和管理
 */

import * as Minio from 'minio';
import { createHash } from 'crypto';
import { stat, readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { basename, extname } from 'path';

export interface ImageCacheMetadata {
  widgetType: string;
  cacheKey: string;
  newsId?: number;
  renderConfig: Record<string, any>;
  originalPath?: string;
}

export interface StoredImageInfo {
  bucket: string;
  objectKey: string;
  size: number;
  contentType: string;
  etag: string;
  url: string;
  metadata: ImageCacheMetadata;
}

export class ImageStorageService {
  private client: Minio.Client;
  private bucket: string;
  private baseUrl: string;

  /**
   * 获取MinIO客户端（供字体存储服务使用）
   */
  getClient(): Minio.Client {
    return this.client;
  }

  constructor(options: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket?: string;
    useSSL?: boolean;
    port?: number;
  }) {
    this.client = new Minio.Client({
      endPoint: options.endpoint,
      port: options.port || 9000,
      useSSL: options.useSSL || false,
      accessKey: options.accessKey,
      secretKey: options.secretKey
    });

    this.bucket = options.bucket || 'quote0-images';
    this.baseUrl = `http${options.useSSL ? 's' : ''}://${options.endpoint}:${options.port || 9000}`;
    
    this.initializeBucket();
  }

  private async initializeBucket(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, 'us-east-1');
        console.log(`📦 MinIO桶已创建: ${this.bucket}`);
        
        // 设置桶策略允许公开读取
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`]
            }
          ]
        };
        
        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
        console.log(`🔓 MinIO桶策略已设置: 允许公开读取`);
      } else {
        console.log(`📦 MinIO桶已存在: ${this.bucket}`);
      }
    } catch (error) {
      console.error('❌ MinIO桶初始化失败:', error);
    }
  }

  /**
   * 生成图片的对象键
   */
  private generateObjectKey(
    cacheKey: string, 
    widgetType: string, 
    timestamp?: number
  ): string {
    const ts = timestamp || Date.now();
    const date = new Date(ts);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // 结构: widgets/{type}/{year}/{month}/{day}/{cacheKey}.png
    return `widgets/${widgetType}/${year}/${month}/${day}/${cacheKey}.png`;
  }

  /**
   * 上传图片到MinIO
   */
  async uploadImage(
    imagePath: string,
    metadata: ImageCacheMetadata
  ): Promise<StoredImageInfo> {
    try {
      const stats = await stat(imagePath);
      const objectKey = this.generateObjectKey(
        metadata.cacheKey,
        metadata.widgetType
      );

      console.log(`📤 上传图片到MinIO: ${objectKey}`);

      // 设置对象元数据
      const objectMetadata: Record<string, string> = {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // 1天缓存
        'X-Widget-Type': metadata.widgetType,
        'X-Cache-Key': metadata.cacheKey,
        'X-Render-Config': JSON.stringify(metadata.renderConfig),
        'X-Upload-Time': new Date().toISOString()
      };

      if (metadata.newsId) {
        objectMetadata['X-News-ID'] = metadata.newsId.toString();
      }

      if (metadata.originalPath) {
        objectMetadata['X-Original-Path'] = metadata.originalPath;
      }

      // 上传文件
      const result = await this.client.fPutObject(
        this.bucket,
        objectKey,
        imagePath,
        objectMetadata
      );

      const url = `${this.baseUrl}/${this.bucket}/${objectKey}`;

      console.log(`✅ 图片上传完成: ${url}`);

      return {
        bucket: this.bucket,
        objectKey,
        size: stats.size,
        contentType: 'image/png',
        etag: result.etag,
        url,
        metadata
      };

    } catch (error) {
      console.error('❌ 图片上传失败:', error);
      throw new Error(`图片上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 直接检查指定对象键的图片是否存在
   */
  async imageExistsByObjectKey(objectKey: string): Promise<{ url: string; stat: any } | null> {
    try {
      const stat = await this.client.statObject(this.bucket, objectKey);
      const url = `${this.baseUrl}/${this.bucket}/${objectKey}`;
      return { url, stat };
    } catch (error) {
      return null;
    }
  }

  /**
   * 检查图片是否存在（通过遍历最近几天的路径）
   */
  async imageExists(cacheKey: string, widgetType: string): Promise<StoredImageInfo | null> {
    try {
      // 生成可能的对象键（需要遍历最近几天的路径）
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      for (let i = 0; i < 7; i++) { // 检查最近7天
        const timestamp = now - (i * oneDayMs);
        const objectKey = this.generateObjectKey(cacheKey, widgetType, timestamp);
        
        try {
          const stat = await this.client.statObject(this.bucket, objectKey);
          const url = `${this.baseUrl}/${this.bucket}/${objectKey}`;
          
          console.log(`💾 图片缓存命中: ${objectKey}`);
          
          // 解析元数据
          const metadata: ImageCacheMetadata = {
            widgetType: stat.metaData['x-widget-type'] || widgetType,
            cacheKey: stat.metaData['x-cache-key'] || cacheKey,
            renderConfig: stat.metaData['x-render-config'] 
              ? JSON.parse(stat.metaData['x-render-config']) 
              : {},
            newsId: stat.metaData['x-news-id'] 
              ? parseInt(stat.metaData['x-news-id']) 
              : undefined,
            originalPath: stat.metaData['x-original-path']
          };

          return {
            bucket: this.bucket,
            objectKey,
            size: stat.size,
            contentType: stat.metaData['content-type'] || 'image/png',
            etag: stat.etag,
            url,
            metadata
          };
        } catch (error) {
          // 对象不存在，继续检查下一天
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error('❌ 检查图片存在性失败:', error);
      return null;
    }
  }

  /**
   * 删除图片
   */
  async deleteImage(objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectKey);
      console.log(`🗑️ 图片已删除: ${objectKey}`);
    } catch (error) {
      console.error('❌ 删除图片失败:', error);
      throw new Error(`删除图片失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 获取图片的预签名URL（用于临时访问）
   */
  async getPresignedUrl(objectKey: string, expirySeconds: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, objectKey, expirySeconds);
    } catch (error) {
      console.error('❌ 生成预签名URL失败:', error);
      throw new Error(`生成预签名URL失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 清理过期图片（7天前的图片）
   */
  async cleanupExpiredImages(): Promise<number> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      let deletedCount = 0;
      const objectsStream = this.client.listObjects(this.bucket, 'widgets/', true);

      for await (const obj of objectsStream) {
        if (obj.lastModified && obj.lastModified < sevenDaysAgo) {
          await this.client.removeObject(this.bucket, obj.name!);
          deletedCount++;
        }
      }

      console.log(`🧹 MinIO清理完成: 删除了${deletedCount}个过期图片`);
      return deletedCount;
    } catch (error) {
      console.error('❌ 清理过期图片失败:', error);
      return 0;
    }
  }

  /**
   * 获取存储统计信息
   */
  async getStorageStats(): Promise<{
    totalObjects: number;
    totalSize: number;
    bucketName: string;
  }> {
    try {
      let totalObjects = 0;
      let totalSize = 0;

      const objectsStream = this.client.listObjects(this.bucket, '', true);

      for await (const obj of objectsStream) {
        totalObjects++;
        totalSize += obj.size || 0;
      }

      return {
        totalObjects,
        totalSize,
        bucketName: this.bucket
      };
    } catch (error) {
      console.error('❌ 获取存储统计失败:', error);
      return {
        totalObjects: 0,
        totalSize: 0,
        bucketName: this.bucket
      };
    }
  }

  /**
   * 生成缓存键
   */
  static generateCacheKey(
    source: string,
    category: string,
    index: number,
    renderConfig: Record<string, any>
  ): string {
    const keyObject = {
      source,
      category,
      index,
      config: renderConfig
    };
    
    const keyString = JSON.stringify(keyObject, Object.keys(keyObject).sort());
    return createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }
}

// 单例实例
let imageStorage: ImageStorageService | null = null;

export function getImageStorage(): ImageStorageService {
  if (!imageStorage) {
    const config = {
      endpoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      accessKey: process.env.MINIO_ACCESS_KEY || 'quote0_minio',
      secretKey: process.env.MINIO_SECRET_KEY || 'quote0_minio_password',
      bucket: process.env.MINIO_BUCKET || 'quote0-images',
      useSSL: process.env.MINIO_USE_SSL === 'true'
    };
    
    console.log(`🔧 MinIO配置: ${config.endpoint}:${config.port} (bucket: ${config.bucket})`);
    imageStorage = new ImageStorageService(config);
  }
  return imageStorage;
}