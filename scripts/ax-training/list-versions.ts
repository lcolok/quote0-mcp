#!/usr/bin/env tsx

/**
 * 列出所有训练数据版本
 */

import { SnapshotManager } from './snapshot-manager.js';

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const specific = args.find(arg => arg.startsWith('--version='))?.split('=')[1];

  try {
    const manager = new SnapshotManager();
    await manager.initialize();

    const currentVersion = await manager.getCurrentVersion();

    if (specific) {
      // 显示特定版本的详细信息
      console.log('📦 版本详情');
      console.log('============');
      console.log('');

      const details = await manager.getVersionDetails(specific);
      if (!details) {
        console.error(`❌ 版本 ${specific} 不存在`);
        process.exit(1);
      }

      const meta = details.metadata;
      console.log(`版本号: ${meta.version} ${currentVersion === meta.version ? '(当前激活)' : ''}`);
      console.log(`创建时间: ${new Date(meta.createdAt).toLocaleString('zh-CN')}`);
      console.log(`创建者: ${meta.createdBy}`);
      console.log(`描述: ${meta.description}`);
      console.log(`前一版本: ${meta.previousVersion || '(无)'}`);
      console.log(`标签: ${meta.tags.join(', ') || '(无)'}`);
      console.log('');
      console.log('📊 统计信息:');
      console.log(`   总样本数: ${meta.stats.totalSamples}`);
      console.log(`   平均分数: ${meta.stats.avgScore.toFixed(1)}`);
      console.log(`   高质量: ${meta.stats.highQuality} (${((meta.stats.highQuality / meta.stats.totalSamples) * 100).toFixed(1)}%)`);
      console.log(`   中质量: ${meta.stats.mediumQuality} (${((meta.stats.mediumQuality / meta.stats.totalSamples) * 100).toFixed(1)}%)`);
      console.log(`   低质量: ${meta.stats.lowQuality} (${((meta.stats.lowQuality / meta.stats.totalSamples) * 100).toFixed(1)}%)`);
      console.log('');
      console.log('📰 来源分布:');
      Object.entries(meta.sourceBreakdown).forEach(([source, count]) => {
        console.log(`   ${source}: ${count} (${((count as number / meta.stats.totalSamples) * 100).toFixed(1)}%)`);
      });
      console.log('');

      if (verbose) {
        console.log('🔍 样本溯源 (前10条):');
        const mapping = details.sourceMapping.slice(0, 10);
        mapping.forEach((item: any) => {
          console.log(`   #${item.sampleId}: ${item.title.substring(0, 30)}... (分数: ${item.score}, 来源: ${item.source})`);
        });
        if (details.sourceMapping.length > 10) {
          console.log(`   ... 还有 ${details.sourceMapping.length - 10} 条样本`);
        }
        console.log('');
      }

    } else {
      // 列出所有版本
      console.log('📚 训练数据版本列表');
      console.log('===================');
      console.log('');

      const versions = await manager.listVersions();

      if (versions.length === 0) {
        console.log('暂无版本快照');
        console.log('');
        console.log('创建第一个快照:');
        console.log('  bun run scripts/ax-training/export-from-annotation.ts --version=v1.0.0');
        return;
      }

      console.log(`找到 ${versions.length} 个版本:\n`);

      const table = versions.map(v => ({
        版本: v.version + (currentVersion === v.version ? ' ★' : ''),
        样本数: v.sampleCount.toString(),
        平均分: v.avgScore.toFixed(1),
        创建时间: new Date(v.createdAt).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      }));

      // 简单表格输出
      console.table(table);

      if (currentVersion) {
        console.log(`\n★ 表示当前激活版本: ${currentVersion}`);
      } else {
        console.log('\n⚠️  当前没有激活的版本');
      }

      console.log('');
      console.log('💡 提示:');
      console.log('   查看版本详情: bun run scripts/ax-training/list-versions.ts --version=v1.0.0');
      console.log('   激活版本: bun run scripts/ax-training/activate-version.ts --version=v1.0.0');
      console.log('');
    }

  } catch (error) {
    console.error('❌ 列出版本失败:', error);
    process.exit(1);
  }
}

main();
