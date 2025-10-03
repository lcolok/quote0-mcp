#!/usr/bin/env tsx

/**
 * 激活指定版本的训练数据
 */

import { SnapshotManager } from './snapshot-manager.js';

async function main() {
  const args = process.argv.slice(2);
  const version = args.find(arg => arg.startsWith('--version='))?.split('=')[1];

  if (!version) {
    console.error('❌ 错误: 必须指定版本号');
    console.log('');
    console.log('用法:');
    console.log('  bun run scripts/ax-training/activate-version.ts --version=v1.1.0');
    console.log('');
    console.log('或查看所有可用版本:');
    console.log('  bun run scripts/ax-training/list-versions.ts');
    process.exit(1);
  }

  try {
    console.log('🔄 激活训练数据版本');
    console.log('===================');
    console.log(`📌 目标版本: ${version}`);
    console.log('');

    const manager = new SnapshotManager();
    await manager.initialize();

    // 获取当前版本
    const currentVersion = await manager.getCurrentVersion();
    if (currentVersion) {
      console.log(`📋 当前版本: ${currentVersion}`);
    } else {
      console.log('📋 当前版本: (未设置)');
    }

    // 获取版本详情
    const details = await manager.getVersionDetails(version);
    if (!details) {
      throw new Error(`版本 ${version} 不存在`);
    }

    console.log('');
    console.log('📊 版本信息:');
    console.log(`   样本数: ${details.metadata.stats.totalSamples}`);
    console.log(`   平均分: ${details.metadata.stats.avgScore.toFixed(1)}`);
    console.log(`   高质量: ${details.metadata.stats.highQuality}`);
    console.log(`   中质量: ${details.metadata.stats.mediumQuality}`);
    console.log(`   低质量: ${details.metadata.stats.lowQuality}`);
    console.log(`   创建时间: ${new Date(details.metadata.createdAt).toLocaleString('zh-CN')}`);
    console.log(`   描述: ${details.metadata.description}`);
    console.log('');

    // 如果有前一个版本，显示差异
    if (currentVersion && currentVersion !== version) {
      console.log('🔍 版本差异:');
      const diff = await manager.compareVersions(currentVersion, version);
      console.log(`   样本数变化: ${diff.sampleCountDiff > 0 ? '+' : ''}${diff.sampleCountDiff}`);
      console.log(`   分数变化: ${diff.scoreDiff > 0 ? '+' : ''}${diff.scoreDiff.toFixed(1)}`);
      console.log(`   新增样本: ${diff.added}`);
      console.log(`   移除样本: ${diff.removed}`);
      console.log('');
    }

    // 激活版本
    await manager.activateVersion(version);

    console.log('');
    console.log('✅ 版本激活成功！');
    console.log('');
    console.log('📝 训练数据已更新到: ax-framework/compiled/ax-training-data.js');
    console.log('');
    console.log('🔜 下一步:');
    console.log('   重新训练模型以使用新的训练数据');
    console.log(`   bun run scripts/ax-training/train-model.ts --version=${version}`);
    console.log('');
    console.log('⚠️  注意:');
    console.log('   如果API服务正在运行，需要重启以加载新的训练数据');
    console.log('   docker-compose restart news-api');
    console.log('');

  } catch (error) {
    console.error('❌ 激活失败:', error);
    process.exit(1);
  }
}

main();
