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
  currentSourceIndex: number; // 当前使用的RSS源索引（多源轮换） | Current RSS source index for rotation
  dynamicPoolSize: number | null; // 动态获取的poolSize（缓存） | Dynamically fetched poolSize (cached)
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

      // 获取当前使用的RSS源（支持多源轮换）
      const currentRssSource = this.getCurrentRssSource(job);

      const request: NewsProcessRequest = {
        category: job.config.category,
        dataSource: job.config.dataSource,
        rssSource: currentRssSource,
        processor: job.config.processor,
        renderer: job.config.renderer,
        index: candidate.index,
        options: job.config.options,
        context: candidate.context
      };

      console.log(`🕒 定时任务 ${job.config.id} 准备推送 source=${currentRssSource} fingerprint=${candidate.fingerprint} index=${candidate.index}`);

      // 对于device渲染器，先获取AX优化后的文本内容
      let processedContent: Record<string, any> | undefined = undefined;
      if (request.renderer === 'device' && request.processor !== 'passthrough') {
        try {
          console.log('📝 先获取AX优化后的文本内容...');
          const jsonRequest = {
            ...request,
            renderer: 'json' as const,
            options: {
              ...request.options,
              force: false  // 使用缓存加速
            }
          };
          const jsonResult = await processNews(jsonRequest);

          if (jsonResult.result && typeof jsonResult.result === 'object') {
            processedContent = {
              title: (jsonResult.result as any).title || candidate.context.title,
              message: (jsonResult.result as any).message,
              summary: (jsonResult.result as any).summary,
              source: (jsonResult.result as any).source || candidate.context.source,
              signature: (jsonResult.result as any).signature,
              link: (jsonResult.result as any).link || candidate.context.link
            };
            console.log('✅ AX优化内容已提取');
          }
        } catch (jsonError) {
          console.warn('⚠️ 获取AX优化内容失败:', jsonError);
        }
      }

      const result = await processNews(request);
      console.log(`✅ 定时任务 ${job.config.id} 成功，缓存:${result.cacheHit ? '命中' : '未命中'} 来源:${result.cacheSource}`);

      // 提取原始RSS内容
      const rawContent = {
        title: candidate.context.title,
        link: candidate.context.link,
        publishTime: candidate.context.publishTime,
        source: candidate.context.source,
        fingerprint: candidate.fingerprint
      };

      // 如果没有预先提取，尝试从result中提取
      if (!processedContent && result.result) {
        if (Buffer.isBuffer(result.result)) {
          // 设备渲染器返回Buffer,不记录
          processedContent = { note: 'Image buffer not stored' };
        } else if (typeof result.result === 'object') {
          processedContent = {
            title: (result.result as any).title || candidate.context.title,
            message: (result.result as any).message,
            summary: (result.result as any).summary,
            source: (result.result as any).source || candidate.context.source,
            signature: (result.result as any).signature,
            link: (result.result as any).link || candidate.context.link
          };
        }
      }

      await this.postgres.recordPushResult({
        jobId: job.config.id,
        fingerprint: candidate.fingerprint,
        title: candidate.context.title,
        link: candidate.context.link,
        category: candidate.context.category,
        source: candidate.context.source,
        metadata: {
          publishTime: candidate.context.publishTime,
          index: candidate.index,
          rssSource: currentRssSource
        },
        result: {
          workflow: result.workflow,
          cache: result.cacheSource
        },
        rawContent,
        processedContent: processedContent || undefined
      });

      this.markIndexUsed(job, candidate.index);

      // 轮换到下一个RSS源（多源模式）
      await this.rotateRssSource(job);

      job.state.consecutiveFailures = 0;
    } catch (error) {
      job.state.consecutiveFailures += 1;
      console.error(`❌ 定时任务 ${job.config.id} 执行失败 (连续失败 ${job.state.consecutiveFailures} 次):`, error);

      const effectivePoolSize = this.getEffectivePoolSize(job);
      if (job.state.consecutiveFailures >= effectivePoolSize) {
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

    // 获取当前RSS源（支持多源轮换）
    const currentRssSource = this.getCurrentRssSource(job);

    // 支持动态poolSize：如果poolSize=-1，则获取RSS源的全部条目
    const configPoolSize = job.config.indexStrategy.poolSize;
    const fetchCount = configPoolSize === -1
      ? 100 // 动态模式：获取足够多的条目（最多100条）
      : Math.max(configPoolSize * DEFAULT_FETCH_MULTIPLIER, DEFAULT_MIN_FETCH_COUNT);

    try {
      const rawItems: RawDataItem[] = await dataSourceModule.fetchRawData({
        category: job.config.category,
        source: currentRssSource,
        startIndex: 0,
        count: fetchCount
      });

      if (!rawItems || rawItems.length === 0) {
        return this.fallbackCandidate(job);
      }

      // 动态poolSize模式：缓存实际获取到的条目数量
      if (configPoolSize === -1) {
        job.state.dynamicPoolSize = rawItems.length;
        console.log(`📊 动态poolSize已更新: ${rawItems.length} (来源: ${currentRssSource})`);
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

      // least-pushed-with-cooldown 策略：应用过滤逻辑
      const strategy = job.config.indexStrategy;
      let filtered = scored;

      if (strategy.type === 'least-pushed-with-cooldown') {
        const cooldownHours = strategy.cooldownHours ?? 6;
        const maxPushCount = strategy.maxPushCount ?? 3;
        const now = Date.now();
        const cooldownMs = cooldownHours * 60 * 60 * 1000;

        console.log(`🔍 应用冷却过滤: 冷却时间=${cooldownHours}小时, 最大推送次数=${maxPushCount}`);

        // 过滤1: 时间冷却 + 推送次数上限
        const strictFiltered = scored.filter(c => {
          if (c.pushCount >= maxPushCount) return false;
          if (!c.lastPushedAt) return true;
          const timeSince = now - new Date(c.lastPushedAt).getTime();
          return timeSince >= cooldownMs;
        });

        if (strictFiltered.length > 0) {
          filtered = strictFiltered;
          console.log(`✅ 严格过滤后剩余 ${filtered.length} 条候选新闻`);
        } else {
          // 降级1: 只使用时间冷却，忽略推送次数限制
          const cooldownFiltered = scored.filter(c => {
            if (!c.lastPushedAt) return true;
            const timeSince = now - new Date(c.lastPushedAt).getTime();
            return timeSince >= cooldownMs;
          });

          if (cooldownFiltered.length > 0) {
            filtered = cooldownFiltered;
            console.log(`⚠️ 降级过滤（忽略次数限制）: 剩余 ${filtered.length} 条候选`);
          } else {
            // 降级2: 减半冷却时间
            const relaxedFiltered = scored.filter(c => {
              if (!c.lastPushedAt) return true;
              const timeSince = now - new Date(c.lastPushedAt).getTime();
              return timeSince >= cooldownMs / 2;
            });

            if (relaxedFiltered.length > 0) {
              filtered = relaxedFiltered;
              console.log(`⚠️ 降级过滤（减半冷却时间）: 剩余 ${filtered.length} 条候选`);
            } else {
              // 降级3: 使用全部候选，但会在后面触发RSS源切换
              console.log(`⚠️ 所有过滤失败，使用全部候选，建议切换RSS源`);
            }
          }
        }
      }

      // 使用智能排序：推送次数少的优先，其次按时间新旧，最后按索引
      filtered.sort((a, b) => {
        if (a.pushCount !== b.pushCount) {
          return a.pushCount - b.pushCount;
        }
        const timeA = a.publishTime ? new Date(a.publishTime).getTime() : 0;
        const timeB = b.publishTime ? new Date(b.publishTime).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        return a.index - b.index;
      });

      // 选择最终候选
      let chosen: CandidateArticle;

      if (strategy.type === 'least-pushed' || strategy.type === 'least-pushed-with-cooldown') {
        chosen = filtered[0];

        // 保护机制: 如果选中的候选pushCount超过maxPushCount,强制切换RSS源
        if (strategy.type === 'least-pushed-with-cooldown') {
          const maxPushCount = strategy.maxPushCount ?? 3;
          if (chosen.pushCount >= maxPushCount) {
            console.log(`⛔ 所有候选pushCount都超过${maxPushCount},强制切换RSS源避免重复`);
            await this.rotateRssSource(job);
            throw new Error(`当前RSS源所有新闻已推送${maxPushCount}次以上,已切换到下一个源`);
          }
        }

        const title = chosen.context.title?.substring(0, 30) || 'N/A';
        console.log(`🎯 智能选择: 推送${chosen.pushCount}次 "${title}"`);
      } else {
        const targetIndex = this.getNextCandidateIndex(job);
        const foundByIndex = filtered.find(c => c.index === targetIndex);
        chosen = foundByIndex || filtered[0];
      }

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

    // 获取有效的poolSize（支持动态poolSize）
    const effectivePoolSize = this.getEffectivePoolSize(job);

    switch (strategy.type) {
      case 'random': {
        const candidate = Math.floor(Math.random() * effectivePoolSize);
        return candidate;
      }
      case 'shuffle': {
        if (state.shuffledOrder.length === 0 || state.shuffledPointer >= state.shuffledOrder.length) {
          state.shuffledOrder = createShuffledIndices(effectivePoolSize);
          state.shuffledPointer = 0;
        }
        return state.shuffledOrder[state.shuffledPointer];
      }
      case 'sequential':
      default: {
        return state.nextIndex % effectivePoolSize;
      }
    }
  }

  private markIndexUsed(job: SchedulerJobInstance, index: number): void {
    const strategy = job.config.indexStrategy;
    const state = job.state;

    state.lastIndex = index;

    // 获取有效的poolSize（支持动态poolSize）
    const effectivePoolSize = this.getEffectivePoolSize(job);

    switch (strategy.type) {
      case 'random':
        break;
      case 'shuffle':
        state.shuffledPointer += 1;
        break;
      case 'sequential':
      default:
        state.nextIndex = (index + 1) % effectivePoolSize;
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

  /**
   * 获取当前使用的RSS源
   * 支持单源模式（rssSource）和多源轮换模式（rssSources[]）
   */
  private getCurrentRssSource(job: SchedulerJobInstance): string {
    // 多源轮换模式
    if (job.config.rssSources && job.config.rssSources.length > 0) {
      const index = job.state.currentSourceIndex % job.config.rssSources.length;
      return job.config.rssSources[index];
    }
    // 单源模式（向后兼容）
    return job.config.rssSource || 'solidot';
  }

  /**
   * 轮换到下一个RSS源（仅多源模式）
   * 支持持久化到数据库
   */
  private async rotateRssSource(job: SchedulerJobInstance): Promise<void> {
    const strategy = job.config.indexStrategy;
    const shouldRotate = strategy.type === 'least-pushed-with-cooldown'
      ? (strategy.rotateAfterEachPush ?? true)
      : false;

    if (!shouldRotate) return;

    if (job.config.rssSources && job.config.rssSources.length > 1) {
      const oldIndex = job.state.currentSourceIndex;
      const newIndex = (oldIndex + 1) % job.config.rssSources.length;
      job.state.currentSourceIndex = newIndex;

      console.log(`🔄 RSS源轮换: ${job.config.rssSources[oldIndex]} -> ${job.config.rssSources[newIndex]} (${newIndex + 1}/${job.config.rssSources.length})`);

      // 持久化到数据库
      try {
        await this.postgres.updateJobSourceIndex(job.config.id, newIndex);
        console.log(`💾 RSS源索引已持久化: ${newIndex}`);
      } catch (error) {
        console.warn(`⚠️ RSS源索引持久化失败: ${error}`);
      }
    }
  }

  /**
   * 获取有效的poolSize（支持动态poolSize）
   * poolSize=-1 表示动态获取RSS源的实际条目数
   */
  private getEffectivePoolSize(job: SchedulerJobInstance): number {
    const configPoolSize = job.config.indexStrategy.poolSize;

    // 如果配置为-1，使用动态缓存的poolSize
    if (configPoolSize === -1) {
      return job.state.dynamicPoolSize || 10; // fallback到10
    }

    return configPoolSize;
  }
}

function createJobInstance(job: NormalizedSchedulerJob): SchedulerJobInstance {
  // 从数据库记录中恢复currentSourceIndex
  const currentSourceIndex = typeof (job as any).currentSourceIndex === 'number'
    ? (job as any).currentSourceIndex
    : 0;

  return {
    config: job,
    state: {
      nextIndex: job.indexStrategy.startIndex,
      lastIndex: null,
      shuffledOrder: [],
      shuffledPointer: 0,
      running: false,
      consecutiveFailures: 0,
      currentSourceIndex, // 从数据库恢复或默认0
      dynamicPoolSize: null
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
    rssSources: record.rssSources, // 多源轮换支持
    currentSourceIndex: record.currentSourceIndex || 0, // RSS源轮换索引
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
  // 支持poolSize=-1表示动态获取RSS源实际条目数 | Support poolSize=-1 for dynamic RSS feed item count
  const poolSize = strategy?.poolSize === -1
    ? -1
    : Math.max(1, strategy?.poolSize ?? 10);

  const startIndexValue = strategy?.startIndex ?? 0;
  // 动态poolSize模式下，startIndex直接使用0
  const startIndex = poolSize === -1
    ? 0
    : ((startIndexValue % poolSize) + poolSize) % poolSize;

  const validTypes = ['sequential', 'shuffle', 'random', 'least-pushed', 'least-pushed-with-cooldown'];
  const type: SchedulerIndexType = validTypes.includes(strategy?.type as SchedulerIndexType)
    ? (strategy.type as SchedulerIndexType)
    : 'shuffle';

  return {
    type,
    poolSize,
    startIndex,
    cooldownHours: strategy?.cooldownHours ?? 6,
    maxPushCount: strategy?.maxPushCount ?? 3,
    rotateAfterEachPush: strategy?.rotateAfterEachPush ?? true
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
    rssSource: config.rssSource, // 单源模式（可选，向后兼容）
    rssSources: config.rssSources, // 多源轮换模式（可选）| Multiple sources rotation (optional)
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
