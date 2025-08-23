/**
 * 增强字体加载器
 * 集成智能字体渲染模块，提供最优字体加载策略
 */

import { FontLoader } from '../font-loader.js';
import { IntelligentFontRenderer, IntelligentFontConfig, FontRenderResult } from './intelligent-font-renderer.js';

/**
 * 增强字体加载器
 */
export class EnhancedFontLoader extends FontLoader {
  private static renderCache = new Map<string, FontRenderResult>();

  /**
   * 智能获取字体CSS - 自动选择最优像素字体
   */
  static getIntelligentFontCSS(config: IntelligentFontConfig): string {
    const cacheKey = JSON.stringify(config);
    
    if (!this.renderCache.has(cacheKey)) {
      const result = IntelligentFontRenderer.getOptimalRenderSolution(config);
      this.renderCache.set(cacheKey, result);
      
      // 输出渲染信息
      this.logRenderInfo(result);
    }

    const result = this.renderCache.get(cacheKey)!;
    
    return `
      @font-face {
        font-family: 'FusionPixelFont';
        src: url('${result.fontUrl}') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;
  }

  /**
   * 简化版智能字体CSS - 仅需提供目标大小
   */
  static getSmartFontCSS(targetSize: number): string {
    return this.getIntelligentFontCSS({ targetSize });
  }

  /**
   * 获取智能字体样式对象 - 用于React组件
   */
  static getIntelligentFontStyle(targetSize: number): {
    fontFamily: string;
    fontSize: string;
    lineHeight: string;
  } {
    const result = IntelligentFontRenderer.getOptimalRenderSolution({ targetSize });
    
    return {
      fontFamily: this.getFusionPixelFontFamily(),
      fontSize: result.cssSize,
      lineHeight: result.cssLineHeight
    };
  }

  /**
   * 批量生成智能字体CSS - 支持多种字体大小
   */
  static getMultiSizeFontCSS(targetSizes: number[]): string {
    let css = '';
    const uniqueSizes = [...new Set(targetSizes)];
    
    for (const size of uniqueSizes) {
      const result = IntelligentFontRenderer.getOptimalRenderSolution({ targetSize: size });
      css += `
        @font-face {
          font-family: 'FusionPixelFont-${size}px';
          src: url('${result.fontUrl}') format('woff2');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
      `;
    }
    
    // 默认字体族
    css += `
      @font-face {
        font-family: 'FusionPixelFont';
        src: url('http://localhost:3001/fusion-pixel-12px.woff2') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;
    
    return css;
  }

  /**
   * 输出渲染信息到控制台
   */
  private static logRenderInfo(result: FontRenderResult): void {
    const qualityEmoji = { A: '🟢', B: '🟡', C: '🔴' };
    
    console.log(`📚 智能字体加载: ${result.actualSize}px → ${result.baseFontSize}px基础字体×${result.scaleFactor} ${qualityEmoji[result.quality]}${result.quality}级`);
    
    if (result.recommendations.length > 0) {
      result.recommendations.forEach(rec => console.log(`   ${rec}`));
    }
  }

  /**
   * 分析组件中的字体使用情况
   */
  static analyzeComponentFontUsage(markup: string): {
    detectedSizes: number[];
    recommendations: string[];
    optimizationSuggestions: string[];
  } {
    // 提取所有字体大小
    const fontSizePattern = /fontSize:\s*['"]?(\d+)px['"]?/g;
    const matches = [...markup.matchAll(fontSizePattern)];
    const detectedSizes = [...new Set(matches.map(m => parseInt(m[1])))].sort((a, b) => a - b);
    
    // 分析每个大小的渲染质量
    const analysis = detectedSizes.map(size => ({
      size,
      result: IntelligentFontRenderer.getOptimalRenderSolution({ targetSize: size })
    }));
    
    // 生成建议
    const recommendations: string[] = [];
    const optimizationSuggestions: string[] = [];
    
    const qualityStats = { A: 0, B: 0, C: 0 };
    analysis.forEach(({ size, result }) => {
      qualityStats[result.quality]++;
      
      if (result.quality === 'C') {
        const perfectSizes = IntelligentFontRenderer.getPerfectSizes();
        const nearest = perfectSizes.reduce((prev, curr) => 
          Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
        );
        optimizationSuggestions.push(`${size}px → 建议改为 ${nearest}px (提升至A级渲染)`);
      }
    });
    
    recommendations.push(`检测到 ${detectedSizes.length} 种字体大小: ${detectedSizes.join('px, ')}px`);
    recommendations.push(`渲染质量统计: A级${qualityStats.A}个, B级${qualityStats.B}个, C级${qualityStats.C}个`);
    
    if (qualityStats.C > 0) {
      recommendations.push(`⚠️ 发现 ${qualityStats.C} 个低质量字体大小，建议优化`);
    }
    
    return {
      detectedSizes,
      recommendations,
      optimizationSuggestions
    };
  }

  /**
   * 获取字体优化建议
   */
  static getOptimizationSuggestions(): string {
    const recommended = IntelligentFontRenderer.getRecommendedSizes();
    
    return `🎯 字体大小优化建议:

🔹 小字体 (内容详情): ${recommended.small.join('px, ')}px
🔹 中字体 (标题正文): ${recommended.medium.join('px, ')}px  
🔹 大字体 (主标题数字): ${recommended.large.join('px, ')}px

💡 完美渲染尺寸 (零误差):
${IntelligentFontRenderer.getPerfectSizes().join('px, ')}px

⚡ 使用方式:
import { EnhancedFontLoader } from './enhanced-font-loader';

// 方式1: 智能样式对象
const style = EnhancedFontLoader.getIntelligentFontStyle(20);

// 方式2: 智能CSS
const css = EnhancedFontLoader.getSmartFontCSS(20);`;
  }
}