#!/usr/bin/env tsx

import fs from 'fs/promises';
import path from 'path';
import { HumanFeedback } from '../src/feedback-ui/src/types/feedback';

interface WebFeedbackIntegration {
  checkForNewFeedback(): Promise<HumanFeedback[]>;
  processWebFeedback(feedbacks: HumanFeedback[]): Promise<void>;
  exportToTrainingFormat(feedbacks: HumanFeedback[]): Promise<string>;
}

class AXWebFeedbackIntegration implements WebFeedbackIntegration {
  private feedbackStorePath = path.join(process.cwd(), 'web-feedback-data');
  private trainingDataPath = path.join(process.cwd(), 'ax-optimization-artifacts', 'human-feedback');

  constructor() {
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.feedbackStorePath, { recursive: true });
    await fs.mkdir(this.trainingDataPath, { recursive: true });
  }

  async checkForNewFeedback(): Promise<HumanFeedback[]> {
    try {
      // 模拟从Web UI的localStorage或API获取反馈
      // 在实际部署中，这里会连接到Web应用的后端API
      const feedbackFiles = await fs.readdir(this.feedbackStorePath);
      const jsonFiles = feedbackFiles.filter(file => file.endsWith('.json'));
      
      const allFeedbacks: HumanFeedback[] = [];
      
      for (const file of jsonFiles) {
        const filePath = path.join(this.feedbackStorePath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const feedbacks = JSON.parse(content) as HumanFeedback[];
        allFeedbacks.push(...feedbacks);
      }
      
      return allFeedbacks;
    } catch (error) {
      console.error('检查新反馈时出错:', error);
      return [];
    }
  }

  async processWebFeedback(feedbacks: HumanFeedback[]): Promise<void> {
    if (feedbacks.length === 0) {
      console.log('没有新的Web反馈需要处理');
      return;
    }

    console.log(`处理 ${feedbacks.length} 条Web反馈...`);
    
    // 转换为AX训练格式
    const trainingData = await this.exportToTrainingFormat(feedbacks);
    
    // 保存到训练数据目录
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `web-feedback-${timestamp}.json`;
    const outputPath = path.join(this.trainingDataPath, filename);
    
    await fs.writeFile(outputPath, trainingData, 'utf-8');
    
    console.log(`已将Web反馈转换并保存到: ${outputPath}`);
    
    // 生成统计报告
    await this.generateFeedbackReport(feedbacks, outputPath);
  }

  async exportToTrainingFormat(feedbacks: HumanFeedback[]): Promise<string> {
    const trainingExamples = feedbacks.map(feedback => {
      // 转换为AX训练格式
      return {
        input: {
          news_content: feedback.input.originalNews,
          category: feedback.input.category
        },
        expected_output: {
          title: {
            content: feedback.aiOutput.title,
            human_score: feedback.titleFeedback.score,
            human_feedback: {
              length_appropriate: feedback.titleFeedback.lengthAppropriate,
              information_complete: feedback.titleFeedback.informationComplete,
              readability_good: feedback.titleFeedback.readabilityGood,
              accuracy_good: feedback.titleFeedback.accuracyGood,
              suggestions: feedback.titleFeedback.suggestions,
              improved_version: feedback.titleFeedback.improvedVersion
            }
          },
          summary: {
            content: feedback.aiOutput.summary,
            human_score: feedback.summaryFeedback.score,
            human_feedback: {
              length_appropriate: feedback.summaryFeedback.lengthAppropriate,
              accuracy_good: feedback.summaryFeedback.accuracyGood,
              completeness_good: feedback.summaryFeedback.completenessGood,
              clarity_good: feedback.summaryFeedback.clarityGood,
              suggestions: feedback.summaryFeedback.suggestions,
              improved_version: feedback.summaryFeedback.improvedVersion
            }
          }
        },
        reviewer: {
          name: feedback.reviewer.name,
          expertise: feedback.reviewer.expertise,
          experience: feedback.reviewer.experience
        },
        overall_score: feedback.overallScore,
        expert_annotations: feedback.expertAnnotations,
        comments: feedback.comments,
        timestamp: feedback.timestamp,
        task_id: feedback.taskId
      };
    });

    return JSON.stringify({
      format: 'ax_training_data',
      version: '1.0',
      generated_at: new Date().toISOString(),
      total_examples: trainingExamples.length,
      examples: trainingExamples
    }, null, 2);
  }

  private async generateFeedbackReport(feedbacks: HumanFeedback[], outputPath: string): Promise<void> {
    const stats = {
      total_feedback: feedbacks.length,
      average_scores: {
        overall: feedbacks.reduce((sum, f) => sum + f.overallScore, 0) / feedbacks.length,
        title: feedbacks.reduce((sum, f) => sum + f.titleFeedback.score, 0) / feedbacks.length,
        summary: feedbacks.reduce((sum, f) => sum + f.summaryFeedback.score, 0) / feedbacks.length
      },
      expertise_distribution: this.getExpertiseDistribution(feedbacks),
      quality_insights: this.generateQualityInsights(feedbacks),
      recommendations: this.generateRecommendations(feedbacks)
    };

    const reportPath = outputPath.replace('.json', '-report.json');
    await fs.writeFile(reportPath, JSON.stringify(stats, null, 2), 'utf-8');
    
    console.log('\n=== Web反馈处理报告 ===');
    console.log(`总反馈数: ${stats.total_feedback}`);
    console.log(`平均整体评分: ${stats.average_scores.overall.toFixed(2)}/5`);
    console.log(`平均标题评分: ${stats.average_scores.title.toFixed(2)}/5`);
    console.log(`平均摘要评分: ${stats.average_scores.summary.toFixed(2)}/5`);
    console.log(`详细报告已保存到: ${reportPath}`);
  }

  private getExpertiseDistribution(feedbacks: HumanFeedback[]) {
    const distribution: Record<string, number> = {};
    feedbacks.forEach(f => {
      distribution[f.reviewer.expertise] = (distribution[f.reviewer.expertise] || 0) + 1;
    });
    return distribution;
  }

  private generateQualityInsights(feedbacks: HumanFeedback[]) {
    const highQuality = feedbacks.filter(f => f.overallScore >= 4).length;
    const lowQuality = feedbacks.filter(f => f.overallScore <= 2).length;
    
    return {
      high_quality_rate: (highQuality / feedbacks.length * 100).toFixed(1) + '%',
      low_quality_rate: (lowQuality / feedbacks.length * 100).toFixed(1) + '%',
      most_common_issues: this.findCommonIssues(feedbacks),
      improvement_suggestions: this.collectImprovementSuggestions(feedbacks)
    };
  }

  private findCommonIssues(feedbacks: HumanFeedback[]) {
    const issues = {
      title_length: 0,
      title_information: 0,
      title_readability: 0,
      title_accuracy: 0,
      summary_length: 0,
      summary_accuracy: 0,
      summary_completeness: 0,
      summary_clarity: 0
    };

    feedbacks.forEach(f => {
      if (!f.titleFeedback.lengthAppropriate) issues.title_length++;
      if (!f.titleFeedback.informationComplete) issues.title_information++;
      if (!f.titleFeedback.readabilityGood) issues.title_readability++;
      if (!f.titleFeedback.accuracyGood) issues.title_accuracy++;
      if (!f.summaryFeedback.lengthAppropriate) issues.summary_length++;
      if (!f.summaryFeedback.accuracyGood) issues.summary_accuracy++;
      if (!f.summaryFeedback.completenessGood) issues.summary_completeness++;
      if (!f.summaryFeedback.clarityGood) issues.summary_clarity++;
    });

    return Object.entries(issues)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 5);
  }

  private collectImprovementSuggestions(feedbacks: HumanFeedback[]) {
    const suggestions = feedbacks
      .map(f => [f.titleFeedback.suggestions, f.summaryFeedback.suggestions])
      .flat()
      .filter(s => s && s.trim().length > 0);
    
    return suggestions.slice(0, 10); // 返回前10个建议
  }

  private generateRecommendations(feedbacks: HumanFeedback[]) {
    const avgOverall = feedbacks.reduce((sum, f) => sum + f.overallScore, 0) / feedbacks.length;
    
    const recommendations = [];
    
    if (avgOverall < 3) {
      recommendations.push('整体质量偏低，建议增加更多高质量训练样本');
    }
    
    const titleAvg = feedbacks.reduce((sum, f) => sum + f.titleFeedback.score, 0) / feedbacks.length;
    if (titleAvg < 3.5) {
      recommendations.push('标题生成质量需要改进，考虑优化提示词或增加标题相关训练');
    }
    
    const summaryAvg = feedbacks.reduce((sum, f) => sum + f.summaryFeedback.score, 0) / feedbacks.length;
    if (summaryAvg < 3.5) {
      recommendations.push('摘要生成质量需要改进，建议增加摘要写作相关训练');
    }
    
    return recommendations;
  }
}

