import { processNews, computeNewsFingerprint } from './news-processing-service.js';
import { assessProducedContentQuality, assessSourceEvidence } from './content-quality.js';
import {
  markUniversalResearchPending,
  universalResearchEnabled,
} from './universal-research-policy.js';
import { devicePusher } from './device-pusher.js';
import { enqueueDeliveriesForContent, enqueuePreRenderedImageDeliveries } from './delivery-enqueue.js';
import { resolveSchedulerExtraRenderers } from './scheduler-extra-renderers.js';
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
import type { RawDataItem, RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import { renderingRegistry } from '../react-widgets/core/rendering-modules.js';
import { modularNewsPlugin } from '../react-widgets/plugins/modular-news-plugin.js';
import React from 'react';
import { weatherPlugin } from '../react-widgets/plugins/weather-plugin.js';
import { SatoriWeatherWidget } from '../react-widgets/components/SatoriWeatherWidget.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../react-widgets/core/device-constants.js';
import { RECOMMENDED_RSS_SOURCE_IDS } from '../react-widgets/core/data-sources/rss-source-registry.js';
import { buildRssIdentityKey } from '../react-widgets/core/data-sources/rss-data-source.js';
import { recordRssSourceFailure, recordRssSourceSuccess } from './rss-source-health.js';
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
  sourceCooldownUntil: Record<string, string>;
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
  jobRole?: 'producer' | 'consumer' | 'mixed';
  renderer?: string;
  dataSource?: string;
  rssSource?: string;
  rssSources?: string[];
  processor?: string;
  category?: string;
}

interface CandidateArticle {
  index: number;
  fingerprint: string;
  publishTime?: string;
  pushCount: number;
  lastPushedAt?: string | null;
  context: NewsPushContext;
}

interface RssFingerprintAliasRow {
  fingerprint?: string | null;
  link?: string | null;
  title?: string | null;
}

export function buildRssFingerprintAliasMap(
  sourceId: string,
  rows: RssFingerprintAliasRow[],
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const row of rows) {
    const fingerprint = typeof row.fingerprint === 'string' ? row.fingerprint.trim() : '';
    if (!fingerprint) continue;
    const subjectKey = buildRssIdentityKey({
      sourceId,
      link: typeof row.link === 'string' ? row.link : undefined,
      title: typeof row.title === 'string' ? row.title : undefined,
    });
    // Query rows newest-first. Keep the newest legacy fingerprint for a subject
    // so rolling out stable subject identity does not create a one-time duplicate wave.
    if (subjectKey && !aliases.has(subjectKey)) aliases.set(subjectKey, fingerprint);
  }
  return aliases;
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

// 复播时间窗：consumer 只循环复播 created_at 落在此窗口内的库存（单位：小时）。
// env INVENTORY_REPLAY_WINDOW_HOURS 可覆盖，默认 24h。
const REPLAY_WINDOW_HOURS = Number(process.env.INVENTORY_REPLAY_WINDOW_HOURS) || 24;

