/**
 * MinIO增强渲染器
 * 使用MinIO存储的字体资源，无需本地字体服务器
 */

import puppeteer, { Browser, Page, ScreenshotOptions } from 'puppeteer';
import { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderOptions } from '../types.js';
import { FontLoader } from '../font-loader.js';
import { MinIOFontRenderer } from './minio-font-renderer.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from './device-constants.js';

export class MinIOWidgetRenderer {
  private browser: Browser | null = null;

  async initialize(): Promise<void> {
    if (!this.browser) {
      console.log('🚀 启动MinIO增强渲染器 (无本地字体服务器)...');
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
      
      console.log('✅ MinIO增强渲染器已启动');
    }
  }

  async renderToImage(
    component: ReactElement,
    options: RenderOptions = {}
  ): Promise<Buffer> {
    await this.initialize();

    const {
      format = 'png',
      quality = 100,
      backgroundColor = '#FFFFFF',
      dithering = false
    } = options;

    const page = await this.browser!.newPage();
    
    try {
      // 渲染 React 组件为 HTML
      const markup = renderToStaticMarkup(component);
      
      // 创建完整的 HTML 页面（使用MinIO字体）
      const htmlContent = await this.createHTMLPage(markup, backgroundColor);
      
      // 设置视口为水墨屏尺寸
      await page.setViewport({
        width: EINK_DEVICE_WIDTH,
        height: EINK_DEVICE_HEIGHT,
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false
      });

      // 加载 HTML 内容
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0'
      });

      // 等待字体加载
      await page.evaluate(() => {
        return document.fonts.ready;
      });
      
      // 额外等待确保字体完全加载
      await new Promise(resolve => setTimeout(resolve, 500)); // 减少等待时间，因为无需启动本地服务器

      // 截图
      const screenshotOptions: ScreenshotOptions = {
        type: format as 'png' | 'jpeg',
        fullPage: true,
        omitBackground: false
      };

      if (format === 'jpeg' && quality) {
        screenshotOptions.quality = quality;
      }

      const buffer = await page.screenshot(screenshotOptions);
      
