/**
 * 灵活的新闻质量评估器
 * 支持全量、范围、按源等多种评估模式
 */

import { NewsQualityEvaluator } from '../../../src/react-widgets/services/news-quality-evaluator.js';
import fs from 'fs/promises';
import path from 'path';

export interface EvaluationConfig {
  apiUrl: string;
  llmApiKey: string;
  llmBaseURL: string;
  llmModel: string;
  scoreThreshold: number;
}

export interface EvaluationOptions {
  mode: 'recent' | 'all' | 'range' | 'source';
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  sources?: string[];
  batchSize?: number;
  saveReport?: boolean;
  reportDir?: string;
}

export interface PushLog {
  id: number;
  title: string;
  source: string;
  link: string;
  pushedAt: string;
  category?: string;
  fingerprint?: string;
  pushCount?: number;
}

export interface EvaluationResult {
  timestamp: string;
  config: EvaluationOptions;
  statistics: {
    total: number;
    evaluated: number;
    skipped: number;
    highValue: number;
    mediumValue: number;
    lowValue: number;
    filtered: number;
    kept: number;
    avgScore: number;
    evaluationTime: number;
  };
  bySource: Record<string, SourceStatistics>;
  details: Array<{
    news: PushLog;
    result: any;
  }>;
}

export interface SourceStatistics {
  total: number;
  filtered: number;
  avgScore: number;
  scores: number[];
  highValue: number;
  mediumValue: number;
  lowValue: number;
}

export class FlexibleNewsEvaluator {
  private config: EvaluationConfig;
  private evaluator: NewsQualityEvaluator;

  constructor(config: EvaluationConfig) {
    this.config = config;
    this.evaluator = new NewsQualityEvaluator({
      apiKey: config.llmApiKey,
      baseURL: config.llmBaseURL,
      model: config.llmModel,
      scoreThreshold: config.scoreThreshold
    });
  }

