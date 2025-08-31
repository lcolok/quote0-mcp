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
        let enhancedError = `${response.status} ${response.statusText} - ${error}`;
        
        // 根据HTTP状态码提供更详细的错误信息和解决建议
        if (response.status === 429) {
          enhancedError += `

⏱️ 请求频率过高 - API速率限制
🔍 建议解决方案：
1. 等待 30-60 秒后再次尝试发送
2. 避免在短时间内频繁发送图片到同一设备
3. 如需批量发送，请在每次发送之间添加延迟（建议间隔至少10秒）
4. 检查是否有其他程序同时在使用相同的设备API

💡 提示：MindReset API对每个设备有请求频率限制，请适当控制发送频率`;

        } else if (response.status === 500) {
          enhancedError += `

🚨 服务器内部错误 - 可能的设备连接问题
🔍 建议检查：
1. MindReset设备是否正确连接电源和USB数据线
2. 尝试拔插USB数据线重新连接设备
3. 检查设备屏幕是否有显示（可能处于休眠状态）
4. 在 https://dot.mindreset.tech 确认设备是否显示为在线状态
5. 如果设备显示离线，请检查设备电源指示灯和连接状态

💡 提示：MindReset设备需要稳定的USB连接才能正常接收数据`;

        } else if (response.status === 401 || response.status === 403) {
          enhancedError += `

🔐 认证失败 - 设备ID或密钥问题
🔍 建议检查：
1. MINDRESET_DEVICE_ID 是否正确设置
2. MINDRESET_DEVICE_SECRET 是否正确设置
3. 设备密钥是否已过期，可在管理界面重新生成`;

        } else if (response.status === 404) {
          enhancedError += `

❌ 设备未找到
🔍 建议检查：
1. 设备ID是否正确
2. 设备是否已在系统中正确注册
3. 检查 https://dot.mindreset.tech 中的设备列表`;

        } else if (response.status >= 502 && response.status <= 504) {
          enhancedError += `

🌐 网关错误 - 服务暂时不可用
🔍 建议：
1. 稍后重试（可能是临时的服务器问题）
2. 检查网络连接是否正常
3. 确认 dot.mindreset.tech 服务状态`;
        }
        
        return { 
          success: false, 
          error: enhancedError
        };
      }
    } catch (error) {
      let enhancedError = error instanceof Error ? error.message : String(error);
      
      // 网络连接相关错误的特殊处理
      if (enhancedError.includes('ECONNREFUSED')) {
        enhancedError += `

🌐 连接被拒绝
🔍 建议检查：
1. 网络连接是否正常
2. 防火墙是否阻止了对 dot.mindreset.tech 的访问
3. 是否使用了代理服务器`;

      } else if (enhancedError.includes('ETIMEDOUT') || enhancedError.includes('timeout')) {
        enhancedError += `

⏱️ 连接超时
🔍 建议检查：
1. 网络连接速度和稳定性
2. 设备是否处于活跃状态
3. 尝试稍后重新发送`;

      } else if (enhancedError.includes('ENOTFOUND') || enhancedError.includes('getaddrinfo')) {
        enhancedError += `

🔍 DNS解析失败
🔍 建议检查：
1. 网络连接是否正常
2. DNS设置是否正确
3. 是否能够访问其他网站`;
      }
      
      return {
        success: false,
        error: enhancedError
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