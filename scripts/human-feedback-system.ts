#!/usr/bin/env tsx

/**
 * 人类反馈系统 - Human-in-the-Loop for AX Training
 * 允许人类专家提供反馈来持续改进AI模型质量
 */

import * as readline from 'readline';

interface HumanFeedback {
  taskId: string;
  timestamp: string;
  input: {
    originalNews: string;
    category: string;
  };
  aiOutput: {
    title: string;
    summary: string;
    processingTime: number;
  };
  humanFeedback: {
    // 整体评分
    overallScore: number; // 1-5分
    
    // 标题评价
    titleFeedback: {
      score: number; // 1-5分
      lengthAppropriate: boolean;
      informationComplete: boolean;
      readabilityGood: boolean;
      suggestions?: string;
      improvedVersion?: string; // 人类改进版本
    };
    
    // 摘要评价
    summaryFeedback: {
      score: number; // 1-5分
      lengthAppropriate: boolean;
      accuracyGood: boolean;
      completenessGood: boolean;
      suggestions?: string;
      improvedVersion?: string; // 人类改进版本
    };
    
    // 专家标注
    expertAnnotations?: {
      keyEntities: string[]; // 关键实体
      coreEvents: string[]; // 核心事件
      importance: 'high' | 'medium' | 'low';
      difficulty: 'easy' | 'medium' | 'hard';
    };
    
    // 自由文本反馈
    comments?: string;
  };
  reviewer: {
    name: string;
    expertise: string; // 专业领域
    experience: number; // 经验年数
  };
}

class HumanFeedbackCollector {
  private feedbackPath = '/Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/human-feedback/';
  
  constructor() {
    this.ensureDirectoryExists();
  }
  
  private async ensureDirectoryExists() {
    const fs = await import('fs/promises');
    await fs.mkdir(this.feedbackPath, { recursive: true });
  }

  /**
   * 交互式收集人类反馈
   */
  async collectInteractiveFeedback(
    originalNews: string,
    aiTitle: string,
    aiSummary: string
  ): Promise<HumanFeedback> {
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const ask = (question: string): Promise<string> => {
      return new Promise(resolve => rl.question(question, resolve));
    };

    console.log('\n🎯 AX模型输出质量评估');
    console.log('========================');
    console.log(`📰 原始新闻: ${originalNews.substring(0, 100)}...`);
    console.log(`🏷️  AI生成标题: "${aiTitle}" (${aiTitle.length}字符)`);
    console.log(`📝 AI生成摘要: "${aiSummary}" (${aiSummary.length}字符)`);
    console.log('');

    // 收集基础信息
    const reviewerName = await ask('👤 请输入您的姓名: ');
    const reviewerExpertise = await ask('🎓 您的专业领域 (如:新闻学/AI/技术): ');
    const reviewerExperience = parseInt(await ask('📅 相关工作经验 (年): ')) || 0;

    // 整体评分
    const overallScore = parseInt(await ask('\n⭐ 整体质量评分 (1-5分, 5分最高): ')) || 3;

    // 标题评价
    console.log('\n📋 标题评价:');
    const titleScore = parseInt(await ask('📊 标题质量评分 (1-5): ')) || 3;
    const titleLengthOk = (await ask('📏 标题长度合适? (y/n): ')) === 'y';
    const titleInfoComplete = (await ask('🎯 信息完整度好? (y/n): ')) === 'y';
    const titleReadable = (await ask('👁️  可读性好? (y/n): ')) === 'y';
    const titleSuggestions = await ask('💡 改进建议 (可选): ');
    const titleImproved = await ask('✏️  您的改进版本 (可选): ');

    // 摘要评价
    console.log('\n📄 摘要评价:');
    const summaryScore = parseInt(await ask('📊 摘要质量评分 (1-5): ')) || 3;
    const summaryLengthOk = (await ask('📏 摘要长度合适? (y/n): ')) === 'y';
    const summaryAccurate = (await ask('🎯 准确性好? (y/n): ')) === 'y';
    const summaryComplete = (await ask('📋 完整性好? (y/n): ')) === 'y';
    const summarySuggestions = await ask('💡 改进建议 (可选): ');
    const summaryImproved = await ask('✏️  您的改进版本 (可选): ');

    // 专家标注
    console.log('\n🔬 专家标注 (可选):');
    const keyEntitiesStr = await ask('🏷️  关键实体 (用逗号分隔): ');
    const coreEventsStr = await ask('📅 核心事件 (用逗号分隔): ');
    const importance = await ask('⚠️  重要程度 (high/medium/low): ') as 'high' | 'medium' | 'low' || 'medium';
    const difficulty = await ask('🎚️  处理难度 (easy/medium/hard): ') as 'easy' | 'medium' | 'hard' || 'medium';

    // 自由反馈
    const comments = await ask('\n💬 其他意见建议: ');

    rl.close();

    const feedback: HumanFeedback = {
      taskId: `task_${Date.now()}`,
      timestamp: new Date().toISOString(),
      input: {
        originalNews,
        category: 'technology' // 可以动态检测
      },
      aiOutput: {
        title: aiTitle,
        summary: aiSummary,
        processingTime: 0 // 可以从日志获取
      },
      humanFeedback: {
        overallScore,
        titleFeedback: {
          score: titleScore,
          lengthAppropriate: titleLengthOk,
          informationComplete: titleInfoComplete,
          readabilityGood: titleReadable,
          suggestions: titleSuggestions || undefined,
          improvedVersion: titleImproved || undefined
        },
        summaryFeedback: {
          score: summaryScore,
          lengthAppropriate: summaryLengthOk,
          accuracyGood: summaryAccurate,
          completenessGood: summaryComplete,
          suggestions: summarySuggestions || undefined,
          improvedVersion: summaryImproved || undefined
        },
        expertAnnotations: {
          keyEntities: keyEntitiesStr ? keyEntitiesStr.split(',').map(s => s.trim()) : [],
          coreEvents: coreEventsStr ? coreEventsStr.split(',').map(s => s.trim()) : [],
          importance,
          difficulty
        },
        comments: comments || undefined
      },
      reviewer: {
        name: reviewerName,
        expertise: reviewerExpertise,
        experience: reviewerExperience
      }
    };

    return feedback;
  }

