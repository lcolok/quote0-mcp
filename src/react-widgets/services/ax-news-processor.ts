import { ax, ai } from '@ax-llm/ax';

/**
 * 新闻内容结构
 */
interface NewsContent {
  title: string;
  body: string;
  footer: string;
}

/**
 * 迭代优化结果
 */
interface OptimizationResult {
  content: string;
  length: number;
  iterations: number;
  success: boolean;
}

/**
 * 基于AX框架的新闻内容处理器
 * 支持智能内容生成、长度控制和迭代优化
 */
export class AxNewsProcessor {
  private strongLLM: any;
  private fastLLM: any;

  constructor(options: {
    apiKey: string;
    baseURL: string;
    strongModel: string;
    fastModel: string;
  }) {
    // 使用正确的apiURL参数配置自定义端点
    try {
      this.strongLLM = ai({ 
        name: 'openai',
        apiKey: options.apiKey,
        apiURL: options.baseURL,
        config: {
          model: options.strongModel
        }
      } as any);
      
      this.fastLLM = ai({
        name: 'openai', 
        apiKey: options.apiKey,
        apiURL: options.baseURL,
        config: {
          model: options.fastModel
        }
      } as any);
    } catch (error) {
      console.log('⚠️ AX配置方式1失败，尝试备用方案:', error);
      
      // 备用方案：使用环境变量或其他方式
      this.strongLLM = ai({ 
        name: 'openai',
        apiKey: options.apiKey
      } as any);
      
      this.fastLLM = ai({
        name: 'openai', 
        apiKey: options.apiKey
      } as any);
    }
  }

  /**
   * 主要内容生成器 - 使用强力模型生成结构化内容
   */
  private createContentGenerator() {
    return ax(`
      originalNews:string -> 
      title:string, body:string, footer:string 
      "Generate structured news content from original text"
    `);
  }

  /**
   * 标题优化器 - 迭代优化标题长度
   */
  private createTitleOptimizer() {
    return ax(`
      title:string, targetLength:number, feedback:string -> 
      optimizedTitle:string 
      "Optimize title length based on feedback"
    `);
  }

  /**
   * 正文优化器 - 迭代优化正文长度
   */
  private createBodyOptimizer() {
    return ax(`
      body:string, targetLength:number, feedback:string -> 
      optimizedBody:string 
      "Optimize body length based on feedback"
    `);
  }

  /**
   * 处理完整的新闻内容生成工作流
   */
  async processNews(originalNews: string): Promise<NewsContent> {
    console.log('🚀 开始AX工作流处理新闻内容');

    try {
      // 步骤1: 生成初始的结构化内容
      const contentGenerator = this.createContentGenerator();
      const initialResult = await contentGenerator.forward(this.strongLLM, {
        originalNews: originalNews
      });
      
      const initialContent = {
        title: initialResult.title || '未知标题',
        body: initialResult.body || '无内容',
        footer: initialResult.footer || '来源未知'
      };
      
      console.log('📝 初始内容生成完成:', {
        titleLength: initialContent.title.length,
        bodyLength: initialContent.body.length,
        footerLength: initialContent.footer.length
      });

      // 步骤2: 优化标题长度
      const optimizedTitle = await this.optimizeTitle(initialContent.title, 20, 5);
      
      // 步骤3: 优化正文长度
      const optimizedBody = await this.optimizeBody(initialContent.body, 200, 5);

      const finalContent: NewsContent = {
        title: optimizedTitle.content,
        body: optimizedBody.content,
        footer: initialContent.footer // 注脚一般不需要严格长度控制
      };

      console.log('✅ AX工作流处理完成:', {
        titleLength: finalContent.title.length,
        titleIterations: optimizedTitle.iterations,
        bodyLength: finalContent.body.length,
        bodyIterations: optimizedBody.iterations
      });

      return finalContent;
    } catch (error) {
      console.error('AX工作流处理失败:', error);
      throw error;
    }
  }


