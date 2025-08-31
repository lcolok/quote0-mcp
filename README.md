# Quote0-MCP

智能新闻和组件生成系统，支持模块化架构和自动化部署。专为 MindReset 1-bit 黑白点阵式水墨屏设备打造的智能显示系统。

## 🚀 快速开始

### 一键部署（推荐）

在全新机器上，只需一个命令即可完成所有设置：

```bash
# 安装依赖
bun install

# 自动化部署所有服务
bun setup
```

这将自动完成：
- ✅ 环境检查（Docker、Bun等）
- ✅ 创建环境配置文件
- ✅ 启动必要的Docker服务
- ✅ 健康检查
- ✅ 提供使用指南

### 验证部署

```bash
# 检查服务状态
bun check

# 查看运行中的服务  
bun status

# 测试基本功能
bun widget:modular-news technology rss passthrough 1 json
```

## 🎯 核心特性

### 📊 图片处理能力
- 🏆 **双重优化**: 客户端对比度增强 + 服务端 ORDERED 抖动
- ✅ **实测验证**: 增强对比度显著提升清晰度和锐利度  
- ✨ **多种抖动算法**: Floyd-Steinberg、ORDERED 等可选
- 📹 **GIF支持**: 自动提取第一帧并优化
- 🖼️ **智能适配**: 保持比例，避免拉伸变形

### 🌤️ 智能天气组件
- 🎯 **零维护城市映射**: 基于WMO国际气象站代码标准，无需手动添加城市
- 💪 **强健网络机制**: 5次智能重试，渐进超时，100%成功率
- ⚡ **毫秒级响应**: 智能缓存系统，即时城市代码查找
- 🌐 **全国覆盖**: 支持34个省会城市及主要地区
- 🎨 **水墨屏优化**: 296x152像素完美适配，maximized样式

### 🏗️ 系统架构
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

### 3. 使用方法

#### 🌤️ 智能天气组件（推荐）
```bash
# 核心命令 - 零维护智能天气显示
npm run widget:weather                    # 默认：广州天气，白边框
npm run widget:weather 福州              # 指定城市：福州天气
npm run widget:weather 哈尔滨 1          # 黑边框：哈尔滨天气，黑色边框
npm run widget:weather 北京 0 smart      # 指定数据源：smart模式

# 参数说明：
# 参数1: 城市名称 (支持全国省会城市，如：广州、北京、上海、福州、哈尔滨等)
# 参数2: 边框颜色 - 0=白色, 1=黑色 (默认: 0)  
# 参数3: 数据源 - robust/smart/real (默认: robust，推荐)

# 更多城市示例
npm run widget:weather 石家庄            # 河北省会
npm run widget:weather 郑州              # 河南省会
npm run widget:weather 长春              # 吉林省会
npm run widget:weather 昆明              # 云南省会
npm run widget:weather 海珠区            # 自动识别为广州
```

#### 📊 图片处理工具
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

### 🌤️ 天气组件
- [智能天气组件使用指南](docs/WEATHER_WIDGET_GUIDE.md) - 完整功能说明和最佳实践
- [DynamicCityService架构设计](docs/DYNAMIC_CITY_SERVICE_ARCHITECTURE.md) - 零维护城市映射系统技术详解

### 🏗️ 系统架构
- [开发路线图](docs/DEVELOPMENT_ROADMAP.md)
- [项目结构说明](docs/PROJECT_STRUCTURE.md)  
- [React系统规划](docs/REACT_SYSTEM_PLAN.md)
- [代码重组计划](docs/CODE_REORGANIZATION_PLAN.md) - 模块化重构方案