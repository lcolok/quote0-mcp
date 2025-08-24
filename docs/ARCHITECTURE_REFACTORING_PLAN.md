# 🏗️ Quote0-MCP 架构重构规划方案

## 📋 文档信息

- **创建日期**: 2025-08-24
- **版本**: v1.0
- **作者**: MindReset Team
- **状态**: 规划阶段

## 🎯 重构目标

基于当前项目的演进方向和AI驱动的e-ink设备内容生成需求，本方案旨在建立一个**高度可维护、可扩展的模块化架构**，特别针对AX框架集成、智能组件系统和设备集成能力进行优化。

## 📊 当前架构问题分析

### 🔍 主要问题识别

#### 1. **模块耦合度过高**
- `react-widgets/` 目录承载过多职责（组件、服务、AI处理、字体系统）
- services 目录混合了不同领域的服务（天气、新闻、AI处理）
- 字体系统分散在多个文件中，缺乏统一管理

#### 2. **AX框架集成混乱**
- AX相关处理器有3个版本但缺乏清晰分层：
  - `ax-optimized-news-processor.ts` (完整版，有TypeScript冲突)
  - `ax-optimized-news-processor-simplified.ts` (简化版)
  - `ax-news-processor.ts` (基础版)
- 训练数据和配置文件散落在不同目录
- `ax-optimization-artifacts/` 与核心代码分离，管理不便

#### 3. **CLI和业务逻辑耦合**
- CLI实现与业务逻辑混合在一起
- 缺乏统一的命令行接口抽象
- 命令参数解析逻辑分散

#### 4. **资源管理不统一**
- 字体文件直接放在根目录assets下
- 生成图片散布在processed-images的各个子目录
- 配置文件(.env、各类json)位置不统一

#### 5. **测试和工具混乱**
- 测试文件与业务代码混合
- 脚本工具分散在scripts目录，职责不清
- 缺乏统一的开发工具链

## 🏗️ 新架构设计

### 📁 优化后的目录结构

