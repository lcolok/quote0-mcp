import { ax, ai, AxBootstrapFewShot } from '@ax-llm/ax';

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
      name: 'openai',
      apiKey: options.apiKey,
      apiURL: options.baseURL,
      config: { model: options.model }
    });
  }

  /**
   * 定义新闻标题生成程序（使用AX的声明式语法）
   */
  private createTitleProgram() {
    return ax(
      'newsContent:string -> optimizedTitle:string',
      '将新闻内容优化为简洁的标题，控制在20字符以内，突出核心信息'
    );
  }

  /**
   * 定义新闻摘要生成程序
   */
  private createSummaryProgram() {
    return ax(
      'newsContent:string -> summary:string',
      '将新闻内容提炼为200字符以内的精炼摘要，适合水墨屏显示'
    );
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
      maxRounds: 3,
      maxExamples: 8,
      metric: titleMetric
    });

    const summaryOptimizer = new AxBootstrapFewShot({
      maxRounds: 3, 
      maxExamples: 8,
      metric: summaryMetric
    });

    try {
      // 5. 运行自动优化（这里会生成大量中间产物！）
      console.log('📚 优化标题生成程序...');
      const optimizedTitleProgram = await titleOptimizer.compile(
        titleProgram,
        titleExamples
      );

      console.log('📚 优化摘要生成程序...');
      const optimizedSummaryProgram = await summaryOptimizer.compile(
        summaryProgram,
        summaryExamples
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
      return {
        success: true,
        titleStats: titleOptimizer.getStats(),
        summaryStats: summaryOptimizer.getStats()
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
      throw new Error('请先运行trainOptimizedPrograms()进行优化训练');
    }

    console.log('🤖 使用AX优化程序处理新闻...');

    // 使用优化后的程序（包含自动学习的few-shot示例和优化的prompts）
    const titleResult = await this.optimizedProgram.title.forward(this.llm, {
      newsContent: newsContent
    });

    const summaryResult = await this.optimizedProgram.summary.forward(this.llm, {
      newsContent: newsContent
    });

    return {
      title: titleResult.optimizedTitle,
      body: summaryResult.summary,
      footer: 'Solidot AX Optimized',
      optimizationUsed: true
    };
  }

  /**
   * 保存优化产物到文件系统
   */
  private async saveOptimizationArtifacts(data: any) {
    const fs = await import('fs/promises');
    const path = `/Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/`;
    
    // 确保目录存在
    try {
      await fs.mkdir(path, { recursive: true });
    } catch {}

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ax-optimized-news-${timestamp}.json`;
    
    // 保存完整的优化状态
    const artifacts = {
      ...data,
      demos: {
        title: data.titleProgram.getDemos(),
        summary: data.summaryProgram.getDemos()
      },
      instructions: {
        title: data.titleProgram.getInstruction(),
        summary: data.summaryProgram.getInstruction()
      },
      modelConfig: {
        title: data.titleProgram.getModelConfig(),
        summary: data.summaryProgram.getModelConfig()
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
    const path = `/Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/${filename}`;
    
    try {
      const data = await fs.readFile(path, 'utf-8');
      const artifacts = JSON.parse(data);
      
      // 重建优化程序
      const titleProgram = this.createTitleProgram();
      const summaryProgram = this.createSummaryProgram();
      
      // 应用保存的优化结果
      titleProgram.setDemos(artifacts.demos.title);
      titleProgram.setInstruction(artifacts.instructions.title);
      summaryProgram.setDemos(artifacts.demos.summary);
      summaryProgram.setInstruction(artifacts.instructions.summary);
      
      this.optimizedProgram = {
        title: titleProgram,
        summary: summaryProgram
      };
      
      console.log(`✅ 已加载优化产物: ${filename}`);
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
}