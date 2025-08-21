#!/usr/bin/env node

import { ImageSender, EnvLoader } from './index.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('MindReset 图片发送工具');
    console.log('');
    console.log('使用方法:');
    console.log('  node cli.js <图片路径> [边框:0|1] [链接]');
    console.log('  tsx cli.ts <图片路径> [边框:0|1] [链接]');
    console.log('');
    console.log('示例:');
    console.log('  node cli.js /path/to/image.png');
    console.log('  node cli.js /path/to/image.png 1');
    console.log('  node cli.js /path/to/image.png 0 https://example.com');
    console.log('');
    console.log('参数说明:');
    console.log('  图片路径  - 要发送的图片文件路径');
    console.log('  边框      - 0=白色边框(默认), 1=黑色边框');
    console.log('  链接      - 点击图片后跳转的链接(可选)');
    console.log('');
    console.log('注意: 图片会自动调整为 296x152 像素以适配设备屏幕');
    process.exit(0);
  }

  const imagePath = args[0];
  const border = args[1] as "0" | "1" || "0";
  const link = args[2];

  try {
    // 自动加载环境变量
    EnvLoader.ensureEnvVars();
    
    // 创建图片发送器
    const sender = new ImageSender();
    
    // 发送图片
    const result = await sender.sendImageFile(imagePath, { border, link });
    
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}