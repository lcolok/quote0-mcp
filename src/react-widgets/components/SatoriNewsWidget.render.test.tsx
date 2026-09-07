import { describe, expect, it } from 'bun:test';
import { buildNewsFooterText } from './SatoriNewsWidget.js';

const REGRESSION_SMOKE = String.raw`
import React from 'react';
import { SatoriNewsWidget } from './src/react-widgets/components/SatoriNewsWidget.tsx';
import { EINK_TARGET, EINK_800X480_TARGET } from './src/react-widgets/core/render-targets.ts';
import { satoriRenderer } from './src/react-widgets/core/satori-renderer.ts';
import { toHighlightedWords } from './src/react-widgets/core/rendering-modules.ts';
const message = 'MCP 2026-07-28 规范取消协议会话与 initialize 握手；请求须带 Mcp-Method 和 Mcp-Name 标头，网关无需解析正文即可路由、限流。';
const highlights = ['MCP 2026-07-28', '取消协议会话与 initialize 握手', 'Mcp-Method 和 Mcp-Name', '路由、限流'];
const footerTree = SatoriNewsWidget({
  data: { title: 'UGA研究：蓝光最损害细节分辨力', message: '正文', signature: '神经漫游者', source: 'research.uga.edu' },
  target: EINK_TARGET,
});
const footerNode = footerTree?.props?.children?.[2];
const footerStyle = footerNode?.props?.style || {};
const footerTextStyle = footerNode?.props?.children?.props?.style || {};
if (footerStyle.height !== '16px' || footerStyle.boxSizing !== 'border-box' || footerStyle.flexShrink !== 0 || footerStyle.overflow !== 'hidden' || footerStyle.whiteSpace !== 'nowrap') {
  throw new Error('footer row contract regression: ' + JSON.stringify(footerStyle));
}
if (footerTextStyle.maxWidth !== '100%' || footerTextStyle.overflow !== 'hidden' || footerTextStyle.whiteSpace !== 'nowrap') {
  throw new Error('footer text contract regression: ' + JSON.stringify(footerTextStyle));
}
console.log('SATORI_FOOTER_ROW_CONTRACT_OK');
const png = await satoriRenderer.renderToImage(
  React.createElement(SatoriNewsWidget, {
    data: {
      title: 'MCP 新规范取消会话',
      message,
      signature: '神经漫游者',
      source: 'MCP官方·InfoQ',
      highlights: toHighlightedWords(message, highlights),
    },
    target: EINK_TARGET,
  }),
  { width: 296, height: 152, backgroundColor: '#ffffff' },
);
if (png.length <= 1000) throw new Error('unexpectedly small PNG: ' + png.length);
const sig = [...png.subarray(0, 8)].join(',');
if (sig !== '137,80,78,71,13,10,26,10') throw new Error('invalid PNG signature: ' + sig);
console.log('SATORI_HIGHLIGHT_REGRESSION_OK=' + png.length);
// 800x480 大屏：矢量字体（得意黑 + 普惠体 Regular 子集）必须真的被 Satori 加载并参与排版
const big = await satoriRenderer.renderToImage(
  React.createElement(SatoriNewsWidget, {
    data: { title: '国际计量大会拟用闰时替闰秒', message, signature: '', source: 'Solidot', highlights: [] },
    target: EINK_800X480_TARGET,
  }),
  { width: 800, height: 480, backgroundColor: '#ffffff' },
);
if (big.length <= 1000) throw new Error('unexpectedly small 800x480 PNG: ' + big.length);
console.log('SATORI_800X480_VECTOR_OK=' + big.length);
`;

describe('SatoriNewsWidget E-Ink provenance footer', () => {
  it('shows server-owned publisher and visible Neuromancer evidence identity', () => {
    expect(buildNewsFooterText({
      title: 'Bun 1.4',
      message: '正文',
      signature: '神经漫游者',
      source: 'InfoQ 中文',
      metadata: {
        displayProvenance: {
          publisher: { label: 'InfoQ 中文' },
          research: { agent: 'neuromancer', evidenceSourceCount: 3 },
        },
      },
    }, 80)).toBe('来源: InfoQ 中文 · Neuromancer研究·3证据源');
  });

  it('keeps aggregator discovery separate from the publisher', () => {
    expect(buildNewsFooterText({
      title: 'Meta AI Agent',
      message: '正文',
      signature: '神经漫游者',
      source: 'PCMag',
      metadata: {
        displayProvenance: {
          publisher: { label: 'PCMag' },
          discovery: { label: 'Hacker News' },
          research: { agent: 'neuromancer', evidenceSourceCount: 1 },
        },
      },
    }, 100)).toBe('来源: PCMag · via Hacker News · Neuromancer研究·1证据源');
  });

  it('uses a compact discovery label before dropping provenance on 296px-class footers', () => {
    expect(buildNewsFooterText({
      title: 'Meta AI Agent',
      message: '正文',
      signature: '神经漫游者',
      source: 'PCMag',
      metadata: {
        displayProvenance: {
          publisher: { label: 'PCMag' },
          discovery: { label: 'Hacker News' },
          research: { agent: 'neuromancer', evidenceSourceCount: 1 },
        },
      },
    }, 48)).toBe('来源: PCMag · via HN · Neuromancer·1证据源');
  });

  it('does not wrap the real delivery 366235 footer after Fusion Pixel full-width punctuation is accounted for', () => {
    expect(buildNewsFooterText({
      title: 'UGA研究：蓝光最损害细节分辨力',
      message: '正文',
      signature: '神经漫游者',
      source: 'research.uga.edu',
      metadata: {
        displayProvenance: {
          publisher: { label: 'research.uga.edu' },
          discovery: { label: 'Hacker News' },
          research: { agent: 'neuromancer', evidenceSourceCount: 1 },
        },
      },
    }, 48)).toBe('来源: research.uga.edu · Neuromancer·1证据源');
  });

  it('keeps non-Research cards compatible', () => {
    expect(buildNewsFooterText({
      title: '普通新闻',
      message: '正文',
      signature: 'RSS智能',
      source: 'Solidot',
    }, 40)).toBe('来源: Solidot');
  });

  it('hard-clamps a pathological long publisher instead of allowing footer overflow', () => {
    const footer = buildNewsFooterText({
      title: '长域名',
      message: '正文',
      signature: 'RSS智能',
      source: 'this-is-an-extremely-long-subdomain-that-cannot-fit.example.com',
    }, 24);
    expect(footer.endsWith('…')).toBe(true);
    expect(footer.length).toBeLessThan('来源: this-is-an-extremely-long-subdomain-that-cannot-fit.example.com'.length);
  });

});

describe('SatoriNewsWidget E-Ink highlight geometry', () => {
  it('renders the production Neuromancer multi-highlight payload in an isolated real Satori/resvg process', async () => {
    const child = Bun.spawn(['bun', '-e', REGRESSION_SMOKE], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('panicked');
    expect(stdout).toContain('SATORI_FOOTER_ROW_CONTRACT_OK');
    expect(stdout).toContain('SATORI_HIGHLIGHT_REGRESSION_OK=');
    expect(stdout).toContain('SATORI_800X480_VECTOR_OK=');
  });
});
