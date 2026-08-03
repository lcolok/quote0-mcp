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

/** fallback 链缓存（与 active 缓存同 TTL 模式，一并清） */
let chainCache: { configs: LLMRuntimeConfig[]; expiresAt: number } | null = null;

/** 运行时配置 + provider slug（供 fallback 链元数据 / 告警标记） */
export interface LLMRuntimeConfig extends ActiveLLMConfig {
  providerSlug: string;
}

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

/**
 * 读取 fallback 链（按 priority 升序，仅返回 enabled 的跳）。
 * 与 getActiveLLMConfig 共享 30s 缓存模式。
 * 链不含 active 本身——调用方应把 active 拼到链首（见 getLLMConfigCandidates）。
 */
export async function getLLMFallbackChain(db: PostgresDatabase): Promise<LLMRuntimeConfig[]> {
  if (chainCache && chainCache.expiresAt > Date.now()) return chainCache.configs;

  const result = await db.getPool().query(`
    SELECT p.slug AS provider_slug, p.base_url, p.api_key, p.api_type,
           m.model_id, m.context_window, m.max_tokens
    FROM llm_fallback_chain c
    JOIN llm_providers p ON p.id = c.provider_id
    JOIN llm_models m ON m.id = c.model_id
    WHERE c.enabled = true
    ORDER BY c.priority ASC
  `);

  const configs: LLMRuntimeConfig[] = result.rows.map((row: any) => ({
    providerSlug: row.provider_slug,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    model: row.model_id,
    apiType: row.api_type,
    contextWindow: row.context_window,
    maxTokens: row.max_tokens,
  }));

  chainCache = { configs, expiresAt: Date.now() + CACHE_TTL_MS };
  return configs;
}

/**
 * 拼接「active 优先 + fallback 链」的完整候选顺序。
 * 若 active 与链中某跳撞 (baseUrl+model)，链中重复跳会被去重（避免同端点试两次）。
 * 返回的第一项即当前 active；其后按 priority 顺序为备跳。
 */
export async function getLLMConfigCandidates(db: PostgresDatabase): Promise<LLMRuntimeConfig[]> {
  const active = await getActiveLLMConfig(db);
  const chain = await getLLMFallbackChain(db);

  // 解析 active 的真实 provider slug（供产物元数据观测），DB 为空则兜底 'active(env)'
  let activeSlug = 'active';
  try {
    const res = await db.getPool().query(`
      SELECT p.slug AS provider_slug
      FROM llm_active_setting s
      JOIN llm_providers p ON p.id = s.active_provider_id
      WHERE s.id = 1
    `);
    if (res.rows.length > 0) activeSlug = res.rows[0].provider_slug;
  } catch (e) { /* 保持兜底值 */ }

  const activeRuntime: LLMRuntimeConfig = {
    providerSlug: activeSlug,
    ...active,
  };

  const seen = new Set<string>([`${active.baseUrl}::${active.model}`]);
  const candidates: LLMRuntimeConfig[] = [activeRuntime];
  for (const hop of chain) {
    const key = `${hop.baseUrl}::${hop.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(hop);
  }
  return candidates;
}

/**
 * 单条新闻一次链：依次用 candidates 调 attempt（每跳只试一次），
 * 某跳成功即返回 { result, used, firstError: null }；
 * 全部失败抛出 firstError（即首跳/active 原始错误），由调用方既有 passthrough 降级接管。
 * 每跳失败 console.warn 一行：provider/model → 下一跳 provider/model, 原因摘要。
 */
export async function runWithLLMFallbackChain<T>(
  candidates: LLMRuntimeConfig[],
  attempt: (cfg: LLMRuntimeConfig) => Promise<T>,
): Promise<{ result: T; used: LLMRuntimeConfig; firstError: Error | null }> {
  if (candidates.length === 0) {
    throw new Error('LLM fallback：无可用配置（active 与链均为空）');
  }

  let firstError: Error | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const cfg = candidates[i];
    const next = candidates[i + 1];
    const label = `${cfg.providerSlug}/${cfg.model}`;
    try {
      const result = await attempt(cfg);
      if (i > 0) {
        console.warn(`🔀 LLM fallback 命中备跳: ${label} 成功（active 失败，已自动切换）`);
      } else {
        console.log(`✅ LLM active 命中: ${label}`);
      }
      return { result, used: cfg, firstError: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (i === 0) firstError = error;
      const reason = error.message.split('\n')[0].slice(0, 120);
      if (next) {
        console.warn(`⚠️ LLM ${label} 失败 → 下一跳 ${next.providerSlug}/${next.model}, 原因: ${reason}`);
      } else {
        console.warn(`⚠️ LLM ${label} 失败且无更多备跳, 原因: ${reason}`);
      }
    }
  }
  throw firstError ?? new Error('LLM fallback：所有候选均失败');
}

/** 手动清缓存，UI 切换 active 后调用（同时清链缓存） */
export function invalidateLLMConfigCache(): void {
  cache = null;
  chainCache = null;
}
