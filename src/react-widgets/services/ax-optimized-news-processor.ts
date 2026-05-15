import { ax, ai, AxBootstrapFewShot } from '@ax-llm/ax';
import { getActiveLLMConfig, getFallbackLLMConfig } from '../core/llm-config.js';
import { getPostgresDatabase } from '../core/postgres-database.js';

/**
 * 启用AX完整优化功能的新闻处理器
 * 包含自动学习、few-shot优化、中间产物生成
 */
export class AxOptimizedNewsProcessor {
  private llm: any;
  private optimizedProgram: any = null;
  private optimizationHistory: any[] = [];

  constructor(options: {
    apiKey: string;
    baseURL: string;
    model: string;
  }) {
    this.llm = ai({
      name: 'openai' as const,
      apiKey: options.apiKey,
      apiURL: options.baseURL,
      config: { model: options.model as any } // 绕过严格的模型类型检查
    });
  }

  /**
   * 定义新闻标题生成程序（使用AX的声明式语法）
   */
  private createTitleProgram() {
    return ax('newsContent:string -> optimizedTitle:string', {
      instruction: '将新闻内容优化为简洁的标题，控制在20字符以内，突出核心信息'
    });
  }

  /**
   * 定义新闻摘要生成程序
   */
  private createSummaryProgram() {
    return ax('newsContent:string -> summary:string', {
      instruction: '将新闻内容提炼为200字符以内的精炼摘要，适合水墨屏显示'
    });
  }

  /**
   * 启动自动优化训练（这是AX的核心价值！）
   */
  async trainOptimizedPrograms(trainingData: Array<{
    newsContent: string;
    expectedTitle: string;
    expectedSummary: string;
  }>) {
    console.log('🚀 启动AX自动优化训练...');
    
    // 1. 创建程序
    const titleProgram = this.createTitleProgram();
    const summaryProgram = this.createSummaryProgram();

    // 2. 准备训练样本
    const titleExamples = trainingData.map(item => ({
      newsContent: item.newsContent,
      optimizedTitle: item.expectedTitle
    }));

    const summaryExamples = trainingData.map(item => ({
      newsContent: item.newsContent,
      summary: item.expectedSummary
    }));

    // 3. 定义评价指标
    const titleMetric = (prediction: any, expected: any) => {
      const lengthScore = prediction.optimizedTitle.length <= 20 ? 1 : 0;
      const qualityScore = this.calculateTitleQuality(prediction.optimizedTitle, expected.optimizedTitle);
      return (lengthScore + qualityScore) / 2;
    };

    const summaryMetric = (prediction: any, expected: any) => {
      const lengthScore = prediction.summary.length <= 200 ? 1 : 0;
      const qualityScore = this.calculateSummaryQuality(prediction.summary, expected.summary);
      return (lengthScore + qualityScore) / 2;
    };

    // 4. 创建优化器（这里使用BootstrapFewShot自动发现最佳示例）
    const titleOptimizer = new AxBootstrapFewShot({
      options: {
        rounds: 3,
        examples: 8
      }
    });

    const summaryOptimizer = new AxBootstrapFewShot({
      options: {
        rounds: 3,
        examples: 8
      }
    });

    try {
      // 5. 运行自动优化（这里会生成大量中间产物！）
      console.log('📚 优化标题生成程序...');
      const optimizedTitleProgram = await titleOptimizer.compile(
        this.llm,
        titleProgram,
        titleExamples,
        titleMetric
      );

      console.log('📚 优化摘要生成程序...');
      const optimizedSummaryProgram = await summaryOptimizer.compile(
        this.llm,
        summaryProgram,
        summaryExamples,
        summaryMetric
      );

      // 6. 保存优化结果（中间产物）
      await this.saveOptimizationArtifacts({
        titleProgram: optimizedTitleProgram,
        summaryProgram: optimizedSummaryProgram,
        timestamp: new Date().toISOString()
      });

      this.optimizedProgram = {
        title: optimizedTitleProgram,
        summary: optimizedSummaryProgram
      };

      console.log('✅ AX自动优化训练完成！');
      // 获取优化统计信息
      const titleStats = this.getOptimizerStats(titleOptimizer);
      const summaryStats = this.getOptimizerStats(summaryOptimizer);

      console.log(`📊 优化统计:`, { titleStats, summaryStats });

      return {
        success: true,
        titleStats,
        summaryStats
      };

    } catch (error) {
      console.error('❌ AX优化训练失败:', error);
      throw error;
    }
  }

