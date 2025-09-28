import { processNews, computeNewsFingerprint } from './news-processing-service.js';
import type {
  NewsProcessRequest,
  NewsPushContext,
  NewsSchedulerJobConfig,
  NewsSchedulerJobRecord,
  RequiredSchedulerIndexStrategy
} from './news-types.js';
import { dataSourceRegistry } from '../react-widgets/core/data-source-modules.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { RawDataItem } from '../react-widgets/core/modular-architecture.js';

type SchedulerIndexType = RequiredSchedulerIndexStrategy['type'];

interface NormalizedSchedulerJob extends NewsSchedulerJobRecord {
  options: NewsProcessRequest['options'];
  indexStrategy: RequiredSchedulerIndexStrategy;
}

interface SchedulerJobState {
  nextIndex: number;
  lastIndex: number | null;
  shuffledOrder: number[];
  shuffledPointer: number;
  running: boolean;
  consecutiveFailures: number;
}

interface SchedulerJobInstance {
  config: NormalizedSchedulerJob;
  state: SchedulerJobState;
  timer: NodeJS.Timeout | null;
}

export interface SchedulerSummary {
  id: string;
  name?: string;
  description?: string;
  nextIndex: number;
  intervalMs: number;
  lastIndex: number | null;
  consecutiveFailures: number;
  indexStrategy: RequiredSchedulerIndexStrategy;
  enabled: boolean;
}

interface CandidateArticle {
  index: number;
  fingerprint: string;
  publishTime?: string;
  pushCount: number;
  lastPushedAt?: string | null;
  context: NewsPushContext;
}

const DEFAULT_FETCH_MULTIPLIER = 3;
const DEFAULT_MIN_FETCH_COUNT = 8;

