/**
 * 测试不同标题长度的渲染效果
 */

import { NewsWidget, NewsData } from '../src/react-widgets/components/NewsWidget.js';

// 模拟不同长度的标题测试
const testTitles = [
  '短标题',           // 3字符 - 应该1行，最小高度
  '稍长一点的标题',    // 7字符 - 应该1行
  '这是一个中等长度的标题', // 11字符 - 应该1行
  '这是一个比较长的新闻标题测试', // 14字符 - 可能2行
  '这是一个非常长的新闻标题，用来测试多行显示效果', // 23字符 - 应该2-3行
  '这是一个超级长的新闻标题，专门用来测试标题banner的自动换行和高度调整功能是否正常工作' // 40字符 - 应该3行并截断
];

// 输出测试信息
console.log('📏 标题长度测试分析:');
console.log('==================');

testTitles.forEach((title, index) => {
  // 模拟组件内的计算逻辑（更新为28px）
  const fontSize = 28;
  const charWidth = fontSize * 0.8; // 22.4px per char (优化的中文字符宽度)
  const maxWidth = 284; // 296 - 12px padding
  const maxCharsPerLine = Math.floor(maxWidth / charWidth); // ~12 chars per line
  const estimatedLines = Math.ceil(title.length / maxCharsPerLine);
  const actualLines = Math.min(estimatedLines, 3);
  const lineHeight = fontSize * 1.1; // 30.8px
  const padding = 8;
  const minHeight = 42; // 调整最小高度适配28px字体
  const calculatedHeight = Math.max(minHeight, actualLines * lineHeight + padding);
  
  console.log(`\n${index + 1}. "${title}"`);
  console.log(`   长度: ${title.length}字符`);
  console.log(`   预计行数: ${actualLines}行`);
  console.log(`   Banner高度: ${calculatedHeight}px`);
  console.log(`   内容区域: ${152 - calculatedHeight - 16}px`);
});

console.log('\n🎯 设计逻辑 (28px字体):');
console.log('- 每行最多容纳约12个中文字符');
console.log('- 最小高度42px（单行标题）');
console.log('- 最大高度约102px（三行标题）');
console.log('- 内容区域自动调整：34px-94px');
console.log('- 超过3行的标题会被截断');