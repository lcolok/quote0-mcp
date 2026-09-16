/**
 * image-gen-config 服务验收:三级回退 + 缓存 + 上游目录过滤 + 迁移非破坏性。
 *
 * 用假 db(不碰真实 PG)与 stub fetch(不碰真实上游),覆盖纯逻辑契约。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  fetchUpstreamTuziModels,
  getDefaultTuziModel,
  getImageGenConfig,
  invalidateImageGenConfigCache,
  setDefaultTuziModel,
} from './image-gen-config.js';
import { LIVE_DEFAULT_MODEL } from './image-backend-liveness.js';
import { PostgresDatabase } from '../core/postgres-database.js';

/** 假 DB:单行 image_gen_settings,记录查询与 upsert */
let dbRow: { default_tuzi_model: string } | null = null;
let readCount = 0;
let upserts: unknown[][] = [];
let failReads = false;

const fakeDb: any = {
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('INSERT INTO image_gen_settings')) {
        upserts.push(params ?? []);
        dbRow = { default_tuzi_model: String(params?.[1] ?? '') };
        return { rows: [] };
      }
      readCount++;
      if (failReads) throw new Error('ECONNREFUSED');
      return { rows: dbRow ? [dbRow] : [] };
    },
  }),
};

const realFetch = globalThis.fetch;
let fetchCalls = 0;
let fetchResponder: () => Response | Promise<Response>;

// 与 image-backend-liveness.test.ts 同款 stub fetch 写法(带参签名,避免 as 断言报 preconnect)
const stubFetch = (async (input: any, init?: RequestInit) => {
  fetchCalls++;
  return await fetchResponder();
}) as typeof fetch;

const UPSTREAM_PAYLOAD = {
  object: 'list',
  success: true,
  data: [
    { id: 'gpt-image-2', object: 'model', supported_endpoint_types: ['generate', 'edit', 'openai-video'] },
    { id: 'gpt-image-2-count', object: 'model', supported_endpoint_types: ['OpenAI-Chat'] },
    { id: 'gpt-image-2.5', object: 'model', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
    { id: 'gpt-image-2.5-flare', object: 'model', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
    { id: 'gpt-image-2.5-flare-count', object: 'model', supported_endpoint_types: ['OpenAI-Chat'] },
    { id: 'gpt-image-2.5-sunburst', object: 'model', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
    { id: 'gpt-image-2.5-sunburst-count', object: 'model', supported_endpoint_types: ['OpenAI-Chat'] },
  ],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  dbRow = null;
  readCount = 0;
  upserts = [];
  failReads = false;
  invalidateImageGenConfigCache();
  delete process.env.TUZI_DEFAULT_MODEL;

  fetchCalls = 0;
  fetchResponder = () => jsonResponse(UPSTREAM_PAYLOAD);
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TUZI_DEFAULT_MODEL;
});

describe('getImageGenConfig 三级回退', () => {
  it('DB 有行 → source=db,取行值', async () => {
    dbRow = { default_tuzi_model: 'tuzi:gpt-image-2' };
    const cfg = await getImageGenConfig(fakeDb);
    expect(cfg).toEqual({ defaultTuziModel: 'tuzi:gpt-image-2', source: 'db' });
  });

  it('DB 无行 + env 有值 → source=env', async () => {
    process.env.TUZI_DEFAULT_MODEL = 'tuzi:gpt-image-2.5-sunburst';
    const cfg = await getImageGenConfig(fakeDb);
    expect(cfg).toEqual({ defaultTuziModel: 'tuzi:gpt-image-2.5-sunburst', source: 'env' });
  });

  it('DB 无行 + env 无值 → source=fallback 常量', async () => {
    const cfg = await getImageGenConfig(fakeDb);
    expect(cfg).toEqual({ defaultTuziModel: LIVE_DEFAULT_MODEL, source: 'fallback' });
  });

  it('DB 读失败 → 回退而非抛出,且不缓存失败(下次恢复即命中 DB)', async () => {
    failReads = true;
    expect((await getImageGenConfig(fakeDb)).source).toBe('fallback');

    failReads = false;
    dbRow = { default_tuzi_model: 'tuzi:gpt-image-2' };
    expect(await getDefaultTuziModel(fakeDb)).toBe('tuzi:gpt-image-2');
  });
});

describe('getImageGenConfig 缓存', () => {
  it('30s 内第二次不再查 DB,且忽略期间的行变化', async () => {
    dbRow = { default_tuzi_model: 'tuzi:gpt-image-2' };
    expect(await getDefaultTuziModel(fakeDb)).toBe('tuzi:gpt-image-2');
    expect(readCount).toBe(1);

    dbRow = { default_tuzi_model: 'tuzi:gpt-image-2.5-flare' };
    expect(await getDefaultTuziModel(fakeDb)).toBe('tuzi:gpt-image-2');
    expect(readCount).toBe(1);
  });

  it('setDefaultTuziModel 清缓存后立刻读到新值', async () => {
    dbRow = { default_tuzi_model: 'tuzi:gpt-image-2' };
    await getDefaultTuziModel(fakeDb);

    await setDefaultTuziModel(fakeDb, 'tuzi:gpt-image-2.5-sunburst');
    expect(upserts.length).toBe(1);
    expect(upserts[0][1]).toBe('tuzi:gpt-image-2.5-sunburst');
    expect(await getDefaultTuziModel(fakeDb)).toBe('tuzi:gpt-image-2.5-sunburst');
  });
});

describe('fetchUpstreamTuziModels', () => {
  it('只保留可出图模型(排除仅 OpenAI-Chat 的 -count 变体),加 tuzi: 前缀', async () => {
    const models = await fetchUpstreamTuziModels();
    expect(models).toEqual([
      'tuzi:gpt-image-2',
      'tuzi:gpt-image-2.5',
      'tuzi:gpt-image-2.5-flare',
      'tuzi:gpt-image-2.5-sunburst',
    ]);
    expect(models.some((m) => m.includes('-count'))).toBe(false);
  });

  it('30s 内只拉一次上游', async () => {
    await fetchUpstreamTuziModels();
    await fetchUpstreamTuziModels();
    expect(fetchCalls).toBe(1);
  });

  it('上游非 2xx → 返回空列表且不缓存失败', async () => {
    fetchResponder = () => new Response('boom', { status: 500 });
    expect(await fetchUpstreamTuziModels()).toEqual([]);

    fetchResponder = () => jsonResponse(UPSTREAM_PAYLOAD);
    expect((await fetchUpstreamTuziModels()).length).toBe(4);
    expect(fetchCalls).toBe(2);
  });

  it('网络异常 → 返回空列表(调用方降级,不炸)', async () => {
    fetchResponder = () => {
      throw new Error('ETIMEDOUT');
    };
    expect(await fetchUpstreamTuziModels()).toEqual([]);
  });
});

describe('image_gen_settings 迁移非破坏性', () => {
  const statements = (new PostgresDatabase({}) as any).getMigrationStatements() as string[];

  it('建表 + 种子行都在迁移链里', () => {
    expect(statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS image_gen_settings'))).toBe(true);
    expect(statements.some((s) => s.includes('INSERT INTO image_gen_settings'))).toBe(true);
  });

  it('种子用 DO NOTHING:已有行(运维经 API 改的配置)不被开机迁移覆盖', () => {
    const seed = statements.find((s) => s.includes('INSERT INTO image_gen_settings'))!;
    expect(seed).toContain('ON CONFLICT (id) DO NOTHING');
    expect(seed).not.toContain('DO UPDATE');
  });
});
