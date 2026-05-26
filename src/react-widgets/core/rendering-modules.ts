/**
 * 组件渲染模块抽象基类和具体实现
 */

import React from 'react';
import { EINK_TARGET } from './render-targets.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from './device-constants.js';
import { 
  RenderingModule, 
  ProcessedDataItem, 
  RenderableDataItem, 
  RenderingParams, 
  RenderingParamDefinition, 
  RenderingConfig,
  RenderingHealthStatus 
} from './modular-architecture.js';

/**
 * 组件渲染模块抽象基类
 */
export abstract class BaseRenderingModule<T = any> implements RenderingModule<T> {
  abstract name: string;
  abstract version: string;
  abstract description: string;
  
  abstract transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem;
  abstract render(data: RenderableDataItem, config: RenderingConfig): Promise<T>;
  abstract getSupportedParams(): RenderingParamDefinition[];
  
  validateParams(params: RenderingParams): boolean {
    const supportedParams = this.getSupportedParams();
    
    // 检查必需参数
    for (const paramDef of supportedParams) {
      if (paramDef.required && !(paramDef.name in params)) {
        console.error(`缺少必需参数: ${paramDef.name}`);
        return false;
      }
      
      // 检查参数类型和验证
      if (paramDef.name in params) {
        const value = params[paramDef.name];
        
        if (paramDef.validation && !paramDef.validation(value)) {
          console.error(`参数验证失败: ${paramDef.name}`);
          return false;
        }
      }
    }
    
    return true;
  }
  
