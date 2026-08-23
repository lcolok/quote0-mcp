import { describe, expect, it } from 'bun:test';
import { buildRssFingerprintAliasMap, NewsScheduler } from './news-scheduler.js';
import { getSchedulerStrategyConfig } from './scheduler-strategy-config.js';

function makeJob() {
  return {
    config: {
      id: 'source-cooldown-test',
      rssSource: 'bad',
      rssSources: ['bad', 'good'],
      disabledSources: [],
      intervalMs: 600_000,
      indexStrategy: {
        type: 'fair-rotation',
        poolSize: 4,
        startIndex: 0,
        cooldownHours: 24,
        maxPushCount: 5,
        rotateAfterEachPush: true,
        skipEmptySource: true,
      },
    },
    state: {
      running: false,
      consecutiveFailures: 0,
      currentSourceIndex: 0,
      dynamicPoolSize: null,
      nextIndex: 0,
      lastIndex: null,
      shuffledOrder: [],
      shuffledPointer: 0,
      recentFingerprints: [],
      failureCount: { bad: 3, good: 0 },
      sourceCooldownUntil: {},
    },
    timer: null,
  } as any;
}

function makeScheduler() {
  const scheduler = new NewsScheduler() as any;
  scheduler.strategyConfig = {
    ...getSchedulerStrategyConfig(),
    sourceFailureSkipThreshold: 3,
    sourceFailureCooldownMinutes: 120,
    maxArticleAgeHoursStrict: 24,
    maxArticleAgeHoursRelaxed: 72,
  };
  scheduler.rotateRssSource = async (job: any) => {
    const sources = job.config.rssSources;
    job.state.currentSourceIndex = (job.state.currentSourceIndex + 1) % sources.length;
  };
  return scheduler;
}

describe('scheduler RSS stable identity compatibility', () => {
  it('reuses the newest legacy fingerprint for the same canonical RSS subject during rollout', () => {
    const aliases = buildRssFingerprintAliasMap('infoq-cn', [
      {
        fingerprint: 'newer-legacy-fingerprint',
        link: 'https://www.infoq.cn/article/abc?utm_source=rss&utm_medium=article',
        title: 'Corrected title',
      },
      {
        fingerprint: 'older-legacy-fingerprint',
        link: 'https://www.infoq.cn/article/abc?utm_source=old',
        title: 'Old title',
      },
    ]);

    expect(aliases.get('infoq-cn::https://www.infoq.cn/article/abc')).toBe('newer-legacy-fingerprint');
  });
});

describe('scheduler RSS source cooldown', () => {
  it('达到失败阈值后同一 run 直接跳到健康源，并建立真正的 cooldown', async () => {
    const scheduler = makeScheduler();
    const job = makeJob();

    const result = await scheduler.resolveRunnableSource(job);

    expect(result.source).toBe('good');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].source).toBe('bad');
    expect(result.skipped[0].failureCount).toBe(3);
    expect(Date.parse(job.state.sourceCooldownUntil.bad)).toBeGreaterThan(Date.now());
    // 不再像旧逻辑那样把 3 主动降成 2，导致下一圈立刻重新占 slot。
    expect(job.state.failureCount.bad).toBe(3);
  });

  it('cooldown 未到期时持续跳过；到期后只放行一次 probe', async () => {
    const scheduler = makeScheduler();
    const job = makeJob();
    job.state.sourceCooldownUntil.bad = new Date(Date.now() + 60_000).toISOString();

    let result = await scheduler.resolveRunnableSource(job);
    expect(result.source).toBe('good');
    expect(result.skipped[0].cooldownUntil).toBeDefined();

    job.state.currentSourceIndex = 0;
    job.state.sourceCooldownUntil.bad = new Date(Date.now() - 1_000).toISOString();
    result = await scheduler.resolveRunnableSource(job);

    expect(result.source).toBe('bad');
    expect(job.state.sourceCooldownUntil.bad).toBeUndefined();
    expect(job.state.failureCount.bad).toBe(2);
  });

  it('源恢复成功时 failure count 与 cooldown 一起归零', () => {
    const scheduler = makeScheduler();
    const job = makeJob();
    job.state.sourceCooldownUntil.bad = new Date(Date.now() + 60_000).toISOString();

    scheduler.resetFailureCount(job, 'bad');

    expect(job.state.failureCount.bad).toBe(0);
    expect(job.state.sourceCooldownUntil.bad).toBeUndefined();
  });

  it('strict 优先 24h 内新闻，relaxed 放宽到 72h，fallback 仍保留最终兜底', () => {
    const scheduler = makeScheduler();
    const job = makeJob();
    const now = Date.now();
    const candidate = (id: string, ageHours: number) => ({
      index: Number(id),
      fingerprint: `fp-${id}`,
      publishTime: new Date(now - ageHours * 60 * 60 * 1000).toISOString(),
      pushCount: 0,
      lastPushedAt: null,
      context: { fingerprint: `fp-${id}` },
    });
    const candidates = [candidate('1', 3), candidate('2', 30), candidate('3', 96)];

    const strict = scheduler.filterCandidatesForLayer('strict', candidates, job, now);
    expect(strict.filtered.map((x: any) => x.index)).toEqual([1]);
    expect(strict.stats.blockedByAge).toBe(2);

    const relaxed = scheduler.filterCandidatesForLayer('relaxed', candidates, job, now);
    expect(relaxed.filtered.map((x: any) => x.index)).toEqual([1, 2]);
    expect(relaxed.stats.blockedByAge).toBe(1);

    const fallback = scheduler.filterCandidatesForFallback(candidates, job);
    expect(fallback.filtered).toHaveLength(3);
  });
});