  /**
   * 迭代优化标题长度
   */
  private async optimizeTitle(
    initialTitle: string,
    maxLength: number, 
    maxIterations: number
  ): Promise<OptimizationResult> {
    console.log(`🔄 开始标题长度优化 (目标: ≤${maxLength}字符)`);
    
    const titleOptimizer = this.createTitleOptimizer();
    let currentTitle = initialTitle;
    let iterations = 0;

    while (iterations < maxIterations) {
      const currentLength = currentTitle.length;
      console.log(`📏 第${iterations + 1}次迭代: "${currentTitle}" (${currentLength}字符)`);

      // 检查是否满足条件
      if (currentLength <= maxLength && currentLength >= 5) {
        console.log('✅ 标题长度优化成功');
        return {
          content: currentTitle,
          length: currentLength,
          iterations: iterations,
          success: true
        };
      }

      // 生成反馈
      const feedback = this.generateTitleFeedback(currentLength, maxLength);
      console.log(`💬 反馈: ${feedback}`);

      // 使用AX优化器进行迭代
      try {
        const result = await titleOptimizer.forward(this.fastLLM, {
          title: currentTitle,
          targetLength: maxLength,
          feedback: feedback
        });

        currentTitle = result.optimizedTitle.trim();
        iterations++;
      } catch (error) {
        console.error(`❌ 第${iterations + 1}次迭代失败:`, error);
        break;
      }
    }

    // 如果迭代完成仍不满足条件，进行最终处理
    if (currentTitle.length > maxLength) {
      console.log(`⚠️ 达到最大迭代次数，强制截断到${maxLength}字符`);
      currentTitle = currentTitle.substring(0, maxLength);
    }

    return {
      content: currentTitle,
      length: currentTitle.length,
      iterations,
      success: currentTitle.length <= maxLength && currentTitle.length >= 5
    };
  }

  /**
   * 迭代优化正文长度
   */
  private async optimizeBody(
    initialBody: string,
    maxLength: number, 
    maxIterations: number
  ): Promise<OptimizationResult> {
    console.log(`🔄 开始正文长度优化 (目标: ≤${maxLength}字符)`);
    
    const bodyOptimizer = this.createBodyOptimizer();
    let currentBody = initialBody;
    let iterations = 0;

    while (iterations < maxIterations && currentBody.length > maxLength) {
      const currentLength = currentBody.length;
      console.log(`📏 第${iterations + 1}次迭代: 正文长度 ${currentLength}字符`);

      const feedback = this.generateBodyFeedback(currentLength, maxLength);
      console.log(`💬 反馈: ${feedback}`);

      try {
        const result = await bodyOptimizer.forward(this.fastLLM, {
          body: currentBody,
          targetLength: maxLength,
          feedback: feedback
        });

        currentBody = result.optimizedBody.trim();
        iterations++;
      } catch (error) {
        console.error(`❌ 第${iterations + 1}次迭代失败:`, error);
        break;
      }
    }

    // 最终处理
    if (currentBody.length > maxLength) {
      console.log(`⚠️ 达到最大迭代次数，强制截断到${maxLength}字符`);
      currentBody = currentBody.substring(0, maxLength);
    }

    console.log('✅ 正文长度优化完成');
    return {
      content: currentBody,
      length: currentBody.length,
      iterations,
      success: currentBody.length <= maxLength
    };
  }

  /**
   * 生成标题优化反馈
   */
  private generateTitleFeedback(currentLength: number, maxLength: number): string {
    if (currentLength > maxLength) {
      const excess = currentLength - maxLength;
      return `标题过长，当前${currentLength}字符，超出${excess}字符，请精简内容控制在${maxLength}字符以内`;
    } else if (currentLength < 5) {
      const shortage = 5 - currentLength;
      return `标题过短，当前${currentLength}字符，还需增加${shortage}字符以上，请补充重要信息使表达更完整`;
    }
    return '标题长度合适，请保持';
  }

  /**
   * 生成正文优化反馈
   */
  private generateBodyFeedback(currentLength: number, maxLength: number): string {
    if (currentLength > maxLength) {
      const excess = currentLength - maxLength;
      return `正文过长，当前${currentLength}字符，超出${excess}字符，请精简表达控制在${maxLength}字符以内，保留核心信息`;
    }
    return '正文长度合适，请保持';
  }

}