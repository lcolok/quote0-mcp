import sharp from 'sharp';
import type { RenderTarget } from '../core/render-targets.js';
import { packFromPng, packMonoBuffer } from '../core/bitmap-packer.js';
import { ditherGrayscaleToMono, type DitherAlgorithm } from '../core/dither-algorithms.js';
import { bizyairClient, type BizyAirModel } from './bizyair-client.js';
import { tuziClient, upstreamModelFromTuzi, type TuziEditImage } from './tuzi-client.js';
import { fidelityFetchUrl, visionHubClient } from './vision-hub-client.js';

export interface ImageLabelGenResult {
  pngBuffer: Buffer;              // dither 后 1-bit PNG（存 MinIO 的）
  bitmapBuffer: Buffer;           // 直接给 niimbot 用的 1-bit pack
  sourceImageUrl: string;         // 体系内 VisionHub 公网 URL（出图后立即转存，不再指向上游 OSS）
  bizyairLatencyMs: number;       // 上游出图耗时（字段名沿用，bizyair/tuzi 共用）
}

/** 下载响应 content-type → 文件扩展名（VisionHub 的 imageId 带扩展名；缺省 png） */
function extFromContentType(contentType: string | null): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('image/jpeg')) return 'jpg';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/gif')) return 'gif';
  return 'png';
}

/** options 里是否带了参考图（images[] 非空） */
export function hasRefImages(options?: Record<string, any>): boolean {
  const images = options?.images;
  return Array.isArray(images) && images.length > 0;
}

/** 参考图下载超时（体系内 VisionHub 出图 <1MB，15s 足够；超时/非图 → 抛错走 job 标准重试） */
const REF_IMAGE_TIMEOUT_MS = 15_000;

/**
 * 逐张下载参考图 → multipart 可用的字节载荷。
 * 体系内 VisionHub URL 走 `?f=png` 强制无损 PNG —— 上游 edits 只对 PNG 输入有实证，
 * webp 走 URL 协商会变成有损图，不赌。失败一律抛带 URL 的错，交给 job 重试语义。
 */
async function downloadRefImage(url: string, index: number): Promise<TuziEditImage> {
  const fetchUrl = fidelityFetchUrl(url);
  let res: Response;
  try {
    res = await fetch(fetchUrl, { signal: AbortSignal.timeout(REF_IMAGE_TIMEOUT_MS) });
  } catch (e: any) {
    throw new Error(`下载参考图失败（网络/超时）HTTP 无响应 @ ${fetchUrl}: ${e?.message ?? String(e)}`);
  }
  if (!res.ok) {
    throw new Error(`下载参考图失败 HTTP ${res.status} @ ${fetchUrl}`);
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error(`参考图 content-type 非图像（${contentType || '缺失'}）@ ${fetchUrl}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`参考图内容为空 @ ${fetchUrl}`);
  }
  return { bytes, contentType, filename: `ref-${index}.${extFromContentType(contentType)}` };
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
    model: string,
    target: RenderTarget,
    options?: Record<string, any>,
    algo: DitherAlgorithm = 'threshold'
  ): Promise<ImageLabelGenResult> {
    // 1. 出图 —— 'tuzi:<model>' 前缀分发到 TuZi，其余维持 BizyAir 原路径
    const generated = model.startsWith('tuzi:')
      ? await this.generateViaTuzi(prompt, model, target, options)
      : await bizyairClient.generate({ prompt, model: model as BizyAirModel, options });

    // 2. 下载原图
    const imgRes = await fetch(generated.imageUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!imgRes.ok) {
      throw new Error(`下载上游原图失败 HTTP ${imgRes.status} @ ${generated.imageUrl}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());

    // 3. 立即内化到 VisionHub —— 上游 OSS/CDN 都不是长期资产（bizyair 已整体 404，
    //    TuZi CDN 实测约 40 分钟后 301 重定向），只有体系内 URL 才留得住原图。
    //    上传失败直接抛错（不存即废，不留上游链接当兜底），让 job 走标准 attempts 重试。
    const { publicUrl } = await visionHubClient.uploadSourceImage(
      originalBuffer,
      `quote0-label-${Date.now()}.${extFromContentType(imgRes.headers.get('content-type'))}`
    );

    const { pngBuffer, bitmapBuffer } = await this.ditherToOutputs(originalBuffer, target, algo);

    return {
      pngBuffer,
      bitmapBuffer,
      sourceImageUrl: publicUrl,
      bizyairLatencyMs: generated.elapsedMs,
    };
  }

  /**
   * TuZi 路径：剥前缀透传上游模型，size 按 target 纵横推导。
   * 带参考图 → /images/edits（先逐张下载成 PNG 字节，再 multipart 上传）；无参考图 → 文生图。
   */
  private async generateViaTuzi(
    prompt: string,
    model: string,
    target: RenderTarget,
    options?: Record<string, any>
  ): Promise<{ imageUrl: string; elapsedMs: number }> {
    const upstreamModel = upstreamModelFromTuzi(model);
    if (!upstreamModel) {
      throw new Error(`非法 TuZi 模型名: ${model}`);
    }
    // images 只在这里用于取参考图 URL；透传给客户端前必须摘掉（multipart 不认 URL 数组）
    const sanitized = { ...(options ?? {}) };
    delete sanitized.images;
    const aspect = { widthPx: target.widthPx, heightPx: target.heightPx };

    if (!hasRefImages(options)) {
      return await tuziClient.generate({ prompt, model: upstreamModel, options: sanitized, aspect });
    }

    const refUrls: unknown[] = options!.images;
    const urls = refUrls.map((u) => (typeof u === 'string' ? u.trim() : ''));
    if (urls.some((u) => !u)) {
      throw new Error(`参考图 URL 非法（需为非空字符串）: ${JSON.stringify(refUrls).slice(0, 200)}`);
    }
    const images = await Promise.all(urls.map((u, i) => downloadRefImage(u, i)));
    return await tuziClient.edit({
      prompt,
      model: upstreamModel,
      images,
      options: sanitized,
      aspect,
    });
  }

  /** redither 用：从已存的 source_image_url 重新下载 + 重做 dither，不再调上游 */
  async redither(
    sourceImageUrl: string,
    target: RenderTarget,
    algo: DitherAlgorithm = 'threshold'
  ): Promise<{ pngBuffer: Buffer; bitmapBuffer: Buffer }> {
    // 体系内 VH URL 走 ?f=png 保真下载（裸 URL 会按协商转有损 webp）；历史死链原样请求
    const fetchUrl = fidelityFetchUrl(sourceImageUrl);
    const imgRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(60_000) });
    if (!imgRes.ok) {
      throw new Error(`下载原图失败 HTTP ${imgRes.status} @ ${fetchUrl}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());
    return this.ditherToOutputs(originalBuffer, target, algo);
  }

  /**
   * 轻量预览：直接对原图 buffer 做缩放→灰度→dither，仅返回 PNG buffer。
   * 不写 MinIO、不写 DB，供批量预览端点只读调用。
   */
  async ditherPreview(
    sourceBuffer: Buffer,
    target: RenderTarget,
    algo: DitherAlgorithm = 'threshold'
  ): Promise<Buffer> {
    const { pngBuffer } = await this.ditherToOutputs(sourceBuffer, target, algo);
    return pngBuffer;
  }

}

export const imageLabelGenerator = new ImageLabelGenerator();
