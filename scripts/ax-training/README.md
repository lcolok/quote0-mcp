# AX训练数据版本管理系统

完整的训练数据版本控制、溯源追踪和模型管理系统。

## 📁 目录结构

```
ax-framework/
├── training-snapshots/          # 训练数据快照
│   ├── v1.0.0_2025-10-03/
│   │   ├── metadata.json        # 版本元数据
│   │   ├── samples.json         # 训练样本
│   │   └── source-mapping.json  # 溯源信息
│   └── ...
├── models/
│   ├── production/
│   │   ├── latest.json          # 生产模型
│   │   └── version.json         # 版本指针
│   └── snapshots/               # 模型快照
│       ├── v1.0.0.json
│       └── ...
└── compiled/
    └── ax-training-data.js      # 当前训练数据
```

## 🚀 快速开始

### 1. 从标注系统导出并创建快照

```bash
bun run scripts/ax-training/export-from-annotation.ts \
  --version=v1.0.0 \
  --desc="初始版本，包含5条高质量标注样本" \
  --min-score=70 \
  --max-score=100 \
  --tags=technology,initial \
  --by=admin
```

**参数说明:**
- `--version`: 版本号（必填，建议使用语义化版本号）
- `--desc`: 版本描述
- `--min-score`: 最低质量分数（默认0）
- `--max-score`: 最高质量分数（默认100）
- `--tags`: 标签（逗号分隔）
- `--by`: 创建者（默认admin）

### 2. 查看所有版本

```bash
# 列出所有版本
bun run scripts/ax-training/list-versions.ts

# 查看特定版本详情
bun run scripts/ax-training/list-versions.ts --version=v1.0.0

# 详细信息（包含样本溯源）
bun run scripts/ax-training/list-versions.ts --version=v1.0.0 --verbose
```

### 3. 激活版本

```bash
bun run scripts/ax-training/activate-version.ts --version=v1.0.0
```

激活后会：
- 更新 `ax-framework/compiled/ax-training-data.js`
- 更新版本指针 `models/production/version.json`
- 显示版本差异对比

### 4. 训练模型

```bash
# 仅训练（不部署）
bun run scripts/ax-training/train-model.ts --version=v1.0.0

# 训练并自动部署到生产环境
bun run scripts/ax-training/train-model.ts --version=v1.0.0 --deploy
```

训练完成后：
- 模型保存到 `models/snapshots/v1.0.0.json`
- 如果使用 `--deploy`，自动更新到 `models/production/latest.json`
- 需要重启API服务: `docker-compose restart news-api`

## 📊 完整工作流示例

### 场景1: 创建第一个版本

```bash
# 1. 从标注系统导出数据并创建快照
bun run scripts/ax-training/export-from-annotation.ts \
  --version=v1.0.0 \
  --desc="初始版本" \
  --min-score=80

# 2. 激活版本
bun run scripts/ax-training/activate-version.ts --version=v1.0.0

# 3. 训练并部署模型
bun run scripts/ax-training/train-model.ts --version=v1.0.0 --deploy

# 4. 重启API服务
docker-compose restart news-api
```

### 场景2: 增量更新训练数据

```bash
# 1. 标注更多新闻（通过Web界面）
open http://localhost:3002/annotate

# 2. 导出新版本（包含之前的数据）
bun run scripts/ax-training/export-from-annotation.ts \
  --version=v1.1.0 \
  --desc="新增10条科技类新闻" \
  --min-score=70

# 3. 查看版本差异
bun run scripts/ax-training/activate-version.ts --version=v1.1.0
# 会显示与 v1.0.0 的差异

# 4. 激活新版本
确认后按 y，或重新运行激活命令

# 5. 重新训练
bun run scripts/ax-training/train-model.ts --version=v1.1.0 --deploy

# 6. 重启服务
docker-compose restart news-api
```

### 场景3: 版本回滚

```bash
# 1. 查看所有版本
bun run scripts/ax-training/list-versions.ts

# 2. 回滚到之前的版本
bun run scripts/ax-training/activate-version.ts --version=v1.0.0

# 3. 使用之前的模型
cp ax-framework/models/snapshots/v1.0.0.json \
   ax-framework/models/production/latest.json

# 4. 重启服务
docker-compose restart news-api
```

