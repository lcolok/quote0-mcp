#!/usr/bin/env tsx

/**
 * Legacy command name retained for compatibility.
 *
 * This command creates a prompt-profile candidate from reviewed examples. It
 * does not train a model, calculate accuracy, or deploy without an independent
 * held-out evaluation gate.
 */

import { SnapshotManager } from './snapshot-manager.js';
import fs from 'fs/promises';
import path from 'path';

async function createProfileCandidate(version: string, samples: any[]) {
  const titleDemos = samples.slice(0, Math.min(5, samples.length)).map((sample) => ({
    input: { newsContent: sample.newsContent },
    output: { optimizedTitle: sample.optimizedTitle },
  }));
  const summaryDemos = samples.slice(0, Math.min(3, samples.length)).map((sample) => ({
    input: { newsContent: sample.newsContent },
    output: { summary: sample.optimizedSummary },
  }));
  const createdAt = new Date().toISOString();
  const artifact = {
    timestamp: createdAt,
    version,
    programs: {
      titleProgram: {
        instruction: '将新闻内容改写为准确、简洁的标题，严格控制在20字符以内，不得补充输入中没有的事实',
        demos: titleDemos,
        modelConfig: { temperature: 0.3, topP: 0.9, maxTokens: 100 },
        stats: { trained: false, version, exampleCount: titleDemos.length, validated: false },
      },
      summaryProgram: {
        instruction: '将新闻内容提炼为200字符以内的摘要，只保留输入中明确出现的事实',
        demos: summaryDemos,
        modelConfig: { temperature: 0.3, topP: 0.9, maxTokens: 512 },
        stats: { trained: false, version, exampleCount: summaryDemos.length, validated: false },
      },
    },
    metadata: {
      createdAt,
      profileType: 'few-shot-candidate',
      sourceVersion: version,
      sourceSampleCount: samples.length,
      evaluationStatus: 'not-run',
    },
  };

  const snapshotsDir = path.join(process.cwd(), 'ax-framework', 'models', 'snapshots');
  await fs.mkdir(snapshotsDir, { recursive: true });
  const profilePath = path.join(snapshotsDir, `${version}.json`);
  await fs.writeFile(profilePath, JSON.stringify(artifact, null, 2));
  return { profilePath, createdAt, titleExamples: titleDemos.length, summaryExamples: summaryDemos.length };
}

async function main() {
  const args = process.argv.slice(2);
  const version = args.find((arg) => arg.startsWith('--version='))?.split('=')[1];
  const deploy = args.includes('--deploy');

  if (!version) {
    console.error('用法: bun run scripts/ax-training/train-model.ts --version=<snapshot-version>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
    console.error('版本号只能包含字母、数字、点、下划线和连字符');
    process.exit(1);
  }
  if (deploy) {
    console.error('自动部署已停用：请先在独立留出集上完成评估并记录门禁结果。');
    process.exit(2);
  }

  try {
    const manager = new SnapshotManager();
    await manager.initialize();
    const details = await manager.getVersionDetails(version);
    if (!details) throw new Error(`版本 ${version} 不存在`);

    const result = await createProfileCandidate(version, details.samples);
    console.log('✅ 已创建提示配置候选（未训练、未评估、未部署）');
    console.log(`📁 ${result.profilePath}`);
    console.log(`📎 标题示例 ${result.titleExamples} 条，摘要示例 ${result.summaryExamples} 条`);
    console.log('下一步：在独立留出集上比较基线与候选配置，通过事实一致性和人工偏好门禁后再手动激活。');
  } catch (error) {
    console.error('❌ 创建提示配置候选失败:', error);
    process.exit(1);
  }
}

main();
