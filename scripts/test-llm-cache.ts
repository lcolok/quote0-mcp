/**
 * LLM 调用缓存测试脚本
 * 测试 4 个场景：缓存命中、缓存隔离、缓存统计、数据库连接
 *
 * 用法: bun run scripts/test-llm-cache.ts
 * 前提: 本地 PG 容器已启动（docker-compose up -d postgres）
 */

import { Pool } from 'pg';
import { LLMCallCache } from '../src/react-widgets/core/llm-call-cache.js';
import { createHash } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://quote0_user:quote0_password@localhost:25432/quote0_cache';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ ${msg}`);
    failed++;
  }
}

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_call_cache (
        cache_key VARCHAR(64) PRIMARY KEY,
        model VARCHAR(100) NOT NULL,
        prompt_preview TEXT,
        response TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_hit_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_call_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_llm_cache_model_lasthit ON llm_call_cache(model, last_hit_at DESC);
  `);
}

async function cleanTable(pool: Pool) {
  await pool.query('DELETE FROM llm_call_cache');
}

async function testCacheHit(cache: LLMCallCache) {
  console.log('\n📋 Test 1: Cache hit path');
  const key = { prompt: 'Hello world test prompt', model: 'test-model', temperature: 0.5 };

  const miss = await cache.get(key);
  assert(miss === null, 'First call should be cache miss (null)');

  await cache.set(key, 'cached response text', 100, 50);

  const hit = await cache.get(key);
  assert(hit !== null, 'Second call should be cache hit');
  assert(hit!.response === 'cached response text', 'Cached response matches');
  assert(hit!.tokensIn === 100, 'tokens_in preserved');
  assert(hit!.tokensOut === 50, 'tokens_out preserved');
}

async function testCacheIsolation(cache: LLMCallCache) {
  console.log('\n📋 Test 2: Cache isolation (same prompt, different model)');
  const prompt = 'Shared prompt text for isolation test';

  await cache.set({ prompt, model: 'model-A' }, 'response-from-A', 10, 5);
  await cache.set({ prompt, model: 'model-B' }, 'response-from-B', 20, 8);

  const hitA = await cache.get({ prompt, model: 'model-A' });
  const hitB = await cache.get({ prompt, model: 'model-B' });

  assert(hitA !== null, 'Model A entry exists');
  assert(hitB !== null, 'Model B entry exists');
  assert(hitA!.response === 'response-from-A', 'Model A returns correct response');
  assert(hitB!.response === 'response-from-B', 'Model B returns correct response');
}

async function testCacheStats(cache: LLMCallCache, pool: Pool) {
  console.log('\n📋 Test 3: Cache stats with 100 mock calls');
  await cleanTable(pool);

  // Simulate 100 calls: 30 unique prompts, some called multiple times
  const prompts: string[] = [];
  for (let i = 0; i < 30; i++) {
    prompts.push(`mock-news-title-${i} with some content`);
  }

  let setCount = 0;
  let getCount = 0;

  // First pass: 100 calls (will set cache for new prompts)
  for (let i = 0; i < 100; i++) {
    const prompt = prompts[i % 30];
    const key = { prompt, model: 'mock-model' };
    const cached = await cache.get(key);
    if (cached) {
      getCount++;
    } else {
      await cache.set(key, `response-${i}`, 50, 20);
      setCount++;
    }
  }

  const stats = await cache.stats();
  assert(stats.totalEntries === 30, `30 unique cache entries (got ${stats.totalEntries})`);
  assert(stats.hitCount >= 70, `At least 70 cache hits (got ${stats.hitCount})`);
  assert(stats.avgHits > 1, `Average hits per entry > 1 (got ${stats.avgHits.toFixed(2)})`);
  console.log(`   📊 Stats: entries=${stats.totalEntries}, hits=${stats.hitCount}, avgHits=${stats.avgHits.toFixed(2)}`);
}

async function testDatabaseConnection(pool: Pool) {
  console.log('\n📋 Test 4: Database connection');
  try {
    const result = await pool.query('SELECT NOW() as ts');
    assert(result.rows.length === 1, 'Database connection works');
    console.log(`   🕐 Server time: ${result.rows[0].ts}`);
  } catch (e) {
    assert(false, `Database connection failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function testCacheKeyDeterminism() {
  console.log('\n📋 Test 5: Cache key determinism');
  const key1 = { prompt: 'test prompt', model: 'model', temperature: 0.3 };
  const key2 = { prompt: 'test prompt', model: 'model', temperature: 0.3 };
  const hash1 = LLMCallCache.generateCacheKey(key1);
  const hash2 = LLMCallCache.generateCacheKey(key2);
  assert(hash1 === hash2, 'Same inputs produce same cache key');

  const key3 = { prompt: 'test prompt', model: 'model', temperature: 0.7 };
  const hash3 = LLMCallCache.generateCacheKey(key3);
  assert(hash1 !== hash3, 'Different temperature produces different key');

  const key4 = { prompt: 'test prompt', model: 'other-model', temperature: 0.3 };
  const hash4 = LLMCallCache.generateCacheKey(key4);
  assert(hash1 !== hash4, 'Different model produces different key');
}

async function main() {
  console.log('🧪 LLM Call Cache Test Suite');
  console.log(`📡 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    await testDatabaseConnection(pool);
    await ensureTable(pool);
    await cleanTable(pool);

    const cache = new LLMCallCache(pool, { defaultTTLMs: 60_000 });

    await testCacheKeyDeterminism();
    await testCacheHit(cache);
    await testCacheIsolation(cache);
    await testCacheStats(cache, pool);

    await cleanTable(pool);
  } catch (e) {
    console.error('\n💥 Test crashed:', e instanceof Error ? e.message : e);
    failed++;
  } finally {
    await pool.end();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