  /**
   * 保存人类反馈
   */
  async saveFeedback(feedback: HumanFeedback) {
    const fs = await import('fs/promises');
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `${this.feedbackPath}feedback-${date}.jsonl`;
    
    await fs.appendFile(filename, JSON.stringify(feedback) + '\n');
    
    console.log('\n✅ 反馈已保存!');
    console.log(`📁 文件位置: ${filename}`);
  }

  /**
   * 分析人类反馈数据
   */
  async analyzeFeedback(days: number = 30): Promise<{
    totalFeedbacks: number;
    averageScores: {
      overall: number;
      title: number;
      summary: number;
    };
    commonIssues: {
      titleIssues: string[];
      summaryIssues: string[];
    };
    topSuggestions: string[];
    qualityTrend: number[];
  }> {
    const fs = await import('fs/promises');
    
    let allFeedbacks: HumanFeedback[] = [];
    
    // 读取指定天数的反馈数据
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const filename = `${this.feedbackPath}feedback-${dateStr}.jsonl`;
      
      try {
        const content = await fs.readFile(filename, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);
        const dayFeedbacks = lines.map(line => JSON.parse(line) as HumanFeedback);
        allFeedbacks.push(...dayFeedbacks);
      } catch (error) {
        // 文件不存在时忽略
      }
    }

    if (allFeedbacks.length === 0) {
      return {
        totalFeedbacks: 0,
        averageScores: { overall: 0, title: 0, summary: 0 },
        commonIssues: { titleIssues: [], summaryIssues: [] },
        topSuggestions: [],
        qualityTrend: []
      };
    }

    // 计算平均分数
    const averageScores = {
      overall: allFeedbacks.reduce((sum, f) => sum + f.humanFeedback.overallScore, 0) / allFeedbacks.length,
      title: allFeedbacks.reduce((sum, f) => sum + f.humanFeedback.titleFeedback.score, 0) / allFeedbacks.length,
      summary: allFeedbacks.reduce((sum, f) => sum + f.humanFeedback.summaryFeedback.score, 0) / allFeedbacks.length
    };

    // 分析常见问题
    const titleIssues: string[] = [];
    const summaryIssues: string[] = [];
    const suggestions: string[] = [];

    allFeedbacks.forEach(feedback => {
      const { titleFeedback, summaryFeedback } = feedback.humanFeedback;
      
      if (!titleFeedback.lengthAppropriate) titleIssues.push('长度不合适');
      if (!titleFeedback.informationComplete) titleIssues.push('信息不完整');
      if (!titleFeedback.readabilityGood) titleIssues.push('可读性差');
      
      if (!summaryFeedback.lengthAppropriate) summaryIssues.push('长度不合适');
      if (!summaryFeedback.accuracyGood) summaryIssues.push('准确性不足');
      if (!summaryFeedback.completenessGood) summaryIssues.push('完整性不足');
      
      if (titleFeedback.suggestions) suggestions.push(titleFeedback.suggestions);
      if (summaryFeedback.suggestions) suggestions.push(summaryFeedback.suggestions);
    });