// 依赖外部 LLM 的 processor。这类 processor 失败（402 欠费/超时/连接错）属于
// 「外部供给中断」而非「内容本身不可用」，producer 应降级续产而不是停产。
const PRODUCER_LLM_PROCESSORS = new Set(['ax-optimized', 'basic-llm']);
// 降级目标：不调用任何 LLM，直接透传 RSS 原文。
const PRODUCER_FALLBACK_PROCESSOR = 'passthrough';

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
      
      // 创建平衡多源 RSS 轮播任务。8 源 × 10min ≈ 每个站点 80min 抓一次，
      // 与历史 4 源 × 20min 的单站压力相当，但整体新内容生产频率约翻倍。
      await this.postgres.upsertSchedulerJob({
        id: 'multi-source-rotation',
        name: '多源RSS轮播',
        description: '平衡轮播中文、全球科技与开发者核心 RSS 源',
        category: 'news',
        dataSource: 'rss',
        rssSource: RECOMMENDED_RSS_SOURCE_IDS[0] || 'solidot',
        rssSources: RECOMMENDED_RSS_SOURCE_IDS,
        processor: 'ax-optimized',
        renderer: 'device',
        intervalMs: 10 * 60 * 1000,
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
        enabled: true,
        jobRole: job.config.jobRole,
        renderer: job.config.renderer,
        dataSource: job.config.dataSource,
        rssSource: job.config.rssSource,
        rssSources: job.config.rssSources,
        processor: job.config.processor,
        category: job.config.category,
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
        const sourceFailure = selectionOutcome.attempts.some((item) =>
          item.reason === 'fetch_error' || item.reason === 'data_source_missing'
        );
        const producerNoFreshCandidate = job.config.jobRole === 'producer' && !sourceFailure;
        const reason = producerNoFreshCandidate
          ? 'producer:no_fresh_candidate'
          : selectionOutcome.attempts.length
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

        if (producerNoFreshCandidate) {
          // producer 的职责是补充新鲜库存；源可访问但本轮没有新鲜候选不是 source failure。
          // consumer 已有独立 LRU replay，因此这里应直接轮到下一个源，而不是 fallback 旧闻。
          this.resetFailureCount(job, currentRssSource);
          job.state.consecutiveFailures = 0;
          await recordRssSourceSuccess(this.postgres, currentRssSource).catch((healthError) => {
            console.warn(`⚠️ RSS源健康状态恢复记录失败: source=${currentRssSource}`, healthError);
          });
          await this.rotateRssSource(job);
          const nextRunAt = new Date(Date.now() + job.config.intervalMs);
          await this.persistSchedulerState(job, nextRunAt);
          return;
        }

        this.incrementFailureCount(job, currentRssSource);
        job.state.consecutiveFailures += 1;

        await this.handlePostRunFailure(job, currentRssSource, reason);
        return;
      }

      const candidate = selection.candidate;
      const sourceQuality = assessSourceEvidence({
        title: candidate.context.title,
        content: candidate.context.content,
        description: candidate.context.description,
      });

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
      let producerRenderableData: RenderableDataItem | undefined;
      // producer 降级标记：LLM 处理失败后改用 passthrough 产出时置位，
      // 随 processed_content 一同落库，让下游能分辨「这条是降级产物」。
      let producerDegraded = false;
      let producerDegradeReason: string | undefined;
      let producerEffectiveProcessor = request.processor;
      try {
        if (isProducer) {
          // Keep the LLM-processed structure as the inventory SSoT. The old
          // `processNews(renderer=news)` path returned only a MinIO URL, so
          // processed_content was silently stored as NULL and consumers had
          // to fall back to raw RSS text.
          const buildRenderableData = (processor: string | undefined) =>
            modularNewsPlugin.getRenderableData({
              category: request.category,
              dataSource: request.dataSource,
              rssSource: request.rssSource,
              processor,
              renderer: 'news',
              index: request.index,
              border: request.options?.border,
            });

          if (
            sourceQuality.mode === 'seed-only'
            && PRODUCER_LLM_PROCESSORS.has(request.processor || '')
          ) {
            // Evidence-bounded generation: only a true seed-only payload (no semantic
            // proposition beyond headline/boilerplate) skips publishable Direct synthesis.
            // Sparse but meaningful evidence still reaches the LLM and is later marked
            // Research-recommended. This is deliberately not a character-count rule.
            const reason = `content_quality:${sourceQuality.reasons.join(',')}`;
            console.warn(
              `⚠️ producer 源只有 seed/boilerplate，禁止 publishable Direct synthesis；保留素材并交给 Research: `
                + `job=${job.config.id} processor=${request.processor} ${reason}`,
            );
            producerRenderableData = await buildRenderableData(PRODUCER_FALLBACK_PROCESSOR);
            producerDegraded = true;
            producerDegradeReason = reason;
            producerEffectiveProcessor = PRODUCER_FALLBACK_PROCESSOR;
          } else {
            try {
              producerRenderableData = await buildRenderableData(request.processor);
            } catch (llmError) {
              // LLM 类 processor 失败（402 欠费 / 超时 / 连接错）时确定性降级为
              // passthrough：产物质量下降，但产线不停。若 passthrough 也失败，
              // 说明坏的是 RSS/数据源本身而非 LLM，抛原始错误交由上层失败路径处理。
              // 一次降级即定局：不做 LLM 重试/退避/provider 熔断（Phase 2 议题）。
              if (PRODUCER_LLM_PROCESSORS.has(request.processor || '')) {
                const llmMessage = llmError instanceof Error ? llmError.message : String(llmError);
                console.warn(
                  `⚠️ producer LLM 处理失败，降级为 passthrough 继续产出: ` +
                  `job=${job.config.id} processor=${request.processor} 原始错误=${llmMessage}`,
                );
                try {
                  producerRenderableData = await buildRenderableData(PRODUCER_FALLBACK_PROCESSOR);
                } catch {
                  // passthrough 同样失败 → 数据源问题，保持现状抛原始错误
                  throw llmError;
                }
                producerDegraded = true;
                producerDegradeReason = llmMessage;
                producerEffectiveProcessor = PRODUCER_FALLBACK_PROCESSOR;
              } else {
                throw llmError;
              }
            }
          }
          const newsRenderer = renderingRegistry.get('news');
          if (!newsRenderer) throw new Error('渲染器 news 不存在');
          const imageUrl = await newsRenderer.render(producerRenderableData, {
            border: request.options?.border || '0',
            width: request.options?.width || EINK_DEVICE_WIDTH,
            height: request.options?.height || EINK_DEVICE_HEIGHT,
          });
          result = {
            result: imageUrl,
            cacheHit: false,
            cacheSource: 'producer-render',
            cacheKey: candidate.fingerprint,
            processingTime: Date.now() - processStart,
            workflow: 'producer-process-then-render',
            params: {
              category: request.category || 'news',
              dataSource: request.dataSource || 'rss',
              processor: producerEffectiveProcessor || 'passthrough',
              renderer: 'news',
              index: request.index || 0,
              rssSource: request.rssSource || currentRssSource,
              force: false,
            },
            config: {
              border: request.options?.border || '0',
              width: request.options?.width || EINK_DEVICE_WIDTH,
              height: request.options?.height || EINK_DEVICE_HEIGHT,
            },
            context: request.context,
            cacheKeyObject: {},
          };
        } else {
          result = await processNews(request);
        }
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

      // Fire-and-forget: 额外渲染器。producer 的 local-eink 已由 Phase 1 delivery worker 接管，
      // 必须忽略旧 env 旁路，避免同一内容直推 + delivery 双推并发撞同一 ESP32。
      const extraResolution = resolveSchedulerExtraRenderers(
        process.env.NEWS_SCHEDULER_EXTRA_RENDERERS,
        job.config.jobRole,
      );
      if (extraResolution.ignored.includes('local-eink')) {
        console.warn('⚠️ producer 忽略 legacy NEWS_SCHEDULER_EXTRA_RENDERERS=local-eink：请使用 device_deliveries 正门');
      }
      const extraRenderers = extraResolution.renderers;
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
      if (producerRenderableData) {
        processedContent = {
          title: producerRenderableData.title,
          message: producerRenderableData.message,
          summary: producerRenderableData.message,
          source: producerRenderableData.source || candidate.context.source,
          signature: producerRenderableData.signature,
          link: producerRenderableData.link || candidate.context.link,
          category: producerRenderableData.category || candidate.context.category || job.config.category,
          publishTime: producerRenderableData.publishTime || candidate.context.publishTime,
          metadata: producerRenderableData.metadata,
        };
        if (producerDegraded) {
          // 降级痕迹随内容落库（不改列结构）：下游/排障可据此区分
          // 「LLM 精加工产物」与「LLM 不可用时的透传产物」。
          processedContent.degraded = true;
          processedContent.degradedReason = producerDegradeReason;
          processedContent.degradedFrom = request.processor;
          processedContent.processor = producerEffectiveProcessor;
        }
      } else if (result.result && typeof result.result === 'object' && !Buffer.isBuffer(result.result)) {
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

      if (processedContent) {
        const contentQuality = assessProducedContentQuality(rawContent, processedContent);
        processedContent.metadata = {
          ...(processedContent.metadata && typeof processedContent.metadata === 'object'
            ? processedContent.metadata
            : {}),
          contentQuality,
        };
        if (contentQuality.disposition === 'hold') {
          console.warn(
            `🛡️ Content Quality HOLD fingerprint=${candidate.fingerprint} `
              + `recommendation=${contentQuality.recommendation} reasons=${contentQuality.reasons.join(',')} `
              + `unsupported=${contentQuality.unsupportedHardFacts.join(',') || '-'}`,
          );
        }
        if (job.config.jobRole === 'producer' && universalResearchEnabled()) {
          processedContent = markUniversalResearchPending(processedContent);
        }
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
      await recordRssSourceSuccess(this.postgres, currentRssSource).catch((healthError) => {
        console.warn(`⚠️ RSS源健康状态恢复记录失败: source=${currentRssSource}`, healthError);
      });

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

      await this.handlePostRunFailure(job, currentRssSource, message);
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

      // 5. 输出到目标。
      // local-eink 走 Phase 1 正门：预渲染天气图先做不可变 payload snapshot，再按设备登记 delivery；
      // 物理 POST 只允许 device-delivery-worker 执行。MindReset(device) 保持原同步 API 语义。
      let deviceResult = '未推送';
      let pushResults: Array<{ device: string; ok: boolean; error?: string }> = [];
      let einkDelivery: Awaited<ReturnType<typeof enqueuePreRenderedImageDeliveries>> | null = null;

      if (job.config.renderer === 'local-eink') {
        einkDelivery = await enqueuePreRenderedImageDeliveries({
          sourceKey: `weather:${job.config.id}`,
          pngBuffer: imageBuffer,
        });
        if (einkDelivery.targeted === 0) {
          throw new Error('天气任务未配置 E-Ink 设备，无法创建持久投递');
        }
        deviceResult = `E-Ink delivery queued: ${einkDelivery.created}/${einkDelivery.targeted} new`;
        console.log(
          `📮 天气任务 ${job.config.id} 已登记 E-Ink delivery: ` +
          `created=${einkDelivery.created}/${einkDelivery.targeted} ` +
          `payload=${einkDelivery.payloadHash?.slice(0, 12) ?? '-'}`,
        );
      } else if (job.config.renderer === 'device') {
        const pushResult = await devicePusher.push(localImagePath, 'device');
        deviceResult = pushResult.deviceResult || pushResult.error || '未推送';
        if (pushResult.pushResults) {
          pushResults = pushResult.pushResults;
        }
      }

      // 6. 记录输出结果
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
          imageUrl,
          einkDelivery: einkDelivery ? {
            created: einkDelivery.created,
            targeted: einkDelivery.targeted,
            deviceIds: einkDelivery.deviceIds,
            payloadVersion: einkDelivery.payloadVersion,
            payloadHash: einkDelivery.payloadHash,
          } : null,
        }
      });

      // 7. 更新运行历史。local-eink 此时只是 queued，不再伪称物理 pushed。
      if (runHistoryId) {
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus: 'success',
          pushReason: job.config.renderer === 'local-eink' ? 'weather_delivery_queued' : 'weather_pushed',
          runFinishedAt: new Date(),
          metadata: {
            city,
            weather: weatherData.weather,
            temperature: weatherData.temperature,
            deviceResult,
            einkDelivery: einkDelivery ? {
              created: einkDelivery.created,
              targeted: einkDelivery.targeted,
              payloadVersion: einkDelivery.payloadVersion,
              payloadHash: einkDelivery.payloadHash,
            } : null,
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

      // local-eink / both：同样只登记持久 delivery，不再从 scheduler 直接 POST ESP32。
      let localEinkQueued = targetRenderer !== 'local-eink' && targetRenderer !== 'both';
      if (targetRenderer === 'local-eink' || targetRenderer === 'both') {
        try {
          const enqueued = await enqueuePreRenderedImageDeliveries({
            sourceKey: `memo:${memo.id}`,
            pngBuffer,
          });
          localEinkQueued = enqueued.targeted > 0;
          pushDetails.localEink = {
            queued: localEinkQueued,
            created: enqueued.created,
            targeted: enqueued.targeted,
            deviceIds: enqueued.deviceIds,
            payloadVersion: enqueued.payloadVersion,
            payloadHash: enqueued.payloadHash,
          };
          if (localEinkQueued) {
            console.log(
              `📮 Memo任务 ${job.config.id} 已登记 E-Ink delivery: memo.id=${memo.id} ` +
              `created=${enqueued.created}/${enqueued.targeted} payload=${enqueued.payloadHash?.slice(0, 12) ?? '-'}`,
            );
          }
        } catch (einkError) {
          const msg = einkError instanceof Error ? einkError.message : String(einkError);
          console.error(`❌ Memo任务 ${job.config.id} local-eink 登记异常: ${msg}`);
          pushDetails.localEink = { queued: false, error: msg };
          localEinkQueued = false;
        }
      }

      // 成败判定：单目标必须成功；both 允许其中一路成功，run history 会如实标 partial_success。
      if (targetRenderer === 'device' && !deviceOk) {
        throw new Error(`MindReset 推送失败: ${pushDetails.device?.error || 'unknown'}`);
      }
      if (targetRenderer === 'local-eink' && !localEinkQueued) {
        throw new Error(`E-Ink delivery 登记失败: ${pushDetails.localEink?.error || 'no_target_device'}`);
      }
      // 保持既有 both 契约：MindReset 是必达主通道；E-Ink 失败可降为 partial_success，
      // 但不能趁本次队列重构悄悄把 “both” 改成“任一成功即可”。
      if (targetRenderer === 'both' && !deviceOk) {
        throw new Error(`both 模式 MindReset 推送失败: ${pushDetails.device?.error || 'unknown'}`);
      }

      console.log(`✅ Memo任务 ${job.config.id} 推送完成: memo.id=${memo.id}, target=${targetRenderer}`);

      job.state.consecutiveFailures = 0;
      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);

      if (runHistoryId) {
        const bothPartial = targetRenderer === 'both' && (!deviceOk || !localEinkQueued);
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus: bothPartial ? 'partial_success' : 'success',
          pushReason: targetRenderer === 'local-eink'
            ? 'memo_delivery_queued'
            : bothPartial
              ? 'memo_partial_output'
              : 'memo_pushed',
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

    // Compatibility bridge for the stable RSS subject identity rollout. Existing
    // inventory rows use the legacy fingerprint formula; reuse that fingerprint
    // when the same canonical RSS subject is still in the active article window.
    // Brand-new subjects receive the new stable subject fingerprint immediately.
    const identityLookbackHours = Math.max(REPLAY_WINDOW_HOURS, this.strategyConfig.maxArticleAgeHoursRelaxed);
    const aliasRows = await this.postgres.query(
      `SELECT fingerprint, link, title
         FROM content_inventory
        WHERE source = $1
          AND created_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 hour')
          AND fingerprint IS NOT NULL
        ORDER BY created_at DESC`,
      [currentRssSource, identityLookbackHours],
    );
    const fingerprintAliases = buildRssFingerprintAliasMap(
      currentRssSource,
      aliasRows.rows as RssFingerprintAliasRow[],
    );
    let reusedLegacyFingerprintCount = 0;

    const candidates = rawItems.map((item, idx) => {
      const originalIndex = item.metadata?.originalIndex ?? item.metadata?.index ?? idx;
      const rssIdentityKey = typeof item.metadata?.rssIdentityKey === 'string'
        ? item.metadata.rssIdentityKey
        : '';
      const stableFingerprint = computeNewsFingerprint({
        title: item.title,
        link: item.link,
        publishTime: item.publishTime,
        identityKey: rssIdentityKey || null,
        // RSS freshness/display time may be synthesized from the fetch clock when
        // pubDate is missing or clamped. Explicit null means "identity has no time"
        // rather than falling back to that unstable effective publishTime.
        identityPublishTime: typeof item.metadata?.identityPublishTime === 'string'
          ? item.metadata.identityPublishTime
          : null,
        source: item.source,
        category: item.category || job.config.category,
        fallback: `${job.config.dataSource}:${job.config.rssSource}:${originalIndex}`
      });
      const legacyAlias = rssIdentityKey ? fingerprintAliases.get(rssIdentityKey) : undefined;
      const fingerprint = legacyAlias || stableFingerprint;
      if (legacyAlias) reusedLegacyFingerprintCount += 1;
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
    if (reusedLegacyFingerprintCount > 0) {
      console.log(
        `🪪 RSS stable-identity compatibility: source=${currentRssSource} `
          + `reusedLegacy=${reusedLegacyFingerprintCount}/${candidates.length}`,
      );
    }

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

    if (job.config.jobRole === 'producer') {
      attempts.push({ layer: 'fallback', reason: 'producer_disabled' });
      return {
        selection: null,
        attempts,
        totalCandidates,
        poolSize
      };
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

  private async resolveRunnableSource(job: SchedulerJobInstance, overrideIndex?: number): Promise<{ source: string; skipped: Array<{ source: string; failureCount: number; cooldownUntil?: string }> }> {
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

    const skipped: Array<{ source: string; failureCount: number; cooldownUntil?: string }> = [];
    let currentSource = initialSource;
    const now = Date.now();

    for (let attempt = 0; attempt < enabledSources.length; attempt++) {
      const failureCount = this.getFailureCount(job, currentSource);
      const cooldownUntil = this.getSourceCooldownUntil(job, currentSource);

      if (cooldownUntil && cooldownUntil > now) {
        const cooldownIso = new Date(cooldownUntil).toISOString();
        skipped.push({ source: currentSource, failureCount, cooldownUntil: cooldownIso });
        console.warn(`⚠️ 源 ${currentSource} 冷却中，跳过到 ${cooldownIso}`);
        await this.rotateRssSource(job);
        currentSource = this.getCurrentRssSource(job);
        continue;
      }

      if (cooldownUntil && cooldownUntil <= now) {
        // 冷却到期仅放行一次 probe；若再次失败，handlePostRunFailure 会重新进入冷却。
        this.clearSourceCooldown(job, currentSource);
        if (failureCount >= threshold) {
          this.reduceFailureCount(job, currentSource, Math.max(0, threshold - 1));
        }
        return { source: currentSource, skipped };
      }

      if (failureCount < threshold) {
        return { source: currentSource, skipped };
      }

      const nextCooldown = this.setSourceCooldown(job, currentSource);
      skipped.push({ source: currentSource, failureCount, cooldownUntil: nextCooldown.toISOString() });
      console.warn(`⚠️ 源 ${currentSource} 连续失败 ${failureCount} 次，进入冷却到 ${nextCooldown.toISOString()}`);
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
      blockedByRecent: 0,
      blockedByAge: 0
    };

    const config = layer === 'strict'
      ? {
          cooldownMs: this.strategyConfig.cooldownHoursStrict * 60 * 60 * 1000,
          maxPushCount: this.strategyConfig.maxPushCountStrict,
          recentLimit: this.strategyConfig.recentFingerprintsLimitStrict,
          maxArticleAgeMs: this.strategyConfig.maxArticleAgeHoursStrict * 60 * 60 * 1000,
        }
      : {
          cooldownMs: this.strategyConfig.cooldownHoursRelaxed * 60 * 60 * 1000,
          maxPushCount: this.strategyConfig.maxPushCountRelaxed,
          recentLimit: this.strategyConfig.recentFingerprintsLimitRelaxed,
          maxArticleAgeMs: this.strategyConfig.maxArticleAgeHoursRelaxed * 60 * 60 * 1000,
        };

    const filtered: CandidateArticle[] = [];
    for (const candidate of candidates) {
      if (candidate.publishTime && config.maxArticleAgeMs > 0) {
        const publishMs = new Date(candidate.publishTime).getTime();
        if (Number.isFinite(publishMs) && now - publishMs > config.maxArticleAgeMs) {
          stats.blockedByAge += 1;
          continue;
        }
      }
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
        sourceCooldownUntil: job.state.sourceCooldownUntil,
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
    this.clearSourceCooldown(job, source);
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

  private getSourceCooldownUntil(job: SchedulerJobInstance, source: string | undefined): number | null {
    if (!source) return null;
    this.ensureIndexState(job);
    const raw = job.state.sourceCooldownUntil[source];
    if (!raw) return null;
    const value = new Date(raw).getTime();
    return Number.isFinite(value) ? value : null;
  }

  private setSourceCooldown(job: SchedulerJobInstance, source: string): Date {
    this.ensureIndexState(job);
    const cooldownMinutes = Math.max(1, this.strategyConfig.sourceFailureCooldownMinutes ?? 120);
    const until = new Date(Date.now() + cooldownMinutes * 60_000);
    job.state.sourceCooldownUntil[source] = until.toISOString();
    return until;
  }

  private clearSourceCooldown(job: SchedulerJobInstance, source: string): void {
    this.ensureIndexState(job);
    delete job.state.sourceCooldownUntil[source];
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
      failureCount: job.state.failureCount,
      sourceCooldownUntil: job.state.sourceCooldownUntil
    }, nextRunAt);
  }

  private async handlePostRunFailure(job: SchedulerJobInstance, currentRssSource: string, reason = ''): Promise<void> {
    const threshold = this.strategyConfig.sourceFailureSkipThreshold ?? 0;
    const failureCount = this.getFailureCount(job, currentRssSource);
    await recordRssSourceFailure(this.postgres, {
      sourceId: currentRssSource,
      consecutiveFailures: failureCount,
      threshold: Math.max(1, threshold || 1),
      reason,
    }).catch((healthError) => {
      console.warn(`⚠️ RSS源健康状态失败记录失败: source=${currentRssSource}`, healthError);
    });
    if (threshold > 0 && failureCount >= threshold) {
      const cooldownUntil = this.setSourceCooldown(job, currentRssSource);
      console.warn(`⚠️ 源 ${currentRssSource} 连续失败 ${failureCount} 次，冷却到 ${cooldownUntil.toISOString()} 并轮换到下一个源`);
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
    if (!job.state.sourceCooldownUntil || typeof job.state.sourceCooldownUntil !== 'object') {
      job.state.sourceCooldownUntil = {};
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

      // 1. Prefer ready items (FIFO)，限制在复播时间窗内
      let item = await this.postgres.query(`
        SELECT * FROM content_inventory
        WHERE state='ready'
          AND COALESCE(processed_content->'metadata'->'contentQuality'->>'disposition', 'deliver') <> 'hold'
          AND (
            COALESCE(processed_content->'metadata'->'researchGate'->>'required', 'false') <> 'true'
            OR processed_content->'metadata'->'researchGate'->>'state' = 'ready'
          )
          AND created_at > CURRENT_TIMESTAMP - ($1 * INTERVAL '1 hour')
        ORDER BY created_at ASC
        LIMIT 1
      `, [REPLAY_WINDOW_HOURS]);

      // 2. Fallback to pushed items using source-fair LRU.
      // Historical plain item-LRU made display share proportional to inventory size,
      // so high-volume DEV/HN could visually drown low-volume sources such as Solidot
      // even though the producer itself rotates sources fairly. Rank the source by its
      // most recent display first, then the oldest item inside that source. The existing
      // replay window still bounds staleness and fresh `ready` content remains FIFO-first.
      if (item.rows.length === 0) {
        item = await this.postgres.query(`
          SELECT ranked.*
          FROM (
            SELECT ci.*,
                   MAX(ci.last_pushed_at) OVER (PARTITION BY ci.source) AS source_last_pushed_at
            FROM content_inventory ci
            WHERE ci.state='pushed'
              AND COALESCE(ci.processed_content->'metadata'->'contentQuality'->>'disposition', 'deliver') <> 'hold'
              AND (
                COALESCE(ci.processed_content->'metadata'->'researchGate'->>'required', 'false') <> 'true'
                OR ci.processed_content->'metadata'->'researchGate'->>'state' = 'ready'
              )
              AND ci.created_at > CURRENT_TIMESTAMP - ($1 * INTERVAL '1 hour')
          ) ranked
          ORDER BY ranked.source_last_pushed_at ASC NULLS FIRST,
                   ranked.last_pushed_at ASC NULLS FIRST,
                   ranked.created_at ASC
          LIMIT 1
        `, [REPLAY_WINDOW_HOURS]);
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

      // 4. local-eink must re-render from structured content for each runtime
      // RenderTarget. Reusing the producer PNG here makes a 296x152 inventory
      // asset get resized to 296x128 and destroys point-to-point pixel layout.
      // 记录本轮投递登记结果，供后续 scheduler_run_history 与日志统一使用。
      let enqueueCreated = -1;
      let enqueueTargeted = -1;
      let enqueuePayloadVersion = 0;
      let enqueueDeviceIds: string[] = [];

      if (job.config.renderer === 'local-eink') {
        // Phase 1：consumer 不再物理推送，只为每台目标设备创建一条持久化 delivery。
        // 真正的发送由 device-delivery-worker 异步完成：在线设备几秒内收到，
        // 离线设备按 15s→1m→5m→15m→1h 退避补投。
        // 于是 Phase 0 的“宁漏勿重”升级为“晚到但不重”：
        //   不重 ← UNIQUE(content_id, device_id, payload_version)
        //   不漏 ← delivery 持久化 + worker 退避重试
        // consumer 本身只要“登记成功”就算本轮完成，不再被单台离线设备阻塞。
        const enqueued = await enqueueDeliveriesForContent({
          contentId: inventoryItem.id,
        });

        if (enqueued.targeted === 0) {
          throw new Error('未配置 E-Ink 设备，无法创建投递任务');
        }
        enqueueCreated = enqueued.created;
        enqueueTargeted = enqueued.targeted;
        enqueuePayloadVersion = enqueued.payloadVersion;
        enqueueDeviceIds = enqueued.deviceIds;

        const deliveryAllSucceeded = enqueueCreated === enqueueTargeted;
        const deliveryAllFailed = enqueueCreated === 0;

        // 已登记投递日志：只有全成功才用 📮；部分/全失败必须上升到警告/错误级别。
        const registerEmoji = deliveryAllSucceeded ? '📮' : (deliveryAllFailed ? '❌' : '⚠️');
        console.log(
          `${registerEmoji} Consumer ${job.config.id} 已登记投递: content=${inventoryItem.id} ` +
          `payloadVersion=${enqueuePayloadVersion} created=${enqueueCreated}/${enqueueTargeted} ` +
          `devices=[${enqueueDeviceIds.join(', ')}]`
        );
        if (!deliveryAllSucceeded) {
          const conflictReason = `delivery_insert_conflict: ${enqueueCreated}/${enqueueTargeted} devices registered`;
          if (deliveryAllFailed) {
            console.error(
              `❌ Consumer ${job.config.id} 投递登记全失败（${conflictReason}），` +
              `内容已消费但可能没有设备收到`
            );
          } else {
            console.warn(
              `⚠️ Consumer ${job.config.id} 投递登记部分失败（${conflictReason}）`
            );
          }
        }
      } else {
        await this.pushImageFromMinIO(inventoryItem.image_path, job);
      }

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
        // local-eink 且登记数量不足时必须如实上报，不能继续撒谎 success。
        let pushStatus: string;
        let pushReason: string;
        if (job.config.renderer === 'local-eink') {
          if (enqueueCreated === enqueueTargeted) {
            pushStatus = 'success';
            pushReason = 'inventory_consumed';
          } else if (enqueueCreated === 0) {
            pushStatus = 'failed';
            pushReason = 'delivery_insert_conflict';
          } else {
            pushStatus = 'partial_success';
            pushReason = `delivery_insert_conflict:${enqueueCreated}/${enqueueTargeted}`;
          }
        } else {
          pushStatus = 'success';
          pushReason = 'inventory_consumed';
        }
        await this.postgres.updateSchedulerRunHistory(runHistoryId, {
          pushStatus,
          pushReason,
          candidateFingerprint: inventoryItem.fingerprint,
          runFinishedAt: new Date(),
          metadata: {
            inventoryId: inventoryItem.id,
            replayCount: updatedReplayCount,
            created: enqueueCreated >= 0 ? enqueueCreated : undefined,
            targeted: enqueueTargeted >= 0 ? enqueueTargeted : undefined,
            payloadVersion: enqueuePayloadVersion || undefined,
          }
        });
      }

      job.state.consecutiveFailures = 0;
      const nextRunAt = new Date(Date.now() + job.config.intervalMs);
      await this.persistSchedulerState(job, nextRunAt);
      if (job.config.renderer === 'local-eink') {
        const deliveryAllSucceeded = enqueueCreated === enqueueTargeted;
        const deliveryAllFailed = enqueueCreated === 0;
        if (deliveryAllSucceeded) {
          console.log(`✅ Consumer ${job.config.id} 完成，下次运行: ${nextRunAt.toISOString()}`);
        } else if (deliveryAllFailed) {
          console.error(`❌ Consumer ${job.config.id} 完成但投递全失败，下次运行: ${nextRunAt.toISOString()}`);
        } else {
          console.warn(`⚠️ Consumer ${job.config.id} 完成但投递部分失败，下次运行: ${nextRunAt.toISOString()}`);
        }
      } else {
        console.log(`✅ Consumer ${job.config.id} 完成，下次运行: ${nextRunAt.toISOString()}`);
      }

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

    const { randomUUID } = await import('crypto');
    const tempFileName = `inventory_${randomUUID()}.png`;
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
      if (renderer === 'local-eink') {
        throw new Error('local-eink consumer 禁止走 pushImageFromMinIO 直推；必须使用 device_deliveries');
      }
      if (renderer === 'device') {
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
      // 时间窗老化：created_at 超出 REPLAY_WINDOW_HOURS 的 ready/pushed 退役为 expired，
      // 与 consumer 复播查询的时间窗保持一致，不再按条数卡上限。
      const result = await this.postgres.query(`
        UPDATE content_inventory SET state='expired'
        WHERE state IN ('ready', 'pushed')
          AND created_at <= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 hour')
      `, [REPLAY_WINDOW_HOURS]);
      if (result.rowCount && result.rowCount > 0) {
        console.log(`🧹 Inventory aged out: ${result.rowCount} items older than ${REPLAY_WINDOW_HOURS}h marked expired`);
      }
    } catch (error) {
      console.warn('⚠️ Inventory aging failed:', error);
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
    failureCount: {},
    sourceCooldownUntil: {}
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
  if (!mergedState.sourceCooldownUntil || typeof mergedState.sourceCooldownUntil !== 'object') {
    mergedState.sourceCooldownUntil = {};
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

function normalizeIndexStrategy(strategy: { type?: 'fair-rotation' | 'shuffle'; poolSize?: number; startIndex?: number; cooldownHours?: number; maxPushCount?: number; rotateAfterEachPush?: boolean; skipEmptySource?: boolean }): RequiredSchedulerIndexStrategy {
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