export class NewsScheduler {
  private jobs: Map<string, SchedulerJobInstance> = new Map();
  private started = false;
  private readonly postgres = getPostgresDatabase();

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.postgres.initialize();
    await this.reloadJobs();
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      job.state.running = false;
    }
    this.started = false;
  }

  async reloadJobs(): Promise<void> {
    const jobRecords = await this.postgres.getSchedulerJobs();
    if (jobRecords.length === 0) {
      await this.postgres.upsertSchedulerJob({
        id: 'technology-solidot-default',
        name: '默认科技资讯轮播',
        description: '默认的Solidot科技资讯定时推送任务',
        category: 'technology',
        dataSource: 'rss',
        rssSource: 'solidot',
        processor: 'ax-optimized',
        renderer: 'device',
        intervalMs: 30 * 60 * 1000,
        initialDelayMs: 0,
        options: { border: '0' },
        indexStrategy: { type: 'shuffle', poolSize: 10, startIndex: 0 },
        enabled: true
      });
      return this.reloadJobs();
    }
    const enabledJobs = jobRecords.filter((record) => record.enabled !== false);

    const seen = new Set<string>();

    for (const record of enabledJobs) {
      const normalized = normalizeRecord(record);
      seen.add(normalized.id);
      const existing = this.jobs.get(normalized.id);
      if (existing) {
        existing.config = normalized;
      } else {
        const instance = createJobInstance(normalized);
        this.jobs.set(normalized.id, instance);
        if (this.started) {
          this.queueJob(instance, normalized.initialDelayMs);
        }
      }
    }

    // 停止已被禁用或删除的任务
    for (const [jobId, job] of this.jobs) {
      if (!seen.has(jobId)) {
        if (job.timer) {
          clearTimeout(job.timer);
        }
        this.jobs.delete(jobId);
      }
    }
  }

  async upsertJob(config: NewsSchedulerJobConfig): Promise<NormalizedSchedulerJob> {
    const record = normalizeInputConfig(config);
    await this.postgres.upsertSchedulerJob(record);
    await this.reloadJobs();
    const job = this.jobs.get(record.id);
    if (!job) {
      throw new Error(`任务 ${record.id} 未能加载`);
    }
    return job.config;
  }

  async deleteJob(id: string): Promise<void> {
    await this.postgres.deleteSchedulerJob(id);
    await this.reloadJobs();
  }

  async setJobEnabled(id: string, enabled: boolean): Promise<void> {
    await this.postgres.setSchedulerJobEnabled(id, enabled);
    await this.reloadJobs();
  }

  getSummaries(): SchedulerSummary[] {
    const summaries: SchedulerSummary[] = [];
    for (const [id, job] of this.jobs) {
      summaries.push({
        id,
        name: job.config.name,
        description: job.config.description,
        nextIndex: job.state.nextIndex,
        intervalMs: job.config.intervalMs,
        lastIndex: job.state.lastIndex,
        consecutiveFailures: job.state.consecutiveFailures,
        indexStrategy: job.config.indexStrategy,
        enabled: true
      });
    }
    return summaries;
  }

  async triggerJob(jobId: string, overrideIndex?: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`未找到定时任务: ${jobId}`);
    }
    await this.runJob(job, overrideIndex);
  }

  private queueJob(job: SchedulerJobInstance, delayMs: number): void {
    if (!this.started) return;

    const actualDelay = Math.max(0, delayMs);
    job.timer = setTimeout(async () => {
      await this.runJob(job);
      this.queueJob(job, job.config.intervalMs);
    }, actualDelay);
  }

  private async runJob(job: SchedulerJobInstance, overrideIndex?: number): Promise<void> {
    if (job.state.running) {
      console.warn(`⚠️ 定时任务 ${job.config.id} 尚未完成，跳过本次执行`);
      return;
    }

    job.state.running = true;

    try {
      const candidate = await this.selectCandidate(job, overrideIndex);
      if (!candidate) {
        throw new Error('无法获取有效的新闻候选');
      }

      const request: NewsProcessRequest = {
        category: job.config.category,
        dataSource: job.config.dataSource,
        rssSource: job.config.rssSource,
        processor: job.config.processor,
        renderer: job.config.renderer,
        index: candidate.index,
        options: job.config.options,
        context: candidate.context
      };

      console.log(`🕒 定时任务 ${job.config.id} 准备推送 fingerprint=${candidate.fingerprint} index=${candidate.index}`);

      const result = await processNews(request);
      console.log(`✅ 定时任务 ${job.config.id} 成功，缓存:${result.cacheHit ? '命中' : '未命中'} 来源:${result.cacheSource}`);

      await this.postgres.recordPushResult({
        jobId: job.config.id,
        fingerprint: candidate.fingerprint,
        title: candidate.context.title,
        link: candidate.context.link,
        category: candidate.context.category,
        source: candidate.context.source,
        metadata: {
          publishTime: candidate.context.publishTime,
          index: candidate.index
        },
        result: {
          workflow: result.workflow,
          cache: result.cacheSource
        }
      });

      this.markIndexUsed(job, candidate.index);
      job.state.consecutiveFailures = 0;
    } catch (error) {
      job.state.consecutiveFailures += 1;
      console.error(`❌ 定时任务 ${job.config.id} 执行失败 (连续失败 ${job.state.consecutiveFailures} 次):`, error);
      if (job.state.consecutiveFailures >= job.config.indexStrategy.poolSize) {
        this.resetIndexState(job);
      }
    } finally {
      job.state.running = false;
    }
  }

  private async selectCandidate(job: SchedulerJobInstance, overrideIndex?: number): Promise<CandidateArticle | null> {
    if (typeof overrideIndex === 'number') {
      const context = this.buildContextFromIndex(job.config, overrideIndex);
      return {
        index: overrideIndex,
        fingerprint: context.fingerprint!,
        publishTime: context.publishTime,
        pushCount: 0,
        context
      };
    }

    const dataSourceModule: any = dataSourceRegistry.get(job.config.dataSource);
    if (!dataSourceModule || typeof dataSourceModule.fetchRawData !== 'function') {
      console.warn(`⚠️ 数据源 ${job.config.dataSource} 不支持fetchRawData，使用索引备选`);
      return this.fallbackCandidate(job);
    }

    const fetchCount = Math.max(job.config.indexStrategy.poolSize * DEFAULT_FETCH_MULTIPLIER, DEFAULT_MIN_FETCH_COUNT);
    try {
      const rawItems: RawDataItem[] = await dataSourceModule.fetchRawData({
        category: job.config.category,
        source: job.config.rssSource,
        startIndex: 0,
        count: fetchCount
      });

      if (!rawItems || rawItems.length === 0) {
        return this.fallbackCandidate(job);
      }

      const candidates = rawItems.map((item, idx) => {
        const originalIndex = item.metadata?.originalIndex ?? item.metadata?.index ?? idx;
        const fingerprint = computeNewsFingerprint({
          title: item.title,
          link: item.link,
          publishTime: item.publishTime,
          source: item.source,
          category: item.category,
          fallback: `${job.config.dataSource}:${job.config.rssSource}:${originalIndex}`
        });
        const context: NewsPushContext = {
          title: item.title,
          link: item.link,
          publishTime: item.publishTime,
          source: item.source,
          category: item.category,
          fingerprint,
          rawIndex: originalIndex
        };
        return { index: originalIndex, fingerprint, publishTime: item.publishTime, context };
      });

      const stats = await this.postgres.getPushStatsForFingerprints(candidates.map((c) => c.fingerprint));

      const scored: CandidateArticle[] = candidates.map((candidate) => {
        const stat = stats[candidate.fingerprint];
        const pushCount = stat?.pushCount ?? 0;
        const lastPushedAt = stat?.lastPushedAt ?? null;
        return {
          index: candidate.index,
          fingerprint: candidate.fingerprint,
          publishTime: candidate.publishTime,
          pushCount,
          lastPushedAt,
          context: candidate.context
        };
      });

      scored.sort((a, b) => {
        if (a.pushCount !== b.pushCount) {
          return a.pushCount - b.pushCount;
        }
        const timeA = a.publishTime ? new Date(a.publishTime).getTime() : 0;
        const timeB = b.publishTime ? new Date(b.publishTime).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA; // 最新优先
        }
        return a.index - b.index;
      });

      const chosen = scored[0];
      if (!chosen.context.fingerprint) {
        chosen.context.fingerprint = chosen.fingerprint;
      }
      return chosen;
    } catch (error) {
      console.warn(`⚠️ 获取候选新闻失败，使用索引备选: ${error instanceof Error ? error.message : error}`);
      return this.fallbackCandidate(job);
    }
  }

  private fallbackCandidate(job: SchedulerJobInstance): CandidateArticle | null {
    const fallbackIndex = this.getNextCandidateIndex(job);
    const context = this.buildContextFromIndex(job.config, fallbackIndex);
    return {
      index: fallbackIndex,
      fingerprint: context.fingerprint!,
      publishTime: context.publishTime,
      pushCount: 0,
      context
    };
  }

  private buildContextFromIndex(job: NormalizedSchedulerJob, index: number): NewsPushContext {
    const fingerprint = computeNewsFingerprint({
      title: undefined,
      link: undefined,
      publishTime: undefined,
      source: job.rssSource,
      category: job.category,
      fallback: `${job.dataSource}:${job.rssSource}:${index}`
    });

    return {
      fingerprint,
      source: job.rssSource,
      category: job.category,
      rawIndex: index
    };
  }

  private getNextCandidateIndex(job: SchedulerJobInstance): number {
    const strategy = job.config.indexStrategy;
    const state = job.state;

    switch (strategy.type) {
      case 'random': {
        const candidate = Math.floor(Math.random() * strategy.poolSize);
        return candidate;
      }
      case 'shuffle': {
        if (state.shuffledOrder.length === 0 || state.shuffledPointer >= state.shuffledOrder.length) {
          state.shuffledOrder = createShuffledIndices(strategy.poolSize);
          state.shuffledPointer = 0;
        }
        return state.shuffledOrder[state.shuffledPointer];
      }
      case 'sequential':
      default: {
        return state.nextIndex % strategy.poolSize;
      }
    }
  }

  private markIndexUsed(job: SchedulerJobInstance, index: number): void {
    const strategy = job.config.indexStrategy;
    const state = job.state;

    state.lastIndex = index;

    switch (strategy.type) {
      case 'random':
        break;
      case 'shuffle':
        state.shuffledPointer += 1;
        break;
      case 'sequential':
      default:
        state.nextIndex = (index + 1) % strategy.poolSize;
        break;
    }
  }

  private resetIndexState(job: SchedulerJobInstance): void {
    const strategy = job.config.indexStrategy;
    job.state.nextIndex = strategy.startIndex;
    job.state.lastIndex = null;
    job.state.shuffledOrder = [];
    job.state.shuffledPointer = 0;
    job.state.consecutiveFailures = 0;
  }
}

