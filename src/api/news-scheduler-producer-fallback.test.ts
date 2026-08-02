/**
 * producer LLM 确定性降级验收。
 *
 * 病灶：producer 分支的 catch 对 LLM 失败直接 throw（「producer 不推送设备，
 * 不需要 JSON fallback」）。于是 LLM 账户 402 欠费 → 整条产线停产，线上只能
 * 靠 24h 复播池撑着。
 *
 * 修复语义（本文件逐条钉死）：
 *  - LLM 类 processor 抛错 → 用 passthrough 重试同一请求参数，一次降级即定局
 *    （不重试、不退避、不熔断——那是 Phase 2 的议题）
 *  - 降级成功 → 照常渲染、照常入库，processed_content 里带 degraded 标记
 *  - passthrough 也失败 → 说明坏的是数据源不是 LLM，抛原始 LLM 错误
 *  - LLM 正常 → 一次调用、无降级、无标记
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---- 可编排的 getRenderableData ----
type Behavior = (processor: string | undefined) => Promise<any>;
let renderableBehavior: Behavior;
let getRenderableCalls: Array<Record<string, any>> = [];

const getRenderableDataMock = mock(async (params: any) => {
  getRenderableCalls.push(params);
  return renderableBehavior(params.processor);
});

// 保留真实模块的其余成员，只探改 getRenderableData。
// bun 的 mock.module 跨测试文件全局生效：若整个替换成只有一个方法的字面量，
// 同一轮里依赖 validateParams() 的 news-api-server.test.ts 会被连坐。
const realNewsPluginModule = await import('../react-widgets/plugins/modular-news-plugin.js');
mock.module('../react-widgets/plugins/modular-news-plugin.js', () => ({
  ...realNewsPluginModule,
  modularNewsPlugin: Object.assign(
    Object.create(Object.getPrototypeOf(realNewsPluginModule.modularNewsPlugin)),
    realNewsPluginModule.modularNewsPlugin,
    { getRenderableData: getRenderableDataMock },
  ),
}));

// ---- 渲染器桩：产出一个能被解析出 imagePath 的 MinIO URL ----
// 同样只探改 registry.get('news')，其余渲染器一律透传真实实现，避免污染全局。
const renderMock = mock(async () => 'http://minio:9000/quote0-images/widgets/news/degraded.png');
const realRenderingModule = await import('../react-widgets/core/rendering-modules.js');
const realRegistry = realRenderingModule.renderingRegistry;
mock.module('../react-widgets/core/rendering-modules.js', () => ({
  ...realRenderingModule,
  renderingRegistry: Object.assign(
    Object.create(Object.getPrototypeOf(realRegistry)),
    realRegistry,
    {
      get: (name: string) => {
        const real: any = realRegistry.get(name);
        // 只探改 render 方法本身，validateParams 等其余接口成员全部保留真实实现
        if (name !== 'news' || !real) return real;
        return Object.assign(
          Object.create(Object.getPrototypeOf(real)),
          real,
          { render: renderMock },
        );
      },
    },
  ),
}));

// 注意：故意不 mock './news-processing-service.js'。
// bun 的 mock.module 是进程全局且跨测试文件残留，曾把它桦成「一调就抛」后，
// 同一轮 bun test 里的 news-api-server.test.ts 会跟着 500。producer 不走 processNews
// 这一点改用下方「渲染器恰好被调用 1 次 + 产物来自 getRenderableData」间接钐死，
// 不为了一条旁证而污染全局模块图。

// ---- 极简 postgres 桩 ----
const executedQueries: Array<{ sql: string; params?: any[] }> = [];
const postgresStub = {
  initialize: async () => {},
  createSchedulerRunHistory: async () => 1,
  updateSchedulerRunHistory: async () => {},
  recordPushResult: async () => {},
  getSchedulerJobs: async () => [],
  getPool: () => ({ query: async () => ({ rows: [] }) }),
  query: async (sql: string, params?: any[]) => {
    executedQueries.push({ sql, params });
    return { rows: [] };
  },
};
mock.module('../react-widgets/core/postgres-database.js', () => ({
  getPostgresDatabase: () => postgresStub,
}));

const { NewsScheduler } = await import('./news-scheduler.js?producer-fallback=' + Date.now());

const LLM_OUTPUT = {
  title: 'LLM 精加工标题',
  message: 'LLM 精炼后的正文',
  source: 'solidot',
  signature: 'AX智能',
  link: 'https://example.com/a',
  category: 'technology',
  publishTime: '2026-08-03T00:00:00.000Z',
  metadata: { processor: 'ax-optimized' },
};

const PASSTHROUGH_OUTPUT = {
  title: '原始 RSS 标题',
  message: '未经 LLM 处理的 RSS 原文',
  source: 'solidot',
  signature: 'RSS智能',
  link: 'https://example.com/a',
  category: 'technology',
  publishTime: '2026-08-03T00:00:00.000Z',
  metadata: { processor: 'passthrough' },
};

function makeProducerJob(processor = 'ax-optimized') {
  return {
    config: {
      id: 'producer-tech',
      enabled: true,
      intervalMs: 600000,
      renderer: 'news',
      jobRole: 'producer',
      category: 'technology',
      dataSource: 'rss',
      rssSource: 'solidot',
      processor,
      indexStrategy: 'sequential',
      options: {},
    },
    state: { consecutiveFailures: 0, running: false, nextIndex: 0, lastIndex: null },
    timer: null,
  } as any;
}

/** 取 producer 的 inventory INSERT，解析出 processed_content。 */
function inventoryInsert() {
  const q = executedQueries.find((x) => /INSERT INTO content_inventory/i.test(x.sql));
  if (!q) return null;
  const processedJson = q.params?.[8];
  return {
    sql: q.sql,
    params: q.params,
    processedContent: processedJson ? JSON.parse(processedJson as string) : null,
  };
}

