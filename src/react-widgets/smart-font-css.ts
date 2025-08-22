/**
 * 智能字体CSS生成器
 */

import { selectOptimalFont } from './smart-font-selector';

/**
 * 为指定的字体大小数组生成智能字体CSS
 */
export function generateSmartFontCSS(fontSizes: number[], baseUrl: string): string {
  const uniqueSelections = new Map<string, ReturnType<typeof selectOptimalFont>>();
  
  // 为每个字体大小计算最佳选择
  fontSizes.forEach(size => {
    const selection = selectOptimalFont(size);
    uniqueSelections.set(`fusion-pixel-${size}px`, selection);
  });

  // 生成CSS规则
  let css = '/* 智能像素字体 - 自动选择最佳基础字体 */\n\n';
  
  uniqueSelections.forEach((selection, fontFamilyName) => {
    const targetSize = parseInt(fontFamilyName.match(/(\d+)px/)![1]);
    
    css += `@font-face {
  font-family: '${fontFamilyName}';
  src: url('${baseUrl}/fusion-pixel-${targetSize}px.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

/* ${fontFamilyName}: 目标${targetSize}px → ${selection.baseFontSize}px基础字体×${selection.scaleFactor} = ${selection.actualSize}px (误差${selection.error}px) */
.font-${targetSize}px {
  font-family: '${fontFamilyName}', monospace;
  font-size: ${selection.actualSize}px;
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: unset;
  text-rendering: optimizeSpeed;
  image-rendering: pixelated;
}

`;
  });

  return css;
}

/**
 * 生成优化建议报告
 */
export function generateOptimizationReport(fontSizes: number[]): string {
  let report = '🔍 智能字体优化分析:\n\n';
  
  fontSizes.forEach(size => {
    const selection = selectOptimalFont(size);
    if (selection.error === 0) {
      report += `✅ ${size}px - 像素完美 (${selection.baseFontSize}px × ${selection.scaleFactor})\n`;
    } else {
      report += `⚠️  ${size}px → 建议 ${selection.actualSize}px (${selection.baseFontSize}px × ${selection.scaleFactor}, 误差${selection.error}px)\n`;
    }
  });
  
  return report;
}