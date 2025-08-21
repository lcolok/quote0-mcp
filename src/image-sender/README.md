# MindReset 1-bit 黑白水墨屏图片发送模块

专为 MindReset 1-bit 黑白点阵式水墨屏设备优化的 TypeScript 图片处理和发送模块。

## 核心特性

- 🎯 **1-bit屏幕专用优化**: 针对黑白点阵屏的专门算法
- ✅ **实测验证**: 增强对比度显著提升清晰度和锐利度
- 🖼️ **智能图片处理**: 自动调整尺寸(296x152)，保持比例不拉伸
- 🎨 **Floyd-Steinberg抖动**: 最佳抖动算法，模拟灰度效果
- 📹 **GIF支持**: 自动提取GIF第一帧并优化
- 📁 **自动配置**: 从 `.env` 文件加载设备信息
- 🚀 **一键发送**: 快速发送脚本，自动应用最佳设置

## 快速开始

### 🚀 推荐使用：一键发送脚本

```bash
# 构建项目
npm run build

# 最简单的发送方式（自动最佳设置）
./quick-send.sh /path/to/image.png

# 支持GIF（自动提取第一帧）
./quick-send.sh /path/to/animation.gif

# 支持边框和链接参数
./quick-send.sh /path/to/image.jpg 1 https://example.com
```

### 🔧 高级用法：单色屏专用优化

```bash
# 单色屏优化模式（增强对比度+Floyd-Steinberg）
node dist/image-sender/cli.js mono /path/to/image.png

# GIF处理（提取第一帧+优化）
node dist/image-sender/gif-processor.js /path/to/animation.gif
```

### 2. 模块使用

```typescript
import { ImageSender, EnvLoader } from './image-sender/index.js';

// 加载环境变量
EnvLoader.ensureEnvVars();

// 创建发送器
const sender = new ImageSender();

// 发送图片
const result = await sender.sendImageFile('/path/to/image.png', {
  border: '0', // 0=白边框, 1=黑边框
  link: 'https://example.com' // 可选的跳转链接
});

if (result.success) {
  console.log('发送成功!', result.data);
} else {
  console.error('发送失败:', result.error);
}
```

## 环境配置

在项目根目录创建 `.env` 文件：

```env
MINDRESET_DEVICE_ID=你的设备ID
MINDRESET_DEVICE_SECRET=你的设备密钥
```

## 模块结构

```
src/image-sender/
├── types.ts              # TypeScript 类型定义
├── env-loader.ts         # 环境变量加载器  
├── device-client.ts      # MindReset设备API客户端
├── image-processor.ts    # 通用图片处理工具
├── monochrome-optimizer.ts # 1-bit黑白屏专用优化器 ⭐
├── gif-processor.ts      # GIF处理工具
├── device-profiles.ts    # 设备配置文件
├── image-sender.ts       # 主发送器类
├── cli.ts               # 命令行工具
├── index.ts             # 模块导出
└── README.md            # 说明文档

根目录:
├── quick-send.sh        # 一键发送脚本 ⭐
└── .env                 # 设备配置文件
```

## 🎯 实测优化结果

基于实际设备测试验证的最佳设置：

### ✅ **最佳配置组合**
- **设备类型**: 1-bit 黑白点阵式水墨屏
- **对比度增强**: 启用（显著提升清晰度和锐利度）
- **抖动算法**: Floyd-Steinberg（效果最佳）
- **图片适配**: 保持比例，居中放置，不拉伸

### 🔍 **设备特征分析**
- **显示原理**: 通过抖动算法的点密度模拟灰度
- **色彩支持**: 纯黑白（1-bit），无真实灰度
- **最佳图片**: 图标、文字、简单插画
- **避免内容**: 复杂照片、细节过多的图像

## API 快速参考

### 🚀 MonochromeOptimizer (核心优化器)

```typescript
// 专为1-bit黑白屏优化
const optimizer = new MonochromeOptimizer();
const result = await optimizer.optimizeForMonochromeScreen(
  imagePath, 
  { width: 296, height: 152 }, 
  'floydSteinberg',  // 抖动算法
  true              // 增强对比度 ⭐
);
```

### 📹 GifProcessor (GIF处理)

```typescript
// GIF第一帧提取+优化
const processor = new GifProcessor();
const result = await processor.processGifForDevice(gifPath, outputDir, true);
```

## 注意事项

- ✅ **自动最佳设置**: 使用 `quick-send.sh` 获得最佳效果
- 📐 **尺寸适配**: 自动调整为296x152像素，保持比例不拉伸
- 🖼️ **格式支持**: PNG、JPG、GIF（自动提取第一帧）
- 🍎 **系统要求**: macOS 系统（使用sips工具处理图片）
- 🔐 **设备配置**: 需要在.env文件中设置设备ID和密钥