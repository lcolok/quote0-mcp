/**
 * 像素级对比测试
 * 比较 Puppeteer 和 Satori 渲染结果的差异
 */

import React from 'react';
import { createCanvas, loadImage } from 'canvas';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// 测试数据
const testData = {
  title: 'AI技术突破：新型语言模型在多个基准测试中表现优异',
  message: '研究人员最近发布了一款新型语言模型，该模型在多项基准测试中取得了显著进步。这一突破可能会改变我们对人工智能能力的认知，并为未来的AI应用开辟新的可能性。',
  signature: 'AI优化·Q95',
  source: 'RSS智能',
  publishTime: new Date().toISOString(),
  category: 'technology'
};

const RENDER_WIDTH = 296;
const RENDER_HEIGHT = 152;

interface PixelDiffResult {
  totalPixels: number;
  differentPixels: number;
  percentage: number;
  maxDifference: number;
  avgDifference: number;
  identicalRegions: number;
  similarRegions: number;
  differentRegions: number;
}

/**
 * 加载图片并获取像素数据
 */
async function getPixelData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

/**
 * 计算两个像素之间的差异
 */
function pixelDifference(p1: Uint8ClampedArray, p2: Uint8ClampedArray, offset: number): number {
  const r1 = p1[offset];
  const g1 = p1[offset + 1];
  const b1 = p1[offset + 2];
  const a1 = p1[offset + 3];
  
  const r2 = p2[offset];
  const g2 = p2[offset + 1];
  const b2 = p2[offset + 2];
  const a2 = p2[offset + 3];
  
  // 计算欧氏距离
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
    Math.pow(g1 - g2, 2) +
    Math.pow(b1 - b2, 2) +
    Math.pow(a1 - a2, 2)
  );
}

/**
 * 执行像素级对比
 */
async function compareImages(image1Path: string, image2Path: string): Promise<PixelDiffResult> {
  const data1 = await getPixelData(image1Path);
  const data2 = await getPixelData(image2Path);
  
  const pixels1 = data1.data;
  const pixels2 = data2.data;
  
  const totalPixels = data1.width * data1.height;
  let differentPixels = 0;
  let totalDifference = 0;
  let maxDifference = 0;
  
  // 统计区域差异
  const regionSize = 16; // 16x16 像素区域
  const regions = {
    identical: 0,
    similar: 0,
    different: 0
  };
  
  // 逐像素比较
  for (let i = 0; i < pixels1.length; i += 4) {
    const diff = pixelDifference(pixels1, pixels2, i);
    
    if (diff > 0) {
      differentPixels++;
      totalDifference += diff;
      maxDifference = Math.max(maxDifference, diff);
    }
  }
  
  // 区域分析
  const regionsX = Math.ceil(data1.width / regionSize);
  const regionsY = Math.ceil(data1.height / regionSize);
  
  for (let ry = 0; ry < regionsY; ry++) {
    for (let rx = 0; rx < regionsX; rx++) {
      let regionDiff = 0;
      let regionPixels = 0;
      
      const startX = rx * regionSize;
      const startY = ry * regionSize;
      const endX = Math.min(startX + regionSize, data1.width);
      const endY = Math.min(startY + regionSize, data1.height);
      
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const offset = (y * data1.width + x) * 4;
          regionDiff += pixelDifference(pixels1, pixels2, offset);
          regionPixels++;
        }
      }
      
      const avgRegionDiff = regionDiff / regionPixels;
      
      if (avgRegionDiff < 1) {
        regions.identical++;
      } else if (avgRegionDiff < 10) {
        regions.similar++;
      } else {
        regions.different++;
      }
    }
  }
  
  const totalRegions = regionsX * regionsY;
  
  return {
    totalPixels,
    differentPixels,
    percentage: (differentPixels / totalPixels) * 100,
    maxDifference,
    avgDifference: differentPixels > 0 ? totalDifference / differentPixels : 0,
    identicalRegions: regions.identical,
    similarRegions: regions.similar,
    differentRegions: regions.different
  };
}

/**
 * 生成差异可视化图片
 */
async function generateDiffImage(
  image1Path: string, 
  image2Path: string, 
  outputPath: string
): Promise<void> {
  const data1 = await getPixelData(image1Path);
  const data2 = await getPixelData(image2Path);
  
  const canvas = createCanvas(data1.width * 3, data1.height);
  const ctx = canvas.getContext('2d');
  
  // 绘制原图1
  const img1 = await loadImage(image1Path);
  ctx.drawImage(img1, 0, 0);
  
  // 绘制原图2
  const img2 = await loadImage(image2Path);
  ctx.drawImage(img2, data1.width, 0);
  
  // 生成差异图
  const diffCanvas = createCanvas(data1.width, data1.height);
  const diffCtx = diffCanvas.getContext('2d');
  const diffImageData = diffCtx.createImageData(data1.width, data1.height);
  
  const pixels1 = data1.data;
  const pixels2 = data2.data;
  const diffPixels = diffImageData.data;
  
  for (let i = 0; i < pixels1.length; i += 4) {
    const diff = pixelDifference(pixels1, pixels2, i);
    
    // 差异越大越红
    const intensity = Math.min(255, diff * 5);
    
    diffPixels[i] = intensity;     // R
    diffPixels[i + 1] = 0;         // G
    diffPixels[i + 2] = 0;         // B
    diffPixels[i + 3] = 255;       // A
    
    // 如果完全相同，显示为白色
    if (diff === 0) {
      diffPixels[i] = 255;
      diffPixels[i + 1] = 255;
      diffPixels[i + 2] = 255;
    }
  }
  
  diffCtx.putImageData(diffImageData, 0, 0);
  ctx.drawImage(diffCanvas, data1.width * 2, 0);
  
  // 添加标签
  ctx.fillStyle = 'black';
  ctx.font = '12px sans-serif';
  ctx.fillText('Puppeteer', 10, 15);
  ctx.fillText('Satori', data1.width + 10, 15);
  ctx.fillText('差异图', data1.width * 2 + 10, 15);
  
  // 保存
  const buffer = canvas.toBuffer('image/png');
  await writeFile(outputPath, buffer);
}

