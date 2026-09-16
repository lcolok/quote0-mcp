import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  DEAD_BIZYAIR_MODELS,
  LIVE_DEFAULT_MODEL,
  probeUrlsAlive,
  resolveLiveModel,
} from './image-backend-liveness.js';

const realFetch = globalThis.fetch;

let calls: { url: string; method: string; range: string | null }[] = [];
let responder: (url: string, method: string) => Response | Promise<Response>;

const stubFetch = (async (input: any, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
  calls.push({ url, method, range });
  return await responder(url, method);
}) as typeof fetch;

const ok = (status = 200) => new Response(null, { status });

beforeEach(() => {
  calls = [];
  responder = () => ok(200);
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('resolveLiveModel', () => {
  it('死模型 → 换成存活默认模型并带溯源', () => {
    for (const dead of DEAD_BIZYAIR_MODELS) {
      expect(resolveLiveModel(dead)).toEqual({ model: LIVE_DEFAULT_MODEL, remappedFrom: dead });
    }
    expect(resolveLiveModel('sd5-3k').remappedFrom).toBe('sd5-3k');
  });

  it('活模型（tuzi: 前缀）原样返回,无溯源', () => {
    expect(resolveLiveModel('tuzi:gpt-image-2.5')).toEqual({
      model: 'tuzi:gpt-image-2.5',
      remappedFrom: null,
    });
    expect(resolveLiveModel('tuzi:vendor/model-x').remappedFrom).toBeNull();
  });

  it('空值 → 直接给存活默认模型,无溯源', () => {
    expect(resolveLiveModel(null)).toEqual({ model: LIVE_DEFAULT_MODEL, remappedFrom: null });
    expect(resolveLiveModel(undefined)).toEqual({ model: LIVE_DEFAULT_MODEL, remappedFrom: null });
    expect(resolveLiveModel('   ')).toEqual({ model: LIVE_DEFAULT_MODEL, remappedFrom: null });
    expect(resolveLiveModel(' tuzi:gpt-image-2 ').model).toBe('tuzi:gpt-image-2');
  });

  it('显式 target=后台配置的默认模型:死模型/空值都落到 target', () => {
    expect(resolveLiveModel('nb2', 'tuzi:gpt-image-2')).toEqual({
      model: 'tuzi:gpt-image-2',
      remappedFrom: 'nb2',
    });
    expect(resolveLiveModel('', 'tuzi:gpt-image-2')).toEqual({
      model: 'tuzi:gpt-image-2',
      remappedFrom: null,
    });
  });

  it('显式 target 不影响活模型(照旧原样返回)', () => {
    expect(resolveLiveModel('tuzi:gpt-image-2.5-flare', 'tuzi:gpt-image-2')).toEqual({
      model: 'tuzi:gpt-image-2.5-flare',
      remappedFrom: null,
    });
  });
});

describe('probeUrlsAlive', () => {
  it('2xx 活 / 404 死 / 网络异常死（三态）', async () => {
    responder = (url) => {
      if (url.includes('alive')) return ok(200);
      if (url.includes('notfound')) return ok(404);
      throw new Error('ECONNREFUSED');
    };
    const r = await probeUrlsAlive([
      'https://x/alive.png',
      'https://x/notfound.png',
      'https://x/boom.png',
    ]);
    expect(r.get('https://x/alive.png')).toBe(true);
    expect(r.get('https://x/notfound.png')).toBe(false);
    expect(r.get('https://x/boom.png')).toBe(false);
  });

  it('3xx 视作可达(重定向到 CDN)', async () => {
    responder = (_url, method) => (method === 'HEAD' ? ok(302) : ok(200));
    const r = await probeUrlsAlive(['https://x/redirect.png']);
    expect(r.get('https://x/redirect.png')).toBe(true);
  });

  it('HEAD 405 → 退回带 Range 的 GET 兜底', async () => {
    responder = (_url, method) => (method === 'HEAD' ? ok(405) : ok(206));
    const r = await probeUrlsAlive(['https://x/no-head.png']);
    expect(r.get('https://x/no-head.png')).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0].method).toBe('HEAD');
    expect(calls[1].method).toBe('GET');
    expect(calls[1].range).toBe('bytes=0-0');
  });

  it('HEAD 501 → 同样走 GET 兜底', async () => {
    responder = (_url, method) => (method === 'HEAD' ? ok(501) : ok(200));
    const r = await probeUrlsAlive(['https://x/no-head-501.png']);
    expect(r.get('https://x/no-head-501.png')).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('GET 兜底也 404 → 算死;非 405/501 的 HEAD 不再补 GET', async () => {
    responder = (_url, method) => (method === 'HEAD' ? ok(405) : ok(404));
    const r = await probeUrlsAlive(['https://x/dead-noh.gif']);
    expect(r.get('https://x/dead-noh.gif')).toBe(false);

    calls = [];
    responder = () => ok(404);
    const r2 = await probeUrlsAlive(['https://x/plain-404.png']);
    expect(r2.get('https://x/plain-404.png')).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('去重:同一 URL 只探一次', async () => {
    const r = await probeUrlsAlive(['https://x/dup.png', 'https://x/dup.png', '']);
    expect(r.get('https://x/dup.png')).toBe(true);
    expect(calls.length).toBe(1);
    expect(r.size).toBe(1);
  });

  it('空输入不发请求', async () => {
    const r = await probeUrlsAlive([]);
    expect(r.size).toBe(0);
    expect(calls.length).toBe(0);
  });

  it('非绝对 URL 无网可探 → 不作死判定(不发请求)', async () => {
    const r = await probeUrlsAlive(['/api/minio-proxy/x.png']);
    expect(r.get('/api/minio-proxy/x.png')).toBe(true);
    expect(calls.length).toBe(0);
  });
});
