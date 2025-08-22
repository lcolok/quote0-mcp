/**
 * 智能字体选择器 - 根据目标字体大小选择最佳的像素字体
 */

export interface FontSelection {
  baseFontSize: 8 | 10 | 12;
  fontFileName: string;
  scaleFactor: number;
  actualSize: number;
  error: number;
}

/**
 * 计算目标字体大小的最佳字体选择
 */
export function selectOptimalFont(targetSize: number): FontSelection {
  const availableFonts = [
    { base: 8 as const, file: 'fusion-pixel-8px-monospaced-zh_hans.otf.woff2' },
    { base: 10 as const, file: 'fusion-pixel-10px-monospaced-zh_hans.otf.woff2' },
    { base: 12 as const, file: 'fusion-pixel-12px-monospaced-zh_hans.otf.woff2' }
  ];

  let bestSelection: FontSelection | null = null;
  let minError = Infinity;

  for (const font of availableFonts) {
    // 计算最接近的整数倍
    const scaleFactor = Math.round(targetSize / font.base);
    const actualSize = font.base * scaleFactor;
    const error = Math.abs(targetSize - actualSize);

    // 优先选择误差最小的，误差相同时优先选择较大的基础字体
    if (error < minError || (error === minError && font.base > (bestSelection?.baseFontSize || 0))) {
      minError = error;
      bestSelection = {
        baseFontSize: font.base,
        fontFileName: font.file,
        scaleFactor,
        actualSize,
        error
      };
    }
  }

  return bestSelection!;
}

/**
 * 生成字体选择报告
 */
export function getFontSelectionReport(targetSize: number): string {
  const selection = selectOptimalFont(targetSize);
  return `目标: ${targetSize}px → 选择: ${selection.baseFontSize}px × ${selection.scaleFactor} = ${selection.actualSize}px (误差: ${selection.error}px)`;
}

/**
 * 批量分析当前使用的字体大小
 */
export function analyzeCurrentFontSizes() {
  const currentSizes = [28, 24, 28, 108, 36]; // 地区、湿度、天气、温度、摄氏度
  const labels = ['地区名称', '湿度数值', '天气描述', '温度数字', '摄氏度符号'];
  
  console.log('🔍 当前字体大小分析:');
  currentSizes.forEach((size, index) => {
    const report = getFontSelectionReport(size);
    console.log(`${labels[index]}: ${report}`);
  });
}