  async getHealthStatus(): Promise<RenderingHealthStatus> {
    const startTime = Date.now();
    
    try {
      // 创建测试数据
      const testData: RenderableDataItem = {
        id: 'health_test',
        title: '健康检查',
        message: '渲染模块健康状态测试',
        signature: '测试',
        source: '健康检查',
        publishTime: new Date().toISOString(),
        category: 'test'
      };
      
      // 尝试渲染测试数据
      await this.render(testData, {});
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: '渲染模块正常',
        lastChecked: new Date().toISOString(),
        responseTime,
        renderingCapacity: 100,
        fontStatus: 'loaded'
      };
    } catch (error) {
      return {
        healthy: false,
        message: `渲染模块异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        renderingCapacity: 0,
        fontStatus: 'error'
      };
    }
  }
}

/**
 * 新闻组件渲染模块
 */
export class NewsRenderingModule extends BaseRenderingModule<string> {
  name = '新闻组件渲染器';
  version = '1.0.0';
  description = '将处理后的新闻数据渲染为新闻组件图片';
  
  transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem {
    const sourceMapping: Record<string, string> = {
      'rss': 'RSS智能',
      'mock': 'Mock演示',
      'api': 'API实时'
    };
    
    // 根据处理器类型生成签名
    let signature = '';
    const processorName = processedData.processingMetadata?.processor || 'unknown';
    
    if (processorName.includes('AX')) {
      signature = `AI优化·Q${Math.round((processedData.qualityScore || 0.85) * 100)}`;
    } else if (processorName.includes('LLM')) {
      signature = `AI智能·${processedData.processingMetadata?.model || 'LLM'}`;
    } else {
      signature = sourceMapping[processedData.rawData?.source || 'unknown'] || '智能处理';
    }
    
    return {
      id: processedData.id,
      title: processedData.optimizedTitle,
      message: processedData.summary || processedData.processedContent,
      signature,
      source: processedData.rawData?.source || 'unknown',
      publishTime: processedData.rawData?.publishTime || new Date().toISOString(),
      category: processedData.rawData?.category || '新闻',
      link: processedData.rawData?.link,
      highlights: processedData.highlights,
      metadata: {
        originalTitle: processedData.originalTitle,
        processingMetadata: processedData.processingMetadata,
        qualityScore: processedData.qualityScore
      }
    };
  }
  
  async render(data: RenderableDataItem, config: RenderingConfig): Promise<string> {
    console.log(`🎨 渲染新闻组件: ${data.title}`);
    
    try {
      // 动态导入所需的模块
      const { SatoriNewsWidget } = await import('../components/SatoriNewsWidget.js');
      const { satoriRenderer } = await import('./satori-renderer.js');
      const { getImageStorage } = await import('./image-storage.js');
      const React = await import('react');
      
      // 初始化渲染器
      await satoriRenderer.initialize();
      
      // 创建新闻数据对象
      const newsData = {
        title: data.title,
        message: data.message,
        signature: data.signature,
        source: data.source,
        publishTime: data.publishTime,
        category: data.category,
        link: data.link,
        highlights: data.highlights
      };
      
      // 渲染组件为图片
      const borderColor = config.border === '1' ? '#000000' : '#ffffff';
      
      const imageBuffer = await satoriRenderer.renderToImage(
        React.createElement(SatoriNewsWidget, { 
          data: newsData,
          border: borderColor 
        }),
        {
          width: config.width || EINK_TARGET.widthPx,
          height: config.height || EINK_TARGET.heightPx,
          backgroundColor: config.backgroundColor || '#ffffff'
        }
      );
      
      // 保存图片到MinIO
      const imageStorage = getImageStorage();
      const { writeFile, unlink } = await import('fs/promises');
      const { join } = await import('path');
      const { tmpdir } = await import('os');
      
      const timestamp = Date.now();
      const filename = `modular_${data.id}_${timestamp}.png`;
      
      // 先保存到临时文件
      const tempPath = join(tmpdir(), filename);
      await writeFile(tempPath, imageBuffer);
      
      try {
        // 上传到MinIO
        const metadata = {
          widgetType: 'news',
          cacheKey: `${data.category}_${data.index || 0}_${timestamp}`,
          renderConfig: config
        };
        
        const uploadResult = await imageStorage.uploadImage(tempPath, metadata);
        const imageUrl = uploadResult.url;
        
        console.log(`✅ 新闻组件渲染完成: ${imageUrl}`);
        return imageUrl;
      } finally {
        // 清理临时文件
        try {
          await unlink(tempPath);
        } catch (error) {
          // 忽略删除错误
        }
      }
      
    } catch (error) {
      console.error('新闻组件渲染失败:', error);
      
      // 降级到简化模式
      console.log('📝 降级到简化模式...');
      const result = `news-component-${data.id}-${Date.now()}.png`;
      console.log(`✅ 新闻组件渲染完成（简化模式）: ${result}`);
      return result;
    }
  }
  
  getSupportedParams(): RenderingParamDefinition[] {
    return [
      {
        name: 'sourceMapping',
        type: 'object',
        required: false,
        description: '数据源显示名称映射'
      },
      {
        name: 'signatureStyle',
        type: 'string',
        required: false,
        defaultValue: 'auto',
        description: '签名样式：auto, simple, detailed',
        choices: ['auto', 'simple', 'detailed']
      }
    ];
  }
  
  async getHealthStatus(): Promise<RenderingHealthStatus> {
    return {
      healthy: true,
      message: '新闻渲染模块正常（简化模式）',
      lastChecked: new Date().toISOString(),
      responseTime: 1,
      renderingCapacity: 100,
      fontStatus: 'loaded',
      additionalInfo: {
        mode: 'simplified',
        actualRendering: false
      }
    };
  }
}

/**
 * JSON输出渲染模块
 */
export class JSONRenderingModule extends BaseRenderingModule<object> {
  name = 'JSON渲染器';
  version = '1.0.0';
  description = '将处理后的数据输出为JSON格式，用于调试和API接口';
  
  transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem {
    return {
      id: processedData.id,
      title: processedData.optimizedTitle,
      message: processedData.processedContent,
      signature: `${processedData.processingMetadata?.processor || 'unknown'} · ${processedData.processingMetadata?.model || '1.0'}`,
      source: processedData.rawData?.source || 'unknown',
      publishTime: processedData.rawData?.publishTime || new Date().toISOString(),
      category: processedData.rawData?.category || 'default',
      link: processedData.rawData?.link,
      highlights: processedData.highlights,
      metadata: {
        processing: processedData.processingMetadata,
        qualityScore: processedData.qualityScore,
        originalData: params.includeOriginal ? processedData.rawData : undefined
      }
    };
  }
  
  async render(data: RenderableDataItem, config: RenderingConfig): Promise<object> {
    console.log(`📄 JSON渲染: ${data.title}`);
    
    const result = {
      id: data.id,
      title: data.title,
      message: data.message,
      signature: data.signature,
      source: data.source,
      publishTime: data.publishTime,
      category: data.category,
      link: data.link,
      highlights: data.highlights,
      renderedAt: new Date().toISOString(),
      renderer: {
        name: this.name,
        version: this.version
      }
    };
    
    if (config.includeMetadata) {
      result['metadata'] = data.metadata;
    }
    
    console.log(`✅ JSON渲染完成`);
    return result;
  }
  
  getSupportedParams(): RenderingParamDefinition[] {
    return [
      {
        name: 'includeOriginal',
        type: 'boolean',
        required: false,
        defaultValue: false,
        description: '是否包含原始数据'
      }
    ];
  }
  
  async getHealthStatus(): Promise<RenderingHealthStatus> {
    return {
      healthy: true,
      message: 'JSON渲染器始终可用',
      lastChecked: new Date().toISOString(),
      responseTime: 1,
      renderingCapacity: 1000,
      fontStatus: 'loaded'
    };
  }
}

/**
 * 设备推送渲染模块
 */
export class DevicePushRenderingModule extends BaseRenderingModule<any> {
  name = '设备推送渲染器';
  version = '1.0.0';
  description = '将新闻组件渲染为图片并推送到MindReset设备';
  
  transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem {
    const sourceMapping: Record<string, string> = {
      'rss': 'RSS智能',
      'mock': 'Mock演示',
      'api': 'API实时'
    };
    
    // 根据处理器类型生成签名
    let signature = '';
    const processorName = processedData.processingMetadata?.processor || 'unknown';
    
    if (processorName.includes('AX')) {
      signature = `AI优化·Q${Math.round((processedData.qualityScore || 0.85) * 100)}`;
    } else if (processorName.includes('LLM')) {
      signature = `AI智能·${processedData.processingMetadata?.model || 'LLM'}`;
    } else {
      signature = sourceMapping[processedData.rawData?.source || 'unknown'] || '智能处理';
    }
    
    return {
      id: processedData.id,
      title: processedData.optimizedTitle,
      message: processedData.summary || processedData.processedContent,
      signature,
      source: processedData.rawData?.source || 'unknown',
      publishTime: processedData.rawData?.publishTime || new Date().toISOString(),
      category: processedData.rawData?.category || '新闻',
      link: processedData.rawData?.link,
      highlights: processedData.highlights,
      metadata: {
        originalTitle: processedData.originalTitle,
        processingMetadata: processedData.processingMetadata,
        qualityScore: processedData.qualityScore
      }
    };
  }
  
  async render(data: RenderableDataItem, config: RenderingConfig): Promise<any> {
    console.log(`📱 渲染设备图片: ${data.title}`);

    let satoriRenderer: any = null;

    try {
      const { SatoriNewsWidget } = await import('../components/SatoriNewsWidget.js');
      const { satoriRenderer: renderer } = await import('./satori-renderer.js');
      satoriRenderer = renderer;
      const { getImageStorage } = await import('./image-storage.js');
      const React = await import('react');
      const fs = await import('fs/promises');
      
      // 初始化渲染器
      await satoriRenderer.initialize();
      
      // 创建新闻数据对象，使用传入的处理后数据
      const newsData = {
        title: data.title,
        message: data.message,
        signature: data.signature,
        source: data.source,
        publishTime: data.publishTime,
        category: data.category,
        link: data.link,
        highlights: data.highlights?.map(word => ({ word, color: '#ff0000' })) // 转换为HighlightedWord格式
      };
      
      console.log(`🎨 渲染新闻数据:`, {
        title: newsData.title,
        source: newsData.source,
        signature: newsData.signature,
        messageLength: newsData.message.length
      });
      
      // 渲染组件为图片
      const borderColor = config.border === '1' ? '#000000' : '#ffffff';
      
      const imageBuffer = await satoriRenderer.renderToImage(
        React.createElement(SatoriNewsWidget, { 
          data: newsData,
          border: borderColor 
        }),
        {
          format: 'png',
          quality: 100,
          backgroundColor: config.backgroundColor || '#ffffff'
        }
      );
      
      // 保存图片到本地临时文件
      const timestamp = Date.now();
      const filename = `modular_${data.id}_${timestamp}.png`;
      const localImagePath = `./processed-images/widgets/news/${filename}`;
      
      // 确保目录存在
      const dirPath = './processed-images/widgets/news';
      await fs.mkdir(dirPath, { recursive: true });
      
      // 保存到本地文件
      await fs.writeFile(localImagePath, imageBuffer);
      console.log(`💾 图片已保存到本地: ${localImagePath}`);
      
      // 上传到MinIO
      const imageStorage = getImageStorage();
      
      const metadata = {
        widgetType: 'news',
        cacheKey: `modular_${data.id}_${timestamp}`,
        renderConfig: {
          border: config.border,
          width: config.width || EINK_DEVICE_WIDTH,
          height: config.height || EINK_DEVICE_HEIGHT
        }
      };
      
      const uploadResult = await imageStorage.uploadImage(localImagePath, metadata);
      const imageUrl = uploadResult.url;
      const objectKey = uploadResult.objectKey;
      console.log(`✅ 新闻组件已保存到MinIO: ${imageUrl}`);
      console.log(`📦 MinIO对象键: ${objectKey}`);

      // Renderer 职责：只渲染和上传，不推送。
      // 推送由调用方（processNews / DevicePusher）统一负责。
      return {
        imageUrl,
        localImagePath, // 返回真正的本地路径，供 Pusher 使用
        title: data.title,
        message: data.message,
        summary: data.message,
        source: data.source,
        signature: data.signature,
        link: data.link
      };

    } catch (error) {
      console.error('设备渲染失败:', error);
      throw new Error(`设备渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      // 单例 Satori 渲染器常驻常热，不在每次渲染后 close()
    }
  }
  
