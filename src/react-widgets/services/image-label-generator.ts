import sharp from 'sharp';
import type { RenderTarget } from '../core/render-targets.js';
import { packFromPng } from '../core/bitmap-packer.js';
import { bizyairClient, type BizyAirModel } from './bizyair-client.js';

export interface ImageLabelGenResult {
  pngBuffer: Buffer;              // dither 后 1-bit PNG（存 MinIO 的）
  bitmapBuffer: Buffer;           // 直接给 niimbot 用的 1-bit pack
  sourceImageUrl: string;         // BizyAir 返回的原图 OSS 永久链接
  bizyairLatencyMs: number;
}

export class ImageLabelGenerator {
  async generate(
    prompt: string,
    model: BizyAirModel,
    target: RenderTarget,
    options?: Record<string, any>
  ): Promise<ImageLabelGenResult> {
    // 1. 调 BizyAir 生成图
    const bizyairResult = await bizyairClient.generate({ prompt, model, options });

    // 2. 下载原图（OSS）
    const imgRes = await fetch(bizyairResult.imageUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!imgRes.ok) {
      throw new Error(`下载 OSS 原图失败 HTTP ${imgRes.status} @ ${bizyairResult.imageUrl}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());

    // 3. sharp 缩放 + 灰度 + threshold + PNG（这一步产出"dither 后 PNG"，存 MinIO）
    const pngBuffer = await sharp(originalBuffer)
      .resize(target.widthPx, target.heightPx, {
        fit: 'contain',
        background: '#ffffff',
      })
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();

    // 4. 1-bit pack（MSB-first，与 Phase B 字节序契约一致）
    const bitmapBuffer = await packFromPng(pngBuffer, target);

    return {
      pngBuffer,
      bitmapBuffer,
      sourceImageUrl: bizyairResult.imageUrl,
      bizyairLatencyMs: bizyairResult.elapsedMs,
    };
  }

  /** redither 用：从已存 MinIO 的 source_image_url 重新下载 + 重做 dither，不再调 BizyAir */
  async redither(
    sourceImageUrl: string,
    target: RenderTarget
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    const imgRes = await fetch(sourceImageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!imgRes.ok) {
      throw new Error(`下载 OSS 原图失败 HTTP ${imgRes.status} @ ${sourceImageUrl}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());
    const pngBuffer = await sharp(originalBuffer)
      .resize(target.widthPx, target.heightPx, { fit: 'contain', background: '#ffffff' })
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();
    const bitmapBuffer = await packFromPng(pngBuffer, target);
    return { pngBuffer, bitmapBuffer };
  }
}

export const imageLabelGenerator = new ImageLabelGenerator();
