import { fetch } from "undici";
import { DeviceConfig, ImagePayload, ApiResponse, ImageSendOptions } from '../../core/types/index.js';

export class MindResetDeviceClient {
  private readonly baseUrl = "https://dot.mindreset.tech/api";
  private config: DeviceConfig;

  constructor(config: DeviceConfig) {
    this.config = config;
  }

  static fromEnvironment(): MindResetDeviceClient {
    const deviceId = process.env.MINDRESET_DEVICE_ID;
    const deviceSecret = process.env.MINDRESET_DEVICE_SECRET;

    if (!deviceId || !deviceSecret) {
      throw new Error(
        "Missing authentication. Please set MINDRESET_DEVICE_ID and MINDRESET_DEVICE_SECRET environment variables."
      );
    }

    return new MindResetDeviceClient({ deviceId, deviceSecret });
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.config.deviceSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "mindreset-image-sender/1.0.0",
      "X-Device-ID": this.config.deviceId,
      "X-Device-Secret": this.config.deviceSecret,
    };
  }

  async sendImage(base64Image: string, options: ImageSendOptions = {}): Promise<ApiResponse> {
    try {
      const payload: ImagePayload = {
        deviceId: this.config.deviceId,
        image: base64Image
      };

      if (options.border && options.border !== "0") {
        (payload as any).border = parseInt(options.border);
      }
      
      if (options.link) {
        payload.link = options.link;
      }

      // 添加官方抖动参数支持
      if (options.ditherType) {
        payload.ditherType = options.ditherType;
      }

      if (options.ditherKernel) {
        payload.ditherKernel = options.ditherKernel;
      }

      const response = await fetch(`${this.baseUrl}/open/image`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.text();
        return { success: true, data: result };
      } else {
        const error = await response.text();
        return { 
          success: false, 
          error: `${response.status} ${response.statusText} - ${error}` 
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async sendText(message: string, options: { title?: string; signature?: string } = {}): Promise<ApiResponse> {
    try {
      const payload = {
        deviceId: this.config.deviceId,
        message,
        ...options
      };

      const response = await fetch(`${this.baseUrl}/open/text`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.text();
        return { success: true, data: result };
      } else {
        const error = await response.text();
        return { 
          success: false, 
          error: `${response.status} ${response.statusText} - ${error}` 
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}