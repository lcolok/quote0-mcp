import { describe, expect, it } from 'bun:test';
import { buildEpd1Body, crc32Hex, crc32Ieee, normalizeEpdTraceId, type EinkDevice } from './eink-converter.js';

const s3Device: EinkDevice = {
  id: 'eink-2',
  name: 'S3自制板墨水屏',
  baseUrl: 'http://192.168.31.130:80',
  token: 'test-token',
  width: 296,
  height: 128,
  wireProtocol: 'epd1-v1',
  colorMode: 'mono-1bit',
  planeCount: 1,
};

describe('EPD1 wire protocol', () => {
  it('CRC32 使用标准 IEEE 向量，便于服务端与固件跨语言对账', () => {
    const vector = Buffer.from('123456789', 'ascii');
    expect(crc32Ieee(vector)).toBe(0xcbf43926);
    expect(crc32Hex(vector)).toBe('cbf43926');
  });

  it('trace id 清洗成 header-safe 且限制 32 字符', () => {
    expect(normalizeEpdTraceId('delivery 123 / attempt#2')).toBe('delivery123attempt2');
    expect(normalizeEpdTraceId('x'.repeat(80))).toBe('x'.repeat(32));
    expect(normalizeEpdTraceId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('builds the 16-byte header and 296x128 plane', () => {
    const bitmap = Buffer.alloc(296 / 8 * 128, 0xa5);
    const body = buildEpd1Body(bitmap, s3Device);

    expect(body.length).toBe(4752);
    expect(body.subarray(0, 4).toString('ascii')).toBe('EPD1');
    expect(body[4]).toBe(1);
    expect(body[5]).toBe(0);
    expect(body[6]).toBe(1);
    expect(body[7]).toBe(0);
    expect(body.readUInt16LE(8)).toBe(296);
    expect(body.readUInt16LE(10)).toBe(128);
    expect(body.readUInt32LE(12)).toBe(4736);
    expect(body.subarray(16).equals(bitmap)).toBe(true);
  });

  it('rejects a bitmap whose plane size does not match the device', () => {
    expect(() => buildEpd1Body(Buffer.alloc(5624), s3Device)).toThrow('位图大小不匹配');
  });
});
