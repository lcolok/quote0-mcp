import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import {
  assertDeliveryPayloadRef,
  deliveryPayloadObjectKey,
  sha256Hex,
  verifyDeliveryPayloadBytes,
  persistDeliveryPngPayloadWithStorage,
  readDeliveryPngPayloadWithStorage,
  type DeliveryPayloadStorage,
} from './delivery-payload-store.js';

describe('delivery payload content-addressed snapshot', () => {
  it('SHA-256 使用标准向量，object key 由 hash 唯一决定', () => {
    const hash = sha256Hex(Buffer.from('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(deliveryPayloadObjectKey(hash)).toBe(
      `delivery-payloads/sha256/${hash}.png`,
    );
  });

  it('payload_ref 只接受内部 content-addressed PNG，不接受 URL / traversal / 任意路径', () => {
    const hash = 'a'.repeat(64);
    const ref = `delivery-payloads/sha256/${hash}.png`;
    expect(assertDeliveryPayloadRef(ref)).toBe(ref);
    expect(assertDeliveryPayloadRef(`/${ref}`)).toBe(ref);

    for (const invalid of [
      'http://minio/quote0-images/foo.png',
      'delivery-payloads/sha256/../foo.png',
      'memos/foo.png',
      `delivery-payloads/sha256/${'a'.repeat(63)}.png`,
      `delivery-payloads/sha256/${'g'.repeat(64)}.png`,
    ]) {
      expect(() => assertDeliveryPayloadRef(invalid)).toThrow();
    }
  });

  it('非法 hash 不会生成内部对象键', () => {
    expect(() => deliveryPayloadObjectKey('abc')).toThrow();
    expect(() => deliveryPayloadObjectKey('g'.repeat(64))).toThrow();
  });

  it('读取后的字节必须与入队 SHA 一致，篡改 fail closed', () => {
    const expected = sha256Hex(Buffer.from('original-png'));
    expect(verifyDeliveryPayloadBytes(Buffer.from('original-png'), expected).toString()).toBe('original-png');
    expect(() => verifyDeliveryPayloadBytes(Buffer.from('tampered-png'), expected))
      .toThrow('code=payload_error');
    expect(() => verifyDeliveryPayloadBytes(Buffer.from('original-png'), 'bad'))
      .toThrow('code=payload_error');
  });

  it('存储适配层真实走 put/read/dedupe，同内容不会重复写对象', async () => {
    const objects = new Map<string, Buffer>();
    let puts = 0;
    const storage: DeliveryPayloadStorage = {
      getClient() {
        return {
          async putObject(_bucket: string, key: string, body: Buffer) {
            puts += 1;
            objects.set(key, Buffer.from(body));
          },
          async getObject(_bucket: string, key: string) {
            const body = objects.get(key);
            if (!body) throw new Error('not found');
            return Readable.from([body.subarray(0, 3), body.subarray(3)]);
          },
        };
      },
    };

    const png = Buffer.from('png-bytes-for-delivery');
    const first = await persistDeliveryPngPayloadWithStorage(png, storage);
    const second = await persistDeliveryPngPayloadWithStorage(png, storage);
    expect(first).toEqual(second);
    expect(puts).toBe(2); // 同 key 覆盖刷新 LastModified，MinIO 里仍只有一个对象
    expect(objects.size).toBe(1);
    const restored = await readDeliveryPngPayloadWithStorage(first.objectKey, first.sha256, storage);
    expect(restored).toEqual(png);

    objects.set(first.objectKey, Buffer.from('tampered'));
    await expect(readDeliveryPngPayloadWithStorage(first.objectKey, first.sha256, storage))
      .rejects.toThrow('code=payload_error');
  });
});
