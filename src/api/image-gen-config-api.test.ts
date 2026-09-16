/**
 * /api/image-gen/config 端点验收(依赖注入:假 db + stub 上游,不碰真实数据库/网络)。
 *
 * 覆盖:GET 返回配置与实时目录;PUT 校验(fail-closed,拦住无效/仅 chat 的 ID)。
 * 这里走真实的 image-gen-config 服务逻辑,只替换 DB 与上游 fetch —— 不用 mock.module,
 * 避免 bun 的模块 mock 跨文件泄漏污染其他测试。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createImageGenConfigApp } from './image-gen-config-api.js';
import {
  fetchUpstreamTuziModels,
  getImageGenConfig,
  invalidateImageGenConfigCache,
  setDefaultTuziModel,
} from '../react-widgets/services/image-gen-config.js';

let dbRow: { default_tuzi_model: string } | null = null;
let upserts: unknown[][] = [];

const fakeDb: any = {
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('INSERT INTO image_gen_settings')) {
        upserts.push(params ?? []);
        dbRow = { default_tuzi_model: String(params?.[1] ?? '') };
        return { rows: [] };
      }
      return { rows: dbRow ? [dbRow] : [] };
    },
  }),
};

const app = createImageGenConfigApp({
  getDb: () => fakeDb,
  getImageGenConfig,
  setDefaultTuziModel,
  fetchUpstreamTuziModels,
});

const UPSTREAM_PAYLOAD = {
  object: 'list',
  success: true,
  data: [
    { id: 'gpt-image-2', supported_endpoint_types: ['generate', 'edit', 'openai-video'] },
    { id: 'gpt-image-2-count', supported_endpoint_types: ['OpenAI-Chat'] },
    { id: 'gpt-image-2.5', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
    { id: 'gpt-image-2.5-flare', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
    { id: 'gpt-image-2.5-sunburst', supported_endpoint_types: ['image-generation', 'openai', 'openai-video'] },
  ],
};

const AVAILABLE = [
  'tuzi:gpt-image-2',
  'tuzi:gpt-image-2.5',
  'tuzi:gpt-image-2.5-flare',
  'tuzi:gpt-image-2.5-sunburst',
];

const realFetch = globalThis.fetch;
let upstreamDown = false;

// 与 image-backend-liveness.test.ts 同款 stub fetch 写法(带参签名,避免 as 断言报 preconnect)
const stubFetch = (async (input: any, init?: RequestInit) => {
  if (upstreamDown) throw new Error('ETIMEDOUT');
  return new Response(JSON.stringify(UPSTREAM_PAYLOAD), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

beforeEach(() => {
  dbRow = { default_tuzi_model: 'tuzi:gpt-image-2.5' };
  upserts = [];
  upstreamDown = false;
  invalidateImageGenConfigCache();
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const put = (body: unknown) =>
  app.request('/api/image-gen/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/image-gen/config', () => {
  it('返回 DB 配置 + 上游实时可出图目录', async () => {
    const res = await app.request('/api/image-gen/config');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.defaultTuziModel).toBe('tuzi:gpt-image-2.5');
    expect(body.source).toBe('db');
    expect(body.availableTuziModels).toEqual(AVAILABLE);
  });

  it('DB 无行时 source 回退(不缺字段)', async () => {
    dbRow = null;
    const body: any = await (await app.request('/api/image-gen/config')).json();
    expect(body.source).toBe('fallback');
    expect(typeof body.defaultTuziModel).toBe('string');
  });
});

describe('PUT /api/image-gen/config', () => {
  it('有效 ID(实时目录内)→ 200 并写 DB', async () => {
    const res = await put({ defaultTuziModel: 'tuzi:gpt-image-2' });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.defaultTuziModel).toBe('tuzi:gpt-image-2');
    expect(body.source).toBe('db');
    expect(upserts.length).toBe(1);
    expect(upserts[0][1]).toBe('tuzi:gpt-image-2');
  });

  it('写入后 GET 立刻反映新值(缓存已清)', async () => {
    await put({ defaultTuziModel: 'tuzi:gpt-image-2.5-sunburst' });
    const body: any = await (await app.request('/api/image-gen/config')).json();
    expect(body.defaultTuziModel).toBe('tuzi:gpt-image-2.5-sunburst');
  });

  it('无效 ID(实测 503 的 gpt-image-2.5-1k 类)→ 400 并附 available,不写 DB', async () => {
    const res = await put({ defaultTuziModel: 'tuzi:gpt-image-2.5-1k' });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.availableTuziModels).toEqual(AVAILABLE);
    expect(upserts.length).toBe(0);
  });

  it('仅 chat 的 -count 变体 → 400,不写 DB', async () => {
    const res = await put({ defaultTuziModel: 'tuzi:gpt-image-2-count' });
    expect(res.status).toBe(400);
    expect(upserts.length).toBe(0);
  });

  it('无 tuzi: 前缀 → 400', async () => {
    const res = await put({ defaultTuziModel: 'gpt-image-2' });
    expect(res.status).toBe(400);
    expect(upserts.length).toBe(0);
  });

  it('缺字段 / 空串 → 400', async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ defaultTuziModel: '   ' })).status).toBe(400);
    expect(upserts.length).toBe(0);
  });

  it('上游目录拉不到 → fail-closed 拒写(503),不放行未验证 ID', async () => {
    upstreamDown = true;
    const res = await put({ defaultTuziModel: 'tuzi:gpt-image-2' });
    expect(res.status).toBe(503);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(upserts.length).toBe(0);
  });
});
