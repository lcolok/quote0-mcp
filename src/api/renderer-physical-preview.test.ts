import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import type { RenderTarget } from '../react-widgets/core/render-targets.js';
import {
  bitplaneToPng,
  buildPhysicalBitplaneArtifact,
  buildPhysicalBitplanePreview,
  comparePhysicalBitplanes,
  unpackMsbFirstBitplaneToMono,
} from './renderer-physical-preview.js';

// bun mock.module() is process-global across test files. Several device tests mock
// ./eink-converter.js, so use a cache-busting import of the real TS module here.
const realEinkConverter: any = await import('./eink-converter.ts?physical-preview=' + Date.now());
const realPngTo1BitBitmap = realEinkConverter.pngTo1BitBitmap as typeof import('./eink-converter.js').pngTo1BitBitmap;

const TARGET_8X2: RenderTarget = {
  id: 'test-8x2',
  kind: 'thermal-label',
  widthPx: 8,
  heightPx: 2,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 1, heightMm: 1 },
  defaultFontStack: ['fusion-pixel-8'],
};

describe('physical bitplane preview', () => {
  test('unpacks MSB-first bits into the exact pixel lattice', () => {
    const mono = unpackMsbFirstBitplaneToMono(Uint8Array.from([0b10101010, 0b01010101]), 8, 2);
    expect([...mono]).toEqual([
      0, 255, 0, 255, 0, 255, 0, 255,
      255, 0, 255, 0, 255, 0, 255, 0,
    ]);
  });

  test('round-trips an exact point-to-point plane through PNG without changing a bit', async () => {
    const plane = Buffer.from([0b10101010, 0b01010101]);
    const png = await bitplaneToPng(plane, 8, 2);
    const roundTrip = await realPngTo1BitBitmap(png, 8, 2);
    expect(roundTrip).toEqual(plane);
  });

  test('reports exact pixel XOR, bounds, regions and a lossless diff preview', async () => {
    const left = Buffer.from([0b10000000, 0b00000000]);
    const right = Buffer.from([0b01000000, 0b00000001]);
    const diff = await comparePhysicalBitplanes(left, right, 8, 2, [
      { name: 'title', x: 0, y: 0, width: 8, height: 1 },
      { name: 'body', x: 0, y: 1, width: 8, height: 1 },
    ]);

    expect(diff.exact).toBe(false);
    expect(diff.changedPixels).toBe(3);
    expect(diff.changedRatio).toBe(0.1875);
    expect(diff.bounds).toEqual({ minX: 0, minY: 0, maxX: 7, maxY: 1, width: 8, height: 2 });
    expect(diff.regions).toEqual({
      title: { changedPixels: 2, changedRatio: 0.25 },
      body: { changedPixels: 1, changedRatio: 0.125 },
    });
    expect(await realPngTo1BitBitmap(Buffer.from(diff.image.base64, 'base64'), 8, 2)).toEqual(
      Buffer.from([0b11000000, 0b00000001]),
    );

    const exact = await comparePhysicalBitplanes(left, left, 8, 2);
    expect(exact.exact).toBe(true);
    expect(exact.changedPixels).toBe(0);
    expect(exact.bounds).toBeNull();
  });

  test('uses the production converter and reports whether a resize was required', async () => {
    const exactMono = Buffer.from([
      0, 255, 0, 255, 0, 255, 0, 255,
      255, 0, 255, 0, 255, 0, 255, 0,
    ]);
    const exactPng = await sharp(exactMono, { raw: { width: 8, height: 2, channels: 1 } }).png().toBuffer();
    const artifact = await buildPhysicalBitplaneArtifact(exactPng, TARGET_8X2, realPngTo1BitBitmap);
    const exact = artifact.preview;
    expect(artifact.plane).toEqual(Buffer.from([0b10101010, 0b01010101]));
    expect(exact.pointToPoint).toBe(true);
    expect(exact.resizeApplied).toBe(false);
    expect(exact.planeBytes).toBe(2);
    expect(exact.sourceSize).toEqual({ width: 8, height: 2 });
    expect(exact.targetSize).toEqual({ width: 8, height: 2 });
    expect(await realPngTo1BitBitmap(Buffer.from(exact.image.base64, 'base64'), 8, 2)).toEqual(
      await realPngTo1BitBitmap(exactPng, 8, 2),
    );

    const wrongSizePng = await sharp(Buffer.alloc(4, 255), { raw: { width: 4, height: 1, channels: 1 } }).png().toBuffer();
    const resized = await buildPhysicalBitplanePreview(wrongSizePng, TARGET_8X2, realPngTo1BitBitmap);
    expect(resized.pointToPoint).toBe(false);
    expect(resized.resizeApplied).toBe(true);
    expect(resized.sourceSize).toEqual({ width: 4, height: 1 });
  });
});
