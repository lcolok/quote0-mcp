import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ImageDimensions, DEVICE_SCREEN_SIZE, ImageProcessingOptions } from './types.js';
import { EinkOptimizer } from './eink-optimizer.js';

const execAsync = promisify(exec);

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
      const { stdout } = await execAsync(`file "${imagePath}"`);
      const match = stdout.match(/(\d+) x (\d+)/);
      if (match) {
        return {
          dimensions: {
            width: parseInt(match[1], 10),
            height: parseInt(match[2], 10)
          },
          exists: true
        };
      }
    } catch (error) {
      console.warn('获取图片信息失败:', error);
    }

    return { dimensions: { width: 0, height: 0 }, exists: true };
  }

  async resizeImage(inputPath: string, outputPath: string, targetSize: ImageDimensions = DEVICE_SCREEN_SIZE): Promise<boolean> {
    try {
      const command = `sips -z ${targetSize.height} ${targetSize.width} "${inputPath}" --out "${outputPath}"`;
      console.log(`正在调整图片尺寸为 ${targetSize.width}x${targetSize.height}...`);
      
      await execAsync(command);
      console.log(`图片已调整: ${outputPath}`);
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
    return `/tmp/mindreset_resized_${Date.now()}.${extension}`;
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