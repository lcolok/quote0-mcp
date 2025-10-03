# 训练数据结构修复说明

## 🐛 问题描述

**您发现的问题**: 导出的训练数据中，输入和输出是同一个内容

### 原始问题数据

```json
{
  "title": "千禧一代癌症发病率在上升",  // ❌ 这已经是AX优化后的
  "description": "研究：自2000年起15–49岁...",  // ❌ 这已经是AX优化后的
  "optimized_title": null,  // ❌ 人工优化为空
  "optimized_summary": null  // ❌ 人工优化为空
}
```

**问题根因**:
- `description` 字段从 `processed_content->>'message'` 获取，已经是LLM优化后的结果
- 这导致训练时**输入=输出**，模型学不到任何东西

## ✅ 修复方案

### 新的数据结构

现在导出的数据清晰区分三层内容：

```json
{
  // 第1层：原始内容（RSS/API获取）
  "original_title": "千禧一代癌症发病率在上升",
  "original_description": null,  // RSS通常没有description
  "original_content": "自 2000 年以来 15-49 岁人群癌症发病率增加了 10%...",

  // 第2层：LLM自动处理的内容
  "processed_title": "AACR研究：千禧一代癌症上升",
  "processed_summary": "研究：自2000年起15–49岁人群癌症发病率增10%...",

  // 第3层：人工优化的内容（标注时填写）
  "optimized_title": "千禧一代癌症高发：生物衰老加速警示",
  "optimized_summary": "研究揭示：15-49岁人群癌症发病率十年增10%...",

  // 质量评分
  "overall_score": 85,
  "quality_level": "high"
}
```

### 训练数据转换逻辑

```typescript
// 输入：始终使用原始内容
const inputTitle = sample.original_title;
const inputContent = sample.original_content || sample.original_description;

// 输出：优先级 人工优化 > LLM处理 > 原始内容
const outputTitle = sample.optimized_title
  || sample.processed_title
  || sample.original_title;

const outputSummary = sample.optimized_summary
  || sample.processed_summary
  || sample.original_description;
```

## 📊 三种训练数据质量

### 1. 最佳：人工优化（质量最高）

```json
{
  "input": {
    "title": "千禧一代癌症发病率在上升",
    "content": "自 2000 年以来 15-49 岁人群癌症发病率增加了 10%..."
  },
  "output": {
    "title": "千禧一代癌症高发：生物衰老加速警示",  // ✨ 人工优化
    "summary": "研究揭示：15-49岁人群癌症发病率..."  // ✨ 人工优化
  },
  "source": "人工优化"
}
```

### 2. 良好：LLM处理（质量中等）

```json
{
  "input": {
    "title": "千禧一代癌症发病率在上升",
    "content": "自 2000 年以来 15-49 岁人群癌症发病率增加了 10%..."
  },
  "output": {
    "title": "AACR研究：千禧一代癌症上升",  // 🤖 LLM处理
    "summary": "研究：自2000年起15–49岁..."  // 🤖 LLM处理
  },
  "source": "LLM处理"
}
```

### 3. 基线：原始内容（仅用于评分）

```json
{
  "input": {
    "title": "千禧一代癌症发病率在上升",
    "content": "自 2000 年以来 15-49 岁人群癌症发病率增加了 10%..."
  },
  "output": {
    "title": "千禧一代癌症发病率在上升",  // 📄 原始内容
    "summary": "自 2000 年以来 15-49 岁..."  // 📄 原始内容
  },
  "source": "原始内容"
}
```

## 🎯 训练策略

### 推荐组合

```
总样本 100 条：
  - 人工优化: 20 条 (20%) ⭐⭐⭐
  - LLM处理: 50 条 (50%) ⭐⭐
  - 原始内容: 30 条 (30%) ⭐
```

**为什么混合使用？**

1. **人工优化**（少而精）
   - 提供最佳优化范例
   - 指导模型学习优化方向
   - 成本高，数量少

2. **LLM处理**（量大质中）
   - 提供大量中等质量样本
   - 已经过初步优化
   - 成本低，可大量使用

3. **原始内容**（建立基线）
   - 提供质量判断基准
   - 告诉模型什么是"未优化"状态
   - 辅助作用

## 🔧 修复的代码

### 后端 API (annotation-api.ts)

```sql
-- 旧版（错误）❌
SELECT
  npl.processed_content->>'message' as description  -- 已优化的内容

-- 新版（正确）✅
SELECT
  npl.raw_content->>'title' as original_title,
  npl.raw_content->>'description' as original_description,
  npl.raw_content->>'content' as original_content,
  npl.processed_content->>'title' as processed_title,
  npl.processed_content->>'message' as processed_summary,
  qa.optimized_title,
  qa.optimized_summary
```

### 训练数据转换 (export-from-annotation.ts)

```typescript
// 旧版（错误）❌
optimizedTitle: sample.title  // 已经是优化后的

// 新版（正确）✅
const inputTitle = sample.original_title;  // 原始输入
const outputTitle = sample.optimized_title  // 优先人工
  || sample.processed_title  // 其次LLM
  || sample.original_title;  // 最后原始
```

## 📈 效果对比

### 修复前（错误）

```
输入：AACR研究：千禧一代癌症上升
输出：AACR研究：千禧一代癌症上升
结果：模型学到 nothing ❌
```

### 修复后（正确）

```
输入：千禧一代癌症发病率在上升
输出：千禧一代癌症高发：生物衰老加速警示
结果：模型学到优化技巧 ✅
```

## 🔍 验证方法

```bash
# 导出一条样本查看结构
curl -s "http://localhost:3001/api/annotation/samples/export?limit=1" | jq '.[0]'

# 应该看到：
{
  "original_title": "...",      # ✅ 原始RSS标题
  "processed_title": "...",      # ✅ LLM优化后
  "optimized_title": null,       # ✅ 人工优化（可为null）
  ...
}
```

## 📚 相关文档

- [标注系统使用指南](./Annotation-System-Guide.md)
- [优化内容字段说明](./Annotation-Optimized-Content-Fields.md)
- [导出训练数据指南](./Export-Training-Data-With-Optimized-Content.md)

---

**修复日期**: 2025-10-04
**关键改进**: 正确区分原始内容、LLM处理、人工优化三层结构
**影响**: 训练数据质量从"无效"提升到"有效"
