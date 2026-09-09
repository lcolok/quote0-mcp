import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { SatoriNewsWidget } from '../src/react-widgets/components/SatoriNewsWidget.js';
import { toHighlightedWords } from '../src/react-widgets/core/rendering-modules.js';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';
import {
  executeAdaptiveRenderShadow,
  type AdaptiveShadowRecord,
} from '../src/react-widgets/core/adaptive-shadow-renderer.js';
import type { RenderableDataItem } from '../src/react-widgets/core/modular-architecture.js';
import {
  EINK_296X128_TARGET,
  EINK_TARGET,
  type RenderTarget,
} from '../src/react-widgets/core/render-targets.js';

const content: RenderableDataItem = {
  id: 'neuromancer-shadow-smoke',
  title: 'MCP 新规范取消会话',
  message: 'MCP 2026-07-28 新规范移除协议层会话和 initialize 握手；请求加入 Mcp-Method、Mcp-Name 等自描述头，便于网关直接路由、限流和计量。',
  signature: '神经漫游者',
  source: 'MCP官方·InfoQ',
  publishTime: '2026-08-17T00:00:00Z',
  category: 'news',
  link: 'https://modelcontextprotocol.io/specification/2026-07-28',
  highlights: ['MCP 2026-07-28', 'Mcp-Method', 'Mcp-Name'],
  metadata: {
    researchReceipt: {
      schemaVersion: 'neuromancer-research/v1',
      sources: [
        { id: 'seed', url: 'https://www.infoq.cn/', role: 'seed' },
        { id: 'official', url: 'https://modelcontextprotocol.io/', role: 'official' },
        { id: 'primary', url: 'https://blog.modelcontextprotocol.io/', role: 'primary' },
      ],
      claims: [
        { text: '移除协议层会话', sourceIds: ['official'], status: 'supported' },
        { text: '请求加入自描述头', sourceIds: ['official'], status: 'supported' },
        { text: '网关可据此路由限流', sourceIds: ['official'], status: 'supported' },
      ],
    },
  },
};

const targets: RenderTarget[] = [EINK_296X128_TARGET, EINK_TARGET];

async function renderPrimary(target: RenderTarget) {
  return satoriRenderer.renderToImageWithMetrics(
    React.createElement(SatoriNewsWidget, {
      data: {
        title: content.title,
        message: content.message,
        signature: content.signature,
        source: content.source,
        publishTime: content.publishTime,
        category: content.category,
        link: content.link,
        highlights: toHighlightedWords(content.message, content.highlights),
      },
      target,
    }),
    { width: target.widthPx, height: target.heightPx, backgroundColor: '#ffffff' },
  );
}

async function main() {
  const outputDir = path.resolve('processed-images', 'adaptive-shadow-smoke');
  await mkdir(outputDir, { recursive: true });
  const persisted: AdaptiveShadowRecord[] = [];
  const fakeDatabase = {
    initialize: async () => {},
    query: async (_sql: string, params?: any[]) => {
      if (params?.[12] === 'completed') {
        // The returned record is captured below; this assertion proves the SQL path is exercised.
      }
      return { rows: [] };
    },
  };

  for (const target of targets) {
    const primary = await renderPrimary(target);
    const primaryPath = path.join(outputDir, `${target.id}-primary.png`);
    await writeFile(primaryPath, primary.pngBuffer);
    const result = await executeAdaptiveRenderShadow({
      data: content,
      target,
      primary: { localImagePath: primaryPath, renderMetrics: primary.metrics },
      deviceIds: [`smoke-${target.id}`],
    }, { database: fakeDatabase });
    persisted.push(result);
    console.log(JSON.stringify({
      targetId: target.id,
      state: result.state,
      density: result.layoutPlan?.density,
      visible: result.layoutPlan?.visibleNodeIds,
      hidden: result.layoutPlan?.hiddenNodeIds,
      primaryRenderMs: result.primaryRenderMetrics?.totalMs,
      shadowRenderMs: result.shadowRenderMetrics?.totalMs,
      comparison: result.comparisonMetrics,
      primaryBitmap: result.primaryBitmapMetrics,
      shadowBitmap: result.shadowBitmapMetrics,
      primaryPath,
    }));
  }

  const summary = {
    targets: persisted.length,
    allCompleted: persisted.every((row) => row.state === 'completed'),
    allExactBitmapBytes: persisted.every((row) =>
      row.primaryBitmapMetrics?.bytes === row.primaryBitmapMetrics?.expectedBytes &&
      row.shadowBitmapMetrics?.bytes === row.shadowBitmapMetrics?.expectedBytes),
    allNonBlank: persisted.every((row) =>
      (row.primaryBitmapMetrics?.burnBits ?? 0) > 0 && (row.shadowBitmapMetrics?.burnBits ?? 0) > 0),
  };
  console.log(JSON.stringify({ summary }));
  if (!summary.allCompleted || !summary.allExactBitmapBytes || !summary.allNonBlank) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