```
quote0-mcp/
├── 📦 packages/                          # 模块化包管理
│   ├── core/                            # 核心领域模型
│   │   ├── types/                       # 通用类型定义
│   │   │   ├── index.ts                 # 导出所有类型
│   │   │   ├── common.ts                # 通用类型
│   │   │   ├── device.ts                # 设备相关类型
│   │   │   └── content.ts               # 内容相关类型
│   │   ├── events/                      # 事件系统
│   │   │   ├── event-bus.ts             # 事件总线
│   │   │   ├── event-types.ts           # 事件类型定义
│   │   │   └── handlers/                # 事件处理器
│   │   ├── contracts/                   # 接口契约
│   │   │   ├── ai-processor.ts          # AI处理器接口
│   │   │   ├── widget-plugin.ts         # 组件插件接口
│   │   │   └── data-provider.ts         # 数据提供者接口
│   │   └── utils/                       # 核心工具函数
│   │
│   ├── ai-processing/                   # AI处理引擎
│   │   ├── engines/                     # 各种AI引擎
│   │   │   ├── ax-framework/           # AX框架专门目录
│   │   │   │   ├── core/               # AX核心逻辑
│   │   │   │   │   ├── ax-engine.ts    # AX引擎主类
│   │   │   │   │   ├── config.ts       # AX配置管理
│   │   │   │   │   └── types.ts        # AX专用类型
│   │   │   │   ├── processors/         # 各种AX处理器
│   │   │   │   │   ├── base-processor.ts
│   │   │   │   │   ├── news-processor.ts
│   │   │   │   │   └── content-processor.ts
│   │   │   │   ├── training/           # 训练相关
│   │   │   │   │   ├── trainer.ts      # 训练器
│   │   │   │   │   ├── evaluator.ts    # 评估器
│   │   │   │   │   └── data-manager.ts # 数据管理
│   │   │   │   └── artifacts/          # 训练产物
│   │   │   │       ├── manager.ts      # 产物管理器
│   │   │   │       └── serializer.ts   # 序列化器
│   │   │   ├── llm-workflows/          # LLM工作流
│   │   │   │   ├── workflow-engine.ts  # 工作流引擎
│   │   │   │   ├── step-processors/    # 步骤处理器
│   │   │   │   └── validators/         # 验证器
│   │   │   └── content-processors/     # 内容处理器
│   │   │       ├── text-processor.ts   # 文本处理
│   │   │       ├── summarizer.ts       # 摘要生成
│   │   │       └── optimizer.ts        # 内容优化
│   │   ├── services/                   # AI服务层
│   │   │   ├── llm-service.ts          # LLM服务
│   │   │   ├── cache-service.ts        # 缓存服务
│   │   │   └── api-client.ts           # API客户端
│   │   └── training/                   # 训练管理
│   │       ├── data/                   # 训练数据
│   │       │   ├── datasets/           # 数据集
│   │       │   ├── samples/            # 样本数据
│   │       │   └── validators/         # 数据验证
│   │       ├── feedback/               # 人类反馈
│   │       │   ├── collectors/         # 反馈收集器
│   │       │   ├── analyzers/          # 反馈分析器
│   │       │   └── web-ui/            # Web反馈界面
│   │       └── models/                 # 模型管理
│   │           ├── registry/           # 模型注册表
│   │           ├── versioning/         # 版本管理
│   │           └── storage/            # 存储管理
│   │
│   ├── widget-system/                  # 组件系统
│   │   ├── core/                       # 组件核心框架
│   │   │   ├── plugin-engine/          # 插件引擎
│   │   │   │   ├── plugin-manager.ts   # 插件管理器
│   │   │   │   ├── plugin-loader.ts    # 插件加载器
│   │   │   │   └── plugin-registry.ts  # 插件注册表
│   │   │   ├── rendering/              # 渲染引擎
│   │   │   │   ├── react-renderer.ts   # React渲染器
│   │   │   │   ├── image-generator.ts  # 图像生成器
│   │   │   │   └── layout-engine.ts    # 布局引擎
│   │   │   └── font-system/            # 字体系统
│   │   │       ├── font-manager.ts     # 字体管理器
│   │   │       ├── font-loader.ts      # 字体加载器
│   │   │       ├── smart-selector.ts   # 智能字体选择
│   │   │       └── server/             # 字体服务器
│   │   ├── widgets/                    # 具体组件
│   │   │   ├── weather/                # 天气组件包
│   │   │   │   ├── components/         # React组件
│   │   │   │   │   ├── WeatherWidget.tsx
│   │   │   │   │   ├── MiniWeatherWidget.tsx
│   │   │   │   │   └── CompactWeatherWidget.tsx
│   │   │   │   ├── services/           # 天气数据服务
│   │   │   │   │   ├── weather-service.ts
│   │   │   │   │   ├── amap-service.ts
│   │   │   │   │   └── multi-source-service.ts
│   │   │   │   ├── plugins/            # 天气插件
│   │   │   │   │   └── weather-plugin.ts
│   │   │   │   ├── types/              # 天气相关类型
│   │   │   │   └── tests/              # 测试
│   │   │   └── news/                   # 新闻组件包
│   │   │       ├── components/
│   │   │       │   └── NewsWidget.tsx
│   │   │       ├── services/
│   │   │       │   ├── rss-service.ts
│   │   │       │   └── news-processor.ts
│   │   │       ├── plugins/
│   │   │       │   └── news-plugin.ts
│   │   │       ├── types/
│   │   │       └── tests/
│   │   └── shared/                     # 共享组件
│   │       ├── ui/                     # UI组件库
│   │       │   ├── Card.tsx
│   │       │   ├── Button.tsx
│   │       │   └── Layout.tsx
│   │       └── utils/                  # 工具函数
│   │           ├── formatting.ts
│   │           └── validation.ts
│   │
│   ├── device-integration/             # 设备集成
│   │   ├── image-processing/           # 图像处理
│   │   │   ├── processors/             # 各种处理器
│   │   │   │   ├── base-processor.ts
│   │   │   │   ├── gif-processor.ts
│   │   │   │   └── optimization-processor.ts
│   │   │   ├── optimizers/             # 优化器
│   │   │   │   ├── monochrome-optimizer.ts
│   │   │   │   ├── dithering-optimizer.ts
│   │   │   │   └── compression-optimizer.ts
│   │   │   └── formats/                # 格式转换
│   │   │       ├── format-converter.ts
│   │   │       └── format-validator.ts
│   │   ├── device-clients/             # 设备客户端
│   │   │   ├── base-client.ts          # 基础客户端
│   │   │   ├── mindreset-client.ts     # MindReset设备客户端
│   │   │   └── protocol-handler.ts     # 协议处理
│   │   └── protocols/                  # 通信协议
│   │       ├── http-protocol.ts        # HTTP协议
│   │       └── websocket-protocol.ts   # WebSocket协议
│   │
│   └── cli-tools/                      # 命令行工具
│       ├── core/                       # CLI框架
│       │   ├── cli-engine.ts           # CLI引擎
│       │   ├── command-parser.ts       # 命令解析器
│       │   └── help-generator.ts       # 帮助生成器
│       ├── commands/                   # 命令实现
│       │   ├── widget-commands.ts      # 组件命令
│       │   ├── training-commands.ts    # 训练命令
│       │   └── device-commands.ts      # 设备命令
│       └── interfaces/                 # 用户接口
│           ├── interactive-cli.ts      # 交互式CLI
│           └── batch-cli.ts            # 批处理CLI
│
├── 🌐 apps/                            # 应用程序
│   ├── feedback-web-ui/               # Web反馈界面
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── widget-preview/                # 组件预览应用
│       ├── src/
│       ├── package.json
│       └── next.config.js
│
├── 📊 data/                           # 数据目录
│   ├── models/                        # AI模型和训练产物
│   │   ├── ax-optimization-artifacts/ # AX优化产物
│   │   ├── pretrained/                # 预训练模型
│   │   └── checkpoints/               # 检查点
│   ├── training/                      # 训练数据
│   │   ├── datasets/                  # 数据集
│   │   ├── samples/                   # 样本数据
│   │   └── validation/                # 验证数据
│   ├── feedback/                      # 用户反馈数据
│   │   ├── human-feedback/            # 人类反馈
│   │   └── web-feedback-data/         # Web反馈数据
│   └── cache/                         # 缓存数据
│       ├── api-cache/                 # API缓存
│       └── model-cache/               # 模型缓存
│
├── 🎨 assets/                         # 静态资源
│   ├── fonts/                         # 字体文件
│   │   ├── pixel-fonts/               # 像素字体
│   │   └── system-fonts/              # 系统字体
│   ├── icons/                         # 图标资源
│   │   └── weather-icons/             # 天气图标
│   └── templates/                     # 模板文件
│       ├── widget-templates/          # 组件模板
│       └── report-templates/          # 报告模板
│
├── 📁 outputs/                        # 输出目录
│   ├── images/                        # 生成的图像
│   │   ├── widgets/                   # 组件图像
│   │   ├── enhanced/                  # 增强图像
│   │   └── processed/                 # 处理后图像
│   ├── reports/                       # 分析报告
│   │   ├── training-reports/          # 训练报告
│   │   └── performance-reports/       # 性能报告
│   └── logs/                          # 日志文件
│       ├── application.log            # 应用日志
│       ├── training.log               # 训练日志
│       └── error.log                  # 错误日志
│
├── 🔧 tools/                          # 开发工具
│   ├── scripts/                       # 脚本工具
│   │   ├── build/                     # 构建脚本
│   │   ├── dev/                       # 开发脚本
│   │   └── deployment/                # 部署脚本
│   ├── dev-servers/                   # 开发服务器
│   │   ├── font-server/               # 字体服务器
│   │   └── preview-server/            # 预览服务器
│   └── migration/                     # 迁移工具
│       ├── migrate-structure.sh       # 结构迁移
│       └── update-imports.sh          # 导入更新
│
├── 📚 docs/                           # 文档
│   ├── architecture/                  # 架构文档
│   │   ├── overview.md                # 架构概述
│   │   ├── design-decisions.md        # 设计决策
│   │   └── migration-guide.md         # 迁移指南
│   ├── api/                           # API文档
│   │   ├── ai-processing.md           # AI处理API
│   │   ├── widget-system.md           # 组件系统API
│   │   └── device-integration.md      # 设备集成API
│   └── guides/                        # 使用指南
│       ├── getting-started.md         # 入门指南
│       ├── plugin-development.md      # 插件开发
│       └── training-guide.md          # 训练指南
│
└── 🏠 config/                         # 配置文件
    ├── environments/                  # 环境配置
    │   ├── .env.development           # 开发环境
    │   ├── .env.production            # 生产环境
    │   └── .env.test                  # 测试环境
    ├── build/                         # 构建配置
    │   ├── tsconfig.json              # TypeScript配置
    │   ├── webpack.config.js          # Webpack配置
    │   └── vite.config.ts             # Vite配置
    └── deployment/                    # 部署配置
        ├── docker/                    # Docker配置
        └── k8s/                       # Kubernetes配置
```

