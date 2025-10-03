# 导出包含优化内容的训练数据

## 📊 导出数据格式

### API 端点

```bash
GET /api/annotation/samples/export?minScore=0&maxScore=100&limit=50
```

### 返回格式（新版）

```json
[
  {
    // 原始内容（输入）
    "title": "千禧一代癌症发病率在上升",
    "link": "https://www.solidot.org/story?sid=82468",
    "description": "研究：自2000年起15–49岁人群癌症发病率增10%...",
    "content": "完整原始正文内容...",

    // 质量评分
    "overall_score": 85,
    "quality_level": "high",
    "should_filter": false,
    "reason": "高质量健康新闻，数据详实",
    "tags": ["健康", "研究"],
    "annotator": "human",
    "created_at": "2025-10-03T10:00:00.000Z",

    // ✨ 优化后的内容（训练目标）
    "optimized_title": "千禧一代癌症高发：生物衰老加速的警示",
    "optimized_summary": "研究揭示：15-49岁人群癌症发病率十年增10%，年轻女性风险高83%。15万人血液分析显示生物衰老加速，肺癌、胃肠癌、子宫癌风险增42%。超加工食品、昼夜节律紊乱等现代生活方式成主因。",
    "optimized_content": "完整优化后的正文..."
  }
]
```

## 🔄 数据转换流程

### 1. 原始导出（旧版 - 不完善）

```json
{
  "input": { "title": "...", "description": "..." },
  "output": { "score": 80 }
}
```
❌ 问题：没有优化目标，模型不知道如何改进

### 2. 完整导出（新版 - 含优化内容）

```json
{
  "input": {
    "title": "千禧一代癌症发病率在上升",
    "description": "研究：自2000年起15–49岁人群癌症发病率增10%...",
    "content": "完整原始正文..."
  },
  "output": {
    "score": 85,
    "category": "high",

    // ✨ 优化目标（Few-Shot 学习的关键）
    "optimizedTitle": "千禧一代癌症高发：生物衰老加速的警示",
    "optimizedSummary": "研究揭示：15-49岁人群癌症发病率十年增10%...",
    "optimizedContent": "完整优化后的正文..."
  }
}
```
✅ 优势：输入→输出成对，明确的学习目标

## 📝 使用场景

### 场景1：Web界面导出

访问 http://localhost:3002/export

1. 设置评分范围：最低分 70，最高分 100
2. 点击"导出为JSON"
3. 自动下载包含优化内容的训练数据

### 场景2：命令行导出

```bash
# 使用 export-from-annotation.ts 脚本
bun run scripts/ax-training/export-from-annotation.ts \
  --version=v1.1.0 \
  --min-score=70 \
  --max-score=100 \
  --description="包含人工优化内容的训练集"
```

输出：
```
📡 正在从标注API获取数据: http://localhost:3001/api/annotation/samples/export?minScore=70&maxScore=100
✅ 成功获取 45 条标注样本
📊 数据来源统计:
  - 人工标注+优化: 12 条
  - 标注系统: 33 条
💾 已创建快照: ax-framework/training-snapshots/v1.1.0_20251003_234500
```

### 场景3：训练模型

```bash
# 1. 导出数据
bun run scripts/ax-training/export-from-annotation.ts --version=v1.1.0

# 2. 训练模型（自动使用优化内容）
bun run scripts/ax-training/train-model.ts --version=v1.1.0 --deploy

# 3. 激活版本
bun run scripts/ax-training/activate-version.ts --version=v1.1.0
```

## 🎓 训练数据质量对比

### 仅评分数据（旧）

```typescript
const fewShotExamples = [
  {
    input: "千禧一代癌症发病率在上升",
    output: { score: 80 }
  }
];
// ❌ 模型学到：如何评分
// ❌ 模型不知道：如何优化内容
```

### 评分 + 优化内容（新）

```typescript
const fewShotExamples = [
  {
    input: {
      title: "千禧一代癌症发病率在上升",
      content: "研究：自2000年起15–49岁..."
    },
    output: {
      score: 80,
      optimizedTitle: "千禧一代癌症高发：生物衰老加速的警示",
      optimizedSummary: "研究揭示：15-49岁人群..."
    }
  }
];
// ✅ 模型学到：如何评分
// ✅ 模型学到：如何优化标题
// ✅ 模型学到：如何优化摘要
```

