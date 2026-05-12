/**
 * e-ink 图片格式转换器
 * 将 PNG 转换为 1-bit packed bitmap (296×152, MSB-first, 黑像素=1)
 * 格式与 ESP32 GxEPD2 drawBitmap() 严格一致
 */

import sharp from 'sharp';

const EINK_WIDTH = 296;
const EINK_HEIGHT = 152;
const EINK_BITMAP_SIZE = (EINK_WIDTH * EINK_HEIGHT) / 8; // 5624

/**
 * 将 PNG buffer 转换为 5624 字节 1-bit packed bitmap
 * @param pngBuffer - 输入 PNG 文件的 buffer
 * @returns 5624 字节的 packed bitmap buffer
 */
export async function pngTo1BitBitmap(pngBuffer: Buffer): Promise<Buffer> {
  // 1. sharp 加载 PNG → 灰度 → 阈值 128 二值化 → raw 像素
  const raw = await sharp(pngBuffer)
    .resize(EINK_WIDTH, EINK_HEIGHT, { fit: 'fill' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  // raw 是 296*152 = 44992 字节，每字节代表一个像素（0 或 255）

  // 2. Pack 成 1-bit MSB-first, 黑像素 (value=0) → bit=1
  const packed = Buffer.alloc(EINK_BITMAP_SIZE);
  for (let i = 0; i < raw.length; i++) {
    const isBlack = raw[i] < 128;
    if (isBlack) {
      const byteIdx = i >> 3;
      const bitIdx = 7 - (i & 7); // MSB first
      packed[byteIdx] |= (1 << bitIdx);
    }
  }
  return packed;
}

/**
 * 验证 bitmap 大小是否正确
 */
export function validateBitmapSize(buf: Buffer): boolean {
  return buf.length === EINK_BITMAP_SIZE;
}

export const EINK_CONSTANTS = {
  WIDTH: EINK_WIDTH,
  HEIGHT: EINK_HEIGHT,
  BITMAP_SIZE: EINK_BITMAP_SIZE,
};