function createJobInstance(job: NormalizedSchedulerJob): SchedulerJobInstance {
  return {
    config: job,
    state: {
      nextIndex: job.indexStrategy.startIndex,
      lastIndex: null,
      shuffledOrder: [],
      shuffledPointer: 0,
      running: false,
      consecutiveFailures: 0
    },
    timer: null
  };
}

function normalizeRecord(record: any): NormalizedSchedulerJob {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    category: record.category,
    dataSource: record.dataSource,
    rssSource: record.rssSource,
    processor: record.processor,
    renderer: record.renderer,
    intervalMs: record.intervalMs,
    initialDelayMs: record.initialDelayMs,
    options: record.options || {},
    indexStrategy: normalizeIndexStrategy(record.indexStrategy as RequiredSchedulerIndexStrategy),
    enabled: record.enabled !== false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeIndexStrategy(strategy: RequiredSchedulerIndexStrategy): RequiredSchedulerIndexStrategy {
  const poolSize = Math.max(1, strategy?.poolSize ?? 10);
  const startIndexValue = strategy?.startIndex ?? 0;
  const startIndex = ((startIndexValue % poolSize) + poolSize) % poolSize;
  const type: SchedulerIndexType = ['sequential', 'shuffle', 'random'].includes(strategy?.type as SchedulerIndexType)
    ? (strategy.type as SchedulerIndexType)
    : 'shuffle';

  return {
    type,
    poolSize,
    startIndex
  };
}

function normalizeInputConfig(config: NewsSchedulerJobConfig): NewsSchedulerJobRecord {
  if (!config.id) {
    throw new Error('定时任务配置缺少 id');
  }

  const enabled = config.enabled ?? true;
  const intervalMs = config.intervalMs ?? (config.intervalMinutes ? config.intervalMinutes * 60_000 : 30 * 60_000);
  const initialDelayMs = config.initialDelayMs ?? (config.initialDelayMinutes ? config.initialDelayMinutes * 60_000 : 0);
  const indexStrategy = normalizeIndexStrategy({
    type: config.indexStrategy?.type || 'shuffle',
    poolSize: config.indexStrategy?.poolSize ?? 10,
    startIndex: config.indexStrategy?.startIndex ?? 0
  });

  return {
    id: config.id,
    name: config.name || config.description,
    description: config.description,
    category: config.category || 'technology',
    dataSource: config.dataSource || 'rss',
    rssSource: config.rssSource || 'solidot',
    processor: config.processor || 'ax-optimized',
    renderer: config.renderer || 'device',
    intervalMs,
    initialDelayMs,
    options: config.options || { border: '0' },
    indexStrategy,
    enabled
  };
}

function createShuffledIndices(poolSize: number): number[] {
  const indices = Array.from({ length: poolSize }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export async function buildSchedulerFromDatabase(): Promise<NewsScheduler> {
  const scheduler = new NewsScheduler();
  await scheduler.start();
  console.log(`🗞️ 新闻定时任务管理器已启动，共 ${scheduler.getSummaries().length} 个任务`);
  return scheduler;
}
