/**
 * LLM内容处理服务
 * 将RSS原始内容通过LLM进行智能摘要和优化
 */

import OpenAI from 'openai';

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'custom' | 'mock';
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ContentProcessingOptions {
  maxLength?: number;        // 最大字符长度
  style?: 'concise' | 'detailed' | 'casual' | 'formal';
  focus?: 'summary' | 'analysis' | 'highlights';
  targetDevice?: 'eink' | 'mobile' | 'desktop';
}

export interface ProcessedContent {
  title: string;
  summary: string;
  highlights?: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  tags?: string[];
  processedAt: Date;
  model: string;
}

/**
 * LLM内容处理器接口
 */
export interface LLMContentProcessor {
  process(
    originalTitle: string,
    originalContent: string,
    options?: ContentProcessingOptions
  ): Promise<ProcessedContent>;
}

/**
 * OpenAI兼容内容处理器
 */
export class OpenAIContentProcessor implements LLMContentProcessor {
  private client: OpenAI;

  constructor(private config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API Key未配置');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1'
    });
  }

  // 创建使用不同模型的处理器
  withModel(modelName: string): OpenAIContentProcessor {
    return new OpenAIContentProcessor({
      ...this.config,
      model: modelName
    });
  }

  async process(
    originalTitle: string,
    originalContent: string,
    options: ContentProcessingOptions = {}
  ): Promise<ProcessedContent> {
    const {
      maxLength = 120,
      style = 'concise',
      focus = 'summary',
      targetDevice = 'eink'
    } = options;

    const prompt = this.buildPrompt(originalTitle, originalContent, {
      maxLength,
      style,
      focus,
      targetDevice
    });

    try {
      console.log(`🤖 调用LLM: ${this.config.model}`);
      const response = await this.callOpenAI(prompt);
      return this.parseResponse(response, originalTitle);
    } catch (error) {
      console.error('LLM处理失败:', error);
      throw new Error(`LLM内容处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private buildPrompt(
    title: string,
    content: string,
    options: ContentProcessingOptions
  ): string {
    const { maxLength, style, focus, targetDevice } = options;
    
    return `你是一个专业的新闻编辑，需要为水墨屏设备优化新闻内容。

原始标题：${title}
原始内容：${content}

请按照以下要求进行处理：

1. **标题优化**：
   - 保持在10个中文字符以内
   - 突出核心关键词
   - 适合快速浏览

2. **内容摘要**（重点）：
   - 长度限制：${maxLength}个字符以内
   - 风格要求：${style === 'concise' ? '简洁明了' : style === 'detailed' ? '详细准确' : style === 'casual' ? '轻松易读' : '正式专业'}
   - 重点关注：${focus === 'summary' ? '核心事实' : focus === 'analysis' ? '深度分析' : '关键亮点'}
   - 设备特点：${targetDevice === 'eink' ? '水墨屏阅读，需要清晰简洁' : '移动设备，适合碎片时间'}

3. **输出格式**：
请严格按照JSON格式输出：
\`\`\`json
{
  "title": "优化后的标题（≤10字符）",
  "summary": "优化后的摘要（≤${maxLength}字符）",
  "highlights": ["关键点1", "关键点2"],
  "sentiment": "positive/negative/neutral",
  "tags": ["标签1", "标签2"]
}
\`\`\`

注意：内容要准确，不要编造信息，保持客观中性。`;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.config.model || 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: this.config.maxTokens, // 允许undefined，让模型自由发挥
      temperature: this.config.temperature || 0.7
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM返回空响应');
    }

    return content;
  }

  private parseResponse(response: string, originalTitle: string): ProcessedContent {
    try {
      // 尝试解析JSON响应
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          title: parsed.title || originalTitle.substring(0, 10),
          summary: parsed.summary || '处理失败',
          highlights: parsed.highlights || [],
          sentiment: parsed.sentiment || 'neutral',
          tags: parsed.tags || [],
          processedAt: new Date(),
          model: this.config.model || 'unknown'
        };
      }

      // 如果没有JSON格式，尝试直接解析
      const lines = response.split('\n').filter(line => line.trim());
      return {
        title: originalTitle.substring(0, 10),
        summary: lines.join(' ').substring(0, 120),
        processedAt: new Date(),
        model: this.config.model || 'unknown'
      };
    } catch (error) {
      console.warn('解析LLM响应失败，使用备用方案:', error);
      return {
        title: originalTitle.substring(0, 10),
        summary: response.substring(0, 120),
        processedAt: new Date(),
        model: this.config.model || 'unknown'
      };
    }
  }
}

