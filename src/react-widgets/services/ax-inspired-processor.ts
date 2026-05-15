/**
 * AX风格的新闻处理器
 * 受AX框架启发，但支持自定义API端点
 * 
 * 核心特性：
 * - 声明式工作流定义
 * - 自动迭代优化  
 * - XML结构化输出
 * - 长度智能控制
 * - 类型安全
 */

import { CachedLLMService } from './llm-content-processor.js';
import { getActiveLLMConfig, getFallbackLLMConfig } from '../core/llm-config.js';
import { getPostgresDatabase } from '../core/postgres-database.js';

/**
 * 工作流签名定义
 */
interface WorkflowSignature {
  input: Record<string, string>;
  output: Record<string, string>;
  description: string;
}

/**
 * 任务定义器 - AX风格的声明式API
 */
export function axTask(signatureString: string): WorkflowTask {
  const signature = parseSignature(signatureString);
  return new WorkflowTask(signature);
}

/**
 * 工作流任务类
 */
export class WorkflowTask {
  constructor(private signature: WorkflowSignature) {}
  
  /**
   * 执行任务 - 类似AX的forward方法
   */
  async forward(
    llmService: CachedLLMService, 
    input: Record<string, any>,
    options: { 
      model?: string;
      maxIterations?: number;
      constraints?: Record<string, any>;
    } = {}
  ): Promise<Record<string, any>> {
    const prompt = this.buildPrompt(input, this.signature);
    
    try {
      // 直接调用OpenAI API，绕过包含JSON格式要求的中间服务
      const response = await this.callOpenAIDirect(prompt, options.model || 'gpt-4o');
      return this.parseResponse(response, this.signature.output);
    } catch (error) {
      console.error('WorkflowTask执行失败:', error);
      throw error;
    }
  }
  
