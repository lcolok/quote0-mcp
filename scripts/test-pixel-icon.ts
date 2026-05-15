/**
 * 验证 satori 是否支持 <img src="data:image/svg+xml;..."> 加载像素 SVG 图标
 * 12×12 像素晴天图标 → 缩放到 72×72 显示
 */

import React from 'react';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';

// 12×12 太阳图标：4×4 中心方块 + 8 条放射状光线
const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">
  <rect width="12" height="12" fill="#FFFFFF"/>
  <g fill="#000000">
    <!-- 4x4 中心实心 -->
    <rect x="4" y="4" width="4" height="4"/>
    <!-- 8 条光线：上下左右 + 4 对角 -->
    <rect x="5" y="0" width="2" height="2"/>
    <rect x="5" y="10" width="2" height="2"/>
    <rect x="0" y="5" width="2" height="2"/>
    <rect x="10" y="5" width="2" height="2"/>
    <rect x="1" y="1" width="1" height="1"/>
    <rect x="2" y="2" width="1" height="1"/>
    <rect x="10" y="1" width="1" height="1"/>
    <rect x="9" y="2" width="1" height="1"/>
    <rect x="1" y="10" width="1" height="1"/>
    <rect x="2" y="9" width="1" height="1"/>
    <rect x="10" y="10" width="1" height="1"/>
    <rect x="9" y="9" width="1" height="1"/>
  </g>
</svg>`;

const sunDataUri = `data:image/svg+xml;base64,${Buffer.from(SUN_SVG).toString('base64')}`;

const TestWidget = () => React.createElement('div', {
  style: {
    width: '100%', height: '100%', backgroundColor: '#FFFFFF',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px'
  }
}, [
  React.createElement('img', { key: 'sun-72', src: sunDataUri, width: 72, height: 72 }),
  React.createElement('img', { key: 'sun-48', src: sunDataUri, width: 48, height: 48 }),
  React.createElement('img', { key: 'sun-24', src: sunDataUri, width: 24, height: 24 })
]);

async function main() {
  await satoriRenderer.initialize();
  const buf = await satoriRenderer.renderToImage(
    React.createElement(TestWidget),
    { width: 296, height: 152, backgroundColor: '#FFFFFF' }
  );
  const fs = await import('fs');
  await fs.promises.writeFile('/tmp/test-pixel-sun.png', buf);
  console.log(`✅ Wrote /tmp/test-pixel-sun.png (${buf.length}B)`);
  await satoriRenderer.close();
}

main().catch(e => { console.error(e); process.exit(1); });
