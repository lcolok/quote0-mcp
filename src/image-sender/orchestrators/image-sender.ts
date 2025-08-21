import { ImageProcessor } from '../processors/image/base-processor.js';
import { MindResetDeviceClient } from '../services/api/device-client.js';
import { ImageSendOptions, ApiResponse, ImageProcessingOptions } from '../core/types/index.js';

export class ImageSender {
  private processor: ImageProcessor;
  private client: MindResetDeviceClient;

  constructor(client?: MindResetDeviceClient | null) {
    this.processor = new ImageProcessor();
    this.client = client === null ? null as any : (client || MindResetDeviceClient.fromEnvironment());
  }

  async sendImageFile(
    imagePath: string, 
    sendOptions: ImageSendOptions = {},
    processingOptions: ImageProcessingOptions = {}
  ): Promise<ApiResponse> {
    console.log(`正在处理图片: ${imagePath}`);

    const { exists, dimensions } = await this.processor.getImageInfo(imagePath);
    if (!exists) {
      return { success: false, error: `图片文件不存在: ${imagePath}` };
    }

    console.log(`原始图片尺寸: ${dimensions.width}x${dimensions.height}`);

    let imagePathToSend = imagePath;
    let tempPath: string | null = null;

    if (dimensions.width !== 296 || dimensions.height !== 152) {
      console.log('图片尺寸不匹配设备屏幕，正在调整...');
      await this.processor.ensureTempDirectory();
      tempPath = this.processor.generateTempPath(imagePath);
      
      const resizeSuccess = await this.processor.resizeImage(imagePath, tempPath);
      if (!resizeSuccess) {
        return { success: false, error: '图片尺寸调整失败' };
      }
      
      imagePathToSend = tempPath;
    }

    try {
      console.log('正在转换图片为Base64...');
      
      let base64Image: string;
      if (sendOptions.useServerDithering) {
        console.log('使用服务端抖动处理图片...');
        base64Image = await this.processor.imageToBase64(imagePathToSend);
      } else if (processingOptions.enableDithering !== false) {
        console.log('使用客户端水墨屏优化算法处理图片...');
        base64Image = await this.processor.imageToBase64WithEinkOptimization(imagePathToSend, processingOptions);
      } else {
        base64Image = await this.processor.imageToBase64(imagePathToSend);
      }
      
      console.log('正在发送图片到设备...');
      const result = await this.client.sendImage(base64Image, sendOptions);

      if (result.success) {
        console.log('✅ 图片发送成功!');
        if (result.data) {
          console.log('响应:', result.data);
        }
      } else {
        console.error('❌ 图片发送失败:', result.error);
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (tempPath) {
        await this.processor.cleanupTempFile(tempPath);
      }
    }
  }

  async generatePreview(
    imagePath: string,
    outputDir: string,
    processingOptions: ImageProcessingOptions = {}
  ): Promise<{ success: boolean; originalPath?: string; optimizedPath?: string; error?: string }> {
    try {
      console.log(`正在生成预览图片: ${imagePath}`);

      const { exists } = await this.processor.getImageInfo(imagePath);
      if (!exists) {
        return { success: false, error: `图片文件不存在: ${imagePath}` };
      }

      // 确保输出目录存在
      const fs = await import('fs');
      await fs.promises.mkdir(outputDir, { recursive: true });

      const timestamp = Date.now();
      const algorithmName = processingOptions.algorithm || 'floydSteinberg';
      const originalPreviewPath = `${outputDir}/original_${algorithmName}_${timestamp}.png`;
      const optimizedPreviewPath = `${outputDir}/optimized_${algorithmName}_${timestamp}.png`;

      // 生成原始图片的调整版本（仅调整尺寸）
      const originalResult = await this.processor.processImageForEink(
        imagePath,
        originalPreviewPath,
        { ...processingOptions, enableDithering: false }
      );

      if (!originalResult.success) {
        return { success: false, error: `生成原始预览失败: ${originalResult.error}` };
      }

      // 生成水墨屏优化版本
      const optimizedResult = await this.processor.processImageForEink(
        imagePath,
        optimizedPreviewPath,
        { ...processingOptions, enableDithering: true }
      );

      if (!optimizedResult.success) {
        return { success: false, error: `生成优化预览失败: ${optimizedResult.error}` };
      }

      console.log('✅ 预览图片生成完成!');
      console.log(`原始版本: ${originalPreviewPath}`);
      console.log(`优化版本: ${optimizedPreviewPath}`);

      return {
        success: true,
        originalPath: originalPreviewPath,
        optimizedPath: optimizedPreviewPath
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async sendText(message: string, options: { title?: string; signature?: string } = {}): Promise<ApiResponse> {
    console.log('正在发送文本到设备...');
    
    const result = await this.client.sendText(message, options);
    
    if (result.success) {
      console.log('✅ 文本发送成功!');
      if (result.data) {
        console.log('响应:', result.data);
      }
    } else {
      console.error('❌ 文本发送失败:', result.error);
    }

    return result;
  }
}