  /**
   * 使用优化后的程序处理新闻
   */
  async processNewsWithOptimizedProgram(newsContent: string) {
    if (!this.optimizedProgram) {
      throw new Error('请先加载预训练模型或运行训练');
    }

    console.log('🤖 使用AX优化程序处理新闻...');

    // 使用预训练模型的优化指令和示例
    const titleProgram = this.optimizedProgram.title;
    const summaryProgram = this.optimizedProgram.summary;

    // 构建优化的标题生成提示
    const titlePrompt = this.buildOptimizedPrompt(
      titleProgram.instruction,
      titleProgram.demos.slice(0, 3), // 使用前3个最佳示例
      newsContent,
      'title'
    );

    // 构建优化的摘要生成提示  
    const summaryPrompt = this.buildOptimizedPrompt(
      summaryProgram.instruction,
      summaryProgram.demos.slice(0, 2), // 使用前2个最佳示例
      newsContent,
      'summary'
    );

    try {
      // 动态读取最新 LLM 配置
      let activeApiKey = getFallbackLLMConfig().apiKey;
      let activeBaseURL = getFallbackLLMConfig().baseUrl;
      let activeModel = getFallbackLLMConfig().model;
      try {
        const cfg = await getActiveLLMConfig(getPostgresDatabase());
        activeApiKey = cfg.apiKey;
        activeBaseURL = cfg.baseUrl;
        activeModel = cfg.model;
      } catch (e) {
        // use fallback
      }

      // 使用OpenAI API直接调用（避免AX框架复杂性）
      const { OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: activeApiKey,
        baseURL: activeBaseURL
      });

      console.log('📝 生成优化标题...');
      const titleResponse = await client.chat.completions.create({
        model: activeModel,
        messages: [{ role: 'user', content: titlePrompt }],
        ...titleProgram.modelConfig
      });

      console.log('📝 生成优化摘要...');
      const summaryResponse = await client.chat.completions.create({
        model: activeModel,
        messages: [{ role: 'user', content: summaryPrompt }],
        ...summaryProgram.modelConfig
      });

      const title = titleResponse.choices[0]?.message?.content?.trim() || '无标题';
      const body = summaryResponse.choices[0]?.message?.content?.trim() || '无内容';

      console.log(`✅ 优化完成: 标题"${title}" (${title.length}字符), 摘要${body.length}字符`);

      return {
        title: title,
        body: body,
        footer: 'Solidot AX Optimized',
        optimizationUsed: true
      };
    } catch (error) {
      console.error('❌ 优化处理失败:', error);
      throw error;
    }
  }

  /**
   * 保存优化产物到文件系统
   */
  private async saveOptimizationArtifacts(data: any) {
    const fs = await import('fs/promises');
    const path = `${process.cwd()}/ax-framework/models/`;
    
    // 确保目录存在
    try {
      await fs.mkdir(path, { recursive: true });
    } catch {}

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ax-optimized-news-${timestamp}.json`;
    
    // 保存完整的优化状态
    const artifacts = {
      timestamp: data.timestamp,
      version: '1.0.0',
      programs: {
        titleProgram: this.extractProgramData(data.titleProgram),
        summaryProgram: this.extractProgramData(data.summaryProgram)
      },
      metadata: {
        trainedAt: new Date().toISOString(),
        framework: 'ax-llm',
        optimizationType: 'BootstrapFewShot'
      }
    };

    await fs.writeFile(
      path + filename,
      JSON.stringify(artifacts, null, 2)
    );

    console.log(`💾 优化产物已保存: ${filename}`);
    return filename;
  }

  /**
   * 从文件加载优化产物
   */
  async loadOptimizationArtifacts(filename: string) {
    const fs = await import('fs/promises');
    const path = `${process.cwd()}/${filename}`;
    
    try {
      const data = await fs.readFile(path, 'utf-8');
      const artifacts = JSON.parse(data);
      
      // 直接使用预训练的优化配置，不依赖复杂的AX重建逻辑
      this.optimizedProgram = {
        title: artifacts.programs.titleProgram,
        summary: artifacts.programs.summaryProgram,
        metadata: artifacts.metadata
      };
      
      console.log(`✅ 已加载优化产物: ${filename}`);
      console.log(`📊 模型性能: 标题${this.optimizedProgram.title.stats.accuracy}, 摘要${this.optimizedProgram.summary.stats.accuracy}`);
      return true;
    } catch (error) {
      console.error(`❌ 加载优化产物失败: ${error}`);
      return false;
    }
  }

  /**
   * 计算标题质量分数（简化版）
   */
  private calculateTitleQuality(generated: string, expected: string): number {
    // 简化的质量评估 - 可以使用更复杂的语义相似度算法
    const lengthPenalty = Math.abs(generated.length - expected.length) / 20;
    return Math.max(0, 1 - lengthPenalty);
  }

  /**
   * 计算摘要质量分数（简化版）
   */
  private calculateSummaryQuality(generated: string, expected: string): number {
    // 简化的质量评估 - 实际应用中可以使用BLEU、ROUGE等指标
    const lengthPenalty = Math.abs(generated.length - expected.length) / 200;
    return Math.max(0, 1 - lengthPenalty);
  }

  /**
   * 获取优化器统计信息
   */
  private getOptimizerStats(optimizer: any) {
    try {
      // AX框架的优化器可能有不同的统计信息接口
      return {
        rounds: optimizer.rounds || 3,
        examples: optimizer.examples?.length || 0,
        finalScore: optimizer.finalScore || 0,
        improvement: optimizer.improvement || 0
      };
    } catch (error) {
      console.warn('获取优化器统计信息失败:', error);
      return {
        rounds: 3,
        examples: 0,
        finalScore: 0,
        improvement: 0
      };
    }
  }

  /**
   * 提取程序数据用于序列化
   */
  private extractProgramData(program: any) {
    try {
      return {
        instruction: program.instruction || program.description || '默认指令',
        demos: program.demos || [],
        modelConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 512
        },
        stats: {
          trained: true,
          version: '1.0.0'
        }
      };
    } catch (error) {
      console.warn('提取程序数据失败:', error);
      return {
        instruction: '默认指令',
        demos: [],
        modelConfig: { temperature: 0.7, topP: 0.9, maxTokens: 512 },
        stats: { trained: false, version: '1.0.0' }
      };
    }
  }

  /**
   * 构建优化的few-shot提示词
   */
  private buildOptimizedPrompt(
    instruction: string,
    demos: any[],
    newsContent: string,
    type: 'title' | 'summary'
  ): string {
    let prompt = `${instruction}\n\n`;
    
    // 添加few-shot示例
    if (demos && demos.length > 0) {
      prompt += '以下是一些优秀的示例：\n\n';
      
      demos.forEach((demo, index) => {
        const input = demo.input.newsContent || demo.input;
        const output = type === 'title' ? 
          (demo.output.optimizedTitle || demo.output) : 
          (demo.output.summary || demo.output);
          
        prompt += `示例${index + 1}:\n`;
        prompt += `输入: ${input}\n`;
        prompt += `输出: ${output}\n\n`;
      });
    }
    
    // 添加当前任务
    prompt += '现在请处理以下新闻内容：\n\n';
    prompt += `输入: ${newsContent}\n`;
    prompt += '输出: ';
    
    return prompt;
  }
}