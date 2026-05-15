/**
 * LLM工作流引擎
 * 支持复杂的多步骤内容处理流程，可移植到任何项目
 */

import { LLMContentProcessor, ProcessedContent } from './llm-content-processor.js';
import { getActiveLLMConfig, getFallbackLLMConfig } from '../core/llm-config.js';
import { getPostgresDatabase } from '../core/postgres-database.js';

export interface WorkflowStep {
  name: string;
  description: string;
  execute(input: any, context: WorkflowContext): Promise<any>;
}

export interface WorkflowContext {
  processor: LLMContentProcessor;
  config: WorkflowConfig;
  stepResults: Map<string, any>;
  metadata: {
    startTime: Date;
    currentStep: string;
    totalSteps: number;
  };
}

export interface WorkflowConfig {
  // 内容约束
  titleMaxLength: number;
  contentMaxLength: number;
  
  // 处理选项
  enableHighlights: boolean;
  highlightMaxCount: number;
  
  // 质量控制
  enableValidation: boolean;
  maxRetries: number;
  
  // 输出格式
  outputFormat: 'structured' | 'plain' | 'enhanced';
}

export interface EnhancedContent extends Omit<ProcessedContent, 'highlights'> {
  // 扩展字段
  highlights: HighlightedWord[];  // 重新定义为HighlightedWord[]类型
  wordCount: {
    title: number;
    summary: number;
  };
  qualityScore: number;
  processingSteps: ProcessingStep[];
}

export interface HighlightedWord {
  word: string;
  startIndex: number;
  endIndex: number;
  importance: 'high' | 'medium' | 'low';
  category: 'keyword' | 'entity' | 'technical' | 'number';
}

export interface ProcessingStep {
  step: string;
  status: 'completed' | 'failed' | 'skipped';
  duration: number;
  input: any;
  output: any;
  error?: string;
}

/**
 * 智能标题生成步骤 - 基于新闻内容重新生成标题
 */
export class TitleOptimizationStep implements WorkflowStep {
  name = 'title-optimization';
  description = '基于新闻内容理解重新生成简洁准确的标题';

  async execute(input: { title: string; content?: string }, context: WorkflowContext): Promise<{ title: string }> {
    const { titleMaxLength } = context.config;
    let model = getFallbackLLMConfig().model;
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      model = cfg.model;
    } catch (e) {
      // use fallback
    }
    
    console.log(`🧠 迭代生成${titleMaxLength}字符标题: ${model}`);
    
    try {
      const processor = (context.processor as any).withModel(model);
      let bestTitle = input.title.substring(0, titleMaxLength); // 备用标题
      
      // 最多迭代5次
      for (let i = 1; i <= 5; i++) {
        console.log(`🔄 第${i}次尝试生成标题`);
        
        const prompt = `为新闻生成恰好${titleMaxLength}个中文字符的标题：

原标题：${input.title}
内容：${input.content || ''}

严格要求恰好${titleMaxLength}个中文字符，语义完整。

直接输出标题，不要JSON格式：`;

        const response = await processor.process(input.title, prompt, {
          style: 'concise',
          focus: 'summary'
        });

        const newTitle = this.extractTitle(response.summary);
        console.log(`🎯 尝试${i}: "${newTitle}" (${newTitle.length}字符)`);
        
        // 如果生成的标题长度正确，直接使用
        if (newTitle.length === titleMaxLength) {
          console.log(`✅ 生成成功！恰好${titleMaxLength}字符`);
          return { title: newTitle };
        }
        
        // 保存最接近目标长度的标题
        if (Math.abs(newTitle.length - titleMaxLength) < Math.abs(bestTitle.length - titleMaxLength)) {
          bestTitle = newTitle;
        }
      }
      
      // 如果5次都没有生成正确长度，使用最佳结果并截断
      console.log(`⏰ 5次尝试完成，使用最佳结果`);
      if (bestTitle.length > titleMaxLength) {
        bestTitle = bestTitle.substring(0, titleMaxLength);
        console.log(`✂️ 截断至${titleMaxLength}字符: "${bestTitle}"`);
      }
      
      console.log(`✨ 最终标题: "${bestTitle}" (${bestTitle.length}字符)`);
      return { title: bestTitle };
      
    } catch (error) {
      console.warn('标题生成失败，使用原标题截断:', error);
      return { title: input.title.substring(0, titleMaxLength) };
    }
  }

  private extractTitle(response: string): string {
    let title = response.trim();
    
    // 首先尝试解析JSON格式的响应
    try {
      // 更严格的JSON匹配
      const jsonMatch = title.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (parsed.title) {
          console.log(`📋 从JSON提取title: "${parsed.title}"`);
          return parsed.title.trim();
        }
      }
    } catch (error) {
      console.log(`⚠️ JSON解析失败，使用原始文本处理:`, error instanceof Error ? error.message : error);
    }
    
    // 如果不是JSON或解析失败，使用原始文本处理
    title = title.replace(/^["']|["']$/g, '');
    title = title.split('\n')[0].trim();
    title = title.replace(/^(标题：|Title：|优化后：|结果：|压缩后：)/, '').trim();
    title = title.replace(/[。！？：；，]$/, '');
    
    console.log(`📝 文本处理后的title: "${title}"`);
    return title;
  }
}

