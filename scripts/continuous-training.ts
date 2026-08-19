#!/usr/bin/env tsx

/**
 * Legacy command name retained as a read-only feedback audit.
 *
 * Continuous auto-training was never implemented: it selected a few examples,
 * wrote no usable candidate, and described the result as a new model. This
 * command now reports only observed human feedback. Candidate creation and
 * held-out evaluation must be explicit, separate steps.
 */

import fs from 'fs/promises';
import path from 'path';

interface ProductionData {
  timestamp: string;
  userFeedback?: number;
  performance?: {
    titleLength?: number;
    summaryLength?: number;
    processingTime?: number;
  };
}

async function readFeedback(days: number): Promise<ProductionData[]> {
  const directory = path.join(process.cwd(), 'ax-optimization-artifacts', 'production-data');
  const results: ProductionData[] = [];
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    try {
      const content = await fs.readFile(path.join(directory, `production-data-${day}.jsonl`), 'utf8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          results.push(JSON.parse(line) as ProductionData);
        } catch {
          console.warn(`⚠️ 跳过无法解析的反馈行：${day}`);
        }
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return results;
}

async function main() {
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='))?.split('=')[1];
  const days = Math.min(365, Math.max(1, Number.parseInt(daysArg || '30', 10) || 30));
  const records = await readFeedback(days);
  const ratings = records
    .map((record) => record.userFeedback)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const averageRating = ratings.length
    ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
    : null;

  console.log(`反馈窗口: 最近 ${days} 天`);
  console.log(`处理记录: ${records.length}`);
  console.log(`人工评分: ${ratings.length}`);
  console.log(`平均评分: ${averageRating === null ? '无数据' : `${averageRating.toFixed(2)}/5`}`);
  console.log('结论: 此报告只能描述已观测反馈，不能证明某个提示配置带来因果质量提升。');
  console.log('下一步: 固定独立留出集，对基线与候选 prompt profile 做同样本盲评。');
}

main().catch((error) => {
  console.error('反馈审计失败:', error);
  process.exit(1);
});