## 🚀 具体重构建议和迁移方案

### 🎯 第一阶段：核心模块分离 (1-2周)

#### 1. **AI处理引擎独立化**
```bash
# 创建独立的AI处理包
mkdir -p packages/ai-processing/engines/ax-framework/{core,processors,training,artifacts}
mkdir -p packages/ai-processing/training/{data,feedback,models}

# 迁移AX相关文件
mv src/react-widgets/services/ax-optimized-news-processor.ts packages/ai-processing/engines/ax-framework/processors/
mv src/react-widgets/services/ax-optimized-news-processor-simplified.ts packages/ai-processing/engines/ax-framework/processors/
mv src/react-widgets/services/ax-news-processor.ts packages/ai-processing/engines/ax-framework/processors/
mv src/react-widgets/services/ax-inspired-processor.ts packages/ai-processing/engines/ax-framework/processors/

# 迁移训练相关文件
mv ax-optimization-artifacts packages/ai-processing/training/models/
mv scripts/ax-training-data.ts packages/ai-processing/training/data/
mv scripts/ax-training-demo.ts packages/ai-processing/training/data/
mv scripts/continuous-training.ts packages/ai-processing/training/
mv scripts/create-pretrained-model.ts packages/ai-processing/training/

# 迁移反馈系统
mv src/feedback-ui packages/ai-processing/training/feedback/web-ui
mv scripts/human-feedback-system.ts packages/ai-processing/training/feedback/
mv web-feedback-data packages/ai-processing/training/feedback/data
```

