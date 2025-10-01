#!/usr/bin/env node

/**
 * 新闻质量评估命令行工具
 */

import { FlexibleNewsEvaluator } from './evaluator.js';
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('news-quality-eval')
  .description('灵活的新闻内容质量评估工具')
  .version('1.0.0');

program
  .command('recent')
  .description('评估最近N条推送')
  .option('-n, --limit <number>', '评估数量', '20')
  .option('-c, --config <path>', '配置文件路径')
  .option('--no-report', '不保存报告')
  .action(async (options) => {
    await runEvaluation({
      mode: 'recent',
      limit: parseInt(options.limit),
      saveReport: options.report,
      ...await loadConfig(options.config)
    });
  });

program
  .command('all')
  .description('评估全部推送历史')
  .option('-c, --config <path>', '配置文件路径')
  .option('-b, --batch <number>', '批次大小', '50')
  .option('--no-report', '不保存报告')
  .action(async (options) => {
    await runEvaluation({
      mode: 'all',
      batchSize: parseInt(options.batch),
      saveReport: options.report,
      ...await loadConfig(options.config)
    });
  });

program
  .command('range')
  .description('评估指定时间范围的推送')
  .option('--from <date>', '开始日期 (YYYY-MM-DD)')
  .option('--to <date>', '结束日期 (YYYY-MM-DD)')
  .option('-c, --config <path>', '配置文件路径')
  .option('-b, --batch <number>', '批次大小', '50')
  .option('--no-report', '不保存报告')
  .action(async (options) => {
    if (!options.from && !options.to) {
      console.error('❌ 必须指定 --from 或 --to 参数');
      process.exit(1);
    }

    await runEvaluation({
      mode: 'range',
      dateFrom: options.from,
      dateTo: options.to,
      batchSize: parseInt(options.batch),
      saveReport: options.report,
      ...await loadConfig(options.config)
    });
  });

program
  .command('source')
  .description('评估指定RSS源的推送')
  .option('-s, --sources <sources...>', 'RSS源名称（可多个）')
  .option('-c, --config <path>', '配置文件路径')
  .option('-b, --batch <number>', '批次大小', '50')
  .option('--no-report', '不保存报告')
  .action(async (options) => {
    if (!options.sources || options.sources.length === 0) {
      console.error('❌ 必须指定至少一个RSS源');
      process.exit(1);
    }

    await runEvaluation({
      mode: 'source',
      sources: options.sources,
      batchSize: parseInt(options.batch),
      saveReport: options.report,
      ...await loadConfig(options.config)
    });
  });

program
  .command('config')
  .description('显示当前配置')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    const config = await loadConfig(options.config);
    console.log('当前配置:');
    console.log(JSON.stringify(config, null, 2));
  });

async function loadConfig(configPath?: string): Promise<any> {
  const defaultConfigPath = path.join(__dirname, '../config/default.json');
  const userConfigPath = configPath || path.join(process.cwd(), 'evaluation-config.json');

  let config: any = {};

  // 加载默认配置
  try {
    const defaultConfig = await fs.readFile(defaultConfigPath, 'utf-8');
    config = JSON.parse(defaultConfig);
  } catch (error) {
    console.warn('⚠️ 无法加载默认配置，使用内置默认值');
    config = {
      api: { baseUrl: 'http://localhost:3001' },
      llm: { model: 'gpt-5-mini', scoreThreshold: 60 },
      output: { reportDir: './reports' }
    };
  }

  // 加载用户配置（如果存在）
  if (configPath) {
    try {
      const userConfig = await fs.readFile(userConfigPath, 'utf-8');
      const parsed = JSON.parse(userConfig);
      config = { ...config, ...parsed };
    } catch (error) {
      // 用户配置不存在或无效，使用默认配置
    }
  }

  // 从环境变量覆盖
  if (process.env.NEWS_API_URL) {
    config.api.baseUrl = process.env.NEWS_API_URL;
  }
  if (process.env.LLM_MODEL) {
    config.llm.model = process.env.LLM_MODEL;
  }

  return config;
}

async function runEvaluation(options: any) {
  try {
    // 验证环境变量
    const apiKey = process.env.LLM_API_KEY;
    const baseURL = process.env.LLM_BASE_URL;

    if (!apiKey || !baseURL) {
      console.error('❌ 请设置环境变量: LLM_API_KEY, LLM_BASE_URL');
      process.exit(1);
    }

    const evaluator = new FlexibleNewsEvaluator({
      apiUrl: options.api?.baseUrl || 'http://localhost:3001',
      llmApiKey: apiKey,
      llmBaseURL: baseURL,
      llmModel: options.llm?.model || 'gpt-5-mini',
      scoreThreshold: options.llm?.scoreThreshold || 60
    });

    const evalOptions = {
      mode: options.mode,
      limit: options.limit,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      sources: options.sources,
      batchSize: options.batchSize || 50,
      saveReport: options.saveReport,
      reportDir: options.output?.reportDir || './reports'
    };

    const result = await evaluator.evaluate(evalOptions);

    // 输出控制台摘要
    console.log('\n========================================');
    console.log('📊 评估完成');
    console.log('========================================\n');

    console.log(`总推送数: ${result.statistics.total}条`);
    console.log(`已评估: ${result.statistics.evaluated}条`);
    console.log(`平均评分: ${result.statistics.avgScore}/100`);
    console.log(`\n质量分布:`);
    console.log(`  🏆 高价值: ${result.statistics.highValue}条 (${Math.round(result.statistics.highValue * 100 / result.statistics.evaluated)}%)`);
    console.log(`  ⚠️  中等: ${result.statistics.mediumValue}条 (${Math.round(result.statistics.mediumValue * 100 / result.statistics.evaluated)}%)`);
    console.log(`  ❌ 低价值: ${result.statistics.lowValue}条 (${Math.round(result.statistics.lowValue * 100 / result.statistics.evaluated)}%)`);
    console.log(`\n过滤建议:`);
    console.log(`  ✅ 保留: ${result.statistics.kept}条 (${Math.round(result.statistics.kept * 100 / result.statistics.evaluated)}%)`);
    console.log(`  ❌ 过滤: ${result.statistics.filtered}条 (${Math.round(result.statistics.filtered * 100 / result.statistics.evaluated)}%)`);

    console.log('\n========================================\n');

  } catch (error) {
    console.error('\n❌ 评估失败:');
    if (error instanceof Error) {
      console.error(error.message);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}

program.parse();
