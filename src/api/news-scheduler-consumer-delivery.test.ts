/**
 * Phase 1 验收（consumer 新语义）：
 * consumer 不再物理推送，只为每台目标设备登记一条持久化 delivery。
 *
 * 与被它取代的 Phase 0 语义（news-scheduler-consumer-partial.test.ts）的差别：
 *  - Phase 0：consumer 亲自推 → 至少一台成功才推进 inventory（宁漏勿重）
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
let inventoryRow: any = null;

const postgresStub = {
  initialize: async () => {},
  createSchedulerRunHistory: async () => 1,
  updateSchedulerRunHistory: async () => {},
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
  let logs: string[] = [];
  const realWarn = console.warn;
  const realLog = console.log;

  beforeEach(() => {
    scheduler = new NewsScheduler();
    scheduler.persistSchedulerState = async () => {};
    executedQueries.length = 0;
    enqueueCalls = [];
    enqueueMock.mockClear();
    renderAndPushMock.mockClear();
    warnings = [];
    logs = [];
    console.warn = (...a: any[]) => { warnings.push(a.map(String).join(' ')); };
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

  const restore = () => { console.warn = realWarn; console.log = realLog; };

  it('为每台设备登记 delivery，inventory 照旧推进 pushed', async () => {
    await scheduler.runConsumerJob(makeJob());
    restore();

    // 核心：不再走物理推送路径
    expect(renderAndPushMock).not.toHaveBeenCalled();

    // 登记参数正确：contentId + replayCount
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueCalls[0]).toEqual({ contentId: 42, replayCount: 0 });

    // inventory 推进语义与 Phase 0 完全一致（SQL 未改动）
    const updates = inventoryUpdateQueries();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("state='pushed'");
    expect(updates[0].sql).toContain('replay_count=replay_count+1');
    expect(updates[0].sql).toContain('last_pushed_at=CURRENT_TIMESTAMP');
    expect(updates[0].params).toEqual([42]);
  });

  it('payload_version 取 replay_count+1：复播轮次生成新 delivery', async () => {
    inventoryRow.replay_count = 2;
    nextEnqueueResult = { payloadVersion: 3, created: 3, targeted: 3, deviceIds: ['a', 'b', 'c'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(enqueueCalls[0]).toEqual({ contentId: 42, replayCount: 2 });
    expect(inventoryUpdateQueries()).toHaveLength(1);
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

  it('幂等命中（created=0）→ 告警但仍推进，不 throw', async () => {
    nextEnqueueResult = { payloadVersion: 1, created: 0, targeted: 3, deviceIds: ['a', 'b', 'c'] };

    await scheduler.runConsumerJob(makeJob());
    restore();

    expect(warnings.some((w) => w.includes('幂等跳过'))).toBe(true);
    expect(inventoryUpdateQueries()).toHaveLength(1);
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
