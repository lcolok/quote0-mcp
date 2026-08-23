/**
 * Phase 1 验收（consumer 新语义）：
 * consumer 不再物理推送，只为每台目标设备登记一条持久化 delivery。
 *
 * 与被它取代的 Phase 0 语义（news-scheduler-consumer-partial.test.ts）的差别：
 *  - Phase 0：consumer 亲自推 → 至少一台设备成功才推进 inventory（宁漏勿重）
 *  - Phase 1：consumer 只登记 → 登记成功即推进 inventory；离线设备由 worker
 *            按退避补投（晚到但不重）。单台设备离线再也不能阻塞 consumer。
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---- 可编排的 enqueue 结果 ----
let nextEnqueueResult: any = null;
let enqueueCalls: any[] = [];
const enqueueMock = mock(async (input: any) => {
  enqueueCalls.push(input);
  if (nextEnqueueResult instanceof Error) throw nextEnqueueResult;
  return nextEnqueueResult;
});

mock.module('./delivery-enqueue.js', () => ({
  enqueueDeliveriesForContent: enqueueMock,
  enqueuePreRenderedImageDeliveries: mock(async () => ({
    payloadVersion: 1,
    created: 0,
    targeted: 0,
    deviceIds: [],
  })),
}));

// consumer 绝不该再碰它：本文件的核心断言之一。
const renderAndPushMock = mock(async () => {
  throw new Error('Phase 1 的 consumer 不应再调用 renderAndPushLocalEinkByTarget');
});
mock.module('./target-aware-eink.js', () => ({
  renderAndPushLocalEinkByTarget: renderAndPushMock,
  renderSingleEinkTarget: mock(async () => ({ localImagePath: '/tmp/x.png', pusherInput: '/tmp/x.png' })),
}));

// ---- 极简 postgres 桩 ----
const executedQueries: Array<{ sql: string; params?: any[] }> = [];
let historyUpdates: any[] = [];
let inventoryRow: any = null;

const postgresStub = {
  initialize: async () => {},
  createSchedulerRunHistory: async () => 1,
  updateSchedulerRunHistory: async (_id: number, updates: any) => { historyUpdates.push(updates); },
  recordPushResult: async () => {},
  getSchedulerJobs: async () => [],
  getPool: () => ({ query: async () => ({ rows: [] }) }),
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

const { NewsScheduler } = await import('./news-scheduler.js?consumer-delivery=' + Date.now());

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

describe('runConsumerJob — Phase 1 只登记 delivery，不物理推送', () => {
  let scheduler: any;
  let warnings: string[] = [];
  let errors: string[] = [];
  let logs: string[] = [];
  const realWarn = console.warn;
  const realError = console.error;
  const realLog = console.log;

  beforeEach(() => {
    scheduler = new NewsScheduler();
    scheduler.persistSchedulerState = async () => {};
    executedQueries.length = 0;
    historyUpdates = [];
    enqueueCalls = [];
    enqueueMock.mockClear();
    renderAndPushMock.mockClear();
    warnings = [];
    errors = [];
    logs = [];
    console.warn = (...a: any[]) => { warnings.push(a.map(String).join(' ')); };
    console.error = (...a: any[]) => { errors.push(a.map(String).join(' ')); };
    console.log = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
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
    nextEnqueueResult = {
      payloadVersion: 1, created: 3, targeted: 3,
      deviceIds: ['eink-1', 'eink-2', 'eink-3'],
    };
  });

  const restore = () => {
    console.warn = realWarn;
    console.error = realError;
    console.log = realLog;
  };

  it('为每台设备登记 delivery，inventory 照旧推进 pushed', async () => {
    await scheduler.runConsumerJob(makeJob());
    restore();

    // 核心：不再走物理推送路径
    expect(renderAndPushMock).not.toHaveBeenCalled();

    // 登记参数只传 contentId（不再用 replayCount 推导 payload_version）
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueCalls[0]).toEqual({ contentId: 42 });

    // consumer 只会消费质量门控未 HOLD 的内容；旧库存没有该 metadata 时保持兼容。
    const readySelect = executedQueries.find((q) => /FROM content_inventory/i.test(q.sql) && /state='ready'/.test(q.sql));
    expect(readySelect?.sql).toContain("contentQuality");
    expect(readySelect?.sql).toContain("<> 'hold'");
    expect(readySelect?.sql).toContain('researchGate');
    expect(readySelect?.sql).toContain("->>'state' = 'ready'");

    // inventory 推进语义与 Phase 0 完全一致（SQL 未改动）
    const updates = inventoryUpdateQueries();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("state='pushed'");
    expect(updates[0].sql).toContain('replay_count=replay_count+1');
    expect(updates[0].sql).toContain('last_pushed_at=CURRENT_TIMESTAMP');
    expect(updates[0].params).toEqual([42]);

    // 运行历史如实记录 success
    expect(historyUpdates).toHaveLength(1);
    expect(historyUpdates[0].pushStatus).toBe('success');
    expect(historyUpdates[0].pushReason).toBe('inventory_consumed');
  });

  it('ready 为空时使用 source-fair LRU，而不是按文章数量瓜分屏幕曝光', async () => {
    inventoryRow = null;

    await scheduler.runConsumerJob(makeJob());
    restore();

    const fallbackSelect = executedQueries.find((q) =>
      /FROM content_inventory ci/i.test(q.sql)
      && /source_last_pushed_at/i.test(q.sql),
    );
    expect(fallbackSelect).toBeDefined();
    expect(fallbackSelect?.sql).toContain('MAX(ci.last_pushed_at) OVER (PARTITION BY ci.source)');
    expect(fallbackSelect?.sql).toContain('ranked.source_last_pushed_at ASC NULLS FIRST');
    expect(fallbackSelect?.sql).toContain('ranked.last_pushed_at ASC NULLS FIRST');
    expect(fallbackSelect?.params).toEqual([24]);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(historyUpdates[0]?.pushReason).toBe('inventory_empty');
  });

  it('payload_version 由 enqueue 返回并写入运行历史', async () => {
    nextEnqueueResult = { payloadVersion: 7, created: 3, targeted: 3, deviceIds: ['a', 'b', 'c'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(enqueueCalls[0]).toEqual({ contentId: 42 });
    expect(inventoryUpdateQueries()).toHaveLength(1);
    expect(historyUpdates[0].metadata?.payloadVersion).toBe(7);
  });

  it('单台设备离线不再阻塞 consumer —— 登记成功即推进（这就是 Phase 1 的意义）', async () => {
    // 3 台设备全部登记成功，其中若干台此刻其实离线；consumer 无从得知也无需得知
    nextEnqueueResult = { payloadVersion: 1, created: 3, targeted: 3, deviceIds: ['on', 'off1', 'off2'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(inventoryUpdateQueries()).toHaveLength(1);
    // 没有任何"设备推送失败"告警——因为 consumer 根本不推送
    expect(warnings.some((w) => w.includes('设备推送失败'))).toBe(false);
  });

  it('投递登记部分失败（created<targeted）→ 告警 + scheduler_run_history 记 partial_success', async () => {
    nextEnqueueResult = { payloadVersion: 1, created: 1, targeted: 3, deviceIds: ['a', 'b', 'c'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(inventoryUpdateQueries()).toHaveLength(1);
    expect(warnings.some((w) => w.includes('投递登记部分失败'))).toBe(true);
    expect(historyUpdates).toHaveLength(1);
    expect(historyUpdates[0].pushStatus).toBe('partial_success');
    expect(historyUpdates[0].pushReason).toContain('delivery_insert_conflict');
  });

  it('投递登记全失败（created=0）→ 错误 + scheduler_run_history 记 failed', async () => {
    nextEnqueueResult = { payloadVersion: 1, created: 0, targeted: 3, deviceIds: ['a', 'b', 'c'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    // inventory 仍推进，但日志与历史必须诚实上报失败
    expect(inventoryUpdateQueries()).toHaveLength(1);
    expect(errors.some((e) => e.includes('投递登记全失败'))).toBe(true);
    expect(historyUpdates).toHaveLength(1);
    expect(historyUpdates[0].pushStatus).toBe('failed');
    expect(historyUpdates[0].pushReason).toBe('delivery_insert_conflict');
  });

  it('无任何目标设备（targeted=0）→ 走失败路径，不推进 inventory', async () => {
    nextEnqueueResult = { payloadVersion: 1, created: 0, targeted: 0, deviceIds: [] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(inventoryUpdateQueries()).toHaveLength(0);
  });

  it('登记本身抛错（DB 故障）→ 走失败路径，不推进 inventory', async () => {
    nextEnqueueResult = new Error('connection terminated unexpectedly');

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(inventoryUpdateQueries()).toHaveLength(0);
  });
});