/**
 * Claude内容处理器
 */
export class ClaudeContentProcessor implements LLMContentProcessor {
  constructor(private config: LLMConfig) {}

  async process(
    originalTitle: string,
    originalContent: string,
    options: ContentProcessingOptions = {}
  ): Promise<ProcessedContent> {
    // TODO: 实现Claude API调用
    throw new Error('Claude处理器未实现');
  }
}

/**
 * 模拟LLM处理器（用于测试）
 */
export class MockLLMProcessor implements LLMContentProcessor {
  async process(
    originalTitle: string,
    originalContent: string,
    options: ContentProcessingOptions = {}
  ): Promise<ProcessedContent> {
    const { maxLength = 120 } = options;
    
    // 模拟处理：简单截取和优化
    let processedTitle = originalTitle.substring(0, 10);
    let processedSummary = originalContent
      .replace(/<[^>]*>/g, '')  // 移除HTML标签
      .substring(0, maxLength)  // 截取长度
      .trim();
    
    // 如果截取后不完整，尝试在句号处截断
    const lastPeriod = processedSummary.lastIndexOf('。');
    if (lastPeriod > maxLength * 0.7) {
      processedSummary = processedSummary.substring(0, lastPeriod + 1);
    }
    
    return {
      title: processedTitle,
      summary: processedSummary,
      highlights: ['模拟亮点1', '模拟亮点2'],
      sentiment: 'neutral',
      tags: ['科技', '新闻'],
      processedAt: new Date(),
      model: 'mock-llm'
    };
  }
}

/**
 * LLM内容处理工厂
 */
export class LLMProcessorFactory {
  static create(config: LLMConfig): LLMContentProcessor {
    switch (config.provider) {
      case 'openai':
      case 'custom':  // custom使用OpenAI兼容API
        return new OpenAIContentProcessor(config);
      case 'claude':
        return new ClaudeContentProcessor(config);
      case 'mock':
        return new MockLLMProcessor();
      default:
        throw new Error(`不支持的LLM提供商: ${config.provider}`);
    }
  }
}

/**
 * 带缓存的LLM内容处理服务
 */
export class CachedLLMService {
  private cache = new Map<string, ProcessedContent>();
  public readonly processor: LLMContentProcessor;  // 改为public以便外部访问
  
  constructor(config: LLMConfig) {
    this.processor = LLMProcessorFactory.create(config);
  }
  
  async processContent(
    originalTitle: string,
    originalContent: string,
    options?: ContentProcessingOptions
  ): Promise<ProcessedContent> {
    // 生成缓存键
    const cacheKey = this.generateCacheKey(originalTitle, originalContent, options);
    
    // 检查缓存
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      console.log(`📚 使用缓存的LLM处理结果: ${cached.title}`);
      return cached;
    }
    
    // 处理内容
    console.log(`🤖 开始LLM内容处理: ${originalTitle}`);
    const processed = await this.processor.process(originalTitle, originalContent, options);
    
    // 存储到缓存
    this.cache.set(cacheKey, processed);
    console.log(`✅ LLM内容处理完成: ${processed.title}`);
    
    return processed;
  }
  
  private generateCacheKey(
    title: string,
    content: string,
    options?: ContentProcessingOptions
  ): string {
    const optionsStr = JSON.stringify(options || {});
    const contentHash = this.simpleHash(title + content + optionsStr);
    return `llm_${contentHash}`;
  }
  
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️  LLM缓存已清空');
  }
  
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}