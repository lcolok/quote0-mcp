/**
 * 出图默认模型的后台配置(单行表 image_gen_settings)+ 上游 TuZi 实时模型目录。
 *
 * 动机:默认出图模型原先硬编码在 image-backend-liveness.ts 的 LIVE_DEFAULT_MODEL,
 * 换档位(省钱)要发版。改为运维经 /api/image-gen/config 动态配置,配置落 DB 跨重启存活。
 *
 * 上游目录(经 copilot 网关 GET /providers/tuzi/v1/models)含两类模型:
 *   · 可出图 —— supported_endpoint_types 与 {generate, edit, image-generation} 有交集;
 *   · 仅 chat 计数变体(-count)—— 只有 OpenAI-Chat,拉进生成链路必失败,必须过滤掉。
 */

import type { PostgresDatabase } from '../core/postgres-database.js';
import { LIVE_DEFAULT_MODEL } from './image-backend-liveness.js';

/** 单行设置表主键(只会有 id=1 一行) */
const SETTINGS_ROW_ID = 1;

/** 默认模型 / 上游目录共用的缓存 TTL(与 llm-config.ts 的 30s 模式一致) */
const CACHE_TTL_MS = 30_000;

/** 上游目录只读元数据,超时短一点即可 */
const CATALOG_TIMEOUT_MS = 10_000;

/** 判「可出图」的 upstream endpoint 类型集(仅 OpenAI-Chat 的 -count 变体据此被排除) */
const IMAGE_ENDPOINT_TYPES: ReadonlySet<string> = new Set([
  'image-generation',
  'generate',
  'edit',
]);

/** 默认模型来源:DB 行 > 环境变量 > 硬编码兜底常量 */
export type ImageGenConfigSource = 'db' | 'env' | 'fallback';

export interface ImageGenConfig {
  defaultTuziModel: string;
  source: ImageGenConfigSource;
}

/** 上游 baseUrl 与 tuzi-client 相同(容器内免鉴权,public_path 已含 /providers/) */
function tuziBaseUrl(): string {
  return process.env.COPILOT_TUZI_BASE_URL
    ?? 'https://copilot.logic.heiyu.space/providers/tuzi/v1';
}

/** env / 常量兜底(DB 无行或读失败时用) */
function fallbackConfig(): ImageGenConfig {
  const envModel = process.env.TUZI_DEFAULT_MODEL?.trim();
  if (envModel) return { defaultTuziModel: envModel, source: 'env' };
  return { defaultTuziModel: LIVE_DEFAULT_MODEL, source: 'fallback' };
}

/** DB 配置缓存(只缓存 DB 命中结果;兜底不缓存,避免瞬时故障被钉住 30s) */
let configCache: { config: ImageGenConfig; expiresAt: number } | null = null;

/** 上游可出图模型目录缓存(同样只缓存成功结果) */
let catalogCache: { models: string[]; expiresAt: number } | null = null;

/** 读 DB 设置行;无行 / 读失败返回 null(调用方降级到 env / 常量) */
async function readConfigFromDb(db: PostgresDatabase): Promise<ImageGenConfig | null> {
  try {
    const r = await db.getPool().query(
      'SELECT default_tuzi_model FROM image_gen_settings WHERE id = $1',
      [SETTINGS_ROW_ID]
    );
    const model: unknown = r.rows[0]?.default_tuzi_model;
    if (typeof model === 'string' && model.trim()) {
      return { defaultTuziModel: model.trim(), source: 'db' };
    }
    return null;
  } catch (e) {
    console.warn(`⚠️ image_gen_settings 读取失败,回退默认模型: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 读当前出图默认模型配置(三级回退 DB → env TUZI_DEFAULT_MODEL → LIVE_DEFAULT_MODEL,30s 缓存)。
 * source 供管理 API 观测配置实际生效层级。
 */
export async function getImageGenConfig(db: PostgresDatabase): Promise<ImageGenConfig> {
  if (configCache && configCache.expiresAt > Date.now()) return configCache.config;

  const fromDb = await readConfigFromDb(db);
  if (fromDb) {
    configCache = { config: fromDb, expiresAt: Date.now() + CACHE_TTL_MS };
    return fromDb;
  }
  return fallbackConfig();
}

/** 便利封装:只要模型串(调用点用) */
export async function getDefaultTuziModel(db: PostgresDatabase): Promise<string> {
  return (await getImageGenConfig(db)).defaultTuziModel;
}

/**
 * 写默认模型(upsert —— 这里 DO UPDATE 是对的,正是「后台改配置」的落点),并清缓存立即生效。
 * 调用方(管理 API)负责先校验模型 ID 在上游可出图目录内;本函数不做网络校验。
 */
export async function setDefaultTuziModel(db: PostgresDatabase, model: string): Promise<void> {
  await db.getPool().query(
    `INSERT INTO image_gen_settings (id, default_tuzi_model, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET
       default_tuzi_model = EXCLUDED.default_tuzi_model,
       updated_at = now()`,
    [SETTINGS_ROW_ID, model]
  );
  invalidateImageGenConfigCache();
}

/**
 * 拉上游 TuZi 实时可出图模型目录,返回 `tuzi:<id>` 列表。
 * 过滤掉仅 OpenAI-Chat 的 -count 变体(它们出现但不可出图)。
 * 上游不可用 / 非 2xx / 解析失败一律返回空列表(调用方降级),且不缓存失败结果。
 */
export async function fetchUpstreamTuziModels(): Promise<string[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models;

  try {
    const res = await fetch(`${tuziBaseUrl()}/models`, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: any = await res.json();
    const raw: unknown[] = Array.isArray(body?.data) ? body.data : [];
    const models = raw
      .filter(isImageCapableEntry)
      .map((e: any) => `tuzi:${String(e.id)}`);
    catalogCache = { models, expiresAt: Date.now() + CACHE_TTL_MS };
    return models;
  } catch (e) {
    console.warn(`⚠️ TuZi 上游模型目录拉取失败: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** 单条上游目录条目是否可出图(endpoint 类型与图像集有交集) */
function isImageCapableEntry(entry: unknown): boolean {
  const types = (entry as any)?.supported_endpoint_types;
  if (!Array.isArray(types) || !(entry as any)?.id) return false;
  return types.some((t) => IMAGE_ENDPOINT_TYPES.has(String(t)));
}

/** 手动清缓存:配置或目录变更后调用 */
export function invalidateImageGenConfigCache(): void {
  configCache = null;
  catalogCache = null;
}
