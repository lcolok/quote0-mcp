#!/usr/bin/env node

import { ImageSender, EnvLoader, MonochromeOptimizer, DEVICE_SCREEN_SIZE, OUTPUT_DIRECTORIES } from '../../index.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('MindReset 图片发送工具');
    console.log('');
    console.log('使用方法:');
    console.log('  发送模式: node cli.js send <图片路径> [边框:0|1] [链接] [抖动算法] [调色板]');
    console.log('  预览模式: node cli.js preview <图片路径> [输出目录] [抖动算法] [调色板]');
    console.log('  单色优化: node cli.js mono <图片路径> [输出目录] [算法] [增强对比度:true|false]');
    console.log('');
    console.log('发送示例:');
    console.log('  node cli.js send /path/to/image.png');
    console.log('  node cli.js send /path/to/image.png 1');
    console.log('  node cli.js send /path/to/image.png 0 https://example.com');
    console.log('  node cli.js send /path/to/image.png 0 "" floydSteinberg default');
    console.log('');
    console.log('预览示例:');
    console.log('  node cli.js preview /path/to/image.png');
    console.log('  node cli.js preview /path/to/image.png ./previews');
    console.log('  node cli.js preview /path/to/image.png ./previews jarvis default');
    console.log('');
    console.log('单色屏优化示例 (推荐):');
    console.log('  node cli.js mono /path/to/image.png');
    console.log('  node cli.js mono /path/to/image.png ./mono-test floydSteinberg true');
    console.log('');
    console.log('参数说明:');
    console.log('  发送模式:');
    console.log('    图片路径  - 要发送的图片文件路径');
    console.log('    边框      - 0=白色边框(默认), 1=黑色边框');
    console.log('    链接      - 点击图片后跳转的链接(可选，用""跳过)');
    console.log('    抖动算法  - floydSteinberg(默认)|jarvis|stucki|burkes|sierra');
    console.log('    调色板    - default(默认)|spectra6');
    console.log('');
    console.log('  预览模式:');
    console.log('    图片路径  - 要处理的图片文件路径');
    console.log('    输出目录  - 预览图片保存目录(默认./previews)');
    console.log('    抖动算法  - 同发送模式');
    console.log('    调色板    - 同发送模式');
    console.log('');
    console.log('水墨屏优化功能:');
    console.log('  - 自动抖动算法优化显示效果');
    console.log('  - 预览模式生成原始和优化对比图片');
    console.log('  - 图片自动调整为 296x152 像素');
    process.exit(0);
  }

  const mode = args[0];
  
  if (mode === 'send') {
    await handleSendMode(args.slice(1));
  } else if (mode === 'send-server-dither') {
    await handleServerDitherMode(args.slice(1));
  } else if (mode === 'preview') {
    await handlePreviewMode(args.slice(1));
  } else if (mode === 'mono') {
    await handleMonochromeMode(args.slice(1));
  } else {
    // 向后兼容 - 如果第一个参数不是模式，则默认为发送模式
    await handleSendMode(args);
  }
}