  /**
   * 直接调用OpenAI API，避免格式冲突
   */
  private async callOpenAIDirect(prompt: string, model: string): Promise<string> {
    const { OpenAI } = await import('openai');
    
    let activeApiKey = getFallbackLLMConfig().apiKey;
    let activeBaseURL = getFallbackLLMConfig().baseUrl;
    try {
      const cfg = await getActiveLLMConfig(getPostgresDatabase());
      activeApiKey = cfg.apiKey;
      activeBaseURL = cfg.baseUrl;
    } catch (e) {
      // use fallback
    }
    
    const client = new OpenAI({
      apiKey: activeApiKey,
      baseURL: activeBaseURL
    });
    
    const completion = await client.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.7
    });
    
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM返回空响应');
    }
    
    return content;
  }
  
  private buildPrompt(input: Record<string, any>, signature: WorkflowSignature): string {
    const inputDesc = Object.keys(signature.input)
      .map(key => `${key}: ${signature.input[key]}`)
      .join('\n');
    
    const outputDesc = Object.keys(signature.output)
      .map(key => `${key}: ${signature.output[key]}`)
      .join('\n');
    
    const inputData = Object.keys(signature.input)
      .map(key => `${key}: ${input[key] || ''}`)
      .join('\n');
    
    return `任务：${signature.description}

输入字段：
${inputDesc}

输出字段：
${outputDesc}

当前输入：
${inputData}

重要：必须严格按照以下XML格式输出，不要使用JSON或其他格式：
<result>
${Object.keys(signature.output).map(key => `  <${key}>[生成的${key}内容]</${key}>`).join('\n')}
</result>

示例格式：
<result>
  <title>优化后的标题</title>
  <body>优化后的正文</body>
  <footer>来源信息</footer>
</result>`;
  }
  
  private parseResponse(response: string, outputFields: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {};
    
    console.log('🔍 正在解析LLM响应:', response.substring(0, 200) + '...');
    
    // 优先尝试XML解析
    try {
      const xmlMatch = response.match(/<result>([\s\S]*?)<\/result>/);
      if (xmlMatch) {
        const xmlContent = xmlMatch[1];
        console.log('🔧 提取到的XML内容:', xmlContent);
        
        for (const fieldName of Object.keys(outputFields)) {
          const tagPattern = new RegExp(`<${fieldName}>(.*?)</${fieldName}>`, 's');
          const match = xmlContent.match(tagPattern);
          if (match && match[1].trim()) {
            result[fieldName] = match[1].trim();
            console.log(`✅ 从XML解析${fieldName}: "${result[fieldName]}"`);
          }
        }
        
        if (Object.keys(result).length > 0) {
          console.log('✅ XML解析成功，返回结果');
          return this.ensureFieldsComplete(result, outputFields, response);
        }
      } else {
        console.log('⚠️ 未找到XML格式内容，尝试其他方法');
      }
    } catch (error) {
      console.log('⚠️ XML解析失败:', error);
    }
    
    // 方法2: 按行解析 "字段名: 内容" 格式
    const lines = response.split('\n');
    for (const line of lines) {
      for (const fieldName of Object.keys(outputFields)) {
        const patterns = [
          new RegExp(`^${fieldName}:\\s*(.+)$`, 'i'),
          new RegExp(`^${fieldName}：\\s*(.+)$`, 'i'), // 中文冒号
          new RegExp(`${fieldName}\\s*[：:]\\s*(.+)`, 'i') // 更宽松的匹配
        ];
        
        for (const pattern of patterns) {
          const match = line.trim().match(pattern);
          if (match && match[1].trim()) {
            result[fieldName] = match[1].trim();
            console.log(`✅ 解析到${fieldName}: "${result[fieldName]}"`);
            break;
          }
        }
      }
    }
    
    // 方法2: 如果按行解析失败，尝试整体文本提取
    if (Object.keys(result).length === 0) {
      console.log('🔄 按行解析失败，尝试整体解析');
      
      // 尝试提取包含关键词的段落
      for (const fieldName of Object.keys(outputFields)) {
        if (!result[fieldName]) {
          // 寻找包含字段名的句子或段落
          const sentences = response.split(/[。！？.\n]/);
          for (const sentence of sentences) {
            if (sentence.includes(fieldName) && sentence.trim().length > fieldName.length + 2) {
              result[fieldName] = sentence.trim().substring(0, 100); // 限制长度
              console.log(`🎯 从句子中提取${fieldName}: "${result[fieldName]}"`);
              break;
            }
          }
        }
      }
    }
    
    // 方法3: 最后的回退方案 - 智能分割响应
    if (Object.keys(result).length === 0) {
      console.log('🔄 整体解析失败，使用智能分割');
      
      const cleanResponse = response.replace(/[【】\[\]]/g, '').trim();
      const parts = cleanResponse.split(/[,，\n]/).filter(p => p.trim().length > 0);
      
      const fieldNames = Object.keys(outputFields);
      for (let i = 0; i < Math.min(parts.length, fieldNames.length); i++) {
        result[fieldNames[i]] = parts[i].trim().substring(0, 100);
        console.log(`🔧 智能分割${fieldNames[i]}: "${result[fieldNames[i]]}"`);
      }
    }
    
    // 为缺失的字段提供合理的默认值
    return this.ensureFieldsComplete(result, outputFields, response);
  }
  
  private ensureFieldsComplete(result: Record<string, any>, outputFields: Record<string, string>, originalResponse: string): Record<string, any> {
    for (const fieldName of Object.keys(outputFields)) {
      if (!result[fieldName] || result[fieldName].length < 3) {
        result[fieldName] = this.generateFallbackContent(fieldName, originalResponse);
        console.log(`⚠️ 使用后备内容${fieldName}: "${result[fieldName]}"`);
      }
    }
    return result;
  }
  
  private generateFallbackContent(fieldName: string, originalResponse: string): string {
    // 根据字段名生成合理的后备内容
    switch (fieldName.toLowerCase()) {
      case 'title':
        return '新闻标题';
      case 'body':
        // 尝试从JSON中提取summary字段
        try {
          const jsonMatch = originalResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.summary && typeof parsed.summary === 'string') {
              return parsed.summary.trim().substring(0, 200);
            }
          }
        } catch (error) {
          console.log('⚠️ 从JSON提取summary失败，使用备用方案');
        }
        
        // 备用方案：从响应中提取关键内容，去掉字段名
        const cleanText = originalResponse
          .replace(/[{}"\[\]]/g, '') // 去掉JSON标记
          .replace(/title\s*[:：]\s*/g, '') // 去掉title字段名
          .replace(/summary\s*[:：]\s*/g, '') // 去掉summary字段名
          .replace(/highlights\s*[:：]\s*/g, '') // 去掉highlights字段名
          .trim();
        return cleanText.substring(0, 100) || '新闻内容';
      case 'footer':
        return 'Solidot AX Inspired';
      default:
        return `${fieldName}内容`;
    }
  }
}

