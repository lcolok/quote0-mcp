# 标注系统优化内容字段说明

## 📋 概述

为了让AX模型训练有充分的数据指引，标注系统现已添加"优化内容"字段，用于存储人工优化后的标题、摘要和正文。

## 🎯 新增字段

### 数据库字段

在 `quality_annotations` 表中添加：

```sql
ALTER TABLE quality_annotations
ADD COLUMN IF NOT EXISTS optimized_title TEXT,
ADD COLUMN IF NOT EXISTS optimized_summary TEXT,
ADD COLUMN IF NOT EXISTS optimized_content TEXT;
```

### TypeScript 接口

```typescript
export interface QualityAnnotation {
  // ... 原有字段 ...

  // 新增：优化后的内容（用于训练）
  optimized_title?: string;      // 优化后的标题
  optimized_summary?: string;    // 优化后的摘要
  optimized_content?: string;    // 优化后的正文（可选）
}
```

## 📊 数据结构对比

### 旧版（仅评分）
```json
{
  "title": "千禧一代癌症发病率在上升",
  "description": "研究：自2000年起15–49岁人群癌症发病率增10%...",
  "overall_score": 80,
  "reason": "快速标注：高质量内容"
}
```

**问题**: 只有分数，没有优化目标，训练数据不足

### 新版（含优化内容）
```json
{
  // 原始内容（输入）
  "title": "千禧一代癌症发病率在上升",
  "description": "研究：自2000年起15–49岁人群癌症发病率增10%，年轻女性较同龄男性高83%。对15万人的血液标志物显示千禧一代生物衰老加速，伴肺、胃肠、子宫癌风险最高增42%，可能与孕期用药、超加工食品、人造光、轮班致昼夜节律紊乱及化学暴露有关。",

  // 评分（质量指标）
  "overall_score": 80,
  "reason": "高质量健康新闻，数据详实",

  // ✨ 新增：优化后的内容（训练目标）
  "optimized_title": "千禧一代癌症高发：生物衰老加速的警示",
  "optimized_summary": "研究揭示：15-49岁人群癌症发病率十年增10%，年轻女性风险高83%。15万人血液分析显示生物衰老加速，肺癌、胃肠癌、子宫癌风险增42%。超加工食品、昼夜节律紊乱等现代生活方式成主因。",
  "optimized_content": "一项大规模研究揭示了令人担忧的趋势：自2000年以来，15-49岁人群的癌症发病率增长了10%，其中年轻女性的风险比同龄男性高出83%..."
}
```

**优势**:
- ✅ 输入输出成对：原始内容 → 优化内容
- ✅ 训练目标明确：模型学习如何优化
- ✅ 人工标注作为"金标准"指导模型学习

## 🔧 使用场景

### 场景1：标准标注流程

1. 查看原始新闻
2. 给出质量评分
3. **填写优化后的内容**：
   - 优化标题：更简洁、有力
   - 优化摘要：提取核心信息，压缩到合适长度
   - 优化正文（可选）：重新组织内容结构

### 场景2：快速标注

快速标注（点赞/点踩）**不需要**填写优化内容，仅用于质量筛选。

### 场景3：导出训练数据

导出时自动包含优化内容：

```typescript
{
  "input": {
    "title": "原始标题",
    "description": "原始摘要",
    "content": "原始正文"
  },
  "output": {
    "score": 80,
    "optimizedTitle": "优化后标题",      // ✨ 训练目标
    "optimizedSummary": "优化后摘要",   // ✨ 训练目标
    "optimizedContent": "优化后正文"     // ✨ 训练目标
  }
}
```

## 📝 标注指南

### 优化标题
**原则**：
- 简洁有力：控制在20字以内
- 突出核心：提炼最重要的信息
- 避免标题党：准确反映内容

**示例**：
```
原始：千禧一代癌症发病率在上升
优化：千禧一代癌症高发：生物衰老加速的警示
```

### 优化摘要
**原则**：
- 长度适中：100-150字
- 结构清晰：核心发现 + 关键数据 + 原因/影响
- 信息完整：覆盖主要论点

**示例**：
```
原始：研究：自2000年起15–49岁人群癌症发病率增10%，年轻女性较同龄男性高83%...

优化：研究揭示：15-49岁人群癌症发病率十年增10%，年轻女性风险高83%。15万人血液分析显示生物衰老加速，肺癌、胃肠癌、子宫癌风险增42%。超加工食品、昼夜节律紊乱等现代生活方式成主因。
```

### 优化正文（可选）
**原则**：
- 逻辑清晰：引言 → 核心发现 → 详细数据 → 影响/建议
- 段落分明：每段一个主题
- 数据准确：保留关键数字和引用

## 🔄 迁移现有数据

已有标注数据的 `optimized_*` 字段为 `NULL`，这是正常的。新标注将包含这些字段。

```sql
-- 查看有优化内容的标注占比
SELECT
  COUNT(*) FILTER (WHERE optimized_title IS NOT NULL) AS with_optimized,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE optimized_title IS NOT NULL) / COUNT(*), 2) AS percentage
FROM quality_annotations;
```

## 🎓 训练效果对比

### 仅评分数据
```
模型学习：新闻 → 分数
缺点：不知道如何优化内容
```

### 评分 + 优化内容
```
模型学习：
  原始标题 → 优化标题
  原始摘要 → 优化摘要
优点：明确的优化目标，Few-Shot学习更有效
```

## 📚 相关文档

- [AX框架深入指南](./AX-Framework-Deep-Dive.md)
- [标注系统使用指南](./Annotation-System-Guide.md)
- [AX模型热重载指南](./AX-Model-Hot-Reload-Guide.md)

---

**更新日期**: 2025-10-03
**作者**: MindReset Team
