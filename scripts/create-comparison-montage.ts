import { createCanvas, loadImage } from 'canvas';
import { writeFile } from 'fs/promises';

async function createMontage() {
  const puppeteer = await loadImage('comparison-results/puppeteer.png');
  const satori = await loadImage('comparison-results/satori.png');
  
  // 创建 2x2 布局的拼图
  const padding = 20;
  const labelHeight = 30;
  const width = puppeteer.width * 2 + padding * 3;
  const height = puppeteer.height * 2 + padding * 3 + labelHeight * 2;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // 白色背景
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, width, height);
  
  // 标题
  ctx.fillStyle = 'black';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Puppeteer vs Satori 渲染对比', padding, 20);
  
  // 左上：Puppeteer
  ctx.drawImage(puppeteer, padding, labelHeight);
  ctx.fillStyle = 'black';
  ctx.font = '12px sans-serif';
  ctx.fillText('Puppeteer (Chromium)', padding, labelHeight + puppeteer.height + 15);
  
  // 右上：Satori
  ctx.drawImage(satori, puppeteer.width + padding * 2, labelHeight);
  ctx.fillText('Satori (Yoga)', puppeteer.width + padding * 2, labelHeight + puppeteer.height + 15);
  
  // 左下：差异图
  const diff = await loadImage('comparison-results/diff-comparison.png');
  // 裁剪差异图的中间部分
  const diffCanvas = createCanvas(puppeteer.width, puppeteer.height);
  const diffCtx = diffCanvas.getContext('2d');
  diffCtx.drawImage(diff, puppeteer.width * 2, 0, puppeteer.width, puppeteer.height, 0, 0, puppeteer.width, puppeteer.height);
  
  ctx.drawImage(diffCanvas, padding, puppeteer.height + labelHeight + padding);
  ctx.fillText('差异可视化 (红色=不同)', padding, puppeteer.height * 2 + labelHeight + padding + 15);
  
  // 右下：叠加对比
  const overlayCanvas = createCanvas(puppeteer.width, puppeteer.height);
  const overlayCtx = overlayCanvas.getContext('2d');
  
  // 半透明叠加
  overlayCtx.globalAlpha = 0.5;
  overlayCtx.drawImage(puppeteer, 0, 0);
  overlayCtx.drawImage(satori, 0, 0);
  
  ctx.drawImage(overlayCanvas, puppeteer.width + padding * 2, puppeteer.height + labelHeight + padding);
  ctx.fillText('半透明叠加对比', puppeteer.width + padding * 2, puppeteer.height * 2 + labelHeight + padding + 15);
  
  // 保存
  const buffer = canvas.toBuffer('image/png');
  await writeFile('comparison-results/montage.png', buffer);
  console.log('✅ 拼图已保存: comparison-results/montage.png');
}

createMontage().catch(console.error);
