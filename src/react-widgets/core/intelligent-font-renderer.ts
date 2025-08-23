/**
 * 智能字体渲染模块
 * 自动选择最优的像素字体进行整数倍缩放渲染
 */

import { selectOptimalFont, FontSelection } from '../smart-font-selector.js';

/**
 * 智能字体渲染配置
 */
export interface IntelligentFontConfig {
  /** 目标显示字体大小 */
  targetSize: number;
  /** 是否强制使用特定基础字体大小 */
  forceBaseSize?: 8 | 10 | 12;
  /** 是否允许非整数倍缩放（降低质量但支持更多尺寸） */
  allowNonIntegerScaling?: boolean;
  /** 最大允许的误差像素 */
  maxError?: number;
}

/**
 * 字体渲染结果
 */
export interface FontRenderResult extends FontSelection {
  /** 最终的CSS字体大小 */
  cssSize: string;
  /** CSS行高建议 */
  cssLineHeight: string;
  /** 字体URL */
  fontUrl: string;
  /** 渲染质量评级 A/B/C */
  quality: 'A' | 'B' | 'C';
  /** 渲染建议和警告 */
  recommendations: string[];
}

/**
 * 智能字体渲染器
 */
export class IntelligentFontRenderer {
  private static fontServerBaseUrl = 'http://localhost:3001';

  /**
   * 获取最优字体渲染方案
   */
  static getOptimalRenderSolution(config: IntelligentFontConfig): FontRenderResult {
    const { targetSize, forceBaseSize, allowNonIntegerScaling = false, maxError = 2 } = config;
    
    let selection: FontSelection;
    
    if (forceBaseSize) {
      // 强制使用指定基础字体
      selection = this.calculateForcedSelection(targetSize, forceBaseSize);
    } else {
      // 智能选择最优基础字体
      selection = selectOptimalFont(targetSize);
    }

    // 评估渲染质量
    const quality = this.evaluateQuality(selection, allowNonIntegerScaling, maxError);
    
    // 生成建议
    const recommendations = this.generateRecommendations(selection, targetSize, quality);

    return {
      ...selection,
      cssSize: `${targetSize}px`,
      cssLineHeight: `${targetSize + 2}px`, // 建议行高为字体大小+2px
      fontUrl: `${this.fontServerBaseUrl}/fusion-pixel-${targetSize}px.woff2`,
      quality,
      recommendations
    };
  }

  /**
   * 计算强制基础字体的选择结果
   */
  private static calculateForcedSelection(targetSize: number, baseSize: 8 | 10 | 12): FontSelection {
    const scaleFactor = targetSize / baseSize;
    const actualSize = baseSize * Math.round(scaleFactor);
    const error = Math.abs(targetSize - actualSize);

    return {
      baseFontSize: baseSize,
      fontFileName: `fusion-pixel-${baseSize}px-monospaced-zh_hans.otf.woff2`,
      scaleFactor: Math.round(scaleFactor),
      actualSize,
      error
    };
  }

  /**
   * 评估渲染质量
   */
  private static evaluateQuality(
    selection: FontSelection, 
    allowNonIntegerScaling: boolean, 
    maxError: number
  ): 'A' | 'B' | 'C' {
    // A级：完美像素对齐，整数倍缩放
    if (selection.error === 0 && Number.isInteger(selection.scaleFactor)) {
      return 'A';
    }
    
    // B级：误差在可接受范围内
    if (selection.error <= maxError) {
      return Number.isInteger(selection.scaleFactor) ? 'B' : 'C';
    }
    
    // C级：较大误差或非整数缩放
    return 'C';
  }

  /**
   * 生成渲染建议
   */
  private static generateRecommendations(
    selection: FontSelection, 
    targetSize: number, 
    quality: 'A' | 'B' | 'C'
  ): string[] {
    const recommendations: string[] = [];

    if (quality === 'A') {
      recommendations.push(`🎯 完美匹配！${selection.baseFontSize}px基础字体进行${selection.scaleFactor}x整数倍缩放`);
    } else if (quality === 'B') {
      if (selection.error > 0) {
        recommendations.push(`⚠️ 存在${selection.error}px误差，建议调整目标字体大小为${selection.actualSize}px`);
      }
      if (!Number.isInteger(selection.scaleFactor)) {
        recommendations.push(`⚠️ 非整数缩放可能影响渲染锐度`);
      }
    } else {
      recommendations.push(`❌ 渲染质量较低，强烈建议选择以下推荐尺寸:`);
      const perfectSizes = this.getPerfectSizes();
      const nearest = perfectSizes.reduce((prev, curr) => 
        Math.abs(curr - targetSize) < Math.abs(prev - targetSize) ? curr : prev
      );
      recommendations.push(`   推荐使用 ${nearest}px (${this.getBaseForPerfectSize(nearest)}px基础字体)`);
    }

    return recommendations;
  }

  /**
   * 获取所有完美渲染尺寸（整数倍缩放）
   */
  static getPerfectSizes(): number[] {
    const bases = [8, 10, 12];
    const multipliers = [1, 2, 3, 4, 5]; // 支持1x到5x缩放
    
    const perfectSizes: number[] = [];
    for (const base of bases) {
      for (const mult of multipliers) {
        perfectSizes.push(base * mult);
      }
    }
    
    return perfectSizes.sort((a, b) => a - b);
  }

  /**
   * 获取完美尺寸对应的基础字体
   */
  private static getBaseForPerfectSize(size: number): number {
    const bases = [8, 10, 12];
    for (const base of bases) {
      if (size % base === 0) {
        return base;
      }
    }
    return 12; // 默认
  }

  /**
   * 生成详细的字体渲染报告
   */
  static generateDetailedReport(targetSizes: number[]): string {
    let report = '📊 智能字体渲染分析报告\n\n';
    
    report += '🎯 完美渲染尺寸 (整数倍缩放):\n';
    const perfectSizes = this.getPerfectSizes();
    const grouped = this.groupSizesByBase(perfectSizes);
    
    for (const [base, sizes] of Object.entries(grouped)) {
      report += `  ${base}px基础: ${sizes.join('px, ')}px\n`;
    }
    
    report += '\n📏 目标尺寸分析:\n';
    for (const size of targetSizes) {
      const result = this.getOptimalRenderSolution({ targetSize: size });
      report += `  ${size}px → ${result.quality}级 (${result.baseFontSize}px×${result.scaleFactor}) 误差:${result.error}px\n`;
    }
    
    return report;
  }

  /**
   * 按基础字体大小分组
   */
  private static groupSizesByBase(sizes: number[]): Record<string, number[]> {
    const grouped: Record<string, number[]> = { '8': [], '10': [], '12': [] };
    
    for (const size of sizes) {
      if (size % 8 === 0) grouped['8'].push(size);
      else if (size % 10 === 0) grouped['10'].push(size);
      else if (size % 12 === 0) grouped['12'].push(size);
    }
    
    return grouped;
  }

  /**
   * 获取推荐字体大小
   */
  static getRecommendedSizes(): { small: number[], medium: number[], large: number[] } {
    return {
      small: [8, 10, 12],      // 1x 基础尺寸
      medium: [16, 20, 24],    // 2x 缩放尺寸  
      large: [24, 30, 36]      // 3x+ 缩放尺寸
    };
  }
}