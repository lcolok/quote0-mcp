/**
 * MinIO字体渲染器
 * 使用MinIO存储桶中的字体资源，替代本地字体服务器
 */

import { fontStorageService } from './font-storage.js';
import { selectOptimalFont } from '../smart-font-selector.js';
import { getFontServerUrl } from './lazycat-adapter.js';

export interface MinIOFontRenderResult {
  fontUrl: string;
  actualSize: number;
  baseFontSize: number;
  scaleFactor: number;
  cssSize: string;
  cssLineHeight: string;
  quality: 'A' | 'B' | 'C';
  recommendations: string[];
}

export class MinIOFontRenderer {
  private static fontUrlCache = new Map<number, string>();
  private static renderCache = new Map<string, MinIOFontRenderResult>();

  /**
   * 获取最优字体渲染方案（基于MinIO存储的字体）
   */
  static async getOptimalRenderSolution(targetSize: number): Promise<MinIOFontRenderResult> {
    const cacheKey = `size-${targetSize}`;
    
    if (this.renderCache.has(cacheKey)) {
      return this.renderCache.get(cacheKey)!;
    }

    // 使用智能字体选择算法
    const selection = selectOptimalFont(targetSize);
    
    // 获取字体URL
    const fontUrl = await this.getFontUrl(selection.baseFontSize);
    
    // 计算渲染质量
    const quality = this.calculateRenderQuality(targetSize, selection.baseFontSize, selection.scaleFactor);
    
    // 生成CSS值
    const cssSize = `${targetSize}px`;
    const cssLineHeight = `${targetSize + 2}px`;
    
    // 生成建议
    const recommendations = this.generateRecommendations(targetSize, selection);
    
    const result: MinIOFontRenderResult = {
      fontUrl,
      actualSize: targetSize,
      baseFontSize: selection.baseFontSize,
      scaleFactor: selection.scaleFactor,
      cssSize,
      cssLineHeight,
      quality,
      recommendations
    };
    
    this.renderCache.set(cacheKey, result);
    
    console.log(`📚 MinIO字体: ${targetSize}px → ${selection.baseFontSize}px基础字体×${selection.scaleFactor} ${this.getQualityEmoji(quality)}${quality}级`);
    
    return result;
  }

  /**
   * 获取字体文件URL
   */
  private static async getFontUrl(baseFontSize: number): Promise<string> {
    if (this.fontUrlCache.has(baseFontSize)) {
      return this.fontUrlCache.get(baseFontSize)!;
    }
    
    try {
      const url = await fontStorageService.getFontUrl(baseFontSize);
      this.fontUrlCache.set(baseFontSize, url);
      return url;
    } catch (error) {
      console.warn(`⚠️ 获取字体URL失败 (${baseFontSize}px), 使用本地回退:`, error);
      // 回退到本地字体服务器
      return `${getFontServerUrl()}/fusion-pixel-${baseFontSize}px.woff2`;
    }
  }

  /**
   * 计算渲染质量
   */
  private static calculateRenderQuality(targetSize: number, baseFontSize: number, scaleFactor: number): 'A' | 'B' | 'C' {
    if (scaleFactor === 1) return 'A'; // 完美匹配
    if (scaleFactor === 2) return 'A'; // 2倍缩放，仍然很好
    if (scaleFactor <= 3) return 'B'; // 3倍以内可接受
    return 'C'; // 超过3倍，质量较差
  }

  /**
   * 生成优化建议
   */
  private static generateRecommendations(targetSize: number, selection: any): string[] {
    const recommendations: string[] = [];
    
    if (selection.scaleFactor > 2) {
      recommendations.push(`⚠️ ${targetSize}px需要${selection.scaleFactor}倍缩放，建议使用原生支持的尺寸`);
    }
    
    if (selection.scaleFactor === 1) {
      recommendations.push(`✅ ${targetSize}px完美支持，零缩放损失`);
    }
    
    return recommendations;
  }

  /**
   * 获取质量等级图标
   */
  private static getQualityEmoji(quality: 'A' | 'B' | 'C'): string {
    const emojis = { A: '🟢', B: '🟡', C: '🔴' };
    return emojis[quality];
  }

  /**
   * 批量获取多种字体大小的CSS
   */
  static async getMultiSizeFontCSS(targetSizes: number[]): Promise<string> {
    const uniqueSizes = [...new Set(targetSizes)];
    const cssParts: string[] = [];
    
    for (const size of uniqueSizes) {
      const result = await this.getOptimalRenderSolution(size);
      
      cssParts.push(`
        @font-face {
          font-family: 'FusionPixelFont-${size}px';
          src: url('${result.fontUrl}') format('woff2');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
      `);
    }
    
    // 添加默认字体族
    try {
      const defaultFontUrl = await fontStorageService.getFontUrl(12);
      cssParts.push(`
        @font-face {
          font-family: 'FusionPixelFont';
          src: url('${defaultFontUrl}') format('woff2');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
      `);
    } catch (error) {
      console.warn('⚠️ 获取默认字体失败，使用本地回退');
      const fallbackUrl = `${getFontServerUrl()}/fusion-pixel-12px.woff2`;
      cssParts.push(`
        @font-face {
          font-family: 'FusionPixelFont';
          src: url('${fallbackUrl}') format('woff2');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
      `);
    }
    
    return cssParts.join('');
  }

  /**
   * 获取所有支持的字体大小
   */
  static getSupportedSizes(): number[] {
    return [8, 10, 12];
  }

  /**
   * 获取完美渲染的字体大小（1:1像素比）
   */
  static getPerfectSizes(): number[] {
    return [8, 10, 12, 16, 20, 24]; // 基础字体和它们的2倍
  }

  /**
   * 清理缓存
   */
  static clearCache(): void {
    this.fontUrlCache.clear();
    this.renderCache.clear();
    console.log('🧹 MinIO字体渲染器缓存已清理');
  }

  /**
   * 获取字体使用统计
   */
  static getUsageStats(): {
    cacheHits: number;
    supportedSizes: number[];
    perfectSizes: number[];
  } {
    return {
      cacheHits: this.renderCache.size,
      supportedSizes: this.getSupportedSizes(),
      perfectSizes: this.getPerfectSizes()
    };
  }
}