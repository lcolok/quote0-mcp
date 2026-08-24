import { describe, expect, it } from 'bun:test';

const REGRESSION_SMOKE = String.raw`
import React from 'react';
import { SatoriNewsWidget } from './src/react-widgets/components/SatoriNewsWidget.tsx';
import { EINK_TARGET, EINK_800X480_TARGET } from './src/react-widgets/core/render-targets.ts';
import { satoriRenderer } from './src/react-widgets/core/satori-renderer.ts';
import { toHighlightedWords } from './src/react-widgets/core/rendering-modules.ts';
const message = 'MCP 2026-07-28 规范取消协议会话与 initialize 握手；请求须带 Mcp-Method 和 Mcp-Name 标头，网关无需解析正文即可路由、限流。';
const highlights = ['MCP 2026-07-28', '取消协议会话与 initialize 握手', 'Mcp-Method 和 Mcp-Name', '路由、限流'];
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
    expect(stdout).toContain('SATORI_HIGHLIGHT_REGRESSION_OK=');
    expect(stdout).toContain('SATORI_800X480_VECTOR_OK=');
  });
});
