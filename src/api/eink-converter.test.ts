import { describe, expect, it } from 'bun:test';
import { buildEpd1Body, type EinkDevice } from './eink-converter.js';

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