  /**
   * 使用分页获取全部数据
   */
  private async fetchAllWithPagination(baseUrl: string): Promise<PushLog[]> {
    const allLogs: any[] = [];
    let offset = 0;
    const batchSize = 500; // 每次获取500条（去重后数据量较小）

    while (true) {
      const url = `${baseUrl}&limit=${batchSize}&offset=${offset}&deduplicate=true`;
      console.log(`  正在获取第 ${offset + 1}-${offset + batchSize} 条唯一记录...`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.logs || !Array.isArray(data.logs)) {
        throw new Error('API返回数据格式错误');
      }

      // 过滤无效数据
      const validLogs = data.logs.filter((log: any) => log.title && log.source);
      allLogs.push(...validLogs);

      // 如果返回的记录少于请求的数量，说明已经到达末尾
      if (data.logs.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    console.log(`  ✅ 共获取 ${allLogs.length} 条有效记录\n`);

    return allLogs.map((log: any) => ({
      id: log.id,
      title: log.title,
      source: log.source,
      link: log.link || '',
      pushedAt: log.pushedAt,
      category: log.category,
      fingerprint: log.fingerprint,
      pushCount: log.pushCount
    }));
  }

  /**
   * 获取推送历史（支持分页，默认去重）
   */
  async fetchPushHistory(options: EvaluationOptions): Promise<PushLog[]> {
    const baseUrl = `${this.config.apiUrl}/api/news/scheduler/history?includeContent=false&deduplicate=true`;

    // 对于 'all' 模式，使用分页获取全部数据
    if (options.mode === 'all') {
      console.log(`📡 正在分页获取全部推送历史（已去重）...\n`);
      return await this.fetchAllWithPagination(baseUrl);
    }

    // 其他模式使用单次请求
    let url = baseUrl;

    switch (options.mode) {
      case 'recent':
        url += `&limit=${options.limit || 20}`;
        break;

      case 'range':
        url += `&limit=5000`;
        if (options.dateFrom) url += `&dateFrom=${options.dateFrom}`;
        if (options.dateTo) url += `&dateTo=${options.dateTo}`;
        break;

      case 'source':
        url += `&limit=5000`;
        if (options.sources && options.sources.length > 0) {
          url += `&sources=${options.sources.join(',')}`;
        }
        break;
    }

    console.log(`📡 正在获取推送历史: ${url}\n`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.logs || !Array.isArray(data.logs)) {
      throw new Error('API返回数据格式错误');
    }

    // 过滤无效数据
    let logs = data.logs.filter((log: any) => log.title && log.source);

    // 应用日期过滤
    if (options.mode === 'range' && (options.dateFrom || options.dateTo)) {
      logs = logs.filter((log: any) => {
        const logDate = new Date(log.pushedAt);
        if (options.dateFrom && logDate < new Date(options.dateFrom)) return false;
        if (options.dateTo && logDate > new Date(options.dateTo)) return false;
        return true;
      });
    }

    // 应用源过滤
    if (options.sources && options.sources.length > 0) {
      logs = logs.filter((log: any) => {
        const source = log.source.split(':')[0].trim();
        return options.sources!.some(s => source.includes(s));
      });
    }

    return logs.map((log: any) => ({
      id: log.id,
      title: log.title,
      source: log.source,
      link: log.link || '',
      pushedAt: log.pushedAt,
      category: log.category,
      fingerprint: log.fingerprint,
      pushCount: log.pushCount
    }));
  }

  /**
   * 执行批量评估
   */
  async evaluate(options: EvaluationOptions): Promise<EvaluationResult> {
    const startTime = Date.now();

    console.log('========================================');
    console.log('📊 新闻质量深度评估');
    console.log('========================================\n');

    console.log(`评估模式: ${options.mode}`);
    if (options.limit) console.log(`限制数量: ${options.limit}`);
    if (options.dateFrom) console.log(`开始日期: ${options.dateFrom}`);
    if (options.dateTo) console.log(`结束日期: ${options.dateTo}`);
    if (options.sources) console.log(`RSS源: ${options.sources.join(', ')}`);
    console.log('');

    // 获取数据
    const logs = await this.fetchPushHistory(options);

    if (logs.length === 0) {
      throw new Error('没有找到符合条件的推送记录');
    }

    const skippedCount = 0; // 在fetchPushHistory中已过滤
    console.log(`✅ 获取到 ${logs.length} 条有效推送\n`);

    // 批量评估
    const batchSize = options.batchSize || 50;
    const results = [];

    console.log(`开始批量评估 (批次大小: ${batchSize})...\n`);

    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, Math.min(i + batchSize, logs.length));
      console.log(`📊 评估批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(logs.length / batchSize)} (${batch.length}条)`);

      const batchResults = await this.evaluator.evaluateBatch(batch);
      results.push(...batchResults);

      // 短暂延迟避免API限流
      if (i + batchSize < logs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const endTime = Date.now();

    // 统计分析
    const statistics = this.calculateStatistics(results, logs, startTime, endTime, skippedCount);
    const bySource = this.analyzeBySource(results, logs);
    const details = results.map((result, index) => ({
      news: logs[index],
      result
    }));

    const evaluationResult: EvaluationResult = {
      timestamp: new Date().toISOString(),
      config: options,
      statistics,
      bySource,
      details
    };

    // 保存报告
    if (options.saveReport !== false) {
      await this.saveReport(evaluationResult, options);
    }

    return evaluationResult;
  }

  /**
   * 计算统计数据
   */
  private calculateStatistics(
    results: any[],
    logs: PushLog[],
    startTime: number,
    endTime: number,
    skippedCount: number
  ) {
    const highValue = results.filter(r => r.category === 'high');
    const mediumValue = results.filter(r => r.category === 'medium');
    const lowValue = results.filter(r => r.category === 'low');
    const filtered = results.filter(r => r.shouldFilter);
    const kept = results.filter(r => !r.shouldFilter);
    const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);

    return {
      total: logs.length + skippedCount,
      evaluated: results.length,
      skipped: skippedCount,
      highValue: highValue.length,
      mediumValue: mediumValue.length,
      lowValue: lowValue.length,
      filtered: filtered.length,
      kept: kept.length,
      avgScore,
      evaluationTime: endTime - startTime
    };
  }

  /**
   * 按来源分析
   */
  private analyzeBySource(results: any[], logs: PushLog[]): Record<string, SourceStatistics> {
    const bySource: Record<string, SourceStatistics> = {};

    results.forEach((result, index) => {
      const source = logs[index].source.split(':')[0].trim();
      if (!bySource[source]) {
        bySource[source] = {
          total: 0,
          filtered: 0,
          avgScore: 0,
          scores: [],
          highValue: 0,
          mediumValue: 0,
          lowValue: 0
        };
      }

      bySource[source].total++;
      bySource[source].scores.push(result.score);

      if (result.shouldFilter) {
        bySource[source].filtered++;
      }

      if (result.category === 'high') bySource[source].highValue++;
      if (result.category === 'medium') bySource[source].mediumValue++;
      if (result.category === 'low') bySource[source].lowValue++;
    });

    // 计算平均分
    Object.keys(bySource).forEach(source => {
      const scores = bySource[source].scores;
      bySource[source].avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    });

    return bySource;
  }

  /**
   * 保存评估报告
   */
  private async saveReport(result: EvaluationResult, options: EvaluationOptions): Promise<void> {
    const reportDir = options.reportDir || './reports';
    await fs.mkdir(reportDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `evaluation_${options.mode}_${timestamp}.md`;
    const filepath = path.join(reportDir, filename);

    const markdown = this.generateMarkdownReport(result);
    await fs.writeFile(filepath, markdown, 'utf-8');

    console.log(`\n📝 报告已保存: ${filepath}`);
  }

  /**
   * 生成Markdown报告
   */
  private generateMarkdownReport(result: EvaluationResult): string {
    const { statistics, bySource, details, config } = result;

    let md = `# 📊 新闻内容质量评估报告\n\n`;
    md += `**评估时间**: ${new Date(result.timestamp).toLocaleString('zh-CN')}\n`;
    md += `**评估模式**: ${config.mode}\n`;
    md += `**评估数量**: ${statistics.evaluated}条\n`;
    md += `**评估耗时**: ${(statistics.evaluationTime / 1000).toFixed(2)}秒\n\n`;

    md += `---\n\n`;

    // 总体统计
    md += `## 📈 总体统计\n\n`;
    md += `\`\`\`\n`;
    md += `总推送数:   ${statistics.total}条\n`;
    md += `已评估:     ${statistics.evaluated}条\n`;
    md += `跳过:       ${statistics.skipped}条\n`;
    md += `平均评分:   ${statistics.avgScore}/100\n`;
    md += `评估耗时:   ${statistics.evaluationTime}ms (平均${Math.round(statistics.evaluationTime / statistics.evaluated)}ms/条)\n`;
    md += `\`\`\`\n\n`;

    // 质量分布
    md += `### 质量分布\n\n`;
    md += `| 类别 | 数量 | 占比 |\n`;
    md += `|------|------|------|\n`;
    md += `| 🏆 高价值 | ${statistics.highValue}条 | ${Math.round(statistics.highValue * 100 / statistics.evaluated)}% |\n`;
    md += `| ⚠️ 中等 | ${statistics.mediumValue}条 | ${Math.round(statistics.mediumValue * 100 / statistics.evaluated)}% |\n`;
    md += `| ❌ 低价值 | ${statistics.lowValue}条 | ${Math.round(statistics.lowValue * 100 / statistics.evaluated)}% |\n\n`;

    // 过滤建议
    md += `### 过滤建议\n\n`;
    md += `| 建议 | 数量 | 占比 |\n`;
    md += `|------|------|------|\n`;
    md += `| ✅ 保留 | ${statistics.kept}条 | ${Math.round(statistics.kept * 100 / statistics.evaluated)}% |\n`;
    md += `| ❌ 过滤 | ${statistics.filtered}条 | ${Math.round(statistics.filtered * 100 / statistics.evaluated)}% |\n\n`;

    // 按来源分析
    md += `## 📊 按RSS源分析\n\n`;
    md += `| 排名 | RSS源 | 推送数 | 平均分 | 过滤率 | 高/中/低 | 评级 |\n`;
    md += `|------|-------|--------|--------|--------|----------|------|\n`;

    const sortedSources = Object.entries(bySource).sort((a, b) => b[1].avgScore - a[1].avgScore);
    sortedSources.forEach(([source, stats], index) => {
      const filterRate = Math.round(stats.filtered * 100 / stats.total);
      const quality = stats.avgScore >= 70 ? '🏆 优秀' : stats.avgScore >= 55 ? '⚠️ 一般' : '❌ 较差';
      const distribution = `${stats.highValue}/${stats.mediumValue}/${stats.lowValue}`;
      md += `| ${index + 1} | ${source} | ${stats.total} | ${stats.avgScore} | ${filterRate}% | ${distribution} | ${quality} |\n`;
    });
    md += `\n`;

    // 详细分析
    md += `## 🔍 详细分析\n\n`;

    // 低价值内容
    md += `### ❌ 低价值内容（建议过滤）\n\n`;
    const lowValueItems = details.filter(d => d.result.shouldFilter);
    if (lowValueItems.length === 0) {
      md += `✅ 没有低价值内容需要过滤\n\n`;
    } else {
      lowValueItems.forEach(({ news, result }) => {
        md += `**[${result.score}分] ${news.title}**\n`;
        md += `- 来源: ${news.source.split(':')[0]}\n`;
        md += `- 理由: ${result.reason}\n`;
        md += `- 标签: ${result.tags.join(', ')}\n\n`;
      });
    }

    // 高价值内容
    md += `### ✅ 高价值内容（保留）\n\n`;
    const highValueItems = details.filter(d => !d.result.shouldFilter && d.result.score >= 65);
    if (highValueItems.length === 0) {
      md += `⚠️ 没有找到高价值内容\n\n`;
    } else {
      highValueItems.forEach(({ news, result }) => {
        md += `**[${result.score}分] ${news.title}**\n`;
        md += `- 来源: ${news.source.split(':')[0]}\n`;
        md += `- 理由: ${result.reason}\n`;
        md += `- 维度: 新闻${result.dimensions.newsValue} 实用${result.dimensions.practicality} 密度${result.dimensions.density}\n\n`;
      });
    }

    // 优化建议
    md += `## 💡 优化建议\n\n`;

    const poorSources = sortedSources.filter(([_, stats]) => stats.avgScore < 55 || stats.filtered / stats.total > 0.6);
    if (poorSources.length > 0) {
      md += `### 建议移除或降权的RSS源\n\n`;
      poorSources.forEach(([source, stats]) => {
        const filterRate = Math.round(stats.filtered * 100 / stats.total);
        md += `- **${source}**: 平均${stats.avgScore}分，过滤率${filterRate}%\n`;
      });
      md += `\n`;
    }

    const goodSources = sortedSources.filter(([_, stats]) => stats.avgScore >= 70);
    if (goodSources.length > 0) {
      md += `### 表现优秀的RSS源\n\n`;
      goodSources.forEach(([source, stats]) => {
        md += `- **${source}**: 平均${stats.avgScore}分，保持或提高权重\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
    md += `*报告由质量评估工具自动生成*\n`;

    return md;
  }
}
