/**
 * 优化相关类型定义
 */

import { ImageDimensions } from './device.js';

export type DitheringAlgorithm = 
  | 'floydSteinberg' 
  | 'jarvis' 
  | 'stucki' 
  | 'burkes' 
  | 'sierra' 
  | 'sierra2' 
  | 'sierraLite';

export type DitheringType = 
  | 'errorDiffusion' 
  | 'orderedDithering' 
  | 'randomDithering' 
  | 'quantizationOnly';

export type PaletteType = 
  | 'monochrome' 
  | 'grayscale' 
  | 'spectra6' 
  | 'custom';

export interface EinkOptimizationOptions {
  enableDithering?: boolean;
  algorithm?: DitheringAlgorithm;
  type?: DitheringType;
  palette?: PaletteType;
  customColors?: string[];
}

export interface ImageProcessingOptions extends EinkOptimizationOptions {
  resize?: boolean;
  targetSize?: ImageDimensions;
  enhanceContrast?: boolean;
  preserveAspectRatio?: boolean;
}

export interface OptimizationResult {
  success: boolean;
  optimizedData?: string;
  processingTime?: number;
  optimizationStats?: {
    originalSize: number;
    optimizedSize: number;
    compressionRatio: number;
    algorithmUsed: string;
  };
  error?: string;
}