**重构收益**：
- ✅ AX框架逻辑统一管理
- ✅ 训练系统模块化
- ✅ 人类反馈系统集成

#### 2. **组件系统重构**
```bash
# 按领域分离组件
mkdir -p packages/widget-system/widgets/{weather,news}/{components,services,plugins,types,tests}
mkdir -p packages/widget-system/core/{plugin-engine,rendering,font-system}

# 迁移天气相关文件
mv src/react-widgets/services/weather-service.ts packages/widget-system/widgets/weather/services/
mv src/react-widgets/services/amap-weather-service.ts packages/widget-system/widgets/weather/services/
mv src/react-widgets/services/multi-source-weather-service.ts packages/widget-system/widgets/weather/services/
mv src/react-widgets/services/dynamic-city-service.ts packages/widget-system/widgets/weather/services/
mv src/react-widgets/components/*Weather*.tsx packages/widget-system/widgets/weather/components/
mv src/react-widgets/plugins/weather-plugin.ts packages/widget-system/widgets/weather/plugins/

# 迁移新闻相关文件  
mv src/react-widgets/plugins/news-plugin.ts packages/widget-system/widgets/news/plugins/
mv src/react-widgets/components/NewsWidget.tsx packages/widget-system/widgets/news/components/

# 迁移核心系统
mv src/react-widgets/core/* packages/widget-system/core/plugin-engine/
mv src/react-widgets/font-loader.ts packages/widget-system/core/font-system/
mv src/react-widgets/enhanced-font-loader.ts packages/widget-system/core/font-system/
mv src/react-widgets/local-font-server.ts packages/widget-system/core/font-system/server/
mv src/react-widgets/renderer.ts packages/widget-system/core/rendering/
```

**重构收益**：
- ✅ 组件按功能域分离
- ✅ 字体系统统一管理
- ✅ 渲染引擎独立化

### 🎯 第二阶段：依赖管理优化 (1周)

