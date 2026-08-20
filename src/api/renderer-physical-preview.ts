import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { RenderTarget } from '../react-widgets/core/render-targets.js';
import { pngTo1BitBitmap } from './eink-converter.js';

export const PHYSICAL_BITPLANE_PREVIEW_VERSION = 'physical-bitplane-preview/v1';
export const PHYSICAL_BITPLANE_DIFF_VERSION = 'physical-bitplane-diff/v1';

export interface PhysicalBitplanePreview {
  version: typeof PHYSICAL_BITPLANE_PREVIEW_VERSION;
  encoding: '1-bit-msb-first';
  pointToPoint: boolean;
  resizeApplied: boolean;
  sourceSize: { width: number; height: number };
  targetSize: { width: number; height: number };
  planeBytes: number;
  planeSha256: string;
  image: {
    mimeType: 'image/png';
    bytes: number;
    base64: string;
  };
}

export interface PhysicalBitplaneArtifact {
  preview: PhysicalBitplanePreview;
  plane: Buffer;
}

export interface BitplaneDiffRegionSpec {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalBitplaneDiff {
  version: typeof PHYSICAL_BITPLANE_DIFF_VERSION;
  exact: boolean;
  changedPixels: number;
  changedRatio: number;
  bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  regions: Record<string, {
    changedPixels: number;
    changedRatio: number;
  }>;
  leftPlaneSha256: string;
  rightPlaneSha256: string;
  image: {
    mimeType: 'image/png';
    bytes: number;
    base64: string;
  };
}

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function expectedPlaneBytes(width: number, height: number): number {
  return Math.ceil(width / 8) * height;
}

function assertGeometry(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid bitplane geometry: ${width}x${height}`);
  }
}

function bitIsSet(bitmap: Uint8Array, width: number, x: number, y: number): boolean {
  const bytesPerRow = Math.ceil(width / 8);
  const byte = bitmap[y * bytesPerRow + (x >> 3)] ?? 0;
  return (byte & (1 << (7 - (x & 7)))) !== 0;
}

function setBit(bitmap: Uint8Array, width: number, x: number, y: number): void {
  const bytesPerRow = Math.ceil(width / 8);
  const offset = y * bytesPerRow + (x >> 3);
  bitmap[offset] = (bitmap[offset] ?? 0) | (1 << (7 - (x & 7)));
}

export function unpackMsbFirstBitplaneToMono(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  assertGeometry(width, height);
  const expectedBytes = expectedPlaneBytes(width, height);
  if (bitmap.byteLength !== expectedBytes) {
    throw new Error(`Bitplane size mismatch: expected=${expectedBytes} actual=${bitmap.byteLength}`);
  }

  const mono = new Uint8Array(width * height);
  mono.fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bitIsSet(bitmap, width, x, y)) mono[y * width + x] = 0;
    }
  }
  return mono;
}

export async function bitplaneToPng(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  const mono = unpackMsbFirstBitplaneToMono(bitmap, width, height);
  return sharp(Buffer.from(mono), {
    raw: { width, height, channels: 1 },
  }).png().toBuffer();
}

export async function buildPhysicalBitplaneArtifact(
  pngBuffer: Buffer,
  target: RenderTarget,
  convertPngToBitmap: typeof pngTo1BitBitmap = pngTo1BitBitmap,
): Promise<PhysicalBitplaneArtifact> {
  const metadata = await sharp(pngBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Renderer PNG does not expose valid dimensions');
  }

  const pointToPoint = metadata.width === target.widthPx && metadata.height === target.heightPx;
  const plane = Buffer.from(await convertPngToBitmap(pngBuffer, target.widthPx, target.heightPx));
  const previewPng = await bitplaneToPng(plane, target.widthPx, target.heightPx);

  return {
    plane,
    preview: {
      version: PHYSICAL_BITPLANE_PREVIEW_VERSION,
      encoding: '1-bit-msb-first',
      pointToPoint,
      resizeApplied: !pointToPoint,
      sourceSize: { width: metadata.width, height: metadata.height },
      targetSize: { width: target.widthPx, height: target.heightPx },
      planeBytes: plane.length,
      planeSha256: sha256(plane),
      image: {
        mimeType: 'image/png',
        bytes: previewPng.length,
        base64: previewPng.toString('base64'),
      },
    },
  };
}

export async function buildPhysicalBitplanePreview(
  pngBuffer: Buffer,
  target: RenderTarget,
  convertPngToBitmap: typeof pngTo1BitBitmap = pngTo1BitBitmap,
): Promise<PhysicalBitplanePreview> {
  return (await buildPhysicalBitplaneArtifact(pngBuffer, target, convertPngToBitmap)).preview;
}

export async function comparePhysicalBitplanes(
  left: Uint8Array,
  right: Uint8Array,
  width: number,
  height: number,
  regionSpecs: BitplaneDiffRegionSpec[] = [],
): Promise<PhysicalBitplaneDiff> {
  assertGeometry(width, height);
  const expectedBytes = expectedPlaneBytes(width, height);
  if (left.byteLength !== expectedBytes || right.byteLength !== expectedBytes) {
    throw new Error(
      `Bitplane diff size mismatch: expected=${expectedBytes} left=${left.byteLength} right=${right.byteLength}`,
    );
  }

  const normalizedRegions = regionSpecs.map((region) => ({
    ...region,
    x: Math.max(0, Math.round(region.x)),
    y: Math.max(0, Math.round(region.y)),
    width: Math.max(0, Math.round(region.width)),
    height: Math.max(0, Math.round(region.height)),
  }));
  const regionCounts = new Map(normalizedRegions.map((region) => [region.name, 0]));
  const xorPlane = Buffer.alloc(expectedBytes);
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bitIsSet(left, width, x, y) === bitIsSet(right, width, x, y)) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      setBit(xorPlane, width, x, y);
      for (const region of normalizedRegions) {
        if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) {
          regionCounts.set(region.name, (regionCounts.get(region.name) ?? 0) + 1);
        }
      }
    }
  }

  const diffPng = await bitplaneToPng(xorPlane, width, height);
  const regions = Object.fromEntries(normalizedRegions.map((region) => {
    const count = regionCounts.get(region.name) ?? 0;
    const area = region.width * region.height;
    return [region.name, {
      changedPixels: count,
      changedRatio: area > 0 ? Math.round((count / area) * 10_000) / 10_000 : 0,
    }];
  }));

  return {
    version: PHYSICAL_BITPLANE_DIFF_VERSION,
    exact: changedPixels === 0,
    changedPixels,
    changedRatio: Math.round((changedPixels / (width * height)) * 10_000) / 10_000,
    bounds: changedPixels === 0 ? null : {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    regions,
    leftPlaneSha256: sha256(left),
    rightPlaneSha256: sha256(right),
    image: {
      mimeType: 'image/png',
      bytes: diffPng.length,
      base64: diffPng.toString('base64'),
    },
  };
}
