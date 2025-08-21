# MindReset 图片发送模块

这是一个用于向 MindReset 设备发送图片的 TypeScript 模块。

## 功能特性

- 🖼️ 自动调整图片尺寸为 296x152 像素
- 📁 自动加载 `.env` 文件中的设备配置
- 🔄 支持Base64编码转换
- 🧹 自动清理临时文件
- 📝 完整的TypeScript类型支持

## 快速开始

### 1. CLI 工具使用

```bash
# 构建项目
npm run build

# 发送图片（使用默认白边框）
node dist/image-sender/cli.js /path/to/image.png

# 发送图片（黑边框）
node dist/image-sender/cli.js /path/to/image.png 1

# 发送图片（带跳转链接）
node dist/image-sender/cli.js /path/to/image.png 0 https://example.com
```

### 2. 模块使用

```typescript
import { ImageSender, EnvLoader } from './image-sender/index.js';

// 加载环境变量
EnvLoader.ensureEnvVars();

// 创建发送器
const sender = new ImageSender();

// 发送图片
const result = await sender.sendImageFile('/path/to/image.png', {
  border: '0', // 0=白边框, 1=黑边框
  link: 'https://example.com' // 可选的跳转链接
});

if (result.success) {
  console.log('发送成功!', result.data);
} else {
  console.error('发送失败:', result.error);
}
```

## 环境配置

在项目根目录创建 `.env` 文件：

```env
MINDRESET_DEVICE_ID=你的设备ID
MINDRESET_DEVICE_SECRET=你的设备密钥
```

## 模块结构

```
src/image-sender/
├── types.ts          # TypeScript 类型定义
├── env-loader.ts     # 环境变量加载器
├── image-processor.ts # 图片处理工具
├── device-client.ts  # 设备API客户端
├── image-sender.ts   # 主要发送器类
├── cli.ts           # 命令行工具
├── index.ts         # 模块导出
└── README.md        # 说明文档
```

## API 参考

### ImageSender

主要的图片发送类。

```typescript
class ImageSender {
  // 发送图片文件
  async sendImageFile(imagePath: string, options?: ImageSendOptions): Promise<ApiResponse>
  
  // 发送文本消息
  async sendText(message: string, options?: { title?: string; signature?: string }): Promise<ApiResponse>
}
```

### ImageProcessor

图片处理工具类。

```typescript
class ImageProcessor {
  // 获取图片信息
  async getImageInfo(imagePath: string): Promise<{ dimensions: ImageDimensions; exists: boolean }>
  
  // 调整图片尺寸
  async resizeImage(inputPath: string, outputPath: string, targetSize?: ImageDimensions): Promise<boolean>
  
  // 转换为Base64
  async imageToBase64(imagePath: string): Promise<string>
}
```

### MindResetDeviceClient

设备API客户端。

```typescript
class MindResetDeviceClient {
  // 从环境变量创建客户端
  static fromEnvironment(): MindResetDeviceClient
  
  // 发送图片
  async sendImage(base64Image: string, options?: { border?: "0" | "1"; link?: string }): Promise<ApiResponse>
  
  // 发送文本
  async sendText(message: string, options?: { title?: string; signature?: string }): Promise<ApiResponse>
}
```

## 注意事项

- 图片会自动调整为设备屏幕尺寸 (296x152 像素)
- 支持的图片格式: PNG (推荐)
- 需要 macOS 系统的 `sips` 工具来调整图片尺寸
- 设备 API 要求图片为 Base64 编码的 PNG 格式