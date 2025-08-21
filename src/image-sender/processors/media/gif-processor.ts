#!/usr/bin/env node

import { createCanvas, loadImage } from 'canvas';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * GIF处理工具 - 提取第一帧并优化
 */
export class GifProcessor {
  
  /**
   * 提取GIF第一帧
   * @param gifPath GIF文件路径
   * @param outputPath 输出PNG路径
   */
  async extractFirstFrame(gifPath: string, outputPath: string): Promise<boolean> {
    try {
      console.log('正在提取GIF第一帧...');
      
      // 使用sips提取第一帧 (macOS)
      const command = `sips -s format png "${gifPath}" --out "${outputPath}"`;
      await execAsync(command);
      
      console.log(`✅ 第一帧已提取: ${outputPath}`);
      return true;
    } catch (error) {
      console.error('提取GIF第一帧失败:', error);
      return false;
    }
  }

  /**
   * 不拉伸地适配到目标尺寸 (居中放置，保持比例)
   * @param imagePath 输入图片路径
   * @param outputPath 输出图片路径
   * @param targetWidth 目标宽度
   * @param targetHeight 目标高度
   */
  async fitWithoutStretch(
    imagePath: string, 
    outputPath: string, 
    targetWidth: number = 296, 
    targetHeight: number = 152
  ): Promise<boolean> {
    try {
      console.log('正在适配尺寸 (不拉伸，保持比例)...');
      
      const image = await loadImage(imagePath);
      const canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      
      // 白色背景
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      
      // 计算缩放比例，保持长宽比
      const scaleX = targetWidth / image.width;
      const scaleY = targetHeight / image.height;
      const scale = Math.min(scaleX, scaleY); // 选择较小的缩放比例，确保不超出边界
      
      // 计算缩放后的尺寸
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      
      // 居中放置
      const x = (targetWidth - scaledWidth) / 2;
      const y = (targetHeight - scaledHeight) / 2;
      
      console.log(`原始尺寸: ${image.width}x${image.height}`);
      console.log(`缩放比例: ${scale.toFixed(3)}`);
      console.log(`适配后尺寸: ${Math.round(scaledWidth)}x${Math.round(scaledHeight)}`);
      console.log(`放置位置: (${Math.round(x)}, ${Math.round(y)})`);
      
      // 绘制图片
      ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
      
      // 保存
      const buffer = canvas.toBuffer('image/png');
      await fs.promises.writeFile(outputPath, buffer);
      
      console.log(`✅ 尺寸适配完成: ${outputPath}`);
      return true;
    } catch (error) {
      console.error('适配尺寸失败:', error);
      return false;
    }
  }

  /**
   * 处理GIF并准备发送到设备
   * @param gifPath GIF文件路径
   * @param outputDir 输出目录
   * @param optimize 是否应用单色屏优化
   */
  async processGifForDevice(
    gifPath: string, 
    outputDir: string = './gif-processed',
    optimize: boolean = true
  ): Promise<{ success: boolean; imagePath?: string; error?: string }> {
    try {
      // 确保输出目录存在
      await fs.promises.mkdir(outputDir, { recursive: true });
      
      const timestamp = Date.now();
      const firstFramePath = `${outputDir}/gif_frame1_${timestamp}.png`;
      const fittedPath = `${outputDir}/gif_fitted_${timestamp}.png`;
      
      // 1. 提取第一帧
      const extractSuccess = await this.extractFirstFrame(gifPath, firstFramePath);
      if (!extractSuccess) {
        return { success: false, error: '提取GIF第一帧失败' };
      }
      
      // 2. 适配尺寸 (不拉伸)
      const fitSuccess = await this.fitWithoutStretch(firstFramePath, fittedPath);
      if (!fitSuccess) {
        return { success: false, error: '适配尺寸失败' };
      }
      
      let finalPath = fittedPath;
      
      // 3. 可选：应用单色屏优化
      if (optimize) {
        console.log('正在应用单色屏优化...');
        const { MonochromeOptimizer } = await import('../optimization/monochrome-optimizer.js');
        const optimizer = new MonochromeOptimizer();
        
        const optimizeResult = await optimizer.optimizeForMonochromeScreen(
          fittedPath,
          { width: 296, height: 152 },
          'floydSteinberg',
          true
        );
        
        if (optimizeResult.success) {
          finalPath = `${outputDir}/gif_optimized_${timestamp}.png`;
          await optimizer.saveCanvasToFile(optimizeResult.canvas, finalPath);
          console.log(`✅ 单色屏优化完成: ${finalPath}`);
        }
      }
      
      // 清理临时文件
      try {
        await fs.promises.unlink(firstFramePath);
        if (optimize && finalPath !== fittedPath) {
          await fs.promises.unlink(fittedPath);
        }
      } catch (e) {
        console.warn('清理临时文件失败:', e);
      }
      
      return { success: true, imagePath: finalPath };
      
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
}

// CLI 使用
if (import.meta.url === `file://${process.argv[1]}`) {
  const gifPath = process.argv[2];
  const outputDir = process.argv[3] || './gif-processed';
  const optimize = process.argv[4] !== 'false';
  
  if (!gifPath) {
    console.log('使用方法: node gif-processor.js <GIF路径> [输出目录] [优化:true|false]');
    console.log('示例: node gif-processor.js /path/to/animation.gif ./output true');
    process.exit(1);
  }
  
  const processor = new GifProcessor();
  processor.processGifForDevice(gifPath, outputDir, optimize)
    .then(result => {
      if (result.success) {
        console.log('🎉 GIF处理完成!');
        console.log(`📁 输出文件: ${result.imagePath}`);
        console.log('📤 发送到设备:');
        console.log(`node dist/image-sender/cli.js send "${result.imagePath}"`);
      } else {
        console.error('❌ 处理失败:', result.error);
        process.exit(1);
      }
    });
}

export default GifProcessor;