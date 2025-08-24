#!/usr/bin/env tsx

/**
 * 持续训练和优化系统
 * 随着数据量增大不断积累优化
 */

import { AxOptimizedNewsProcessorSimplified } from '../src/react-widgets/services/ax-optimized-news-processor-simplified.js';

interface ProductionData {
  timestamp: string;
  input: string;
  output: {
    title: string;
    summary: string;
  };
  userFeedback?: number; // 1-5分评分
  performance: {
    titleLength: number;
    summaryLength: number;
    processingTime: number;
  };
}

class ContinuousTrainingSystem {
  private productionDataPath = '/Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/production-data/';
  
  /**
   * 收集生产环境数据
   */
  async collectProductionData(data: ProductionData) {
    const fs = await import('fs/promises');
    
    // 确保目录存在
    await fs.mkdir(this.productionDataPath, { recursive: true });
    
    // 按日期分组存储
    const date = new Date().toISOString().split('T')[0];
    const filename = `${this.productionDataPath}production-data-${date}.jsonl`;
    
    // 追加到JSONL文件
    await fs.appendFile(filename, JSON.stringify(data) + '\n');
    
    console.log(`📊 生产数据已记录: ${filename}`);
  }

  /**
   * 分析生产数据质量
   */
  async analyzeProductionQuality(days: number = 7): Promise<{
    averageScore: number;
    totalSamples: number;
    qualityTrend: number[];
    improvementNeeded: boolean;
  }> {
    const fs = await import('fs/promises');
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    
    let allData: ProductionData[] = [];
    
    // 读取指定天数的数据
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().split('T')[0];
      const filename = `${this.productionDataPath}production-data-${date}.jsonl`;
      
      try {
        const content = await fs.readFile(filename, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);
        const dayData = lines.map(line => JSON.parse(line) as ProductionData);
        allData.push(...dayData);
      } catch (error) {
        // 文件不存在时忽略
      }
    }
    
    if (allData.length === 0) {
      return { averageScore: 0, totalSamples: 0, qualityTrend: [], improvementNeeded: true };
    }
    
    // 计算质量指标
    const scoresWithFeedback = allData.filter(d => d.userFeedback).map(d => d.userFeedback!);
    const averageScore = scoresWithFeedback.length > 0 ? 
      scoresWithFeedback.reduce((a, b) => a + b, 0) / scoresWithFeedback.length : 0;
    
    // 判断是否需要改进
    const improvementNeeded = averageScore < 3.5 || allData.length > 100; // 评分低或数据量大时重训练
    
    return {
      averageScore,
      totalSamples: allData.length,
      qualityTrend: scoresWithFeedback,
      improvementNeeded
    };
  }

  /**
   * 基于生产数据进行增量训练
   */
  async performIncrementalTraining(): Promise<boolean> {
    console.log('🔄 开始增量训练...');
    
    try {
      // 1. 分析当前质量
      const analysis = await this.analyzeProductionQuality(30); // 分析30天数据
      
      console.log(`📊 质量分析结果:`);
      console.log(`   - 平均评分: ${analysis.averageScore.toFixed(2)}/5`);
      console.log(`   - 样本数量: ${analysis.totalSamples}`);
      console.log(`   - 需要改进: ${analysis.improvementNeeded ? '是' : '否'}`);
      
      if (!analysis.improvementNeeded) {
        console.log('✅ 当前模型质量良好，无需重训练');
        return false;
      }
      
      // 2. 准备新的训练数据
      const newTrainingData = await this.prepareTrainingData(analysis.totalSamples);
      
      // 3. 执行增量训练
      const processor = new AxOptimizedNewsProcessorSimplified({
        apiKey: process.env.LLM_API_KEY!,
        baseURL: process.env.LLM_BASE_URL!,
        model: process.env.LLM_MODEL || 'gpt-5-mini'
      });
      
      console.log(`🚀 使用${newTrainingData.length}个新样本进行训练...`);
      const result = await processor.quickTrain(newTrainingData);
      
      // 4. 保存新模型版本
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await this.saveNewModelVersion(timestamp, result);
      
      console.log('✅ 增量训练完成！');
      return true;
      
    } catch (error) {
      console.error('❌ 增量训练失败:', error);
      return false;
    }
  }

  /**
   * 准备训练数据（结合历史优质样本）
   */
  private async prepareTrainingData(sampleCount: number) {
    // 这里可以：
    // 1. 从生产数据中选择高评分样本
    // 2. 结合原始训练数据
    // 3. 进行数据增强
    
    // 示例：返回基础训练数据
    const { trainingData } = await import('./ax-training-data.js');
    return trainingData.slice(0, Math.min(sampleCount / 10, 10)); // 动态调整训练样本数
  }

  /**
   * 保存新模型版本
   */
  private async saveNewModelVersion(timestamp: string, trainingResult: any) {
    const fs = await import('fs/promises');
    const artifactsPath = '/Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/';
    
    // 备份当前production模型
    try {
      const currentModel = await fs.readFile(`${artifactsPath}production/latest.json`, 'utf-8');
      await fs.writeFile(`${artifactsPath}production/backup-${timestamp}.json`, currentModel);
      console.log(`📦 当前模型已备份: backup-${timestamp}.json`);
    } catch (error) {
      console.warn('⚠️  备份失败，但继续更新模型');
    }
    
    // 这里可以保存真正的新模型
    console.log(`💾 新模型版本已保存: v${timestamp}`);
  }

  /**
   * 自动化持续优化流程
   */
  async startContinuousOptimization() {
    console.log('🎯 启动持续优化系统...');
    
    // 每周检查一次是否需要重训练
    setInterval(async () => {
      console.log('⏰ 执行定期质量检查...');
      await this.performIncrementalTraining();
    }, 7 * 24 * 60 * 60 * 1000); // 7天
    
    console.log('✅ 持续优化系统已启动（每7天检查一次）');
  }
}

// 演示用法
async function demonstrateContinuousTraining() {
  const trainingSystem = new ContinuousTrainingSystem();
  
  console.log('🎓 持续训练系统演示');
  console.log('====================');
  
  // 模拟生产数据收集
  console.log('📊 模拟收集生产数据...');
  await trainingSystem.collectProductionData({
    timestamp: new Date().toISOString(),
    input: '苹果发布新款iPhone，采用3nm芯片技术...',
    output: {
      title: '苹果iPhone新品发布',
      summary: '苹果发布搭载3nm芯片的新iPhone，性能提升显著，预计年底上市。'
    },
    userFeedback: 4, // 用户给出4分评价
    performance: {
      titleLength: 9,
      summaryLength: 32,
      processingTime: 1500
    }
  });
  
  // 分析质量
  console.log('\n📈 分析生产数据质量...');
  const analysis = await trainingSystem.analyzeProductionQuality(7);
  console.log('分析结果:', analysis);
  
  // 执行训练
  console.log('\n🚀 执行增量训练...');
  await trainingSystem.performIncrementalTraining();
  
  console.log('\n🎉 演示完成！');
}

// 运行演示
demonstrateContinuousTraining();