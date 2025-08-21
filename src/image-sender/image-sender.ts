import { ImageProcessor } from './image-processor.js';
import { MindResetDeviceClient } from './device-client.js';
import { ImageSendOptions, ApiResponse } from './types.js';

export class ImageSender {
  private processor: ImageProcessor;
  private client: MindResetDeviceClient;

  constructor(client?: MindResetDeviceClient) {
    this.processor = new ImageProcessor();
    this.client = client || MindResetDeviceClient.fromEnvironment();
  }

  async sendImageFile(imagePath: string, options: ImageSendOptions = {}): Promise<ApiResponse> {
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
      tempPath = this.processor.generateTempPath(imagePath);
      
      const resizeSuccess = await this.processor.resizeImage(imagePath, tempPath);
      if (!resizeSuccess) {
        return { success: false, error: '图片尺寸调整失败' };
      }
      
      imagePathToSend = tempPath;
    }

    try {
      console.log('正在转换图片为Base64...');
      const base64Image = await this.processor.imageToBase64(imagePathToSend);
      
      console.log('正在发送图片到设备...');
      const result = await this.client.sendImage(base64Image, options);

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