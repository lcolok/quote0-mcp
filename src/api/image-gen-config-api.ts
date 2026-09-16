/**
 * 出图默认模型管理 API(后台可配置)。
 *
 *   GET /api/image-gen/config → { defaultTuziModel, availableTuziModels, source }
 *   PUT /api/image-gen/config → 校验 ID 在实时上游可出图目录内后写 DB
 *
 * PUT 是 fail-closed:上游目录拉不到时无法验证 ID,直接拒写 —— 否则可能落下一个
 * 上游根本不存在/不可出图的模型(如实测 503 的 gpt-image-2.5-1k),把整条出图链路拖死。
 *
 * 依赖以 createImageGenConfigApp 注入(生产用默认装配),便于端点测试不依赖真实 DB / 网络。
 */

import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  fetchUpstreamTuziModels,
  getImageGenConfig,
  setDefaultTuziModel,
} from '../react-widgets/services/image-gen-config.js';
import type { ImageGenConfig } from '../react-widgets/services/image-gen-config.js';

export interface ImageGenConfigDeps {
  getDb: () => PostgresDatabase;
  getImageGenConfig: (db: PostgresDatabase) => Promise<ImageGenConfig>;
  setDefaultTuziModel: (db: PostgresDatabase, model: string) => Promise<void>;
  fetchUpstreamTuziModels: () => Promise<string[]>;
}

export function createImageGenConfigApp(deps: ImageGenConfigDeps): Hono {
  const app = new Hono();

  // GET /api/image-gen/config
  app.get('/api/image-gen/config', async (c) => {
    try {
      const db = deps.getDb();
      const [config, availableTuziModels] = await Promise.all([
        deps.getImageGenConfig(db),
        deps.fetchUpstreamTuziModels(),
      ]);
      return c.json({
        success: true,
        defaultTuziModel: config.defaultTuziModel,
        source: config.source,
        availableTuziModels,
      });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // PUT /api/image-gen/config
  app.put('/api/image-gen/config', async (c) => {
    try {
      const body: any = await c.req.json().catch(() => null);
      const model =
        typeof body?.defaultTuziModel === 'string' ? body.defaultTuziModel.trim() : '';

      const db = deps.getDb();
      const availableTuziModels = await deps.fetchUpstreamTuziModels();

      // fail-closed:目录拉不到 → 无法验证 ID,拒绝写入
      if (availableTuziModels.length === 0) {
        return c.json(
          {
            success: false,
            error: '上游 TuZi 模型目录暂不可用,无法校验模型 ID,已拒绝写入',
          },
          503
        );
      }

      // 有效性 = 在实时可出图目录内(该列表元素已带 tuzi: 前缀,顺带拦住无前缀/拼错的 ID)
      if (!model || !availableTuziModels.includes(model)) {
        return c.json(
          {
            success: false,
            error: `无效的 TuZi 模型:「${model || '(空)'}」不在上游可出图列表中`,
            availableTuziModels,
          },
          400
        );
      }

      await deps.setDefaultTuziModel(db, model);
      return c.json({
        success: true,
        defaultTuziModel: model,
        source: 'db',
        availableTuziModels,
      });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  return app;
}

/** 生产装配:真实 PG + 真实服务(含上游目录拉取) */
export const imageGenConfigApp = createImageGenConfigApp({
  getDb: getPostgresDatabase,
  getImageGenConfig,
  setDefaultTuziModel,
  fetchUpstreamTuziModels,
});
