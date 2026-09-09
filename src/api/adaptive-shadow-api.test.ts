import { describe, expect, test } from 'bun:test';
import { createAdaptiveShadowApp } from './adaptive-shadow-api.js';

describe('Adaptive shadow observability API', () => {
  test('reports that shadow is non-authoritative and never changes physical delivery', async () => {
    const app = createAdaptiveShadowApp({
      status: () => ({
        enabled: true,
        version: 'adaptive-render-shadow/v1',
        layoutEngine: 'adaptive-layout/v1',
        shadowRenderer: 'adaptive-satori/v1',
        primaryRenderer: 'local-eink-satori-news/v1',
        concurrency: 1,
        changesPhysicalDelivery: false,
        queueDepth: 2,
        queueLimit: 32,
        inFlight: true,
        enqueued: 9,
        completed: 6,
        failed: 1,
        dropped: 0,
        duplicatePending: 1,
        duplicateCompleted: 2,
        lastError: null,
        lastCompletedAt: '2026-08-18T00:00:00.000Z',
      }),
    });
    const response = await app.request('/api/renderers/adaptive/shadow/status');
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      enabled: true,
      concurrency: 1,
      changesPhysicalDelivery: false,
      queueDepth: 2,
      completed: 6,
    });
  });

  test('bounds recent evidence queries and returns durable A/B rows', async () => {
    let seenLimit = 0;
    const app = createAdaptiveShadowApp({
      listRecent: async (limit) => {
        seenLimit = limit;
        return [{ id: 1, state: 'completed', target_id: 'eink-296x128' }];
      },
    });
    const response = await app.request('/api/renderers/adaptive/shadow/recent?limit=999');
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(seenLimit).toBe(100);
    expect(body).toMatchObject({ success: true, count: 1, limit: 100 });
    expect(body.data[0].target_id).toBe('eink-296x128');
  });

  test('fails the evidence query closed without affecting the status endpoint', async () => {
    const app = createAdaptiveShadowApp({
      listRecent: async () => {
        throw new Error('synthetic db down');
      },
    });
    const response = await app.request('/api/renderers/adaptive/shadow/recent');
    const body = await response.json() as any;
    expect(response.status).toBe(500);
    expect(body.error).toContain('synthetic db down');
  });
});
