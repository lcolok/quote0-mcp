-- 04-add-scheduler-state-migration.sql
-- 为调度器添加持久化状态支持

DO $$
BEGIN
    -- 添加 last_run_at 字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_scheduler_jobs'
        AND column_name = 'last_run_at'
    ) THEN
        ALTER TABLE news_scheduler_jobs ADD COLUMN last_run_at TIMESTAMP;
        RAISE NOTICE 'Added last_run_at column to news_scheduler_jobs table';
    END IF;

    -- 添加 next_run_at 字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_scheduler_jobs'
        AND column_name = 'next_run_at'
    ) THEN
        ALTER TABLE news_scheduler_jobs ADD COLUMN next_run_at TIMESTAMP;
        RAISE NOTICE 'Added next_run_at column to news_scheduler_jobs table';
    END IF;

    -- 添加 state 字段 (JSONB存储运行时状态)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_scheduler_jobs'
        AND column_name = 'state'
    ) THEN
        ALTER TABLE news_scheduler_jobs ADD COLUMN state JSONB DEFAULT '{}'::jsonb;
        RAISE NOTICE 'Added state column to news_scheduler_jobs table';
    END IF;

    -- 创建索引以优化查询性能
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'news_scheduler_jobs'
        AND indexname = 'idx_scheduler_jobs_next_run'
    ) THEN
        CREATE INDEX idx_scheduler_jobs_next_run ON news_scheduler_jobs(next_run_at) WHERE enabled = true;
        RAISE NOTICE 'Created index on next_run_at for news_scheduler_jobs';
    END IF;

    RAISE NOTICE 'Scheduler state migration completed successfully';
END $$;
