# AX模型热重载系统使用指南

## 🎯 概述

AX模型热重载系统实现了**零停机模型更新**，当你在标注系统中训练并激活新模型后，API服务会自动检测文件变化并重新加载模型，无需手动重启服务。

## 🔥 核心特性

### 1. 自动文件监控
- 监控模型文件：`ax-framework/models/production/latest.json`
- 使用Node.js `fs.watch` 实时检测文件变化
- 防抖机制（1秒）避免频繁重载

### 2. 零停机热重载
- 模型在运行时自动重新加载
- 不影响正在处理的请求
- 下一个请求自动使用新模型

### 3. 事件通知
- 成功重载事件：`reloaded`
- 重载失败事件：`reload-failed`
- 启动/停止事件：`started` / `stopped`

## 📁 架构设计

### 核心组件

```
┌─────────────────────────────────────────────┐
│  标注系统 (annotation-web)                   │
│  - 训练新模型                                │
│  - 激活版本 → 更新 latest.json               │
└──────────────────┬──────────────────────────┘
                   │
                   ↓ 文件变化
┌─────────────────────────────────────────────┐
│  ModelHotReloadManager                      │
│  - 监控 latest.json                         │
│  - 检测文件变化（fs.watch）                  │
│  - 防抖处理（1秒）                           │
└──────────────────┬──────────────────────────┘
                   │
                   ↓ 触发回调
┌─────────────────────────────────────────────┐
│  AxOptimizedNewsProcessorSimplified         │
│  - loadFromModelData(artifacts)             │
│  - 原子性替换模型                            │
│  - 更新版本号                                │
└──────────────────┬──────────────────────────┘
                   │
                   ↓ 模型已更新
┌─────────────────────────────────────────────┐
│  News API Service                           │
│  - 下一个请求自动使用新模型                  │
│  - 无需重启容器                              │
└─────────────────────────────────────────────┘
```

### 代码结构

```
src/react-widgets/services/
├── model-hot-reload-manager.ts         # 热重载管理器
└── ax-optimized-news-processor-simplified.ts  # AX处理器

src/react-widgets/core/
└── processing-modules.ts               # AX处理模块（集成热重载）

annotation-web/src/components/
└── TrainingPage.tsx                    # 标注页面（显示热重载提示）
```

## 🚀 使用流程

### 1. 训练和激活新模型

