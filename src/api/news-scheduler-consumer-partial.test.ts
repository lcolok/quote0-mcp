/**
 * Phase 0 止血④验收（consumer 语义）：
 * - 至少一台设备成功 → inventory 照常推进 state='pushed'、replay_count+1；
 * - 失败设备逐台 logger.warn（deviceId + errorCode + error）；
 * - 全部失败才 throw（保持原失败路径语义）。
 *
 * 生产病灶：一台离线设备 → throw → 跳过 state 推进 → 已刷新的在线设备
 * 下一轮重复收到同一条新闻（consecutiveFailures=1412）。
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---- 可编排的 push 结果 ----
let nextPushResult: any = null;
const renderAndPushMock = mock(async () => nextPushResult);

mock.module('./target-aware-eink.js', () => ({
  renderAndPushLocalEinkByTarget: renderAndPushMock,
}));

// ---- 极简 postgres 桩 ----
const executedQueries: Array<{ sql: string; params?: any[] }> = [];
let inventoryRow: any = null;

const postgresStub = {
  initialize: async () => {},
  createSchedulerRunHistory: async () => 1,
  updateSchedulerRunHistory: async () => {},
  recordPushResult: async () => {},
  getSchedulerJobs: async () => [],
  query: async (sql: string, params?: any[]) => {
    executedQueries.push({ sql, params });
    if (/FROM content_inventory/i.test(sql) && /state='ready'/.test(sql)) {
      return { rows: inventoryRow ? [inventoryRow] : [] };
    }
    if (/FROM content_inventory/i.test(sql)) return { rows: [] };
    return { rows: [] };
  },
};

mock.module('../react-widgets/core/postgres-database.js', () => ({
  getPostgresDatabase: () => postgresStub,
}));

const { NewsScheduler } = await import('./news-scheduler.js?consumer=' + Date.now());

function makeJob() {
  return {
    config: {
      id: 'consumer-eink',
      enabled: true,
      intervalMs: 600000,
      renderer: 'local-eink',
      jobRole: 'consumer',
      category: 'technology',
      indexStrategy: 'sequential',
    },
    state: { consecutiveFailures: 0, running: false, nextIndex: 0, lastIndex: null },
    timer: null,
  } as any;
}

function inventoryUpdateQueries() {
  return executedQueries.filter((q) => /UPDATE content_inventory/i.test(q.sql));
}

describe('runConsumerJob — 多设备部分成功不再拖垮整批', () => {
  let scheduler: any;
  let warnings: string[] = [];
  const realWarn = console.warn;

  beforeEach(() => {
    scheduler = new NewsScheduler();
    // 让 persistSchedulerState 不去碰 DB
    scheduler.persistSchedulerState = async () => {};
    executedQueries.length = 0;
    renderAndPushMock.mockClear();
    warnings = [];
    console.warn = (...args: any[]) => { warnings.push(args.map(String).join(' ')); };
    inventoryRow = {
      id: 42,
      fingerprint: 'fp-42',
      title: '测试新闻',
      source: 'solidot',
      category: 'technology',
      raw_content: { title: '测试新闻', description: '正文' },
      processed_content: { title: '测试新闻', message: '正文' },
      image_path: '/widgets/news/test.png',
      replay_count: 0,
      max_replays: 3,
    };
  });

  const restoreWarn = () => { console.warn = realWarn; };

  it('3 台 1 台失败（partial_success）→ inventory 仍推进 pushed，不 throw', async () => {
    nextPushResult = {
      ok: true,
      status: 'partial_success',
      succeeded: 2,
      failed: 1,
      deviceResult: '按目标渲染并推送: 2/3 成功',
      pushResults: [
        { device: 'eink-1', deviceId: 'eink-1', ok: true, durationMs: 120 },
        { device: 'eink-2', deviceId: 'eink-2', ok: false, errorCode: 'timeout', error: 'The operation timed out.' },
        { device: 'eink-3', deviceId: 'eink-3', ok: true, durationMs: 130 },
      ],
      renderedImages: [],
    };

    await scheduler.runConsumerJob(makeJob());
    restoreWarn();

    const updates = inventoryUpdateQueries();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("state='pushed'");
    expect(updates[0].sql).toContain('replay_count=replay_count+1');
    expect(updates[0].sql).toContain('last_pushed_at=CURRENT_TIMESTAMP');
    expect(updates[0].params).toEqual([42]);

    // 失败设备逐台 warn，含 deviceId / errorCode / error
    const deviceWarn = warnings.find((w) => w.includes('eink-2'));
    expect(deviceWarn).toBeDefined();
    expect(deviceWarn).toContain('errorCode=timeout');
    expect(deviceWarn).toContain('timed out');
    // 成功设备不该出现在失败告警里
    expect(warnings.some((w) => w.includes('deviceId=eink-1'))).toBe(false);
  });

  it('全部成功（success）→ 正常推进，无失败告警', async () => {
    nextPushResult = {
      ok: true,
      status: 'success',
      succeeded: 2,
      failed: 0,
      deviceResult: '按目标渲染并推送: 2/2 成功',
      pushResults: [
        { device: 'eink-1', deviceId: 'eink-1', ok: true },
        { device: 'eink-2', deviceId: 'eink-2', ok: true },
      ],
      renderedImages: [],
    };

    await scheduler.runConsumerJob(makeJob());
    restoreWarn();

    expect(inventoryUpdateQueries()).toHaveLength(1);
    expect(warnings.some((w) => w.includes('设备推送失败'))).toBe(false);
  });

  it('全部失败（failure）→ 不推进 inventory，走原失败路径', async () => {
    nextPushResult = {
      ok: false,
      status: 'failure',
      succeeded: 0,
      failed: 2,
      deviceResult: '按目标渲染并推送: 0/2 成功',
      pushResults: [
        { device: 'eink-1', deviceId: 'eink-1', ok: false, errorCode: 'connection', error: 'fetch failed' },
        { device: 'eink-2', deviceId: 'eink-2', ok: false, errorCode: 'timeout', error: 'timed out' },
      ],
      renderedImages: [],
    };

    await scheduler.runConsumerJob(makeJob());
    restoreWarn();

    // 失败路径：不推进 state
    expect(inventoryUpdateQueries()).toHaveLength(0);
    // 两台失败设备都被逐台记录
    expect(warnings.some((w) => w.includes('deviceId=eink-1') && w.includes('errorCode=connection'))).toBe(true);
    expect(warnings.some((w) => w.includes('deviceId=eink-2') && w.includes('errorCode=timeout'))).toBe(true);
  });
});
