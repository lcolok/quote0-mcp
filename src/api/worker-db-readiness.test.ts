/**
 * worker 启动竞态验收（mock DB，无需真实 PG）。
 *
 * 病灶实录：v1.21.40 上线时出现一次
 *   relation "device_deliveries" does not exist (42P01)
 * ——worker 的首个认领 tick 跑在了建表（migration）完成之前。旧行为靠 loop 的
 * catch 自愈（下一 tick 就好了），但那是不应存在的启动噪音。
 *
 * 本文件钉死的不变量：**首个认领查询必须发生在 initialize() 完成之后**。
 * 做法是让 initialize() 挂起一段时间，在此期间断言 pool 一次查询都没收到；
 * 只有 initialize resolve 后，认领 SQL 才允许出现。
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

let initializeStarted = 0;
let initializeResolved = false;
let releaseInitialize: () => void = () => {};
/** 记录事件顺序，用来证明「查询没有插到 initialize 前面」。 */
let timeline: string[] = [];

function makeGatedInitialize() {
  return async () => {
    initializeStarted += 1;
    timeline.push('initialize:start');
    await new Promise<void>((resolve) => {
      releaseInitialize = () => {
        initializeResolved = true;
        timeline.push('initialize:done');
        resolve();
      };
    });
  };
}

const clientQuery = mock(async (sql: string) => {
  timeline.push(`client.query:${String(sql).trim().slice(0, 16)}`);
  // BEGIN → SELECT 认领：返回空结果让 worker 直接进入 sleep
  return { rows: [] };
});

const poolQuery = mock(async (sql: string) => {
  timeline.push(`pool.query:${String(sql).trim().slice(0, 16)}`);
  return { rows: [] };
});

const connectMock = mock(async () => ({
  query: clientQuery,
  release: () => {},
}));

const postgresStub: any = {
  initialize: makeGatedInitialize(),
  getPool: () => ({ query: poolQuery, connect: connectMock }),
  query: poolQuery,
};

mock.module('../react-widgets/core/postgres-database.js', () => ({
  getPostgresDatabase: () => postgresStub,
}));

// 把 worker 的重依赖全部桩掉：本文件只关心「启动顺序」，不关心投递执行。
mock.module('./target-aware-eink.js', () => ({
  renderSingleEinkTarget: mock(async () => ({ localImagePath: '/tmp/x.png' })),
  renderAndPushLocalEinkByTarget: mock(async () => ({})),
}));
mock.module('./eink-converter.js', () => ({
  getEinkDevices: mock(async () => []),
  resolveEinkDeviceSpecWithStatus: mock(async () => ({ device: null, status: null })),
  pngTo1BitBitmap: mock(async () => Buffer.alloc(0)),
  pushToEinkDevice: mock(async () => ({ ok: true })),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('device-delivery worker — 首 tick 前等待数据库就绪（消除 42P01 启动噪音）', () => {
  beforeEach(() => {
    initializeStarted = 0;
    initializeResolved = false;
    timeline = [];
    clientQuery.mockClear();
    poolQuery.mockClear();
    connectMock.mockClear();
    postgresStub.initialize = makeGatedInitialize();
  });

  it('initialize() 未完成前，不发出任何认领查询；完成后才开始认领', async () => {
    const mod: any = await import('./device-delivery-worker.js?readiness=' + Date.now());

    const logs: string[] = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
    console.error = (...a: any[]) => { logs.push('ERR ' + a.map(String).join(' ')); };

    try {
      mod.startDeviceDeliveryWorker();

      // 给事件循环足够机会：若没有就绪等待，首 tick 早就打出认领 SQL 了
      await sleep(120);

      // ① 就绪等待确实被调用
      expect(initializeStarted).toBe(1);
      expect(initializeResolved).toBe(false);

      // ② 关键断言：initialize 挂起期间，DB 一次查询都没收到
      expect(connectMock).not.toHaveBeenCalled();
      expect(clientQuery).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
      expect(timeline).toEqual(['initialize:start']);

      // ③ 放行后，认领才发生
      releaseInitialize();
      await sleep(120);

      expect(initializeResolved).toBe(true);
      expect(connectMock).toHaveBeenCalled();
      // 顺序铁证：initialize:done 严格早于第一条 query
      const firstQueryIdx = timeline.findIndex((t) => t.includes('query:'));
      expect(firstQueryIdx).toBeGreaterThan(timeline.indexOf('initialize:done'));

      // ④ 没有 42P01 噪音（tick error 日志为空）
      expect(logs.some((l) => l.includes('does not exist'))).toBe(false);
      expect(logs.some((l) => l.includes('worker tick error'))).toBe(false);
    } finally {
      mod.stopDeviceDeliveryWorker();
      releaseInitialize();
      console.log = realLog;
      console.error = realError;
      await sleep(20);
    }
  });

  it('initialize() 抛错时不阻断启动：照旧进入 tick 循环（靠既有 catch 兜底）', async () => {
    postgresStub.initialize = async () => {
      timeline.push('initialize:throw');
      throw new Error('connection refused');
    };

    const mod: any = await import('./device-delivery-worker.js?readiness-fail=' + Date.now());

    const warns: string[] = [];
    const realWarn = console.warn;
    const realLog = console.log;
    const realError = console.error;
    console.warn = (...a: any[]) => { warns.push(a.map(String).join(' ')); };
    console.log = () => {};
    console.error = () => {};

    try {
      mod.startDeviceDeliveryWorker();
      await sleep(120);

      // 就绪等待失败被降级为告警，worker 仍然活着并开始认领
      expect(warns.some((w) => w.includes('就绪等待失败'))).toBe(true);
      expect(connectMock).toHaveBeenCalled();
    } finally {
      mod.stopDeviceDeliveryWorker();
      console.warn = realWarn;
      console.log = realLog;
      console.error = realError;
      await sleep(20);
    }
  });
});

describe('label-job worker — 同一竞态，同一修法', () => {
  beforeEach(() => {
    initializeStarted = 0;
    initializeResolved = false;
    timeline = [];
    clientQuery.mockClear();
    poolQuery.mockClear();
    connectMock.mockClear();
    postgresStub.initialize = makeGatedInitialize();
  });

  it('initialize() 未完成前不查 label_jobs', async () => {
    const mod: any = await import('./label-jobs-worker.js?readiness=' + Date.now());

    const realLog = console.log;
    const realError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      mod.startLabelJobWorker();
      await sleep(120);

      expect(initializeStarted).toBe(1);
      expect(connectMock).not.toHaveBeenCalled();
      expect(timeline).toEqual(['initialize:start']);

      releaseInitialize();
      await sleep(120);

      expect(connectMock).toHaveBeenCalled();
      const firstQueryIdx = timeline.findIndex((t) => t.includes('query:'));
      expect(firstQueryIdx).toBeGreaterThan(timeline.indexOf('initialize:done'));
    } finally {
      releaseInitialize();
      console.log = realLog;
      console.error = realError;
      await sleep(20);
    }
  });
});
