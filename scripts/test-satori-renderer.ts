/**
 * 测试 Satori 渲染器
 * 验证 NewsWidget 使用 Satori 渲染的效果
 */

import React from 'react';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';
import { SatoriNewsWidget } from '../src/react-widgets/components/SatoriNewsWidget.js';

async function testSatoriRenderer() {
  console.log('🧪 测试 Satori 渲染器...\n');

  try {
    // 初始化渲染器
    await satoriRenderer.initialize();

    // 创建测试数据
    const testData = {
      title: 'AI技术突破：新型语言模型在多个基准测试中表现优异',
      message: '研究人员最近发布了一款新型语言模型，该模型在多项基准测试中取得了显著进步。这一突破可能会改变我们对人工智能能力的认知，并为未来的AI应用开辟新的可能性。',
      signature: 'AI优化·Q95',
      source: 'RSS智能',
      publishTime: new Date().toISOString(),
      category: 'technology'
    };

    console.log('📰 测试数据:');
    console.log(`   标题: ${testData.title}`);
    console.log(`   内容长度: ${testData.message.length} 字符`);
    console.log(`   来源: ${testData.source}\n`);

    // 渲染组件
    console.log('🎨 开始渲染...');
    const startTime = Date.now();

    const imageBuffer = await satoriRenderer.renderToImage(
      React.createElement(SatoriNewsWidget, { 
        data: testData,
        border: '#ffffff' 
      }),
      {
        width: 296,
        height: 152,
        backgroundColor: '#ffffff'
      }
    );

    const renderTime = Date.now() - startTime;
    console.log(`✅ 渲染完成！耗时: ${renderTime}ms`);
    console.log(`📊 图片大小: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

    // 保存测试图片
    const fs = await import('fs');
    const outputPath = './test-satori-output.png';
    await fs.promises.writeFile(outputPath, imageBuffer);
    console.log(`💾 图片已保存到: ${outputPath}`);

    // 性能测试
    console.log('\n⚡ 性能测试 (5次渲染)...');
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await satoriRenderer.renderToImage(
        React.createElement(SatoriNewsWidget, { 
          data: testData,
          border: '#ffffff' 
        }),
        { width: 296, height: 152 }
      );
      times.push(Date.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    console.log(`   平均耗时: ${avgTime.toFixed(1)}ms`);
    console.log(`   最小耗时: ${minTime}ms`);
    console.log(`   最大耗时: ${maxTime}ms`);

    // 清理
    await satoriRenderer.close();
    console.log('\n✅ 测试完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testSatoriRenderer();
