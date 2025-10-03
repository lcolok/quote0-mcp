#!/usr/bin/env tsx

/**
 * 从标注系统导出训练数据并创建快照
 */

import { SnapshotManager, type TrainingSample } from './snapshot-manager.js';

interface AnnotationSample {
  title: string;
  link: string;
  description: string;
  overall_score: number;
  quality_level: 'high' | 'medium' | 'low';
  should_filter: boolean;
  reason: string;
  tags: string[] | null;
  annotator: string;
  created_at: string;
}

async function fetchAnnotationSamples(
  minScore: number = 0,
  maxScore: number = 100
): Promise<AnnotationSample[]> {
  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  const url = `${apiUrl}/api/annotation/samples/export?minScore=${minScore}&maxScore=${maxScore}`;

  console.log(`📡 正在从标注API获取数据: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
  }

  const samples = await response.json();
  console.log(`✅ 成功获取 ${samples.length} 条标注样本`);

  return samples;
}

async function convertToTrainingSamples(
  annotationSamples: AnnotationSample[]
): Promise<TrainingSample[]> {
  const trainingSamples: TrainingSample[] = [];

  for (let i = 0; i < annotationSamples.length; i++) {
    const sample = annotationSamples[i];

    // 从标注数据中提取信息
    // 注意：标注数据中的title是原始标题，description是原始内容
    // 我们需要获取对应的processed_content来得到优化后的标题和摘要

    // 简化处理：使用标注数据中的字段
    // 实际应用中可能需要从数据库获取完整的processed_content
    trainingSamples.push({
      sampleId: i + 1,
      title: sample.title,
      newsId: 0, // 需要从数据库关联获取
      fingerprint: '', // 需要从数据库关联获取
      newsContent: sample.description,
      optimizedTitle: sample.title, // 实际应该是processed_content.title
      optimizedSummary: sample.description.substring(0, 200), // 实际应该是processed_content.message
      annotatedAt: sample.created_at,
      annotator: sample.annotator,
      score: sample.overall_score,
      source: '标注系统', // 需要从数据库关联获取实际来源
      link: sample.link,
      qualityLevel: sample.quality_level
    });
  }

  return trainingSamples;
}

async function main() {
  const args = process.argv.slice(2);

  // 解析命令行参数
  const params = {
    version: args.find(arg => arg.startsWith('--version='))?.split('=')[1] || '',
    description: args.find(arg => arg.startsWith('--desc='))?.split('=')[1] || '',
    minScore: parseInt(args.find(arg => arg.startsWith('--min-score='))?.split('=')[1] || '0'),
    maxScore: parseInt(args.find(arg => arg.startsWith('--max-score='))?.split('=')[1] || '100'),
    tags: args.find(arg => arg.startsWith('--tags='))?.split('=')[1]?.split(',') || [],
    createdBy: args.find(arg => arg.startsWith('--by='))?.split('=')[1] || 'admin'
  };

  if (!params.version) {
    console.error('❌ 错误: 必须指定版本号');
    console.log('');
    console.log('用法:');
    console.log('  bun run scripts/ax-training/export-from-annotation.ts \\');
    console.log('    --version=v1.1.0 \\');
    console.log('    --desc="添加技术类新闻标注样本" \\');
    console.log('    --min-score=70 \\');
    console.log('    --max-score=100 \\');
    console.log('    --tags=technology,initial \\');
    console.log('    --by=admin');
    console.log('');
    console.log('参数说明:');
    console.log('  --version    版本号 (必填)');
    console.log('  --desc       版本描述');
    console.log('  --min-score  最低质量分数 (默认: 0)');
    console.log('  --max-score  最高质量分数 (默认: 100)');
    console.log('  --tags       标签列表 (逗号分隔)');
    console.log('  --by         创建者 (默认: admin)');
    process.exit(1);
  }

  try {
    console.log('🚀 开始导出标注数据并创建训练快照');
    console.log('=====================================');
    console.log(`📌 版本: ${params.version}`);
    console.log(`📝 描述: ${params.description || '(无)'}`);
    console.log(`🎯 分数范围: ${params.minScore} - ${params.maxScore}`);
    console.log(`🏷️  标签: ${params.tags.join(', ') || '(无)'}`);
    console.log(`👤 创建者: ${params.createdBy}`);
    console.log('');

    // 1. 从API获取标注样本
    const annotationSamples = await fetchAnnotationSamples(params.minScore, params.maxScore);

    if (annotationSamples.length === 0) {
      console.warn('⚠️  警告: 没有符合条件的标注样本');
      process.exit(0);
    }

    // 2. 转换为训练样本格式
    console.log('🔄 转换为训练样本格式...');
    const trainingSamples = await convertToTrainingSamples(annotationSamples);

    // 3. 创建快照
    const manager = new SnapshotManager();
    await manager.initialize();

    const snapshotPath = await manager.createSnapshot(
      trainingSamples,
      params.version,
      params.description || `从标注系统导出 ${trainingSamples.length} 条样本`,
      params.createdBy,
      params.tags
    );

    console.log('');
    console.log('✅ 快照创建成功！');
    console.log('');
    console.log('📊 快照统计:');
    console.log(`   路径: ${snapshotPath}`);
    console.log(`   样本数: ${trainingSamples.length}`);
    console.log(`   平均分: ${(trainingSamples.reduce((sum, s) => sum + s.score, 0) / trainingSamples.length).toFixed(1)}`);
    console.log('');
    console.log('🔜 下一步操作:');
    console.log(`   1. 激活版本: bun run scripts/ax-training/activate-version.ts --version=${params.version}`);
    console.log(`   2. 训练模型: bun run scripts/ax-training/train-model.ts --version=${params.version}`);
    console.log('');

  } catch (error) {
    console.error('❌ 导出失败:', error);
    process.exit(1);
  }
}

main();
