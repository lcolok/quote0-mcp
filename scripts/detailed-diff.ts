import { createCanvas, loadImage } from 'canvas';

async function detailedDiff() {
  const pImg = await loadImage('comparison-results/puppeteer.png');
  const sImg = await loadImage('comparison-results/satori.png');
  
  const pCanvas = createCanvas(pImg.width, pImg.height);
  const sCanvas = createCanvas(sImg.width, sImg.height);
  
  const pCtx = pCanvas.getContext('2d');
  const sCtx = sCanvas.getContext('2d');
  
  pCtx.drawImage(pImg, 0, 0);
  sCtx.drawImage(sImg, 0, 0);
  
  const pData = pCtx.getImageData(0, 0, pImg.width, pImg.height).data;
  const sData = sCtx.getImageData(0, 0, sImg.width, sImg.height).data;
  
  console.log('🔍 逐行差异分析:\n');
  
  // 分析每一行的差异
  const rowDiffs: number[] = [];
  
  for (let y = 0; y < pImg.height; y++) {
    let rowDiff = 0;
    for (let x = 0; x < pImg.width; x++) {
      const offset = (y * pImg.width + x) * 4;
      if (pData[offset] !== sData[offset] || 
          pData[offset + 1] !== sData[offset + 1] || 
          pData[offset + 2] !== sData[offset + 2]) {
        rowDiff++;
      }
    }
    rowDiffs.push(rowDiff);
  }
  
  // 找出差异最大的行
  const maxDiffRow = rowDiffs.indexOf(Math.max(...rowDiffs));
  console.log(`最大差异行: Y=${maxDiffRow}, 差异像素=${rowDiffs[maxDiffRow]}`);
  
  // 显示差异分布
  console.log('\n📊 差异分布:');
  for (let y = 0; y < pImg.height; y += 10) {
    const diff = rowDiffs.slice(y, y + 10).reduce((a, b) => a + b, 0);
    const bar = '█'.repeat(Math.min(50, Math.floor(diff / 10)));
    console.log(`  Y=${y.toString().padStart(3)}-${(y+9).toString().padStart(3)}: ${diff.toString().padStart(4)} ${bar}`);
  }
  
  // 分析差异区域
  console.log('\n🎯 差异区域定位:');
  
  // 标题区域 (Y=0-35)
  const titleDiff = rowDiffs.slice(0, 36).reduce((a, b) => a + b, 0);
  console.log(`  标题区域 (Y=0-35): ${titleDiff} 像素差异`);
  
  // 内容区域 (Y=36-135)
  const contentDiff = rowDiffs.slice(36, 136).reduce((a, b) => a + b, 0);
  console.log(`  内容区域 (Y=36-135): ${contentDiff} 像素差异`);
  
  // 底部栏 (Y=136-151)
  const bottomDiff = rowDiffs.slice(136).reduce((a, b) => a + b, 0);
  console.log(`  底部栏 (Y=136-151): ${bottomDiff} 像素差异`);
  
  // 生成高亮差异图
  const diffCanvas = createCanvas(pImg.width, pImg.height);
  const diffCtx = diffCanvas.getContext('2d');
  
  // 复制原图
  diffCtx.drawImage(pImg, 0, 0);
  
  // 高亮差异区域
  const diffImageData = diffCtx.getImageData(0, 0, pImg.width, pImg.height);
  const diffPixels = diffImageData.data;
  
  for (let i = 0; i < pData.length; i += 4) {
    if (pData[i] !== sData[i] || 
        pData[i + 1] !== sData[i + 1] || 
        pData[i + 2] !== sData[i + 2]) {
      // 标记为红色
      diffPixels[i] = 255;
      diffPixels[i + 1] = 0;
      diffPixels[i + 2] = 0;
    }
  }
  
  diffCtx.putImageData(diffImageData, 0, 0);
  
  const fs = await import('fs');
  await fs.promises.writeFile('comparison-results/detailed-diff.png', diffCanvas.toBuffer('image/png'));
  console.log('\n✅ 详细差异图已保存: comparison-results/detailed-diff.png');
}

detailedDiff().catch(console.error);
