import {
  createAdaptiveTextCardDocument,
  planAdaptiveLayout,
} from '../src/react-widgets/core/adaptive-layout.js';
import { renderAdaptiveDocumentWithSatori } from '../src/react-widgets/core/adaptive-satori-renderer.js';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';
import { EINK_TARGET } from '../src/react-widgets/core/render-targets.js';

const document = createAdaptiveTextCardDocument({
  id: 'satori-runtime-profile',
  eyebrow: 'NEUROMANCER · RESEARCH',
  title: 'MCP 新规范取消会话',
  body: 'MCP 新规范移除协议层会话与 initialize 握手，并加入 Mcp-Method、Mcp-Name 等自描述请求头，让网关更容易路由、限流与计量。',
  keyword: 'Mcp-Method · Mcp-Name',
  meta: '3 sources · 4 claims',
  footer: 'MCP 官方规范 · Quote0',
});

async function main() {
  const plan = planAdaptiveLayout(document, EINK_TARGET);
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (let i = 0; i < 3; i += 1) {
      const result = await renderAdaptiveDocumentWithSatori(document, EINK_TARGET, plan);
      rows.push({ iteration: i + 1, bytes: result.pngBuffer.length, metrics: result.metrics });
    }
  } finally {
    await satoriRenderer.close();
  }

  console.log(JSON.stringify({
    runtime: {
      node: process.version,
      bun: process.versions.bun ?? null,
      platform: process.platform,
      arch: process.arch,
    },
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
