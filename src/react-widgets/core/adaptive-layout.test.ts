import { describe, expect, test } from 'bun:test';
import {
  ADAPTIVE_LAYOUT_VERSION,
  createAdaptiveTextCardDocument,
  deriveAdaptiveDensity,
  estimateWrappedLines,
  planAdaptiveLayout,
} from './adaptive-layout.js';
import {
  EINK_296X128_TARGET,
  EINK_TARGET,
  LABEL_T20X8_TARGET,
  LABEL_T40X20_TARGET,
  type RenderTarget,
} from './render-targets.js';

const content = {
  id: 'neuromancer-mcp-stateless',
  eyebrow: 'NEUROMANCER · RESEARCH',
  title: 'MCP 新规范取消会话',
  body: '新规范移除协议层会话与初始化握手，并加入 Mcp-Method、Mcp-Name 等自描述请求头，让网关更容易路由、限流与计量。',
  footer: 'MCP 官方规范 · Quote0',
};

const runtimeT50x30: RenderTarget = {
  id: 'thermal-runtime-T50x30-400x240',
  kind: 'thermal-label',
  widthPx: 400,
  heightPx: 240,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 50, heightMm: 30 },
  defaultFontStack: ['smiley-sans'],
};

describe('Adaptive Layout Framework v1', () => {
  test('derives density from runtime geometry rather than target names', () => {
    expect(deriveAdaptiveDensity(LABEL_T20X8_TARGET)).toBe('micro');
    expect(deriveAdaptiveDensity(EINK_296X128_TARGET)).toBe('compact');
    expect(deriveAdaptiveDensity(EINK_TARGET)).toBe('standard');
    expect(deriveAdaptiveDensity(LABEL_T40X20_TARGET)).toBe('standard');
    expect(deriveAdaptiveDensity(runtimeT50x30)).toBe('comfortable');
  });

  test('turns one semantic document into different auditable layout plans', () => {
    const document = createAdaptiveTextCardDocument(content);
    const plans = [
      LABEL_T20X8_TARGET,
      EINK_296X128_TARGET,
      EINK_TARGET,
      LABEL_T40X20_TARGET,
      runtimeT50x30,
    ].map((target) => planAdaptiveLayout(document, target));

    expect(plans.every((plan) => plan.version === ADAPTIVE_LAYOUT_VERSION)).toBe(true);
    expect(plans.every((plan) => plan.documentId === content.id)).toBe(true);
    expect(plans.every((plan) => plan.nodes.find((node) => node.id === 'title')?.visible)).toBe(true);
    expect(plans.every((plan) => plan.nodes.find((node) => node.id === 'body')?.visible)).toBe(true);
    expect(plans.every((plan) => !plan.overflowRisk)).toBe(true);

    const micro = plans[0];
    expect(micro.density).toBe('micro');
    expect(micro.hiddenNodeIds).toContain('eyebrow');
    expect(micro.hiddenNodeIds).toContain('footer');
    expect(micro.nodes.find((node) => node.id === 'title')?.clampLines).toBe(1);
    expect(micro.nodes.find((node) => node.id === 'body')?.clampLines).toBeLessThanOrEqual(2);

    const compact = plans[1];
    expect(compact.density).toBe('compact');
    expect(compact.hiddenNodeIds).toContain('eyebrow');
    expect(compact.nodes.find((node) => node.id === 'title')?.clampLines).toBeLessThanOrEqual(2);
    expect(compact.nodes.find((node) => node.id === 'body')?.clampLines).toBeLessThanOrEqual(3);

    const comfortable = plans[4];
    expect(comfortable.density).toBe('comfortable');
    expect(comfortable.visibleNodeIds).toContain('eyebrow');
    expect(comfortable.visibleNodeIds).toContain('footer');
    expect(comfortable.nodes.find((node) => node.id === 'body')?.clampLines).toBeGreaterThanOrEqual(2);
  });

  test('estimates CJK and ASCII wrapping without a browser renderer', () => {
    const cjk = estimateWrappedLines('同一份内容自动适配不同尺寸的墨水屏和热敏纸', 120, 12);
    const ascii = estimateWrappedLines('same adaptive content across multiple targets', 120, 12);
    expect(cjk).toBeGreaterThanOrEqual(2);
    expect(ascii).toBeGreaterThanOrEqual(2);
  });

  test('honors node constraints while keeping critical content above optional footer', () => {
    const document = createAdaptiveTextCardDocument(content);
    const body = document.nodes.find((node) => node.role === 'body')!;
    body.constraints = { minLines: 1, preferredLines: 6, priority: 'high', optional: false };
    const footer = document.nodes.find((node) => node.role === 'footer')!;
    footer.constraints = { minLines: 0, preferredLines: 1, priority: 'low', optional: true };

    const plan = planAdaptiveLayout(document, LABEL_T20X8_TARGET);
    expect(plan.nodes.find((node) => node.id === 'title')?.visible).toBe(true);
    expect(plan.nodes.find((node) => node.id === 'body')?.visible).toBe(true);
    expect(plan.nodes.find((node) => node.id === 'body')?.clampLines).toBeGreaterThanOrEqual(1);
    expect(plan.nodes.find((node) => node.id === 'footer')?.visible).toBe(false);
  });
});
