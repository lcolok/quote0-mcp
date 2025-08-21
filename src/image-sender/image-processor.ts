import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ImageDimensions, DEVICE_SCREEN_SIZE } from './types.js';

const execAsync = promisify(exec);

export class ImageProcessor {
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
}