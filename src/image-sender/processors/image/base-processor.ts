import fs from 'fs';
import { ImageDimensions, ImageProcessingOptions } from '../../core/types/index.js';
import { DEVICE_SCREEN_SIZE, OUTPUT_DIRECTORIES } from '../../core/config/index.js';
import { EinkOptimizer } from '../optimization/dithering-optimizer.js';
import { createCanvas, loadImage } from 'canvas';

export class ImageProcessor {
  private einkOptimizer: EinkOptimizer;

  constructor() {
    this.einkOptimizer = new EinkOptimizer();
  }
  private async checkImageExists(imagePath: string): Promise<boolean> {
    try {
      await fs.promises.access(imagePath);
      return true;
    } catch {
      return false;
    }
  }

  async getImageInfo(imagePath: string): Promise<{ dimensions: ImageDimensions; exists: boolean }> {
    const exists = await this.checkImageExists(imagePath);
    if (!exists) {
      return { dimensions: { width: 0, height: 0 }, exists: false };
    }

    try {
      const image = await loadImage(imagePath);
      return {
        dimensions: {
          width: image.width,
          height: image.height
        },
        exists: true
      };
    } catch (error) {
      console.warn('获取图片信息失败:', error);
    }

    return { dimensions: { width: 0, height: 0 }, exists: true };
  }

  async resizeImage(inputPath: string, outputPath: string, targetSize: ImageDimensions = DEVICE_SCREEN_SIZE): Promise<boolean> {
    try {
      console.log(`正在保持宽高比调整图片（避免拉伸和裁剪内容）...`);
      
      const image = await loadImage(inputPath);
      
      const scale = Math.min(
        targetSize.width / image.width,
        targetSize.height / image.height
      );
      const newWidth = Math.round(image.width * scale);
      const newHeight = Math.round(image.height * scale);
      
      const canvas = createCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, newWidth, newHeight);
      
      const buffer = canvas.toBuffer('image/png');
      await fs.promises.writeFile(outputPath, buffer);
      
      console.log(`图片已调整为: ${newWidth}x${newHeight} (目标: ${targetSize.width}x${targetSize.height})`);
      
      return true;
    } catch (error) {
      console.error('图片调整失败:', error);
      return false;
    }
  }

  async imageToBase64(imagePath: string): Promise<string> {
    try {
      const imageBuffer = await fs.promises.readFile(imagePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`读取图片文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  generateTempPath(originalPath: string): string {
    const extension = originalPath.split('.').pop() || 'png';
    return `${OUTPUT_DIRECTORIES.TEMP}/mindreset_resized_${Date.now()}.${extension}`;
  }

  async ensureTempDirectory(): Promise<void> {
    try {
      await fs.promises.mkdir(OUTPUT_DIRECTORIES.TEMP, { recursive: true });
    } catch (error) {
      // 目录可能已存在，忽略错误
    }
  }

  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
      console.log('临时文件已清理:', filePath);
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }
  }

  async processImageForEink(
    inputPath: string, 
    outputPath: string, 
    options: ImageProcessingOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        resize = true,
        targetSize = DEVICE_SCREEN_SIZE,
        enableDithering = true,
        ...einkOptions
      } = options;

      console.log('正在进行水墨屏优化处理...');
      
      let processPath = inputPath;

      if (resize) {
        const { dimensions } = await this.getImageInfo(inputPath);
        if (dimensions.width !== targetSize.width || dimensions.height !== targetSize.height) {
          await this.ensureTempDirectory();
          const tempResizePath = this.generateTempPath(inputPath);
          const resizeSuccess = await this.resizeImage(inputPath, tempResizePath, targetSize);
          if (!resizeSuccess) {
            return { success: false, error: '图片尺寸调整失败' };
          }
          processPath = tempResizePath;
        }
      }

      const optimizeResult = await this.einkOptimizer.optimizeImageForEink(
        processPath,
        targetSize,
        { enableDithering, ...einkOptions }
      );

      if (!optimizeResult.success) {
        return { success: false, error: optimizeResult.error };
      }

      await this.einkOptimizer.saveCanvasToFile(optimizeResult.canvas, outputPath);

      if (processPath !== inputPath) {
        await this.cleanupTempFile(processPath);
      }

      console.log(`✅ 水墨屏优化完成: ${outputPath}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async imageToBase64WithEinkOptimization(
    imagePath: string, 
    options: ImageProcessingOptions = {}
  ): Promise<string> {
    const optimizeResult = await this.einkOptimizer.optimizeImageForEink(
      imagePath,
      options.targetSize || DEVICE_SCREEN_SIZE,
      options
    );

    if (!optimizeResult.success) {
      throw new Error(`水墨屏优化失败: ${optimizeResult.error}`);
    }

    return await this.einkOptimizer.canvasToBase64(optimizeResult.canvas);
  }
}