/**
 * 内容摘要步骤
 */
export class ContentSummaryStep implements WorkflowStep {
  name = 'content-summary';
  description = '生成内容摘要';

  async execute(
    input: { title: string; content: string }, 
    context: WorkflowContext
  ): Promise<{ summary: string }> {
    const { contentMaxLength } = context.config;
    
    const prompt = `请为以下新闻生成摘要，要求：
1. 长度严格控制在${contentMaxLength}个中文字符以内
2. 突出核心事实和关键信息
3. 语言简洁明了，适合水墨屏阅读
4. 保持客观中性的语调

标题：${input.title}
内容：${input.content}

请直接输出摘要内容，不要任何额外说明：`;

    // 直接调用LLM获取纯文本响应
    const rawResponse = await this.callLLMDirectly(prompt, context);
    
    let summary = rawResponse.trim();
    
    // 如果summary仍然包含JSON格式，尝试提取纯文本
    const summaryMatch = summary.match(/"summary":\s*"([^"]*?)"/);
    if (summaryMatch && summaryMatch[1].length > 10) {
      summary = summaryMatch[1];
      console.log('📝 从JSON字段提取摘要:', summary);
    } else {
      // 尝试解析完整JSON（备用方案）
      try {
        const jsonMatch = summary.match(/```json\s*([\s\S]*?)\s*```/) || 
                         summary.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
          if (parsed.summary && parsed.summary.length > 10) {
            summary = parsed.summary;
            console.log('📝 从完整JSON提取摘要:', summary);
          }
        }
      } catch (e) {
        console.warn('JSON解析失败，使用字段提取结果或原始响应');
      }
    }
    
    // 确保长度严格控制
    if (summary.length > contentMaxLength) {
      summary = summary.substring(0, contentMaxLength);
      // 尝试在句号处截断
      const lastPeriod = summary.lastIndexOf('。');
      if (lastPeriod > contentMaxLength * 0.8) {
        summary = summary.substring(0, lastPeriod + 1);
      }
    }

    return { summary };
  }

  private async callLLMDirectly(prompt: string, context: WorkflowContext): Promise<string> {
    const client = (context.processor as any).client;
    const config = (context.processor as any).config;
    
    const completion = await client.chat.completions.create({
      model: config.model || 'gpt-5-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: config.temperature || 0.7
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM返回空响应');
    }

    return content;
  }
}

/**
 * 关键词提取步骤
 */
export class KeywordExtractionStep implements WorkflowStep {
  name = 'keyword-extraction';
  description = '提取关键词和重要概念';

  async execute(
    input: { title: string; summary: string },
    context: WorkflowContext
  ): Promise<{ keywords: string[] }> {
    const { highlightMaxCount } = context.config;
    
    const prompt = `请从以下新闻中提取${highlightMaxCount}个最重要的关键词，要求：
1. 选择最具代表性的技术术语、公司名、产品名或重要概念
2. 关键词长度2-6个字符
3. 避免常见词汇（如"发布"、"宣布"等）
4. 按重要性排序

标题：${input.title}
内容：${input.summary}

请按JSON格式输出：
\`\`\`json
{
  "keywords": ["关键词1", "关键词2", "关键词3"]
}
\`\`\``;

    try {
      const response = await context.processor.process(input.title, prompt, {
        maxLength: 200,
        style: 'concise',
        focus: 'analysis'
      });

      console.log(`🔍 关键词提取原始响应: ${response.summary}`);

      // 1. 尝试提取JSON中的keywords数组
      const keywordsMatch = response.summary.match(/"keywords":\s*\[(.*?)\]/);
      if (keywordsMatch) {
        try {
          // 提取引号中的关键词
          const keywordStr = keywordsMatch[1];
          const keywords = keywordStr.match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '')) || [];
          console.log(`📝 从JSON字段提取关键词: ${JSON.stringify(keywords)}`);
          return { keywords: keywords.slice(0, highlightMaxCount) };
        } catch (e) {
          console.warn('关键词JSON字段解析失败');
        }
      }

