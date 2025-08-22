/**
 * React 组件到图片渲染器
 * 将 React 组件渲染为适合水墨屏的图片
 */

import puppeteer, { Browser, Page, ScreenshotOptions } from 'puppeteer';
import { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderOptions } from './types.js';
import { FontLoader } from './font-loader.js';
import { LocalFontServer } from './local-font-server.js';

export class WidgetRenderer {
  private browser: Browser | null = null;
  private fontServer: LocalFontServer | null = null;

  async initialize(): Promise<void> {
    if (!this.browser) {
      // 启动本地字体服务器
      if (!this.fontServer) {
        this.fontServer = new LocalFontServer();
        await this.fontServer.start();
      }
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
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
      
      // 创建完整的 HTML 页面
      const htmlContent = this.createHTMLPage(markup, backgroundColor);
      
      // 设置视口为水墨屏尺寸，确保像素完美
      await page.setViewport({
        width: 296,
        height: 152,
        deviceScaleFactor: 1, // 1:1像素比，避免缩放
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
      await new Promise(resolve => setTimeout(resolve, 1000));

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

  private createHTMLPage(markup: string, backgroundColor: string): string {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=296, height=152">
    <title>Widget Render</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        ${FontLoader.getFusionPixelCSS()}
        
        body {
            width: 296px;
            height: 152px;
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

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    // 关闭字体服务器
    if (this.fontServer) {
      await this.fontServer.stop();
      this.fontServer = null;
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
export const widgetRenderer = new WidgetRenderer();