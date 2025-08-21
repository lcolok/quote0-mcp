/**
 * 图片相关类型定义
 */

import { ImageDimensions } from './device.js';

export interface ImageSendOptions {
  border?: "0" | "1";
  link?: string;
  // 官方抖动参数
  ditherType?: string;
  ditherKernel?: string;
  useServerDithering?: boolean; // 是否使用服务端抖动
}

export interface ImagePayload {
  deviceId: string;
  image: string;
  border?: "0" | "1";
  link?: string;
  // 官方抖动参数
  ditherType?: string;
  ditherKernel?: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  colorDepth?: number;
}

export interface ImageProcessingResult {
  success: boolean;
  processedImage?: string; // Base64
  metadata?: ImageMetadata;
  processingTime?: number;
  error?: string;
}