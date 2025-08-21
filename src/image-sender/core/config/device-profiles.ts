/**
 * 设备配置文件 - 针对不同类型水墨屏的优化参数
 */

import { DeviceProfile } from '../types/device.js';
import { DEVICE_SCREEN_SIZE } from './constants.js';

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  // 1-bit 黑白点阵式水墨屏 (如您的设备)
  'monochrome-dithered': {
    name: '黑白点阵式水墨屏',
    description: '1-bit 单色水墨屏，通过抖动算法模拟灰度',
    resolution: DEVICE_SCREEN_SIZE,
    colorSupport: 'monochrome',
    recommendedAlgorithms: ['floydSteinberg', 'jarvis', 'stucki'],
    defaultAlgorithm: 'floydSteinberg',
    palette: 'monochrome',
    optimizations: {
      highContrast: true,
      enhancedDithering: true,
      compactLayout: true,
    }
  },

  // 4级灰阶水墨屏
  'grayscale-4': {
    name: '4级灰阶水墨屏',
    description: '支持4级真实灰度显示的水墨屏',
    resolution: DEVICE_SCREEN_SIZE,
    colorSupport: 'grayscale-4',
    recommendedAlgorithms: ['quantizationOnly', 'floydSteinberg'],
    defaultAlgorithm: 'quantizationOnly',
    palette: 'grayscale',
    optimizations: {
      highContrast: false,
      enhancedDithering: false,
      compactLayout: true,
    }
  },

  // 16级灰阶水墨屏 (如 E Ink Carta)
  'grayscale-16': {
    name: '16级灰阶水墨屏',
    description: '高端水墨屏，支持16级灰度显示',
    resolution: DEVICE_SCREEN_SIZE,
    colorSupport: 'grayscale-16',
    recommendedAlgorithms: ['quantizationOnly', 'orderedDithering'],
    defaultAlgorithm: 'quantizationOnly',
    palette: 'grayscale',
    optimizations: {
      highContrast: false,
      enhancedDithering: false,
      compactLayout: false,
    }
  },

  // 彩色水墨屏
  'color-spectra': {
    name: '彩色水墨屏',
    description: '支持多色显示的彩色水墨屏',
    resolution: DEVICE_SCREEN_SIZE,
    colorSupport: 'color',
    recommendedAlgorithms: ['floydSteinberg', 'jarvis'],
    defaultAlgorithm: 'floydSteinberg',
    palette: 'spectra6',
    optimizations: {
      highContrast: false,
      enhancedDithering: true,
      compactLayout: false,
    }
  }
};

/**
 * 获取设备配置文件
 */
export function getDeviceProfile(profileName: string): DeviceProfile {
  return DEVICE_PROFILES[profileName] || DEVICE_PROFILES['monochrome-dithered'];
}

/**
 * 获取单色屏幕推荐设置
 */
export function getRecommendedSettingsForMonochromeScreen() {
  const profile = DEVICE_PROFILES['monochrome-dithered'];
  return {
    algorithm: profile.defaultAlgorithm,
    palette: profile.palette,
    enhanceContrast: true,
    optimizeForDithering: true
  };
}

/**
 * 根据颜色支持获取合适的配置文件
 */
export function getProfileByColorSupport(colorSupport: DeviceProfile['colorSupport']): DeviceProfile {
  const matchingProfile = Object.values(DEVICE_PROFILES).find(
    profile => profile.colorSupport === colorSupport
  );
  return matchingProfile || DEVICE_PROFILES['monochrome-dithered'];
}