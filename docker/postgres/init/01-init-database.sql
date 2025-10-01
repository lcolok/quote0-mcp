-- Quote0 MCP 缓存数据库初始化脚本

-- 创建新闻缓存相关表
CREATE TABLE IF NOT EXISTS news_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(64) UNIQUE NOT NULL,
    source VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    index_num INTEGER,
    
    -- 新闻内容字段
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    signature VARCHAR(100) NOT NULL,
    source_name VARCHAR(100) NOT NULL,
    publish_time TIMESTAMP NOT NULL,
    category_name VARCHAR(50) NOT NULL,
    link TEXT,
    highlights JSONB,
    
    -- 缓存元数据
    processing_time INTEGER,
    metadata JSONB,
    image_path TEXT,  -- 渲染后的图片路径
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,

    -- 索引
    CONSTRAINT news_cache_expires_check CHECK (expires_at > created_at)
);

-- 创建处理任务表
CREATE TABLE IF NOT EXISTS processing_tasks (
    id VARCHAR(32) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    
    -- 任务数据
    input_params JSONB NOT NULL,
    output_data JSONB,
    error_message TEXT,
    processing_time INTEGER,
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建RSS快照表
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

-- 创建图片缓存表（MinIO对象引用）
CREATE TABLE IF NOT EXISTS image_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(64) UNIQUE NOT NULL,
    
    -- 关联的新闻缓存
    news_cache_id INTEGER REFERENCES news_cache(id) ON DELETE CASCADE,
    
    -- MinIO对象信息
    bucket_name VARCHAR(100) NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    object_size BIGINT,
    content_type VARCHAR(100),
    etag VARCHAR(64),
    
    -- 渲染配置
    widget_type VARCHAR(50) NOT NULL,
    render_config JSONB,
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    
    CONSTRAINT image_cache_expires_check CHECK (expires_at > created_at)
);

-- 创建缓存统计表
CREATE TABLE IF NOT EXISTS cache_stats (
    id SERIAL PRIMARY KEY,
    cache_type VARCHAR(50) NOT NULL UNIQUE,
    hit_count BIGINT DEFAULT 0,
    miss_count BIGINT DEFAULT 0,
    total_requests BIGINT DEFAULT 0,
    avg_processing_time NUMERIC(10,2),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_news_cache_key ON news_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_news_cache_source ON news_cache(source, category, index_num);
CREATE INDEX IF NOT EXISTS idx_news_cache_expires ON news_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON processing_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON processing_tasks(type);

CREATE INDEX IF NOT EXISTS idx_rss_url ON rss_snapshots(url);
CREATE INDEX IF NOT EXISTS idx_rss_expires ON rss_snapshots(expires_at);

CREATE INDEX IF NOT EXISTS idx_image_cache_key ON image_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_image_cache_news ON image_cache(news_cache_id);
CREATE INDEX IF NOT EXISTS idx_image_cache_expires ON image_cache(expires_at);

-- 插入初始统计数据
INSERT INTO cache_stats (cache_type, hit_count, miss_count, total_requests) 
VALUES 
    ('news', 0, 0, 0),
    ('image', 0, 0, 0),
    ('rss', 0, 0, 0)
ON CONFLICT (cache_type) DO NOTHING;

-- 创建自动更新updated_at的触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_processing_tasks_updated_at 
    BEFORE UPDATE ON processing_tasks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建清理过期数据的函数
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    news_deleted INTEGER;
    rss_deleted INTEGER;
    image_deleted INTEGER;
BEGIN
    -- 清理过期的新闻缓存
    DELETE FROM news_cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS news_deleted = ROW_COUNT;
    
    -- 清理过期的RSS快照
    DELETE FROM rss_snapshots WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS rss_deleted = ROW_COUNT;
    
    -- 清理过期的图片缓存
    DELETE FROM image_cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS image_deleted = ROW_COUNT;
    
    -- 清理7天前的已完成任务
    DELETE FROM processing_tasks 
    WHERE status IN ('completed', 'failed') 
      AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    deleted_count := news_deleted + rss_deleted + image_deleted;
    
    RAISE NOTICE '清理完成: 新闻% RSS% 图片%', news_deleted, rss_deleted, image_deleted;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 添加表注释
COMMENT ON TABLE news_cache IS '新闻内容缓存表';
COMMENT ON TABLE processing_tasks IS '处理任务状态表';
COMMENT ON TABLE rss_snapshots IS 'RSS快照缓存表';
COMMENT ON TABLE image_cache IS '图片对象缓存表';
COMMENT ON TABLE cache_stats IS '缓存统计表';

COMMENT ON FUNCTION cleanup_expired_data() IS '清理过期缓存数据的维护函数';