#### 3. **包管理结构**
```json
// 根目录 package.json
{
  "name": "quote0-mcp",
  "version": "2.0.0",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "dependencies": {
    "@quote0/core": "workspace:*",
    "@quote0/ai-processing": "workspace:*", 
    "@quote0/widget-system": "workspace:*",
    "@quote0/device-integration": "workspace:*",
    "@quote0/cli-tools": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsup": "^8.0.0"
  },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "widget:weather": "node packages/cli-tools/dist/commands/widget-commands.js weather",
    "widget:news": "node packages/cli-tools/dist/commands/widget-commands.js news"
  }
}
```

#### 4. **模块接口标准化**
```typescript
// packages/core/contracts/ai-processor.ts
export interface AIProcessor<TInput, TOutput> {
  process(input: TInput): Promise<TOutput>;
  train?(data: TrainingData[]): Promise<TrainingResult>;
  evaluate?(testData: TestData[]): Promise<EvaluationResult>;
  saveModel?(path: string): Promise<void>;
  loadModel?(path: string): Promise<void>;
}

// packages/core/contracts/widget-plugin.ts  
export interface WidgetPlugin<TData, TConfig> {
  readonly meta: PluginMeta;
  readonly dataProvider: WidgetDataProvider<TData>;
  render(data: TData, config: TConfig): Promise<WidgetRenderResult>;
  validateConfig(config: TConfig): ValidationResult;
  getCliOptions(): CliOption[];
}

// packages/core/contracts/data-provider.ts
export interface WidgetDataProvider<TData> {
  getSources(): string[];
  getDefaultSource(): string;
  getSourceDescription(source: string): string;
  getData(source: string, params: any): Promise<TData>;
  validateParams(params: any): boolean;
}
```

### 🎯 第三阶段：配置和资源管理 (3-5天)

#### 5. **统一配置管理**
```bash
mkdir -p config/{environments,build,deployment}

# 迁移配置文件
mv .env config/environments/
echo "# Development Environment" > config/environments/.env.development
echo "# Production Environment" > config/environments/.env.production
echo "# Test Environment" > config/environments/.env.test

# 迁移构建配置
mv tsconfig.json config/build/
mv package.json package.json.backup
# 创建新的package.json（见上面的示例）
```

#### 6. **资源重新组织**
```bash
# 统一资源管理
mkdir -p assets/{fonts/{pixel-fonts,system-fonts},icons/weather-icons,templates/{widget-templates,report-templates}}
mkdir -p data/{models,training,feedback,cache}
mkdir -p outputs/{images/{widgets,enhanced,processed},reports,logs}

# 迁移现有资源
mv assets/fonts/* assets/fonts/pixel-fonts/
mv processed-images/* outputs/images/
mv ax-optimization-artifacts data/models/
mv web-feedback-data data/feedback/
```

#### 7. **CLI系统重构**
```bash
mkdir -p packages/cli-tools/{core,commands,interfaces}

# 迁移CLI相关文件
mv src/react-widgets/cli/* packages/cli-tools/commands/
mv scripts/* tools/scripts/

# 创建统一CLI入口
cat > packages/cli-tools/core/cli-engine.ts << 'EOF'
import { Command } from 'commander';
import { WidgetCommands } from '../commands/widget-commands.js';
import { TrainingCommands } from '../commands/training-commands.js';

export class CLIEngine {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  private setupCommands() {
    // Widget commands
    const widgetCommands = new WidgetCommands();
    this.program.addCommand(widgetCommands.getCommand());

    // Training commands  
    const trainingCommands = new TrainingCommands();
    this.program.addCommand(trainingCommands.getCommand());
  }

  async run(args: string[]) {
    await this.program.parseAsync(args);
  }
}
EOF
```

## 📋 迁移执行计划

### **Phase 1: 准备阶段 (2-3天)**
1. **🔍 代码依赖分析**
   - 使用工具分析模块间依赖关系
   - 识别循环依赖和紧耦合点
   - 制定解耦策略

2. **📝 接口定义**
   - 设计各模块间的契约接口
   - 定义数据流和控制流
   - 创建类型定义文件

3. **🧪 测试套件准备**
   - 为现有功能创建回归测试
   - 建立自动化测试流水线
   - 确保重构过程质量

### **Phase 2: 逐步迁移 (1-2周)**  
1. **🏗️ 基础框架建立**
   - 创建新的包结构
   - 设置工作空间配置
   - 建立构建和开发流程

2. **🔄 模块逐个迁移**
   - 按依赖顺序迁移模块
   - 核心模块 → AI处理 → 组件系统 → CLI工具
   - 每个模块迁移后进行功能验证

