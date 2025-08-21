import { createCanvas, loadImage, Canvas } from 'canvas';
import { ditherImage, getDefaultPalettes } from 'epdoptimize';
import { EinkOptimizationOptions, ImageDimensions } from '../../core/types/index.js';

export class EinkOptimizer {
  async optimizeImageForEink(
    imagePath: string, 
    targetSize: ImageDimensions,
    options: EinkOptimizationOptions = {}
  ): Promise<{ canvas: Canvas; success: boolean; error?: string }> {
    try {
      const {
        enableDithering = true,
        algorithm = 'floydSteinberg',
        type = 'errorDiffusion',
        palette = 'monochrome',
        customColors
      } = options;

      const image = await loadImage(imagePath);
      
      const inputCanvas = createCanvas(targetSize.width, targetSize.height);
      const inputCtx = inputCanvas.getContext('2d');
      
      inputCtx.fillStyle = 'white';
      inputCtx.fillRect(0, 0, targetSize.width, targetSize.height);
      
      const scale = Math.min(
        targetSize.width / image.width,
        targetSize.height / image.height
      );
      
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      const x = (targetSize.width - scaledWidth) / 2;
      const y = (targetSize.height - scaledHeight) / 2;
      
      inputCtx.drawImage(image, x, y, scaledWidth, scaledHeight);

      if (!enableDithering) {
        return { canvas: inputCanvas, success: true };
      }

      const outputCanvas = createCanvas(targetSize.width, targetSize.height);
      
      const ditheringOptions = {
        errorDiffusionMatrix: algorithm,
        ditheringType: type,
        palette: palette
      };

      // 特殊处理：如果禁用抖动，直接使用量化
      if (!enableDithering) {
        ditheringOptions.ditheringType = 'quantizationOnly';
        (ditheringOptions as any).errorDiffusionMatrix = undefined;
      }

      console.log(`正在使用 ${algorithm} 算法进行水墨屏优化...`);
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

  private getBuiltinPalette(paletteType: string): string[] {
    // 使用 epdoptimize 库的内置调色板名称
    switch (paletteType) {
      case 'monochrome':
        return ['default'];
      case 'grayscale':
        return ['default'];  
      case 'spectra6':
        return ['spectra6'];
      default:
        return ['default'];
    }
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