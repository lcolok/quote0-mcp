import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  TuziClient,
  deriveTuziSize,
  isTuziModel,
  upstreamModelFromTuzi,
} from './tuzi-client.js';

const realFetch = globalThis.fetch;

let capturedUrl = '';
let capturedPayload: any = null;
let responder: (url: string) => Response | Promise<Response> = () =>
  new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.example/img.png' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const stubFetch = (async (input: any, init?: RequestInit) => {
  capturedUrl = typeof input === 'string' ? input : (input?.url ?? String(input));
  capturedPayload = init?.body ? JSON.parse(String(init.body)) : null;
  return await responder(capturedUrl);
}) as typeof fetch;

beforeEach(() => {
  capturedUrl = '';
  capturedPayload = null;
  responder = () =>
    new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.example/img.png' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const client = new TuziClient();

describe('tuzi-client payload', () => {
  it('打到 /images/generations，透传模型与 prompt', async () => {
    await client.generate({ prompt: '一只猫', model: 'gpt-image-2.5' });

    expect(capturedUrl).toMatch(/\/images\/generations$/);
    expect(capturedPayload.model).toBe('gpt-image-2.5');
    expect(capturedPayload.prompt).toBe('一只猫');
    expect(capturedPayload.n).toBe(1);
    expect(capturedPayload.response_format).toBe('url');
    expect(capturedPayload.output_format).toBe('png');
    expect(capturedPayload.background).toBe('auto');
  });

  it('size 按 target 纵横推导：横 → 1536x1024', async () => {
    await client.generate({ prompt: 'p', model: 'm', aspect: { widthPx: 320, heightPx: 160 } });
    expect(capturedPayload.size).toBe('1536x1024');
  });

  it('size 按 target 纵横推导：纵 → 1024x1536', async () => {
    await client.generate({ prompt: 'p', model: 'm', aspect: { widthPx: 152, heightPx: 296 } });
    expect(capturedPayload.size).toBe('1024x1536');
  });

  it('size 按 target 纵横推导：正方 → 1024x1024', async () => {
    await client.generate({ prompt: 'p', model: 'm', aspect: { widthPx: 200, heightPx: 200 } });
    expect(capturedPayload.size).toBe('1024x1024');
  });

  it('quality 默认 low（标签 320×160 足够且最快）', async () => {
    await client.generate({ prompt: 'p', model: 'm' });
    expect(capturedPayload.quality).toBe('low');
  });

  it('modelOptions 可覆盖 size / quality', async () => {
    await client.generate({
      prompt: 'p',
      model: 'm',
      aspect: { widthPx: 320, heightPx: 160 },
      options: { size: '1024x1024', quality: 'high' },
    });
    expect(capturedPayload.size).toBe('1024x1024');
    expect(capturedPayload.quality).toBe('high');
  });

  it('n / response_format / model / prompt 不接受 options 覆盖', async () => {
    await client.generate({
      prompt: 'p',
      model: 'm',
      options: { n: 7, response_format: 'b64_json', model: 'hijack', prompt: 'hijack' },
    });
    expect(capturedPayload.n).toBe(1);
    expect(capturedPayload.response_format).toBe('url');
    expect(capturedPayload.model).toBe('m');
    expect(capturedPayload.prompt).toBe('p');
  });
});

describe('tuzi-client response', () => {
  it('解析 data[0].url 并回填 elapsedMs', async () => {
    responder = () =>
      new Response(JSON.stringify({ created: 123, data: [{ url: 'https://cdn.example/a.png', revised_prompt: 'x' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const r = await client.generate({ prompt: 'p', model: 'm' });
    expect(r.imageUrl).toBe('https://cdn.example/a.png');
    expect(typeof r.elapsedMs).toBe('number');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.rawResponse.data[0].revised_prompt).toBe('x');
  });

  it('非 200 抛错并带上 HTTP 状态码', async () => {
    responder = () => new Response('upstream boom', { status: 502 });
    await expect(client.generate({ prompt: 'p', model: 'm' })).rejects.toThrow(/TuZi HTTP 502/);
  });

  it('响应缺 data[0].url 抛错', async () => {
    responder = () =>
      new Response(JSON.stringify({ created: 1, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(client.generate({ prompt: 'p', model: 'm' })).rejects.toThrow(/无 data\[0\]\.url/);
  });

  it('超时打 [TUZI_TIMEOUT] 标签（供 worker 跳过重试）', async () => {
    globalThis.fetch = (async (_input: any, _init?: RequestInit): Promise<Response> => {
      const e: any = new Error('The operation timed out');
      e.name = 'TimeoutError';
      throw e;
    }) as typeof fetch;

    await expect(client.generate({ prompt: 'p', model: 'm' })).rejects.toThrow(/\[TUZI_TIMEOUT\]/);
  });

  it('网络错误走通用分支，不带 TIMEOUT 标签', async () => {
    globalThis.fetch = (async (_input: any, _init?: RequestInit): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    await expect(client.generate({ prompt: 'p', model: 'm' })).rejects.toThrow(/TuZi 网络错误/);
  });
});

describe('tuzi 模型串解析', () => {
  it('合法前缀剥离出上游模型名', () => {
    expect(upstreamModelFromTuzi('tuzi:gpt-image-2.5')).toBe('gpt-image-2.5');
    expect(upstreamModelFromTuzi('tuzi:vendor/model-x')).toBe('vendor/model-x');
    expect(isTuziModel('tuzi:gpt-image-2')).toBe(true);
  });

  it('无前缀 / 剥离后为空 / 字符集越界 → 拒绝', () => {
    expect(upstreamModelFromTuzi('sd5')).toBeNull();
    expect(upstreamModelFromTuzi('tuzi:')).toBeNull();
    expect(upstreamModelFromTuzi('tuzi:has space')).toBeNull();
    expect(upstreamModelFromTuzi('tuzi:中文')).toBeNull();
    expect(upstreamModelFromTuzi('tuzi:a;rm -rf')).toBeNull();
    expect(isTuziModel('sd5')).toBe(false);
    expect(isTuziModel(undefined)).toBe(false);
  });

  it('deriveTuziSize 无纵横信息时退回正方', () => {
    expect(deriveTuziSize()).toBe('1024x1024');
  });
});