/**
 * 解析签名字符串
 */
function parseSignature(signatureString: string): WorkflowSignature {
  // 简单解析格式：input1:type, input2:type -> output1:type, output2:type "description"
  const [inputPart, rest] = signatureString.split('->');
  const [outputPart, description] = rest.split('"');
  
  const input: Record<string, string> = {};
  const output: Record<string, string> = {};
  
  // 解析输入字段
  inputPart.split(',').forEach(field => {
    const [name, type] = field.trim().split(':');
    if (name && type) {
      input[name.trim()] = type.trim();
    }
  });
  
  // 解析输出字段
  outputPart.split(',').forEach(field => {
    const [name, type] = field.trim().split(':');
    if (name && type) {
      output[name.trim()] = type.trim();
    }
  });
  
  return {
    input,
    output,
    description: description ? description.replace(/"/g, '').trim() : ''
  };
}

/**
 * AX风格的新闻处理器
 */
export class AxInspiredNewsProcessor {
  private llmService: CachedLLMService;
  private strongModel: string;
  private fastModel: string;
  
  constructor(options: {
    llmService: CachedLLMService;
    strongModel: string;
    fastModel: string;
  }) {
    this.llmService = options.llmService;
    this.strongModel = options.strongModel;
    this.fastModel = options.fastModel;
  }
  
  /**
   * 主要内容生成任务
   */
  private createContentGenerator() {
    return axTask(`
      originalNews:string -> 
      title:string, body:string, footer:string 
      "Generate structured news content optimized for e-ink display"
    `);
  }
  
  /**
   * 标题优化任务
   */
  private createTitleOptimizer() {
    return axTask(`
      title:string, feedback:string, targetLength:number -> 
      optimizedTitle:string 
      "Optimize title length based on iterative feedback"
    `);
  }
  
  /**
   * 正文优化任务
   */
  private createBodyOptimizer() {
    return axTask(`
      body:string, feedback:string, targetLength:number -> 
      optimizedBody:string 
      "Optimize body content length with smart compression"
    `);
  }
  
  /**
   * 处理完整的新闻内容生成工作流
   */
  async processNews(originalNews: string): Promise<{
    title: string;
    body: string;
    footer: string;
  }> {
    console.log('🚀 开始AX风格工作流处理');
    
    // 步骤1: 生成初始结构化内容
    const contentGenerator = this.createContentGenerator();
    const initialContent = await contentGenerator.forward(this.llmService, {
      originalNews: originalNews
    }, { model: this.strongModel });
    
    console.log('📝 初始内容生成完成:', {
      title: `"${initialContent.title}" (${initialContent.title?.length || 0}字符)`,
      body: `${initialContent.body?.length || 0}字符`,
      footer: `"${initialContent.footer}"`
    });
    
    // 步骤2: 迭代优化标题长度（20字符限制）
    const optimizedTitle = await this.optimizeWithIterations(
      initialContent.title,
      20,
      5,
      this.createTitleOptimizer(),
      (current, target) => this.generateTitleFeedback(current.length, target)
    );
    
    // 步骤3: 迭代优化正文长度（200字符限制）
    const optimizedBody = await this.optimizeWithIterations(
      initialContent.body,
      200,
      5,
      this.createBodyOptimizer(),
      (current, target) => this.generateBodyFeedback(current.length, target)
    );
    
    const result = {
      title: optimizedTitle,
      body: optimizedBody,
      footer: initialContent.footer
    };
    
    console.log('✅ AX风格工作流完成:', {
      titleLength: result.title.length,
      bodyLength: result.body.length,
      footerLength: result.footer.length
    });
    
    return result;
  }
  
  /**
   * 通用迭代优化方法
   */
  private async optimizeWithIterations(
    content: string,
    targetLength: number,
    maxIterations: number,
    optimizer: WorkflowTask,
    feedbackGenerator: (content: string, targetLength: number) => string
  ): Promise<string> {
    let currentContent = content;
    
    for (let i = 0; i < maxIterations; i++) {
      const currentLength = currentContent.length;
      
      // 检查是否满足条件
      if (this.isLengthAcceptable(currentLength, targetLength)) {
        console.log(`✅ 迭代优化成功 (${i}次迭代): "${currentContent}" (${currentLength}字符)`);
        return currentContent;
      }
      
      // 生成反馈并优化
      const feedback = feedbackGenerator(currentContent, targetLength);
      console.log(`🔄 第${i + 1}次迭代优化 (当前${currentLength}字符): ${feedback}`);
      
      try {
        const result = await optimizer.forward(this.llmService, {
          title: currentContent, // 通用字段名，优化器会适配
          body: currentContent,
          feedback: feedback,
          targetLength: targetLength
        }, { model: this.fastModel });
        
        const optimizedContent = result.optimizedTitle || result.optimizedBody || currentContent;
        currentContent = optimizedContent.trim();
        
      } catch (error) {
        console.error(`❌ 第${i + 1}次迭代失败:`, error);
        break;
      }
    }
    
    // 最终处理：强制截断
    if (currentContent.length > targetLength) {
      console.log(`⚠️ 达到最大迭代次数，强制截断到${targetLength}字符`);
      currentContent = currentContent.substring(0, targetLength);
    }
    
    return currentContent;
  }
  
  /**
   * 检查长度是否可接受
   */
  private isLengthAcceptable(currentLength: number, targetLength: number): boolean {
    // 标题：长度应该在5-20字符之间
    // 正文：长度应该不超过目标长度
    if (targetLength <= 20) { // 标题
      return currentLength <= targetLength && currentLength >= 5;
    } else { // 正文
      return currentLength <= targetLength;
    }
  }
  
  /**
   * 生成标题优化反馈
   */
  private generateTitleFeedback(currentLength: number, targetLength: number): string {
    if (currentLength > targetLength) {
      const excess = currentLength - targetLength;
      return `标题过长，当前${currentLength}字符，需要减少${excess}字符。请精简表达，去掉次要信息，控制在${targetLength}字符以内`;
    } else if (currentLength < 5) {
      const shortage = 5 - currentLength;
      return `标题过短，当前${currentLength}字符，需要增加${shortage}字符以上。请补充重要信息使表达更完整`;
    }
    return '标题长度合适';
  }
  
  /**
   * 生成正文优化反馈
   */
  private generateBodyFeedback(currentLength: number, targetLength: number): string {
    if (currentLength > targetLength) {
      const excess = currentLength - targetLength;
      return `正文过长，当前${currentLength}字符，需要减少${excess}字符。请保留核心信息，精简表达，控制在${targetLength}字符以内`;
    }
    return '正文长度合适';
  }
}