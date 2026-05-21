import sharp from 'sharp';
import type { RenderTarget } from '../core/render-targets.js';
import { packFromPng, packMonoBuffer } from '../core/bitmap-packer.js';
import { ditherGrayscaleToMono, type DitherAlgorithm } from '../core/dither-algorithms.js';
import { bizyairClient, type BizyAirModel } from './bizyair-client.js';

export interface ImageLabelGenResult {
  pngBuffer: Buffer;              // dither 后 1-bit PNG（存 MinIO 的）
  bitmapBuffer: Buffer;           // 直接给 niimbot 用的 1-bit pack
  sourceImageUrl: string;         // BizyAir 返回的原图 OSS 永久链接
  bizyairLatencyMs: number;
}

export class ImageLabelGenerator {
  /** 把原图 buffer 缩放→灰度→raw，按 algo dither，产出同源的 png + bitmap */
  private async ditherToOutputs(
    sourceBuffer: Buffer,
    target: RenderTarget,
    algo: DitherAlgorithm
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    const { data: raw } = await sharp(sourceBuffer)
      .resize(target.widthPx, target.heightPx, { fit: 'contain', background: '#ffffff' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mono = ditherGrayscaleToMono(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.length),
      target.widthPx,
      target.heightPx,
      algo
    );
    const pngBuffer = await sharp(Buffer.from(mono), {
      raw: { width: target.widthPx, height: target.heightPx, channels: 1 },
    })
      .png()
      .toBuffer();
    const bitmapBuffer = packMonoBuffer(mono, target);
    return { pngBuffer, bitmapBuffer };
  }

  async generate(
    prompt: string,
    model: BizyAirModel,
    target: RenderTarget,
    options?: Record<string, any>,
    algo: DitherAlgorithm = 'threshold'
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

    const { pngBuffer, bitmapBuffer } = await this.ditherToOutputs(originalBuffer, target, algo);

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
    target: RenderTarget,
    algo: DitherAlgorithm = 'threshold'
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    const imgRes = await fetch(sourceImageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!imgRes.ok) {
      throw new Error(`下载 OSS 原图失败 HTTP ${imgRes.status} @ ${sourceImageUrl}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());
    return this.ditherToOutputs(originalBuffer, target, algo);
  }

}

export const imageLabelGenerator = new ImageLabelGenerator();
