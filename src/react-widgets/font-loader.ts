/**
 * 字体加载器 - 支持得意黑字体和Ark Pixel中文像素字体
 */

export class FontLoader {
  private static fontsLoaded = new Set<string>();

  /**
   * 加载得意黑字体
   */
  static async loadSmileySans(): Promise<void> {
    if (this.fontsLoaded.has('SmileySans')) {
      return;
    }

    // 使用在线CDN加载得意黑字体
    const fontUrl = 'https://cdn.jsdelivr.net/gh/atelier-anchor/smiley-sans@v2.0.1/packages/SmileySans-Oblique.ttf.woff2';
    
    try {
      // 创建字体face
      const fontFace = new FontFace('SmileySans', `url(${fontUrl})`);
      await fontFace.load();
      
      // 添加到文档字体集合
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.add(fontFace);
      }
      
      this.fontsLoaded.add('SmileySans');
      console.log('✅ 得意黑字体加载成功');
    } catch (error) {
      console.warn('⚠️ 得意黑字体加载失败，使用默认字体:', error);
    }
  }

  /**
   * 加载Ark Pixel中文像素字体
   */
  static async loadArkPixelFont(): Promise<void> {
    if (this.fontsLoaded.has('ArkPixelFont')) {
      return;
    }

    // 使用在线CDN加载Ark Pixel字体
    const fontUrl = 'https://cdn.jsdelivr.net/gh/TakWolf/ark-pixel-font@2025.08.11/dist/ark-pixel-12px-proportional-zh_cn.woff2';
    
    try {
      // 创建字体face
      const fontFace = new FontFace('ArkPixelFont', `url(${fontUrl})`);
      await fontFace.load();
      
      // 添加到文档字体集合
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.add(fontFace);
      }
      
      this.fontsLoaded.add('ArkPixelFont');
      console.log('✅ Ark Pixel中文像素字体加载成功');
    } catch (error) {
      console.warn('⚠️ Ark Pixel字体加载失败，使用默认字体:', error);
    }
  }

  /**
   * 获取得意黑字体CSS样式
   */
  static getSmileySansFontFamily(): string {
    return '"SmileySans", "Smiley Sans", "得意黑", "Microsoft YaHei", "SimHei", sans-serif';
  }

  /**
   * 获取Fusion Pixel中文像素字体CSS样式
   */
  static getFusionPixelFontFamily(): string {
    return '"FusionPixelFont", "Fusion Pixel Font", "Microsoft YaHei", "SimHei", monospace';
  }

  /**
   * 为Puppeteer环境加载得意黑字体 - 使用正确的CDN
   */
  static getSmileySansCSS(): string {
    return `
      @font-face {
        font-family: 'SmileySans';
        src: url('https://cdn.jsdelivr.net/npm/font-smiley-sans@1.0.0/SmileySans-Oblique.ttf.woff2') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;
  }

  /**
   * 为Puppeteer环境加载Fusion Pixel中文像素字体 - 使用本地服务器
   */
  static getFusionPixelCSS(): string {
    return `
      @font-face {
        font-family: 'FusionPixelFont';
        src: url('http://localhost:3001/fusion-pixel.woff2') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;
  }

  /**
   * 为Puppeteer环境加载指定大小的Fusion Pixel中文像素字体
   */
  static getFusionPixelCSSForSize(fontSize: number): string {
    return `
      @font-face {
        font-family: 'FusionPixelFont';
        src: url('http://localhost:3001/fusion-pixel-${fontSize}px.woff2') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;
  }
}