describe('runJob(producer) — LLM 失败时确定性降级到 passthrough', () => {
  let scheduler: any;
  let warnings: string[] = [];
  let errors: string[] = [];
  const realWarn = console.warn;
  const realError = console.error;
  const realLog = console.log;

  beforeEach(() => {
    scheduler = new NewsScheduler();
    // 隔离出 producer 处理段：候选选择/状态持久化/软上限都不是本次施工范围
    scheduler.persistSchedulerState = async () => {};
    scheduler.enforceInventoryCap = async () => {};
    scheduler.handlePostRunFailure = async () => {};
    scheduler.resolveRunnableSource = async () => ({ source: 'solidot', skipped: [] });
    scheduler.selectCandidate = async () => ({
      selection: {
        candidate: {
          index: 0,
          fingerprint: 'fp-producer',
          publishTime: '2026-08-03T00:00:00.000Z',
          pushCount: 0,
          lastPushedAt: undefined,
          context: {
            title: '原始 RSS 标题',
            link: 'https://example.com/a',
            publishTime: '2026-08-03T00:00:00.000Z',
            source: 'solidot',
            category: 'technology',
            content: '正文',
            description: '摘要',
            fingerprint: 'fp-producer',
          },
        },
        layer: 'fresh',
        isFallback: false,
        pushCountBefore: 0,
        coolingElapsedMs: undefined,
        reasons: [],
        strategySnapshot: {},
        poolSize: 10,
        totalCandidates: 10,
      },
      attempts: [],
      totalCandidates: 10,
      poolSize: 10,
    });

    executedQueries.length = 0;
    getRenderableCalls = [];
    getRenderableDataMock.mockClear();
    renderMock.mockClear();
    warnings = [];
    errors = [];
    console.warn = (...a: any[]) => { warnings.push(a.map(String).join(' ')); };
    console.error = (...a: any[]) => { errors.push(a.map(String).join(' ')); };
    console.log = () => {};
  });

  const restore = () => { console.warn = realWarn; console.error = realError; console.log = realLog; };

  it('LLM 402 欠费 → 降级 passthrough 成功 → 入库且带 degraded 标记', async () => {
    renderableBehavior = async (processor) => {
      if (processor === 'ax-optimized') {
        throw new Error('LLM API 认证失败: 402 Insufficient Balance');
      }
      return PASSTHROUGH_OUTPUT;
    };

    await scheduler.runJob(makeProducerJob());
    restore();

    // ① 恰好两次调用：先 LLM，失败后 passthrough。一次降级即定局，不重试 LLM。
    expect(getRenderableDataMock).toHaveBeenCalledTimes(2);
    expect(getRenderableCalls[0].processor).toBe('ax-optimized');
    expect(getRenderableCalls[1].processor).toBe('passthrough');

    // ② 其余请求参数原样不变
    for (const key of ['category', 'dataSource', 'rssSource', 'renderer', 'index']) {
      expect(getRenderableCalls[1][key]).toEqual(getRenderableCalls[0][key]);
    }

    // ③ 照常渲染、照常入库
    expect(renderMock).toHaveBeenCalledTimes(1);
    const insert = inventoryInsert();
    expect(insert).not.toBeNull();

    // ④ processed_content 带降级标记，且正文来自 passthrough
    expect(insert!.processedContent.degraded).toBe(true);
    expect(insert!.processedContent.degradedFrom).toBe('ax-optimized');
    expect(insert!.processedContent.processor).toBe('passthrough');
    expect(insert!.processedContent.degradedReason).toContain('402');
    expect(insert!.processedContent.message).toBe(PASSTHROUGH_OUTPUT.message);

    // ⑤ 降级告警一次，含原始错误摘要
    const degradeWarn = warnings.filter((w) => w.includes('降级为 passthrough'));
    expect(degradeWarn).toHaveLength(1);
    expect(degradeWarn[0]).toContain('402 Insufficient Balance');
  });

  it('LLM 连接超时 → 同样降级（不只认 402）', async () => {
    renderableBehavior = async (processor) => {
      if (processor === 'ax-optimized') throw new Error('Connection error. ETIMEDOUT');
      return PASSTHROUGH_OUTPUT;
    };

    await scheduler.runJob(makeProducerJob());
    restore();

    expect(getRenderableDataMock).toHaveBeenCalledTimes(2);
    expect(inventoryInsert()!.processedContent.degraded).toBe(true);
  });

  it('basic-llm 同样纳入降级范围', async () => {
    renderableBehavior = async (processor) => {
      if (processor === 'basic-llm') throw new Error('LLM 挂了');
      return PASSTHROUGH_OUTPUT;
    };

    await scheduler.runJob(makeProducerJob('basic-llm'));
    restore();

    expect(getRenderableCalls.map((c) => c.processor)).toEqual(['basic-llm', 'passthrough']);
    expect(inventoryInsert()!.processedContent.degradedFrom).toBe('basic-llm');
  });

  it('passthrough 也失败（数据源坏了）→ 不入库，保持抛原始 LLM 错误', async () => {
    renderableBehavior = async (processor) => {
      if (processor === 'ax-optimized') throw new Error('LLM 402 欠费');
      throw new Error('RSS 源不可达 ENOTFOUND');
    };

    await scheduler.runJob(makeProducerJob());
    restore();

    // 两条路都试过了
    expect(getRenderableCalls.map((c) => c.processor)).toEqual(['ax-optimized', 'passthrough']);
    // 没有入库
    expect(inventoryInsert()).toBeNull();
    // 冒泡的是原始 LLM 错误（而非 passthrough 的错误）——归因不被掩盖
    expect(errors.some((e) => e.includes('LLM 402 欠费'))).toBe(true);
    // 失败被 runJob 的既有失败路径接住，不外泄成 unhandled rejection
    expect(scheduler).toBeDefined();
  });

  it('LLM 正常 → 单次调用、无降级、无标记', async () => {
    renderableBehavior = async () => LLM_OUTPUT;

    await scheduler.runJob(makeProducerJob());
    restore();

    expect(getRenderableDataMock).toHaveBeenCalledTimes(1);
    expect(getRenderableCalls[0].processor).toBe('ax-optimized');

    const insert = inventoryInsert();
    expect(insert).not.toBeNull();
    expect(insert!.processedContent.message).toBe(LLM_OUTPUT.message);
    // 关键：正常路径不得出现任何降级痕迹
    expect(insert!.processedContent.degraded).toBeUndefined();
    expect(insert!.processedContent.degradedReason).toBeUndefined();
    expect(insert!.processedContent.degradedFrom).toBeUndefined();
    expect(warnings.some((w) => w.includes('降级为 passthrough'))).toBe(false);
  });
});
