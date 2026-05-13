/**
 * LLM 调用层 prompt-hash 缓存
 * 基于 PostgreSQL 的持久化缓存，避免相同 prompt 重复调用 LLM
 */

import { createHash } from 'crypto';
import { Pool } from 'pg';

export interface LLMCacheKey {
  prompt: string;
  model: string;
  temperature?: number;
}

export interface LLMCacheResult {
  response: string;
  tokensIn?: number;
  tokensOut?: number;
}

export class LLMCallCache {
  private pool: Pool;
  private defaultTTLMs: number;

  constructor(pool: Pool, options?: { defaultTTLMs?: number }) {
    this.pool = pool;
    this.defaultTTLMs = options?.defaultTTLMs ?? 24 * 60 * 60 * 1000; // 24h
  }

  static generateCacheKey(key: LLMCacheKey): string {
    const raw = `${key.model}\x00${key.temperature ?? ''}\x00${key.prompt}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async get(key: LLMCacheKey): Promise<LLMCacheResult | null> {
    const cacheKey = LLMCallCache.generateCacheKey(key);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE llm_call_cache
         SET hit_count = hit_count + 1, last_hit_at = CURRENT_TIMESTAMP
         WHERE cache_key = $1 AND expires_at > NOW()
         RETURNING response, tokens_in, tokens_out`,
        [cacheKey]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        response: row.response,
        tokensIn: row.tokens_in ?? undefined,
        tokensOut: row.tokens_out ?? undefined,
      };
    } finally {
      client.release();
    }
  }

  async set(
    key: LLMCacheKey,
    response: string,
    tokensIn?: number,
    tokensOut?: number,
    ttlMs?: number
  ): Promise<void> {
    const cacheKey = LLMCallCache.generateCacheKey(key);
    const preview = key.prompt.substring(0, 200);
    const expiresAt = new Date(Date.now() + (ttlMs ?? this.defaultTTLMs));
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO llm_call_cache (cache_key, model, prompt_preview, response, tokens_in, tokens_out, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (cache_key) DO UPDATE SET
           response = EXCLUDED.response,
           tokens_in = EXCLUDED.tokens_in,
           tokens_out = EXCLUDED.tokens_out,
           expires_at = EXCLUDED.expires_at,
           last_hit_at = CURRENT_TIMESTAMP`,
        [cacheKey, key.model, preview, response, tokensIn ?? null, tokensOut ?? null, expiresAt]
      );
    } finally {
      client.release();
    }
  }

  async stats(): Promise<{ totalEntries: number; hitCount: number; avgHits: number }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as total_entries, COALESCE(SUM(hit_count), 0) as total_hits,
                COALESCE(AVG(hit_count), 0) as avg_hits
         FROM llm_call_cache WHERE expires_at > NOW()`
      );
      const row = result.rows[0];
      return {
        totalEntries: parseInt(row.total_entries, 10),
        hitCount: parseInt(row.total_hits, 10),
        avgHits: parseFloat(row.avg_hits),
      };
    } finally {
      client.release();
    }
  }
}
