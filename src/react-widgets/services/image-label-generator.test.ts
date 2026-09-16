import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { imageLabelGenerator } from './image-label-generator.js';
import { LABEL_T40X20_TARGET } from '../core/render-targets.js';

const realFetch = globalThis.fetch;

/** 体系内 VisionHub 公网/内网入口（与 vision-hub-client 的缺省一致） */
const VH_PUBLIC = 'https://vision-hub.logic.heiyu.space';
const VH_UPLOAD = 'http://web.me.friday.vision-hub.lzcapp:3000/api/images/upload';

const REF_0 = `${VH_PUBLIC}/api/images/ref-0.png`;
const REF_1 = `${VH_PUBLIC}/api/images/ref-1.png`;

type Route = { match: string; handler: (url: string) => Response | Promise<Response> };

let routes: Route[] = [];
let calls: string[] = [];
let editForm: FormData | null = null;
let png: Buffer;

const stubFetch = (async (input: any, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  calls.push(url);
  if (init?.body instanceof FormData && url.includes('/images/edits')) editForm = init.body;
  for (const r of routes) {
    if (url.includes(r.match)) return await r.handler(url);
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as typeof fetch;

const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

const imageResponse = (buf: Buffer, contentType = 'image/png') =>
  // Buffer<ArrayBufferLike> 不满足 BodyInit，Uint8Array 拷贝一份即可（字节内容不变）
  new Response(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': contentType } });

/** 出图后端响应的两条固定路由（生成出图 URL + 图 URL 可下载） */
function backendRoutes(outUrl: string, endpoint: 'generations' | 'edits'): Route[] {
  return [
    { match: `/images/${endpoint}`, handler: () => json({ created: 1, data: [{ url: outUrl }] }) },
    { match: outUrl, handler: () => imageResponse(png) },
  ];
}

const uploadRoute: Route = {
  match: '/api/images/upload',
  handler: () => json({ imageId: 'gen.png', status: 'uploaded', urls: { original: '/api/images/gen.png' } }),
};

beforeEach(async () => {
  calls = [];
  editForm = null;
  routes = [];
  png ??= await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  globalThis.fetch = stubFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function imageFiles(): File[] {
  return editForm!.getAll('image') as File[];
}

describe('image-label-generator · TuZi 有参考图 → /images/edits', () => {
  it('下载参考图后走 multipart edits，产物转存 VisionHub', async () => {
    routes = [
      uploadRoute,
      ...backendRoutes('https://cdn.example/edited.png', 'edits'),
      { match: '/api/images/ref-0.png', handler: () => imageResponse(png) },
    ];

    const r = await imageLabelGenerator.generate(
      '改成猫',
      'tuzi:gpt-image-2.5',
      LABEL_T40X20_TARGET,
      { images: [REF_0] }
    );

    // 参考图下载：体系内 URL 追加 ?f=png（PNG 已实证，webp 不赌）
    expect(calls).toContain(`${REF_0}?f=png`);
    expect(calls.some((u) => u.endsWith('/images/edits'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/images/generations'))).toBe(false);

    expect(editForm!.get('model')).toBe('gpt-image-2.5');
    expect(editForm!.get('prompt')).toBe('改成猫');
    expect(editForm!.get('size')).toBe('1536x1024');
    expect(editForm!.get('n')).toBe('1');
    expect(imageFiles()).toHaveLength(1);
    expect(imageFiles()[0].name).toBe('ref-0.png');
    expect(imageFiles()[0].type).toBe('image/png');

    expect(calls).toContain(VH_UPLOAD);
    expect(r.sourceImageUrl).toBe(`${VH_PUBLIC}/api/images/gen.png`);
    expect(typeof r.bizyairLatencyMs).toBe('number');
    expect(r.pngBuffer.length).toBeGreaterThan(0);
    expect(r.bitmapBuffer.length).toBeGreaterThan(0);
  });

  it('两张参考图 → 两个重复 image 字段，顺序与入参一致', async () => {
    routes = [
      uploadRoute,
      ...backendRoutes('https://cdn.example/edited.png', 'edits'),
      { match: '/api/images/ref-0.png', handler: () => imageResponse(png) },
      { match: '/api/images/ref-1.png', handler: () => imageResponse(png) },
    ];

    await imageLabelGenerator.generate(
      '融合两张',
      'tuzi:gpt-image-2.5',
      LABEL_T40X20_TARGET,
      { images: [REF_0, REF_1] }
    );

    expect(imageFiles()).toHaveLength(2);
    expect(imageFiles().map((f) => f.name)).toEqual(['ref-0.png', 'ref-1.png']);
    expect(editForm!.has('image[]')).toBe(false);
  });

  it('参考图下载 404 → 抛带 URL 的明确错误，且不调 edits', async () => {
    routes = [
      ...backendRoutes('https://cdn.example/edited.png', 'edits'),
      { match: '/api/images/ref-0.png', handler: () => new Response('gone', { status: 404 }) },
    ];

    await expect(
      imageLabelGenerator.generate('p', 'tuzi:gpt-image-2.5', LABEL_T40X20_TARGET, { images: [REF_0] })
    ).rejects.toThrow(/下载参考图失败 HTTP 404 .*ref-0\.png/);

    expect(calls.some((u) => u.endsWith('/images/edits'))).toBe(false);
  });

  it('参考图 content-type 非图像 → 抛错', async () => {
    routes = [
      ...backendRoutes('https://cdn.example/edited.png', 'edits'),
      { match: '/api/images/ref-0.png', handler: () => imageResponse(Buffer.from('<html>'), 'text/html') },
    ];

    await expect(
      imageLabelGenerator.generate('p', 'tuzi:gpt-image-2.5', LABEL_T40X20_TARGET, { images: [REF_0] })
    ).rejects.toThrow(/content-type 非图像/);
    expect(calls.some((u) => u.endsWith('/images/edits'))).toBe(false);
  });
});

describe('image-label-generator · TuZi 无参考图 → /images/generations', () => {
  it('无 images[] 时仍走文生图', async () => {
    routes = [uploadRoute, ...backendRoutes('https://cdn.example/t2i.png', 'generations')];

    const r = await imageLabelGenerator.generate('一只猫', 'tuzi:gpt-image-2.5', LABEL_T40X20_TARGET);

    expect(calls.some((u) => u.endsWith('/images/generations'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/images/edits'))).toBe(false);
    expect(r.sourceImageUrl).toBe(`${VH_PUBLIC}/api/images/gen.png`);
  });
});
