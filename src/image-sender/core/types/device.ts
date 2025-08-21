/**
 * 设备相关类型定义
 */

export interface DeviceConfig {
  deviceId: string;
  deviceSecret: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface DeviceProfile {
  name: string;
  description: string;
  resolution: ImageDimensions;
  colorSupport: 'monochrome' | 'grayscale-4' | 'grayscale-16' | 'color';
  recommendedAlgorithms: string[];
  defaultAlgorithm: string;
  palette: string;
  optimizations: {
    highContrast?: boolean;
    enhancedDithering?: boolean;
    compactLayout?: boolean;
  };
}