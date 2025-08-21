/**
 * Image Sender 模块主入口
 * 
 * 这是重构后的模块化架构的统一导出文件
 */

// 核心类型导出
export * from './core/types/index.js';

// 配置导出
export * from './core/config/index.js';
export { OUTPUT_DIRECTORIES } from './core/config/constants.js';

// 主要功能导出
export { ImageSender } from './orchestrators/image-sender.js';
export { MindResetDeviceClient } from './services/api/device-client.js';
export { EnvLoader } from './adapters/environments/env-loader.js';

// 处理器导出
export { MonochromeOptimizer } from './processors/optimization/monochrome-optimizer.js';
export { GifProcessor } from './processors/media/gif-processor.js';

// 工具导出（当实现后）
// export * from './core/utils/index.js';

// 默认导出主要类
export { ImageSender as default } from './orchestrators/image-sender.js';