3. **🔗 接口适配**
   - 更新模块间调用关系
   - 统一错误处理机制
   - 优化性能瓶颈

### **Phase 3: 验证优化 (3-5天)**
1. **✅ 功能验证**
   - 确保所有现有功能正常工作
   - 执行端到端测试
   - 验证CLI命令兼容性

2. **📊 性能测试**
   - 对比重构前后性能表现
   - 优化构建速度和运行时性能
   - 确保资源使用合理

3. **📚 文档更新**
   - 更新架构和使用文档
   - 创建迁移指南
   - 培训开发团队

## 🎁 重构收益评估

### **立即收益**
- ✅ **更清晰的模块边界** - 每个包职责单一明确，易于理解和维护
- ✅ **更好的代码复用** - 组件可独立开发测试，减少重复代码
- ✅ **更容易的并行开发** - 团队可分工协作不同模块，提高开发效率
- ✅ **更强的类型安全** - 统一的接口定义，减少运行时错误

### **长期收益**
- 🚀 **更快的构建速度** - 增量构建和缓存优化，预计提升50%
- 🔧 **更简单的依赖管理** - 版本控制和升级更容易，减少依赖冲突
- 📈 **更好的可扩展性** - 新功能可插件化方式添加，影响面最小
- 🏗️ **更强的架构弹性** - 模块化设计便于未来技术栈迁移

### **量化指标**
- **开发效率提升**: 30-40% (模块边界清晰，并行开发)
- **维护成本降低**: 40-50% (职责分离明确，问题定位精准)
- **构建速度提升**: 50-60% (增量构建和缓存优化)
- **代码复用率提升**: 60-70% (共享组件和工具函数)

## 🚧 风险评估与应对

### **主要风险**
1. **🔄 迁移复杂度高** - 大量文件需要重新组织
   - **应对**: 分阶段迁移，每个阶段验证功能完整性

2. **⚡ 短期开发效率下降** - 开发者需要适应新结构
   - **应对**: 提供详细文档和培训，设置过渡期

3. **🐛 引入新的Bug** - 大规模重构可能导致问题
   - **应对**: 完善的测试覆盖，严格的代码审查

### **缓解策略**
- 🧪 **完善测试覆盖** - 确保重构前后功能一致性
- 📚 **详细文档支持** - 提供完整的迁移和使用指南
- 👥 **团队培训计划** - 帮助开发者快速适应新架构
- 🔄 **渐进式迁移** - 保持系统可用性，降低风险

## 📅 时间计划

| 阶段 | 时间 | 主要任务 | 里程碑 |
|-----|------|----------|--------|
| **准备阶段** | 2-3天 | 依赖分析、接口设计、测试准备 | 完成设计文档 |
| **第一阶段** | 1-2周 | 核心模块分离、AI引擎独立化 | 模块结构建立 |
| **第二阶段** | 1周 | 依赖管理优化、接口标准化 | 包管理完善 |
| **第三阶段** | 3-5天 | 配置管理、资源重组 | 资源统一管理 |
| **验证阶段** | 3-5天 | 功能验证、性能测试、文档更新 | 迁移完成 |

## 🎯 实施建议

### **优先级策略**
1. **🔥 高优先级**: AI处理引擎分离 (核心业务价值)
2. **⚡ 中优先级**: 组件系统重构 (用户体验相关)
3. **📦 低优先级**: 资源和配置管理 (开发体验相关)

### **成功关键因素**
- 🎯 **明确的目标和范围** - 避免范围蔓延
- 👥 **团队的充分参与** - 确保所有人理解新架构
- 🧪 **完善的测试策略** - 保证重构质量
- 📈 **持续的进度跟踪** - 及时发现和解决问题

## 📝 结论

这个重构方案特别适合当前的**AI驱动的e-ink设备内容生成**场景，通过模块化架构设计，既保持了现有功能的完整性，又为未来的AI能力扩展和新组件开发奠定了坚实基础。

重构后的架构将显著提升项目的可维护性、可扩展性和开发效率，为团队长期发展提供强有力的技术支撑。

---

**文档维护**：本文档将随着重构进展持续更新，请确保团队成员及时同步最新版本。