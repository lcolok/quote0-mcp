import { createCanvas, loadImage, Canvas } from 'canvas';
import { ditherImage } from 'epdoptimize';
import { ImageDimensions } from './types.js';

/**
 * 专门针对1-bit黑白点阵式水墨屏的优化器
 * 基于专家分析：您的设备是黑白点阵型，通过抖动模拟灰度
 */
export class MonochromeOptimizer {
  
  /**
   * 为1-bit黑白水墨屏优化图片
   * @param imagePath 输入图片路径
   * @param targetSize 目标尺寸
   * @param algorithm 抖动算法
   * @param enhanceContrast 是否增强对比度
   */
  async optimizeForMonochromeScreen(
    imagePath: string,
    targetSize: ImageDimensions,
    algorithm: string = 'floydSteinberg',
    enhanceContrast: boolean = true
  ): Promise<{ canvas: Canvas; success: boolean; error?: string }> {
    try {
      const image = await loadImage(imagePath);
      
      // 创建输入canvas
      const inputCanvas = createCanvas(targetSize.width, targetSize.height);
      const inputCtx = inputCanvas.getContext('2d');
      
      // 白色背景
      inputCtx.fillStyle = 'white';
      inputCtx.fillRect(0, 0, targetSize.width, targetSize.height);
      
      // 计算缩放并居中
      const scale = Math.min(
        targetSize.width / image.width,
        targetSize.height / image.height
      );
      
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      const x = (targetSize.width - scaledWidth) / 2;
      const y = (targetSize.height - scaledHeight) / 2;
      
      inputCtx.drawImage(image, x, y, scaledWidth, scaledHeight);

      // 针对1-bit屏幕的预处理
      if (enhanceContrast) {
        await this.enhanceContrastForDithering(inputCtx, targetSize);
      }

      // 应用抖动算法
      const outputCanvas = createCanvas(targetSize.width, targetSize.height);
      
      const ditheringOptions = {
        errorDiffusionMatrix: algorithm,
        ditheringType: 'errorDiffusion',
        palette: 'default' // 纯黑白调色板
      };

      console.log(`🎯 针对1-bit黑白屏优化，使用 ${algorithm} 算法`);
      ditherImage(inputCanvas as any, outputCanvas as any, ditheringOptions);

      return { canvas: outputCanvas, success: true };
    } catch (error) {
      return {
        canvas: createCanvas(1, 1),
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 针对抖动算法增强对比度
   * 1-bit屏幕上，好的对比度是清晰显示的关键
   */
  private async enhanceContrastForDithering(
    ctx: any, 
    size: ImageDimensions
  ): Promise<void> {
    const imageData = ctx.getImageData(0, 0, size.width, size.height);
    const data = imageData.data;

    // 计算图像的亮度分布
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const brightness = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      histogram[brightness]++;
    }

    // 找到5%和95%分位数用于对比度拉伸
    const totalPixels = size.width * size.height;
    const lowerThreshold = Math.floor(totalPixels * 0.05);
    const upperThreshold = Math.floor(totalPixels * 0.95);
    
    let minBrightness = 0;
    let maxBrightness = 255;
    let count = 0;

    // 找到5%分位数
    for (let i = 0; i < 256; i++) {
      count += histogram[i];
      if (count >= lowerThreshold) {
        minBrightness = i;
        break;
      }
    }

    // 找到95%分位数  
    count = 0;
    for (let i = 255; i >= 0; i--) {
      count += histogram[i];
      if (count >= totalPixels - upperThreshold) {
        maxBrightness = i;
        break;
      }
    }

    // 应用对比度拉伸
    const range = maxBrightness - minBrightness;
    if (range > 0) {
      for (let i = 0; i < data.length; i += 4) {
        // 对每个颜色通道应用对比度拉伸
        for (let c = 0; c < 3; c++) {
          let value = data[i + c];
          value = Math.max(0, Math.min(255, 
            255 * (value - minBrightness) / range
          ));
          data[i + c] = value;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      console.log(`📈 对比度增强: ${minBrightness}-${maxBrightness} → 0-255`);
    }
  }

  /**
   * 生成针对1-bit屏幕的优化建议
   */
  getOptimizationTips(): string[] {
    return [
      '🎯 您的设备类型：1-bit 黑白点阵式水墨屏',
      '📊 显示原理：通过抖动算法的点密度模拟灰度',
      '✅ 实测结果：增强对比度显著提升清晰度和锐利度',
      '💡 优化建议：',
      '  • 默认启用对比度增强功能',
      '  • Floyd-Steinberg算法表现最佳',
      '  • 避免过于复杂的细节，会产生视觉噪点',
      '  • 线条清晰的图片比照片效果更好',
      '  • 推荐图片：图标、文字、简单插画'
    ];
  }

  async canvasToBase64(canvas: Canvas): Promise<string> {
    const buffer = canvas.toBuffer('image/png');
    return buffer.toString('base64');
  }

  async saveCanvasToFile(canvas: Canvas, outputPath: string): Promise<void> {
    const buffer = canvas.toBuffer('image/png');
    const fs = await import('fs');
    await fs.promises.writeFile(outputPath, buffer);
  }
}