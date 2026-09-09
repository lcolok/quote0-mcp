import { afterAll, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { createAdaptiveTextCardDocument, planAdaptiveLayout } from './adaptive-layout.js';
import {
  adaptiveSatoriFontBaseSizes,
  renderAdaptiveDocumentWithSatori,
} from './adaptive-satori-renderer.js';
import { satoriRenderer } from './satori-renderer.js';
import { EINK_TARGET, LABEL_T20X8_TARGET } from './render-targets.js';

const document = createAdaptiveTextCardDocument({
  id: 'neuromancer-mcp-stateless',
  eyebrow: 'NEUROMANCER · RESEARCH',
  title: 'MCP 新规范取消会话',
  body: '新规范移除协议层会话与初始化握手，并加入 Mcp-Method、Mcp-Name 等自描述请求头。',
  keyword: 'Mcp-Method · Mcp-Name',
  meta: '3 sources · 4 claims',
  footer: 'MCP 官方规范 · Quote0',
});

afterAll(async () => {
  await satoriRenderer.close();
});

describe('Adaptive Satori renderer', () => {
  test('consumes the same renderer-neutral plan for micro and standard targets', async () => {
    for (const target of [LABEL_T20X8_TARGET, EINK_TARGET]) {
      const plan = planAdaptiveLayout(document, target);
      const result = await renderAdaptiveDocumentWithSatori(document, target, plan);
      const metadata = await sharp(result.pngBuffer).metadata();

      expect(result.layoutPlan).toBe(plan);
      expect(metadata.width).toBe(target.widthPx);
      expect(metadata.height).toBe(target.heightPx);
      expect(result.pngBuffer.length).toBeGreaterThan(100);
      expect(result.renderMs).toBeGreaterThan(0);
      expect(result.metrics.fontCount).toBe(adaptiveSatoriFontBaseSizes(plan).length);
      expect(result.metrics.satoriMs).toBeGreaterThan(0);
      expect(result.metrics.resvgMs).toBeGreaterThan(0);
    }
  });

  test('subsets the font payload to only families referenced by the plan', () => {
    const micro = planAdaptiveLayout(document, LABEL_T20X8_TARGET);
    const standard = planAdaptiveLayout(document, EINK_TARGET);
    expect(adaptiveSatoriFontBaseSizes(micro)).toEqual([8, 10]);
    expect(adaptiveSatoriFontBaseSizes(standard)).toEqual([8, 10, 12]);
  });

  test('rejects a plan from another target instead of silently stretching it', async () => {
    const wrongPlan = planAdaptiveLayout(document, EINK_TARGET);
    await expect(renderAdaptiveDocumentWithSatori(document, LABEL_T20X8_TARGET, wrongPlan)).rejects.toThrow(
      'does not match document/target identity',
    );
  });
});
