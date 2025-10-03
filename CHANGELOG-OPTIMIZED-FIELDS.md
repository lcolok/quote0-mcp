# 标注系统优化内容字段更新日志

## 版本 2.2.0 - 2025-10-03

### 🎯 核心改进

#### 新增优化内容字段

为标注系统添加"优化后内容"字段，用于存储人工标注的优化结果，作为AX模型训练的目标输出。

### 📊 数据结构变更

#### 数据库 Schema

**表**: `quality_annotations`

新增字段：
- `optimized_title` TEXT - 优化后的标题
- `optimized_summary` TEXT - 优化后的摘要
- `optimized_content` TEXT - 优化后的正文（可选）

```sql
ALTER TABLE quality_annotations
ADD COLUMN IF NOT EXISTS optimized_title TEXT,
ADD COLUMN IF NOT EXISTS optimized_summary TEXT,
ADD COLUMN IF NOT EXISTS optimized_content TEXT;
```

#### TypeScript 接口

**文件**: `annotation-web/src/types/index.ts`, `src/api/annotation-api.ts`

```typescript
export interface QualityAnnotation {
  // ... 原有字段 ...

  // 新增：优化后的内容（用于训练）
  optimized_title?: string;      // 优化后的标题
  optimized_summary?: string;    // 优化后的摘要
  optimized_content?: string;    // 优化后的正文（可选）
}
```

**文件**: `annotation-web/src/types/index.ts`

```typescript
export interface TrainingSample {
  input: {
    title: string;
    description?: string;
    content?: string;  // 新增：原始正文
  };
  output: {
    // ... 原有字段 ...

    // 新增：优化后的内容（AX训练目标）
    optimizedTitle?: string;     // 优化后的标题
    optimizedSummary?: string;   // 优化后的摘要
    optimizedContent?: string;   // 优化后的正文
  };
}
```

### 🔧 API 变更

#### 后端 API

**文件**: `src/api/annotation-api.ts`

所有标注提交端点已更新，支持新字段：

1. `POST /api/annotation/news/:id/annotate` - 标准标注
2. `POST /api/annotation/batch` - 批量标注

INSERT 语句更新为包含 17 个参数（原 14 个 + 3 个优化字段）

#### 前端组件

**文件**: `annotation-web/src/components/AnnotationForm.tsx`

新增状态管理：
```typescript
const [optimizedTitle, setOptimizedTitle] = useState('');
const [optimizedSummary, setOptimizedSummary] = useState('');
const [optimizedContent, setOptimizedContent] = useState('');
```

提交时包含优化内容：
```typescript
{
  optimized_title: optimizedTitle.trim() || undefined,
  optimized_summary: optimizedSummary.trim() || undefined,
  optimized_content: optimizedContent.trim() || undefined,
}
```

### 📝 新增文档

1. **数据库迁移脚本**
   - `scripts/migrations/add-optimized-content-fields.sql`
   - 添加新字段和注释

2. **使用指南**
   - `docs/Annotation-Optimized-Content-Fields.md`
   - 详细说明字段用途、标注指南、训练效果对比

### 🎓 训练数据改进

#### 旧版数据格式
```json
{
  "input": { "title": "...", "description": "..." },
  "output": { "score": 80, "reason": "..." }
}
```
**问题**: 模型只学到评分，不知道如何优化

#### 新版数据格式
```json
{
  "input": {
    "title": "千禧一代癌症发病率在上升",
    "description": "研究：自2000年起..."
  },
  "output": {
    "score": 80,
    "optimizedTitle": "千禧一代癌症高发：生物衰老加速的警示",
    "optimizedSummary": "研究揭示：15-49岁人群癌症发病率...",
    "optimizedContent": "一项大规模研究揭示了..."
  }
}
```
**优势**: 输入→输出成对，明确的优化目标

### 🔄 向后兼容

- 旧标注数据的优化字段为 `NULL`，不影响现有功能
- 快速标注（点赞/点踩）不需要填写优化内容
- API 接受 `undefined` 值，保持灵活性

### 🚀 部署步骤

```bash
# 1. 数据库迁移
docker exec -i quote0-postgres psql -U quote0_user -d quote0_cache \
  < scripts/migrations/add-optimized-content-fields.sql

# 2. 重启服务应用变更
docker-compose restart news-api annotation-web

# 3. 验证
curl -s http://localhost:3001/api/annotation/news | jq '.data[0]'
```

### 📊 预期影响

**训练质量提升**:
- ✅ Few-Shot 示例更有效（有明确的目标输出）
- ✅ 模型学习"如何优化"而不仅仅是"如何评分"
- ✅ 人工标注作为"金标准"指导模型

**标注工作量**:
- ⚠️ 完整标注时间增加（需填写优化内容）
- ✅ 可选字段，灵活控制
- ✅ 快速标注不受影响

### 🐛 已知问题

无

### 📚 相关文档

- [标注系统使用指南](docs/Annotation-System-Guide.md)
- [优化内容字段说明](docs/Annotation-Optimized-Content-Fields.md)
- [AX框架深入指南](docs/AX-Framework-Deep-Dive.md)

---

**发布日期**: 2025-10-03
**影响范围**: 后端 API + 前端组件 + 数据库 Schema + 训练数据导出
**兼容性**: 完全向后兼容
