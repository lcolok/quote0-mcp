-- Quote0 MCP 质量标注系统数据库扩展
-- 用于支持AX框架的人工标注样本集构建

-- 1. 原始新闻数据表（待标注）
CREATE TABLE IF NOT EXISTS news_raw_data (
    id SERIAL PRIMARY KEY,

    -- 新闻内容
    title VARCHAR(500) NOT NULL,
    source VARCHAR(200) NOT NULL,
    description TEXT,
    link TEXT,
    publish_time TIMESTAMP,

    -- 数据来源标识
    data_source VARCHAR(50) NOT NULL,  -- rss, api, hackernews, mock
    category VARCHAR(50),  -- technology, finance, sports, etc.
    rss_index INTEGER,

    -- 原始数据（完整RSS item或API响应）
    raw_data JSONB,

    -- 状态管理
    annotation_status VARCHAR(20) DEFAULT 'pending'
        CHECK (annotation_status IN ('pending', 'annotating', 'completed', 'skipped')),

    -- 图片路径（渲染后的推送预览图）
    image_path TEXT,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 唯一性约束（防止重复导入）
    UNIQUE(title, source, publish_time)
);

-- 2. 质量标注表（人工标注结果）
CREATE TABLE IF NOT EXISTS quality_annotations (
    id SERIAL PRIMARY KEY,

    -- 关联原始新闻
    news_id INTEGER NOT NULL REFERENCES news_raw_data(id) ON DELETE CASCADE,

    -- 综合评分
    overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
    category VARCHAR(10) NOT NULL CHECK (category IN ('high', 'medium', 'low')),
    should_filter BOOLEAN NOT NULL,

    -- 五维度评分
    news_value INTEGER CHECK (news_value >= 0 AND news_value <= 100),
    practicality INTEGER CHECK (practicality >= 0 AND practicality <= 100),
    density INTEGER CHECK (density >= 0 AND density <= 100),
    timeliness INTEGER CHECK (timeliness >= 0 AND timeliness <= 100),
    universality INTEGER CHECK (universality >= 0 AND universality <= 100),

    -- 标注理由和标签
    reason TEXT NOT NULL,
    tags TEXT[],  -- PostgreSQL数组类型

    -- 标注元数据
    annotator VARCHAR(50) NOT NULL DEFAULT 'human',
    difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'hard')),
    confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),

    -- 版本控制
    version INTEGER DEFAULT 1,
    is_latest BOOLEAN DEFAULT true,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 标注历史表（记录所有修改）
