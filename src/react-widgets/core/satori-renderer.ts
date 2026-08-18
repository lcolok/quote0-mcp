/**
 * Satori 轻量级渲染器
 * 使用 Satori + resvg-js 替代 Puppeteer
 * 
 * 优势：
 * - 无需 Chromium，内存占用 ~20MB vs ~200MB
 * - 渲染速度 ~20-50ms vs ~200-800ms
 * - 适合水墨屏等低分辨率设备
 * 
 * 像素字体处理策略：
 * - 8px/10px/12px: 使用原生字体文件，1:1 渲染
 * - 16px/20px/24px: 使用 8px/10px/12px 字体，2x 缩放
 * - 其他尺寸: 使用最接近的字体文件
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ReactElement } from 'react';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { RenderOptions } from '../types.js';
import { EINK_TARGET } from './render-targets.js';

export type SatoriBaseFontSize = 8 | 10 | 12;

export interface SatoriRenderOptions extends RenderOptions {
  width?: number;
  height?: number;
  /** 仅传本次布局实际使用的像素字体，避免把全部字体重复交给 Satori。 */
  fontBaseSizes?: SatoriBaseFontSize[];
}

export interface SatoriPipelineMetrics {
  initializedWarm: boolean;
  initMs: number;
  satoriMs: number;
  resvgInitMs: number;
  resvgRenderMs: number;
  resvgMs: number;
  totalMs: number;
  fontCount: number;
  fontBytes: number;
  svgChars: number;
}

export interface SatoriRenderResult {
  pngBuffer: Buffer;
  metrics: SatoriPipelineMetrics;
}

/**
 * 像素字体尺寸映射
 * 将目标尺寸映射到实际字体文件和缩放因子
 */
interface FontMapping {
  fontBuffer: ArrayBuffer;
  baseSize: number;
  scaleFactor: number;
}

