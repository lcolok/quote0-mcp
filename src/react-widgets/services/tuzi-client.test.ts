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
let capturedForm: FormData | null = null;
let capturedHeaders: HeadersInit | undefined;
let responder: (url: string) => Response | Promise<Response> = () =>
  new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.example/img.png' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const stubFetch = (async (input: any, init?: RequestInit) => {
  capturedUrl = typeof input === 'string' ? input : (input?.url ?? String(input));
  capturedHeaders = init?.headers;
  if (init?.body instanceof FormData) {
    capturedForm = init.body;
    capturedPayload = null;
  } else {
    capturedForm = null;
    capturedPayload = init?.body ? JSON.parse(String(init.body)) : null;
  }
  return await responder(capturedUrl);
}) as typeof fetch;

beforeEach(() => {
  capturedUrl = '';
  capturedPayload = null;
  capturedForm = null;
  capturedHeaders = undefined;
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

/** 一张最小 PNG 头部字节就够（客户端只做字节搬运，不解析图像） */
function pngBytes(size = 8): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(size - 4).fill(0)]);
}

function imageFiles(): File[] {
  return capturedForm!.getAll('image') as File[];
}

describe('tuzi-client edit（multipart 图生图）', () => {
  it('打到 /images/edits，字段齐全且 n=1 / response_format=url', async () => {
    await client.edit({
      prompt: '改成猫',
      model: 'gpt-image-2.5',
      images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'ref-0.png' }],
      aspect: { widthPx: 320, heightPx: 160 },
    });

    expect(capturedUrl).toMatch(/\/images\/edits$/);
    expect(capturedForm).toBeInstanceOf(FormData);
    expect(capturedForm!.get('model')).toBe('gpt-image-2.5');
    expect(capturedForm!.get('prompt')).toBe('改成猫');
    expect(capturedForm!.get('n')).toBe('1');
    expect(capturedForm!.get('response_format')).toBe('url');
    expect(capturedForm!.get('size')).toBe('1536x1024');
    expect(capturedForm!.get('quality')).toBe('low');
  });

  it('多图走重复 image 字段（不是 image[]），带文件名与 MIME', async () => {
    await client.edit({
      prompt: 'p',
      model: 'm',
      images: [
        { bytes: pngBytes(), contentType: 'image/png', filename: 'ref-0.png' },
        { bytes: pngBytes(16), contentType: 'image/png', filename: 'ref-1.png' },
      ],
    });

    expect(capturedForm!.getAll('image')).toHaveLength(2);
    expect(capturedForm!.has('image[]')).toBe(false);
    const files = imageFiles();
    expect(files[0].name).toBe('ref-0.png');
    expect(files[1].name).toBe('ref-1.png');
    expect(files[0].type).toBe('image/png');
    expect(files[0].size).toBe(8);
    expect(files[1].size).toBe(16);
  });

  it('model 传 tuzi: 前缀时自动剥离', async () => {
    await client.edit({
      prompt: 'p',
      model: 'tuzi:gpt-image-2.5',
      images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
    });
    expect(capturedForm!.get('model')).toBe('gpt-image-2.5');
  });

  it('不设 Content-Type（multipart boundary 由 fetch 生成）', async () => {
    await client.edit({
      prompt: 'p',
      model: 'm',
      images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
    });
    expect(capturedHeaders).toBeUndefined();
  });

  it('n / response_format 不接受 options 覆盖，size / quality 接受', async () => {
    await client.edit({
      prompt: 'p',
      model: 'm',
      images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
      aspect: { widthPx: 320, heightPx: 160 },
      options: { n: 7, response_format: 'b64_json', size: '1024x1024', quality: 'high' },
    });
    expect(capturedForm!.get('n')).toBe('1');
    expect(capturedForm!.get('response_format')).toBe('url');
    expect(capturedForm!.get('size')).toBe('1024x1024');
    expect(capturedForm!.get('quality')).toBe('high');
  });

  it('解析 data[0].url，错误口径与 generate 一致', async () => {
    responder = () =>
      new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.example/edited.png' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const r = await client.edit({
      prompt: 'p',
      model: 'm',
      images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
    });
    expect(r.imageUrl).toBe('https://cdn.example/edited.png');
    expect(typeof r.elapsedMs).toBe('number');
  });

  it('非 200 抛 TuZi HTTP 前缀', async () => {
    responder = () => new Response('edits boom', { status: 500 });
    await expect(
      client.edit({
        prompt: 'p',
        model: 'm',
        images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
      })
    ).rejects.toThrow(/TuZi HTTP 500/);
  });

  it('响应缺 data[0].url 抛错', async () => {
    responder = () =>
      new Response(JSON.stringify({ created: 1, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(
      client.edit({
        prompt: 'p',
        model: 'm',
        images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
      })
    ).rejects.toThrow(/无 data\[0\]\.url/);
  });

  it('超时打 [TUZI_TIMEOUT] 标签', async () => {
    globalThis.fetch = (async (): Promise<Response> => {
      const e: any = new Error('The operation timed out');
      e.name = 'TimeoutError';
      throw e;
    }) as unknown as typeof fetch;

    await expect(
      client.edit({
        prompt: 'p',
        model: 'm',
        images: [{ bytes: pngBytes(), contentType: 'image/png', filename: 'a.png' }],
      })
    ).rejects.toThrow(/\[TUZI_TIMEOUT\]/);
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
