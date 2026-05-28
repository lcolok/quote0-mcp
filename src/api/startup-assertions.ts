/**
 * 启动后跑一轮断言，挡未发现的环境/配置错误。
 * 失败时只 console.warn，不阻断启动（让 fallback 路径仍有机会）。
 */
import { PostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../react-widgets/core/device-constants.js';
import { DECOMMISSIONED_RSS_SOURCES } from '../react-widgets/core/rss-source-policy.js';

export async function runStartupAssertions(postgres: PostgresDatabase): Promise<void> {
  console.log('🩺 启动断言开始...');

  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // 断言 1：LLM active config 可读 + 端点能 ping
  try {
    const llmCfg = await getActiveLLMConfig(postgres);
    if (!llmCfg.baseUrl || !llmCfg.apiKey || !llmCfg.model) {
      throw new Error(`active config 缺字段: baseUrl=${!!llmCfg.baseUrl} apiKey=${!!llmCfg.apiKey} model=${!!llmCfg.model}`);
    }
    // ping 一次 chat/completions（max_tokens=1）
    const pingUrl = llmCfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const pingResponse = await fetch(pingUrl, {
      method: 'POST',
      headers: {
        ...(llmCfg.apiKey && llmCfg.apiKey !== 'dummy' ? { 'Authorization': `Bearer ${llmCfg.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: llmCfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!pingResponse.ok) {
      throw new Error(`LLM ping HTTP ${pingResponse.status}: ${await pingResponse.text().catch(() => 'no body')}`);
    }
    results.push({ name: 'LLM active config 可达', ok: true, detail: `${llmCfg.model} @ ${llmCfg.baseUrl}` });
  } catch (e: any) {
    results.push({ name: 'LLM active config 可达', ok: false, detail: e?.message || String(e) });
  }

  // 断言 2：renderer 默认尺寸 == EINK 设备尺寸
  // 拿一张 satori 渲染默认参数生成的图，验证它的 PNG dimensions
  try {
    const { satoriRenderer } = await import('../react-widgets/core/satori-renderer.js');
    await satoriRenderer.initialize();
    const React = await import('react');
    const buf = await satoriRenderer.renderToImage(
      React.createElement('div', { style: { width: '100%', height: '100%', display: 'flex' } }, 'test'),
      {} // 不传 width/height，用默认值
    );
    // 解析 PNG header: bytes 16-19 = width (big-endian uint32), bytes 20-23 = height
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width !== EINK_DEVICE_WIDTH || height !== EINK_DEVICE_HEIGHT) {
      throw new Error(`satori 默认尺寸 ${width}x${height}, 期望 ${EINK_DEVICE_WIDTH}x${EINK_DEVICE_HEIGHT}`);
    }
    results.push({ name: 'satori 默认尺寸符合设备', ok: true, detail: `${width}x${height}` });
  } catch (e: any) {
    results.push({ name: 'satori 默认尺寸符合设备', ok: false, detail: e?.message || String(e) });
  }

  // 断言 3：所有 enabled job 必备字段非空
  try {
    const result = await postgres.getPool().query(`
      SELECT id FROM news_scheduler_jobs
      WHERE enabled = true
        AND (category IS NULL OR rss_source IS NULL OR data_source IS NULL OR processor IS NULL OR renderer IS NULL)
    `);
    if (result.rows.length > 0) {
      throw new Error(`${result.rows.length} 个 enabled job 关键字段为 NULL: ${result.rows.map(r => r.id).join(', ')}`);
    }
    results.push({ name: 'enabled jobs 字段完整', ok: true });
  } catch (e: any) {
    results.push({ name: 'enabled jobs 字段完整', ok: false, detail: e?.message || String(e) });
  }

  // 断言 4：没有 enabled job 的 rss_sources 仍引用已下线源
  try {
    if (DECOMMISSIONED_RSS_SOURCES.length === 0) {
      results.push({ name: '无 enabled job 引用已下线 RSS 源', ok: true, detail: '无已登记的下线源' });
    } else {
      const result = await postgres.getPool().query(`
        SELECT id, rss_sources
        FROM news_scheduler_jobs
        WHERE enabled = true
          AND rss_sources IS NOT NULL
          AND rss_sources ?| array[${DECOMMISSIONED_RSS_SOURCES.map(x => `'${x}'`).join(', ')}]
      `);
      if (result.rows.length > 0) {
        throw new Error(`${result.rows.length} 个 enabled job 仍引用已下线源: ${result.rows.map(r => r.id).join(', ')}`);
      }
      results.push({ name: '无 enabled job 引用已下线 RSS 源', ok: true });
    }
  } catch (e: any) {
    results.push({ name: '无 enabled job 引用已下线 RSS 源', ok: false, detail: e?.message || String(e) });
  }

  // 打印汇总
  console.log('🩺 启动断言结果:');
  for (const r of results) {
    const icon = r.ok ? '✅' : '⚠️';
    console.log(`  ${icon} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const failCount = results.filter(r => !r.ok).length;
  if (failCount > 0) {
    console.warn(`⚠️ 启动断言 ${failCount}/${results.length} 失败 — 服务继续启动，但请检查上述告警`);
  } else {
    console.log(`✅ 启动断言全部通过 (${results.length}/${results.length})`);
  }
}