// CLI 执行部分
async function main() {
  const integration = new AXWebFeedbackIntegration();
  
  console.log('🔍 检查新的Web反馈...');
  const newFeedbacks = await integration.checkForNewFeedback();
  
  if (newFeedbacks.length > 0) {
    console.log(`📝 发现 ${newFeedbacks.length} 条新反馈`);
    await integration.processWebFeedback(newFeedbacks);
    console.log('✅ Web反馈处理完成');
  } else {
    console.log('ℹ️  暂无新的Web反馈需要处理');
    
    // 创建示例数据用于测试
    console.log('📋 创建示例反馈数据用于演示...');
    await createSampleFeedbackData();
    
    // 重新检查并处理
    const sampleFeedbacks = await integration.checkForNewFeedback();
    if (sampleFeedbacks.length > 0) {
      await integration.processWebFeedback(sampleFeedbacks);
    }
  }
}

async function createSampleFeedbackData() {
  const sampleFeedback: HumanFeedback = {
    taskId: `web_task_${Date.now()}`,
    timestamp: new Date().toISOString(),
    reviewer: {
      name: '张专家',
      expertise: 'journalism',
      experience: 8
    },
    input: {
      originalNews: 'OpenAI发布了最新的GPT-5模型，在多个基准测试中取得了突破性成果。新模型在理解能力、推理能力和创造性方面都有显著提升，同时支持更长的上下文窗口，可以处理多达200万个token。',
      category: 'technology'
    },
    aiOutput: {
      title: 'OpenAI发布GPT-5：支持200万token长上下文',
      summary: 'OpenAI新推出GPT-5模型，在理解、推理和创造性方面显著提升，支持200万token长上下文处理，在多个基准测试中取得突破。',
      processingTime: 1850
    },
    overallScore: 4,
    titleFeedback: {
      score: 4,
      lengthAppropriate: true,
      informationComplete: true,
      readabilityGood: true,
      accuracyGood: true,
      suggestions: '可以更突出GPT-5的核心优势',
      improvedVersion: 'OpenAI发布GPT-5：理解推理全面提升，支持200万token超长上下文'
    },
    summaryFeedback: {
      score: 4,
      lengthAppropriate: true,
      accuracyGood: true,
      completenessGood: true,
      clarityGood: true,
      suggestions: '可以更具体说明提升的程度',
      improvedVersion: '一个改进版本的摘要示例'
    },
    expertAnnotations: {
      keyEntities: ['OpenAI', 'GPT-5', '200万token', '长上下文'],
      coreEvents: ['模型发布', '基准测试突破', '能力提升'],
      importance: 'high',
      difficulty: 'medium'
    },
    comments: '整体质量不错，建议在突出核心亮点方面进一步优化'
  };

  const feedbackDir = path.join(process.cwd(), 'web-feedback-data');
  await fs.mkdir(feedbackDir, { recursive: true });
  
  const feedbackPath = path.join(feedbackDir, 'sample-feedback.json');
  await fs.writeFile(feedbackPath, JSON.stringify([sampleFeedback], null, 2), 'utf-8');
  
  console.log(`✅ 示例反馈数据已创建: ${feedbackPath}`);
}

// 直接执行主函数
main().catch(console.error);

export { AXWebFeedbackIntegration };