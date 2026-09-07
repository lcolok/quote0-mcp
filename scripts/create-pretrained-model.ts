#!/usr/bin/env tsx

/**
 * 已停用的兼容入口。
 *
 * 旧脚本会把静态示例、手写分数和随机元数据包装成“预训练 AX 模型”，
 * 但它没有执行训练，也没有留出集评估。保留文件名仅用于让旧调用方得到
 * 明确错误，而不是继续生成不可验证的生产 artifact。
 */

console.error('❌ create-pretrained-model 已停用：静态示例不是预训练模型。');
console.error('请使用 scripts/ax-training/train-model.ts 创建未验证的 prompt-profile 候选，');
console.error('再通过独立留出集评估；只有通过门禁的候选才能由人工发布。');
process.exitCode = 2;
