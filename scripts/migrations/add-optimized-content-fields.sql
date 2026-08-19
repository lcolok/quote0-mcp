-- 为 quality_annotations 表添加优化内容字段
-- 这些字段存储人工参考改写，用于候选提示配置的离线评估。
-- 写入这些字段不会触发训练或自动激活。

ALTER TABLE quality_annotations
ADD COLUMN IF NOT EXISTS optimized_title TEXT,
ADD COLUMN IF NOT EXISTS optimized_summary TEXT,
ADD COLUMN IF NOT EXISTS optimized_content TEXT;

COMMENT ON COLUMN quality_annotations.optimized_title IS '人工参考标题（用于离线评估）';
COMMENT ON COLUMN quality_annotations.optimized_summary IS '人工参考摘要（用于离线评估）';
COMMENT ON COLUMN quality_annotations.optimized_content IS '人工参考正文（可选，用于离线评估）';
