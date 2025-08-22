#!/usr/bin/env tsx

/**
 * 测试矢量图标的渲染效果
 */

import React from 'react';
import IconTest from '../src/react-widgets/components/IconTest.js';
import { widgetRenderer } from '../src/react-widgets/renderer.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testIcons(): Promise<void> {
  console.log('🎨 测试矢量图标渲染...');

  try {
    // 确保输出目录存在
    const outputDir = './processed-images/icons';
    await execAsync(`mkdir -p "${outputDir}"`);

    // 渲染图标测试组件
    const iconTestWidget = React.createElement(IconTest);
    const timestamp = Date.now();
    const outputPath = `${outputDir}/icon_test_${timestamp}.png`;

    await widgetRenderer.renderToFile(iconTestWidget, outputPath);
    
    console.log('✅ 图标测试组件渲染完成!');
    console.log(`📁 图标测试图片: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ 图标测试失败:', error);
    throw error;
  } finally {
    await widgetRenderer.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testIcons()
    .then(() => {
      console.log('🎉 图标测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 运行失败:', error);
      process.exit(1);
    });
}