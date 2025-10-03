-- 为 quality_annotations 表添加优化内容字段
-- 这些字段存储人工标注的优化后内容，用于训练AX模型

ALTER TABLE quality_annotations
ADD COLUMN IF NOT EXISTS optimized_title TEXT,
ADD COLUMN IF NOT EXISTS optimized_summary TEXT,
ADD COLUMN IF NOT EXISTS optimized_content TEXT;

COMMENT ON COLUMN quality_annotations.optimized_title IS '人工优化后的标题（用于训练）';
COMMENT ON COLUMN quality_annotations.optimized_summary IS '人工优化后的摘要（用于训练）';
COMMENT ON COLUMN quality_annotations.optimized_content IS '人工优化后的正文内容（可选，用于训练）';
