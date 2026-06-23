import type { RenderTarget } from './render-targets.js';

// device_type → 打印头 DPI。niimbot 全系共用 BLE，但打印头密度不同。
export const DEVICE_TYPE_DPI: Record<number, number> = {
  775: 203,   // B21
  4097: 300,  // B1 Pro (0x1001)
};
export const DEFAULT_DPI = 203;

export function dpiForDeviceType(deviceType?: number | null): number {
  if (deviceType != null && DEVICE_TYPE_DPI[deviceType] != null) {
    return DEVICE_TYPE_DPI[deviceType];
  }
  return DEFAULT_DPI;
}

export function pxPerMm(dpi: number): number {
  return dpi / 25.4;
}

// width 取整到 8 的倍数（niimbot 硬约束）
export function mmToWidthPx(mm: number, dpi: number): number {
  return Math.round((mm * pxPerMm(dpi)) / 8) * 8;
}

// height 取整即可
export function mmToHeightPx(mm: number, dpi: number): number {
  return Math.round(mm * pxPerMm(dpi));
}

// 按目标打印机 DPI 派生 RenderTarget：仅当 target 有 physical(mm) 且 DPI 不同才重算像素。
export function deriveTargetForDevice(
  target: RenderTarget,
  deviceType?: number | null
): RenderTarget {
  if (!target.physical) return target;
  const dpi = dpiForDeviceType(deviceType);
  if (dpi === target.dpi) return target;
  return {
    ...target,
    dpi,
    widthPx: mmToWidthPx(target.physical.widthMm, dpi),
    heightPx: mmToHeightPx(target.physical.heightMm, dpi),
  };
}
