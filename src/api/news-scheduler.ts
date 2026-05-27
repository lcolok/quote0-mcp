import { processNews, computeNewsFingerprint } from './news-processing-service.js';
import { devicePusher } from './device-pusher.js';
import type {
  FullNewsProcessingResult,
  NewsProcessRequest,
  NewsPushContext,
  NewsSchedulerJobConfig,
  NewsSchedulerJobRecord,
  RequiredSchedulerIndexStrategy
} from './news-types.js';
import { dataSourceRegistry } from '../react-widgets/core/data-source-modules.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { RawDataItem } from '../react-widgets/core/modular-architecture.js';
import React from 'react';
import { weatherPlugin } from '../react-widgets/plugins/weather-plugin.js';
import { SatoriWeatherWidget } from '../react-widgets/components/SatoriWeatherWidget.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../react-widgets/core/device-constants.js';
import { MindResetDeviceClient } from '../image-sender/services/api/device-client.js';

function sanitizeWeatherData(data: any): WeatherData {
  const toStr = (v: any, fallback?: string): string | undefined => {
    if (typeof v === 'string' && v.trim()) return v;
    return fallback;
  };
  return {
    ...data,
    city: toStr(data.city, '广州') as string,
    realCity: toStr(data.realCity),
    district: toStr(data.district),
    province: toStr(data.province),
    weather: toStr(data.weather, '晴') as string,
    windDirection: toStr(data.windDirection),
    windPower: toStr(data.windPower),
  };
}
import type { WeatherData } from '../react-widgets/types.js';
interface RetryOptions {
  retries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 5,
    initialDelayMs = 500,
    backoffFactor = 2,
    maxDelayMs = 10_000,
    onRetry,
  } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }

      if (onRetry) {
        try {
          onRetry(error, attempt);
        } catch {
          // ignore logging errors
        }
      }

      const jitter = Math.random() * delay * 0.2;
      const waitTime = Math.min(delay + jitter, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }
}
import { getSchedulerStrategyConfig, type SchedulerStrategyConfig, type StrategyLayerKey } from './scheduler-strategy-config.js';

type SchedulerIndexType = RequiredSchedulerIndexStrategy['type'];

interface NormalizedSchedulerJob extends NewsSchedulerJobRecord {
  options: NewsProcessRequest['options'];
  indexStrategy: RequiredSchedulerIndexStrategy;
}

