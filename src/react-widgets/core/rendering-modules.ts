/**
 * 组件渲染模块抽象基类和具体实现
 */

import React from 'react';
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
    
    // 简化实现：返回一个描述性字符串，而不是实际渲染图片
    // 在完整实现中，这里会调用实际的渲染引擎
    const result = `news-component-${data.id}-${Date.now()}.png`;
    console.log(`✅ 新闻组件渲染完成（模拟）: ${result}`);
    return result;
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
      signature: `${processedData.processingMetadata?.processor || 'unknown'} v${processedData.processingMetadata?.model || '1.0'}`,
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
 * 渲染模块注册表
 */
export class RenderingRegistry {
  private modules: Map<string, RenderingModule> = new Map();
  
  constructor() {
    // 注册默认渲染模块
    this.register('news', new NewsRenderingModule());
    this.register('json', new JSONRenderingModule());
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
  
  async getModuleStatus(name: string): Promise<RenderingHealthStatus | null> {
    const module = this.modules.get(name);
    if (!module) {
      return null;
    }
    
    return await module.getHealthStatus();
  }
  
  async getAllModulesStatus(): Promise<Record<string, RenderingHealthStatus | null>> {
    const status: Record<string, RenderingHealthStatus | null> = {};
    
    for (const [name, module] of this.modules) {
      try {
        status[name] = await module.getHealthStatus();
      } catch (error) {
        status[name] = null;
      }
    }
    
    return status;
  }
}

// 导出默认注册表实例
export const renderingRegistry = new RenderingRegistry();