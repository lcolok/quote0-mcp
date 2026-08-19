# 人工参考改写字段说明

## 目的

`quality_annotations.optimized_*` 保存评审人员给出的参考标题、摘要和正文。它们是可追溯的评估证据，不代表训练数据已经合格，也不会触发模型训练或自动发布。

字段如下：

```sql
ALTER TABLE quality_annotations
ADD COLUMN IF NOT EXISTS optimized_title TEXT,
ADD COLUMN IF NOT EXISTS optimized_summary TEXT,
ADD COLUMN IF NOT EXISTS optimized_content TEXT;
```

## 正确工作流

1. 评审稳定内容主体（`fingerprint`），记录评分、理由和可选参考改写。
2. 导出带版本与来源信息的评审快照；快照只作为证据集。
3. 按时间或来源拆分开发集与留出集，防止同源内容泄漏。
4. 用开发集生成未验证的 `prompt-profile` 候选。
5. 在留出集上比较现网基线与候选，至少检查事实忠实度、约束合规率和人工偏好。
6. 只有门禁通过后，才由人工把候选发布为生产配置；失败则保留现网配置。

## 标注指南

- 标题：准确、简洁，不增加原文没有的事实。
- 摘要：保留核心事实、主体与关键数字；无法确认的信息不补写。
- 正文：仅在确有结构问题时提供，保持来源含义和可核查引用。
- 快速点赞/点踩：用于筛选或采样，不能单独作为改写目标。

示例导出结构：

```json
{
  "subject": {
    "fingerprint": "稳定内容指纹",
    "title": "原始标题",
    "description": "原始摘要"
  },
  "decision": {
    "version": 2,
    "score": 80,
    "reason": "事实完整，但标题过长",
    "referenceTitle": "人工参考标题",
    "referenceSummary": "人工参考摘要"
  }
}
```

## 迁移说明

历史记录的 `optimized_*` 为 `NULL` 是正常状态。不要为了提高覆盖率而自动生成这些字段；自动生成内容不能充当人工参考答案。

```sql
SELECT
  COUNT(*) FILTER (WHERE optimized_title IS NOT NULL) AS with_reference,
  COUNT(*) AS total
FROM quality_annotations;
```

整体架构与质量门禁见 [WORKFLOW-ARCHITECTURE.md](./WORKFLOW-ARCHITECTURE.md)。

---

**更新日期**：2026-08-12
