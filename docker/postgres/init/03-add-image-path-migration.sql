-- 为已存在的数据库添加 image_path 字段
-- 迁移脚本：为 news_cache 表添加图片路径字段

-- 检查字段是否已存在，如果不存在则添加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_cache'
        AND column_name = 'image_path'
    ) THEN
        ALTER TABLE news_cache ADD COLUMN image_path TEXT;
        RAISE NOTICE 'Added image_path column to news_cache table';
    ELSE
        RAISE NOTICE 'image_path column already exists in news_cache table';
    END IF;
END $$;
