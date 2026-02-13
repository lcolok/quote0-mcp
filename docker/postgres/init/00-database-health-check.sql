-- ============================================================================
-- 数据库结构健康检查和自动修复脚本
-- 在应用启动时自动执行，确保所有必需字段和表都存在
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '开始数据库结构健康检查...';
    RAISE NOTICE '========================================';

    -- ============================================================================
    -- 1. 检查并修复 news_cache 表结构
    -- ============================================================================
    RAISE NOTICE '[1/5] 检查 news_cache 表结构...';
    
    -- 确保 news_cache 表存在（如果不存在则创建）
    CREATE TABLE IF NOT EXISTS news_cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(64) UNIQUE NOT NULL,
        source VARCHAR(50) NOT NULL,
        category VARCHAR(50),
        index_num INTEGER,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        signature VARCHAR(100) NOT NULL,
        source_name VARCHAR(100) NOT NULL,
        publish_time TIMESTAMP NOT NULL,
        category_name VARCHAR(50) NOT NULL,
        link TEXT,
        highlights JSONB,
        processing_time INTEGER,
        metadata JSONB,
        image_path TEXT,  -- 渲染后的图片路径
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        CONSTRAINT news_cache_expires_check CHECK (expires_at > created_at)
    );
    
    -- 检查并添加缺失的 image_path 字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_cache' AND column_name = 'image_path'
    ) THEN
        ALTER TABLE news_cache ADD COLUMN image_path TEXT;
        RAISE NOTICE '  ✓ 已添加缺失的字段: news_cache.image_path';
    ELSE
        RAISE NOTICE '  ✓ 字段已存在: news_cache.image_path';
    END IF;
    
    -- 检查并创建索引
    CREATE INDEX IF NOT EXISTS idx_news_cache_key ON news_cache(cache_key);
    CREATE INDEX IF NOT EXISTS idx_news_cache_source ON news_cache(source, category, index_num);
    CREATE INDEX IF NOT EXISTS idx_news_cache_expires ON news_cache(expires_at);
    RAISE NOTICE '  ✓ news_cache 索引检查完成';

    -- ============================================================================
    -- 2. 检查并修复 image_cache 表结构
    -- ============================================================================
    RAISE NOTICE '[2/5] 检查 image_cache 表结构...';
    
    CREATE TABLE IF NOT EXISTS image_cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(64) UNIQUE NOT NULL,
        news_cache_id INTEGER REFERENCES news_cache(id) ON DELETE CASCADE,
        bucket_name VARCHAR(100) NOT NULL,
        object_key VARCHAR(500) NOT NULL,
        object_size BIGINT,
        content_type VARCHAR(100),
        etag VARCHAR(64),
        widget_type VARCHAR(50) NOT NULL,
        render_config JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        CONSTRAINT image_cache_expires_check CHECK (expires_at > created_at)
    );
    
    CREATE INDEX IF NOT EXISTS idx_image_cache_key ON image_cache(cache_key);
    CREATE INDEX IF NOT EXISTS idx_image_cache_news ON image_cache(news_cache_id);
    CREATE INDEX IF NOT EXISTS idx_image_cache_expires ON image_cache(expires_at);
    RAISE NOTICE '  ✓ image_cache 表检查完成';

    -- ============================================================================
    -- 3. 检查并修复 processing_tasks 表结构
    -- ============================================================================
    RAISE NOTICE '[3/5] 检查 processing_tasks 表结构...';
    
    CREATE TABLE IF NOT EXISTS processing_tasks (
        id VARCHAR(32) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' 
            CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        input_params JSONB NOT NULL,
        output_data JSONB,
        error_message TEXT,
        processing_time INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON processing_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_type ON processing_tasks(type);
    RAISE NOTICE '  ✓ processing_tasks 表检查完成';

    -- ============================================================================
    -- 4. 检查并修复 rss_snapshots 表结构
    -- ============================================================================
    RAISE NOTICE '[4/5] 检查 rss_snapshots 表结构...';
    
    CREATE TABLE IF NOT EXISTS rss_snapshots (
        id SERIAL PRIMARY KEY,
        url VARCHAR(500) NOT NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        items_count INTEGER NOT NULL DEFAULT 0,
        items_hash VARCHAR(64) NOT NULL,
        raw_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        CONSTRAINT rss_snapshots_expires_check CHECK (expires_at > created_at)
    );
    
    CREATE INDEX IF NOT EXISTS idx_rss_url ON rss_snapshots(url);
    CREATE INDEX IF NOT EXISTS idx_rss_expires ON rss_snapshots(expires_at);
    RAISE NOTICE '  ✓ rss_snapshots 表检查完成';

    -- ============================================================================
    -- 5. 检查并修复缓存统计表
    -- ============================================================================
    RAISE NOTICE '[5/5] 检查 cache_stats 表...';
    
    CREATE TABLE IF NOT EXISTS cache_stats (
        id SERIAL PRIMARY KEY,
        cache_type VARCHAR(50) NOT NULL UNIQUE,
        hit_count BIGINT DEFAULT 0,
        miss_count BIGINT DEFAULT 0,
        total_requests BIGINT DEFAULT 0,
        avg_processing_time NUMERIC(10,2),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- 插入初始统计数据（如果不存在）
    INSERT INTO cache_stats (cache_type, hit_count, miss_count, total_requests) 
    VALUES 
        ('news', 0, 0, 0),
        ('image', 0, 0, 0),
        ('rss', 0, 0, 0)
    ON CONFLICT (cache_type) DO NOTHING;
    RAISE NOTICE '  ✓ cache_stats 表检查完成';

    -- ============================================================================
    -- 6. 创建/更新触发器
    -- ============================================================================
    RAISE NOTICE '[额外] 创建触发器函数...';
    
    -- 自动更新 updated_at 的函数
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    -- 为 processing_tasks 表添加触发器
    DROP TRIGGER IF EXISTS update_processing_tasks_updated_at ON processing_tasks;
    CREATE TRIGGER update_processing_tasks_updated_at 
        BEFORE UPDATE ON processing_tasks 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    RAISE NOTICE '  ✓ 触发器创建完成';

    -- ============================================================================
    -- 7. 创建清理函数
    -- ============================================================================
    RAISE NOTICE '[额外] 创建清理函数...';
    
    CREATE OR REPLACE FUNCTION cleanup_expired_data()
    RETURNS INTEGER AS $$
    DECLARE
        deleted_count INTEGER := 0;
        news_deleted INTEGER;
        rss_deleted INTEGER;
        image_deleted INTEGER;
    BEGIN
        DELETE FROM news_cache WHERE expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS news_deleted = ROW_COUNT;
        
        DELETE FROM rss_snapshots WHERE expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS rss_deleted = ROW_COUNT;
        
        DELETE FROM image_cache WHERE expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS image_deleted = ROW_COUNT;
        
        DELETE FROM processing_tasks 
        WHERE status IN ('completed', 'failed') 
          AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
        
        deleted_count := news_deleted + rss_deleted + image_deleted;
        RAISE NOTICE '清理完成: 新闻% RSS% 图片%', news_deleted, rss_deleted, image_deleted;
        RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
    RAISE NOTICE '  ✓ 清理函数创建完成';

    RAISE NOTICE '========================================';
    RAISE NOTICE '数据库结构健康检查完成！';
    RAISE NOTICE '========================================';
END $$;
