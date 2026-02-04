-- 05-complete-migration.sql
-- 完整的开箱即用迁移脚本
-- 确保所有表结构和默认数据都正确初始化

DO $$
BEGIN
    RAISE NOTICE '开始执行完整迁移...';
    
    -- ============================================
    -- 1. 确保 news_push_log 表有 annotation_status 列
    -- ============================================
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_push_log' AND column_name = 'annotation_status'
    ) THEN
        ALTER TABLE news_push_log ADD COLUMN annotation_status VARCHAR(20) DEFAULT 'pending';
        RAISE NOTICE '已添加 annotation_status 列到 news_push_log 表';
    ELSE
        RAISE NOTICE 'annotation_status 列已存在';
    END IF;

    -- ============================================
    -- 2. 创建默认调度任务（如果不存在）
    -- ============================================
    
    -- 默认科技资讯任务
    IF NOT EXISTS (SELECT 1 FROM news_scheduler_jobs WHERE id = 'technology-solidot-default') THEN
        INSERT INTO news_scheduler_jobs (
            id, name, description, category, data_source, rss_source, 
            processor, renderer, interval_ms, initial_delay_ms, 
            options, index_strategy, enabled
        ) VALUES (
            'technology-solidot-default',
            '默认科技资讯轮播',
            '默认的Solidot科技资讯定时推送任务',
            'technology',
            'rss',
            'solidot',
            'ax-optimized',
            'device',
            1800000,  -- 30分钟
            0,
            '{"border": "0"}'::jsonb,
            '{"type": "fair-rotation", "poolSize": 10, "startIndex": 0, "cooldownHours": 24, "maxPushCount": 5, "rotateAfterEachPush": true, "skipEmptySource": true}'::jsonb,
            true
        );
        RAISE NOTICE '已创建默认任务: technology-solidot-default';
    ELSE
        RAISE NOTICE '默认任务已存在: technology-solidot-default';
    END IF;

    -- 多源RSS轮播任务
    IF NOT EXISTS (SELECT 1 FROM news_scheduler_jobs WHERE id = 'multi-source-rotation') THEN
        INSERT INTO news_scheduler_jobs (
            id, name, description, category, data_source, rss_source, 
            processor, renderer, interval_ms, initial_delay_ms, 
            options, index_strategy, enabled
        ) VALUES (
            'multi-source-rotation',
            '多源RSS轮播',
            '每5分钟轮播Solidot、36kr、sspai、hackernews四个RSS源',
            'news',
            'rss',
            'solidot',
            'ax-optimized',
            'device',
            300000,  -- 5分钟
            0,
            '{"border": "0"}'::jsonb,
            '{"type": "fair-rotation", "poolSize": 4, "startIndex": 0, "cooldownHours": 24, "maxPushCount": 5, "rotateAfterEachPush": true, "skipEmptySource": true}'::jsonb,
            true
        );
        RAISE NOTICE '已创建任务: multi-source-rotation';
    ELSE
        RAISE NOTICE '任务已存在: multi-source-rotation';
    END IF;

    -- ============================================
    -- 3. 确保所有需要的表都存在
    -- ============================================
    
    -- news_raw_data 表
    CREATE TABLE IF NOT EXISTS news_raw_data (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) UNIQUE NOT NULL,
        source VARCHAR(50) NOT NULL,
        source_id VARCHAR(100),
        raw_content JSONB NOT NULL,
        processed_content JSONB,
        
        annotation_status VARCHAR(20) DEFAULT 'pending'
            CHECK (annotation_status IN ('pending', 'annotating', 'completed', 'skipped')),
        annotation_count INTEGER DEFAULT 0,
        last_annotation_at TIMESTAMP,
        
        quality_score NUMERIC(3,2),
        priority_score NUMERIC(3,2),
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_news_raw_fingerprint ON news_raw_data(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_news_raw_status ON news_raw_data(annotation_status);
    CREATE INDEX IF NOT EXISTS idx_news_raw_source ON news_raw_data(source, created_at DESC);
    RAISE NOTICE 'news_raw_data 表已就绪';

    -- quality_annotations 表
    CREATE TABLE IF NOT EXISTS quality_annotations (
        id SERIAL PRIMARY KEY,
        news_fingerprint VARCHAR(64) NOT NULL REFERENCES news_raw_data(fingerprint) ON DELETE CASCADE,
        
        annotator_id VARCHAR(100) NOT NULL,
        annotated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        relevance_score INTEGER CHECK (relevance_score BETWEEN 1 AND 5),
        coherence_score INTEGER CHECK (coherence_score BETWEEN 1 AND 5),
        informativeness_score INTEGER CHECK (informativeness_score BETWEEN 1 AND 5),
        overall_score INTEGER CHECK (overall_score BETWEEN 1 AND 5),
        
        is_reference BOOLEAN DEFAULT false,
        
        comments TEXT,
        
        UNIQUE(news_fingerprint, annotator_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_annotations_news ON quality_annotations(news_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_annotations_reference ON quality_annotations(is_reference, overall_score);
    RAISE NOTICE 'quality_annotations 表已就绪';

    -- annotation_history 表
    CREATE TABLE IF NOT EXISTS annotation_history (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        action VARCHAR(50) NOT NULL,
        news_fingerprint VARCHAR(64),
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_annotation_history_session ON annotation_history(session_id, created_at DESC);
    RAISE NOTICE 'annotation_history 表已就绪';

    -- evaluation_comparisons 表
    CREATE TABLE IF NOT EXISTS evaluation_comparisons (
        id SERIAL PRIMARY KEY,
        fingerprint_a VARCHAR(64) NOT NULL REFERENCES news_raw_data(fingerprint),
        fingerprint_b VARCHAR(64) NOT NULL REFERENCES news_raw_data(fingerprint),
        
        annotator_id VARCHAR(100) NOT NULL,
        
        preferred_fingerprint VARCHAR(64),
        is_tie BOOLEAN DEFAULT false,
        
        reason TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(fingerprint_a, fingerprint_b, annotator_id)
    );
    RAISE NOTICE 'evaluation_comparisons 表已就绪';

    -- training_export_logs 表
    CREATE TABLE IF NOT EXISTS training_export_logs (
        id SERIAL PRIMARY KEY,
        export_id VARCHAR(100) UNIQUE NOT NULL,
        
        export_type VARCHAR(50) NOT NULL,
        filters JSONB,
        
        total_samples INTEGER NOT NULL,
        annotated_samples INTEGER NOT NULL,
        comparison_samples INTEGER NOT NULL,
        
        output_path TEXT NOT NULL,
        file_size BIGINT,
        
        exported_by VARCHAR(100),
        exported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        metadata JSONB
    );
    RAISE NOTICE 'training_export_logs 表已就绪';

    -- ============================================
    -- 4. 创建/更新视图
    -- ============================================
    
    CREATE OR REPLACE VIEW news_annotation_stats AS
    SELECT 
        n.fingerprint,
        n.source,
        n.annotation_status,
        n.quality_score,
        n.priority_score,
        n.created_at,
        COUNT(q.id) as annotation_count,
        AVG(q.overall_score) as avg_overall_score,
        BOOL_OR(q.is_reference) as has_reference
    FROM news_raw_data n
    LEFT JOIN quality_annotations q ON n.fingerprint = q.news_fingerprint
    GROUP BY n.fingerprint, n.source, n.annotation_status, n.quality_score, n.priority_score, n.created_at;
    RAISE NOTICE 'news_annotation_stats 视图已就绪';

    CREATE OR REPLACE VIEW annotator_progress AS
    SELECT 
        annotator_id,
        COUNT(*) as total_annotations,
        COUNT(*) FILTER (WHERE is_reference) as reference_annotations,
        AVG(overall_score) as avg_score,
        MAX(annotated_at) as last_active
    FROM quality_annotations
    GROUP BY annotator_id;
    RAISE NOTICE 'annotator_progress 视图已就绪';

    RAISE NOTICE '完整迁移执行完成！';
END $$;
