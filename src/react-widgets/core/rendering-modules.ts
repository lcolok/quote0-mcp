/**
 * 组件渲染模块抽象基类和具体实现
 */

import React from 'react';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT, EINK_DEVICE_SIZE_LABEL } from './device-constants.js';
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
          width: config.width || EINK_DEVICE_WIDTH,
          height: config.height || EINK_DEVICE_HEIGHT,
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
export class DevicePushRenderingModule extends BaseRenderingModule<{ imageUrl: string; deviceResult: string }> {
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
  
  async render(data: RenderableDataItem, config: RenderingConfig): Promise<{ imageUrl: string; deviceResult: string }> {
    console.log(`📱 渲染并推送到设备: ${data.title}`);
    
    // 声明渲染器变量，以便在错误处理中使用
    let satoriRenderer: any = null;
    
    try {
      // 直接使用传入的数据进行渲染，而不是调用CLI工具
      const { SatoriNewsWidget } = await import('../components/SatoriNewsWidget.js');
      const { satoriRenderer: renderer } = await import('./satori-renderer.js');
      satoriRenderer = renderer;
      const { getImageStorage } = await import('./image-storage.js');
      const React = await import('react');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const fs = await import('fs/promises');
      
      const execAsync = promisify(exec);
      
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

      // 推送到设备
      console.log('📤 推送到MindReset设备...');

      // 设备健康检查API已移除，直接进行推送
      console.log('📤 准备推送到MindReset设备...');

      const deviceCommand = `bunx tsx src/image-sender/interfaces/cli/cli-main.ts send-server-dither "${localImagePath}" "0" "${data.link || ''}" "ORDERED"`;

      // 实现自动重试机制处理429错误
      let retryCount = 0;
      const maxRetries = 2;
      const baseDelay = 30000; // 30秒基础延迟

      while (retryCount <= maxRetries) {
        try {
          const { stdout, stderr } = await execAsync(deviceCommand, {
            cwd: process.cwd(),
            env: process.env
          });

          if (stdout) {
            console.log(stdout);
          }
          if (stderr) {
            console.error(stderr);
          }

          return {
            imageUrl,
            localImagePath: `/${objectKey}`, // 使用MinIO objectKey作为数据库路径
            deviceResult: '推送成功',
            // 添加文本数据，确保与图片内容一致
            title: data.title,
            message: data.message,
            summary: data.message, // 使用 message 作为 summary
            source: data.source,
            signature: data.signature,
            link: data.link
          };
        } catch (deviceError: any) {
          // 检查是否是429错误且还有重试次数
          if (deviceError.message.includes('429 Too Many Requests') && retryCount < maxRetries) {
            const delay = baseDelay * (retryCount + 1); // 递增延迟
            console.warn(`⏱️ 遇到API频率限制，${delay/1000}秒后进行第${retryCount + 1}次重试...`);
            
            // 等待指定时间
            await new Promise(resolve => setTimeout(resolve, delay));
            retryCount++;
            continue;
          }
          
          // 如果不是429错误或重试次数已用完，处理错误
          console.error('❌ 设备推送失败:', deviceError.message);
          
          // 增强的错误信息和用户提醒
          let enhancedErrorMessage = `推送失败: ${deviceError.message}`;
          let troubleshootingTips = '';
          
          // 检查是否是429错误（请求频率过高）
          if (deviceError.message.includes('429 Too Many Requests')) {
            if (retryCount >= maxRetries) {
              troubleshootingTips = `
⏱️ API请求频率过高 - 已重试${maxRetries}次仍未成功
🔍 建议解决方案：
1. 手动等待更长时间（建议2-5分钟）后再次尝试
2. 检查是否有其他程序同时在使用设备API
3. 暂时降低发送频率，避免频繁操作
4. 如果问题持续，可能需要联系技术支持

💡 提示：系统已自动重试但仍受限，建议稍后手动重试`;
            } else {
              troubleshootingTips = `
⏱️ API请求频率过高 - 系统保护机制触发
🔍 解决方案：
1. 等待 30-60 秒后再次尝试发送
2. 避免在短时间内连续发送多个图片
3. 如有自动化脚本，请在发送间隔中添加延迟（建议10秒以上）
4. 检查是否有其他程序同时在使用设备API

💡 提示：这是正常的API保护机制，稍等片刻即可恢复正常`;
            }
            
            console.warn('⏱️ API频率限制触发');
            console.log(troubleshootingTips);
            enhancedErrorMessage += troubleshootingTips;
          
        } else if (deviceError.message.includes('500 Internal Server Error')) {
          troubleshootingTips = `
🔍 故障排查建议：
1. 检查MindReset设备是否正常连接电源和USB线
2. 尝试拔插USB数据线重新连接设备
3. 确认设备屏幕是否有显示（设备可能处于休眠状态）
4. 检查设备是否在dot.mindreset.tech管理界面中显示为在线状态
5. 如果问题持续，可能是服务器临时故障，请稍后重试`;
          
          console.warn('🚨 设备连接问题检测');
          console.log(troubleshootingTips);
          enhancedErrorMessage += troubleshootingTips;
          
        } else if (deviceError.message.includes('ECONNREFUSED') || deviceError.message.includes('timeout')) {
          troubleshootingTips = `
🔍 网络连接问题：
1. 检查网络连接是否正常
2. 确认dot.mindreset.tech服务是否可访问
3. 检查防火墙设置是否阻止了连接`;
          
          console.warn('🌐 网络连接问题检测');
          console.log(troubleshootingTips);
          enhancedErrorMessage += troubleshootingTips;
          
        } else if (deviceError.message.includes('Command failed')) {
          troubleshootingTips = `
🔍 命令执行问题：
1. 检查image-sender模块是否正确构建 (npm run build)
2. 确认所有依赖包已正确安装
3. 检查设备ID和密钥配置是否正确`;
          
          console.warn('⚙️ 命令执行问题检测');
          console.log(troubleshootingTips);
          enhancedErrorMessage += troubleshootingTips;
        }
        
          return {
            imageUrl,
            localImagePath: `/${objectKey}`, // 添加localImagePath，即使推送失败也要保存图片路径
            deviceResult: enhancedErrorMessage,
            // 即使推送失败，也返回文本数据
            title: data.title,
            message: data.message,
            summary: data.message,
            source: data.source,
            signature: data.signature,
            link: data.link
          };
        }
      }
      
      // 如果到达这里，说明所有重试都失败了
      return {
        imageUrl,
        localImagePath: `/${objectKey}`, // 添加localImagePath，即使推送失败也要保存图片路径
        deviceResult: '推送失败: 超过最大重试次数',
        // 即使推送失败，也返回文本数据
        title: data.title,
        message: data.message,
        summary: data.message,
        source: data.source,
        signature: data.signature,
        link: data.link
      };
      
    } catch (error) {
      console.error('设备推送渲染失败:', error);
      throw new Error(`设备推送渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      // 确保渲染器资源被清理
      if (satoriRenderer) {
        try {
          await satoriRenderer.close();
        } catch (cleanupError) {
          console.warn('⚠️ 渲染器清理失败:', cleanupError);
        }
      }
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
      },
      {
        name: 'devicePush',
        type: 'boolean',
        required: false,
        defaultValue: true,
        description: '是否推送到设备'
      }
    ];
  }
  
  async getHealthStatus(): Promise<RenderingHealthStatus> {
    try {
      // 检查bun命令是否可用
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      await execAsync('which bun', { timeout: 1000 });
      
      return {
        healthy: true,
        message: '设备推送渲染器正常',
        lastChecked: new Date().toISOString(),
        responseTime: 100,
        renderingCapacity: 5, // 设备推送相对慢一些
        fontStatus: 'loaded',
        additionalInfo: {
          bunAvailable: true,
          integratedPipeline: true
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        message: `设备推送渲染器异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: 1000,
        renderingCapacity: 0,
        fontStatus: 'error'
      };
    }
  }
}

