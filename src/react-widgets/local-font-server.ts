/**
 * 智能字体服务器 - 为Puppeteer提供多尺寸像素字体文件访问
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { selectOptimalFont } from './smart-font-selector';

export class LocalFontServer {
  private server: any = null;
  private port: number = 3001;
  private fontCache = new Map<string, Buffer>();

  // 字体文件映射
  private fontFiles = {
    8: 'fusion-pixel-8px-monospaced-zh_hans.otf.woff2',
    10: 'fusion-pixel-10px-monospaced-zh_hans.otf.woff2',
    12: 'fusion-pixel-12px-monospaced-zh_hans.otf.woff2'
  };

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
          // 解析请求的字体尺寸
          const match = req.url?.match(/\/fusion-pixel-(\d+)px\.woff2/);
          if (match) {
            const targetSize = parseInt(match[1]);
            await this.serveFontForSize(targetSize, res);
          } else if (req.url === '/fusion-pixel.woff2') {
            // 兼容旧版本请求，默认使用12px
            await this.serveFontForSize(12, res);
          } else {
            res.statusCode = 404;
            res.end('Font not found');
          }
        } catch (error) {
          console.error('Font server error:', error);
          res.statusCode = 500;
          res.end('Internal server error');
        }
      });

      this.server.listen(this.port, () => {
        const baseUrl = `http://localhost:${this.port}`;
        console.log(`✅ 智能字体服务器启动: ${baseUrl}`);
        console.log(`🎯 支持智能字体选择: ${baseUrl}/fusion-pixel-{size}px.woff2`);
        
        // 设置进程退出时自动清理
        process.on('exit', () => this.stop());
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
        
        resolve(baseUrl);
      });

      this.server.on('error', reject);
    });
  }

  private async serveFontForSize(targetSize: number, res: any) {
    // 使用智能字体选择算法
    const selection = selectOptimalFont(targetSize);
    const fileName = selection.fontFileName;
    
    // 检查缓存
    if (!this.fontCache.has(fileName)) {
      const fontPath = join(process.cwd(), 'assets/fonts', fileName);
      const fontData = await readFile(fontPath);
      this.fontCache.set(fileName, fontData);
      
      console.log(`📚 加载字体: ${targetSize}px → ${selection.baseFontSize}px基础字体 (${fileName})`);
    }

    const fontData = this.fontCache.get(fileName)!;
    
    res.setHeader('Content-Type', 'font/woff2');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('X-Font-Selection', JSON.stringify(selection));
    res.end(fontData);
  }

  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🔻 本地字体服务器已关闭');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}