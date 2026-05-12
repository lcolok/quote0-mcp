import { createCanvas, loadImage } from 'canvas';

async function analyzeImage(path: string, name: string) {
  console.log(`\n🔍 分析 ${name}: ${path}`);
  
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  
  console.log(`  尺寸: ${image.width} x ${image.height}`);
  
  // 分析标题区域 (顶部黑色banner)
  const titleRegion = ctx.getImageData(6, 4, 200, 30);
  const titlePixels = titleRegion.data;
  
  let titleWhitePixels = 0;
  let titleBlackPixels = 0;
  let titleGrayPixels = 0;
  
  for (let i = 0; i < titlePixels.length; i += 4) {
    const r = titlePixels[i];
    const g = titlePixels[i + 1];
    const b = titlePixels[i + 2];
    
    if (r > 200 && g > 200 && b > 200) {
      titleWhitePixels++;
    } else if (r < 50 && g < 50 && b < 50) {
      titleBlackPixels++;
    } else {
      titleGrayPixels++;
    }
  }
  
  console.log(`  标题区域分析:`);
  console.log(`    白色像素: ${titleWhitePixels} (${(titleWhitePixels / (titlePixels.length / 4) * 100).toFixed(1)}%)`);
  console.log(`    黑色像素: ${titleBlackPixels} (${(titleBlackPixels / (titlePixels.length / 4) * 100).toFixed(1)}%)`);
  console.log(`    灰色像素: ${titleGrayPixels} (${(titleGrayPixels / (titlePixels.length / 4) * 100).toFixed(1)}%)`);
  
  // 检查是否有抗锯齿（灰色边缘）
  if (titleGrayPixels > 10) {
    console.log(`    ⚠️ 检测到抗锯齿（灰色边缘）`);
  }
  
  // 分析内容区域
  const contentRegion = ctx.getImageData(6, 40, 200, 20);
  const contentPixels = contentRegion.data;
  
  let contentWhitePixels = 0;
  let contentBlackPixels = 0;
  let contentGrayPixels = 0;
  
  for (let i = 0; i < contentPixels.length; i += 4) {
    const r = contentPixels[i];
    const g = contentPixels[i + 1];
    const b = contentPixels[i + 2];
    
    if (r > 200 && g > 200 && b > 200) {
      contentWhitePixels++;
    } else if (r < 50 && g < 50 && b < 50) {
      contentBlackPixels++;
    } else {
      contentGrayPixels++;
    }
  }
  
  console.log(`  内容区域分析:`);
  console.log(`    白色像素: ${contentWhitePixels} (${(contentWhitePixels / (contentPixels.length / 4) * 100).toFixed(1)}%)`);
  console.log(`    黑色像素: ${contentBlackPixels} (${(contentBlackPixels / (contentPixels.length / 4) * 100).toFixed(1)}%)`);
  console.log(`    灰色像素: ${contentGrayPixels} (${(contentGrayPixels / (contentPixels.length / 4) * 100).toFixed(1)}%)`);
  
  if (contentGrayPixels > 10) {
    console.log(`    ⚠️ 检测到抗锯齿（灰色边缘）`);
  }
}

async function main() {
  console.log('🔬 渲染质量分析报告\n');
  
  await analyzeImage('comparison-results/puppeteer.png', 'Puppeteer');
  await analyzeImage('comparison-results/satori.png', 'Satori');
  
  console.log('\n💡 结论:');
  console.log('  如果灰色像素比例高，说明存在抗锯齿');
  console.log('  像素字体应该只有纯黑和纯白，没有灰色');
}

main().catch(console.error);
