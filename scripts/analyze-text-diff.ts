import { createCanvas, loadImage } from 'canvas';

async function analyzeTextDiff() {
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
  
  console.log('🔍 文字渲染差异分析:\n');
  
  // 分析内容区域的每一行
  console.log('📏 内容区域逐行分析 (Y=40-135):');
  
  for (let y = 40; y < 136; y++) {
    let pBlackPixels = 0;
    let sBlackPixels = 0;
    let diffPixels = 0;
    
    for (let x = 0; x < pImg.width; x++) {
      const offset = (y * pImg.width + x) * 4;
      
      const pIsBlack = pData[offset] < 128;
      const sIsBlack = sData[offset] < 128;
      
      if (pIsBlack) pBlackPixels++;
      if (sIsBlack) sBlackPixels++;
      if (pIsBlack !== sIsBlack) diffPixels++;
    }
    
    if (diffPixels > 0) {
      console.log(`  Y=${y}: Puppeteer=${pBlackPixels}黑, Satori=${sBlackPixels}黑, 差异=${diffPixels}`);
    }
  }
  
  // 分析第一行差异
  console.log('\n🎯 第一行差异详情 (Y=50):');
  
  const y = 50;
  const pRow = [];
  const sRow = [];
  
  for (let x = 0; x < pImg.width; x++) {
    const offset = (y * pImg.width + x) * 4;
    pRow.push(pData[offset] < 128 ? '█' : ' ');
    sRow.push(sData[offset] < 128 ? '█' : ' ');
  }
  
  console.log('  Puppeteer: ' + pRow.join('').substring(0, 100) + '...');
  console.log('  Satori:    ' + sRow.join('').substring(0, 100) + '...');
  
  // 找出第一个差异位置
  for (let x = 0; x < pImg.width; x++) {
    const offset = (y * pImg.width + x) * 4;
    if (pData[offset] !== sData[offset]) {
      console.log(`\n  第一个差异位置: X=${x}`);
      console.log(`    Puppeteer: ${pData[offset] < 128 ? '黑' : '白'}`);
      console.log(`    Satori: ${sData[offset] < 128 ? '黑' : '白'}`);
      break;
    }
  }
}

analyzeTextDiff().catch(console.error);
