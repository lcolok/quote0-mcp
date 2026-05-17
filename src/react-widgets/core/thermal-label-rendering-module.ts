import satori from 'satori';
import sharp from 'sharp';
import { fontRegistry } from './font-registry.js';
import { LabelWidget, LabelData } from '../components/LabelWidget.js';
import { RenderTarget } from './render-targets.js';

export interface ThermalLabelRenderResult {
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  printId: string;
  meta: {
    widthPx: number;
    heightPx: number;
    bytesPerRow: number;
  };
}

class ThermalLabelRenderingModule {
  async render(
    data: LabelData,
    target: RenderTarget
  ): Promise<ThermalLabelRenderResult> {
    if (target.kind !== 'thermal-label') {
      throw new Error(
        `ThermalLabelRenderingModule: target kind must be 'thermal-label', got '${target.kind}'`
      );
    }

    const fonts = await fontRegistry.getSatoriFonts(target.defaultFontStack);
    if (fonts.length === 0) {
      throw new Error(
        `ThermalLabelRenderingModule: no fonts loaded for stack [${target.defaultFontStack.join(', ')}]`
      );
    }

    // 1. Satori → SVG
    const svg = await satori(
      LabelWidget({ data, target }),
      {
        width: target.widthPx,
        height: target.heightPx,
        fonts,
        embedFont: true,
      }
    );

    // 2. SVG → PNG
    const pngBuffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();

    // 3. PNG → 1-bit raw (grayscale + threshold)
    const { data: rawPixels, info } = await sharp(pngBuffer)
      .grayscale()
      .threshold(128)
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.width !== target.widthPx || info.height !== target.heightPx) {
      throw new Error(
        `Unexpected image size: expected ${target.widthPx}x${target.heightPx}, got ${info.width}x${info.height}`
      );
    }

    // 4. Inline 1-bit pack: MSB-first, black (px === 0) → bit = 1
    const bytesPerRow = target.widthPx / 8;
    const bitmapBuffer = Buffer.alloc(bytesPerRow * target.heightPx);

    for (let y = 0; y < target.heightPx; y++) {
      for (let x = 0; x < target.widthPx; x++) {
        const pixelIdx = y * target.widthPx + x;
        const isBlack = rawPixels[pixelIdx] === 0;
        if (isBlack) {
          const byteIdx = y * bytesPerRow + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          bitmapBuffer[byteIdx] |= 1 << bitIdx;
        }
      }
    }

    const printId = crypto.randomUUID();

    return {
      pngBuffer,
      bitmapBuffer,
      printId,
      meta: {
        widthPx: target.widthPx,
        heightPx: target.heightPx,
        bytesPerRow,
      },
    };
  }
}

export const thermalLabelRenderer = new ThermalLabelRenderingModule();
