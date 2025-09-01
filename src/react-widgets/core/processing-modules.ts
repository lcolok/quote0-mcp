/**
 * LLM处理模块抽象基类和具体实现
 */

import fs from 'fs';
import { 
  ProcessingModule, 
  RawDataItem, 
  ProcessedDataItem, 
  ProcessingParams, 
  ProcessingParamDefinition, 
  ProcessingHealthStatus 
} from './modular-architecture.js';

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
  
  constructor(config: { apiKey: string; baseURL: string; model: string }) {
    super();
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
  }
  
  async processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem> {
    const startTime = Date.now();
    console.log(`🤖 基础LLM处理: ${rawData.title}`);
    
    try {
      const { OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL
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
      
      const titleResponse = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: titlePrompt }],
        temperature,
        max_tokens: 100
      });
      
      const optimizedTitle = titleResponse.choices[0]?.message?.content?.trim() || rawData.title;
      
      // 优化内容摘要
      const contentPrompt = `请将以下新闻内容提炼为精炼摘要，严格控制在${maxContentLength}个字符以内：

原内容: ${rawData.content}

要求:
1. 保留核心信息和关键细节
2. 字符数不超过${maxContentLength}个
3. 语言简洁流畅，适合快速阅读
4. 只返回摘要内容，不要其他内容

摘要:`;
      
      const contentResponse = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: contentPrompt }],
        temperature,
        max_tokens: 300
      });
      
      const processedContent = contentResponse.choices[0]?.message?.content?.trim() || rawData.content;
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
          model: this.model,
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
  
  constructor(private config: { apiKey: string; baseURL: string; model: string }) {
    super();
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
        model: this.config.model
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
    
    // API密钥检查
    if (!this.config.apiKey) {
      errors.push('LLM_API_KEY 未配置');
    } else if (this.config.apiKey === 'your_api_key_here') {
      errors.push('LLM_API_KEY 仍为占位符，请设置真实API密钥');
    } else if (this.config.apiKey.length < 10) {
      errors.push('LLM_API_KEY 格式可能不正确 (长度过短)');
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
      
      let llmConfig = {
        apiKey: process.env.LLM_API_KEY || '',
        baseURL: process.env.LLM_BASE_URL || '',
        model: process.env.LLM_MODEL || 'gpt-4o'
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
        llmConfig = {
          apiKey: envVars.LLM_API_KEY || llmConfig.apiKey,
          baseURL: envVars.LLM_BASE_URL || llmConfig.baseURL,
          model: envVars.LLM_MODEL || llmConfig.model
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
        
        // 注册基础LLM处理模块
        this.register('basic-llm', new BasicLLMProcessingModule(llmConfig));
        
        // 注册AX优化处理模块
        this.register('ax-optimized', new AxOptimizedProcessingModule(llmConfig));
        
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
  
  async getModuleStatus(name: string): Promise<ProcessingHealthStatus | null> {
    const module = this.modules.get(name);
    if (!module) {
      return null;
    }
    
    return await module.getHealthStatus();
  }
  
  async getAllModulesStatus(): Promise<Record<string, ProcessingHealthStatus | null>> {
    const status: Record<string, ProcessingHealthStatus | null> = {};
    
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
export const processingRegistry = new ProcessingRegistry();