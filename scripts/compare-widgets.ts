#!/usr/bin/env tsx

/**
 * 天气组件版本对比工具
 * 生成不同版本的组件进行效果对比
 */

import React from 'react';
import { WeatherWidget } from '../src/react-widgets/components/WeatherWidget.js';
import { CompactWeatherWidget } from '../src/react-widgets/components/CompactWeatherWidget.js';
import { MiniWeatherWidget } from '../src/react-widgets/components/MiniWeatherWidget.js';
import { guangzhouWeatherMock } from '../src/react-widgets/mock-data.js';
import { widgetRenderer } from '../src/react-widgets/renderer.js';

async function generateComparison(): Promise<void> {
  console.log('🔍 生成天气组件版本对比...');

  try {
    const outputDir = './processed-images/widgets/comparison';
    
    // 确保输出目录存在
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(`mkdir -p "${outputDir}"`);

    const timestamp = Date.now();

    // 1. 原版组件（复杂版）
    console.log('📊 生成原版组件 (复杂版)...');
    const originalWidget = React.createElement(WeatherWidget, {
      data: guangzhouWeatherMock
    });
    await widgetRenderer.renderToFile(
      originalWidget,
      `${outputDir}/weather_original_${timestamp}.png`
    );

    // 2. 紧凑版组件
    console.log('📋 生成紧凑版组件...');
    const compactWidget = React.createElement(CompactWeatherWidget, {
      data: guangzhouWeatherMock
    });
    await widgetRenderer.renderToFile(
      compactWidget,
      `${outputDir}/weather_compact_${timestamp}.png`
    );

    // 3. 迷你版组件
    console.log('🎯 生成超迷你版组件...');
    const miniWidget = React.createElement(MiniWeatherWidget, {
      data: guangzhouWeatherMock
    });
    await widgetRenderer.renderToFile(
      miniWidget,
      `${outputDir}/weather_mini_${timestamp}.png`
    );

    console.log('✅ 所有版本生成完成！');
    console.log(`📁 对比图片位置: ${outputDir}/`);
    console.log('');
    console.log('🔍 版本特点对比:');
    console.log('  • Original: 信息丰富，但可能过于密集');
    console.log('  • Compact:  平衡信息量与可读性');
    console.log('  • Mini:     超简化，突出温度显示');
    console.log('');
    console.log('💡 建议在水墨屏上查看实际效果，选择最清晰的版本。');

  } catch (error) {
    console.error('❌ 生成对比失败:', error);
    throw error;
  } finally {
    await widgetRenderer.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateComparison()
    .then(() => {
      console.log('🎉 对比生成完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 运行失败:', error);
      process.exit(1);
    });
}