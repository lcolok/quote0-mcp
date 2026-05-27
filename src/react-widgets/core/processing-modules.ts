/**
 * LLM处理模块抽象基类和具体实现
 */

import fs from 'fs';
import { Pool } from 'pg';
import { LLMCallCache } from './llm-call-cache.js';
import { getFallbackLLMConfig, getActiveLLMConfig } from './llm-config.js';
import { getPostgresDatabase } from './postgres-database.js';
import { 
  ProcessingModule, 
  RawDataItem, 
  ProcessedDataItem, 
  ProcessingParams, 
  ProcessingParamDefinition, 
  ProcessingHealthStatus 
} from './modular-architecture.js';

const DEFAULT_MODULE_HEALTH_TIMEOUT_MS = Number(process.env.MODULE_HEALTH_TIMEOUT_MS ?? '5000');
const LLM_HEALTH_TIMEOUT_MS = Math.min(DEFAULT_MODULE_HEALTH_TIMEOUT_MS, 4000);

type EndpointCheckResult = {
  reachable: boolean;
  status?: number;
  timedOut: boolean;
  duration: number;
  message?: string;
};

async function checkLLMEndpointReachability(baseURL: string, apiKey: string, timeoutMs: number): Promise<EndpointCheckResult> {
  const startTime = Date.now();

  if (!baseURL) {
    return {
      reachable: false,
      timedOut: false,
      duration: 0,
      message: 'LLM_BASE_URL 未配置'
    };
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers: Record<string, string> = {};
    if (apiKey && apiKey !== 'dummy') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(baseURL, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    const duration = Date.now() - startTime;
    const status = response.status;
    const reachable = response.ok || status === 401 || status === 403 || status === 404 || status === 405;

    return {
      reachable,
      status,
      timedOut: false,
      duration,
      message: reachable ? undefined : `HTTP ${status}`
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : '未知错误';

    return {
      reachable: false,
      status: undefined,
      timedOut,
      duration: timedOut ? timeoutMs : duration,
      message
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LLM处理模块抽象基类
 */
export abstract class BaseProcessingModule implements ProcessingModule {
  abstract name: string;
  abstract version: string;
  abstract description: string;
  
  abstract processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem>;
  abstract getSupportedParams(): ProcessingParamDefinition[];
  
  async batchProcessData(rawDataList: RawDataItem[], params: ProcessingParams): Promise<ProcessedDataItem[]> {
    console.log(`🔄 批量处理开始: ${rawDataList.length}条数据`);
    const results: ProcessedDataItem[] = [];
    
    for (let i = 0; i < rawDataList.length; i++) {
      const rawData = rawDataList[i];
      console.log(`📝 处理第${i + 1}/${rawDataList.length}条: ${rawData.title}`);
      
      try {
        const processed = await this.processData(rawData, params);
        results.push(processed);
      } catch (error) {
        console.error(`❌ 处理失败: ${rawData.id}`, error);
        // 创建失败的处理结果
        results.push({
          id: rawData.id,
          originalTitle: rawData.title,
          optimizedTitle: rawData.title, // 保持原标题
          originalContent: rawData.content,
          processedContent: rawData.content, // 保持原内容
          summary: rawData.content.substring(0, 100) + '...',
          processingMetadata: {
            processor: this.name,
            model: 'error',
            processedAt: new Date().toISOString(),
            processingTime: 0,
            confidence: 0
          },
          rawData
        });
      }
    }
    
    console.log(`✅ 批量处理完成: ${results.length}条结果`);
    return results;
  }
  
  validateParams(params: ProcessingParams): boolean {
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
  
  async getHealthStatus(): Promise<ProcessingHealthStatus> {
    const startTime = Date.now();
    
    try {
      // 创建测试数据
      const testData: RawDataItem = {
        id: 'health_test',
        title: '健康检查测试',
        content: '这是一个用于检查处理模块健康状态的测试数据项',
        source: 'health_check',
        publishTime: new Date().toISOString()
      };
      
      // 尝试处理测试数据
      await this.processData(testData, {});
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: 'LLM处理模块正常',
        lastChecked: new Date().toISOString(),
        responseTime,
        modelStatus: 'ready',
        queueLength: 0
      };
    } catch (error) {
      return {
        healthy: false,
        message: `LLM处理模块异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        modelStatus: 'error',
        queueLength: 0
      };
    }
  }
}

/**
 * 直通处理模块 - 不做任何处理，直接返回原数据
 */
export class PassThroughProcessingModule extends BaseProcessingModule {
  name = '直通处理器';
  version = '1.0.0';
  description = '不做任何处理，直接返回原始数据';
  
  async processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem> {
    console.log(`📝 直通处理: ${rawData.title}`);
    
    // 模拟处理延迟
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 10));
    const processingTime = Date.now() - startTime;
    
    return {
      id: rawData.id,
      originalTitle: rawData.title,
      optimizedTitle: rawData.title,
      originalContent: rawData.content,
      processedContent: rawData.content,
      summary: rawData.content.length > 100 ? rawData.content.substring(0, 100) + '...' : rawData.content,
      qualityScore: 1.0,
      processingMetadata: {
        processor: this.name,
        model: 'passthrough',
        processedAt: new Date().toISOString(),
        processingTime,
        confidence: 1.0
      },
      rawData
    };
  }
  
  getSupportedParams(): ProcessingParamDefinition[] {
    return [
      {
        name: 'maxSummaryLength',
        type: 'number',
        required: false,
        defaultValue: 100,
        description: '摘要最大长度',
        validation: (value: number) => value > 0 && value <= 500
      }
    ];
  }
  
  async getHealthStatus(): Promise<ProcessingHealthStatus> {
    return {
      healthy: true,
      message: '直通处理器始终可用',
      lastChecked: new Date().toISOString(),
      responseTime: 1,
      modelStatus: 'ready',
      queueLength: 0
    };
  }
}

/**
 * 基础LLM处理模块
 */
export class BasicLLMProcessingModule extends BaseProcessingModule {
  name = '基础LLM处理器';
  version = '1.0.0';
  description = '使用基础提示词进行LLM内容优化';
  
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private llmCache: LLMCallCache | null;
  
  constructor(config: { apiKey: string; baseURL: string; model: string }, pool?: Pool) {
    super();
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.llmCache = pool ? new LLMCallCache(pool) : null;
  }
  
  async processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem> {
    const startTime = Date.now();
    console.log(`🤖 基础LLM处理: ${rawData.title}`);
    
    // 动态读取最新 LLM 配置
    let activeApiKey = this.apiKey;
    let activeBaseURL = this.baseURL;
    let activeModel = this.model;
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      activeApiKey = cfg.apiKey;
      activeBaseURL = cfg.baseUrl;
      activeModel = cfg.model;
    } catch (e) {
      // 使用构造时的 fallback
    }
    
    try {
      const { OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: activeApiKey,
        baseURL: activeBaseURL
      });
      
      const maxTitleLength = params.maxTitleLength || 20;
      const maxContentLength = params.maxContentLength || 150;
      const temperature = params.temperature || 0.3;
      
      // 优化标题
      const titlePrompt = `请将以下新闻标题优化为简洁明了的版本，严格控制在${maxTitleLength}个字符以内：
      
原标题: ${rawData.title}

要求:
1. 突出核心事件和关键信息
2. 字符数不超过${maxTitleLength}个
3. 保持新闻性和准确性
4. 只返回优化后的标题，不要其他内容

优化标题:`;

      let optimizedTitle: string;
      const titleCacheKey = { prompt: titlePrompt, model: activeModel, temperature };
      const titleCached = this.llmCache ? await this.llmCache.get(titleCacheKey) : null;
      if (titleCached) {
        console.log(`💾 标题缓存命中: "${rawData.title}"`);
        optimizedTitle = titleCached.response;
      } else {
        const titleResponse = await client.chat.completions.create({
          model: activeModel,
          messages: [{ role: 'user', content: titlePrompt }],
          temperature,
          max_tokens: 100
        });
        optimizedTitle = titleResponse.choices[0]?.message?.content?.trim() || rawData.title;
        if (this.llmCache) {
          await this.llmCache.set(titleCacheKey, optimizedTitle);
        }
      }
      
      // 优化内容摘要
      const contentPrompt = `请将以下新闻内容提炼为精炼摘要，严格控制在${maxContentLength}个字符以内：

原内容: ${rawData.content}

要求:
1. 保留核心信息和关键细节
2. 字符数不超过${maxContentLength}个
3. 语言简洁流畅，适合快速阅读
4. 只返回摘要内容，不要其他内容

摘要:`;

      let processedContent: string;
      const contentCacheKey = { prompt: contentPrompt, model: activeModel, temperature };
      const contentCached = this.llmCache ? await this.llmCache.get(contentCacheKey) : null;
      if (contentCached) {
        console.log(`💾 摘要缓存命中: "${rawData.title}"`);
        processedContent = contentCached.response;
      } else {
        const contentResponse = await client.chat.completions.create({
          model: activeModel,
          messages: [{ role: 'user', content: contentPrompt }],
          temperature,
          max_tokens: 300
        });
        processedContent = contentResponse.choices[0]?.message?.content?.trim() || rawData.content;
        if (this.llmCache) {
          await this.llmCache.set(contentCacheKey, processedContent);
        }
      }
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ 基础LLM处理完成: "${optimizedTitle}" (耗时${processingTime}ms)`);
      
      return {
        id: rawData.id,
        originalTitle: rawData.title,
        optimizedTitle,
        originalContent: rawData.content,
        processedContent,
        summary: processedContent,
        qualityScore: 0.85, // 基础处理质量分数
        processingMetadata: {
          processor: this.name,
          model: activeModel,
          processedAt: new Date().toISOString(),
          processingTime,
          confidence: 0.85
        },
        rawData
      };
      
    } catch (error) {
      console.error('基础LLM处理失败:', error);
      throw new Error(`基础LLM处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async getHealthStatus(): Promise<ProcessingHealthStatus> {
    let activeApiKey = this.apiKey;
    let activeBaseURL = this.baseURL;
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      activeApiKey = cfg.apiKey;
      activeBaseURL = cfg.baseUrl;
    } catch (e) {
      // use fallback
    }

    if (!activeBaseURL || !activeApiKey) {
      return {
        healthy: false,
        message: 'LLM处理器未完成配置 (缺少API Key或Base URL)',
        lastChecked: new Date().toISOString(),
        responseTime: 0,
        modelStatus: 'error',
        queueLength: 0,
        additionalInfo: {
          baseURL: activeBaseURL || null,
          apiKeyConfigured: Boolean(activeApiKey)
        }
      };
    }

    const endpointCheck = await checkLLMEndpointReachability(activeBaseURL, activeApiKey, LLM_HEALTH_TIMEOUT_MS);
    const responseTime = endpointCheck.duration;
    const timestamp = new Date().toISOString();

    if (endpointCheck.reachable) {
      return {
        healthy: true,
        message: `LLM端点可访问 (HTTP ${endpointCheck.status ?? '未知'})`,
        lastChecked: timestamp,
        responseTime,
        modelStatus: 'ready',
        queueLength: 0,
        additionalInfo: {
          baseURL: activeBaseURL,
          statusCode: endpointCheck.status ?? null,
          timedOut: false
        }
      };
    }

    return {
      healthy: false,
      message: endpointCheck.timedOut
        ? `LLM端点在 ${LLM_HEALTH_TIMEOUT_MS}ms 内未响应`
        : `LLM端点检查失败: ${endpointCheck.message ?? '未知错误'}`,
      lastChecked: timestamp,
      responseTime,
      modelStatus: endpointCheck.timedOut ? 'loading' : 'error',
      queueLength: 0,
      additionalInfo: {
        baseURL: activeBaseURL,
        statusCode: endpointCheck.status ?? null,
        error: endpointCheck.message,
        timedOut: endpointCheck.timedOut
      }
    };
  }

  getSupportedParams(): ProcessingParamDefinition[] {
    return [
      {
        name: 'maxTitleLength',
        type: 'number',
        required: false,
        defaultValue: 20,
        description: '标题最大长度',
        validation: (value: number) => value > 0 && value <= 50
      },
      {
        name: 'maxContentLength',
        type: 'number',
        required: false,
        defaultValue: 150,
        description: '内容最大长度',
        validation: (value: number) => value > 0 && value <= 500
      },
      {
        name: 'temperature',
        type: 'number',
        required: false,
        defaultValue: 0.3,
        description: 'LLM温度参数',
        validation: (value: number) => value >= 0 && value <= 1
      }
    ];
  }
}

/**
 * AX优化处理模块
 */
export class AxOptimizedProcessingModule extends BaseProcessingModule {
  name = 'AX优化处理器';
  version = '1.0.0';
  description = '使用AX框架进行高级内容优化，支持预训练模型和few-shot学习';

  private processorInstance: any = null;
  private hotReloadManager: any = null;
  private pool: Pool | undefined;

  constructor(private config: { apiKey: string; baseURL: string; model: string }, pool?: Pool) {
    super();
    this.pool = pool;
  }
  
  private async initializeProcessor() {
    if (this.processorInstance) {
      return this.processorInstance;
    }
    
    // 详细配置检查
    console.log('🔍 AX处理器配置检查...');
    const configReport = this.validateConfiguration();
    if (!configReport.isValid) {
      const errorMsg = `AX处理器配置错误: ${configReport.errors.join(', ')}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    console.log('✅ AX处理器配置检查通过');
    
    try {
      // 检查核心依赖
      console.log('📦 检查AX处理器依赖...');
      const { AxOptimizedNewsProcessorSimplified } = await import('../services/ax-optimized-news-processor-simplified.js');
      
      this.processorInstance = new AxOptimizedNewsProcessorSimplified({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: this.config.model,
        pool: this.pool
      });
      
      // 尝试加载预训练模型
      console.log('📚 尝试加载AX预训练模型...');
      const loadSuccess = await this.processorInstance.loadOptimizationArtifacts('ax-framework/models/production/latest.json');

      if (!loadSuccess) {
        console.log('⚡ 预训练模型未找到，使用基础数据进行快速训练...');

        try {
          // 导入训练数据并进行快速训练
          const { trainingData } = await import('../../../ax-framework/compiled/ax-training-data.js');

          if (!trainingData || !Array.isArray(trainingData) || trainingData.length === 0) {
            throw new Error('训练数据为空或格式不正确');
          }

          const sampleData = trainingData.slice(0, 3);
          console.log(`📊 使用 ${sampleData.length} 条样本数据进行快速训练...`);

          await this.processorInstance.quickTrain(sampleData);
          console.log('✅ 快速训练完成');
        } catch (trainingError) {
          throw new Error(`快速训练失败: ${trainingError instanceof Error ? trainingError.message : '训练数据加载错误'}`);
        }
      } else {
        console.log('✅ 预训练模型加载成功');

        // 启动热重载监控
        await this.startHotReload();
      }

      return this.processorInstance;
      
    } catch (error) {
      console.error('❌ AX处理器初始化失败:', error);
      
      // 详细错误分类
      if (error instanceof Error) {
        if (error.message.includes('训练数据')) {
          throw new Error(`AX处理器训练数据错误: ${error.message} (请检查 ax-framework/compiled/ax-training-data.js 文件)`);
        } else if (error.message.includes('模型')) {
          throw new Error(`AX处理器模型错误: ${error.message} (请检查 ax-framework/models/production/latest.json 文件)`);
        } else if (error.message.includes('Cannot resolve module')) {
          throw new Error(`AX处理器依赖缺失: ${error.message} (请检查 ax-framework 目录结构)`);
        } else {
          throw new Error(`AX处理器初始化失败: ${error.message}`);
        }
      } else {
        throw new Error('AX处理器初始化失败: 未知错误类型');
      }
    }
  }
  
  private validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // API密钥检查：只拒绝未配置/默认占位符；不再用长度判断真伪
    // （某些代理端点透传 dummy key，长度可以 < 10）
    if (!this.config.apiKey) {
      errors.push('LLM_API_KEY 未配置');
    } else if (this.config.apiKey === 'your_api_key_here') {
      errors.push('LLM_API_KEY 仍为占位符，请设置真实API密钥');
    }
    
    // 端点URL检查
    if (!this.config.baseURL) {
      errors.push('LLM_BASE_URL 未配置');
    } else if (!this.config.baseURL.startsWith('http')) {
      errors.push('LLM_BASE_URL 格式不正确 (必须以http开头)');
    }
    
    // 模型配置检查
    if (!this.config.model) {
      errors.push('LLM_MODEL 未配置');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  async processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem> {
    const startTime = Date.now();
    console.log(`🧠 AX优化处理: ${rawData.title}`);
    
    // 动态读取最新 LLM 配置，若变更则重置处理器实例
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      if (cfg.baseUrl !== this.config.baseURL || cfg.apiKey !== this.config.apiKey || cfg.model !== this.config.model) {
        this.config = { baseURL: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
        this.processorInstance = null;
      }
    } catch (e) {
      // use fallback
    }
    
    try {
      const processor = await this.initializeProcessor();
      
      // 准备输入内容
      const originalContent = `标题: ${rawData.title}\\n内容: ${rawData.content}`;
      
      // 使用AX优化处理器
      const result = await processor.processNewsWithOptimizedProgram(originalContent);
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ AX优化处理完成: "${result.title}" (耗时${processingTime}ms)`);
      
      return {
        id: rawData.id,
        originalTitle: rawData.title,
        optimizedTitle: result.title,
        originalContent: rawData.content,
        processedContent: result.body,
        summary: result.body,
        qualityScore: 0.95, // AX优化的高质量分数
        processingMetadata: {
          processor: this.name,
          model: this.config.model,
          processedAt: new Date().toISOString(),
          processingTime,
          confidence: 0.95
        },
        rawData
      };
      
    } catch (error) {
      console.error('AX优化处理失败:', error);
      throw new Error(`AX优化处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async getHealthStatus(): Promise<ProcessingHealthStatus> {
    const timestamp = new Date().toISOString();
    
    // 动态读取最新 LLM 配置
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      this.config = { baseURL: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
    } catch (e) {
      // use fallback
    }
    
    const configReport = this.validateConfiguration();
    const additionalInfo: Record<string, any> = {
      baseURL: this.config.baseURL,
      model: this.config.model
    };

    if (!configReport.isValid) {
      additionalInfo.configErrors = configReport.errors;
      return {
        healthy: false,
        message: `AX处理器配置错误: ${configReport.errors.join(', ')}`,
        lastChecked: timestamp,
        responseTime: 0,
        modelStatus: 'error',
        queueLength: 0,
        additionalInfo
      };
    }

    const modelPath = `${process.cwd()}/ax-framework/models/production/latest.json`;
    let modelExists = false;
    try {
      modelExists = fs.existsSync(modelPath);
    } catch (error) {
      additionalInfo.modelPathReadError = error instanceof Error ? error.message : error;
    }
    additionalInfo.modelFileExists = modelExists;
    additionalInfo.modelPath = modelPath;

    const endpointCheck = await checkLLMEndpointReachability(this.config.baseURL, this.config.apiKey, LLM_HEALTH_TIMEOUT_MS);
    additionalInfo.statusCode = endpointCheck.status ?? null;
    additionalInfo.timedOut = endpointCheck.timedOut;
    if (endpointCheck.message) {
      additionalInfo.endpointMessage = endpointCheck.message;
    }

    const responseTime = endpointCheck.duration;
    const isHealthy = endpointCheck.reachable;

    let message: string;
    if (isHealthy && !modelExists) {
      message = `AX处理器端点可访问 (HTTP ${endpointCheck.status ?? '未知'})，未检测到模型文件，将按需执行快速训练`;
    } else if (isHealthy) {
      message = `AX处理器就绪 (HTTP ${endpointCheck.status ?? '未知'})`;
    } else if (endpointCheck.timedOut) {
      message = `AX处理器端点在 ${LLM_HEALTH_TIMEOUT_MS}ms 内未响应`;
    } else {
      message = `AX处理器健康检查失败: ${endpointCheck.message ?? '未知原因'}`;
    }

    return {
      healthy: isHealthy,
      message,
      lastChecked: timestamp,
      responseTime,
      modelStatus: isHealthy ? 'ready' : endpointCheck.timedOut ? 'loading' : 'error',
      queueLength: 0,
      additionalInfo
    };
  }
  
  /**
   * 启动热重载监控
   */
  private async startHotReload() {
    try {
      const { ModelHotReloadManager } = await import('../services/model-hot-reload-manager.js');
      const modelPath = `${process.cwd()}/ax-framework/models/production/latest.json`;

      this.hotReloadManager = new ModelHotReloadManager(
        modelPath,
        async (modelData) => {
          // 热重载回调：将新模型加载到处理器中
          return this.processorInstance.loadFromModelData(modelData);
        }
      );

      // 监听热重载事件
      this.hotReloadManager.on('reloaded', (event: any) => {
        console.log(`🔥 模型已热重载: 版本 ${event.version} at ${event.timestamp}`);
      });

      this.hotReloadManager.on('reload-failed', (event: any) => {
        console.error(`❌ 模型热重载失败: ${event.error}`);
      });

      await this.hotReloadManager.start();
      console.log('🔥 AX模型热重载已启用 - 模型更新将自动生效，无需重启服务');
    } catch (error) {
      console.warn('⚠️  热重载功能启动失败，将使用手动重载模式:', error);
    }
  }

  /**
   * 停止热重载
   */
  stopHotReload() {
    if (this.hotReloadManager) {
      this.hotReloadManager.stop();
      this.hotReloadManager = null;
    }
  }

  /**
   * 获取当前加载的模型版本
   */
  getCurrentModelVersion(): string {
    return this.processorInstance?.getCurrentVersion() || 'unknown';
  }

  getSupportedParams(): ProcessingParamDefinition[] {
    return [
      {
        name: 'usePretrainedModel',
        type: 'boolean',
        required: false,
        defaultValue: true,
        description: '是否使用预训练模型'
      },
      {
        name: 'quickTrainSamples',
        type: 'number',
        required: false,
        defaultValue: 3,
        description: '快速训练使用的样本数量',
        validation: (value: number) => value > 0 && value <= 10
      }
    ];
  }
}

/**
 * 处理模块注册表
 */
export class ProcessingRegistry {
  private modules: Map<string, ProcessingModule> = new Map();
  private readonly healthCheckTimeoutMs = Number(process.env.MODULE_HEALTH_TIMEOUT_MS ?? '5000');
  
  constructor() {
    // 注册默认处理模块
    this.register('passthrough', new PassThroughProcessingModule());
    
    // 动态注册LLM处理模块（需要配置）
    this.initializeLLMModules();
  }
  
  /**
   * 初始化LLM处理模块
   */
  private initializeLLMModules(): void {
    try {
      // 直接从项目根目录的.env文件读取LLM配置
      const envPath = process.cwd() + '/.env';
      
      const fallbackCfg = getFallbackLLMConfig();
      let llmConfig = {
        apiKey: fallbackCfg.apiKey,
        baseURL: fallbackCfg.baseUrl,
        model: fallbackCfg.model
      };
      
      // 总是尝试直接读取.env文件来获取最新配置
      try {
        console.log(`📄 尝试读取.env文件: ${envPath}`);
        
        // 检查文件是否存在
        if (!fs.existsSync(envPath)) {
          throw new Error(`文件不存在: ${envPath}`);
        }
        
        const envContent = fs.readFileSync(envPath, 'utf8');
        console.log(`📄 .env文件读取成功，内容长度: ${envContent.length} 字符`);
        
        // 解析.env文件内容
        const envLines = envContent.split('\n');
        const envVars: Record<string, string> = {};
        
        for (const line of envLines) {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith('#')) {
            const equalIndex = trimmedLine.indexOf('=');
            if (equalIndex > 0) {
              const key = trimmedLine.substring(0, equalIndex).trim();
              const value = trimmedLine.substring(equalIndex + 1).trim();
              envVars[key] = value;
            }
          }
        }
        
        // 显示找到的LLM相关配置
        console.log(`🔍 找到的LLM配置:`);
        console.log(`   LLM_BASE_URL: ${envVars.LLM_BASE_URL || '未设置'}`);
        console.log(`   LLM_API_KEY: ${envVars.LLM_API_KEY ? (envVars.LLM_API_KEY === 'your_api_key_here' ? '占位符' : '已设置') : '未设置'}`);
        console.log(`   LLM_MODEL: ${envVars.LLM_MODEL || '未设置'}`);
        
        // 使用.env文件中的配置覆盖默认值
        const fallback = getFallbackLLMConfig();
        llmConfig = {
          apiKey: envVars.LLM_API_KEY || fallback.apiKey,
          baseURL: envVars.LLM_BASE_URL || fallback.baseUrl,
          model: envVars.LLM_MODEL || fallback.model
        };
        
        console.log(`✅ 从.env文件成功读取LLM配置`);
      } catch (envError: any) {
        console.warn(`⚠️ 读取.env文件失败: ${envError.message}`);
        console.warn('   回退使用环境变量配置');
      }
      
      // 验证配置并注册模块
      if (llmConfig.baseURL) {
        console.log(`🔗 检测到自定义LLM端点: ${llmConfig.baseURL}`);
        console.log(`🔑 API密钥状态: ${llmConfig.apiKey === 'your_api_key_here' ? '占位符' : '已配置'}`);
        console.log(`🤖 LLM模型: ${llmConfig.model}`);

        let pool: Pool | undefined;
        try {
          const { getPostgresDatabase } = require('./postgres-database.js');
          pool = getPostgresDatabase().getPool();
        } catch (e) {
          console.warn('⚠️ 获取数据库连接池失败，LLM缓存将不可用:', e instanceof Error ? e.message : e);
        }

        // 注册基础LLM处理模块（带缓存）
        this.register('basic-llm', new BasicLLMProcessingModule(llmConfig, pool));
        
        // 注册AX优化处理模块
        this.register('ax-optimized', new AxOptimizedProcessingModule(llmConfig, pool));
        
        console.log('🤖 LLM处理模块初始化完成（自动读取.env配置）');
      } else {
        console.warn('⚠️  LLM_BASE_URL未配置，跳过LLM处理模块注册');
        console.warn('   请在.env文件中配置 LLM_BASE_URL 和 LLM_API_KEY');
      }
    } catch (error) {
      console.error('❌ LLM处理模块初始化失败:', error);
    }
  }
  
  register(name: string, module: ProcessingModule): void {
    this.modules.set(name, module);
    console.log(`✅ 处理模块已注册: ${name} (${module.name} v${module.version})`);
  }
  
  get(name: string): ProcessingModule | undefined {
    return this.modules.get(name);
  }
  
  getAvailable(): string[] {
    return Array.from(this.modules.keys());
  }

  private createTimeoutStatus(name: string): ProcessingHealthStatus {
    return {
      healthy: false,
      message: `健康检查超时 (${this.healthCheckTimeoutMs}ms) - ${name}`,
      lastChecked: new Date().toISOString(),
      responseTime: this.healthCheckTimeoutMs,
      modelStatus: 'error',
      queueLength: 0
    };
  }

  private createErrorStatus(error: unknown): ProcessingHealthStatus {
    return {
      healthy: false,
      message: `健康检查异常: ${error instanceof Error ? error.message : '未知错误'}`,
      lastChecked: new Date().toISOString(),
      responseTime: 0,
      modelStatus: 'error',
      queueLength: 0
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

  async getModuleStatus(name: string): Promise<ProcessingHealthStatus | null> {
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

  async getAllModulesStatus(): Promise<Record<string, ProcessingHealthStatus | null>> {
    const status: Record<string, ProcessingHealthStatus | null> = {};
    
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
export const processingRegistry = new ProcessingRegistry();
