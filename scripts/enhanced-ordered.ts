#!/usr/bin/env tsx

/**
 * 增强对比度 + ORDERED 抖动脚本
 * 结合客户端对比度增强和服务端 ORDERED 抖动的优势
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

function showUsage(): void {
    console.log('🎯 增强对比度 + ORDERED 抖动工具');
    console.log('');
    console.log('用法: npm run image:enhanced-ordered <图片路径> [边框:0|1] [链接]');
    console.log('');
    console.log('示例:');
    console.log('  npm run image:enhanced-ordered /path/to/image.png');
    console.log('  npm run image:enhanced-ordered /path/to/image.jpg 1');
    console.log('  npm run image:enhanced-ordered /path/to/image.png 0 https://example.com');
    console.log('');
    console.log('✨ 最佳特性组合:');
    console.log('  • 客户端对比度增强（更清晰锐利）');
    console.log('  • 服务端 ORDERED 抖动（规整点阵）');
    console.log('  • 双重优化策略');
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
        console.log('🎯 使用增强对比度 + ORDERED 抖动组合...');
        console.log(`📁 输入: ${imagePath}`);
        console.log('🔧 第一步: 客户端对比度增强');
        console.log('🎨 第二步: 服务端 ORDERED 抖动');
        console.log('');
        
        const outputDir = './processed-images/enhanced-ordered';
        
        // 第一步：使用单色屏优化（对比度增强），但不使用客户端抖动
        console.log('📈 步骤1: 对比度增强处理...');
        await execAsync(`node dist/image-sender/interfaces/cli/cli-main.js mono "${imagePath}" "${outputDir}" none true`);
        
        // 找到生成的增强对比度文件（但未抖动）
        const { stdout } = await execAsync(`ls -t "${outputDir}"/mono_none_contrasttrue_*.png | head -n1`);
        const enhancedFile = stdout.trim();
        
        if (!enhancedFile || !existsSync(enhancedFile)) {
            console.error('❌ 对比度增强文件生成失败');
            process.exit(1);
        }
        
        console.log('✅ 对比度增强完成');
        console.log('🎯 步骤2: 使用服务端 ORDERED 抖动发送...');
        
        // 第二步：使用服务端 ORDERED 抖动发送增强后的图片
        const sendCmd = link ? 
            `node dist/image-sender/interfaces/cli/cli-main.js send-server-dither "${enhancedFile}" "${border}" "${link}" "ORDERED"` :
            `node dist/image-sender/interfaces/cli/cli-main.js send-server-dither "${enhancedFile}" "${border}" "" "ORDERED"`;
            
        await execAsync(sendCmd);
        
        console.log('');
        console.log('🎉 发送完成！使用了最佳组合策略：');
        console.log('  ✅ 对比度增强 (更清晰锐利)');
        console.log('  ✨ ORDERED 抖动 (规整点阵)');
        console.log('  🔄 双重优化处理');
        
    } catch (error) {
        console.error('❌ 处理失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();