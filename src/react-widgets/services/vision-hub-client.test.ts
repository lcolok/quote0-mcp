import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { VisionHubClient, fidelityFetchUrl } from './vision-hub-client.js';

const realFetch = globalThis.fetch;

let capturedUrl = '';
let capturedForm: FormData | null = null;
let responder: (url: string) => Response | Promise<Response> = () =>
  new Response(
    JSON.stringify({
      imageId: '1789549271258_0eb11598f4def73e.png',
      status: 'uploaded',
      urls: { original: '/api/images/1789549271258_0eb11598f4def73e.png' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

const stubFetch = (async (input: any, init?: RequestInit) => {
  capturedUrl = typeof input === 'string' ? input : (input?.url ?? String(input));
  capturedForm = (init?.body instanceof FormData ? init.body : null) as FormData | null;
  return await responder(capturedUrl);
}) as typeof fetch;

beforeEach(() => {
  capturedUrl = '';
  capturedForm = null;
  responder = () =>
    new Response(
      JSON.stringify({
        imageId: '1789549271258_0eb11598f4def73e.png',
        status: 'uploaded',
        urls: { original: '/api/images/1789549271258_0eb11598f4def73e.png' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const client = new VisionHubClient({
  internalBase: 'http://vh.internal:3000',
  publicBase: 'https://vision-hub.logic.heiyu.space',
});

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('vision-hub-client 上传请求', () => {
  it('打内网 /api/images/upload，multipart 字段名为 file', async () => {
    await client.uploadSourceImage(PNG_BYTES, 'quote0-label-1.png');

    expect(capturedUrl).toBe('http://vh.internal:3000/api/images/upload');
    expect(capturedForm).toBeInstanceOf(FormData);
    const file = capturedForm!.get('file') as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('quote0-label-1.png');
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).length).toBe(PNG_BYTES.length);
  });

  it('扩展名决定 multipart Content-Type（jpg → image/jpeg）', async () => {
    await client.uploadSourceImage(PNG_BYTES, 'quote0-label-2.jpg');
    expect((capturedForm!.get('file') as File).type).toBe('image/jpeg');
  });

  it('未知扩展名退回 image/png', async () => {
    await client.uploadSourceImage(PNG_BYTES, 'quote0-label-3.bin');
    expect((capturedForm!.get('file') as File).type).toBe('image/png');
  });

  it('内网 base 走 env 覆盖（trailing slash 归一）', async () => {
    process.env.VISION_HUB_INTERNAL_BASE = 'http://vh.env-override:3000/';
    try {
      const envClient = new VisionHubClient();
      await envClient.uploadSourceImage(PNG_BYTES, 'quote0-label-4.png');
      expect(capturedUrl).toBe('http://vh.env-override:3000/api/images/upload');
    } finally {
      delete process.env.VISION_HUB_INTERNAL_BASE;
    }
  });
});

describe('vision-hub-client 响应解析', () => {
  it('imageId 优先，publicUrl 拼公网 BASE', async () => {
    const r = await client.uploadSourceImage(PNG_BYTES, 'quote0-label-1.png');
    expect(r.imageId).toBe('1789549271258_0eb11598f4def73e.png');
    expect(r.publicUrl).toBe('https://vision-hub.logic.heiyu.space/api/images/1789549271258_0eb11598f4def73e.png');
  });

  it('缺 imageId 时从 urls.original 兜底解析', async () => {
    responder = () =>
      new Response(
        JSON.stringify({ status: 'uploaded', urls: { original: '/api/images/fallback-hash.webp' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const r = await client.uploadSourceImage(PNG_BYTES, 'quote0-label-5.webp');
    expect(r.imageId).toBe('fallback-hash.webp');
    expect(r.publicUrl).toBe('https://vision-hub.logic.heiyu.space/api/images/fallback-hash.webp');
  });

  it('非 200 抛 [VISION_HUB] 且带 HTTP 状态码', async () => {
    responder = () => new Response('vh boom', { status: 500 });
    await expect(client.uploadSourceImage(PNG_BYTES, 'quote0-label-6.png')).rejects.toThrow(
      /\[VISION_HUB\] 上传失败 HTTP 500/
    );
  });

  it('响应缺 imageId 与 urls.original 抛 [VISION_HUB]', async () => {
    responder = () =>
      new Response(JSON.stringify({ status: 'uploaded', urls: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(client.uploadSourceImage(PNG_BYTES, 'quote0-label-7.png')).rejects.toThrow(/\[VISION_HUB\]/);
  });

  it('网络错误打 [VISION_HUB] 前缀', async () => {
    globalThis.fetch = (async (_input: any, _init?: RequestInit): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    await expect(client.uploadSourceImage(PNG_BYTES, 'quote0-label-8.png')).rejects.toThrow(/\[VISION_HUB\] 上传网络错误/);
  });

  it('超时打 [VISION_HUB] 前缀', async () => {
    globalThis.fetch = (async (_input: any, _init?: RequestInit): Promise<Response> => {
      const e: any = new Error('The operation timed out');
      e.name = 'TimeoutError';
      throw e;
    }) as typeof fetch;

    await expect(client.uploadSourceImage(PNG_BYTES, 'quote0-label-9.png')).rejects.toThrow(/\[VISION_HUB\] 上传超时/);
  });
});

describe('fidelityFetchUrl 保真下载三态', () => {
  it('体系内 URL 追加 ?f=png 强制无损 PNG', () => {
    expect(fidelityFetchUrl('https://vision-hub.logic.heiyu.space/api/images/a.png')).toBe(
      'https://vision-hub.logic.heiyu.space/api/images/a.png?f=png'
    );
  });

  it('外部 URL（历史死链 / TuZi CDN）原样返回', () => {
    const bizyair = 'https://bizyair-prod.oss-cn-shanghai.aliyuncs.com/outputs/A48ocE8Q3jp4TWiK.jpg';
    expect(fidelityFetchUrl(bizyair)).toBe(bizyair);
    expect(fidelityFetchUrl('https://apioss0.sydney-ai.com/x.png')).toBe('https://apioss0.sydney-ai.com/x.png');
  });

  it('已带查询参数的体系内 URL 用 & 追加，不产生第二个 ?', () => {
    expect(fidelityFetchUrl('https://vision-hub.logic.heiyu.space/api/images/a.png?w=320')).toBe(
      'https://vision-hub.logic.heiyu.space/api/images/a.png?w=320&f=png'
    );
  });

  it('已显式带 f 参数的 URL 不重复追加', () => {
    const u = 'https://vision-hub.logic.heiyu.space/api/images/a.png?f=png';
    expect(fidelityFetchUrl(u)).toBe(u);
  });

  it('前缀相近但非同一 base 的域名不改写', () => {
    const spoof = 'https://vision-hub.logic.heiyu.space.evil.com/api/images/a.png';
    expect(fidelityFetchUrl(spoof)).toBe(spoof);
  });
});
