/**
 * LLM 多端点 fallback 链单元测试。
 *
 * 覆盖任务书验证要求：
 *  ① active 成功 → 链不动
 *  ② active 失败 → 备1(longcat) 成功，元数据记 longcat/LongCat-2.0，且无 degraded
 *  ③ active + 备1 失败 → 备2(deepseek) 成功
 *  ④ 全败 → 抛首跳(active)原始错误，交由既有 passthrough 接管
 *  ⑤ 缓存键含 model（LLMCallCache.generateCacheKey）锁死：换 model 不误命中
 *  ⑥ deepseek-v4-flash 返回 reasoning_content：现有解析只取 choices[].message.content
 *
 * 端点真实连通性不在测试里打（网关是生产资源，部署后由编排官实弹验证）。
 */

import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import {
  getLLMConfigCandidates,
  runWithLLMFallbackChain,
  invalidateLLMConfigCache,
  type LLMRuntimeConfig,
} from './llm-config.js';
import { LLMCallCache } from './llm-call-cache.js';

// ---------------------------------------------------------------------------
// ①~④：runWithLLMFallbackChain 行为
// ---------------------------------------------------------------------------
describe('runWithLLMFallbackChain — 一条新闻一次链', () => {
  const candidates: LLMRuntimeConfig[] = [
    { providerSlug: 'siliconflow', baseUrl: 'u-active', apiKey: 'k', model: 'M-active', apiType: 'openai-completions' },
    { providerSlug: 'longcat', baseUrl: 'u-longcat', apiKey: 'k', model: 'LongCat-2.0', apiType: 'openai-completions' },
    { providerSlug: 'deepseek', baseUrl: 'u-deepseek', apiKey: 'k', model: 'deepseek-v4-flash', apiType: 'openai-completions' },
  ];

  it('① active 成功 → 链不动，used=active，attempt 仅被调用一次', async () => {
    const calls: string[] = [];
    const r = await runWithLLMFallbackChain(candidates, async (cfg) => {
      calls.push(cfg.providerSlug);
      return `ok:${cfg.model}`;
    });
    expect(calls).toEqual(['siliconflow']);
    expect(r.used.providerSlug).toBe('siliconflow');
    expect(r.result).toBe('ok:M-active');
    expect(r.firstError).toBeNull();
  });

  it('② active 失败 → 备1(longcat) 成功，返回 LongCat-2.0，attempt 调用两次', async () => {
    const calls: string[] = [];
    const r = await runWithLLMFallbackChain(candidates, async (cfg) => {
      calls.push(cfg.providerSlug);
      if (cfg.providerSlug === 'siliconflow') throw new Error('402 Insufficient Balance');
      return `ok:${cfg.model}`;
    });
    expect(calls).toEqual(['siliconflow', 'longcat']);
    expect(r.used.providerSlug).toBe('longcat');
    expect(r.used.model).toBe('LongCat-2.0');
    expect(r.result).toBe('ok:LongCat-2.0');
    // 命中备跳即成功，firstError 仅在全败抛错路径上非空
    expect(r.firstError).toBeNull();
  });

  it('③ active + 备1 失败 → 备2(deepseek) 成功，返回 deepseek-v4-flash', async () => {
    const calls: string[] = [];
    const r = await runWithLLMFallbackChain(candidates, async (cfg) => {
      calls.push(cfg.providerSlug);
      if (cfg.providerSlug !== 'deepseek') throw new Error(`${cfg.providerSlug} down`);
      return `ok:${cfg.model}`;
    });
    expect(calls).toEqual(['siliconflow', 'longcat', 'deepseek']);
    expect(r.used.providerSlug).toBe('deepseek');
    expect(r.used.model).toBe('deepseek-v4-flash');
    expect(r.result).toBe('ok:deepseek-v4-flash');
  });

  it('④ 全败 → 抛首跳(active)原始错误，不掩盖归因', async () => {
    let threw = false;
    let msg = '';
    try {
      await runWithLLMFallbackChain(candidates, async (cfg) => {
        throw new Error(`${cfg.providerSlug} failed`);
      });
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }
    expect(threw).toBe(true);
    // 冒泡的是 active 首跳错误（而非最后一跳），归因不被掩盖
    expect(msg).toBe('siliconflow failed');
  });

  it('每跳失败有 console.warn，且含 下一跳 provider/model 与原因摘要', async () => {
    const warns: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: any[]) => warns.push(a.map(String).join(' '));
    try {
      await runWithLLMFallbackChain(candidates, async (cfg) => {
        if (cfg.providerSlug !== 'deepseek') throw new Error('boom');
        return 'x';
      });
    } finally {
      console.warn = realWarn;
    }
    // 跳1→跳2、跳2→跳3 各一条 warn，跳3 成功无 warn
    expect(warns.filter((w) => w.includes('→')).length).toBe(2);
    expect(warns.some((w) => w.includes('longcat/LongCat-2.0') && w.includes('原因'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLLMConfigCandidates 顺序：active 优先 + chain priority 升序，去重
// ---------------------------------------------------------------------------
describe('getLLMConfigCandidates — active 优先 + 链顺序 + 去重', () => {
  beforeEach(() => invalidateLLMConfigCache());
  function makeDb(activeModel: string, chainRows: Array<[string, string, string]>, activeBase = 'u-active') {
    return {
      getPool: () => ({
        query: async (sql: string) => {
          // fallback 链（含 provider_slug 选择，但带 llm_fallback_chain）
          if (sql.includes('llm_fallback_chain')) {
            return {
              rows: chainRows.map(([slug, base, model]) => ({
                provider_slug: slug, base_url: base, api_key: 'k', api_type: 'openai-completions',
                model_id: model, context_window: 64000, max_tokens: 8192,
              })),
            };
          }
          // active slug（第二条 join 查 slug，唯一带 provider_slug 且不带 llm_fallback_chain）
          if (sql.includes('provider_slug')) {
            return { rows: [{ provider_slug: 'siliconflow' }] };
          }
          // active 配置（llm_active_setting join，含 model 行）
          if (sql.includes('llm_active_setting')) {
            return {
              rows: [
                {
                  base_url: activeBase, api_key: 'k', api_type: 'openai-completions',
                  model_id: activeModel, context_window: 64000, max_tokens: 8192,
                },
              ],
            };
          }
          // fallback 链
          if (sql.includes('llm_fallback_chain c')) {
            return {
              rows: chainRows.map(([slug, base, model]) => ({
                provider_slug: slug, base_url: base, api_key: 'k', api_type: 'openai-completions',
                model_id: model, context_window: 64000, max_tokens: 8192,
              })),
            };
          }
          return { rows: [] };
        },
      }),
    } as any;
  }

  it('active=siliconflow(dead) + 链[longcat, deepseek] → 顺序正确且 active 在首', async () => {
    const db = makeDb('deepseek-ai/DeepSeek-V3', [
      ['longcat', 'u-longcat', 'LongCat-2.0'],
      ['deepseek', 'u-deepseek', 'deepseek-v4-flash'],
    ]);
    const c = await getLLMConfigCandidates(db);
    expect(c.map((x) => x.providerSlug)).toEqual(['siliconflow', 'longcat', 'deepseek']);
    expect(c[1].model).toBe('LongCat-2.0');
    expect(c[2].model).toBe('deepseek-v4-flash');
  });

  it('链中某跳与 active 撞 (baseUrl+model) → 去重，不重复试同一死端点', async () => {
    const db = makeDb('LongCat-2.0', [
      ['longcat', 'u-longcat', 'LongCat-2.0'], // 与 active 撞
      ['deepseek', 'u-deepseek', 'deepseek-v4-flash'],
    ], 'u-longcat');
    const c = await getLLMConfigCandidates(db);
    expect(c.map((x) => x.providerSlug)).toEqual(['siliconflow', 'deepseek']);
  });
});

// ---------------------------------------------------------------------------
// ⑤ LLMCallCache 键含 model：fallback 换模型后不会误命中旧 provider 响应
// ---------------------------------------------------------------------------
describe('LLMCallCache.generateCacheKey — 含 model 隔离', () => {
  it('同 prompt 不同 model → 不同键（防 fallback 误命中）', () => {
    const a = LLMCallCache.generateCacheKey({ prompt: 'P', model: 'LongCat-2.0', temperature: 0.3 });
    const b = LLMCallCache.generateCacheKey({ prompt: 'P', model: 'deepseek-v4-flash', temperature: 0.3 });
    expect(a).not.toBe(b);
  });

  it('同 prompt 同 model → 同键（可正常命中）', () => {
    const a = LLMCallCache.generateCacheKey({ prompt: 'P', model: 'LongCat-2.0', temperature: 0.3 });
    const b = LLMCallCache.generateCacheKey({ prompt: 'P', model: 'LongCat-2.0', temperature: 0.3 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// ⑥ deepseek-v4-flash 返回 reasoning_content：解析只取 content
// ---------------------------------------------------------------------------
describe('reasoning_content 被忽略（只取 choices[].message.content）', () => {
  afterEach(() => {
    mock.restore();
  });

  it('mock openai 返回 reasoning_content，产物标题/正文来自 content', async () => {
    const { OpenAI } = require('openai') as any;
    const createMock = mock(async () => ({
      choices: [{ message: { content: 'REAL_CONTENT', reasoning_content: 'HIDDEN_THINK' } }],
    }));
    mock.module('openai', () => ({
      OpenAI: class {
        chat = { completions: { create: createMock } };
      },
    }));

    const { AxOptimizedNewsProcessorSimplified } = await import(
      '../services/ax-optimized-news-processor-simplified.js'
    );
    const proc: any = new AxOptimizedNewsProcessorSimplified({
      apiKey: 'dummy', baseURL: 'u', model: 'deepseek-v4-flash',
    });
    // 注入最小可用优化程序（绕过文件读取）
    proc.loadFromModelData({
      version: 'test',
      programs: {
        titleProgram: { instruction: 't', demos: [], modelConfig: { temperature: 0.3 }, stats: { accuracy: 0.9 } },
        summaryProgram: { instruction: 's', demos: [], modelConfig: { temperature: 0.5 }, stats: { accuracy: 0.9 } },
      },
    } as any);

    const out = await proc.processNewsWithOptimizedProgram('新闻内容');
    expect(out.title).toBe('REAL_CONTENT');
    expect(out.body).toBe('REAL_CONTENT');
    expect(out.title).not.toContain('HIDDEN_THINK');
  });
});
