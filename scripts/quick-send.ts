#!/usr/bin/env tsx

/**
 * 快速发送脚本 - 使用验证过的最佳设置
 * 替代 quick-send.sh，提供更好的错误处理和参数传递
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

function showUsage(): void {
    console.log('🚀 快速发送工具 - 使用最佳设置');
    console.log('');
    console.log('用法: npm run image:quick <图片路径> [边框:0|1] [链接]');
    console.log('');
    console.log('示例:');
    console.log('  npm run image:quick /path/to/image.png');
    console.log('  npm run image:quick /path/to/image.gif 1');
    console.log('  npm run image:quick /path/to/image.jpg 0 https://example.com');
    console.log('');
    console.log('✅ 自动应用的优化:');
    console.log('  • 增强对比度 (实测最佳)');
    console.log('  • Floyd-Steinberg抖动算法');
    console.log('  • 1-bit黑白点阵屏专用优化');
    console.log('  • GIF自动提取第一帧');
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
        console.log('🎯 使用验证过的最佳设置处理图片...');
        console.log(`📁 输入: ${imagePath}`);
        console.log('🔧 对比度增强: ✅ (实测更清晰锐利)');
        console.log('🎨 抖动算法: Floyd-Steinberg');
        console.log('');
        
        const outputDir = './processed-images/quick-send';
        const isGif = path.extname(imagePath).toLowerCase() === '.gif';
        
        let optimizedFile: string;
        
        if (isGif) {
            console.log('📹 检测到GIF文件，提取第一帧并优化...');
            await execAsync(`node dist/image-sender/processors/media/gif-processor.js "${imagePath}" "${outputDir}" true`);
            
            // 查找生成的优化文件
            const { stdout } = await execAsync(`ls -t "${outputDir}"/gif_optimized_*.png | head -n1`);
            optimizedFile = stdout.trim();
        } else {
            console.log('🖼️  处理静态图片...');
            await execAsync(`node dist/image-sender/interfaces/cli/cli-main.js mono "${imagePath}" "${outputDir}" floydSteinberg true`);
            
            // 查找生成的优化文件
            const { stdout } = await execAsync(`ls -t "${outputDir}"/mono_*.png | head -n1`);
            optimizedFile = stdout.trim();
        }
        
        if (!optimizedFile || !existsSync(optimizedFile)) {
            console.error('❌ 优化文件生成失败');
            process.exit(1);
        }
        
        console.log('📤 发送优化后的图片...');
        const sendCmd = link ? 
            `node dist/image-sender/interfaces/cli/cli-main.js send "${optimizedFile}" "${border}" "${link}"` :
            `node dist/image-sender/interfaces/cli/cli-main.js send "${optimizedFile}" "${border}"`;
        await execAsync(sendCmd);
        
        console.log('');
        console.log('🎉 发送完成！使用了实测验证的最佳设置：');
        console.log('  ✅ 增强对比度 (更清晰锐利)');
        console.log('  ✅ Floyd-Steinberg抖动');
        console.log('  ✅ 1-bit黑白点阵屏优化');
        
    } catch (error) {
        console.error('❌ 处理失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();