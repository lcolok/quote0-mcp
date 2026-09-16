/**
 * VisionHub 客户端 —— 出图返回资产的内化存储（懒猫共享图片 CDN）。
 *
 * 背景：上游出图后端（BizyAir / TuZi）的 OSS 链接都不是我们的资产 ——
 * BizyAir OSS 已整体 404，TuZi 的 CDN URL 实测创建约 40 分钟后即 301 重定向。
 * 因此拿到返回图后**立即转存 VisionHub**，DB 里存我们自己的公网 URL。
 *
 * 契约（真机实证）：
 *   - 上传：POST {INTERNAL_BASE}/api/images/upload，multipart 字段名 file，无需鉴权
 *     响应 200: {"imageId":"<ts>_<hash>.png","status":"uploaded","urls":{"original":"/api/images/<imageId>",...}}
 *   - 取图：GET {PUBLIC_BASE}/api/images/{imageId}
 *     裸 URL 按协商转 webp（浏览器展示用）；?f=png 强制 PNG（redither 保真下载用它）
 */

/** 懒猫容器内网上传入口（news-api 容器内实测可达） */
const DEFAULT_INTERNAL_BASE = 'http://web.me.friday.vision-hub.lzcapp:3000';

/** 公网取图入口（浏览器 / 前端展示用） */
const DEFAULT_PUBLIC_BASE = 'https://vision-hub.logic.heiyu.space';

/** 出图资产体积小（<1MB），60s 上限足够；超时归类为可重试错误 */
const UPLOAD_TIMEOUT_MS = 60_000;

/** 扩展名 → MIME（上传文件名带扩展名，VisionHub 据此存 imageId） */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export interface VisionHubUploadResult {
  /** VisionHub 图片 ID（含上传文件名的扩展名），亦是上传响应的 objectKey */
  imageId: string;
  /** 公网可取回的 URL：{PUBLIC_BASE}/api/images/{imageId} */
  publicUrl: string;
}

export interface VisionHubClientOptions {
  /** 覆盖内网上传入口（缺省读 env VISION_HUB_INTERNAL_BASE） */
  internalBase?: string;
  /** 覆盖公网取图入口（缺省读 env VISION_HUB_PUBLIC_BASE） */
  publicBase?: string;
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

export function resolveInternalBase(): string {
  return stripTrailingSlash(process.env.VISION_HUB_INTERNAL_BASE ?? DEFAULT_INTERNAL_BASE);
}

export function resolvePublicBase(): string {
  return stripTrailingSlash(process.env.VISION_HUB_PUBLIC_BASE ?? DEFAULT_PUBLIC_BASE);
}

/** 上传文件名 → multipart 的 Content-Type；未知扩展名退回 png（出图默认输出格式） */
function mimeFromFilename(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'image/png';
}

/** 响应里取 imageId：顶层 imageId 优先，缺失时从 urls.original 兜底解析 */
function resolveImageId(data: any): string | null {
  const direct = data?.imageId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const original = data?.urls?.original;
  if (typeof original === 'string') {
    const m = original.match(/\/api\/images\/(.+)$/);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * redither 保真下载：VisionHub 的裸 URL 会被按协商转成有损 webp，
 * 重抖动需要确定性像素，故对体系内 URL 追加 ?f=png 强制无损 PNG。
 * 外部 URL（历史死链）原样返回；已显式带 f 参数的 URL 不重复追加。
 */
export function fidelityFetchUrl(url: string): string {
  const base = resolvePublicBase();
  if (!url.startsWith(`${base}/`)) return url;
  if (/[?&]f=/.test(url)) return url;
  return url.includes('?') ? `${url}&f=png` : `${url}?f=png`;
}

export class VisionHubClient {
  readonly internalBase: string;
  readonly publicBase: string;

  constructor(options: VisionHubClientOptions = {}) {
    this.internalBase = stripTrailingSlash(options.internalBase ?? resolveInternalBase());
    this.publicBase = stripTrailingSlash(options.publicBase ?? resolvePublicBase());
  }

  /**
   * 把出图原图转存 VisionHub，返回体系内公网 URL。
   * 失败一律抛 `[VISION_HUB]` 前缀错误 —— 调用方**不得吞掉**（不存即废，
   * 上游 URL 随时可能失效），让 job 走标准 attempts 重试。
   */
  async uploadSourceImage(buffer: Buffer, filename: string): Promise<VisionHubUploadResult> {
    const endpoint = `${this.internalBase}/api/images/upload`;
    const form = new FormData();
    // Uint8Array.from 产出 ArrayBuffer 背书的视图：Buffer<ArrayBufferLike> 不满足 DOM 的 BlobPart
    form.append('file', new File([Uint8Array.from(buffer)], filename, { type: mimeFromFilename(filename) }));

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`[VISION_HUB] 上传超时（${UPLOAD_TIMEOUT_MS / 1000}s 上限）`);
      }
      throw new Error(`[VISION_HUB] 上传网络错误: ${e?.message ?? String(e)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[VISION_HUB] 上传失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error('[VISION_HUB] 上传响应非 JSON');
    }

    const imageId = resolveImageId(data);
    if (!imageId) {
      throw new Error(`[VISION_HUB] 上传响应缺 imageId/urls.original: ${JSON.stringify(data).slice(0, 200)}`);
    }

    return { imageId, publicUrl: `${this.publicBase}/api/images/${imageId}` };
  }
}

export const visionHubClient = new VisionHubClient();
