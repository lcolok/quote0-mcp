import sharp from 'sharp';
import type { RenderTarget } from './render-targets.js';

/**
 * PNG → MSB-first 1-bit bitmap pack
 * - bit=1=burn / bit=0=blank（niimbot 契约）
 * - 行步距 = widthPx / 8
 * - 阈值 128
 */
export async function packFromPng(pngBuffer: Buffer, target: RenderTarget): Promise<Buffer> {
  const { data: raw } = await sharp(pngBuffer)
    .resize(target.widthPx, target.heightPx, { fit: 'fill' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bytesPerRow = target.widthPx / 8;
  const bitmapBuffer = Buffer.alloc(bytesPerRow * target.heightPx);
  for (let y = 0; y < target.heightPx; y++) {
    for (let x = 0; x < target.widthPx; x++) {
      if (raw[y * target.widthPx + x] === 0) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bitmapBuffer[byteIdx] |= 1 << bitIdx;
      }
    }
  }
  return bitmapBuffer;
}

/**
 * 把 dither 后的 mono buffer（每像素 0=黑/burn 或 255=白）直接 pack 成 MSB-first 1-bit bitmap。
 * 与 packFromPng 字节序契约一致：bit=1=burn。
 */
export function packMonoBuffer(mono: Uint8Array, target: RenderTarget): Buffer {
  const bytesPerRow = target.widthPx / 8;
  const bitmapBuffer = Buffer.alloc(bytesPerRow * target.heightPx);
  for (let y = 0; y < target.heightPx; y++) {
    for (let x = 0; x < target.widthPx; x++) {
      if (mono[y * target.widthPx + x] === 0) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bitmapBuffer[byteIdx] |= 1 << bitIdx;
      }
    }
  }
  return bitmapBuffer;
}
