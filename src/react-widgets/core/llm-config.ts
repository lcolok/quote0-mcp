import { PostgresDatabase } from './postgres-database.js';

export interface ActiveLLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiType: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** 同步 fallback，用于构造时等无法 await 的场景 */
export function getFallbackLLMConfig(): ActiveLLMConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o',
    apiType: 'openai-completions',
  };
}

let cache: { config: ActiveLLMConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * 读取当前 active LLM 配置（30s 缓存）
 * fallback: 若 DB 为空，使用 process.env.LLM_* */
export async function getActiveLLMConfig(db: PostgresDatabase): Promise<ActiveLLMConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.config;

  const result = await db.getPool().query(`
    SELECT p.base_url, p.api_key, p.api_type, m.model_id, m.context_window, m.max_tokens
    FROM llm_active_setting s
    JOIN llm_providers p ON p.id = s.active_provider_id
    JOIN llm_models m ON m.id = s.active_model_id
    WHERE s.id = 1
  `);

  let config: ActiveLLMConfig;
  if (result.rows.length === 0) {
    config = getFallbackLLMConfig();
  } else {
    const row = result.rows[0];
    config = {
      baseUrl: row.base_url,
      apiKey: row.api_key,
      model: row.model_id,
      apiType: row.api_type,
      contextWindow: row.context_window,
      maxTokens: row.max_tokens,
    };
  }

  cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

/** 手动清缓存，UI 切换 active 后调用 */
export function invalidateLLMConfigCache(): void {
  cache = null;
}
