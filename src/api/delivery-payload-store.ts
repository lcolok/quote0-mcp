import { createHash } from 'node:crypto';
import { getImageStorage } from '../react-widgets/core/image-storage.js';

const PAYLOAD_PREFIX = 'delivery-payloads/sha256';
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface StoredDeliveryPayload {
  objectKey: string;
  sha256: string;
  bytes: number;
}

export interface DeliveryPayloadStorage {
  getClient(): {
    putObject: (...args: any[]) => Promise<any>;
    getObject: (...args: any[]) => Promise<any>;
  };
}

/**
 * delivery payload 与业务源图片解耦：以内容 SHA-256 作为不可变对象键。
 * weather 每次会生成新 object key、Memo 的 memos/<id>.png 会被覆盖；如果 delivery
 * 直接保存那些可变引用，重试时可能拿到与入队时不同的图。content-addressed snapshot
 * 让一次 delivery 的字节事实在进程重启、源图片重渲染之后仍然稳定。
 */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function deliveryPayloadObjectKey(sha256: string): string {
  const normalized = sha256.trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw new Error('delivery payload sha256 非法');
  }
  return `${PAYLOAD_PREFIX}/${normalized}.png`;
}

export function assertDeliveryPayloadRef(objectKey: string): string {
  const normalized = objectKey.trim().replace(/^\/+/, '');
  if (!normalized.startsWith(`${PAYLOAD_PREFIX}/`) ||
      normalized.includes('://') ||
      normalized.includes('..') ||
      normalized.includes('\\') ||
      normalized.includes('\0')) {
    throw new Error(`delivery payload_ref 非法: ${objectKey}`);
  }
  const filename = normalized.slice(`${PAYLOAD_PREFIX}/`.length);
  if (!/^[0-9a-f]{64}\.png$/.test(filename)) {
    throw new Error(`delivery payload_ref 非法: ${objectKey}`);
  }
  return normalized;
}

/**
 * 将预渲染 PNG 保存成内容寻址快照。相同内容只占一个对象；并发重复 put 也是同字节覆盖，
 * 不影响引用稳定性。MinIO 写失败必须阻止 delivery 入队，否则会制造必死任务。
 */
export async function persistDeliveryPngPayloadWithStorage(
  pngBuffer: Buffer,
  imageStorage: DeliveryPayloadStorage,
  bucket = 'quote0-images',
): Promise<StoredDeliveryPayload> {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    throw new Error('delivery payload PNG 为空');
  }
  const sha256 = sha256Hex(pngBuffer);
  const objectKey = deliveryPayloadObjectKey(sha256);

  // 同内容始终覆盖同一个 content-addressed key，因此存储空间仍去重；
  // 每次 enqueue 都 PUT 一次是刻意的：刷新 LastModified，避免现有 7 天缓存清理器
  // 把“刚被新 delivery 复用”的老对象当成过期缓存删除。
  await imageStorage.getClient().putObject(
    bucket,
    objectKey,
    pngBuffer,
    pngBuffer.length,
    {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
      'X-Quote0-Payload-SHA256': sha256,
    },
  );

  return { objectKey, sha256, bytes: pngBuffer.length };
}

export async function persistDeliveryPngPayload(pngBuffer: Buffer): Promise<StoredDeliveryPayload> {
  return persistDeliveryPngPayloadWithStorage(
    pngBuffer,
    getImageStorage(),
    process.env.MINIO_BUCKET || 'quote0-images',
  );
}

/**
 * 读取 delivery 的不可变 PNG，并再次核对 SHA-256。
 * 这里校验的是 server-side payload store 完整性，不是 EPD wire CRC；后者仍由
 * pushToEinkDevice 的 X-EPD-CRC32 / ACK 对账负责。
 */
export function verifyDeliveryPayloadBytes(buffer: Buffer, expectedSha256: string): Buffer {
  const normalizedHash = expectedSha256.trim().toLowerCase();
  if (!SHA256_RE.test(normalizedHash)) {
    throw new Error('delivery payload_hash 非法 code=payload_error');
  }
  const actual = sha256Hex(buffer);
  if (actual !== normalizedHash) {
    throw new Error(
      `delivery payload SHA256 mismatch code=payload_error expect=${normalizedHash} got=${actual}`,
    );
  }
  return buffer;
}

export async function readDeliveryPngPayloadWithStorage(
  objectKey: string,
  expectedSha256: string,
  imageStorage: DeliveryPayloadStorage,
  bucket = 'quote0-images',
): Promise<Buffer> {
  const normalizedRef = assertDeliveryPayloadRef(objectKey);
  let stream: any;
  try {
    stream = await imageStorage.getClient().getObject(bucket, normalizedRef);
  } catch (error) {
    throw new Error(
      `delivery payload 读取失败 code=payload_error ref=${normalizedRef}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (error) {
    throw new Error(
      `delivery payload 流读取失败 code=payload_error ref=${normalizedRef}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const buffer = Buffer.concat(chunks);
  try {
    return verifyDeliveryPayloadBytes(buffer, expectedSha256);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ref=${normalizedRef}`,
    );
  }
}

export async function readDeliveryPngPayload(objectKey: string, expectedSha256: string): Promise<Buffer> {
  return readDeliveryPngPayloadWithStorage(
    objectKey,
    expectedSha256,
    getImageStorage(),
    process.env.MINIO_BUCKET || 'quote0-images',
  );
}
