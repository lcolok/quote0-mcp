import { Hono } from 'hono';
import {
  getAdaptiveShadowRuntimeStatus,
  listRecentAdaptiveShadowRuns,
} from '../react-widgets/core/adaptive-shadow-renderer.js';

export interface AdaptiveShadowApiDeps {
  status?: typeof getAdaptiveShadowRuntimeStatus;
  listRecent?: typeof listRecentAdaptiveShadowRuns;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value ?? '20');
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, Math.round(parsed)));
}

export function createAdaptiveShadowApp(deps: AdaptiveShadowApiDeps = {}) {
  const app = new Hono();
  const getStatus = deps.status ?? getAdaptiveShadowRuntimeStatus;
  const listRecent = deps.listRecent ?? listRecentAdaptiveShadowRuns;

  app.get('/api/renderers/adaptive/shadow/status', (c) => {
    return c.json({ success: true, ...getStatus() });
  });

  app.get('/api/renderers/adaptive/shadow/recent', async (c) => {
    const limit = parseLimit(c.req.query('limit'));
    try {
      const rows = await listRecent(limit);
      return c.json({ success: true, count: rows.length, limit, data: rows });
    } catch (error) {
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Adaptive shadow evidence query failed',
      }, 500);
    }
  });

  return app;
}

export const adaptiveShadowApp = createAdaptiveShadowApp();
export default adaptiveShadowApp;