interface SchedulerJobState {
  running: boolean;
  consecutiveFailures: number;
  currentSourceIndex: number; // 当前使用的RSS源索引（多源轮换） | Current RSS source index for rotation
  dynamicPoolSize: number | null; // 动态获取的poolSize（缓存） | Dynamically fetched poolSize (cached)
  nextIndex: number;
  lastIndex: number | null;
  shuffledOrder: number[];
  shuffledPointer: number;
  recentFingerprints: string[];
  failureCount: Record<string, number>;
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

interface LayerAttemptLog {
  layer: StrategyLayerKey;
  reason: string;
  stats?: Record<string, unknown>;
}

interface LayerSelectionResult {
  candidate: CandidateArticle;
  layer: StrategyLayerKey;
  isFallback: boolean;
  pushCountBefore: number;
  coolingElapsedMs?: number;
  reasons: LayerAttemptLog[];
  strategySnapshot: Record<string, any>;
  poolSize: number;
  totalCandidates: number;
}

interface CandidateSelectionOutcome {
  selection: LayerSelectionResult | null;
  attempts: LayerAttemptLog[];
  totalCandidates: number;
  poolSize: number;
}

const DEFAULT_FETCH_MULTIPLIER = 3;
const DEFAULT_MIN_FETCH_COUNT = 8;

export class NewsScheduler {
  private jobs: Map<string, SchedulerJobInstance> = new Map();
  private started = false;
  private readonly postgres = getPostgresDatabase();
  private strategyConfig: SchedulerStrategyConfig = getSchedulerStrategyConfig();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.strategyConfig = getSchedulerStrategyConfig();
    await retryWithBackoff(async () => {
      await this.postgres.initialize();
    }, {
      retries: 6,
      initialDelayMs: 1000,
      onRetry: (error, attempt) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ PostgreSQL 初始化失败（第 ${attempt} 次重试），等待后台服务就绪...`, message);
      }
    });

    await retryWithBackoff(async () => {
      await this.reloadJobs();
    }, {
      retries: 5,
      initialDelayMs: 1000,
      onRetry: (error, attempt) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ 重新加载调度任务失败（第 ${attempt} 次重试），等待数据库就绪...`, message);
      }
    });
    this.startHeartbeat();
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      job.state.running = false;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.started = false;
  }

  private startHeartbeat(): void {
    // 每5分钟输出一次调度器状态
    this.heartbeatTimer = setInterval(() => {
      const status = Array.from(this.jobs.values()).map(job => ({
        id: job.config.id,
        running: job.state.running,
        failures: job.state.consecutiveFailures,
        nextIndex: job.state.nextIndex
      }));
      console.log(`💓 调度器心跳 - 活跃任务: ${status.length}, 状态:`, JSON.stringify(status));
    }, 5 * 60 * 1000);
  }

  /**
   * 计算任务的延迟时间（支持持久化恢复）
   */
  private calculateDelayForJob(record: any, config: NormalizedSchedulerJob): number {
    const now = Date.now();

    // 如果有 nextRunAt，根据它计算延迟
    if (record.nextRunAt) {
      const nextRunTime = new Date(record.nextRunAt).getTime();
      const delay = nextRunTime - now;

      if (delay > 0) {
        console.log(`📅 从数据库恢复任务 ${config.id} 的下次运行时间: ${new Date(nextRunTime).toISOString()}`);
        return delay;
      } else {
        console.log(`⏰ 任务 ${config.id} 已超时 ${Math.abs(Math.round(delay / 1000))}秒，立即执行`);
        return 0;  // 超时了，立即执行
      }
    }

    // 如果有 lastRunAt，根据它和 intervalMs 计算下次运行时间
    if (record.lastRunAt) {
      const lastRunTime = new Date(record.lastRunAt).getTime();
      const nextRunTime = lastRunTime + config.intervalMs;
      const delay = nextRunTime - now;

      if (delay > 0) {
        console.log(`📅 根据上次运行时间计算任务 ${config.id}: 上次 ${new Date(lastRunTime).toISOString()}, 下次 ${new Date(nextRunTime).toISOString()}`);
        return delay;
      } else {
        console.log(`⏰ 任务 ${config.id} 根据上次运行时间已超时，立即执行`);
        return 0;
      }
    }

    // 没有保存的时间信息，使用初始延迟
    console.log(`🆕 任务 ${config.id} 首次运行，使用初始延迟 ${config.initialDelayMs}ms`);
    return config.initialDelayMs;
  }

  async reloadJobs(): Promise<void> {
    const jobRecords = await this.postgres.getSchedulerJobs();

    // 幂等注册默认 memo 轮播任务（已存在则保留用户修改，不覆盖）
    try {
      await this.postgres.query(`
        INSERT INTO news_scheduler_jobs (
          id, name, description, category, data_source, rss_source, processor, renderer,
          interval_ms, initial_delay_ms, options, index_strategy, enabled
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        'memo-rotation-default',
        '备忘轮播推送',
        '轮播 enabled+ready 的 memo 到墨水屏',
        'memo',
        'memo',
        'memo-rss-placeholder',
        'ax-optimized',
        'device',
        30 * 60 * 1000,
        0,
        JSON.stringify({ border: '0' }),
        JSON.stringify({
          type: 'fair-rotation',
          poolSize: -1,
          startIndex: 0,
          cooldownHours: 0,
          maxPushCount: 999,
          rotateAfterEachPush: true,
          skipEmptySource: false
        }),
        false
      ]);
    } catch (err) {
      console.warn('⚠️ 注册默认 memo 任务失败（非阻塞）:', err);
    }

    if (jobRecords.length === 0) {
      console.log('🆕 数据库中没有调度任务，创建默认任务...');
      
      // 创建默认科技资讯任务（30分钟）
      await this.postgres.upsertSchedulerJob({
        id: 'technology-solidot-default',
        name: '默认科技资讯轮播',
        description: '默认的Solidot科技资讯定时推送任务（30分钟）',
        category: 'technology',
        dataSource: 'rss',
        rssSource: 'solidot',
        processor: 'ax-optimized',
        renderer: 'device',
        intervalMs: 60 * 1000,
        initialDelayMs: 0,
        options: { border: '0' },
        indexStrategy: { type: 'fair-rotation', poolSize: 10, startIndex: 0, cooldownHours: 24, maxPushCount: 5, rotateAfterEachPush: true, skipEmptySource: true },
        enabled: true
      });
      
      // 创建多源RSS轮播任务（1分钟）
      await this.postgres.upsertSchedulerJob({
        id: 'multi-source-rotation',
        name: '多源RSS轮播',
        description: '每1分钟轮播Solidot、36kr、sspai、hackernews四个RSS源',
        category: 'news',
        dataSource: 'rss',
        rssSource: 'solidot',
        processor: 'ax-optimized',
        renderer: 'device',
        intervalMs: 60 * 1000,
        initialDelayMs: 0,
        options: { border: '0' },
        indexStrategy: { type: 'fair-rotation', poolSize: 4, startIndex: 0, cooldownHours: 24, maxPushCount: 5, rotateAfterEachPush: true, skipEmptySource: true },
        enabled: true
      });
      
      console.log('✅ 默认任务创建完成');
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
          // 计算延迟时间（持久化恢复支持）
          const delay = this.calculateDelayForJob(record, normalized);
          console.log(`⏰ 任务 ${normalized.id} 将在 ${Math.round(delay / 1000)}秒 后执行`);
          this.queueJob(instance, delay);
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

  async patchJob(id: string, body: Partial<NewsSchedulerJobConfig>): Promise<NormalizedSchedulerJob> {
    const patch: any = { ...body };
    delete patch.id;

    // 支持 intervalMinutes / initialDelayMinutes 的便捷写法
    if (body.intervalMinutes !== undefined && body.intervalMs === undefined) {
      patch.intervalMs = body.intervalMinutes * 60_000;
    }
    if (body.initialDelayMinutes !== undefined && body.initialDelayMs === undefined) {
      patch.initialDelayMs = body.initialDelayMinutes * 60_000;
    }
    delete patch.intervalMinutes;
    delete patch.initialDelayMinutes;

    await this.postgres.patchSchedulerJob(id, patch);
    await this.reloadJobs();
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`任务 ${id} 未能加载`);
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
    job.timer = setTimeout(() => {
      // 使用Promise链确保即使失败也能继续调度
      this.runJob(job)
        .catch((error) => {
          console.error(`❌ 调度任务执行异常: ${job.config.id}`, error);
          // 记录错误但不中断调度链
        })
        .finally(() => {
          // 无论成功失败，都继续下一次调度
          this.queueJob(job, job.config.intervalMs);
        });
    }, actualDelay);
  }


  private async runJob(job: SchedulerJobInstance, overrideIndex?: number): Promise<void> {
    if (job.state.running) {
      console.warn(`⚠️ 定时任务 ${job.config.id} 尚未完成，跳过本次执行`);
      return;
    }

    this.ensureIndexState(job);
    job.state.running = true;

    // Weather branch: minimal intrusion, bypass RSS pipeline entirely
    if (job.config.dataSource === 'weather') {
      await this.runWeatherJob(job);
      return;
    }

    // Memo branch: fair-rotation push pre-rendered memos to device
    if (job.config.dataSource === 'memo') {
      await this.runMemoJob(job);
      return;
    }

    // Consumer branch: pick from inventory and push to device
    if (job.config.jobRole === 'consumer') {
      await this.runConsumerJob(job);
      return;
    }

    const runStartedAt = new Date();
    const sourceInfo = await this.resolveRunnableSource(job, overrideIndex);
    let currentRssSource = sourceInfo.source;
    let runHistoryId: number | null = null;

    try {
      const fs = await import('fs/promises');
      runHistoryId = await this.postgres.createSchedulerRunHistory({
        jobId: job.config.id,
        runStartedAt,
        layer: overrideIndex !== undefined ? 'override' : undefined,
        source: currentRssSource,
        metadata: {
          overrideIndex: overrideIndex ?? null,
          skippedSources: sourceInfo.skipped,
          strategyVersion: this.strategyConfig.version ?? 'default',
          intervalMs: job.config.intervalMs
        }
      });

      const selectionOutcome = await this.selectCandidate(job, currentRssSource, overrideIndex);
      const selection = selectionOutcome.selection;

      if (!selection) {
        const reason = selectionOutcome.attempts.length
          ? selectionOutcome.attempts.map((item) => `${item.layer}:${item.reason}`).join('|')
          : 'no_candidate';

        if (runHistoryId) {
          try {
            await this.postgres.updateSchedulerRunHistory(runHistoryId, {
              layer: overrideIndex !== undefined ? 'override' : null,
              pushStatus: 'skipped',
              pushReason: reason,
              runFinishedAt: new Date(),
              metadata: {
                selectionAttempts: selectionOutcome.attempts,
                totalCandidates: selectionOutcome.totalCandidates,
                poolSize: selectionOutcome.poolSize
              }
            });
          } catch (historyError) {
            console.warn('⚠️ 更新运行历史失败:', historyError);
          }
        }

        this.incrementFailureCount(job, currentRssSource);
        job.state.consecutiveFailures += 1;

        await this.handlePostRunFailure(job, currentRssSource);
        return;
      }

      const candidate = selection.candidate;

      // producer 用 news renderer（只渲染上传 MinIO 不推送设备）；
      // 但 news renderer 默认 640×384，必须注入设备尺寸 296×152 保持一致
      const isProducer = job.config.jobRole === 'producer';
      const baseOptions = (job.config.options || {}) as Record<string, any>;
      const producerOptions = isProducer
        ? { ...baseOptions, width: baseOptions.width || EINK_DEVICE_WIDTH, height: baseOptions.height || EINK_DEVICE_HEIGHT }
        : baseOptions;

      const request: NewsProcessRequest = {
        category: job.config.category,
        dataSource: job.config.dataSource,
        rssSource: currentRssSource,
        processor: job.config.processor,
        renderer: isProducer ? 'news' : job.config.renderer,
        index: candidate.index,
        options: producerOptions,
        context: candidate.context
      };

      console.log(`🕒 定时任务 ${job.config.id} 准备推送 layer=${selection.layer} source=${currentRssSource} fingerprint=${candidate.fingerprint} index=${candidate.index}`);

      const processStart = Date.now();
      let result: FullNewsProcessingResult;
      try {
        result = await processNews(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ 首次新闻处理失败: ${message}`);

        if (job.config.jobRole === 'producer') {
          // producer 不推送设备，不需要 JSON fallback
          throw error;
        }

        if (job.config.renderer === 'device') {
          console.warn('⚠️ 尝试回退至JSON渲染以避免阻塞推送流水');
          const fallbackRequest: NewsProcessRequest = {
            ...request,
            renderer: 'json',
            options: {
              ...(request.options || {}),
              force: false,
            },
          };

          try {
            const fallbackResult = await processNews(fallbackRequest);
            const fallbackBase =
              fallbackResult.result && typeof fallbackResult.result === 'object'
                ? fallbackResult.result
                : { value: fallbackResult.result };
            result = {
              ...fallbackResult,
              params: {
                ...fallbackResult.params,
                renderer: 'json',
              },
              result: {
                ...fallbackBase,
                deviceResult: `回退文本推送: ${message}`,
                fallback: true,
              },
            };
            console.warn('⚠️ 已使用文本回退完成当前推送。');
          } catch (fallbackError) {
            console.error('❌ 文本回退同样失败:', fallbackError);
            throw error;
          }
        } else {
          throw error;
        }
      }
      const processingDurationMs = Date.now() - processStart;

      console.log(`✅ 定时任务 ${job.config.id} 推送成功，缓存:${result.cacheHit ? '命中' : '未命中'} 来源:${result.cacheSource}`);

      // Fire-and-forget: 额外渲染器推送（如 local-eink）
      const extraRenderers = (process.env.NEWS_SCHEDULER_EXTRA_RENDERERS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (extraRenderers.length > 0) {
        const extraContext = {
          title: candidate.context.title,
          link: candidate.context.link,
          publishTime: candidate.context.publishTime,
          source: currentRssSource,
          category: candidate.context.category || job.config.category,
          fingerprint: candidate.fingerprint
        };
        for (const extraRenderer of extraRenderers) {
          const extraRequest: NewsProcessRequest = {
            ...request,
            renderer: extraRenderer,
            context: extraContext
          };
          processNews(extraRequest).then(extraResult => {
            console.log(`✅ 额外渲染器 ${extraRenderer} 推送成功`);
          }).catch(extraError => {
            console.warn(`⚠️ 额外渲染器 ${extraRenderer} 推送失败:`, extraError instanceof Error ? extraError.message : extraError);
          });
        }
      }

      const rawContent = {
        title: candidate.context.title,
        link: candidate.context.link,
        publishTime: candidate.context.publishTime,
        source: candidate.context.source,
        category: candidate.context.category || job.config.category,
        fingerprint: candidate.fingerprint,
        content: candidate.context.content,
        description: candidate.context.description
      };

      let processedContent: Record<string, any> | undefined;
      if (result.result && typeof result.result === 'object' && !Buffer.isBuffer(result.result)) {
        processedContent = {
          title: (result.result as any).title || candidate.context.title,
          message: (result.result as any).message,
          summary: (result.result as any).summary || (result.result as any).message,
          source: (result.result as any).source || candidate.context.source,
          signature: (result.result as any).signature,
          link: (result.result as any).link || candidate.context.link,
          category: (result.result as any).category || candidate.context.category || job.config.category,
          publishTime: (result.result as any).publishTime || candidate.context.publishTime
        };
      }

      let imagePath: string | undefined;
      if (job.config.jobRole === 'producer') {
        // producer: result.result is the MinIO URL string from renderer='news'
        const imageUrl = typeof result.result === 'string' ? result.result : (result.result as any)?.imageUrl;
        if (imageUrl && imageUrl.includes('/quote0-images/')) {
          const urlParts = new URL(imageUrl);
          imagePath = urlParts.pathname.substring('/quote0-images/'.length);
          imagePath = '/' + imagePath;
        }
      } else {
        if (result.result && typeof result.result === 'object' && 'localImagePath' in result.result) {
          imagePath = (result.result as any).localImagePath;
        }
      }

      const pushTime = new Date();

      if (job.config.jobRole === 'producer') {
        // Producer: write to inventory, enforce soft cap, skip device push and push log
        if (imagePath) {
          try {
            await this.enforceInventoryCap();
            await this.postgres.query(`
              INSERT INTO content_inventory (
                producer_job_id, content_type, source, category, fingerprint,
                title, link, raw_content, processed_content, image_path, state, max_replays
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ready', 3)
              ON CONFLICT (fingerprint) DO UPDATE SET
                image_path = EXCLUDED.image_path,
                processed_content = EXCLUDED.processed_content,
                state = 'ready',
                replay_count = 0,
                last_pushed_at = NULL,
                created_at = CURRENT_TIMESTAMP
            `, [
              job.config.id,
              'news',
              currentRssSource,
              job.config.category,
              candidate.fingerprint,
              candidate.context.title || null,
              candidate.context.link || null,
              JSON.stringify(rawContent),
              processedContent ? JSON.stringify(processedContent) : null,
              imagePath
            ]);
            console.log(`📦 Producer 素材已入库: ${candidate.fingerprint} -> ${imagePath}`);
          } catch (inventoryError) {
            console.error('❌ 写入 inventory 失败:', inventoryError);
            throw inventoryError;
          }
        } else {
          console.warn('⚠️ Producer 未获取到图片路径，跳过入库');
        }
      } else {
        // Mixed: legacy full pipeline with device push and push log
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
            rssSource: currentRssSource,
            category: candidate.context.category || job.config.category,
            layer: selection.layer,
            isFallback: selection.isFallback
          },
          result: {
            workflow: result.workflow,
            cache: result.cacheSource
          },
          rawContent,
          processedContent,
          imagePath,
          layer: selection.layer,
          isFallback: selection.isFallback,
          strategySnapshot: selection.strategySnapshot
        });
      }

      if (runHistoryId) {
        try {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            layer: selection.layer,
            candidateId: candidate.index,
            candidateFingerprint: candidate.fingerprint,
            candidatePublishTime: candidate.context.publishTime ? new Date(candidate.context.publishTime) : null,
            candidateProcessTime: processingDurationMs ? new Date(pushTime.getTime() - processingDurationMs) : null,
            pushTime,
            pushStatus: 'success',
            pushReason: job.config.jobRole === 'producer' ? 'producer_stored' : 'selected',
            pushCountBefore: selection.pushCountBefore,
            pushCountAfter: selection.pushCountBefore + 1,
            coolingElapsedMs: selection.coolingElapsedMs ?? null,
            metadata: {
              selectionAttempts: selection.reasons,
              strategySnapshot: selection.strategySnapshot,
              processingDurationMs,
              totalCandidates: selection.totalCandidates,
              poolSize: selection.poolSize,
              jobRole: job.config.jobRole
            },
            runFinishedAt: new Date()
          });
        } catch (historyError) {
          console.warn('⚠️ 更新运行历史失败:', historyError);
        }
      }

      this.resetFailureCount(job, currentRssSource);
      job.state.consecutiveFailures = 0;

      this.recordRecentFingerprint(job, candidate.fingerprint, this.strategyConfig.recentFingerprintGlobalLimit);
      this.updateIndexState(job, candidate.index, selection.poolSize);

      await this.rotateRssSource(job);

      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);

      console.log(`💾 已保存调度器状态: ${job.config.id}, 下次运行: ${nextRunAt.toISOString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ 定时任务 ${job.config.id} 执行失败: ${message}`, error);

      this.incrementFailureCount(job, currentRssSource);
      job.state.consecutiveFailures += 1;

      if (runHistoryId) {
        try {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'failed',
            pushReason: message,
            runFinishedAt: new Date(),
            metadata: {
              error: message,
              failureCount: this.getFailureCount(job, currentRssSource),
              consecutiveFailures: job.state.consecutiveFailures
            }
          });
        } catch (historyError) {
          console.warn('⚠️ 更新运行历史失败:', historyError);
        }
      }

      await this.handlePostRunFailure(job, currentRssSource);
    } finally {
      job.state.running = false;
    }
  }

  private async runWeatherJob(job: SchedulerJobInstance): Promise<void> {
    const city = job.config.rssSource || '广州';
    let runHistoryId: number | null = null;

    try {
      const runStartedAt = new Date();
      console.log(`🌤️ 天气任务 ${job.config.id} 开始执行，城市: ${city}`);

      runHistoryId = await this.postgres.createSchedulerRunHistory({
        jobId: job.config.id,
        runStartedAt,
        source: city,
        metadata: { city, renderer: job.config.renderer }
      });

      // 1. 获取天气数据
      const weatherData = await weatherPlugin.dataProvider.getData('amap', { city }) as WeatherData;
      console.log(`🌡️ 天气数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);

      // 2. Satori 渲染
      const { satoriRenderer } = await import('../react-widgets/core/satori-renderer.js');
      await satoriRenderer.initialize();

      const safeData = sanitizeWeatherData(weatherData);
      const imageBuffer = await satoriRenderer.renderToImage(
        React.createElement(SatoriWeatherWidget, { data: safeData }),
        {
          width: (job.config.options as any)?.width || EINK_DEVICE_WIDTH,
          height: (job.config.options as any)?.height || EINK_DEVICE_HEIGHT,
          backgroundColor: '#ffffff'
        }
      );

      // 3. 保存到本地文件
      const fs = await import('fs/promises');
      const timestamp = Date.now();
      const filename = `weather_${job.config.id}_${timestamp}.png`;
      const dirPath = './processed-images/widgets/weather';
      const localImagePath = `${dirPath}/${filename}`;
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(localImagePath, imageBuffer);
      console.log(`💾 天气图片已保存: ${localImagePath}`);

      // 4. 上传到 MinIO
      const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
      const imageStorage = getImageStorage();
      const uploadResult = await imageStorage.uploadImage(localImagePath, {
        widgetType: 'weather',
        cacheKey: `weather_${job.config.id}_${timestamp}`,
        renderConfig: job.config.options || {}
      });
      const imageUrl = uploadResult.url;
      const objectKey = uploadResult.objectKey;
      console.log(`✅ 天气图片已上传 MinIO: ${imageUrl}`);

      // 5. 推送到设备（统一使用 DevicePusher，与新闻处理路径保持一致）
      let deviceResult = '未推送';
      let pushResults: Array<{ device: string; ok: boolean; error?: string }> = [];

      if (job.config.renderer === 'local-eink' || job.config.renderer === 'device') {
        const pushResult = await devicePusher.push(
          localImagePath,
          job.config.renderer as 'device' | 'local-eink'
        );
        deviceResult = pushResult.deviceResult || pushResult.error || '未推送';
        if (pushResult.pushResults) {
          pushResults = pushResult.pushResults;
        }
      }

      // 6. 记录推送结果
      const fingerprint = `weather:${city}:${Math.floor(timestamp / 600000)}`;
      const displayTitle = `${city}天气 ${weatherData.temperature}°C ${weatherData.weather}`;
      const summary = `${city} ${weatherData.temperature}°C ${weatherData.weather}，湿度 ${weatherData.humidity}%，${weatherData.windDirection || ''}风${weatherData.windPower || ''}`;
      await this.postgres.recordPushResult({
        jobId: job.config.id,
        fingerprint,
        title: displayTitle,
        category: job.config.category,
        source: 'weather',
        imagePath: `/${objectKey}`,
        layer: 'weather',
        isFallback: false,
        // 让 annotation-api 能正确显示标题、来源等（前端从 raw_content/processed_content 取字段）
        rawContent: {
          title: displayTitle,
          source: `${city}天气`,
          publishTime: new Date().toISOString(),
          category: '天气',
          fingerprint,
          link: null,
          content: summary
        },
        processedContent: {
          title: displayTitle,
          message: summary,
          summary,
          source: `${city}天气`,
          category: '天气',
          publishTime: new Date().toISOString()
        },
        metadata: {
          city,
          temperature: weatherData.temperature,
          weather: weatherData.weather,
          humidity: weatherData.humidity,
          renderer: job.config.renderer
        },
        result: {
          deviceResult,
          pushResults,
          imageUrl
        }
      });

      // 7. 更新运行历史
      if (runHistoryId) {
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus: 'success',
          pushReason: 'weather_pushed',
          runFinishedAt: new Date(),
          metadata: {
            city,
            weather: weatherData.weather,
            temperature: weatherData.temperature,
            deviceResult
          }
        });
      }

      // 8. 重置失败计数并持久化状态
      job.state.consecutiveFailures = 0;
      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);

      console.log(`✅ 天气任务 ${job.config.id} 执行完成，下次运行: ${nextRunAt.toISOString()}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ 天气任务 ${job.config.id} 执行失败: ${message}`, error);

      job.state.consecutiveFailures += 1;

      if (runHistoryId) {
        try {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'failed',
            pushReason: message,
            runFinishedAt: new Date(),
            metadata: { error: message }
          });
        } catch (historyError) {
          console.warn('⚠️ 更新运行历史失败:', historyError);
        }
      }

      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);
    } finally {
      job.state.running = false;
    }
  }

  /**
   * Memo job: fair-rotation push pre-rendered memos to device
   */
  private async runMemoJob(job: SchedulerJobInstance): Promise<void> {
    const runStartedAt = new Date();
    let runHistoryId: number | null = null;
    const fs = await import('fs/promises');

    try {
      runHistoryId = await this.postgres.createSchedulerRunHistory({
        jobId: job.config.id,
        runStartedAt,
        source: 'memo',
        metadata: { dataSource: 'memo' }
      });

      const result = await this.postgres.query(`
        SELECT id, text, png_path, sort_order, target_renderer
        FROM memos
        WHERE enabled = true AND status = 'ready'
        ORDER BY sort_order ASC, created_at ASC
      `);

      const rows = result.rows;
      if (rows.length === 0) {
        console.log(`📝 Memo任务 ${job.config.id}: 没有 enabled+ready 的备忘`);
        job.state.consecutiveFailures = 0;
        const nextRunAt = new Date(Date.now() + job.config.intervalMs);
        await this.persistSchedulerState(job, nextRunAt);
        if (runHistoryId) {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'skipped',
            pushReason: 'no_ready_memos',
            runFinishedAt: new Date()
          });
        }
        return;
      }

      job.state.dynamicPoolSize = rows.length;
      const idx = this.getNextCandidateIndex(job);
      const memo = rows[idx];
      const targetRenderer = memo.target_renderer ?? 'both';

      console.log(`📝 Memo任务 ${job.config.id} 选中: memo.id=${memo.id}, idx=${idx}, total=${rows.length}, target=${targetRenderer}`);

      // 从 MinIO 读取预渲染 PNG（device 和 local-eink 共用）
      const pngBuffer = await this.readMinIOObject(memo.png_path);
      const base64 = pngBuffer.toString('base64');

      let deviceOk = false;
      const pushDetails: Record<string, any> = {};

      // device / both：推 MindReset 云端
      if (targetRenderer === 'device' || targetRenderer === 'both') {
        const client = MindResetDeviceClient.fromEnvironment();
        const border = (job.config.options as any)?.border ?? '0';
        const r = await client.sendImage(base64, { border });
        deviceOk = r.success;
        pushDetails.device = { success: r.success, error: r.error ?? undefined };
        if (r.success) {
          console.log(`✅ Memo任务 ${job.config.id} MindReset 推送成功: memo.id=${memo.id}`);
        } else {
          console.error(`❌ Memo任务 ${job.config.id} MindReset 推送失败: ${r.error}`);
        }
      }

      // local-eink / both：推局域网 ESP32（统一使用 DevicePusher）
      if (targetRenderer === 'local-eink' || targetRenderer === 'both') {
        const tmpFile = `/tmp/memo_${memo.id}_${Date.now()}.png`;
        try {
          await fs.writeFile(tmpFile, pngBuffer);
          const pushResult = await devicePusher.push(tmpFile, 'local-eink');
          if (pushResult.pushResults && pushResult.pushResults.length > 0) {
            pushDetails.localEink = { devices: pushResult.pushResults };
          } else if (!pushResult.ok) {
            pushDetails.localEink = { skipped: true, reason: pushResult.error || 'push_failed' };
          }
        } catch (einkError) {
          const msg = einkError instanceof Error ? einkError.message : String(einkError);
          console.error(`❌ Memo任务 ${job.config.id} local-eink 推送异常: ${msg}`);
          pushDetails.localEink = { error: msg };
        } finally {
          try { await fs.unlink(tmpFile); } catch {}
        }
      }

      // 成败判定
      if (targetRenderer === 'device' && !deviceOk) {
        throw new Error(`MindReset 推送失败: ${pushDetails.device?.error || 'unknown'}`);
      }
      if (targetRenderer === 'both' && !deviceOk) {
        throw new Error(`both 模式 MindReset 推送失败: ${pushDetails.device?.error || 'unknown'}`);
      }

      console.log(`✅ Memo任务 ${job.config.id} 推送完成: memo.id=${memo.id}, target=${targetRenderer}`);

      job.state.consecutiveFailures = 0;
      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);

      if (runHistoryId) {
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus: 'success',
          pushReason: 'memo_pushed',
          candidateFingerprint: String(memo.id),
          runFinishedAt: new Date(),
          metadata: { memoId: memo.id, index: idx, total: rows.length, targetRenderer, pushDetails }
        });
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Memo任务 ${job.config.id} 执行失败: ${message}`, error);
      job.state.consecutiveFailures += 1;

      if (runHistoryId) {
        try {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'failed',
            pushReason: message,
            runFinishedAt: new Date(),
            metadata: { error: message, consecutiveFailures: job.state.consecutiveFailures }
          });
        } catch (historyError) {
          console.warn('⚠️ 更新运行历史失败:', historyError);
        }
      }

      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);
    } finally {
      job.state.running = false;
    }
  }

  private async selectCandidate(job: SchedulerJobInstance, currentRssSource: string, overrideIndex?: number): Promise<CandidateSelectionOutcome> {
    this.ensureIndexState(job);

    if (typeof overrideIndex === 'number') {
      const context = this.buildContextFromIndex(job.config, overrideIndex);
      const candidate: CandidateArticle = {
        index: overrideIndex,
        fingerprint: context.fingerprint!,
        publishTime: context.publishTime,
        pushCount: 0,
        lastPushedAt: undefined,
        context
      };
      const reasons: LayerAttemptLog[] = [{ layer: 'override', reason: 'manual_override' }];
      const poolSize = this.getEffectivePoolSize(job);
      const snapshot = this.buildStrategySnapshot(job, 'override', currentRssSource, reasons, {
        overrideIndex
      });
      return {
        selection: {
          candidate,
          layer: 'override',
          isFallback: false,
          pushCountBefore: 0,
          coolingElapsedMs: undefined,
          reasons,
          strategySnapshot: snapshot,
          poolSize,
          totalCandidates: 1
        },
        attempts: reasons,
        totalCandidates: 1,
        poolSize
      };
    }

    const attempts: LayerAttemptLog[] = [];
    const dataSourceModule: any = dataSourceRegistry.get(job.config.dataSource);
    if (!dataSourceModule || typeof dataSourceModule.fetchRawData !== 'function') {
      attempts.push({ layer: 'strict', reason: 'data_source_missing' });
      return {
        selection: null,
        attempts,
        totalCandidates: 0,
        poolSize: this.getEffectivePoolSize(job)
      };
    }

    const configPoolSize = job.config.indexStrategy.poolSize;
    const fetchCount = configPoolSize === -1
      ? 100
      : Math.max(configPoolSize * DEFAULT_FETCH_MULTIPLIER, DEFAULT_MIN_FETCH_COUNT);

    let rawItems: RawDataItem[];
    try {
      rawItems = await dataSourceModule.fetchRawData({
        category: job.config.category,
        source: currentRssSource,
        startIndex: 0,
        count: fetchCount
      });
    } catch (error) {
      attempts.push({
        layer: 'strict',
        reason: 'fetch_error',
        stats: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return {
        selection: null,
        attempts,
        totalCandidates: 0,
        poolSize: this.getEffectivePoolSize(job)
      };
    }

    if (!rawItems || rawItems.length === 0) {
      attempts.push({ layer: 'strict', reason: 'empty_feed' });
      return {
        selection: null,
        attempts,
        totalCandidates: 0,
        poolSize: 0
      };
    }

    if (configPoolSize === -1) {
      job.state.dynamicPoolSize = rawItems.length;
      console.log(`📊 动态poolSize已更新: ${rawItems.length} (来源: ${currentRssSource})`);
    }

    this.prepareIndexSequence(job, rawItems);

    const candidates = rawItems.map((item, idx) => {
      const originalIndex = item.metadata?.originalIndex ?? item.metadata?.index ?? idx;
      const fingerprint = computeNewsFingerprint({
        title: item.title,
        link: item.link,
        publishTime: item.publishTime,
        source: item.source,
        category: item.category || job.config.category,
        fallback: `${job.config.dataSource}:${job.config.rssSource}:${originalIndex}`
      });
      const context: NewsPushContext = {
        title: item.title,
        link: item.link,
        publishTime: item.publishTime,
        source: item.source,
        category: item.category || job.config.category,
        fingerprint,
        rawIndex: originalIndex,
        content: item.content,
        description: item.metadata?.description
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

    const now = Date.now();
    const totalCandidates = scored.length;
    const poolSize = rawItems.length;

    const strictFilter = this.filterCandidatesForLayer('strict', scored, job, now);
    attempts.push({ layer: 'strict', reason: strictFilter.filtered.length ? 'pool_available' : 'pool_empty', stats: strictFilter.stats });
    if (strictFilter.filtered.length) {
      const candidate = this.pickCandidateByOrder(job, strictFilter.filtered);
      if (candidate) {
        const selectionLog: LayerAttemptLog = { layer: 'strict', reason: 'selected', stats: { index: candidate.index } };
        const reasons: LayerAttemptLog[] = [...attempts, selectionLog];
        const snapshot = this.buildStrategySnapshot(job, 'strict', currentRssSource, reasons, {
          totalCandidates,
          filterStats: strictFilter.stats
        });
        return {
          selection: {
            candidate,
            layer: 'strict',
            isFallback: false,
            pushCountBefore: candidate.pushCount,
            coolingElapsedMs: candidate.lastPushedAt ? now - new Date(candidate.lastPushedAt).getTime() : undefined,
            reasons,
            strategySnapshot: snapshot,
            poolSize,
            totalCandidates
          },
          attempts: reasons,
          totalCandidates,
          poolSize
        };
      }
      attempts.push({ layer: 'strict', reason: 'order_exhausted', stats: { filtered: strictFilter.stats.passed } });
    }

    const relaxedFilter = this.filterCandidatesForLayer('relaxed', scored, job, now);
    attempts.push({ layer: 'relaxed', reason: relaxedFilter.filtered.length ? 'pool_available' : 'pool_empty', stats: relaxedFilter.stats });
    if (relaxedFilter.filtered.length) {
      const candidate = this.pickCandidateByOrder(job, relaxedFilter.filtered);
      if (candidate) {
        const selectionLog: LayerAttemptLog = { layer: 'relaxed', reason: 'selected', stats: { index: candidate.index } };
        const reasons: LayerAttemptLog[] = [...attempts, selectionLog];
        const snapshot = this.buildStrategySnapshot(job, 'relaxed', currentRssSource, reasons, {
          totalCandidates,
          filterStats: relaxedFilter.stats
        });
        return {
          selection: {
            candidate,
            layer: 'relaxed',
            isFallback: false,
            pushCountBefore: candidate.pushCount,
            coolingElapsedMs: candidate.lastPushedAt ? now - new Date(candidate.lastPushedAt).getTime() : undefined,
            reasons,
            strategySnapshot: snapshot,
            poolSize,
            totalCandidates
          },
          attempts: reasons,
          totalCandidates,
          poolSize
        };
      }
      attempts.push({ layer: 'relaxed', reason: 'order_exhausted', stats: { filtered: relaxedFilter.stats.passed } });
    }

    const fallbackFilter = this.filterCandidatesForFallback(scored, job);
    attempts.push({ layer: 'fallback', reason: fallbackFilter.filtered.length ? 'pool_available' : 'pool_empty', stats: fallbackFilter.stats });
    if (fallbackFilter.filtered.length) {
      const candidate = this.pickCandidateByOrder(job, fallbackFilter.filtered);
      if (candidate) {
        const selectionLog: LayerAttemptLog = { layer: 'fallback', reason: 'selected', stats: { index: candidate.index } };
        const reasons: LayerAttemptLog[] = [...attempts, selectionLog];
        const snapshot = this.buildStrategySnapshot(job, 'fallback', currentRssSource, reasons, {
          totalCandidates,
          filterStats: fallbackFilter.stats
        });
        return {
          selection: {
            candidate,
            layer: 'fallback',
            isFallback: true,
            pushCountBefore: candidate.pushCount,
            coolingElapsedMs: candidate.lastPushedAt ? now - new Date(candidate.lastPushedAt).getTime() : undefined,
            reasons,
            strategySnapshot: snapshot,
            poolSize,
            totalCandidates
          },
          attempts: reasons,
          totalCandidates,
          poolSize
        };
      }
      attempts.push({ layer: 'fallback', reason: 'order_exhausted', stats: { filtered: fallbackFilter.stats.passed } });
    }

    return {
      selection: null,
      attempts,
      totalCandidates,
      poolSize
    };
  }

  private async resolveRunnableSource(job: SchedulerJobInstance, overrideIndex?: number): Promise<{ source: string; skipped: Array<{ source: string; failureCount: number }> }> {
    const initialSource = this.getCurrentRssSource(job);
    if (overrideIndex !== undefined) {
      return { source: initialSource, skipped: [] };
    }

    const threshold = this.strategyConfig.sourceFailureSkipThreshold ?? 0;
    if (threshold <= 0) {
      return { source: initialSource, skipped: [] };
    }

    const enabledSources = this.getEnabledRssSources(job);
    if (enabledSources.length <= 1) {
      return { source: initialSource, skipped: [] };
    }

    const skipped: Array<{ source: string; failureCount: number }> = [];
    let currentSource = initialSource;

    for (let attempt = 0; attempt < enabledSources.length; attempt++) {
      const failureCount = this.getFailureCount(job, currentSource);
      if (failureCount < threshold) {
        return { source: currentSource, skipped };
      }

      skipped.push({ source: currentSource, failureCount });
      console.warn(`⚠️ 源 ${currentSource} 因连续失败 ${failureCount} 次，将尝试跳过`);
      if (threshold > 0) {
        const reduced = Math.max(0, threshold - 1);
        this.reduceFailureCount(job, currentSource, reduced);
      }
      await this.rotateRssSource(job);
      currentSource = this.getCurrentRssSource(job);
    }

    return { source: currentSource, skipped };
  }

  private filterCandidatesForLayer(layer: Extract<StrategyLayerKey, 'strict' | 'relaxed'>, candidates: CandidateArticle[], job: SchedulerJobInstance, now: number): { filtered: CandidateArticle[]; stats: Record<string, number> } {
    const stats = {
      total: candidates.length,
      passed: 0,
      blockedByCooldown: 0,
      blockedByPushCount: 0,
      blockedByRecent: 0
    };

    const config = layer === 'strict'
      ? {
          cooldownMs: this.strategyConfig.cooldownHoursStrict * 60 * 60 * 1000,
          maxPushCount: this.strategyConfig.maxPushCountStrict,
          recentLimit: this.strategyConfig.recentFingerprintsLimitStrict
        }
      : {
          cooldownMs: this.strategyConfig.cooldownHoursRelaxed * 60 * 60 * 1000,
          maxPushCount: this.strategyConfig.maxPushCountRelaxed,
          recentLimit: this.strategyConfig.recentFingerprintsLimitRelaxed
        };

    const filtered: CandidateArticle[] = [];
    for (const candidate of candidates) {
      if (config.maxPushCount !== undefined && candidate.pushCount >= config.maxPushCount) {
        stats.blockedByPushCount += 1;
        continue;
      }
      if (config.cooldownMs !== undefined && candidate.lastPushedAt) {
        const elapsed = now - new Date(candidate.lastPushedAt).getTime();
        if (elapsed < config.cooldownMs) {
          stats.blockedByCooldown += 1;
          continue;
        }
      }
      if (this.isFingerprintRecent(job, candidate.fingerprint, config.recentLimit)) {
        stats.blockedByRecent += 1;
        continue;
      }
      filtered.push(candidate);
    }

    stats.passed = filtered.length;
    return { filtered, stats };
  }

  private filterCandidatesForFallback(candidates: CandidateArticle[], job: SchedulerJobInstance): { filtered: CandidateArticle[]; stats: Record<string, number> } {
    const stats = {
      total: candidates.length,
      passed: 0,
      blockedByRecent: 0
    };

    const recentLimit = Math.max(0, this.strategyConfig.fallbackRepeatLimit ?? 0);
    const sorted = [...candidates].sort((a, b) => {
      if (a.pushCount !== b.pushCount) {
        return a.pushCount - b.pushCount;
      }
      const aTime = a.lastPushedAt ? new Date(a.lastPushedAt).getTime() : 0;
      const bTime = b.lastPushedAt ? new Date(b.lastPushedAt).getTime() : 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.index - b.index;
    });

    const filtered: CandidateArticle[] = [];
    for (const candidate of sorted) {
      if (this.isFingerprintRecent(job, candidate.fingerprint, recentLimit)) {
        stats.blockedByRecent += 1;
        continue;
      }
      filtered.push(candidate);
    }

    stats.passed = filtered.length;
    return { filtered, stats };
  }

  private pickCandidateByOrder(job: SchedulerJobInstance, candidates: CandidateArticle[]): CandidateArticle | null {
    if (!candidates.length) {
      return null;
    }
    const candidateMap = new Map(candidates.map((item) => [item.index, item]));
    const order = job.state.shuffledOrder;

    if (order.length > 0) {
      for (let attempt = 0; attempt < order.length; attempt++) {
        const pointerIndex = (job.state.shuffledPointer + attempt) % order.length;
        const candidateIndex = order[pointerIndex];
        const candidate = candidateMap.get(candidateIndex);
        if (candidate) {
          return candidate;
        }
      }
    }

    return candidates[0] ?? null;
  }

  private buildStrategySnapshot(job: SchedulerJobInstance, layer: StrategyLayerKey, source: string, reasons: LayerAttemptLog[], extra: Record<string, any> = {}): Record<string, any> {
    const snapshotSize = this.strategyConfig.recentFingerprintSnapshotSize ?? 15;
    return {
      layer,
      source,
      strategy: this.strategyConfig,
      state: {
        nextIndex: job.state.nextIndex,
        lastIndex: job.state.lastIndex,
        currentSourceIndex: job.state.currentSourceIndex,
        recentFingerprints: job.state.recentFingerprints.slice(0, snapshotSize),
        failureCount: job.state.failureCount,
        consecutiveFailures: job.state.consecutiveFailures,
        shuffledPointer: job.state.shuffledPointer
      },
      reasons,
      extra
    };
  }

  private incrementFailureCount(job: SchedulerJobInstance, source: string | undefined): void {
    if (!source) {
      return;
    }
    this.ensureIndexState(job);
    job.state.failureCount[source] = this.getFailureCount(job, source) + 1;
  }

  private resetFailureCount(job: SchedulerJobInstance, source: string | undefined): void {
    if (!source) {
      return;
    }
    this.ensureIndexState(job);
    job.state.failureCount[source] = 0;
  }

  private reduceFailureCount(job: SchedulerJobInstance, source: string | undefined, target?: number): void {
    if (!source) {
      return;
    }
    this.ensureIndexState(job);
    const current = this.getFailureCount(job, source);
    const next = target !== undefined ? Math.max(0, target) : Math.max(0, current - 1);
    if (current !== next) {
      job.state.failureCount[source] = next;
    }
  }

  private getFailureCount(job: SchedulerJobInstance, source: string | undefined): number {
    if (!source) {
      return 0;
    }
    this.ensureIndexState(job);
    return job.state.failureCount[source] ?? 0;
  }

  private isFingerprintRecent(job: SchedulerJobInstance, fingerprint: string | undefined, limit: number | undefined): boolean {
    if (!fingerprint || !limit || limit <= 0) {
      return false;
    }
    this.ensureIndexState(job);
    return job.state.recentFingerprints.slice(0, limit).includes(fingerprint);
  }

  private async persistSchedulerState(job: SchedulerJobInstance, nextRunAt?: Date): Promise<void> {
    const limit = this.strategyConfig.recentFingerprintGlobalLimit;
    if (limit > 0 && job.state.recentFingerprints.length > limit) {
      job.state.recentFingerprints = job.state.recentFingerprints.slice(0, limit);
    }
    await this.postgres.saveSchedulerState(job.config.id, {
      nextIndex: job.state.nextIndex,
      lastIndex: job.state.lastIndex,
      shuffledOrder: job.state.shuffledOrder,
      shuffledPointer: job.state.shuffledPointer,
      consecutiveFailures: job.state.consecutiveFailures,
      currentSourceIndex: job.state.currentSourceIndex,
      dynamicPoolSize: job.state.dynamicPoolSize,
      recentFingerprints: job.state.recentFingerprints,
      failureCount: job.state.failureCount
    }, nextRunAt);
  }

  private async handlePostRunFailure(job: SchedulerJobInstance, currentRssSource: string): Promise<void> {
    const threshold = this.strategyConfig.sourceFailureSkipThreshold ?? 0;
    const failureCount = this.getFailureCount(job, currentRssSource);
    if (threshold > 0 && failureCount >= threshold) {
      console.warn(`⚠️ 源 ${currentRssSource} 连续失败 ${failureCount} 次，将轮换到下一个源`);
      await this.rotateRssSource(job);
    }

    const effectivePoolSize = this.getEffectivePoolSize(job);
    if (job.state.consecutiveFailures >= effectivePoolSize) {
      this.resetIndexState(job);
    }

    const nextRunAt = new Date(Date.now() + job.config.intervalMs);
    await this.persistSchedulerState(job, nextRunAt);
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

  private resetIndexState(job: SchedulerJobInstance): void {
    job.state.consecutiveFailures = 0;
    const startIndex = job.config.indexStrategy.startIndex ?? 0;
    job.state.nextIndex = startIndex;
    job.state.lastIndex = null;
    job.state.shuffledOrder = [];
    job.state.shuffledPointer = 0;
    job.state.recentFingerprints = [];
  }

  /**
   * 获取当前使用的RSS源
   * 支持单源模式（rssSource）和多源轮换模式（rssSources[]）
   */
  /**
   * 获取启用的RSS源列表（过滤掉禁用的源）
   */
  private getEnabledRssSources(job: SchedulerJobInstance): string[] {
    const allSources = job.config.rssSources || [];
    const disabledSources = (job.config as any).disabledSources || [];
    console.log(`🔍 过滤禁用源: allSources=${JSON.stringify(allSources)}, disabledSources=${JSON.stringify(disabledSources)}`);
    const enabled = allSources.filter(source => !disabledSources.includes(source));
    console.log(`🔍 过滤后启用源: ${JSON.stringify(enabled)}`);
    return enabled;
  }

  private getCurrentRssSource(job: SchedulerJobInstance): string {
    // 多源轮换模式
    if (job.config.rssSources && job.config.rssSources.length > 0) {
      const enabledSources = this.getEnabledRssSources(job);
      if (enabledSources.length === 0) {
        console.warn('⚠️ 所有RSS源都被禁用，使用第一个源作为备用');
        return job.config.rssSources[0];
      }
      const index = job.state.currentSourceIndex % enabledSources.length;
      return enabledSources[index];
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
    console.log(`🔍 RSS源轮换检查: rotateAfterEachPush=${strategy.rotateAfterEachPush}`);

    if (!strategy.rotateAfterEachPush) {
      console.log('⚠️ 轮换已禁用，跳过');
      return;
    }

    if (job.config.rssSources && job.config.rssSources.length > 1) {
      const enabledSources = this.getEnabledRssSources(job);
      console.log(`🔍 启用的源: ${enabledSources.join(', ')}, 当前索引: ${job.state.currentSourceIndex}`);

      if (enabledSources.length <= 1) {
        console.log('⚠️ 只有1个或0个启用的源，跳过轮换');
        return;
      }

      const oldIndex = job.state.currentSourceIndex;
      const newIndex = (oldIndex + 1) % enabledSources.length;
      job.state.currentSourceIndex = newIndex;

      console.log(`🔄 RSS源轮换: ${enabledSources[oldIndex]} -> ${enabledSources[newIndex]} (${newIndex + 1}/${enabledSources.length})`);

      // 持久化到数据库
      try {
        await this.postgres.updateJobSourceIndex(job.config.id, newIndex);
        console.log(`💾 RSS源索引已持久化: ${newIndex}`);
      } catch (error) {
        console.warn(`⚠️ RSS源索引持久化失败: ${error}`);
      }
    } else {
      console.log(`⚠️ 不满足轮换条件: rssSources=${job.config.rssSources?.length}`);
    }
  }

  /**
   * 获取有效的poolSize（支持动态poolSize）
   * poolSize=-1 表示动态获取RSS源的实际条目数
   */
  private ensureIndexState(job: SchedulerJobInstance): void {
    if (typeof job.state.nextIndex !== 'number') {
      job.state.nextIndex = job.config.indexStrategy.startIndex ?? 0;
    }
    if (job.state.lastIndex === undefined) {
      job.state.lastIndex = null;
    }
    if (!Array.isArray(job.state.shuffledOrder)) {
      job.state.shuffledOrder = [];
    }
    if (typeof job.state.shuffledPointer !== 'number') {
      job.state.shuffledPointer = 0;
    }
    if (!Array.isArray(job.state.recentFingerprints)) {
      job.state.recentFingerprints = [];
    }
    if (!job.state.failureCount || typeof job.state.failureCount !== 'object') {
      job.state.failureCount = {};
    }
  }

  private prepareIndexSequence(job: SchedulerJobInstance, rawItems: RawDataItem[]): void {
    this.ensureIndexState(job);

    const order = rawItems
      .map((item, idx) => {
        const originalIndex = item.metadata?.originalIndex ?? item.metadata?.index ?? idx;
        const publishTime = item.publishTime ? new Date(item.publishTime).getTime() : 0;
        return { index: originalIndex, publishTime };
      })
      .sort((a, b) => {
        if (a.publishTime !== b.publishTime) {
          return b.publishTime - a.publishTime;
        }
        return a.index - b.index;
      })
      .map(item => item.index);

    if (order.length === 0) {
      job.state.shuffledOrder = [];
      job.state.shuffledPointer = 0;
      return;
    }

    if (!arraysEqual(job.state.shuffledOrder, order)) {
      job.state.shuffledOrder = order;
      job.state.shuffledPointer = job.state.shuffledPointer % order.length;
      job.state.nextIndex = job.state.nextIndex % order.length;
    }

    if (job.state.shuffledPointer >= order.length) {
      job.state.shuffledPointer = 0;
    }

    job.state.dynamicPoolSize = order.length;
  }

  private getEffectivePoolSize(job: SchedulerJobInstance): number {
    const configPoolSize = job.config.indexStrategy.poolSize;

    if (configPoolSize === -1) {
      if (job.state.shuffledOrder.length > 0) {
        return job.state.shuffledOrder.length;
      }
      return job.state.dynamicPoolSize || 10;
    }

    return configPoolSize;
  }

  private updateIndexState(job: SchedulerJobInstance, usedIndex: number, poolSize?: number): void {
    this.ensureIndexState(job);
    const effectivePoolSize = poolSize && poolSize > 0
      ? poolSize
      : this.getEffectivePoolSize(job) || 1;

    job.state.lastIndex = usedIndex;

    if (effectivePoolSize > 0 && Number.isFinite(effectivePoolSize)) {
      job.state.nextIndex = (usedIndex + 1) % effectivePoolSize;
    } else {
      job.state.nextIndex = usedIndex + 1;
    }

    const order = job.state.shuffledOrder;
    if (order.length > 0) {
      const position = order.indexOf(usedIndex);
      if (position >= 0) {
        job.state.shuffledPointer = (position + 1) % order.length;
      }
    }
  }

  private getNextCandidateIndex(job: SchedulerJobInstance): number {
    this.ensureIndexState(job);
    const poolSize = this.getEffectivePoolSize(job);
    const next = job.state.nextIndex ?? 0;
    const normalized = poolSize > 0 ? ((next % poolSize) + poolSize) % poolSize : next;
    this.updateIndexState(job, normalized, poolSize);
    return normalized;
  }

  private recordRecentFingerprint(job: SchedulerJobInstance, fingerprint: string | undefined, limit: number): void {
    if (!fingerprint) {
      return;
    }
    this.ensureIndexState(job);
    const list = job.state.recentFingerprints;
    const existingIndex = list.indexOf(fingerprint);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
    list.unshift(fingerprint);
    if (limit > 0 && list.length > limit) {
      list.length = limit;
    }
  }

  /**
   * Consumer job: pick image from inventory and push to device
   */
  private async runConsumerJob(job: SchedulerJobInstance): Promise<void> {
    const runStartedAt = new Date();
    let runHistoryId: number | null = null;

    try {
      runHistoryId = await this.postgres.createSchedulerRunHistory({
        jobId: job.config.id,
        runStartedAt,
        source: 'inventory',
        metadata: { jobRole: 'consumer' }
      });

      // 1. Prefer ready items (FIFO)
      let item = await this.postgres.query(`
        SELECT * FROM content_inventory
        WHERE state='ready'
        ORDER BY created_at ASC
        LIMIT 1
      `);

      // 2. Fallback to pushed items with replay budget (LRU)
      if (item.rows.length === 0) {
        item = await this.postgres.query(`
          SELECT * FROM content_inventory
          WHERE state='pushed' AND replay_count < max_replays
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
          ORDER BY last_pushed_at ASC NULLS FIRST
          LIMIT 1
        `);
      }

      // 3. Empty inventory → skip gracefully
      if (item.rows.length === 0) {
        console.log(`📭 Consumer ${job.config.id}: inventory empty, skipping`);
        if (runHistoryId) {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'skipped',
            pushReason: 'inventory_empty',
            runFinishedAt: new Date()
          });
        }
        job.state.consecutiveFailures = 0;
        const nextRunAt = new Date(Date.now() + job.config.intervalMs);
        await this.persistSchedulerState(job, nextRunAt);
        return;
      }

      const inventoryItem = item.rows[0];
      console.log(`📤 Consumer ${job.config.id} 推送素材: ${inventoryItem.fingerprint} (replay ${inventoryItem.replay_count}/${inventoryItem.max_replays})`);

      // 4. Push image from MinIO to device
      await this.pushImageFromMinIO(inventoryItem.image_path, job);

      // 5. Update inventory state
      const updatedReplayCount = (inventoryItem.replay_count || 0) + 1;
      await this.postgres.query(`
        UPDATE content_inventory
        SET state='pushed', replay_count=replay_count+1, last_pushed_at=CURRENT_TIMESTAMP
        WHERE id=$1
      `, [inventoryItem.id]);

      // 6. Write news_push_log for annotation compatibility
      await this.postgres.recordPushResult({
        jobId: job.config.id,
        fingerprint: inventoryItem.fingerprint,
        title: inventoryItem.title,
        source: inventoryItem.source,
        category: inventoryItem.category,
        rawContent: inventoryItem.raw_content,
        processedContent: inventoryItem.processed_content,
        imagePath: inventoryItem.image_path,
        result: { source_inventory_id: inventoryItem.id, replay_count: updatedReplayCount },
        layer: 'inventory',
        isFallback: false
      });

      if (runHistoryId) {
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus: 'success',
          pushReason: 'inventory_consumed',
          candidateFingerprint: inventoryItem.fingerprint,
          runFinishedAt: new Date(),
          metadata: { inventoryId: inventoryItem.id, replayCount: updatedReplayCount }
        });
      }

      job.state.consecutiveFailures = 0;
      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);
      console.log(`✅ Consumer ${job.config.id} 完成，下次运行: ${nextRunAt.toISOString()}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Consumer ${job.config.id} 执行失败: ${message}`, error);
      job.state.consecutiveFailures += 1;

      if (runHistoryId) {
        try {
          await this.postgres.updateSchedulerRunHistory(runHistoryId, {
            pushStatus: 'failed',
            pushReason: message,
            runFinishedAt: new Date(),
            metadata: { error: message, consecutiveFailures: job.state.consecutiveFailures }
          });
        } catch (historyError) {
          console.warn('⚠️ 更新运行历史失败:', historyError);
        }
      }

      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);
    } finally {
      job.state.running = false;
    }
  }

  /**
   * Push an image from MinIO to the device without re-rendering
   */
  private async pushImageFromMinIO(imagePath: string, job: SchedulerJobInstance): Promise<void> {
    const renderer = job.config.renderer;
    const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
    const imageStorage = getImageStorage();

    // imagePath is like "/widgets/news/2025/05/16/abc.png"
    const objectKey = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;
    const existsResult = await imageStorage.imageExistsByObjectKey(objectKey);
    if (!existsResult) {
      throw new Error(`MinIO 图片不存在: ${objectKey}`);
    }

    const imageUrl = existsResult.url;

    // Download to temp file
    const fs = await import('fs/promises');
    const path = await import('path');
    const { tmpdir } = await import('os');
    const https = await import('https');
    const http = await import('http');
    const { createWriteStream } = await import('fs');

    const tempFileName = `inventory_${Date.now()}.png`;
    const tempFilePath = path.join(tmpdir(), tempFileName);

    await new Promise<void>((resolve, reject) => {
      const client = imageUrl.startsWith('https:') ? https : http;
      const file = createWriteStream(tempFilePath);
      client.get(imageUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
        file.on('error', (err) => {
          file.close();
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        reject(err);
      });
    });

    try {
      if (renderer === 'local-eink' || renderer === 'device') {
        const pushResult = await devicePusher.push(tempFilePath, renderer);
        if (!pushResult.ok && pushResult.error) {
          console.warn(`⚠️ consumer 推送失败: ${pushResult.error}`);
        }
      } else {
        console.warn(`⚠️ 不支持的 consumer renderer: ${renderer}，跳过设备推送`);
      }
    } finally {
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        // ignore
      }
    }
  }

  /**
   * Read an object from MinIO into a Buffer (clean async helper, no Promise executor anti-pattern)
   */
  private async readMinIOObject(objectKey: string): Promise<Buffer> {
    const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
    const imageStorage = getImageStorage();
    const bucket = process.env.MINIO_BUCKET || 'quote0-images';
    const stream = await imageStorage.getClient().getObject(bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Enforce soft inventory cap: mark oldest items as expired when over 100
   */
  private async enforceInventoryCap(): Promise<void> {
    try {
      const result = await this.postgres.query(`
        UPDATE content_inventory SET state='expired'
        WHERE id IN (
          SELECT id FROM content_inventory
          WHERE state IN ('ready', 'pushed')
          ORDER BY created_at ASC
          OFFSET 100
        )
      `);
      if (result.rowCount && result.rowCount > 0) {
        console.log(`🧹 Inventory cap enforced: ${result.rowCount} old items marked expired`);
      }
    } catch (error) {
      console.warn('⚠️ Inventory cap enforcement failed:', error);
    }
  }
}

function createJobInstance(job: NormalizedSchedulerJob): SchedulerJobInstance {
  // 从数据库记录中恢复完整状态（持久化支持）
  const savedState = (job as any).state || {};
  const currentSourceIndex = typeof (job as any).currentSourceIndex === 'number'
    ? (job as any).currentSourceIndex
    : 0;

  const startIndex = job.indexStrategy.startIndex ?? 0;

  // 如果有保存的状态，优先使用；否则使用默认值
  const defaultState: SchedulerJobState = {
    running: false,
    consecutiveFailures: 0,
    currentSourceIndex,
    dynamicPoolSize: null,
    nextIndex: startIndex,
    lastIndex: null,
    shuffledOrder: [],
    shuffledPointer: 0,
    recentFingerprints: [],
    failureCount: {}
  };

  const mergedState = {
    ...defaultState,
    ...savedState,
    running: false
  } as typeof defaultState;

  if (typeof mergedState.nextIndex !== 'number') {
    mergedState.nextIndex = startIndex;
  }
  if (typeof mergedState.lastIndex !== 'number' && mergedState.lastIndex !== null) {
    mergedState.lastIndex = null;
  }
  if (!Array.isArray(mergedState.shuffledOrder)) {
    mergedState.shuffledOrder = [];
  }
  if (typeof mergedState.shuffledPointer !== 'number') {
    mergedState.shuffledPointer = 0;
  }
  if (!Array.isArray(mergedState.recentFingerprints)) {
    mergedState.recentFingerprints = [];
  }
  if (!mergedState.failureCount || typeof mergedState.failureCount !== 'object') {
    mergedState.failureCount = {};
  }

  return {
    config: job,
    state: mergedState,
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
    disabledSources: record.disabledSources || [], // 禁用的RSS源列表
    currentSourceIndex: record.currentSourceIndex || 0, // RSS源轮换索引
    processor: record.processor,
    renderer: record.renderer,
    intervalMs: record.intervalMs,
    initialDelayMs: record.initialDelayMs,
    options: record.options || {},
    indexStrategy: normalizeIndexStrategy(record.indexStrategy as RequiredSchedulerIndexStrategy),
    enabled: record.enabled !== false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRunAt: record.lastRunAt,  // 持久化字段
    nextRunAt: record.nextRunAt,  // 持久化字段
    state: record.state || {},     // 持久化字段
    jobRole: record.jobRole || record.job_role || 'mixed'
  };
}

function normalizeIndexStrategy(strategy: Partial<RequiredSchedulerIndexStrategy> & { type?: 'fair-rotation' | 'shuffle' }): RequiredSchedulerIndexStrategy {
  // 支持poolSize=-1表示动态获取RSS源实际条目数 | Support poolSize=-1 for dynamic RSS feed item count
  const poolSize = strategy?.poolSize === -1
    ? -1
    : Math.max(1, strategy?.poolSize ?? 10);

  const startIndexValue = strategy?.startIndex ?? 0;
  // 动态poolSize模式下，startIndex直接使用0
  const startIndex = poolSize === -1
    ? 0
    : ((startIndexValue % poolSize) + poolSize) % poolSize;

  return {
    type: 'fair-rotation',
    poolSize,
    startIndex,
    cooldownHours: strategy?.cooldownHours ?? 24,
    maxPushCount: strategy?.maxPushCount ?? 5,
    rotateAfterEachPush: strategy?.rotateAfterEachPush ?? true,
    skipEmptySource: strategy?.skipEmptySource ?? true
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

function arraysEqual<T>(a: T[] | undefined, b: T[]): boolean {
  if (!Array.isArray(a)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export async function buildSchedulerFromDatabase(): Promise<NewsScheduler> {
  const scheduler = new NewsScheduler();
  await scheduler.start();
  console.log(`🗞️ 新闻定时任务管理器已启动，共 ${scheduler.getSummaries().length} 个任务`);
  return scheduler;
}
