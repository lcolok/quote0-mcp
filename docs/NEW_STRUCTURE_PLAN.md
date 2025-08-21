# Image Sender 模块重构方案

## 🎯 重构目标

将扁平的文件结构重构为分层的模块化架构，提高代码的可维护性、可扩展性和可测试性。

## 📁 新的目录结构

```
src/image-sender/
├── 📁 core/                    # 核心功能模块
│   ├── 📁 types/              # 类型定义
│   │   ├── device.ts          # 设备相关类型
│   │   ├── image.ts           # 图片相关类型
│   │   ├── optimization.ts    # 优化相关类型
│   │   ├── api.ts             # API相关类型
│   │   └── index.ts           # 类型导出
│   │
│   ├── 📁 config/             # 配置管理
│   │   ├── constants.ts       # 常量定义
│   │   ├── defaults.ts        # 默认配置
│   │   ├── device-profiles.ts # 设备配置文件
│   │   └── index.ts
│   │
│   ├── 📁 utils/              # 工具函数
│   │   ├── image-utils.ts     # 图片工具
│   │   ├── validation.ts      # 数据验证
│   │   ├── format.ts          # 格式化工具
│   │   ├── logger.ts          # 日志工具
│   │   └── index.ts
│   │
│   └── 📁 errors/             # 错误处理
│       ├── base.ts            # 基础错误类
│       ├── device-errors.ts   # 设备错误
│       ├── image-errors.ts    # 图片错误
│       └── index.ts
│
├── 📁 adapters/               # 适配器模块
│   ├── 📁 devices/            # 设备适配器
│   │   ├── base-adapter.ts    # 基础适配器
│   │   ├── mindreset-adapter.ts # MindReset适配器
│   │   ├── generic-eink-adapter.ts # 通用电子墨水屏
│   │   └── index.ts
│   │
│   ├── 📁 environments/       # 环境适配器
│   │   ├── env-loader.ts      # 环境变量加载
│   │   ├── config-loader.ts   # 配置文件加载
│   │   └── index.ts
│   │
│   └── index.ts
│
├── 📁 processors/             # 处理器模块
│   ├── 📁 image/              # 图片处理器
│   │   ├── base-processor.ts  # 基础处理器
│   │   ├── resize-processor.ts # 尺寸调整
│   │   ├── format-processor.ts # 格式转换
│   │   └── index.ts
│   │
│   ├── 📁 optimization/       # 优化处理器
│   │   ├── base-optimizer.ts  # 基础优化器
│   │   ├── monochrome-optimizer.ts # 单色屏优化
│   │   ├── contrast-optimizer.ts # 对比度优化
│   │   ├── dithering-optimizer.ts # 抖动优化
│   │   └── index.ts
│   │
│   ├── 📁 media/              # 媒体处理器
│   │   ├── gif-processor.ts   # GIF处理
│   │   ├── video-processor.ts # 视频处理（未来扩展）
│   │   └── index.ts
│   │
│   └── index.ts
│
├── 📁 services/               # 服务层
│   ├── 📁 api/                # API服务
│   │   ├── base-client.ts     # 基础客户端
│   │   ├── device-client.ts   # 设备API客户端
│   │   ├── upload-service.ts  # 上传服务
│   │   └── index.ts
│   │
│   ├── 📁 rendering/          # 渲染服务
│   │   ├── render-service.ts  # 渲染服务
│   │   ├── preview-service.ts # 预览服务
│   │   └── index.ts
│   │
│   └── index.ts
│
├── 📁 orchestrators/          # 编排器（高级业务逻辑）
│   ├── image-sender.ts        # 主要发送编排器
│   ├── batch-processor.ts     # 批量处理编排器
│   ├── pipeline-builder.ts    # 处理流水线构建器
│   └── index.ts
│
├── 📁 interfaces/             # 外部接口
│   ├── 📁 cli/                # 命令行接口
│   │   ├── commands/          # 命令定义
│   │   │   ├── send.ts        # 发送命令
│   │   │   ├── preview.ts     # 预览命令
│   │   │   ├── optimize.ts    # 优化命令
│   │   │   └── index.ts
│   │   ├── cli.ts             # CLI主程序
│   │   ├── parser.ts          # 参数解析
│   │   └── index.ts
│   │
│   ├── 📁 api/                # API接口（未来扩展）
│   │   ├── rest-api.ts        # REST API
│   │   ├── websocket-api.ts   # WebSocket API
│   │   └── index.ts
│   │
│   └── index.ts
│
├── 📁 plugins/                # 插件系统
│   ├── 📁 hooks/              # 钩子系统
│   │   ├── lifecycle-hooks.ts # 生命周期钩子
│   │   ├── processing-hooks.ts # 处理钩子
│   │   └── index.ts
│   │
│   ├── 📁 extensions/         # 扩展插件
│   │   ├── watermark-plugin.ts # 水印插件
│   │   ├── analytics-plugin.ts # 分析插件
│   │   └── index.ts
│   │
│   └── index.ts
│
├── 📁 __tests__/              # 测试文件
│   ├── 📁 unit/               # 单元测试
│   ├── 📁 integration/        # 集成测试
│   ├── 📁 fixtures/           # 测试数据
│   └── 📁 helpers/            # 测试辅助
│
├── 📁 docs/                   # 模块文档
│   ├── api.md                 # API文档
│   ├── architecture.md        # 架构文档
│   ├── examples.md            # 示例文档
│   └── README.md              # 模块说明
│
├── index.ts                   # 主入口文件
└── package.json               # 包配置文件
```

