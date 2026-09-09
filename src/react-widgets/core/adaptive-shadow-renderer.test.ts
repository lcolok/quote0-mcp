import { describe, expect, test } from 'bun:test';
import type { RenderableDataItem } from './modular-architecture.js';
import type { RenderTarget } from './render-targets.js';
import {
  AdaptiveShadowQueue,
  adaptiveShadowContentFingerprint,
  adaptiveShadowKey,
  adaptiveShadowQueueLimit,
  adaptiveShadowSubjectKey,
  executeAdaptiveRenderShadow,
  measureMonoBitmap,
  type AdaptiveShadowJob,
  type AdaptiveShadowRecord,
} from './adaptive-shadow-renderer.js';

const TARGET: RenderTarget = {
  id: 'test-16x8',
  kind: 'eink',
  widthPx: 16,
  heightPx: 8,
  dpi: 250,
  colorMode: 'mono-1bit',
  defaultFontStack: ['fusion-pixel-12'],
};

function news(overrides: Partial<RenderableDataItem> = {}): RenderableDataItem {
  return {
    id: '42',
    title: 'MCP 新规范取消会话',
    message: '请求变成自描述，网关可以直接路由。',
    signature: '神经漫游者',
    source: 'InfoQ',
    publishTime: '2026-08-18T00:00:00Z',
    category: 'news',
    link: 'https://example.com/story?utm_source=rss#section',
    highlights: ['MCP'],
    ...overrides,
  };
}

function job(overrides: Partial<AdaptiveShadowJob> = {}): AdaptiveShadowJob {
  return {
    data: news(),
    target: TARGET,
    primary: { localImagePath: './primary.png' },
    deviceIds: ['eink-1'],
    ...overrides,
  };
}

describe('Adaptive render shadow identity + bitmap metrics', () => {
  test('normalizes tracking/hash noise out of subject identity while content fingerprint stays semantic', () => {
    const a = news();
    const b = news({ link: 'https://example.com/story' });
    expect(adaptiveShadowSubjectKey(a)).toBe('url:https://example.com/story');
    expect(adaptiveShadowSubjectKey(a)).toBe(adaptiveShadowSubjectKey(b));
    expect(adaptiveShadowContentFingerprint(a)).toBe(adaptiveShadowContentFingerprint(b));
    expect(adaptiveShadowKey(a, TARGET)).toBe(adaptiveShadowKey(b, TARGET));
  });

  test('measures real MSB-first burn geometry and rejects malformed bitmap sizes', () => {
    const bitmap = Buffer.alloc(16);
    bitmap[0] = 0b10000001;
    bitmap[15] = 0b00000001;
    expect(measureMonoBitmap(bitmap, TARGET)).toEqual({
      bytes: 16,
      expectedBytes: 16,
      burnBits: 3,
      burnRatio: 0.0234,
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 7, width: 16, height: 8 },
    });
    expect(() => measureMonoBitmap(Buffer.alloc(15), TARGET)).toThrow('bitmap size mismatch');
  });

  test('clamps queue limits so a bad env cannot allocate an unbounded shadow backlog', () => {
    expect(adaptiveShadowQueueLimit({ QUOTE0_ADAPTIVE_SHADOW_QUEUE_LIMIT: '0' } as any)).toBe(1);
    expect(adaptiveShadowQueueLimit({ QUOTE0_ADAPTIVE_SHADOW_QUEUE_LIMIT: '9999' } as any)).toBe(256);
    expect(adaptiveShadowQueueLimit({ QUOTE0_ADAPTIVE_SHADOW_QUEUE_LIMIT: 'NaN' } as any)).toBe(32);
  });
});