      // 2. 尝试解析完整JSON
      try {
        const jsonMatch = response.summary.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.keywords && Array.isArray(parsed.keywords)) {
            console.log(`📝 从完整JSON提取关键词: ${JSON.stringify(parsed.keywords)}`);
            return { keywords: parsed.keywords.slice(0, highlightMaxCount) };
          }
        }
      } catch (e) {
        console.warn('关键词完整JSON解析失败');
      }

      // 3. 备用方案：从文本中提取重要词汇，过滤JSON字段名
      const words = response.summary
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 2 && w.length <= 8)
        .filter(w => !['title', 'summary', 'highlights', 'sentiment', 'tags'].includes(w))
        .filter(w => /[\u4e00-\u9fa5]/.test(w)) // 至少包含一个中文字符
        .slice(0, highlightMaxCount);

      console.log(`📝 备用方案提取关键词: ${JSON.stringify(words)}`);
      return { keywords: words };
    } catch (error) {
      console.warn('关键词提取失败，使用备用方案:', error);
      return { keywords: [] };
    }
  }
}

/**
 * 高亮匹配步骤
 */
export class HighlightMatchingStep implements WorkflowStep {
  name = 'highlight-matching';
  description = '匹配文本中的高亮词汇';

  async execute(
    input: { summary: string; keywords: string[] },
    _context: WorkflowContext  // 使用下划线前缀表示故意未使用
  ): Promise<{ highlights: HighlightedWord[] }> {
    const highlights: HighlightedWord[] = [];
    const summary = input.summary;

    for (const keyword of input.keywords) {
      const index = summary.indexOf(keyword);
      if (index !== -1) {
        highlights.push({
          word: keyword,
          startIndex: index,
          endIndex: index + keyword.length,
          importance: 'high',
          category: this.categorizeKeyword(keyword)
        });
      }
    }

    // 按位置排序
    highlights.sort((a, b) => a.startIndex - b.startIndex);

    return { highlights };
  }

  private categorizeKeyword(keyword: string): HighlightedWord['category'] {
    if (/\d/.test(keyword)) return 'number';
    if (keyword.length <= 3) return 'technical';
    if (/[A-Z]/.test(keyword)) return 'entity';
    return 'keyword';
  }
}

/**
 * 质量验证步骤
 */
export class QualityValidationStep implements WorkflowStep {
  name = 'quality-validation';
  description = '验证内容质量和约束';

  async execute(
    input: { title: string; summary: string; highlights: HighlightedWord[] },
    context: WorkflowContext
  ): Promise<{ isValid: boolean; qualityScore: number; issues: string[] }> {
    const issues: string[] = [];
    let score = 100;

    // 检查标题长度
    if (input.title.length > context.config.titleMaxLength) {
      issues.push(`标题超长：${input.title.length} > ${context.config.titleMaxLength}`);
      score -= 20;
    }

    // 检查内容长度
    if (input.summary.length > context.config.contentMaxLength) {
      issues.push(`内容超长：${input.summary.length} > ${context.config.contentMaxLength}`);
      score -= 20;
    }

    // 检查内容完整性
    if (input.summary.length < 20) {
      issues.push('内容过短，信息不足');
      score -= 30;
    }

    // 检查高亮质量
    if (context.config.enableHighlights && input.highlights.length === 0) {
      issues.push('未找到合适的关键词高亮');
      score -= 10;
    }

    const isValid = score >= 60 && issues.length === 0;
    return { isValid, qualityScore: Math.max(0, score), issues };
  }
}

/**
 * LLM工作流引擎
 */
export class LLMWorkflowEngine {
  private steps: Map<string, WorkflowStep> = new Map();
  
  constructor() {
    // 注册默认步骤
    this.registerStep(new TitleOptimizationStep());
    this.registerStep(new ContentSummaryStep());
    this.registerStep(new KeywordExtractionStep());
    this.registerStep(new HighlightMatchingStep());
    this.registerStep(new QualityValidationStep());
  }

  registerStep(step: WorkflowStep): void {
    this.steps.set(step.name, step);
  }

