/**
 * 系统常量定义
 */

import { ImageDimensions } from '../types/device.js';

// 设备屏幕尺寸
export const DEVICE_SCREEN_SIZE: ImageDimensions = {
  width: 296,
  height: 152
};

// API配置
export const API_CONFIG = {
  BASE_URL: 'https://dot.mindreset.tech/api',
  TIMEOUT: 30000, // 30秒
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1秒
} as const;

// 支持的图片格式
export const SUPPORTED_IMAGE_FORMATS = [
  'png',
  'jpg', 
  'jpeg',
  'gif',
  'webp'
] as const;

// 文件大小限制
export const FILE_SIZE_LIMITS = {
  MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_GIF_SIZE: 50 * 1024 * 1024,   // 50MB
} as const;

// 处理超时时间
export const PROCESSING_TIMEOUTS = {
  IMAGE_RESIZE: 10000,      // 10秒
  OPTIMIZATION: 30000,      // 30秒
  GIF_EXTRACTION: 15000,    // 15秒
} as const;

// 默认优化参数
export const DEFAULT_OPTIMIZATION = {
  ALGORITHM: 'floydSteinberg',
  PALETTE: 'monochrome',
  ENABLE_DITHERING: true,
  ENHANCE_CONTRAST: true,
  PRESERVE_ASPECT_RATIO: true,
} as const;

// 统一的输出目录配置
export const OUTPUT_DIRECTORIES = {
  BASE: './processed-images',
  TEMP: './temp-images',
  PREVIEWS: './processed-images/previews',
  MONOCHROME: './processed-images/monochrome',
  QUICK_SEND: './processed-images/quick-send',
} as const;