export class SatoriRenderer {
  private fontBuffers: Map<number, ArrayBuffer> = new Map();
  private fonts: Array<{ name: string; data: ArrayBuffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' | 'italic' }> = [];
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  /**
   * 获取像素字体映射
   * 对于像素字体，必须使用整数倍缩放以保持清晰度
   */
  private getFontMapping(targetSize: number): FontMapping {
    const defaultBuffer = this.fontBuffers.get(12)!;
    
    // 完美匹配的尺寸（原生支持）
    if (this.fontBuffers.has(targetSize)) {
      return {
        fontBuffer: this.fontBuffers.get(targetSize)!,
        baseSize: targetSize,
        scaleFactor: 1
      };
    }
    
    // 2x 缩放尺寸
    const halfSize = targetSize / 2;
    if (this.fontBuffers.has(halfSize) && Number.isInteger(halfSize)) {
      return {
        fontBuffer: this.fontBuffers.get(halfSize)!,
        baseSize: halfSize,
        scaleFactor: 2
      };
    }
    
    // 3x 缩放尺寸
    const thirdSize = targetSize / 3;
    if (this.fontBuffers.has(thirdSize) && Number.isInteger(thirdSize)) {
      return {
        fontBuffer: this.fontBuffers.get(thirdSize)!,
        baseSize: thirdSize,
        scaleFactor: 3
      };
    }
    
    // 默认使用 12px 字体
    return {
      fontBuffer: defaultBuffer,
      baseSize: 12,
      scaleFactor: targetSize / 12
    };
  }

  /**
   * 初始化渲染器，加载字体文件
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      console.log('🎨 初始化 Satori 渲染器...');
      // 防御：避免任何重复 initialize 导致字体数组/缓存累积
      this.fonts = [];
      this.fontBuffers.clear();

      const fontsPath = join(process.cwd(), 'assets/fonts');
      const fontFiles = {
        8: 'fusion-pixel-8px-monospaced-zh_hans.otf.ttf',
        10: 'fusion-pixel-10px-monospaced-zh_hans.otf.ttf',
        12: 'fusion-pixel-12px-monospaced-zh_hans.otf.ttf'
      };

      for (const [size, fileName] of Object.entries(fontFiles)) {
        try {
          const fontPath = join(fontsPath, fileName);
          const buffer = await readFile(fontPath);
          this.fontBuffers.set(parseInt(size), buffer.buffer as ArrayBuffer);
          console.log(`✅ 加载字体: ${fileName} (${size}px)`);
        } catch (error) {
          console.warn(`⚠️ 加载字体失败 ${fileName}:`, error);
        }
      }

      const defaultFontBuffer = this.fontBuffers.get(12);
      if (!defaultFontBuffer) throw new Error('无法加载默认字体文件');

      for (const size of [8, 10, 12]) {
        const fontBuffer = this.fontBuffers.get(size);
        if (fontBuffer) {
          this.fonts.push({
            name: `FusionPixelFont-${size}px`,
            data: fontBuffer,
            weight: 400,
            style: 'normal'
          });
        }
      }

      this.fonts.push({
        name: 'FusionPixelFont',
        data: defaultFontBuffer,
        weight: 400,
        style: 'normal'
      });

      this.initialized = true;
      console.log('✅ Satori 渲染器初始化完成');
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  /**
   * 渲染 React 组件为图片 Buffer
   */
  async renderToImage(
    component: ReactElement,
    options: SatoriRenderOptions = {}
  ): Promise<Buffer> {
    return (await this.renderToImageWithMetrics(component, options)).pngBuffer;
  }

  async renderToImageWithMetrics(
    component: ReactElement,
    options: SatoriRenderOptions = {},
  ): Promise<SatoriRenderResult> {
    const totalStartedAt = performance.now();
    const initializedWarm = this.initialized;
    const initStartedAt = performance.now();
    await this.initialize();
    const initMs = performance.now() - initStartedAt;

    const {
      width = EINK_TARGET.widthPx,
      height = EINK_TARGET.heightPx,
      backgroundColor = '#FFFFFF',
      fontBaseSizes,
    } = options;

    const requestedSizes = fontBaseSizes?.length ? new Set(fontBaseSizes) : undefined;
    const fonts = requestedSizes
      ? this.fonts.filter((font) => {
          const match = font.name.match(/^FusionPixelFont-(8|10|12)px$/);
          return match ? requestedSizes.has(Number(match[1]) as SatoriBaseFontSize) : false;
        })
      : this.fonts;
    if (fonts.length === 0) throw new Error('Satori font subset resolved to zero fonts');

    try {
      const satoriStartedAt = performance.now();
      const svg = await satori(component, {
        width,
        height,
        fonts,
        embedFont: true,
      });
      const satoriMs = performance.now() - satoriStartedAt;

      const resvgStartedAt = performance.now();
      const resvg = new Resvg(svg, {
        background: backgroundColor,
        // Satori 已 embedFont=true；默认扫描宿主系统字体会让每张图额外耗时秒级。
        font: { loadSystemFonts: false },
        fitTo: {
          mode: 'width',
          value: width,
        },
      });
      const resvgInitMs = performance.now() - resvgStartedAt;
      const resvgRenderStartedAt = performance.now();
      const pngData = resvg.render();
      const pngBuffer = Buffer.from(pngData.asPng());
      const resvgRenderMs = performance.now() - resvgRenderStartedAt;
      const resvgMs = performance.now() - resvgStartedAt;

      const round2 = (value: number) => Math.round(value * 100) / 100;
      return {
        pngBuffer,
        metrics: {
          initializedWarm,
          initMs: round2(initMs),
          satoriMs: round2(satoriMs),
          resvgInitMs: round2(resvgInitMs),
          resvgRenderMs: round2(resvgRenderMs),
          resvgMs: round2(resvgMs),
          totalMs: round2(performance.now() - totalStartedAt),
          fontCount: fonts.length,
          fontBytes: fonts.reduce((sum, font) => sum + font.data.byteLength, 0),
          svgChars: svg.length,
        },
      };
    } catch (error) {
      console.error('Satori 渲染失败:', error);
      throw error;
    }
  }

  /**
   * 渲染到文件
   */
  async renderToFile(
    component: ReactElement,
    outputPath: string,
    options: SatoriRenderOptions = {}
  ): Promise<void> {
    const buffer = await this.renderToImage(component, options);
    
    const fs = await import('fs');
    await fs.promises.writeFile(outputPath, buffer);
    
    console.log(`✅ 组件已渲染到: ${outputPath}`);
  }

  /**
   * 关闭渲染器（清理资源）
   */
  async close(): Promise<void> {
    this.fontBuffers.clear();
    this.fonts = []; // 修复 OOM：this.fonts 只增不减，close 时必须清空
    this.initialized = false;
  }
}

// 单例实例
export const satoriRenderer = new SatoriRenderer();
