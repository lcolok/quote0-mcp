#!/usr/bin/env tsx

/**
 * AX框架完整训练演示
 * 展示自动优化、few-shot学习和中间产物生成
 */

import { AxOptimizedNewsProcessor } from '../src/react-widgets/services/ax-optimized-news-processor.js';
import { trainingData } from './ax-training-data.js';

async function runAxTrainingDemo() {
  console.log('🚀 AX框架完整训练演示');
  console.log('====================');
  
  try {
    // 1. 初始化AX优化处理器
    console.log('📝 初始化AX优化处理器...');
    const processor = new AxOptimizedNewsProcessor({
      apiKey: process.env.LLM_API_KEY!,
      baseURL: process.env.LLM_BASE_URL!,
      model: process.env.LLM_MODEL || 'gpt-4o'
    });

    // 2. 显示训练数据统计
    console.log(`\n📊 训练数据统计:`);
    console.log(`- 训练样本数量: ${trainingData.length}`);
    console.log(`- 数据类别: ${[...new Set(trainingData.map(d => d.metadata?.category))].join(', ')}`);
    console.log(`- 平均标题长度: ${Math.round(trainingData.reduce((sum, d) => sum + d.expectedTitle.length, 0) / trainingData.length)} 字符`);
    console.log(`- 平均摘要长度: ${Math.round(trainingData.reduce((sum, d) => sum + d.expectedSummary.length, 0) / trainingData.length)} 字符`);

    // 3. 启动自动优化训练
    console.log('\n🎯 启动AX自动优化训练...');
    console.log('这将包含:');
    console.log('- BootstrapFewShot 自动发现最佳示例');
    console.log('- 多轮迭代优化提高性能');
    console.log('- 自动生成中间产物和统计信息');
    
    const startTime = Date.now();
    const result = await processor.trainOptimizedPrograms(trainingData);
    const trainingTime = Date.now() - startTime;

    // 4. 展示训练结果
    console.log('\n✅ 训练完成！');
    console.log(`⏱️  训练耗时: ${Math.round(trainingTime / 1000)}秒`);
    console.log('\n📊 优化统计结果:');
    console.log('标题优化器:', result.titleStats);
    console.log('摘要优化器:', result.summaryStats);

    // 5. 测试优化后的程序
    console.log('\n🧪 测试优化后的程序...');
    const testNews = `
      SpaceX成功发射最新一批Starlink卫星，本次任务搭载60颗卫星，使在轨卫星总数达到5000颗。
      马斯克表示，Starlink网络现已覆盖全球99%的人口，下载速度可达1Gbps。
      该服务已在50多个国家提供，用户超过300万。SpaceX计划未来五年内将卫星数量增加到12000颗。
    `;

    const optimizedResult = await processor.processNewsWithOptimizedProgram(testNews.trim());
    
    console.log('\n🎯 优化后的处理结果:');
    console.log(`标题: "${optimizedResult.title}" (${optimizedResult.title.length}字符)`);
    console.log(`摘要: "${optimizedResult.body}" (${optimizedResult.body.length}字符)`);
    console.log(`来源: ${optimizedResult.footer}`);

    // 6. 展示中间产物信息
    console.log('\n💾 中间产物已保存到:');
    console.log('📁 /Users/lco/GitHub/quote0-mcp/ax-optimization-artifacts/');
    console.log('   - 包含完整的优化状态和学习结果');
    console.log('   - 可用于生产环境部署');
    console.log('   - 支持版本管理和回滚');

    // 7. 质量评估
    console.log('\n📈 质量评估:');
    const titleCompliance = optimizedResult.title.length <= 20 ? '✅ 合规' : '❌ 超长';
    const summaryCompliance = optimizedResult.body.length <= 200 ? '✅ 合规' : '❌ 超长';
    console.log(`- 标题长度: ${titleCompliance} (${optimizedResult.title.length}/20)`);
    console.log(`- 摘要长度: ${summaryCompliance} (${optimizedResult.body.length}/200)`);

    console.log('\n🎉 AX框架训练演示完成！');
    console.log('🔮 下一步可以:');
    console.log('   1. 集成到新闻组件插件系统');
    console.log('   2. 部署到生产环境');
    console.log('   3. 收集用户反馈进行持续优化');

  } catch (error) {
    console.error('❌ 训练演示失败:', error);
    console.error('\n🔧 可能的原因:');
    console.error('- 环境变量配置不正确');
    console.error('- AX框架依赖未安装');
    console.error('- API访问问题');
    
    // 显示调试信息
    console.error('\n🐛 调试信息:');
    console.error('环境变量检查:');
    console.error(`- LLM_API_KEY: ${process.env.LLM_API_KEY ? '已设置' : '未设置'}`);
    console.error(`- LLM_BASE_URL: ${process.env.LLM_BASE_URL || '未设置'}`);
    console.error(`- LLM_MODEL: ${process.env.LLM_MODEL || '未设置'}`);
    
    process.exit(1);
  }
}

// 运行演示
runAxTrainingDemo();