/**
 * 执行完整对比测试
 */
async function runComparison(): Promise<void> {
  console.log('🔬 开始像素级对比测试...\n');
  
  const outputDir = './comparison-results';
  await mkdir(outputDir, { recursive: true });
  
  // 1. 使用 Puppeteer 渲染
  console.log('📸 使用 Puppeteer 渲染...');
  const { widgetRenderer } = await import('../src/react-widgets/renderer.js');
  const { NewsWidget } = await import('../src/react-widgets/components/NewsWidget.js');
  
  const puppeteerPath = join(outputDir, 'puppeteer.png');
  await widgetRenderer.renderToFile(
    React.createElement(NewsWidget, { data: testData, border: '#ffffff' }),
    puppeteerPath,
    { width: RENDER_WIDTH, height: RENDER_HEIGHT, backgroundColor: '#ffffff' }
  );
  await widgetRenderer.close();
  console.log('✅ Puppeteer 渲染完成');
  
  // 2. 使用 Satori 渲染
  console.log('📸 使用 Satori 渲染...');
  const { satoriRenderer } = await import('../src/react-widgets/core/satori-renderer.js');
  const { SatoriNewsWidget } = await import('../src/react-widgets/components/SatoriNewsWidget.js');
  
  const satoriPath = join(outputDir, 'satori.png');
  await satoriRenderer.renderToFile(
    React.createElement(SatoriNewsWidget, { data: testData, border: '#ffffff' }),
    satoriPath,
    { width: RENDER_WIDTH, height: RENDER_HEIGHT, backgroundColor: '#ffffff' }
  );
  await satoriRenderer.close();
  console.log('✅ Satori 渲染完成');
  
  // 3. 像素级对比
  console.log('\n🔍 执行像素级对比分析...');
  const result = await compareImages(puppeteerPath, satoriPath);
  
  // 4. 生成差异可视化
  console.log('🎨 生成差异可视化图片...');
  const diffPath = join(outputDir, 'diff-comparison.png');
  await generateDiffImage(puppeteerPath, satoriPath, diffPath);
  
  // 5. 输出报告
  console.log('\n📊 对比结果报告:');
  console.log('='.repeat(50));
  console.log(`总像素数: ${result.totalPixels.toLocaleString()}`);
  console.log(`不同像素: ${result.differentPixels.toLocaleString()}`);
  console.log(`差异比例: ${result.percentage.toFixed(2)}%`);
  console.log(`最大差异: ${result.maxDifference.toFixed(2)} (0-510 范围)`);
  console.log(`平均差异: ${result.avgDifference.toFixed(2)}`);
  console.log('');
  console.log('📈 区域分析 (16x16 像素区域):');
  console.log(`  完全相同: ${result.identicalRegions} 个区域`);
  console.log(`  高度相似: ${result.similarRegions} 个区域`);
  console.log(`  明显不同: ${result.differentRegions} 个区域`);
  console.log('');
  
  // 6. 评估结果
  const similarityScore = 100 - result.percentage;
  console.log('🏆 相似度评估:');
  if (similarityScore >= 99) {
    console.log('  ⭐⭐⭐⭐⭐ 完美! 几乎完全相同');
  } else if (similarityScore >= 95) {
    console.log('  ⭐⭐⭐⭐ 优秀! 差异极小');
  } else if (similarityScore >= 90) {
    console.log('  ⭐⭐⭐ 良好! 有细微差异');
  } else if (similarityScore >= 80) {
    console.log('  ⭐⭐ 一般! 有明显差异');
  } else {
    console.log('  ⭐ 较差! 差异较大');
  }
  
  console.log('\n📁 输出文件:');
  console.log(`  Puppeteer: ${puppeteerPath}`);
  console.log(`  Satori: ${satoriPath}`);
  console.log(`  差异图: ${diffPath}`);
  
  // 7. 保存详细报告
  const report = {
    timestamp: new Date().toISOString(),
    testData: {
      title: testData.title,
      messageLength: testData.message.length
    },
    results: result,
    similarityScore,
    files: {
      puppeteer: puppeteerPath,
      satori: satoriPath,
      diff: diffPath
    }
  };
  
  const reportPath = join(outputDir, 'comparison-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`  报告: ${reportPath}`);
}

// 运行测试
runComparison().catch(console.error);
