/**
 * 设备配置文件 - 针对不同类型水墨屏的优化参数
 */

export interface DeviceProfile {
  name: string;
  description: string;
  colorSupport: 'monochrome' | 'grayscale-4' | 'grayscale-16' | 'color';
  recommendedAlgorithms: string[];
  defaultAlgorithm: string;
  palette: string;
  optimizationHints: string[];
}

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  // 1-bit 黑白点阵式水墨屏 (如您的设备)
  'monochrome-dithered': {
    name: '黑白点阵式水墨屏',
    description: '1-bit 单色水墨屏，通过抖动算法模拟灰度',
    colorSupport: 'monochrome',
    recommendedAlgorithms: ['floydSteinberg', 'jarvis', 'stucki'],
    defaultAlgorithm: 'floydSteinberg',
    palette: 'default',
    optimizationHints: [
      '此类屏幕依赖抖动算法模拟灰度效果',
      '✅ 实测验证：增强对比度显著提升清晰度',
      'Floyd-Steinberg算法通常效果最佳',
      '建议启用对比度增强功能',
      '避免过于复杂的细节，会产生噪点'
    ]
  },

  // 4级灰阶水墨屏
  'grayscale-4': {
    name: '4级灰阶水墨屏',
    description: '支持4级真实灰度显示的水墨屏',
    colorSupport: 'grayscale-4',
    recommendedAlgorithms: ['quantizationOnly', 'floydSteinberg'],
    defaultAlgorithm: 'quantizationOnly',
    palette: 'default',
    optimizationHints: [
      '支持真实4级灰度，可以不使用抖动',
      '直接量化到4个灰度级别效果更好',
      '如需更平滑效果可使用轻微抖动'
    ]
  },

  // 16级灰阶水墨屏 (如 E Ink Carta)
  'grayscale-16': {
    name: '16级灰阶水墨屏',
    description: '高端水墨屏，支持16级灰度显示',
    colorSupport: 'grayscale-16', 
    recommendedAlgorithms: ['quantizationOnly', 'orderedDithering'],
    defaultAlgorithm: 'quantizationOnly',
    palette: 'default',
    optimizationHints: [
      '支持丰富的灰度层次',
      '通常不需要复杂的抖动算法',
      '可直接量化到16个灰度级别'
    ]
  },

  // 彩色水墨屏
  'color-spectra': {
    name: '彩色水墨屏',
    description: '支持多色显示的彩色水墨屏',
    colorSupport: 'color',
    recommendedAlgorithms: ['floydSteinberg', 'jarvis'],
    defaultAlgorithm: 'floydSteinberg',
    palette: 'spectra6',
    optimizationHints: [
      '支持多种颜色显示',
      '抖动算法有助于色彩过渡',
      '注意色彩饱和度可能较低'
    ]
  }
};

export function getDeviceProfile(profileName: string): DeviceProfile {
  return DEVICE_PROFILES[profileName] || DEVICE_PROFILES['monochrome-dithered'];
}

export function getRecommendedSettingsForMonochromeScreen() {
  const profile = DEVICE_PROFILES['monochrome-dithered'];
  return {
    algorithm: profile.defaultAlgorithm,
    palette: profile.palette,
    enhanceContrast: true,
    optimizeForDithering: true
  };
}