async function handleSendMode(args: string[]) {
  const imagePath = args[0];
  const border = args[1] as "0" | "1" || "0";
  const link = args[2] || undefined;
  const algorithm = args[3] as any || 'floydSteinberg';
  const palette = args[4] as any || 'default';

  if (!imagePath) {
    console.error('❌ 请提供图片路径');
    process.exit(1);
  }

  try {
    // 自动加载环境变量
    EnvLoader.ensureEnvVars();
    
    // 创建图片发送器
    const sender = new ImageSender();
    
    // 发送图片
    const sendOptions = { border, link: link === "" ? undefined : link };
    const processingOptions = { algorithm, palette, enableDithering: true };
    
    console.log(`水墨屏优化设置: 算法=${algorithm}, 调色板=${palette}`);
    const result = await sender.sendImageFile(imagePath, sendOptions, processingOptions);
    
    if (!result.success) {
      console.error('❌ 发送失败:', result.error);
      process.exit(1);
    }
    
    console.log('🎉 任务完成!');
  } catch (error) {
    console.error('❌ 执行出错:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleServerDitherMode(args: string[]) {
  const imagePath = args[0];
  const border = args[1] as "0" | "1" || "0";
  const link = args[2] || undefined;
  const ditherType = args[3] || 'ORDERED';
  const ditherKernel = args[4] || undefined;

  if (!imagePath) {
    console.error('❌ 请提供图片路径');
    process.exit(1);
  }

  try {
    // 自动加载环境变量
    EnvLoader.ensureEnvVars();
    
    // 创建图片发送器
    const sender = new ImageSender();
    
    // 发送图片（使用服务端抖动）
    const sendOptions = { 
      border, 
      link: link === "" ? undefined : link,
      useServerDithering: true,
      ditherType,
      ditherKernel
    };
    
    console.log(`🎯 服务端抖动设置: 类型=${ditherType}${ditherKernel ? `, 核心=${ditherKernel}` : ''}`);
    const result = await sender.sendImageFile(imagePath, sendOptions, { enableDithering: false });
    
    if (!result.success) {
      console.error('❌ 发送失败:', result.error);
      process.exit(1);
    }
    
    console.log('🎉 任务完成!');
  } catch (error) {
    console.error('❌ 执行出错:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handlePreviewMode(args: string[]) {
  const imagePath = args[0];
  const outputDir = args[1] || OUTPUT_DIRECTORIES.PREVIEWS;
  const algorithm = args[2] as any || 'floydSteinberg';
  const palette = args[3] as any || 'default';

  if (!imagePath) {
    console.error('❌ 请提供图片路径');
    process.exit(1);
  }

  try {
    // 创建图片发送器 (预览模式不需要设备客户端)
    const sender = new ImageSender(null as any);
    
    const processingOptions = { algorithm, palette, enableDithering: true };
    
    console.log(`水墨屏优化设置: 算法=${algorithm}, 调色板=${palette}`);
    console.log(`预览图片将保存到: ${outputDir}`);
    
    const result = await sender.generatePreview(imagePath, outputDir, processingOptions);
    
    if (!result.success) {
      console.error('❌ 预览生成失败:', result.error);
      process.exit(1);
    }
    
    console.log('🎉 预览生成完成!');
    console.log('📁 您现在可以查看以下文件来对比效果:');
    console.log(`   原始版本: ${result.originalPath}`);
    console.log(`   优化版本: ${result.optimizedPath}`);
  } catch (error) {
    console.error('❌ 执行出错:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleMonochromeMode(args: string[]) {
  const imagePath = args[0];
  const outputDir = args[1] || OUTPUT_DIRECTORIES.MONOCHROME;
  const algorithm = args[2] || 'floydSteinberg';
  const enhanceContrast = args[3] !== 'false'; // 默认为true

  if (!imagePath) {
    console.error('❌ 请提供图片路径');
    process.exit(1);
  }

  try {
    console.log('🎯 专为1-bit黑白点阵式水墨屏优化');
    console.log(`算法: ${algorithm}, 对比度增强: ${enhanceContrast}`);
    console.log(`输出目录: ${outputDir}`);
    
    const optimizer = new MonochromeOptimizer();
    
    // 显示优化建议
    const tips = optimizer.getOptimizationTips();
    tips.forEach(tip => console.log(tip));
    console.log('');

    // 生成优化预览
    const fs = await import('fs');
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    const result = await optimizer.optimizeForMonochromeScreen(
      imagePath,
      DEVICE_SCREEN_SIZE,
      algorithm,
      enhanceContrast
    );

    if (!result.success) {
      console.error('❌ 优化失败:', result.error);
      process.exit(1);
    }

    const timestamp = Date.now();
    const outputPath = `${outputDir}/mono_${algorithm}_contrast${enhanceContrast}_${timestamp}.png`;
    await optimizer.saveCanvasToFile(result.canvas, outputPath);

    console.log('✅ 单色屏优化完成!');
    console.log(`📁 优化后图片: ${outputPath}`);
    console.log('');
    console.log('📤 发送到设备:');
    console.log(`node dist/image-sender/cli.js send "${outputPath}"`);

  } catch (error) {
    console.error('❌ 执行出错:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}