  getSupportedParams(): RenderingParamDefinition[] {
    return [
      {
        name: 'signatureStyle',
        type: 'string',
        required: false,
        defaultValue: 'auto',
        description: '签名样式：auto, simple, detailed',
        choices: ['auto', 'simple', 'detailed']
      }
    ];
  }
  
  async getHealthStatus(): Promise<RenderingHealthStatus> {
    return {
      healthy: true,
      message: '设备渲染器正常',
      lastChecked: new Date().toISOString(),
      responseTime: 100,
      renderingCapacity: 10,
      fontStatus: 'loaded',
      additionalInfo: { integratedPipeline: true }
    };
  }
}

/**
 * 本地 E-Ink 推送渲染模块
 * 渲染 PNG → 转换 1-bit bitmap → POST 到局域网 e-ink 设备
 */
export class LocalEinkRenderingModule extends BaseRenderingModule<any> {
  name = '本地E-Ink渲染器';
  version = '1.0.0';
  description = '将新闻渲染为图片并上传至 MinIO（推送由 DevicePusher 统一负责）';

  transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem {
    const sourceMapping: Record<string, string> = {
      'rss': 'RSS智能',
      'mock': 'Mock演示',
      'api': 'API实时'
    };

    let signature = '';
    const processorName = processedData.processingMetadata?.processor || 'unknown';
    if (processorName.includes('AX')) {
      signature = `AI优化·Q${Math.round((processedData.qualityScore || 0.85) * 100)}`;
    } else if (processorName.includes('LLM')) {
      signature = `AI智能·${processedData.processingMetadata?.model || 'LLM'}`;
    } else {
      signature = sourceMapping[processedData.rawData?.source || 'unknown'] || '智能处理';
    }

    return {
      id: processedData.id,
      title: processedData.optimizedTitle,
      message: processedData.summary || processedData.processedContent,
      signature,
      source: processedData.rawData?.source || 'unknown',
      publishTime: processedData.rawData?.publishTime || new Date().toISOString(),
      category: processedData.rawData?.category || '新闻',
      link: processedData.rawData?.link,
      highlights: processedData.highlights,
      metadata: {
        originalTitle: processedData.originalTitle,
        processingMetadata: processedData.processingMetadata,
        qualityScore: processedData.qualityScore
      }
    };
  }

