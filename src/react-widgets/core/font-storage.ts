/**
 * 字体存储服务
 * 管理字体文件的MinIO存储、检验和URL生成
 */

import { getImageStorage } from './image-storage.js';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

export interface FontMetadata {
  size: number;
  fileName: string;
  baseFontSize: number;
  scaleFactor: number;
  checksum: string;
  uploadTime: Date;
}

export interface FontUrls {
  [size: number]: string;
}

export class FontStorageService {
  private imageStorage = getImageStorage();
  private fontBucket = 'quote0-fonts';
  
  // 字体文件映射
  private fontFiles = {
    8: 'fusion-pixel-8px-monospaced-zh_hans.otf.woff2',
    10: 'fusion-pixel-10px-monospaced-zh_hans.otf.woff2',
    12: 'fusion-pixel-12px-monospaced-zh_hans.otf.woff2'
  };

  /**
   * 初始化字体存储系统
   */
  async initialize(): Promise<void> {
    console.log('🎨 初始化字体存储系统...');
    
    try {
      // 创建字体专用桶
      await this.ensureFontBucket();
      
      // 检验并上传字体文件
      await this.verifyAndUploadFonts();
      
      console.log('✅ 字体存储系统初始化完成');
    } catch (error) {
      console.error('❌ 字体存储系统初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保字体桶存在
   */
  private async ensureFontBucket(): Promise<void> {
    try {
      const exists = await this.imageStorage.getClient().bucketExists(this.fontBucket);
      if (!exists) {
        await this.imageStorage.getClient().makeBucket(this.fontBucket);
        console.log(`📦 创建字体桶: ${this.fontBucket}`);
        
        // 设置公开读取策略
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.fontBucket}/*`]
            }
          ]
        };
        
        await this.imageStorage.getClient().setBucketPolicy(this.fontBucket, JSON.stringify(policy));
        console.log(`🔓 字体桶设置为公开访问`);
      } else {
        console.log(`📦 字体桶已存在: ${this.fontBucket}`);
      }
    } catch (error) {
      console.error('❌ 创建字体桶失败:', error);
      throw error;
    }
  }

  /**
   * 检验并上传字体文件
   */
  private async verifyAndUploadFonts(): Promise<void> {
    const fontsPath = join(process.cwd(), 'assets/fonts');
    
    for (const [size, fileName] of Object.entries(this.fontFiles)) {
      const fontPath = join(fontsPath, fileName);
      const objectKey = `fonts/${fileName}`;
      
      try {
        // 计算本地文件的校验和
        const localChecksum = await this.calculateFileChecksum(fontPath);
        const localStat = await stat(fontPath);
        
        // 检查MinIO中是否已存在相同的文件
        let needsUpload = true;
        
        try {
          const remoteStat = await this.imageStorage.getClient().statObject(this.fontBucket, objectKey);
          const remoteChecksum = remoteStat.metaData['x-checksum'];
          
          if (remoteChecksum === localChecksum) {
            console.log(`🎯 字体文件已最新: ${fileName} (${size}px)`);
            needsUpload = false;
          } else {
            console.log(`🔄 字体文件需要更新: ${fileName} (${size}px)`);
          }
        } catch (error) {
          // 文件不存在，需要上传
          console.log(`📤 字体文件不存在，准备上传: ${fileName} (${size}px)`);
        }
        
        if (needsUpload) {
          await this.uploadFont(fontPath, fileName, localChecksum, parseInt(size));
        }
        
      } catch (error) {
        console.error(`❌ 处理字体文件失败 ${fileName}:`, error);
        // 继续处理其他字体文件
      }
    }
  }

  /**
   * 上传字体文件到MinIO
   */
  private async uploadFont(fontPath: string, fileName: string, checksum: string, size: number): Promise<void> {
    const objectKey = `fonts/${fileName}`;
    
    try {
      const fontData = await readFile(fontPath);
      const fileSize = fontData.length;
      
      // 准备元数据
      const metadata = {
        'Content-Type': 'font/woff2',
        'Cache-Control': 'public, max-age=31536000',
        'x-font-size': size.toString(),
        'x-checksum': checksum,
        'x-upload-time': new Date().toISOString()
      };
      
      // 上传到MinIO
      await this.imageStorage.getClient().putObject(
        this.fontBucket,
        objectKey,
        fontData,
        fileSize,
        metadata
      );
      
      console.log(`✅ 字体上传完成: ${fileName} (${(fileSize / 1024).toFixed(1)}KB)`);
      
    } catch (error) {
      console.error(`❌ 字体上传失败 ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * 计算文件校验和
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    const data = await readFile(filePath);
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * 获取所有字体的URL映射
   */
  async getFontUrls(): Promise<FontUrls> {
    const urls: FontUrls = {};
    const baseUrl = `${this.imageStorage['baseUrl']}/${this.fontBucket}`;
    
    for (const [size, fileName] of Object.entries(this.fontFiles)) {
      urls[parseInt(size)] = `${baseUrl}/fonts/${fileName}`;
    }
    
    return urls;
  }

  /**
   * 获取特定尺寸字体的URL
   */
  async getFontUrl(size: number): Promise<string> {
    const fileName = this.fontFiles[size as keyof typeof this.fontFiles];
    if (!fileName) {
      throw new Error(`不支持的字体尺寸: ${size}px`);
    }
    
    const baseUrl = `${this.imageStorage['baseUrl']}/${this.fontBucket}`;
    return `${baseUrl}/fonts/${fileName}`;
  }

  /**
   * 检查字体文件在MinIO中是否存在
   */
  async fontExists(size: number): Promise<boolean> {
    const fileName = this.fontFiles[size as keyof typeof this.fontFiles];
    if (!fileName) return false;
    
    const objectKey = `fonts/${fileName}`;
    
    try {
      await this.imageStorage.getClient().statObject(this.fontBucket, objectKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取字体存储统计信息
   */
  async getFontStats(): Promise<{
    totalFonts: number;
    totalSize: number;
    fonts: FontMetadata[];
  }> {
    const stats = {
      totalFonts: 0,
      totalSize: 0,
      fonts: [] as FontMetadata[]
    };
    
    for (const [size, fileName] of Object.entries(this.fontFiles)) {
      const objectKey = `fonts/${fileName}`;
      
      try {
        const stat = await this.imageStorage.getClient().statObject(this.fontBucket, objectKey);
        const metadata: FontMetadata = {
          size: parseInt(size),
          fileName,
          baseFontSize: parseInt(size), // 简化版，实际应该从智能字体选择器获取
          scaleFactor: 1,
          checksum: stat.metaData['x-checksum'] || 'unknown',
          uploadTime: new Date(stat.metaData['x-upload-time'] || stat.lastModified)
        };
        
        stats.fonts.push(metadata);
        stats.totalFonts++;
        stats.totalSize += stat.size;
        
      } catch (error) {
        console.warn(`⚠️ 无法获取字体统计 ${fileName}:`, error);
      }
    }
    
    return stats;
  }

  /**
   * 清理过期或无效的字体文件
   */
  async cleanupFonts(): Promise<number> {
    let cleanedCount = 0;
    
    try {
      const objectsStream = this.imageStorage.getClient().listObjects(this.fontBucket, 'fonts/', true);
      
      for await (const obj of objectsStream) {
        // 检查是否为有效的字体文件
        const isValidFont = Object.values(this.fontFiles).some(fileName => 
          obj.name === `fonts/${fileName}`
        );
        
        if (!isValidFont) {
          await this.imageStorage.getClient().removeObject(this.fontBucket, obj.name!);
          console.log(`🗑️ 清理无效字体文件: ${obj.name}`);
          cleanedCount++;
        }
      }
      
    } catch (error) {
      console.error('❌ 字体清理失败:', error);
    }
    
    return cleanedCount;
  }
}

// 单例导出
export const fontStorageService = new FontStorageService();