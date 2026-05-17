#!/usr/bin/env tsx

/**
 * 热敏标签打印 CLI - Phase B 联调入口
 * 调用 LabelPrintOrchestrator 完成 render + push 全链路
 */

import { labelPrintOrchestrator } from '../core/label-print-orchestrator.js';
import { LABEL_T40X20_TARGET } from '../core/render-targets.js';

function showUsage(): void {
  console.log('🏷️  热敏标签打印工具');
  console.log('');
  console.log('用法: bun widget:label <title> [subtitle] [endpoint]');
  console.log('');
  console.log('参数:');
  console.log('  title     标签主标题（必填）');
  console.log('  subtitle  副标题（可选）');
  console.log('  endpoint  niimbot HTTP endpoint（可选，默认读 NIIMBOT_ENDPOINT 环境变量）');
  console.log('');
  console.log('示例:');
  console.log('  bun widget:label "会议室 A"');
  console.log('  bun widget:label "会议室 A" "2F-201"');
  console.log('  bun widget:label "会议室 A" "2F-201" http://192.168.31.186/api/print/raw');
  console.log('  NIIMBOT_ENDPOINT=http://niimbot.local/api/print/raw bun widget:label "测试"');
  console.log('');
  console.log('✅ 内部链路:');
  console.log('  satori SVG → sharp PNG → threshold dither → MSB-first 1-bit pack → POST raw bytes');
  console.log('');
  console.log('🎯 目标: T40x20-320 SKU (320×160 px = 6400 字节)');
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
  }

  const title = args[0];
  // 区分 subtitle 和 endpoint: endpoint 必然以 http 开头
  let subtitle: string | undefined;
  let endpoint: string | undefined;

  if (args[1] && args[1].startsWith('http')) {
    endpoint = args[1];
  } else if (args[1]) {
    subtitle = args[1];
    if (args[2] && args[2].startsWith('http')) {
      endpoint = args[2];
    }
  }

  endpoint = endpoint ?? process.env.NIIMBOT_ENDPOINT;
  if (!endpoint) {
    console.error('❌ 缺少 endpoint：请通过命令行参数或 NIIMBOT_ENDPOINT 环境变量提供');
    console.error('   例：bun widget:label "标题" "副标题" http://192.168.31.186/api/print/raw');
    process.exit(2);
  }

  console.log(`🎯 打印目标: ${LABEL_T40X20_TARGET.id} (${LABEL_T40X20_TARGET.widthPx}×${LABEL_T40X20_TARGET.heightPx})`);
  console.log('');

  const res = await labelPrintOrchestrator.print({
    data: { title, subtitle },
    target: LABEL_T40X20_TARGET,
    endpoint,
  });

  console.log('');
  if (res.success) {
    console.log(`🎉 打印请求完成: printId=${res.printId}, bytes=${res.bytes}, HTTP ${res.httpStatus}`);
    process.exit(0);
  } else {
    console.error(`💥 打印失败 [${res.stage}]: ${res.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 未捕获异常:', err);
  process.exit(1);
});
