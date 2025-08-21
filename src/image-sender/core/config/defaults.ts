/**
 * 默认配置
 */

import { ImageProcessingOptions } from '../types/optimization.js';
import { DEVICE_SCREEN_SIZE, DEFAULT_OPTIMIZATION } from './constants.js';

// 默认图片处理选项
export const DEFAULT_PROCESSING_OPTIONS: ImageProcessingOptions = {
  resize: true,
  targetSize: DEVICE_SCREEN_SIZE,
  enableDithering: DEFAULT_OPTIMIZATION.ENABLE_DITHERING,
  algorithm: DEFAULT_OPTIMIZATION.ALGORITHM as any,
  type: 'errorDiffusion',
  palette: DEFAULT_OPTIMIZATION.PALETTE as any,
  enhanceContrast: DEFAULT_OPTIMIZATION.ENHANCE_CONTRAST,
  preserveAspectRatio: DEFAULT_OPTIMIZATION.PRESERVE_ASPECT_RATIO,
};

// CLI默认选项
export const DEFAULT_CLI_OPTIONS = {
  border: '0' as const,
  outputDir: './output',
  verbose: false,
  force: false,
};

// 环境变量配置
export const ENV_CONFIG = {
  DEVICE_ID_KEY: 'MINDRESET_DEVICE_ID',
  DEVICE_SECRET_KEY: 'MINDRESET_DEVICE_SECRET',
  LOG_LEVEL_KEY: 'LOG_LEVEL',
  API_BASE_URL_KEY: 'API_BASE_URL',
} as const;