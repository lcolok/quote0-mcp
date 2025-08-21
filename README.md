# MindReset MCP Server

专为 MindReset 1-bit 黑白点阵式水墨屏设备打造的 MCP 服务器和图片处理工具。基于实际设备测试验证的最佳优化策略。

## 🎯 核心特性

- 🏆 **双重优化**: 客户端对比度增强 + 服务端 ORDERED 抖动
- ✅ **实测验证**: 增强对比度显著提升清晰度和锐利度  
- ✨ **多种抖动算法**: Floyd-Steinberg、ORDERED 等可选
- 📹 **GIF支持**: 自动提取第一帧并优化
- 🖼️ **智能适配**: 保持比例，避免拉伸变形
- 🚀 **一键发送**: npm scripts，自动应用最佳设置
- 🏗️ **模块化架构**: 清晰的分层设计，便于维护

## 🚀 快速开始

### 1. 安装和构建
```bash
npm install
npm run build
```

### 2. 配置设备信息
在项目根目录创建 `.env` 文件：
```env
MINDRESET_DEVICE_ID=你的设备ID
MINDRESET_DEVICE_SECRET=你的设备密钥
```

### 3. 使用 NPM Scripts（推荐）
```bash
# 🏆 最佳效果（推荐）- 增强对比度 + ORDERED 抖动
npm run image:enhanced-ordered /path/to/image.png

# 经典最佳 - 增强对比度 + Floyd-Steinberg
npm run image:quick /path/to/image.png

# 发送GIF第一帧  
npm run image:quick /path/to/animation.gif

# 带边框和链接
npm run image:enhanced-ordered /path/to/image.jpg 1 https://example.com

# 其他选项
npm run image:send <图片路径> [边框] [链接]         # 基础发送
npm run image:ordered <图片路径> [边框]            # 纯 ORDERED 抖动
npm run image:preview <图片路径> [输出目录]        # 预览对比
npm run image:mono <图片路径> [输出目录]           # 单色屏优化
```

## 🔧 高级用法

### 直接使用模块
```bash
# 单色屏专用优化
node dist/image-sender/interfaces/cli/cli-main.js mono /path/to/image.png

# GIF处理  
node dist/image-sender/processors/media/gif-processor.js /path/to/animation.gif

# 预览对比
node dist/image-sender/interfaces/cli/cli-main.js preview /path/to/image.png
```

## 📊 实测优化结果

基于实际1-bit黑白点阵屏设备测试：

### ✅ 最佳配置
- **对比度增强**: 启用（显著更清晰锐利）
- **抖动算法**: Floyd-Steinberg
- **图片类型**: 图标、文字、简单插画效果最佳
- **避免**: 复杂照片、过多细节

### 🔍 设备特征
- **类型**: 1-bit 黑白点阵式水墨屏
- **显示**: 通过抖动点密度模拟灰度
- **尺寸**: 296x152 像素
- **厂商**: 可能为 Good Display 或 Pervasive Displays 系列

## 📁 项目结构

```
├── scripts/
│   └── quick-send.ts      # 快速发送脚本（TypeScript）
├── src/image-sender/      # 图片处理模块（重构后）
│   ├── core/             # 核心配置和类型
│   ├── adapters/         # 环境适配器
│   ├── processors/       # 图片和优化处理器
│   ├── services/         # API服务
│   ├── orchestrators/    # 业务编排
│   └── interfaces/       # CLI和API接口
├── processed-images/     # 统一输出目录
├── docs/                 # 文档
└── .env                  # 设备配置
```

## 🍎 系统要求

- Node.js >= 18
- macOS（使用sips工具处理图片）
- MindReset设备及API凭据

## 📖 详细文档

- [开发路线图](docs/DEVELOPMENT_ROADMAP.md)
- [项目结构说明](docs/PROJECT_STRUCTURE.md)  
- [React系统规划](docs/REACT_SYSTEM_PLAN.md)
- [模块重构计划](docs/NEW_STRUCTURE_PLAN.md)