## 📋 版本元数据说明

每个版本快照包含三个文件：

### metadata.json - 版本元数据
```json
{
  "version": "v1.0.0",
  "createdAt": "2025-10-03T18:30:00.000Z",
  "createdBy": "admin",
  "description": "初始版本",
  "stats": {
    "totalSamples": 15,
    "highQuality": 12,
    "mediumQuality": 3,
    "lowQuality": 0,
    "avgScore": 85.3
  },
  "sourceBreakdown": {
    "solidot": 5,
    "36kr": 4,
    "hackernews": 3
  },
  "previousVersion": null,
  "tags": ["technology", "initial"]
}
```

### samples.json - 训练样本
包含完整的训练数据，每条样本包括：
- 原始新闻内容
- 优化后的标题和摘要
- 质量评分
- 标注信息

### source-mapping.json - 溯源信息
记录每个样本的来源：
- 新闻ID和fingerprint
- 标注时间和标注者
- 原始RSS源和链接
- 质量等级

## 🔍 溯源追踪

### 查找特定新闻的训练记录

```bash
# 查看版本的溯源信息
bun run scripts/ax-training/list-versions.ts --version=v1.0.0 --verbose
```

输出示例:
```
🔍 样本溯源 (前10条):
   #1: 千禧一代癌症发病率在上升... (分数: 80, 来源: solidot)
   #2: Adobe Reader膨胀至700MB... (分数: 85, 来源: 36kr)
   ...
```

### 版本对比

```bash
# 激活版本时会自动显示差异
bun run scripts/ax-training/activate-version.ts --version=v1.1.0
```

输出示例:
```
🔍 版本差异:
   样本数变化: +10
   分数变化: +2.3
   新增样本: 12
   移除样本: 2
```

## 🎯 最佳实践

### 版本号规范

建议使用语义化版本号：
- `v1.0.0` - 初始版本
- `v1.1.0` - 增加新训练样本
- `v1.2.0` - 调整质量标准
- `v2.0.0` - 重大变更（如更换数据源）

### 标注质量控制

1. **最低分数阈值**: 建议 `--min-score=70`，确保训练数据质量
2. **定期审核**: 每次导出前审查标注样本
3. **增量更新**: 小步快跑，每次增加10-20条样本

### 模型更新频率

- **初期**: 每标注50条就更新一次
- **成熟期**: 每标注200-500条更新
- **稳定期**: 每月或季度更新

### 回滚策略

出现以下情况应立即回滚：
- 新模型性能下降 >5%
- 用户反馈质量明显降低
- 训练数据发现质量问题

## 🛠️ 故障排除

### 问题: 导出失败 "没有符合条件的样本"

**原因**: 分数范围内没有已标注样本

**解决**:
```bash
# 1. 检查现有标注
curl -s http://localhost:3001/api/annotation/statistics | jq .

# 2. 降低分数阈值
bun run scripts/ax-training/export-from-annotation.ts \
  --version=v1.0.0 --min-score=0
```

### 问题: 激活版本后API服务不生效

**原因**: 需要重启服务加载新数据

**解决**:
```bash
docker-compose restart news-api
```

### 问题: 版本已存在

**原因**: 版本号重复

**解决**: 使用新的版本号，或删除旧版本目录
```bash
# 删除旧版本（谨慎操作）
rm -rf ax-framework/training-snapshots/v1.0.0_*
```

## 📚 API集成

### 程序化使用

```typescript
import { SnapshotManager } from './scripts/ax-training/snapshot-manager.js';

const manager = new SnapshotManager();
await manager.initialize();

// 列出版本
const versions = await manager.listVersions();

// 获取详情
const details = await manager.getVersionDetails('v1.0.0');

// 激活版本
await manager.activateVersion('v1.0.0');

// 版本对比
const diff = await manager.compareVersions('v1.0.0', 'v1.1.0');
```

## 📖 相关文档

- [标注系统使用指南](../../docs/Annotation-System-Guide.md)
- [AX框架深入指南](../../docs/AX-Framework-Deep-Dive.md)
- [新闻处理架构演进](../../docs/News-Processing-Architecture-Evolution.md)