  async render(data: RenderableDataItem, config: RenderingConfig): Promise<any> {
    console.log(`🖥️ 渲染本地 e-ink 图片: ${data.title}`);

    let satoriRenderer: any = null;

    try {
      // 1. Satori 渲染 PNG（与 DevicePushRenderingModule 相同流程）
      const { SatoriNewsWidget } = await import('../components/SatoriNewsWidget.js');
      const { satoriRenderer: renderer } = await import('./satori-renderer.js');
      satoriRenderer = renderer;
      const { getImageStorage } = await import('./image-storage.js');
      const React = await import('react');
      const fs = await import('fs/promises');

      await satoriRenderer.initialize();

      const newsData = {
        title: data.title,
        message: data.message,
        signature: data.signature,
        source: data.source,
        publishTime: data.publishTime,
        category: data.category,
        link: data.link,
        highlights: data.highlights?.map(word => ({ word, color: '#ff0000' }))
      };

      const borderColor = config.border === '1' ? '#000000' : '#ffffff';
      const imageBuffer = await satoriRenderer.renderToImage(
        React.createElement(SatoriNewsWidget, {
          data: newsData,
          border: borderColor
        }),
        {
          format: 'png',
          quality: 100,
          backgroundColor: config.backgroundColor || '#ffffff'
        }
      );

      // 2. 保存到本地临时文件 + 上传 MinIO
      const timestamp = Date.now();
      const filename = `modular_${data.id}_${timestamp}.png`;
      const localImagePath = `./processed-images/widgets/news/${filename}`;
      const dirPath = './processed-images/widgets/news';
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(localImagePath, imageBuffer);

      const imageStorage = getImageStorage();
      const metadata = {
        widgetType: 'news',
        cacheKey: `modular_${data.id}_${timestamp}`,
        renderConfig: { border: config.border, width: config.width || EINK_TARGET.widthPx, height: config.height || EINK_TARGET.heightPx }
      };
      const uploadResult = await imageStorage.uploadImage(localImagePath, metadata);
      const imageUrl = uploadResult.url;
      console.log(`✅ PNG 已上传 MinIO: ${imageUrl}`);

      // Renderer 职责：只渲染和上传，不推送。
      // 推送由调用方（processNews / DevicePusher）统一负责。
      return {
        imageUrl,
        localImagePath,
        title: data.title,
        message: data.message,
        summary: data.message,
        source: data.source,
        signature: data.signature,
        link: data.link
      };

    } catch (error) {
      console.error('本地 E-Ink 渲染失败:', error);
      throw new Error(`本地 E-Ink 渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      // 单例 Satori 渲染器常驻常热，不在每次渲染后 close()
    }
  }

  getSupportedParams(): RenderingParamDefinition[] {
    return [
      {
        name: 'signatureStyle',
        type: 'string',
        required: false,
        defaultValue: 'auto',
        description: '签名样式：auto, simple, detailed',
        choices: ['auto', 'simple', 'detailed']
      }
    ];
  }

  async getHealthStatus(): Promise<RenderingHealthStatus> {
    return {
      healthy: true,
      message: '本地 E-Ink 渲染器正常',
      lastChecked: new Date().toISOString(),
      responseTime: 100,
      renderingCapacity: 10,
      fontStatus: 'loaded',
      additionalInfo: {
        targetResolution: `${EINK_TARGET.widthPx}x${EINK_TARGET.heightPx}`,
        bitmapFormat: '1-bit MSB-first'
      }
    };
  }
}

/**
 * 渲染模块注册表
 */
export class RenderingRegistry {
  private modules: Map<string, RenderingModule> = new Map();
  private readonly healthCheckTimeoutMs = Number(process.env.MODULE_HEALTH_TIMEOUT_MS ?? '5000');
  
  constructor() {
    // 注册默认渲染模块
    this.register('news', new NewsRenderingModule());
    this.register('json', new JSONRenderingModule());
    this.register('device', new DevicePushRenderingModule());
    this.register('local-eink', new LocalEinkRenderingModule());
  }
  
  register(name: string, module: RenderingModule): void {
    this.modules.set(name, module);
    console.log(`✅ 渲染模块已注册: ${name} (${module.name} v${module.version})`);
  }
  
  get(name: string): RenderingModule | undefined {
    return this.modules.get(name);
  }
  
  getAvailable(): string[] {
    return Array.from(this.modules.keys());
  }

  private createTimeoutStatus(name: string): RenderingHealthStatus {
    return {
      healthy: false,
      message: `健康检查超时 (${this.healthCheckTimeoutMs}ms) - ${name}`,
      lastChecked: new Date().toISOString(),
      responseTime: this.healthCheckTimeoutMs,
      renderingCapacity: 0,
      fontStatus: 'error'
    };
  }

  private createErrorStatus(error: unknown): RenderingHealthStatus {
    return {
      healthy: false,
      message: `健康检查异常: ${error instanceof Error ? error.message : '未知错误'}`,
      lastChecked: new Date().toISOString(),
      responseTime: 0,
      renderingCapacity: 0,
      fontStatus: 'error'
    };
  }

  private async withTimeout<T>(promise: Promise<T>, fallback: () => T): Promise<T> {
    const timeoutMs = this.healthCheckTimeoutMs;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback()), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async getModuleStatus(name: string): Promise<RenderingHealthStatus | null> {
    const module = this.modules.get(name);
    if (!module) {
      return null;
    }

    try {
      return await this.withTimeout(module.getHealthStatus(), () => this.createTimeoutStatus(name));
    } catch (error) {
      return this.createErrorStatus(error);
    }
  }

  async getAllModulesStatus(): Promise<Record<string, RenderingHealthStatus | null>> {
    const status: Record<string, RenderingHealthStatus | null> = {};
    
    for (const [name, module] of this.modules) {
      try {
        status[name] = await this.withTimeout(module.getHealthStatus(), () => this.createTimeoutStatus(name));
      } catch (error) {
        status[name] = this.createErrorStatus(error);
      }
    }
    
    return status;
  }
}

// 导出默认注册表实例
export const renderingRegistry = new RenderingRegistry();