在标注系统 (http://localhost:3002/training) 中：

```bash
1. 点击"训练模型"按钮
2. 选择样本分数范围
3. 等待训练完成
4. 点击"激活"按钮
```

### 2. 自动热重载

当你点击"激活"后：

```
✅ 版本 v1.0.1 已激活！
🔥 模型将在下次请求时自动热重载，无需重启服务
```

服务器日志会显示：

```
🔄 开始重载模型: /app/ax-framework/models/production/latest.json
🔥 热重载成功: 版本 v1.0.1
📊 模型性能: 标题0.95, 摘要0.90
✅ 模型重载成功 (耗时 15ms)
🔥 模型已热重载: 版本 v1.0.1 at 2025-10-03T15:30:00.000Z
```

### 3. 验证模型生效

在 Playground 中测试：

```bash
1. 选择一条新闻
2. 点击"测试 AX 优化"
3. 查看优化结果（会使用最新模型）
```

或使用 API 测试：

```bash
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "dataSource": "rss",
    "processor": "ax-optimized",
    "index": 0,
    "renderer": "json"
  }'
```

## 🔧 技术细节

### ModelHotReloadManager

```typescript
export class ModelHotReloadManager extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceMs: number = 1000; // 防抖1秒

  async start(): Promise<void> {
    // 首次加载模型
    await this.reloadModel();

    // 启动文件监控
    this.watcher = watch(this.modelPath, async (eventType) => {
      if (eventType === 'change') {
        await this.handleFileChange();
      }
    });
  }

  private async reloadModel(): Promise<void> {
    const fileContent = await readFile(this.modelPath, 'utf-8');
    const modelData = JSON.parse(fileContent);

    // 调用回调函数加载模型
    await this.reloadCallback(modelData);

    this.emit('reloaded', { version, timestamp });
  }
}
```

### AxOptimizedProcessorSimplified

```typescript
export class AxOptimizedNewsProcessorSimplified {
  private optimizedProgram: OptimizationArtifacts['programs'] | null = null;
  private currentVersion: string = 'unknown';

  // 热重载入口
  loadFromModelData(artifacts: OptimizationArtifacts): boolean {
    // 原子性替换
    this.optimizedProgram = artifacts.programs;
    this.currentVersion = artifacts.metadata?.version || 'unknown';

    console.log(`🔥 热重载成功: 版本 ${this.currentVersion}`);
    return true;
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }
}
```

### 启动热重载

在 `AxOptimizedProcessingModule` 中：

```typescript
private async startHotReload() {
  const { ModelHotReloadManager } = await import('../services/model-hot-reload-manager.js');

  this.hotReloadManager = new ModelHotReloadManager(
    modelPath,
    async (modelData) => {
      // 热重载回调
      return this.processorInstance.loadFromModelData(modelData);
    }
  );

  // 监听事件
  this.hotReloadManager.on('reloaded', (event) => {
    console.log(`🔥 模型已热重载: 版本 ${event.version}`);
  });

  await this.hotReloadManager.start();
}
```

## 📊 性能指标

- **重载耗时**: 通常 < 20ms
- **防抖延迟**: 1秒（避免频繁重载）
- **内存开销**: 几乎无额外开销（只替换引用）
- **可用性**: 100%（零停机）

## 🛡️ 安全机制

### 1. 错误隔离
- 如果热重载失败，保留旧模型继续服务
- 错误日志记录但不中断服务

```typescript
try {
  await this.reloadModel();
} catch (error) {
  console.error(`❌ 模型热重载失败:`, error);
  this.emit('reload-failed', { error: error.message });
  // 保留旧模型继续运行
}
```

### 2. 原子性更新
- 使用单一赋值操作替换模型
- 避免中间状态

```typescript
// 原子性：一次性替换整个程序对象
this.optimizedProgram = artifacts.programs;
```

### 3. 防抖机制
- 避免文件保存时的多次触发
- 1秒内只重载一次

```typescript
if (now - this.lastReloadTime < this.debounceMs) {
  return; // 跳过
}
```

## 🔍 故障排除

### 问题1: 热重载未触发

**症状**: 激活新模型后，API仍使用旧模型

**检查步骤**:
```bash
# 1. 检查模型文件是否更新
docker exec quote0-news-api cat ax-framework/models/production/latest.json | grep version

# 2. 检查服务日志
docker-compose logs news-api | grep "热重载\|reload"

# 3. 检查文件监控是否启动
docker-compose logs news-api | grep "模型热重载已启动"
```

**解决方案**:
```bash
# 如果热重载未启动，重启API服务
docker-compose restart news-api
```

### 问题2: 重载失败

**症状**: 日志显示 `模型热重载失败`

**可能原因**:
1. 模型文件格式错误（JSON解析失败）
2. 文件权限问题
3. 磁盘空间不足

**检查**:
```bash
# 验证JSON格式
docker exec quote0-news-api sh -c "cat ax-framework/models/production/latest.json | jq ."

# 检查文件权限
docker exec quote0-news-api ls -l ax-framework/models/production/
```

### 问题3: 性能下降

**症状**: 重载后响应变慢

**可能原因**: 新模型质量下降或配置不当

**诊断**:
```bash
# 查看模型性能指标
docker-compose logs news-api | grep "模型性能"

# 对比旧版本
curl -s http://localhost:3001/api/ax-training/versions | jq '.data[] | select(.isActive==true)'
```

## 📝 最佳实践

### 1. 渐进式更新
```bash
# 在Playground中充分测试新模型
1. 激活新版本
2. 在Playground测试多条新闻
3. 验证质量符合预期
4. 再推广到生产使用
```

### 2. 版本管理
```bash
# 保留历史版本便于回滚
ls ax-framework/models/production/
# 输出：
# latest.json
# v1.0.0.json
# v1.0.1.json
```

### 3. 监控日志
```bash
# 实时监控热重载事件
docker-compose logs -f news-api | grep "🔥"
```

### 4. 定期清理
```bash
# 清理旧版本模型（保留最近5个）
# 避免磁盘空间占用
```

## 🎯 与旧方案对比

| 特性 | 旧方案（手动重启） | 新方案（热重载） |
|------|------------------|-----------------|
| 停机时间 | 5-10秒 | 0秒 |
| 操作步骤 | 2步（激活+重启） | 1步（激活） |
| 用户体验 | 需等待重启 | 无感知 |
| 风险 | 中等（重启可能失败） | 低（错误隔离） |
| 复杂度 | 简单 | 中等 |
| 适用场景 | 低频更新 | 高频迭代 |

## 🔮 未来改进

### 1. 灰度发布
```typescript
// 支持A/B测试：部分流量使用新模型
const shouldUseNewModel = Math.random() < 0.5; // 50%流量
```

### 2. 版本回滚
```typescript
// 一键回滚到上一个版本
POST /api/ax-training/rollback
```

### 3. 健康检查
```typescript
// 自动检测新模型质量
if (newModelPerformance < threshold) {
  console.warn('新模型性能不足，保留旧模型');
  return false; // 拒绝热重载
}
```

### 4. 分布式同步
```
# 多容器环境下同步模型更新
- 使用Redis Pub/Sub广播重载事件
- 所有容器同时更新
```

## 📚 相关文档

- [AX框架深入指南](./AX-Framework-Deep-Dive.md)
- [标注系统使用指南](./Annotation-System-Guide.md)
- [智能调度系统配置指南](./Scheduler-And-Timezone-Configuration-Guide.md)

## 🤝 贡献

如果你在使用中发现问题或有改进建议，欢迎提交Issue或PR。

---

**更新日期**: 2025-10-03
**作者**: MindReset Team
