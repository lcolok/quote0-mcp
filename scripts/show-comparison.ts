import { createCanvas, loadImage } from 'canvas';
import { writeFile } from 'fs/promises';

async function showComparison() {
  const puppeteer = await loadImage('comparison-results/puppeteer.png');
  const satori = await loadImage('comparison-results/satori.png');
  
  // 创建并排对比图，放大2倍便于观察
  const scale = 2;
  const padding = 20;
  const labelHeight = 25;
  
  const width = (puppeteer.width * 2 + padding) * scale;
  const height = (puppeteer.height + labelHeight) * scale;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // 白色背景
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  
  // 放大绘制
  ctx.scale(scale, scale);
  
  // 左：Puppeteer
  ctx.drawImage(puppeteer, 0, labelHeight);
  ctx.fillStyle = 'black';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Puppeteer (Chromium)', 5, 18);
  
  // 右：Satori
  ctx.drawImage(satori, puppeteer.width + padding, labelHeight);
  ctx.fillText('Satori (Yoga)', puppeteer.width + padding + 5, 18);
  
  // 保存
  const buffer = canvas.toBuffer('image/png');
  await writeFile('comparison-results/side-by-side-2x.png', buffer);
  console.log('✅ 并排对比图已保存: comparison-results/side-by-side-2x.png');
}

showComparison().catch(console.error);
