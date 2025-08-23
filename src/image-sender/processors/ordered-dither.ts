#!/usr/bin/env tsx

/**
 * ORDERED 抖动测试脚本
 * 使用 MindReset 官方 API 的有序抖动算法
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

function showUsage(): void {
    console.log('🎯 ORDERED 抖动测试工具');
    console.log('');
    console.log('用法: npm run image:ordered <图片路径> [边框:0|1] [链接]');
    console.log('');
    console.log('示例:');
    console.log('  npm run image:ordered /path/to/image.png');
    console.log('  npm run image:ordered /path/to/image.jpg 1');
    console.log('  npm run image:ordered /path/to/image.png 0 https://example.com');
    console.log('');
    console.log('✨ 特性:');
    console.log('  • 使用官方 ORDERED 有序抖动算法');
    console.log('  • 服务端处理，减少客户端计算');
    console.log('  • 规整的点阵图案效果');
    process.exit(0);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        showUsage();
    }
    
    const imagePath = args[0];
    const border = args[1] || '0';
    const link = args[2] || '';
    
    if (!existsSync(imagePath)) {
        console.error('❌ 图片文件不存在:', imagePath);
        process.exit(1);
    }
    
    try {
        console.log('🎯 使用官方 ORDERED 抖动算法...');
        console.log(`📁 输入: ${imagePath}`);
        console.log('🔧 抖动类型: ORDERED (有序抖动)');
        console.log('⚡ 处理方式: 服务端处理');
        console.log('');
        
        // 构建带有服务端抖动参数的命令
        let sendCmd = `node dist/image-sender/interfaces/cli/cli-main.js send-server-dither "${imagePath}" "${border}"`;
        
        if (link) {
            sendCmd += ` "${link}"`;
        }
        
        sendCmd += ' "ORDERED"'; // ditherType
        
        console.log('📤 发送到设备（使用服务端 ORDERED 抖动）...');
        await execAsync(sendCmd);
        
        console.log('');
        console.log('🎉 发送完成！使用了官方 ORDERED 抖动：');
        console.log('  ✨ 有序抖动算法');
        console.log('  ⚡ 服务端处理');
        console.log('  🎯 规整点阵图案');
        
    } catch (error) {
        console.error('❌ 处理失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();