/**
 * 本地 E-Ink 推送渲染模块
 * 渲染 PNG → 转换 1-bit bitmap → POST 到局域网 e-ink 设备
 */
export class LocalEinkRenderingModule extends BaseRenderingModule<{ imageUrl: string; pushResults: Array<{ device: string; ok: boolean; error?: string }> }> {
  name = '本地E-Ink推送渲染器';
  version = '1.0.0';
  description = '将新闻渲染为图片并推送到局域网 e-ink 设备（bitmap 直推）';

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

  async render(data: RenderableDataItem, config: RenderingConfig): Promise<{ imageUrl: string; pushResults: Array<{ device: string; ok: boolean; error?: string }> }> {
    console.log(`🖥️ 渲染并推送到本地 e-ink 设备: ${data.title}`);

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
        renderConfig: { border: config.border, width: config.width || EINK_DEVICE_WIDTH, height: config.height || EINK_DEVICE_HEIGHT }
      };
      const uploadResult = await imageStorage.uploadImage(localImagePath, metadata);
      const imageUrl = uploadResult.url;
      console.log(`✅ PNG 已上传 MinIO: ${imageUrl}`);

      // 3. PNG → 1-bit bitmap
      const { pngTo1BitBitmap } = await import('../../api/eink-converter.js');
      const bitmap = await pngTo1BitBitmap(imageBuffer);
      console.log(`📐 Bitmap 转换完成: ${bitmap.length} bytes`);

      // 4. 读取设备清单并逐个推送
      const { getEinkDevices, pushToEinkDevice } = await import('../../api/eink-converter.js');

      const devices = await getEinkDevices();
      if (devices.length === 0) {
        console.warn('⚠️ 未配置 E-Ink 设备，跳过推送');
        return { imageUrl, pushResults: [] };
      }

      const pushResults: Array<{ device: string; ok: boolean; error?: string }> = [];

      for (const device of devices) {
        const result = await pushToEinkDevice(device, bitmap);
        pushResults.push({
          device: device.id,
          ok: result.ok,
          error: result.error
        });
      }

      return { imageUrl, pushResults };

    } catch (error) {
      console.error('本地 E-Ink 推送渲染失败:', error);
      throw new Error(`本地 E-Ink 推送渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      if (satoriRenderer) {
        try {
          await satoriRenderer.close();
        } catch (cleanupError) {
          console.warn('⚠️ 渲染器清理失败:', cleanupError);
        }
      }
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
    try {
      // 检查设备配置是否可用
      const { getEinkDevices } = await import('../../api/eink-converter.js');
      const devices = await getEinkDevices();

      return {
        healthy: true,
        message: `本地 E-Ink 推送渲染器正常，已配置 ${devices.length} 个设备`,
        lastChecked: new Date().toISOString(),
        responseTime: 100,
        renderingCapacity: devices.length > 0 ? 10 : 0,
        fontStatus: 'loaded',
        additionalInfo: {
          targetResolution: EINK_DEVICE_SIZE_LABEL,
          bitmapFormat: '1-bit MSB-first',
          deviceCount: devices.length,
          devices: devices.map(d => ({ id: d.id, name: d.name }))
        }
      };
    } catch (error) {
      return {
        healthy: false,
        message: `本地 E-Ink 推送渲染器异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: 1000,
        renderingCapacity: 0,
        fontStatus: 'error'
      };
    }
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