## 📊 数据统计

### 查看优化内容覆盖率

```bash
curl -s "http://localhost:3001/api/annotation/samples/export?minScore=0&maxScore=100" | \
  jq '[.[] | select(.optimized_title != null)] | length' -r
```

输出示例：
```
12  # 12 条样本包含优化内容
```

### 查看总样本数

```bash
curl -s "http://localhost:3001/api/annotation/samples/export?minScore=0&maxScore=100" | \
  jq 'length' -r
```

输出示例：
```
45  # 总共 45 条样本
```

### 计算优化覆盖率

```bash
curl -s "http://localhost:3001/api/annotation/samples/export?minScore=0&maxScore=100" | \
  jq -r '
    (length) as $total |
    ([.[] | select(.optimized_title != null)] | length) as $optimized |
    "总样本: \($total), 含优化: \($optimized), 覆盖率: \(($optimized * 100 / $total) | round)%"
  '
```

输出示例：
```
总样本: 45, 含优化: 12, 覆盖率: 27%
```

## 🔄 回退策略

如果某些样本没有优化内容，系统会自动回退：

```typescript
{
  optimizedTitle: sample.optimized_title || sample.title,  // 回退到原始标题
  optimizedSummary: sample.optimized_summary || sample.description,  // 回退到原始摘要
  source: hasOptimizedContent ? '人工标注+优化' : '标注系统'  // 标记数据来源
}
```

这样可以混合使用：
- **有优化内容的样本**：提供最佳训练信号
- **仅评分的样本**：提供质量判断标准

## 🎯 最佳实践

### 1. 渐进式标注

```bash
# 阶段1：快速标注（建立基线）
- 快速标注 100 条新闻（点赞/点踩）
- 导出基线数据训练 v1.0.0

# 阶段2：详细标注（提升质量）
- 详细标注 20 条高质量新闻
- 填写优化标题和摘要
- 导出训练 v1.1.0

# 阶段3：精细优化（追求卓越）
- 精选 10 条代表性新闻
- 完整优化标题、摘要、正文
- 导出训练 v1.2.0
```

### 2. 数据平衡

```bash
# 确保各质量等级都有优化样本
- 高质量 (70-100分): 8 条带优化
- 中等质量 (55-69分): 3 条带优化
- 低质量 (0-54分): 2 条带优化
```

### 3. 版本管理

```bash
# v1.0.0 - 基线版本
- 100 条快速标注
- 0 条优化内容
- 基线性能: 72%

# v1.1.0 - 优化版本
- 100 条快速标注
- 20 条优化内容
- 改进性能: 85%

# v1.2.0 - 精品版本
- 80 条快速标注
- 30 条优化内容
- 卓越性能: 92%
```

## 🐛 故障排除

### 问题1: 导出的数据都是 null

**原因**: 旧标注数据没有优化内容

**解决**:
```bash
# 1. 重新标注并添加优化内容
# 2. 或者只导出高分样本（更可能有优化内容）
curl "http://localhost:3001/api/annotation/samples/export?minScore=80&maxScore=100"
```

### 问题2: optimized_title 字段不存在

**原因**: 数据库迁移未执行

**解决**:
```bash
# 执行迁移脚本
docker exec -i quote0-postgres psql -U quote0_user -d quote0_cache \
  < scripts/migrations/add-optimized-content-fields.sql

# 重启API服务
docker-compose restart news-api
```

### 问题3: 导出速度慢

**原因**: 数据量大

**解决**:
```bash
# 使用 limit 参数限制数量
curl "http://localhost:3001/api/annotation/samples/export?minScore=70&maxScore=100&limit=50"
```

## 📚 相关文档

- [标注系统使用指南](./Annotation-System-Guide.md)
- [优化内容字段说明](./Annotation-Optimized-Content-Fields.md)
- [AX框架深入指南](./AX-Framework-Deep-Dive.md)
- [训练管理README](../scripts/ax-training/README.md)

---

**更新日期**: 2025-10-03
**关键改进**: 导出数据现包含 optimized_title, optimized_summary, optimized_content 字段