  async executeWorkflow(
    processor: LLMContentProcessor,
    originalTitle: string,
    originalContent: string,
    config: Partial<WorkflowConfig> = {}
  ): Promise<EnhancedContent> {
    const workflowConfig: WorkflowConfig = {
      titleMaxLength: 10,
      contentMaxLength: 140,
      enableHighlights: true,
      highlightMaxCount: 3,
      enableValidation: true,
      maxRetries: 2,
      outputFormat: 'enhanced',
      ...config
    };

    const context: WorkflowContext = {
      processor,
      config: workflowConfig,
      stepResults: new Map(),
      metadata: {
        startTime: new Date(),
        currentStep: '',
        totalSteps: 5
      }
    };

    const processingSteps: ProcessingStep[] = [];
    
    console.log('🚀 启动LLM工作流引擎...');

    try {
      // 步骤1: 标题生成（基于内容理解）
      console.log('🧠 步骤1: 智能标题生成');
      const titleStep = await this.executeStep('title-optimization', 
        { title: originalTitle, content: originalContent }, context);
      context.stepResults.set('title', titleStep);
      processingSteps.push({
        step: 'title-optimization',
        status: 'completed',
        duration: Date.now() - context.metadata.startTime.getTime(),
        input: { title: originalTitle },
        output: titleStep
      });

      // 步骤2: 内容摘要
      console.log('📄 步骤2: 内容摘要');
      const summaryStep = await this.executeStep('content-summary',
        { title: titleStep.title, content: originalContent }, context);
      context.stepResults.set('summary', summaryStep);
      processingSteps.push({
        step: 'content-summary',
        status: 'completed',
        duration: Date.now() - context.metadata.startTime.getTime(),
        input: { title: titleStep.title, content: originalContent },
        output: summaryStep
      });

      // 步骤3: 关键词提取
      console.log('🔍 步骤3: 关键词提取');
      const keywordStep = await this.executeStep('keyword-extraction',
        { title: titleStep.title, summary: summaryStep.summary }, context);
      context.stepResults.set('keywords', keywordStep);
      processingSteps.push({
        step: 'keyword-extraction',
        status: 'completed',
        duration: Date.now() - context.metadata.startTime.getTime(),
        input: { title: titleStep.title, summary: summaryStep.summary },
        output: keywordStep
      });

      // 步骤4: 高亮匹配
      console.log('✨ 步骤4: 高亮匹配');
      const highlightStep = await this.executeStep('highlight-matching',
        { summary: summaryStep.summary, keywords: keywordStep.keywords }, context);
      context.stepResults.set('highlights', highlightStep);
      processingSteps.push({
        step: 'highlight-matching',
        status: 'completed',
        duration: Date.now() - context.metadata.startTime.getTime(),
        input: { summary: summaryStep.summary, keywords: keywordStep.keywords },
        output: highlightStep
      });

      // 步骤5: 质量验证
      console.log('✅ 步骤5: 质量验证');
      const validationStep = await this.executeStep('quality-validation',
        { 
          title: titleStep.title, 
          summary: summaryStep.summary, 
          highlights: highlightStep.highlights 
        }, context);
      context.stepResults.set('validation', validationStep);
      processingSteps.push({
        step: 'quality-validation',
        status: 'completed',
        duration: Date.now() - context.metadata.startTime.getTime(),
        input: { title: titleStep.title, summary: summaryStep.summary, highlights: highlightStep.highlights },
        output: validationStep
      });

      const totalDuration = Date.now() - context.metadata.startTime.getTime();
      console.log(`🎉 工作流完成，耗时: ${totalDuration}ms`);

      // 构建增强内容
      const enhancedContent: EnhancedContent = {
        title: titleStep.title,
        summary: summaryStep.summary,
        highlights: highlightStep.highlights,
        sentiment: 'neutral',
        tags: keywordStep.keywords,
        processedAt: new Date(),
        model: 'workflow-engine',
        wordCount: {
          title: titleStep.title.length,
          summary: summaryStep.summary.length
        },
        qualityScore: validationStep.qualityScore,
        processingSteps
      };

      return enhancedContent;

    } catch (error) {
      console.error('工作流执行失败:', error);
      throw new Error(`LLM工作流失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async executeStep(stepName: string, input: any, context: WorkflowContext): Promise<any> {
    const step = this.steps.get(stepName);
    if (!step) {
      throw new Error(`未找到步骤: ${stepName}`);
    }

    context.metadata.currentStep = stepName;
    return await step.execute(input, context);
  }

  getRegisteredSteps(): string[] {
    return Array.from(this.steps.keys());
  }
}