      return buffer as Buffer;
    } finally {
      await page.close();
    }
  }

  private detectAllFontSizes(markup: string): number[] {
    const patterns = [
      /font-size:\s*(\d+)px/g,
      /font-size:(\d+)px/g,
      /fontSize:\s*['"](\d+)px['"]/g,
      /fontSize:\s*(\d+)px/g
    ];

    const allSizes = new Set<number>();

    for (const pattern of patterns) {
      const matches = markup.matchAll(pattern);
      for (const match of matches) {
        const size = parseInt(match[1]);
        allSizes.add(size);
      }
    }
    
    const sizeArray = Array.from(allSizes).sort((a, b) => a - b);
    
    if (sizeArray.length > 0) {
      console.log(`🔍 检测到 ${sizeArray.length} 种字体大小: ${sizeArray.join('px, ')}px`);
      return sizeArray;
    }
    
    console.log('⚠️ 未检测到字体大小，使用默认12px');
    return [12];
  }

  private async createHTMLPage(markup: string, backgroundColor: string): Promise<string> {
    // 检测所有字体大小
    const allFontSizes = this.detectAllFontSizes(markup);
    
    // 生成MinIO字体CSS
    const minioFontCSS = await MinIOFontRenderer.getMultiSizeFontCSS(allFontSizes);
    
    // 分析字体使用情况（用于日志输出）
    const analysis = await this.analyzeFontUsage(allFontSizes);
    console.log(`🔍 字体使用分析: ${analysis.recommendations.join(' | ')}`);
    
    if (analysis.optimizationSuggestions.length > 0) {
      console.log(`💡 优化建议:`);
      analysis.optimizationSuggestions.forEach(suggestion => console.log(`   ${suggestion}`));
    }
    
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content={"width=" + EINK_DEVICE_WIDTH + ", height=" + EINK_DEVICE_HEIGHT}>
    <title>Widget Render</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        ${minioFontCSS}
        
        body {
            width: ${EINK_DEVICE_WIDTH}px;
            height: ${EINK_DEVICE_HEIGHT}px;
            background-color: ${backgroundColor};
            font-family: ${FontLoader.getFusionPixelFontFamily()};
            overflow: hidden;
            /* 像素完美渲染设置 */
            -webkit-font-smoothing: none;
            -moz-osx-font-smoothing: unset;
            text-rendering: geometricPrecision;
            font-smooth: never;
            image-rendering: pixelated;
            image-rendering: -moz-crisp-edges;
            image-rendering: crisp-edges;
            /* 强制像素对齐 */
            transform: translateZ(0);
            backface-visibility: hidden;
            /* 防止子像素渲染 */
            position: relative;
        }
        
        /* 强制所有文本元素像素对齐 */
        * {
            -webkit-font-smoothing: none;
            -moz-osx-font-smoothing: unset;
            text-rendering: geometricPrecision;
            image-rendering: pixelated;
            /* 防止子像素定位 */
            transform: translateZ(0);
            /* 强制整数像素定位 */
            position: relative;
            box-sizing: border-box;
        }
        
        /* 确保所有尺寸都是整数像素 */
        div, span {
            /* 四舍五入到最近的像素 */
            width: auto;
            height: auto;
        }

        /* 水墨屏优化样式 */
        .aqi-excellent { 
            background-color: #000000; 
            color: #FFFFFF; 
            padding: 1px 3px; 
            font-size: 9px;
        }
        
        .aqi-good { 
            background-color: #333333; 
            color: #FFFFFF; 
            padding: 1px 3px; 
            font-size: 9px;
        }
        
        .aqi-moderate { 
            background-color: #666666; 
            color: #FFFFFF; 
            padding: 1px 3px; 
            font-size: 9px;
        }

        /* 确保文字清晰 */
        * {
            text-rendering: geometricPrecision;
        }
    </style>
</head>
<body>
    ${markup}
</body>
</html>`;
  }

  private async analyzeFontUsage(detectedSizes: number[]): Promise<{
    detectedSizes: number[];
    recommendations: string[];
    optimizationSuggestions: string[];
  }> {
    const recommendations: string[] = [];
    const optimizationSuggestions: string[] = [];
    
    const qualityStats = { A: 0, B: 0, C: 0 };
    
    for (const size of detectedSizes) {
      const result = await MinIOFontRenderer.getOptimalRenderSolution(size);
      qualityStats[result.quality]++;
      
      if (result.quality === 'C') {
        const perfectSizes = MinIOFontRenderer.getPerfectSizes();
        const nearest = perfectSizes.reduce((prev, curr) => 
          Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
        );
        optimizationSuggestions.push(`${size}px → 建议改为 ${nearest}px (提升至A级渲染)`);
      }
    }
    
    recommendations.push(`检测到 ${detectedSizes.length} 种字体大小: ${detectedSizes.join('px, ')}px`);
    recommendations.push(`渲染质量统计: A级${qualityStats.A}个, B级${qualityStats.B}个, C级${qualityStats.C}个`);
    
    if (qualityStats.C > 0) {
      recommendations.push(`⚠️ 发现 ${qualityStats.C} 个低质量字体大小，建议优化`);
    }
    
    return {
      detectedSizes,
      recommendations,
      optimizationSuggestions
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔻 MinIO增强渲染器已关闭');
    }
  }

  async renderToFile(
    component: ReactElement,
    outputPath: string,
    options: RenderOptions = {}
  ): Promise<void> {
    const buffer = await this.renderToImage(component, options);
    
    const fs = await import('fs');
    await fs.promises.writeFile(outputPath, buffer);
    
    console.log(`✅ 组件已渲染到: ${outputPath}`);
  }
}

// 单例实例
export const minioWidgetRenderer = new MinIOWidgetRenderer();