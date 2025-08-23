/**
 * 智能字体工具集
 * 为React组件提供便捷的智能字体使用方法
 */

import { EnhancedFontLoader } from '../core/enhanced-font-loader.js';
import { IntelligentFontRenderer } from '../core/intelligent-font-renderer.js';

/**
 * 智能字体样式生成器
 */
export class SmartFontUtils {
  
  /**
   * 获取完美渲染的字体样式
   * @param preferredSize 期望的字体大小
   * @returns React样式对象
   */
  static getPerfectFontStyle(preferredSize: number) {
    const result = IntelligentFontRenderer.getOptimalRenderSolution({ targetSize: preferredSize });
    
    return {
      fontFamily: EnhancedFontLoader.getFusionPixelFontFamily(),
      fontSize: `${result.actualSize}px`, // 使用实际最优大小而不是期望大小
      lineHeight: `${result.actualSize + 2}px`,
      // 添加渲染优化CSS属性
      WebkitFontSmoothing: 'none' as const,
      MozOsxFontSmoothing: 'unset' as const,
      textRendering: 'geometricPrecision' as const,
    };
  }

  /**
   * 获取推荐的字体大小集合
   */
  static getRecommendedSizes() {
    return IntelligentFontRenderer.getRecommendedSizes();
  }

  /**
   * 创建字体样式常量 - 用于组件中的样式复用
   */
  static createFontStyleConstants() {
    const sizes = IntelligentFontRenderer.getRecommendedSizes();
    
    return {
      // 小字体样式
      small: {
        xs: this.getPerfectFontStyle(sizes.small[0]),    // 8px
        sm: this.getPerfectFontStyle(sizes.small[1]),    // 10px  
        md: this.getPerfectFontStyle(sizes.small[2]),    // 12px
      },
      
      // 中字体样式
      medium: {
        sm: this.getPerfectFontStyle(sizes.medium[0]),   // 16px
        md: this.getPerfectFontStyle(sizes.medium[1]),   // 20px
        lg: this.getPerfectFontStyle(sizes.medium[2]),   // 24px
      },
      
      // 大字体样式
      large: {
        md: this.getPerfectFontStyle(sizes.large[0]),    // 24px
        lg: this.getPerfectFontStyle(sizes.large[1]),    // 30px
        xl: this.getPerfectFontStyle(sizes.large[2]),    // 36px
      }
    };
  }

  /**
   * 验证字体大小是否为最优选择
   */
  static validateFontSize(targetSize: number): {
    isOptimal: boolean;
    quality: 'A' | 'B' | 'C';
    suggestion?: number;
    message: string;
  } {
    const result = IntelligentFontRenderer.getOptimalRenderSolution({ targetSize });
    
    const isOptimal = result.error === 0;
    const quality = result.quality;
    
    let message = '';
    let suggestion: number | undefined;

    if (quality === 'A') {
      message = `✅ 完美! ${result.baseFontSize}px基础字体${result.scaleFactor}x缩放`;
    } else if (quality === 'B') {
      message = `⚠️ 可用但有${result.error}px误差，建议使用${result.actualSize}px`;
      suggestion = result.actualSize;
    } else {
      const perfectSizes = IntelligentFontRenderer.getPerfectSizes();
      suggestion = perfectSizes.reduce((prev, curr) => 
        Math.abs(curr - targetSize) < Math.abs(prev - targetSize) ? curr : prev
      );
      message = `❌ 渲染质量较差，强烈建议使用${suggestion}px`;
    }

    return { isOptimal, quality, suggestion, message };
  }

  /**
   * 生成字体使用指南
   */
  static generateUsageGuide(): string {
    const constants = this.createFontStyleConstants();
    
    return `
🎯 智能字体使用指南

📦 导入:
import { SmartFontUtils } from './utils/smart-font-utils';

🔤 基础用法:
const titleStyle = SmartFontUtils.getPerfectFontStyle(20);

📐 预设样式常量:
const FONT_STYLES = SmartFontUtils.createFontStyleConstants();

// 使用示例:
<div style={FONT_STYLES.medium.md}>中等大小文字</div>
<div style={FONT_STYLES.large.lg}>大标题文字</div>

✅ 字体大小验证:
const validation = SmartFontUtils.validateFontSize(18);
console.log(validation.message); // 显示优化建议

🏆 推荐字体大小:
• 内容文字: ${Object.values(constants.small).map(s => s.fontSize).join(', ')}
• 标题文字: ${Object.values(constants.medium).map(s => s.fontSize).join(', ')}
• 大标题数字: ${Object.values(constants.large).map(s => s.fontSize).join(', ')}
`;
  }

  /**
   * 检查组件是否使用了智能字体
   */
  static isUsingSmartFont(styles: Record<string, any>): boolean {
    const fontSize = styles.fontSize;
    if (!fontSize || typeof fontSize !== 'string') return false;
    
    const size = parseInt(fontSize.replace('px', ''));
    const validation = this.validateFontSize(size);
    
    return validation.quality === 'A';
  }
}

// 导出预设样式常量
export const SMART_FONT_STYLES = SmartFontUtils.createFontStyleConstants();

/**
 * 智能字体样式辅助函数
 */
export const smartFont = (size: number) => SmartFontUtils.getPerfectFontStyle(size);

/**
 * 字体大小验证辅助函数  
 */
export const validateFont = (size: number) => SmartFontUtils.validateFontSize(size);