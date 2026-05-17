/**
 * 电子纸设备物理分辨率（单一真理源 single source of truth）。
 *
 * 历史教训（2026-05-16）：
 * - v1.0.22 之前各 widget / renderer 硬编码 640×384，但设备真实分辨率是 296×152
 * - v1.0.33 的 producer 路径强制切 renderer='news'，而 news renderer 默认 640×384
 *   导致 inventory 入库的图全部不匹配设备，设备显示挤到左上角
 * - 修复后所有渲染路径都必须引用本常量，禁止再写裸数字 296/152/640/384
 *
 * v1.0.38（Phase A）语义：
 * 以下常量保留为 backward-compat 入口，新代码应直接 import RenderTarget
 * 从 ./render-targets.ts 获取完整的设备元数据（dpi / colorMode / fontStack 等）。
 */
import { EINK_TARGET } from './render-targets.js';

export const EINK_DEVICE_WIDTH = EINK_TARGET.widthPx;
export const EINK_DEVICE_HEIGHT = EINK_TARGET.heightPx;

/** 字符串形式，用于 HTML/CSS/字符串模板 */
export const EINK_DEVICE_SIZE_LABEL = `${EINK_TARGET.widthPx}x${EINK_TARGET.heightPx}`;
