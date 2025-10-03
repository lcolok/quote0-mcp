#!/usr/bin/env tsx

/**
 * 从标注系统导出训练数据并创建快照
 */

import { SnapshotManager, type TrainingSample } from './snapshot-manager.js';

interface AnnotationSample {
  // 原始内容（RSS/API获取的）
  original_title: string;
  original_description: string;
  original_content?: string;

  // LLM处理后的内容（如果有）
  processed_title?: string;
  processed_summary?: string;

  link: string;
  overall_score: number;
  quality_level: 'high' | 'medium' | 'low';
  should_filter: boolean;
  reason: string;
  tags: string[] | null;
  annotator: string;
  created_at: string;

  // 人工优化的内容（标注时手动填写）
  optimized_title?: string;
  optimized_summary?: string;
  optimized_content?: string;
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
    // 优先级：人工优化 > LLM处理 > 原始内容
    const hasManualOptimization = sample.optimized_title || sample.optimized_summary;
    const hasLLMProcessing = sample.processed_title || sample.processed_summary;

    // 输入：始终使用原始内容
    const inputTitle = sample.original_title;
    const inputContent = sample.original_content || sample.original_description;

    // 输出：优先使用人工优化，其次LLM处理，最后原始内容
    const outputTitle = sample.optimized_title || sample.processed_title || sample.original_title;
    const outputSummary = sample.optimized_summary || sample.processed_summary || sample.original_description;

    // 数据来源标记
    let dataSource = '原始内容';
    if (hasManualOptimization) {
      dataSource = '人工优化';
    } else if (hasLLMProcessing) {
      dataSource = 'LLM处理';
    }

    trainingSamples.push({
      sampleId: i + 1,
      title: inputTitle,
      newsId: 0,
      fingerprint: '',
      newsContent: inputContent,

      // ✨ 输出：优先使用人工优化内容
      optimizedTitle: outputTitle,
      optimizedSummary: outputSummary,

      annotatedAt: sample.created_at,
      annotator: sample.annotator,
      score: sample.overall_score,
      source: dataSource,
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
