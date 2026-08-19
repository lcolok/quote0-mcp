#!/usr/bin/env tsx

/**
 * Legacy activation command.
 *
 * Data snapshots are evidence sets, not deployable models. Activation is
 * intentionally blocked until a held-out evaluation artifact is supplied.
 */

const version = process.argv.find((arg) => arg.startsWith('--version='))?.split('=')[1];

if (!version) {
  console.error('用法: bun run scripts/ax-training/activate-version.ts --version=<snapshot-version>');
  process.exit(1);
}

console.error(`拒绝激活 ${version}：评审数据快照不能直接改变生产提示配置。`);
console.error('请先生成独立留出集评估报告，通过事实一致性、长度合规和人工偏好门禁后，再走显式发布流程。');
process.exit(2);