## 🔧 模块职责划分

### Core 模块
- **types/**: 所有TypeScript类型定义的集中管理
- **config/**: 配置管理，包括设备配置、默认值等
- **utils/**: 通用工具函数，可复用的业务无关逻辑
- **errors/**: 统一的错误处理和错误类型定义

### Adapters 模块
- **devices/**: 不同设备的适配器实现
- **environments/**: 环境配置的适配器（.env, 配置文件等）

### Processors 模块
- **image/**: 图片处理的各种处理器
- **optimization/**: 优化算法的处理器
- **media/**: 媒体文件（GIF、视频等）处理器

### Services 模块
- **api/**: API调用相关的服务
- **rendering/**: 渲染和预览相关的服务

### Orchestrators 模块
- 高级业务逻辑的编排
- 组合多个services和processors完成复杂任务

### Interfaces 模块
- **cli/**: 命令行接口的实现
- **api/**: HTTP API接口（未来扩展）

### Plugins 模块
- 插件系统，支持功能扩展
- 钩子系统，支持生命周期干预

## 📊 文件迁移映射

| 原文件 | 新位置 | 说明 |
|--------|--------|------|
| `types.ts` | `core/types/` | 拆分为多个类型文件 |
| `device-profiles.ts` | `core/config/device-profiles.ts` | 移到配置模块 |
| `env-loader.ts` | `adapters/environments/env-loader.ts` | 移到环境适配器 |
| `device-client.ts` | `services/api/device-client.ts` | 移到API服务 |
| `image-processor.ts` | `processors/image/` | 拆分为多个处理器 |
| `monochrome-optimizer.ts` | `processors/optimization/monochrome-optimizer.ts` | 移到优化处理器 |
| `eink-optimizer.ts` | `processors/optimization/dithering-optimizer.ts` | 重命名并移动 |
| `gif-processor.ts` | `processors/media/gif-processor.ts` | 移到媒体处理器 |
| `image-sender.ts` | `orchestrators/image-sender.ts` | 移到编排器 |
| `cli.ts` | `interfaces/cli/` | 拆分为多个命令文件 |

## 🚀 重构的优势

### 1. 可维护性
- 职责单一：每个模块只负责特定功能
- 依赖清晰：模块间依赖关系明确
- 易于定位：问题可以快速定位到具体模块

### 2. 可扩展性
- 插件系统：支持功能扩展
- 适配器模式：支持新设备类型
- 处理器架构：支持新的处理算法

### 3. 可测试性
- 模块隔离：每个模块可以独立测试
- 依赖注入：便于mock和测试
- 测试覆盖：结构化的测试组织

### 4. 团队协作
- 模块分工：不同开发者可以专注不同模块
- 代码复用：通用逻辑可以在多处复用
- 版本管理：模块化的版本控制策略

## 🎯 下一步行动

1. **创建新的目录结构**
2. **逐步迁移现有文件**
3. **更新导入/导出关系**
4. **添加适当的抽象层**
5. **完善错误处理**
6. **添加单元测试**
7. **更新文档**

这个新结构将使您的代码更加专业、可维护，并为未来的功能扩展打下坚实基础。