    return {
      totalFeedbacks: allFeedbacks.length,
      averageScores,
      commonIssues: {
        titleIssues: [...new Set(titleIssues)],
        summaryIssues: [...new Set(summaryIssues)]
      },
      topSuggestions: [...new Set(suggestions)],
      qualityTrend: allFeedbacks.map(f => f.humanFeedback.overallScore)
    };
  }

  /**
   * 基于人类反馈生成新的训练数据
   */
  async generateTrainingDataFromFeedback(): Promise<Array<{
    newsContent: string;
    expectedTitle: string;
    expectedSummary: string;
    quality: number;
  }>> {
    const fs = await import('fs/promises');
    const feedbacks: HumanFeedback[] = [];
    
    // 读取所有反馈文件
    try {
      const files = await fs.readdir(this.feedbackPath);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const content = await fs.readFile(`${this.feedbackPath}${file}`, 'utf-8');
          const lines = content.trim().split('\n').filter(line => line);
          const fileFeedbacks = lines.map(line => JSON.parse(line) as HumanFeedback);
          feedbacks.push(...fileFeedbacks);
        }
      }
    } catch (error) {
      console.warn('读取反馈文件失败:', error);
      return [];
    }

    // 转换为训练数据
    const trainingData = feedbacks
      .filter(f => f.humanFeedback.overallScore >= 4) // 只使用高质量反馈
      .map(feedback => ({
        newsContent: feedback.input.originalNews,
        expectedTitle: feedback.humanFeedback.titleFeedback.improvedVersion || feedback.aiOutput.title,
        expectedSummary: feedback.humanFeedback.summaryFeedback.improvedVersion || feedback.aiOutput.summary,
        quality: feedback.humanFeedback.overallScore
      }))
      .sort((a, b) => b.quality - a.quality); // 按质量排序

    console.log(`🎓 从${feedbacks.length}条反馈中生成了${trainingData.length}条高质量训练数据`);
    
    return trainingData;
  }
}

// 演示如何使用人类反馈系统
async function demonstrateHumanFeedback() {
  const feedbackCollector = new HumanFeedbackCollector();
  
  console.log('👋 欢迎使用AX人类反馈系统!');
  console.log('这个系统帮助我们收集专家反馈来持续改进AI模型质量');
  
  // 模拟一个AI输出结果
  const mockNews = 'SpaceX成功发射最新一批Starlink卫星，本次任务搭载60颗卫星，使在轨卫星总数达到5000颗。马斯克表示，Starlink网络现已覆盖全球99%的人口，下载速度可达1Gbps。';
  const mockTitle = 'SpaceX发射Starlink卫星达5000颗';
  const mockSummary = 'SpaceX发射60颗Starlink卫星，总数达5000颗，网络覆盖全球99%人口，速度达1Gbps。';
  
  try {
    // 收集反馈
    const feedback = await feedbackCollector.collectInteractiveFeedback(
      mockNews,
      mockTitle, 
      mockSummary
    );
    
    // 保存反馈
    await feedbackCollector.saveFeedback(feedback);
    
    // 分析反馈
    console.log('\n📊 反馈分析结果:');
    const analysis = await feedbackCollector.analyzeFeedback(7);
    console.log(`📈 7天内收到 ${analysis.totalFeedbacks} 条反馈`);
    console.log(`📊 平均分数: 整体${analysis.averageScores.overall.toFixed(1)}, 标题${analysis.averageScores.title.toFixed(1)}, 摘要${analysis.averageScores.summary.toFixed(1)}`);
    
    // 生成训练数据
    const trainingData = await feedbackCollector.generateTrainingDataFromFeedback();
    console.log(`🎓 生成了 ${trainingData.length} 条高质量训练数据`);
    
    console.log('\n🎉 反馈收集完成! 这些数据将用于改进AI模型质量。');
    
  } catch (error) {
    console.error('❌ 反馈收集失败:', error);
  }
}

// 如果直接运行此脚本，则启动演示
if (require.main === module) {
  demonstrateHumanFeedback();
}

export { HumanFeedbackCollector, HumanFeedback };