CREATE TABLE IF NOT EXISTS annotation_history (
    id SERIAL PRIMARY KEY,

    -- 关联标注
    annotation_id INTEGER NOT NULL REFERENCES quality_annotations(id) ON DELETE CASCADE,
    news_id INTEGER NOT NULL REFERENCES news_raw_data(id) ON DELETE CASCADE,

    -- 历史快照（存储完整的标注数据）
    snapshot JSONB NOT NULL,

    -- 变更信息
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
    changed_fields TEXT[],
    change_reason TEXT,

    -- 操作者
    operator VARCHAR(50) NOT NULL,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. 训练集导出记录表
CREATE TABLE IF NOT EXISTS training_export_logs (
    id SERIAL PRIMARY KEY,

    -- 导出信息
    export_version VARCHAR(50) NOT NULL,
    samples_count INTEGER NOT NULL,
    quality_distribution JSONB,  -- 存储高中低质量的分布

    -- 导出配置
    export_config JSONB,
    file_path TEXT,

    -- 导出的样本ID列表
    annotation_ids INTEGER[],

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 唯一性约束
    UNIQUE(export_version)
);

-- 5. 评估对比表（用于A/B测试）
CREATE TABLE IF NOT EXISTS evaluation_comparisons (
    id SERIAL PRIMARY KEY,

    -- 关联新闻
    news_id INTEGER NOT NULL REFERENCES news_raw_data(id) ON DELETE CASCADE,

    -- 人工标注结果
    human_score INTEGER,
    human_should_filter BOOLEAN,

    -- LLM评估结果
    llm_score INTEGER,
    llm_should_filter BOOLEAN,
    llm_reason TEXT,
    llm_model VARCHAR(100),

    -- AX评估结果
    ax_score INTEGER,
    ax_should_filter BOOLEAN,
    ax_reason TEXT,
    ax_model_version VARCHAR(50),

    -- 对比统计
    llm_deviation INTEGER,  -- 与人工标注的偏差
    ax_deviation INTEGER,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ====================
-- 索引优化
-- ====================

-- news_raw_data 索引
CREATE INDEX IF NOT EXISTS idx_news_raw_status ON news_raw_data(annotation_status);
CREATE INDEX IF NOT EXISTS idx_news_raw_source ON news_raw_data(data_source, category);
CREATE INDEX IF NOT EXISTS idx_news_raw_created ON news_raw_data(created_at DESC);

-- quality_annotations 索引
CREATE INDEX IF NOT EXISTS idx_annotations_news ON quality_annotations(news_id);
CREATE INDEX IF NOT EXISTS idx_annotations_category ON quality_annotations(category);
CREATE INDEX IF NOT EXISTS idx_annotations_score ON quality_annotations(overall_score);
CREATE INDEX IF NOT EXISTS idx_annotations_latest ON quality_annotations(is_latest) WHERE is_latest = true;

-- 确保每条新闻最多只有一个最新标注（部分唯一索引）
CREATE UNIQUE INDEX IF NOT EXISTS idx_annotations_news_latest ON quality_annotations(news_id) WHERE is_latest = true;

-- annotation_history 索引
CREATE INDEX IF NOT EXISTS idx_history_annotation ON annotation_history(annotation_id);
CREATE INDEX IF NOT EXISTS idx_history_news ON annotation_history(news_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON annotation_history(created_at DESC);

-- evaluation_comparisons 索引
CREATE INDEX IF NOT EXISTS idx_comparison_news ON evaluation_comparisons(news_id);

-- ====================
-- 触发器
-- ====================

-- 自动更新 updated_at
CREATE TRIGGER update_news_raw_updated_at
    BEFORE UPDATE ON news_raw_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_annotations_updated_at
    BEFORE UPDATE ON quality_annotations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 标注修改时自动创建历史记录
CREATE OR REPLACE FUNCTION create_annotation_history()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO annotation_history (
        annotation_id,
        news_id,
        snapshot,
        change_type,
        changed_fields,
        operator
    ) VALUES (
        NEW.id,
        NEW.news_id,
        row_to_json(NEW),
        CASE
            WHEN TG_OP = 'INSERT' THEN 'create'
            WHEN TG_OP = 'UPDATE' THEN 'update'
            WHEN TG_OP = 'DELETE' THEN 'delete'
        END,
        NULL,  -- 具体变更字段可由应用层填充
        NEW.annotator
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_annotation_changes
    AFTER INSERT OR UPDATE ON quality_annotations
    FOR EACH ROW EXECUTE FUNCTION create_annotation_history();

-- 创建新标注时，将旧版本的is_latest设为false
CREATE OR REPLACE FUNCTION manage_annotation_versions()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 将该新闻的其他标注设为非最新
        UPDATE quality_annotations
        SET is_latest = false
        WHERE news_id = NEW.news_id
          AND id != NEW.id
          AND is_latest = true;

        -- 更新新闻状态
        UPDATE news_raw_data
        SET annotation_status = 'completed'
        WHERE id = NEW.news_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manage_annotation_versions_trigger
    AFTER INSERT ON quality_annotations
    FOR EACH ROW EXECUTE FUNCTION manage_annotation_versions();

-- ====================
-- 实用视图
-- ====================

-- 待标注新闻视图
CREATE OR REPLACE VIEW pending_annotations AS
SELECT
    n.id,
    n.title,
    n.source,
    n.description,
    n.link,
    n.publish_time,
    n.data_source,
    n.category,
    n.created_at
FROM news_raw_data n
WHERE n.annotation_status = 'pending'
ORDER BY n.created_at DESC;

-- 已标注新闻完整视图
CREATE OR REPLACE VIEW annotated_news AS
SELECT
    n.id,
    n.title,
    n.source,
    n.description,
    n.link,
    n.publish_time,
    n.data_source,
    n.category,
    a.overall_score,
    a.category as quality_category,
    a.should_filter,
    a.news_value,
    a.practicality,
    a.density,
    a.timeliness,
    a.universality,
    a.reason,
    a.tags,
    a.annotator,
    a.difficulty,
    a.confidence,
    a.created_at as annotation_date
FROM news_raw_data n
INNER JOIN quality_annotations a ON n.id = a.news_id
WHERE a.is_latest = true
ORDER BY a.created_at DESC;

-- 标注统计视图
CREATE OR REPLACE VIEW annotation_statistics AS
SELECT
    COUNT(*) as total_news,
    COUNT(CASE WHEN annotation_status = 'pending' THEN 1 END) as pending_count,
    COUNT(CASE WHEN annotation_status = 'completed' THEN 1 END) as completed_count,
    COUNT(CASE WHEN annotation_status = 'skipped' THEN 1 END) as skipped_count,
    data_source,
    category
FROM news_raw_data
GROUP BY data_source, category;

-- 质量分布视图
CREATE OR REPLACE VIEW quality_distribution AS
SELECT
    a.category as quality_level,
    COUNT(*) as count,
    AVG(a.overall_score) as avg_score,
    MIN(a.overall_score) as min_score,
    MAX(a.overall_score) as max_score
FROM quality_annotations a
WHERE a.is_latest = true
GROUP BY a.category;

-- ====================
-- 实用函数
-- ====================

-- 批量导入RSS新闻数据
CREATE OR REPLACE FUNCTION import_rss_news(
    p_title VARCHAR,
    p_source VARCHAR,
    p_description TEXT,
    p_link TEXT,
    p_publish_time TIMESTAMP,
    p_category VARCHAR,
    p_rss_index INTEGER,
    p_raw_data JSONB DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    new_id INTEGER;
BEGIN
    INSERT INTO news_raw_data (
        title, source, description, link, publish_time,
        data_source, category, rss_index, raw_data
    ) VALUES (
        p_title, p_source, p_description, p_link, p_publish_time,
        'rss', p_category, p_rss_index, p_raw_data
    )
    ON CONFLICT (title, source, publish_time) DO NOTHING
    RETURNING id INTO new_id;

    RETURN COALESCE(new_id, 0);
END;
$$ LANGUAGE plpgsql;

-- 导出训练样本（JSON格式）
CREATE OR REPLACE FUNCTION export_training_samples(
    p_min_score INTEGER DEFAULT 0,
    p_max_score INTEGER DEFAULT 100,
    p_limit INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'version', '1.0.0',
        'createdAt', CURRENT_TIMESTAMP,
        'samples', json_agg(
            json_build_object(
                'id', a.id,
                'input', json_build_object(
                    'title', n.title,
                    'source', n.source,
                    'description', n.description
                ),
                'output', json_build_object(
                    'score', a.overall_score,
                    'category', a.category,
                    'shouldFilter', a.should_filter,
                    'reason', a.reason,
                    'dimensions', json_build_object(
                        'newsValue', a.news_value,
                        'practicality', a.practicality,
                        'density', a.density,
                        'timeliness', a.timeliness,
                        'universality', a.universality
                    ),
                    'tags', a.tags
                ),
                'metadata', json_build_object(
                    'annotator', a.annotator,
                    'annotatedAt', a.created_at,
                    'difficulty', a.difficulty,
                    'confidence', a.confidence
                )
            )
        )
    ) INTO result
    FROM quality_annotations a
    INNER JOIN news_raw_data n ON a.news_id = n.id
    WHERE a.is_latest = true
      AND a.overall_score >= p_min_score
      AND a.overall_score <= p_max_score
    ORDER BY a.created_at DESC
    LIMIT p_limit;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 获取标注进度统计
CREATE OR REPLACE FUNCTION get_annotation_progress()
RETURNS TABLE (
    total_count BIGINT,
    pending_count BIGINT,
    completed_count BIGINT,
    completion_rate NUMERIC,
    high_quality_count BIGINT,
    medium_quality_count BIGINT,
    low_quality_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_count,
        COUNT(CASE WHEN n.annotation_status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN n.annotation_status = 'completed' THEN 1 END) as completed_count,
        ROUND(
            COUNT(CASE WHEN n.annotation_status = 'completed' THEN 1 END)::NUMERIC /
            NULLIF(COUNT(*)::NUMERIC, 0) * 100,
            2
        ) as completion_rate,
        COUNT(CASE WHEN a.category = 'high' THEN 1 END) as high_quality_count,
        COUNT(CASE WHEN a.category = 'medium' THEN 1 END) as medium_quality_count,
        COUNT(CASE WHEN a.category = 'low' THEN 1 END) as low_quality_count
    FROM news_raw_data n
    LEFT JOIN quality_annotations a ON n.id = a.news_id AND a.is_latest = true;
END;
$$ LANGUAGE plpgsql;

-- ====================
-- 表注释
-- ====================

COMMENT ON TABLE news_raw_data IS '原始新闻数据表（待标注）';
COMMENT ON TABLE quality_annotations IS '质量标注结果表（人工标注）';
COMMENT ON TABLE annotation_history IS '标注修改历史表';
COMMENT ON TABLE training_export_logs IS '训练集导出记录表';
COMMENT ON TABLE evaluation_comparisons IS '评估方法对比表（A/B测试）';

COMMENT ON VIEW pending_annotations IS '待标注新闻视图';
COMMENT ON VIEW annotated_news IS '已标注新闻完整视图';
COMMENT ON VIEW annotation_statistics IS '标注统计视图';
COMMENT ON VIEW quality_distribution IS '质量分布视图';

COMMENT ON FUNCTION import_rss_news IS '批量导入RSS新闻数据';
COMMENT ON FUNCTION export_training_samples IS '导出训练样本为JSON格式';
COMMENT ON FUNCTION get_annotation_progress IS '获取标注进度统计';