describe('Adaptive shadow processor', () => {
  test('persists one completed A/B evidence row with plan, render metrics and both 1-bit measurements', async () => {
    const queries: Array<{ sql: string; params?: any[] }> = [];
    const database = {
      initialize: async () => {},
      query: async (sql: string, params?: any[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
    };
    const shadowBitmap = Buffer.alloc(16);
    shadowBitmap[0] = 0b10000000;
    const primaryBitmap = Buffer.alloc(16);
    primaryBitmap[1] = 0b01000000;
    let packCalls = 0;
    const primaryMetrics = {
      initializedWarm: true,
      initMs: 0,
      satoriMs: 8,
      resvgInitMs: 1,
      resvgRenderMs: 1,
      resvgMs: 2,
      totalMs: 10,
      fontCount: 1,
      fontBytes: 100,
      svgChars: 220,
    };

    const result = await executeAdaptiveRenderShadow(job({
      primary: { localImagePath: './primary.png', renderMetrics: primaryMetrics },
    }), {
      database,
      readPrimaryPng: async () => Buffer.from('primary'),
      renderShadow: async (_document, target, layoutPlan) => ({
        pngBuffer: Buffer.from('shadow'),
        target,
        layoutPlan,
        renderMs: 7,
        metrics: {
          initializedWarm: true,
          initMs: 0,
          satoriMs: 4,
          resvgInitMs: 1,
          resvgRenderMs: 2,
          resvgMs: 3,
          totalMs: 7,
          fontCount: 1,
          fontBytes: 100,
          svgChars: 200,
        },
      }),
      packPng: async () => (++packCalls === 1 ? shadowBitmap : primaryBitmap),
    });

    expect(result.state).toBe('completed');
    expect(result.layoutPlan?.targetId).toBe(TARGET.id);
    expect(result.shadowRenderMetrics?.totalMs).toBe(7);
    expect(result.primaryRenderMetrics?.totalMs).toBe(10);
    expect(result.shadowBitmapMetrics?.burnBits).toBe(1);
    expect(result.primaryBitmapMetrics?.burnBits).toBe(1);
    expect(result.comparisonMetrics).toMatchObject({
      burnBitsDelta: 0,
      burnRatioDelta: 0,
      shadowToPrimaryBurnRatio: 1,
      renderMsDelta: -3,
      shadowToPrimaryRenderRatio: 0.7,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('ON CONFLICT (shadow_key) DO NOTHING');
    expect(queries[0].params?.[12]).toBe('completed');
    expect(JSON.parse(String(queries[0].params?.[15]))).toMatchObject({ totalMs: 10 });
    expect(JSON.parse(String(queries[0].params?.[18]))).toMatchObject({ renderMsDelta: -3 });
  });

  test('persists a failed evidence row without throwing into the production caller', async () => {
    const states: string[] = [];
    const result = await executeAdaptiveRenderShadow(job(), {
      database: {
        initialize: async () => {},
        query: async (_sql, params) => {
          states.push(String(params?.[12]));
          return { rows: [] };
        },
      },
      readPrimaryPng: async () => Buffer.from('primary'),
      renderShadow: async () => {
        throw new Error('synthetic adaptive failure');
      },
    });
    expect(result.state).toBe('failed');
    expect(result.error).toContain('synthetic adaptive failure');
    expect(states).toEqual(['failed']);
  });
});

describe('Adaptive shadow queue isolation', () => {
  test('runs at concurrency=1, deduplicates pending work and drops instead of backpressuring', async () => {
    let active = 0;
    let maxActive = 0;
    const processed: string[] = [];
    const processor = async (item: AdaptiveShadowJob): Promise<AdaptiveShadowRecord> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(8);
      processed.push(String(item.data.id));
      active -= 1;
      return {
        shadowKey: adaptiveShadowKey(item.data, item.target),
        artifactId: String(item.data.id),
        contentFingerprint: adaptiveShadowContentFingerprint(item.data),
        subjectKey: adaptiveShadowSubjectKey(item.data),
        source: item.data.source,
        targetId: item.target.id,
        widthPx: item.target.widthPx,
        heightPx: item.target.heightPx,
        deviceIds: [],
        layoutEngine: 'adaptive-layout/v1',
        shadowRenderer: 'adaptive-satori/v1',
        primaryRenderer: 'local-eink-satori-news/v1',
        state: 'completed',
      };
    };

    const queue = new AdaptiveShadowQueue(processor, 2);
    const one = job({ data: news({ id: '1', link: 'https://example.com/1' }) });
    const two = job({ data: news({ id: '2', link: 'https://example.com/2' }) });
    const three = job({ data: news({ id: '3', link: 'https://example.com/3' }) });

    expect(queue.enqueue(one)).toBe('queued');
    expect(queue.enqueue(one)).toBe('duplicate');
    expect(queue.enqueue(two)).toBe('queued');
    expect(queue.enqueue(three)).toBe('dropped');
    await queue.drain();

    expect(queue.enqueue(one)).toBe('duplicate');
    expect(processed).toEqual(['1', '2']);
    expect(maxActive).toBe(1);
    expect(queue.status()).toMatchObject({
      queueDepth: 0,
      enqueued: 2,
      completed: 2,
      failed: 0,
      dropped: 1,
      duplicatePending: 1,
      duplicateCompleted: 1,
      inFlight: false,
    });
  });
});
