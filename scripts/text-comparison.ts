import { createCanvas, loadImage } from 'canvas';
import { writeFile } from 'fs/promises';

async function textComparison() {
  const puppeteer = await loadImage('comparison-results/puppeteer.png');
  const satori = await loadImage('comparison-results/satori.png');
  
  const pCanvas = createCanvas(puppeteer.width, puppeteer.height);
  const sCanvas = createCanvas(satori.width, satori.height);
  
  const pCtx = pCanvas.getContext('2d');
  const sCtx = sCanvas.getContext('2d');
  
  pCtx.drawImage(puppeteer, 0, 0);
  sCtx.drawImage(satori, 0, 0);
  
  const pData = pCtx.getImageData(0, 0, puppeteer.width, puppeteer.height).data;
  const sData = sCtx.getImageData(0, 0, satori.width, satori.height).data;
  
  console.log('📖 文字内容对比:\n');
  console.log('=' .repeat(80));
  
  // 提取每一行的文字（简化表示）
  function extractLine(data: Uint8ClampedArray, y: number, width: number): string {
    let line = '';
    let inChar = false;
    let charWidth = 0;
    
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const isBlack = data[offset] < 128;
      
      if (isBlack && !inChar) {
        inChar = true;
        charWidth = 1;
      } else if (isBlack && inChar) {
        charWidth++;
      } else if (!isBlack && inChar) {
        inChar = false;
        line += charWidth > 6 ? '█' : '·';
      }
    }
    
    return line;
  }
  
  // 显示内容区域的每一行
  console.log('行号  | Puppeteer                    | Satori');
  console.log('-'.repeat(80));
  
  for (let y = 40; y < 136; y++) {
    const pLine = extractLine(pData, y, puppeteer.width);
    const sLine = extractLine(sData, y, satori.width);
    
    if (pLine.length > 0 || sLine.length > 0) {
      console.log(`${y.toString().padStart(3)}   | ${pLine.padEnd(30)} | ${sLine}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n💡 说明:');
  console.log('  █ = 较宽的字符（可能是汉字）');
  console.log('  · = 较窄的字符（可能是标点或字母）');
  console.log('  空行表示该位置没有文字');
}

textComparison().catch(console.error);
