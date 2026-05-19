/**
 * PostgreSQL数据库缓存服务
 * 替换SQLite，支持容器化部署和更强的并发性能
 */

import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { NewsData } from '../components/NewsWidget.js';

export interface CacheKey {
  source: string;
  category?: string;
  index?: number;
  extra?: Record<string, any>;
}

export interface CacheEntry {
  id: number;
  cacheKey: string;
  source: string;
  category?: string;
  index?: number;
  data: NewsData;
  createdAt: Date;
  expiresAt: Date;
  processingTime?: number;
  metadata?: Record<string, any>;
}

export interface ProcessingTask {
  id: string;
  type: 'news_processing' | 'rss_fetch' | 'llm_optimization' | 'image_render';
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputParams: Record<string, any>;
  outputData?: any;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  processingTime?: number;
}

export interface RSSSnapshot {
  id: number;
  url: string;
  title: string;
  itemsCount: number;
  itemsHash: string;
  rawData: any;
  createdAt: Date;
  expiresAt: Date;
}

export interface ImageCacheEntry {
  id: number;
  cacheKey: string;
  newsCacheId?: number;
  bucketName: string;
  objectKey: string;
  objectSize?: number;
  contentType: string;
  etag: string;
  widgetType: string;
  renderConfig: Record<string, any>;
  createdAt: Date;
  expiresAt: Date;
}

export class PostgresDatabase {
  private pool: Pool;
  private defaultTTL: number = 30 * 60 * 1000; // 30分钟

  constructor(options: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    defaultTTL?: number;
  } = {}) {
    this.defaultTTL = options.defaultTTL || this.defaultTTL;

    if (options.connectionString) {
      this.pool = new Pool({
        connectionString: options.connectionString
      });
    } else {
      this.pool = new Pool({
        host: options.host || 'localhost',
        port: options.port || 5432,
        database: options.database || 'quote0_cache',
        user: options.user || 'quote0_user',
        password: options.password || 'quote0_password',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });
    }
  }

  /**
   * 从 createTablesSQL 自动抽取 requiredTables，避免新增表时漏改白名单。
   */
  private extractRequiredTableNames(sql: string): string[] {
    const matches = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi) || [];
    return matches.map(m => m.replace(/CREATE TABLE IF NOT EXISTS\s+/i, '').trim());
  }

  /**
   * 显式 schema migration 语句列表
   * 每次 initialize() 都会幂等执行（依赖 IF NOT EXISTS / IF EXISTS 子句）
   * extractRequiredTableNames 仅扫 CREATE TABLE 不感知 ALTER，故 ALTER 放这里独立管理
   */
  private getMigrationStatements(): string[] {
    return [
      // Phase F (ADR-0004): BizyAir 图像驱动标签
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'svg'`,
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_model text`,
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_image_url text`,
      // Phase F v1.2.1: async 生成需要新增 generating/failed 状态 + last_error 字段
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS last_error text`,
      // Phase F: image 标签 INSERT 时 svg 为 NULL（仅 svg/component 路径填值）
      `ALTER TABLE labels ALTER COLUMN svg DROP NOT NULL`,
      // status CHECK constraint 扩展：原 ('draft','approved','printed','archived') → 加 'generating','failed'
      // Postgres 不支持 ALTER CHECK constraint，必须 DROP + ADD（用动态 DO block 安全做）
      `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'labels_status_check'
       ) THEN
         ALTER TABLE labels DROP CONSTRAINT labels_status_check;
       END IF;
       ALTER TABLE labels ADD CONSTRAINT labels_status_check
         CHECK (status IN ('draft','approved','printed','archived','generating','failed'));
     END $$`,
      // ADR-0005 (v1.4.0): widget 模板库 + 字体 + v2.0.0 revision 预留
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS widget_props jsonb`,
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS font_family text`,
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS icon_svg text`,
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS parent_revision_id uuid REFERENCES labels(id) ON DELETE SET NULL`,
      // v1.4.4: kimi-for-coding provider 改用 dummy api_key（与 siliconflow 一致，
      // 依赖 Copilot 网关自动注入真实 key，避免硬编码 sk-kimi-... 暴露）
      `UPDATE llm_providers SET api_key = 'dummy', updated_at = now() WHERE slug = 'kimi-for-coding' AND api_key LIKE 'sk-kimi-%'`,
      // v1.5.0: widget 装饰层 SVG paths（绝对定位边缘装饰）
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS frame_svg_paths jsonb`,
      // v1.5.1: 装饰函数代码（LLM 写的 JS generator，sandbox 执行产 frameSvgPaths）
      `ALTER TABLE labels ADD COLUMN IF NOT EXISTS decorator_code text`,
      // v1.6.0: label 生成任务表（取代 labels.status='generating' fire-and-forget）
      `CREATE TABLE IF NOT EXISTS label_jobs (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type          text NOT NULL CHECK (job_type IN ('widget','image')),
        payload           jsonb NOT NULL,
        client_request_id text UNIQUE,
        state             text NOT NULL DEFAULT 'queued'
                          CHECK (state IN ('queued','running','succeeded','failed')),
        lease_owner       text,
        lease_expires_at  timestamptz,
        attempts          int NOT NULL DEFAULT 0,
        max_attempts      int NOT NULL DEFAULT 3,
        label_id          uuid REFERENCES labels(id) ON DELETE SET NULL,
        last_error        text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        started_at        timestamptz,
        finished_at       timestamptz
      )`,
      `CREATE INDEX IF NOT EXISTS label_jobs_claimable_idx
        ON label_jobs(state, lease_expires_at)
        WHERE state IN ('queued','running')`,
      `CREATE INDEX IF NOT EXISTS label_jobs_created_at_idx
        ON label_jobs(created_at DESC)`,
    ];
  }

  /**
   * 初始化数据库连接
   */
  async initialize(): Promise<void> {
    try {
      const client = await this.pool.connect();

      // 测试连接
      const result = await client.query('SELECT NOW() as current_time');
      console.log(`🐘 PostgreSQL数据库已连接: ${result.rows[0].current_time}`);

      // 从 SQL 自动抽取表名，不再手写白名单
      const requiredTables = this.extractRequiredTableNames(this.getCreateTablesSQL());
      if (requiredTables.length === 0) {
        throw new Error('无法从 createTablesSQL 抽取表名，schema 损坏');
      }

      // 检查表是否存在
      const tablesResult = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [requiredTables]
      );

      const existingTables = tablesResult.rows.map(row => row.table_name);
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));

      console.log(`📋 数据库表状态: 发现${existingTables.length}/${requiredTables.length}个表`);

      // 如果有缺失的表，自动创建
      if (missingTables.length > 0) {
        console.log(`🔧 发现${missingTables.length}个缺失的表，开始自动初始化...`);
        await this.createTables(client);
        console.log(`✅ 数据库表结构初始化完成`);
      }

      // 显式 migration runner（每次启动幂等执行，覆盖 if-missing-only 死路）
      const migrations = this.getMigrationStatements();
      console.log(`🔄 执行 ${migrations.length} 条 schema migrations...`);
      for (const stmt of migrations) {
        try {
          await client.query(stmt);
        } catch (e) {
          // 记录但不中断启动（某些 migration 可能依赖另一个先跑）
          console.warn(`⚠️ migration 跳过: ${stmt.slice(0, 80)}... 原因: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log(`✅ schema migrations 执行完成`);

      client.release();
    } catch (error) {
      console.error('❌ PostgreSQL初始化失败:', error);
      throw error;
    }
  }

  /**
   * 获取数据库连接客户端
   * 用于标注API等需要直接执行SQL的场景
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  /**
   * 获取底层连接池（供 LLMCallCache 等内部模块使用）
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * 单条 seed 执行 helper：失败时完整暴露 pg 错误详情，不阻断其他 seed。
   */
  private async runSeedStatements(
    client: PoolClient,
    statements: Array<{ name: string; sql: string }>
  ): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0;
    for (const stmt of statements) {
      try {
        await client.query(stmt.sql);
        ok++;
      } catch (error: any) {
        failed++;
        // pg 错误对象有 .message / .detail / .constraint / .table / .column
        console.error(`❌ Seed 失败 [${stmt.name}]:`, {
          message: error?.message,
          detail: error?.detail,
          hint: error?.hint,
          constraint: error?.constraint,
          table: error?.table,
          column: error?.column,
          code: error?.code,
        });
        // 单条失败不影响其他条；不要 throw
      }
    }
    return { ok, failed };
  }

  /**
   * 返回完整的建表 SQL（供 initialize 抽取表名 + createTables 执行）。
   */
  private getCreateTablesSQL(): string {
    return `
      -- 创建新闻缓存表
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL,
          CONSTRAINT news_cache_expires_check CHECK (expires_at > created_at)
      );

      -- 创建处理任务表
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

      -- 创建图片缓存表
      CREATE TABLE IF NOT EXISTS image_cache (
          id SERIAL PRIMARY KEY,
          cache_key VARCHAR(128) UNIQUE NOT NULL,
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

      -- 调度任务配置
      CREATE TABLE IF NOT EXISTS news_scheduler_jobs (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(100),
          description TEXT,
          category VARCHAR(50) NOT NULL,
          data_source VARCHAR(50) NOT NULL,
          rss_source VARCHAR(100) NOT NULL,
          rss_sources JSONB,
          processor VARCHAR(50) NOT NULL,
          renderer VARCHAR(50) NOT NULL,
          interval_ms INTEGER NOT NULL,
          initial_delay_ms INTEGER NOT NULL DEFAULT 0,
          options JSONB,
          index_strategy JSONB NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          disabled_sources JSONB DEFAULT '[]'::jsonb,
          current_source_index INTEGER NOT NULL DEFAULT 0,
          state JSONB,
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 新闻推送统计
      CREATE TABLE IF NOT EXISTS news_push_stats (
          fingerprint VARCHAR(64) PRIMARY KEY,
          title TEXT,
          link TEXT,
          source VARCHAR(100),
          category VARCHAR(50),
          push_count INTEGER NOT NULL DEFAULT 0,
          last_pushed_at TIMESTAMP,
          metadata JSONB
      );

      -- 新闻推送日志
      CREATE TABLE IF NOT EXISTS news_push_log (
          id SERIAL PRIMARY KEY,
          job_id VARCHAR(64),
          fingerprint VARCHAR(64) NOT NULL REFERENCES news_push_stats(fingerprint) ON DELETE CASCADE,
          pushed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          layer VARCHAR(20),
          is_fallback BOOLEAN,
          result JSONB,
          strategy_snapshot JSONB,
          raw_content JSONB,
          processed_content JSONB,
          image_path TEXT,
          annotation_status VARCHAR(20) DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS scheduler_run_history (
          id BIGSERIAL PRIMARY KEY,
          job_id VARCHAR(64) NOT NULL,
          run_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          run_finished_at TIMESTAMPTZ,
          source VARCHAR(100),
          layer VARCHAR(20),
          candidate_id BIGINT,
          candidate_fingerprint VARCHAR(128),
          candidate_publish_time TIMESTAMPTZ,
          candidate_process_time TIMESTAMPTZ,
          push_time TIMESTAMPTZ,
          push_status VARCHAR(20),
          push_reason TEXT,
          push_count_before INTEGER,
          push_count_after INTEGER,
          cooling_elapsed INTERVAL,
          metadata JSONB
      );

      -- 人工标注表（AX 训练 ground truth 来源；annotation-api.ts 使用）
      CREATE TABLE IF NOT EXISTS quality_annotations (
          id SERIAL PRIMARY KEY,
          news_id INTEGER NOT NULL REFERENCES news_push_log(id) ON DELETE CASCADE,

          -- 核心评分
          overall_score INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
          category VARCHAR(10) NOT NULL CHECK (category IN ('high', 'medium', 'low')),
          should_filter BOOLEAN NOT NULL DEFAULT false,

          -- 维度评分（可选）
          news_value INTEGER,
          practicality INTEGER,
          density INTEGER,
          timeliness INTEGER,
          universality INTEGER,

          -- 标注元数据
          reason TEXT,
          tags JSONB DEFAULT '[]'::jsonb,
          annotator VARCHAR(100) DEFAULT 'human',
          difficulty VARCHAR(10) CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
          confidence INTEGER,

          -- AX 训练 ground truth
          optimized_title TEXT,
          optimized_summary TEXT,
          optimized_content TEXT,

          -- 版本管理
          is_latest BOOLEAN NOT NULL DEFAULT true,

          -- 时间戳
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- LLM调用缓存表（prompt-hash 缓存，避免重复调用 LLM）
      CREATE TABLE IF NOT EXISTS llm_call_cache (
          cache_key VARCHAR(64) PRIMARY KEY,
          model VARCHAR(100) NOT NULL,
          prompt_preview TEXT,
          response TEXT NOT NULL,
          tokens_in INTEGER,
          tokens_out INTEGER,
          hit_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_hit_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
      );

      -- 数据库迁移：为兼容旧结构补齐缺失字段
      ALTER TABLE news_cache ADD COLUMN IF NOT EXISTS image_path TEXT;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS rss_sources JSONB;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS disabled_sources JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS current_source_index INTEGER DEFAULT 0;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS state JSONB;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
      ALTER TABLE news_scheduler_jobs ADD COLUMN IF NOT EXISTS metadata JSONB;
      ALTER TABLE news_push_log ADD COLUMN IF NOT EXISTS layer VARCHAR(20);
      ALTER TABLE news_push_log ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN;
      ALTER TABLE news_push_log ADD COLUMN IF NOT EXISTS strategy_snapshot JSONB;
      ALTER TABLE news_push_log ADD COLUMN IF NOT EXISTS raw_content JSONB;
      ALTER TABLE news_push_log ADD COLUMN IF NOT EXISTS processed_content JSONB;

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
      CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_enabled ON news_scheduler_jobs(enabled);
      CREATE INDEX IF NOT EXISTS idx_push_stats_last ON news_push_stats(last_pushed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_push_stats_count ON news_push_stats(push_count, last_pushed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_push_log_job ON news_push_log(job_id, pushed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_push_log_fingerprint ON news_push_log(fingerprint, pushed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduler_run_history_job ON scheduler_run_history(job_id, run_started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_qa_news_id_latest ON quality_annotations(news_id) WHERE is_latest = true;
      CREATE INDEX IF NOT EXISTS idx_qa_score_latest ON quality_annotations(overall_score) WHERE is_latest = true;
      CREATE INDEX IF NOT EXISTS idx_qa_category_latest ON quality_annotations(category) WHERE is_latest = true;
      CREATE INDEX IF NOT EXISTS idx_qa_annotator ON quality_annotations(annotator, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_call_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_llm_cache_model_lasthit ON llm_call_cache(model, last_hit_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduler_run_history_status ON scheduler_run_history(push_status);

      -- 插入初始统计数据
      INSERT INTO cache_stats (cache_type, hit_count, miss_count, total_requests) 
      VALUES 
          ('news', 0, 0, 0),
          ('image', 0, 0, 0),
          ('rss', 0, 0, 0)
      ON CONFLICT (cache_type) DO NOTHING;

      -- 创建更新触发器函数
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- 创建触发器
      DROP TRIGGER IF EXISTS update_processing_tasks_updated_at ON processing_tasks;
      CREATE TRIGGER update_processing_tasks_updated_at 
          BEFORE UPDATE ON processing_tasks 
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_scheduler_jobs_updated_at ON news_scheduler_jobs;
      CREATE TRIGGER update_scheduler_jobs_updated_at
          BEFORE UPDATE ON news_scheduler_jobs
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      -- 创建清理函数
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
          RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql;

      -- LLM 提供方表
      CREATE TABLE IF NOT EXISTS llm_providers (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(64) UNIQUE NOT NULL,
        display_name VARCHAR(128) NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_type VARCHAR(32) NOT NULL DEFAULT 'openai-completions',
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- LLM 模型表（一个 provider 多个 model）
      CREATE TABLE IF NOT EXISTS llm_models (
        id SERIAL PRIMARY KEY,
        provider_id INTEGER NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
        model_id VARCHAR(128) NOT NULL,
        display_name VARCHAR(128) NOT NULL,
        context_window INTEGER,
        max_tokens INTEGER,
        reasoning BOOLEAN DEFAULT false,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider_id, model_id)
      );

      -- 当前激活的 provider+model（单行 settings 表，id=1 固定）
      CREATE TABLE IF NOT EXISTS llm_active_setting (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        active_provider_id INTEGER REFERENCES llm_providers(id),
        active_model_id INTEGER REFERENCES llm_models(id),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_llm_models_provider ON llm_models(provider_id);

      -- 内容素材库
      CREATE TABLE IF NOT EXISTS content_inventory (
        id SERIAL PRIMARY KEY,
        producer_job_id VARCHAR(64) NOT NULL,
        content_type VARCHAR(20) NOT NULL,
        source VARCHAR(64),
        category VARCHAR(50),
        fingerprint VARCHAR(128) UNIQUE,
        title TEXT,
        link TEXT,
        raw_content JSONB,
        processed_content JSONB,
        image_path TEXT NOT NULL,
        state VARCHAR(20) NOT NULL DEFAULT 'ready'
          CHECK (state IN ('ready', 'pushed', 'expired')),
        replay_count INTEGER NOT NULL DEFAULT 0,
        max_replays INTEGER NOT NULL DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_pushed_at TIMESTAMP,
        expires_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_state ON content_inventory(state, created_at);
      CREATE INDEX IF NOT EXISTS idx_inventory_replay ON content_inventory(state, last_pushed_at) WHERE state='pushed';
      CREATE INDEX IF NOT EXISTS idx_inventory_producer ON content_inventory(producer_job_id);

      -- job_role 列：producer / consumer / mixed
      ALTER TABLE news_scheduler_jobs
        ADD COLUMN IF NOT EXISTS job_role VARCHAR(20) NOT NULL DEFAULT 'mixed'
        CHECK (job_role IN ('producer', 'consumer', 'mixed'));

      -- 渲染目标配置表（Phase A：多目标渲染抽象）
      CREATE TABLE IF NOT EXISTS render_targets (
        id              text PRIMARY KEY,
        kind            text NOT NULL CHECK (kind IN ('eink','thermal-label')),
        width_px        int  NOT NULL,
        height_px       int  NOT NULL,
        dpi             int  NOT NULL,
        color_mode      text NOT NULL,
        default_font_stack jsonb NOT NULL,
        push_endpoint   text,
        physical_w_mm   int,
        physical_h_mm   int,
        created_at      timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO render_targets (id, kind, width_px, height_px, dpi, color_mode, default_font_stack, physical_w_mm, physical_h_mm)
      VALUES
        ('eink-296x152', 'eink', 296, 152, 250, 'mono-1bit', '["fusion-pixel-12"]'::jsonb, NULL, NULL),
        ('label-T40x20-320', 'thermal-label', 320, 160, 203, 'mono-1bit', '["source-han-sans","inter"]'::jsonb, 40, 20)
      ON CONFLICT (id) DO NOTHING;

      -- 标签管理（Phase D：LLM-Gen 标签管理系统）
      CREATE TABLE IF NOT EXISTS labels (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        prompt          text NOT NULL,
        svg             text NOT NULL,
        png_path        text,                     -- MinIO object key (labels/<id>.png)
        bin_bytes       int,                      -- 1-bit packed bitmap size
        target_id       text NOT NULL DEFAULT 'label-T40x20-320',
        llm_model       text,
        llm_latency_ms  int,
        status          text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','printed','archived')),
        print_count     int NOT NULL DEFAULT 0,
        print_history   jsonb NOT NULL DEFAULT '[]'::jsonb,
        tags            text[] NOT NULL DEFAULT ARRAY[]::text[],
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS labels_status_idx ON labels(status);
      CREATE INDEX IF NOT EXISTS labels_created_at_idx ON labels(created_at DESC);
      CREATE INDEX IF NOT EXISTS labels_tags_gin_idx ON labels USING gin(tags);

    `;
  }

  /**
   * 自动创建数据库表结构
   */
  private async createTables(client: PoolClient): Promise<void> {
    const createTablesSQL = this.getCreateTablesSQL();

    try {
      await client.query(createTablesSQL);
      console.log('🔧 数据库表结构创建成功');
    } catch (error) {
      console.error('❌ 创建数据库表失败:', error);
      throw error;
    }

    // Seed LLM providers & models (幂等，单条失败不阻断其他)
    const llmSeedStatements = [
      { name: 'siliconflow provider', sql: `INSERT INTO llm_providers (slug, display_name, base_url, api_key, api_type)
        SELECT 'siliconflow', 'SiliconFlow (via copilot)', 'https://copilot.logic.heiyu.space/providers/siliconflow/v1', 'dummy', 'openai-completions'
        WHERE NOT EXISTS (SELECT 1 FROM llm_providers)` },
      { name: 'kimi-for-coding provider', sql: `INSERT INTO llm_providers (slug, display_name, base_url, api_key, api_type)
        SELECT 'kimi-for-coding', 'Kimi For Coding (via copilot)', 'https://copilot.logic.heiyu.space/providers/kimi-for-coding/v1', 'sk-kimi-6CEsG7VymIssuaj9A3CMnFClXIIrigTbIRKXRvdSJar95QbcfNIpYX2B1mHPcgJP', 'openai-completions'
        WHERE NOT EXISTS (SELECT 1 FROM llm_providers WHERE slug='kimi-for-coding')` },
      { name: 'DeepSeek-V4-Flash model', sql: `INSERT INTO llm_models (provider_id, model_id, display_name, context_window, max_tokens, reasoning)
        SELECT p.id, 'deepseek-ai/DeepSeek-V4-Flash', 'DeepSeek V4-Flash', 64000, 8192, true
        FROM llm_providers p WHERE p.slug='siliconflow'
        AND NOT EXISTS (SELECT 1 FROM llm_models m WHERE m.provider_id=p.id AND m.model_id='deepseek-ai/DeepSeek-V4-Flash')` },
      { name: 'DeepSeek-V3 model', sql: `INSERT INTO llm_models (provider_id, model_id, display_name, context_window, max_tokens, reasoning)
        SELECT p.id, 'deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 64000, 8192, true
        FROM llm_providers p WHERE p.slug='siliconflow'
        AND NOT EXISTS (SELECT 1 FROM llm_models m WHERE m.provider_id=p.id AND m.model_id='deepseek-ai/DeepSeek-V3')` },
      { name: 'GLM 5.1 model', sql: `INSERT INTO llm_models (provider_id, model_id, display_name, context_window, max_tokens, reasoning)
        SELECT p.id, 'Pro/zai-org/GLM-5.1', 'GLM 5.1', 32000, 8192, true
        FROM llm_providers p WHERE p.slug='siliconflow'
        AND NOT EXISTS (SELECT 1 FROM llm_models m WHERE m.provider_id=p.id AND m.model_id='Pro/zai-org/GLM-5.1')` },
      { name: 'kimi-for-coding model', sql: `INSERT INTO llm_models (provider_id, model_id, display_name, context_window, max_tokens)
        SELECT p.id, 'kimi-for-coding', 'Kimi For Coding', 128000, 8192
        FROM llm_providers p WHERE p.slug='kimi-for-coding'
        AND NOT EXISTS (SELECT 1 FROM llm_models m WHERE m.provider_id=p.id AND m.model_id='kimi-for-coding')` },
      { name: 'active setting', sql: `INSERT INTO llm_active_setting (id, active_provider_id, active_model_id)
        SELECT 1,
          (SELECT id FROM llm_providers WHERE slug='siliconflow'),
          (SELECT id FROM llm_models WHERE model_id='deepseek-ai/DeepSeek-V4-Flash')
        WHERE NOT EXISTS (SELECT 1 FROM llm_active_setting)` },
    ];
    const llmResult = await this.runSeedStatements(client, llmSeedStatements);
    console.log(`🔧 LLM providers seed: ${llmResult.ok} ok, ${llmResult.failed} failed`);

    // Seed job roles for producer/consumer architecture
    const jobRoleSeedStatements = [
      { name: 'set multi-source-rotation as producer', sql: `UPDATE news_scheduler_jobs SET job_role='producer' WHERE id='multi-source-rotation' AND job_role='mixed'` },
      { name: 'insert device-content-rotator consumer', sql: `INSERT INTO news_scheduler_jobs (id, name, enabled, data_source, processor, renderer, rss_source, category, interval_ms, job_role, index_strategy)
        SELECT 'device-content-rotator', '设备内容轮播器', true, 'inventory', 'passthrough', 'local-eink', 'inventory', 'inventory', 60000, 'consumer', '{"type":"fair-rotation","poolSize":10,"startIndex":0,"cooldownHours":24,"maxPushCount":5,"rotateAfterEachPush":true,"skipEmptySource":true}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM news_scheduler_jobs WHERE id='device-content-rotator')` },
    ];
    const jobResult = await this.runSeedStatements(client, jobRoleSeedStatements);
    console.log(`🔧 Job role seed: ${jobResult.ok} ok, ${jobResult.failed} failed`);
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(params: CacheKey): string {
    const keyObject = {
      source: params.source,
      category: params.category || 'default',
      index: params.index ?? 'auto',
      extra: params.extra || {}
    };
    
    const keyString = JSON.stringify(keyObject, Object.keys(keyObject).sort());
    return createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * 获取缓存的新闻数据
   */
  async getCachedNews(cacheKey: CacheKey, force: boolean = false): Promise<NewsData | null> {
    if (force) {
      console.log('🔄 强制刷新，跳过数据库缓存查询');
      return null;
    }

    const client = await this.pool.connect();
    try {
      const key = this.generateCacheKey(cacheKey);
      
      const result = await client.query(`
        SELECT * FROM news_cache 
        WHERE cache_key = $1 AND expires_at > NOW()
      `, [key]);

      if (result.rows.length === 0) {
        console.log(`📭 数据库缓存未命中: ${key}`);
        return null;
      }

      const row = result.rows[0];
      console.log(`💾 数据库缓存命中: ${key} (来源: ${row.source}, 创建时间: ${row.created_at})`);

      // 更新统计
      await this.updateCacheStats('news', true);

      const newsData: NewsData = {
        title: row.title,
        message: row.message,
        signature: row.signature,
        source: row.source_name,
        publishTime: row.publish_time,
        category: row.category_name,
        link: row.link || undefined,
        highlights: row.highlights || undefined
      };

      return newsData;
    } catch (error) {
      console.error('❌ 数据库缓存查询失败:', error);
      await this.updateCacheStats('news', false);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * 保存新闻数据到缓存
   */
  async setCachedNews(
    cacheKey: CacheKey,
    newsData: NewsData,
    options: {
      ttl?: number;
      processingTime?: number;
      imagePath?: string;
    } = {}
  ): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      const key = this.generateCacheKey(cacheKey);
      const expiresAt = new Date(Date.now() + (options.ttl || this.defaultTTL));

      const result = await client.query(`
        INSERT INTO news_cache (
          cache_key, source, category, index_num, title, message, signature,
          source_name, publish_time, category_name, link, highlights,
          processing_time, image_path, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (cache_key) DO UPDATE SET
          title = EXCLUDED.title,
          message = EXCLUDED.message,
          signature = EXCLUDED.signature,
          source_name = EXCLUDED.source_name,
          publish_time = EXCLUDED.publish_time,
          category_name = EXCLUDED.category_name,
          link = EXCLUDED.link,
          highlights = EXCLUDED.highlights,
          processing_time = EXCLUDED.processing_time,
          image_path = EXCLUDED.image_path,
          expires_at = EXCLUDED.expires_at,
          created_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [
        key,
        cacheKey.source,
        cacheKey.category,
        cacheKey.index,
        newsData.title,
        newsData.message,
        newsData.signature,
        newsData.source,
        newsData.publishTime,
        newsData.category,
        newsData.link,
        newsData.highlights ? JSON.stringify(newsData.highlights) : null,
        options.processingTime,
        options.imagePath || null,
        expiresAt
      ]);

      const id = result.rows[0]?.id;
      const ttlMinutes = Math.round((options.ttl || this.defaultTTL) / 60000);
      console.log(`💾 新闻已缓存到PostgreSQL: ${key} (ID: ${id}, TTL: ${ttlMinutes}分钟)`);
      
      return id;
    } catch (error) {
      console.error('❌ 数据库缓存保存失败:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * 创建处理任务
   */
  async createTask(
    type: ProcessingTask['type'],
    inputParams: Record<string, any>
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      const taskId = createHash('sha256')
        .update(`${type}-${JSON.stringify(inputParams)}-${Date.now()}`)
        .digest('hex')
        .substring(0, 12);

      await client.query(`
        INSERT INTO processing_tasks (id, type, input_params, status)
        VALUES ($1, $2, $3, 'pending')
      `, [taskId, type, JSON.stringify(inputParams)]);

      console.log(`📝 处理任务已创建: ${taskId} (类型: ${type})`);
      return taskId;
    } catch (error) {
      console.error('❌ 创建处理任务失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 更新处理任务状态
   */
  async updateTask(
    taskId: string,
    updates: {
      status?: ProcessingTask['status'];
      outputData?: any;
      errorMessage?: string;
      processingTime?: number;
    }
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updates.status) {
        updateFields.push(`status = $${paramIndex++}`);
        updateValues.push(updates.status);
      }
      if (updates.outputData) {
        updateFields.push(`output_data = $${paramIndex++}`);
        updateValues.push(JSON.stringify(updates.outputData));
      }
      if (updates.errorMessage) {
        updateFields.push(`error_message = $${paramIndex++}`);
        updateValues.push(updates.errorMessage);
      }
      if (updates.processingTime) {
        updateFields.push(`processing_time = $${paramIndex++}`);
        updateValues.push(updates.processingTime);
      }

      if (updateFields.length === 0) return;

      updateValues.push(taskId);

      await client.query(`
        UPDATE processing_tasks 
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
      `, updateValues);

      console.log(`📝 任务状态更新: ${taskId} → ${updates.status || 'updated'}`);
    } catch (error) {
      console.error('❌ 更新处理任务失败:', error);
    } finally {
      client.release();
    }
  }

  /**
   * 保存RSS快照
   */
  async saveRSSSnapshot(url: string, feedData: any, ttl: number = 10 * 60 * 1000): Promise<void> {
    const client = await this.pool.connect();
    try {
      const itemsHash = createHash('md5')
        .update(JSON.stringify(feedData.items || []))
        .digest('hex');

      const expiresAt = new Date(Date.now() + ttl);

      await client.query(`
        INSERT INTO rss_snapshots (
          url, title, items_count, items_hash, raw_data, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (url) DO UPDATE SET
          title = EXCLUDED.title,
          items_count = EXCLUDED.items_count,
          items_hash = EXCLUDED.items_hash,
          raw_data = EXCLUDED.raw_data,
          expires_at = EXCLUDED.expires_at,
          created_at = CURRENT_TIMESTAMP
      `, [
        url,
        feedData.title || 'Unknown Feed',
        feedData.items?.length || 0,
        itemsHash,
        JSON.stringify(feedData),
        expiresAt
      ]);

      console.log(`📡 RSS快照已保存到PostgreSQL: ${url} (${feedData.items?.length || 0}条)`);
    } catch (error) {
      console.error('❌ 保存RSS快照失败:', error);
    } finally {
      client.release();
    }
  }

  /**
   * 获取RSS快照
   */
  async getRSSSnapshot(url: string): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM rss_snapshots 
        WHERE url = $1 AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1
      `, [url]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      console.log(`📡 RSS快照命中: ${url} (${row.items_count}条, 创建时间: ${row.created_at})`);
      
      return JSON.parse(row.raw_data);
    } catch (error) {
      console.error('❌ 获取RSS快照失败:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * 保存图片缓存信息
   */
  async setCachedImage(imageInfo: {
    cacheKey: string;
    newsCacheId?: number;
    bucketName: string;
    objectKey: string;
    objectSize?: number;
    contentType: string;
    etag: string;
    widgetType: string;
    renderConfig: Record<string, any>;
    ttl?: number;
  }): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      const expiresAt = new Date(Date.now() + (imageInfo.ttl || 24 * 60 * 60 * 1000)); // 默认24小时

      const result = await client.query(`
        INSERT INTO image_cache (
          cache_key, news_cache_id, bucket_name, object_key, object_size,
          content_type, etag, widget_type, render_config, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (cache_key) DO UPDATE SET
          news_cache_id = EXCLUDED.news_cache_id,
          bucket_name = EXCLUDED.bucket_name,
          object_key = EXCLUDED.object_key,
          object_size = EXCLUDED.object_size,
          content_type = EXCLUDED.content_type,
          etag = EXCLUDED.etag,
          widget_type = EXCLUDED.widget_type,
          render_config = EXCLUDED.render_config,
          expires_at = EXCLUDED.expires_at,
          created_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [
        imageInfo.cacheKey,
        imageInfo.newsCacheId,
        imageInfo.bucketName,
        imageInfo.objectKey,
        imageInfo.objectSize,
        imageInfo.contentType,
        imageInfo.etag,
        imageInfo.widgetType,
        JSON.stringify(imageInfo.renderConfig),
        expiresAt
      ]);

      const id = result.rows[0]?.id;
      console.log(`🖼️ 图片缓存信息已保存: ${imageInfo.cacheKey} (ID: ${id})`);
      
      return id;
    } catch (error) {
      console.error('❌ 保存图片缓存信息失败:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * 获取图片缓存信息
   */
  async getCachedImage(cacheKey: string): Promise<ImageCacheEntry | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM image_cache 
        WHERE cache_key = $1 AND expires_at > NOW()
      `, [cacheKey]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      console.log(`🖼️ 图片缓存命中: ${cacheKey} (对象: ${row.object_key})`);

      return {
        id: row.id,
        cacheKey: row.cache_key,
        newsCacheId: row.news_cache_id,
        bucketName: row.bucket_name,
        objectKey: row.object_key,
        objectSize: row.object_size,
        contentType: row.content_type,
        etag: row.etag,
        widgetType: row.widget_type,
        renderConfig: typeof row.render_config === 'string' ? JSON.parse(row.render_config) : row.render_config,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    } catch (error) {
      console.error('❌ 获取图片缓存信息失败:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * 更新缓存统计
   */
  private async updateCacheStats(cacheType: string, hit: boolean): Promise<void> {
    const client = await this.pool.connect();
    try {
      if (hit) {
        await client.query(`
          UPDATE cache_stats 
          SET hit_count = hit_count + 1, total_requests = total_requests + 1
          WHERE cache_type = $1
        `, [cacheType]);
      } else {
        await client.query(`
          UPDATE cache_stats 
          SET miss_count = miss_count + 1, total_requests = total_requests + 1
          WHERE cache_type = $1
        `, [cacheType]);
      }
    } catch (error) {
      // 忽略统计更新错误
    } finally {
      client.release();
    }
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<{ news: number; rss: number; images: number; tasks: number }> {
    const client = await this.pool.connect();
    try {
      const results = await Promise.all([
        client.query('DELETE FROM news_cache WHERE expires_at < NOW()'),
        client.query('DELETE FROM rss_snapshots WHERE expires_at < NOW()'),
        client.query('DELETE FROM image_cache WHERE expires_at < NOW()'),
        client.query(`
          DELETE FROM processing_tasks 
          WHERE status IN ('completed', 'failed') 
            AND created_at < NOW() - INTERVAL '7 days'
        `)
      ]);

      const deleted = {
        news: results[0].rowCount || 0,
        rss: results[1].rowCount || 0,
        images: results[2].rowCount || 0,
        tasks: results[3].rowCount || 0
      };

      console.log(`🧹 PostgreSQL清理完成: 新闻${deleted.news}条, RSS${deleted.rss}条, 图片${deleted.images}条, 任务${deleted.tasks}条`);
      
      return deleted;
    } catch (error) {
      console.error('❌ 数据库清理失败:', error);
      return { news: 0, rss: 0, images: 0, tasks: 0 };
    } finally {
      client.release();
    }
  }

  /**
   * 获取数据库统计信息
   */
  async getStats(): Promise<{
    cachedNews: number;
    activeTasks: number;
    rssSnapshots: number;
    cachedImages: number;
    cacheStats: Record<string, any>;
  }> {
    const client = await this.pool.connect();
    try {
      const results = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM news_cache WHERE expires_at > NOW()'),
        client.query('SELECT COUNT(*) as count FROM processing_tasks WHERE status IN (\'pending\', \'running\')'),
        client.query('SELECT COUNT(*) as count FROM rss_snapshots WHERE expires_at > NOW()'),
        client.query('SELECT COUNT(*) as count FROM image_cache WHERE expires_at > NOW()'),
        client.query('SELECT * FROM cache_stats')
      ]);

      const cacheStats: Record<string, any> = {};
      results[4].rows.forEach(row => {
        cacheStats[row.cache_type] = {
          hitCount: parseInt(row.hit_count),
          missCount: parseInt(row.miss_count),
          totalRequests: parseInt(row.total_requests),
          hitRate: row.total_requests > 0 ? (row.hit_count / row.total_requests * 100).toFixed(2) + '%' : '0%'
        };
      });

      return {
        cachedNews: parseInt(results[0].rows[0].count),
        activeTasks: parseInt(results[1].rows[0].count),
        rssSnapshots: parseInt(results[2].rows[0].count),
        cachedImages: parseInt(results[3].rows[0].count),
        cacheStats
      };
    } catch (error) {
      console.error('❌ 获取数据库统计失败:', error);
      return { cachedNews: 0, activeTasks: 0, rssSnapshots: 0, cachedImages: 0, cacheStats: {} };
    } finally {
      client.release();
    }
  }

  /**
   * 调度任务：获取全部配置
   */
  async getSchedulerJobs(): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM news_scheduler_jobs ORDER BY id');
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        dataSource: row.data_source,
        rssSource: row.rss_source,
        rssSources: row.rss_sources || undefined, // jsonb类型已自动解析
        disabledSources: row.disabled_sources || [], // 禁用的RSS源列表
        currentSourceIndex: row.current_source_index || 0, // RSS源轮换索引
        processor: row.processor,
        renderer: row.renderer,
        intervalMs: row.interval_ms,
        initialDelayMs: row.initial_delay_ms,
        options: row.options || {},
        indexStrategy: row.index_strategy || {},
        enabled: row.enabled,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
        lastRunAt: row.last_run_at?.toISOString?.() || row.last_run_at,
        nextRunAt: row.next_run_at?.toISOString?.() || row.next_run_at,
        state: row.state || {},
        metadata: row.metadata || {},
        jobRole: row.job_role || 'mixed'
      }));
    } finally {
      client.release();
    }
  }

  async getSchedulerJob(id: string): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM news_scheduler_jobs WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        dataSource: row.data_source,
        rssSource: row.rss_source,
        rssSources: row.rss_sources || undefined, // jsonb类型已自动解析
        disabledSources: row.disabled_sources || [], // 禁用的RSS源列表
        currentSourceIndex: row.current_source_index || 0, // RSS源轮换索引
        processor: row.processor,
        renderer: row.renderer,
        intervalMs: row.interval_ms,
        initialDelayMs: row.initial_delay_ms,
        options: row.options || {},
        indexStrategy: row.index_strategy || {},
        enabled: row.enabled,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
        lastRunAt: row.last_run_at?.toISOString?.() || row.last_run_at,
        nextRunAt: row.next_run_at?.toISOString?.() || row.next_run_at,
        state: row.state || {},
        metadata: row.metadata || {},
        jobRole: row.job_role || 'mixed'
      };
    } finally {
      client.release();
    }
  }

  async upsertSchedulerJob(job: {
    id: string;
    name?: string;
    description?: string;
    category: string;
    dataSource: string;
    rssSource?: string;
    rssSources?: string[]; // 多源轮换支持
    processor: string;
    renderer: string;
    intervalMs: number;
    initialDelayMs: number;
    options?: Record<string, any>;
    indexStrategy: Record<string, any>;
    enabled?: boolean;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO news_scheduler_jobs (
          id, name, description, category, data_source, rss_source, rss_sources,
          processor, renderer, interval_ms, initial_delay_ms, options,
          index_strategy, enabled
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, COALESCE($14, true)
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          data_source = EXCLUDED.data_source,
          rss_source = EXCLUDED.rss_source,
          rss_sources = EXCLUDED.rss_sources,
          processor = EXCLUDED.processor,
          renderer = EXCLUDED.renderer,
          interval_ms = EXCLUDED.interval_ms,
          initial_delay_ms = EXCLUDED.initial_delay_ms,
          options = EXCLUDED.options,
          index_strategy = EXCLUDED.index_strategy,
          enabled = EXCLUDED.enabled,
          updated_at = CURRENT_TIMESTAMP
      `, [
        job.id,
        job.name || null,
        job.description || null,
        job.category,
        job.dataSource,
        job.rssSource || null,
        job.rssSources || null, // jsonb类型自动序列化
        job.processor,
        job.renderer,
        job.intervalMs,
        job.initialDelayMs,
        job.options || {},
        job.indexStrategy || {},
        job.enabled ?? true
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * 局部更新调度任务（HTTP PATCH 语义）。
   * 未传字段（undefined / null）保留 DB 原值，符合 RFC 5789 PATCH 语义。
   * 不同于 upsertSchedulerJob 的"全替换"行为。
   *
   * 关于 jsonb 字段（rssSources/options/indexStrategy/disabledSources）的语义：
   * - undefined / null → 保留 DB 原值（COALESCE 接收 SQL NULL）
   * - [] / {} 等显式值 → 替换为对应 JSON 值
   * 注意：若要显式清空 rss_sources，请传 [] 而非 null；null 被视为保留原值。
   *
   * @param id 任务 id（必填）
   * @param partial 待更新字段（任意子集）
   * @returns 更新后的 job 完整 record（用于回传给客户端）
   */
  async patchSchedulerJob(
    id: string,
    partial: {
      name?: string;
      description?: string;
      category?: string;
      dataSource?: string;
      rssSource?: string;
      rssSources?: string[] | null;
      processor?: string;
      renderer?: string;
      intervalMs?: number;
      initialDelayMs?: number;
      options?: Record<string, any>;
      indexStrategy?: Record<string, any>;
      enabled?: boolean;
      jobRole?: 'producer' | 'consumer' | 'mixed';
      disabledSources?: string[];
    }
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE news_scheduler_jobs SET
          name             = COALESCE($2,  name),
          description      = COALESCE($3,  description),
          category         = COALESCE($4,  category),
          data_source      = COALESCE($5,  data_source),
          rss_source       = COALESCE($6,  rss_source),
          rss_sources      = COALESCE($7,  rss_sources),
          processor        = COALESCE($8,  processor),
          renderer         = COALESCE($9,  renderer),
          interval_ms      = COALESCE($10, interval_ms),
          initial_delay_ms = COALESCE($11, initial_delay_ms),
          options          = COALESCE($12, options),
          index_strategy   = COALESCE($13, index_strategy),
          enabled          = COALESCE($14, enabled),
          job_role         = COALESCE($15, job_role),
          disabled_sources = COALESCE($16, disabled_sources),
          updated_at       = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
        [
          id,
          partial.name ?? null,
          partial.description ?? null,
          partial.category ?? null,
          partial.dataSource ?? null,
          partial.rssSource ?? null,
          // undefined / null 均视为保留原值；显式清空请传 []
          partial.rssSources === undefined || partial.rssSources === null
            ? null
            : partial.rssSources,
          partial.processor ?? null,
          partial.renderer ?? null,
          partial.intervalMs ?? null,
          partial.initialDelayMs ?? null,
          partial.options === undefined || partial.options === null
            ? null
            : partial.options,
          partial.indexStrategy === undefined || partial.indexStrategy === null
            ? null
            : partial.indexStrategy,
          partial.enabled ?? null,
          partial.jobRole ?? null,
          partial.disabledSources === undefined || partial.disabledSources === null
            ? null
            : partial.disabledSources,
        ]
      );

      if (result.rows.length === 0) {
        throw new Error(`patchSchedulerJob: 任务 id="${id}" 不存在`);
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        dataSource: row.data_source,
        rssSource: row.rss_source,
        rssSources: row.rss_sources || undefined,
        disabledSources: row.disabled_sources || [],
        currentSourceIndex: row.current_source_index || 0,
        processor: row.processor,
        renderer: row.renderer,
        intervalMs: row.interval_ms,
        initialDelayMs: row.initial_delay_ms,
        options: row.options || {},
        indexStrategy: row.index_strategy || {},
        enabled: row.enabled,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
        lastRunAt: row.last_run_at?.toISOString?.() || row.last_run_at,
        nextRunAt: row.next_run_at?.toISOString?.() || row.next_run_at,
        state: row.state || {},
        metadata: row.metadata || {},
        jobRole: row.job_role || 'mixed',
      };
    } finally {
      client.release();
    }
  }

  async deleteSchedulerJob(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM news_scheduler_jobs WHERE id = $1', [id]);
    } finally {
      client.release();
    }
  }

  async updateJobSourceIndex(id: string, currentSourceIndex: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE news_scheduler_jobs
        SET current_source_index = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [id, currentSourceIndex]);
    } finally {
      client.release();
    }
  }

  /**
   * 保存调度器运行时状态（持久化支持）
   */
  async saveSchedulerState(id: string, state: {
    nextIndex: number;
    lastIndex: number | null;
    shuffledOrder: number[];
    shuffledPointer: number;
    consecutiveFailures: number;
    currentSourceIndex: number;
    dynamicPoolSize: number | null;
    recentFingerprints: string[];
    failureCount?: Record<string, number>;
  }, nextRunAt?: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE news_scheduler_jobs
        SET state = $2::jsonb,
            last_run_at = CURRENT_TIMESTAMP,
            next_run_at = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [id, JSON.stringify(state), nextRunAt || null]);
    } finally {
      client.release();
    }
  }

  async createSchedulerRunHistory(entry: {
    jobId: string;
    runStartedAt?: Date;
    layer?: string;
    source?: string;
    candidateId?: number;
    candidateFingerprint?: string;
    candidatePublishTime?: Date | string | null;
    candidateProcessTime?: Date | string | null;
    pushStatus?: string;
    pushReason?: string;
    pushCountBefore?: number;
    metadata?: Record<string, any> | null;
  }): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO scheduler_run_history (
            job_id,
            run_started_at,
            layer,
            source,
            candidate_id,
            candidate_fingerprint,
            candidate_publish_time,
            candidate_process_time,
            push_status,
            push_reason,
            push_count_before,
            metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'running'), $10, $11, $12)
        RETURNING id
      `,
        [
          entry.jobId,
          entry.runStartedAt || new Date(),
          entry.layer || null,
          entry.source || null,
          entry.candidateId ?? null,
          entry.candidateFingerprint || null,
          entry.candidatePublishTime || null,
          entry.candidateProcessTime || null,
          entry.pushStatus || null,
          entry.pushReason || null,
          entry.pushCountBefore ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null
        ]
      );

      return result.rows[0]?.id as number;
    } finally {
      client.release();
    }
  }

  async updateSchedulerRunHistory(id: number, updates: {
    runFinishedAt?: Date | string | null;
    layer?: string | null;
    source?: string | null;
    candidateId?: number | null;
    candidateFingerprint?: string | null;
    candidatePublishTime?: Date | string | null;
    candidateProcessTime?: Date | string | null;
    pushTime?: Date | string | null;
    pushStatus?: string | null;
    pushReason?: string | null;
    pushCountBefore?: number | null;
    pushCountAfter?: number | null;
    coolingElapsedMs?: number | null;
    metadata?: Record<string, any> | null;
  }): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const assign = (clause: string, value: any) => {
      sets.push(clause.replace('$$', `$${idx}`));
      values.push(value);
      idx += 1;
    };

    if (updates.runFinishedAt !== undefined) {
      if (updates.runFinishedAt === null) {
        sets.push('run_finished_at = NULL');
      } else {
        assign('run_finished_at = $$', updates.runFinishedAt);
      }
    }
    if (updates.layer !== undefined) {
      if (updates.layer === null) {
        sets.push('layer = NULL');
      } else {
        assign('layer = $$', updates.layer);
      }
    }
    if (updates.source !== undefined) {
      if (updates.source === null) {
        sets.push('source = NULL');
      } else {
        assign('source = $$', updates.source);
      }
    }
    if (updates.candidateId !== undefined) {
      if (updates.candidateId === null) {
        sets.push('candidate_id = NULL');
      } else {
        assign('candidate_id = $$', updates.candidateId);
      }
    }
    if (updates.candidateFingerprint !== undefined) {
      if (updates.candidateFingerprint === null) {
        sets.push('candidate_fingerprint = NULL');
      } else {
        assign('candidate_fingerprint = $$', updates.candidateFingerprint);
      }
    }
    if (updates.candidatePublishTime !== undefined) {
      if (updates.candidatePublishTime === null) {
        sets.push('candidate_publish_time = NULL');
      } else {
        assign('candidate_publish_time = $$', updates.candidatePublishTime);
      }
    }
    if (updates.candidateProcessTime !== undefined) {
      if (updates.candidateProcessTime === null) {
        sets.push('candidate_process_time = NULL');
      } else {
        assign('candidate_process_time = $$', updates.candidateProcessTime);
      }
    }
    if (updates.pushTime !== undefined) {
      if (updates.pushTime === null) {
        sets.push('push_time = NULL');
      } else {
        assign('push_time = $$', updates.pushTime);
      }
    }
    if (updates.pushStatus !== undefined) {
      if (updates.pushStatus === null) {
        sets.push('push_status = NULL');
      } else {
        assign('push_status = $$', updates.pushStatus);
      }
    }
    if (updates.pushReason !== undefined) {
      if (updates.pushReason === null) {
        sets.push('push_reason = NULL');
      } else {
        assign('push_reason = $$', updates.pushReason);
      }
    }
    if (updates.pushCountBefore !== undefined) {
      if (updates.pushCountBefore === null) {
        sets.push('push_count_before = NULL');
      } else {
        assign('push_count_before = $$', updates.pushCountBefore);
      }
    }
    if (updates.pushCountAfter !== undefined) {
      if (updates.pushCountAfter === null) {
        sets.push('push_count_after = NULL');
      } else {
        assign('push_count_after = $$', updates.pushCountAfter);
      }
    }
    if (updates.coolingElapsedMs !== undefined) {
      if (updates.coolingElapsedMs === null) {
        sets.push('cooling_elapsed = NULL');
      } else {
        sets.push(`cooling_elapsed = ($${idx}::bigint) * INTERVAL '1 millisecond'`);
        values.push(updates.coolingElapsedMs);
        idx += 1;
      }
    }
    if (updates.metadata !== undefined) {
      if (updates.metadata === null) {
        sets.push('metadata = NULL');
      } else {
        assign('metadata = COALESCE(metadata, \'{}\'::jsonb) || $$::jsonb', JSON.stringify(updates.metadata));
      }
    }

    if (sets.length === 0) {
      return;
    }

    const sql = `UPDATE scheduler_run_history SET ${sets.join(', ')} WHERE id = $${idx}`;
    values.push(id);

    const client = await this.pool.connect();
    try {
      await client.query(sql, values);
    } finally {
      client.release();
    }
  }

  /**
   * 更新调度器下次运行时间
   */
  async updateSchedulerNextRun(id: string, nextRunAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE news_scheduler_jobs
        SET next_run_at = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [id, nextRunAt]);
    } finally {
      client.release();
    }
  }

  async setSchedulerJobEnabled(id: string, enabled: boolean): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE news_scheduler_jobs
        SET enabled = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [enabled, id]);
    } finally {
      client.release();
    }
  }

  async updateSchedulerJobMetadata(id: string, metadata: Record<string, any>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE news_scheduler_jobs
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [JSON.stringify(metadata), id]);
    } finally {
      client.release();
    }
  }

  async recordPushResult(entry: {
    jobId: string;
    fingerprint: string;
    title?: string;
    link?: string;
    source?: string;
    category?: string;
    metadata?: Record<string, any>;
    result?: Record<string, any>;
    rawContent?: Record<string, any>; // 原始RSS内容
    processedContent?: Record<string, any>; // AX优化后的内容
    imagePath?: string; // MinIO图片路径
    layer?: string;
    isFallback?: boolean;
    strategySnapshot?: Record<string, any>;
  }): Promise<void> {
    const client = await this.pool.connect();
    const transformedMetadata = entry.metadata || {};
    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO news_push_stats (
          fingerprint, title, link, source, category, push_count, last_pushed_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP, $6)
        ON CONFLICT (fingerprint) DO UPDATE SET
          title = COALESCE(EXCLUDED.title, news_push_stats.title),
          link = COALESCE(EXCLUDED.link, news_push_stats.link),
          source = COALESCE(EXCLUDED.source, news_push_stats.source),
          category = COALESCE(EXCLUDED.category, news_push_stats.category),
          push_count = news_push_stats.push_count + 1,
          last_pushed_at = CURRENT_TIMESTAMP,
          metadata = COALESCE(EXCLUDED.metadata, news_push_stats.metadata)
      `, [
        entry.fingerprint,
        entry.title || null,
        entry.link || null,
        entry.source || null,
        entry.category || null,
        transformedMetadata
      ]);

      await client.query(`
        INSERT INTO news_push_log (job_id, fingerprint, layer, is_fallback, result, strategy_snapshot, raw_content, processed_content, image_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        entry.jobId || null,
        entry.fingerprint,
        entry.layer || null,
        entry.isFallback ?? null,
        entry.result || null,
        entry.strategySnapshot || null,
        entry.rawContent || null,
        entry.processedContent || null,
        entry.imagePath || null
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ 记录新闻推送结果失败:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPushStatsForFingerprints(fingerprints: string[]): Promise<Record<string, { pushCount: number; lastPushedAt: string | null }>> {
    if (!fingerprints.length) {
      return {};
    }
    const client = await this.pool.connect();
    try {
      const params = fingerprints.map((_, index) => `$${index + 1}`).join(',');
      const result = await client.query(
        `SELECT fingerprint, push_count, last_pushed_at FROM news_push_stats WHERE fingerprint IN (${params})`,
        fingerprints
      );

      const map: Record<string, { pushCount: number; lastPushedAt: string | null }> = {};
      for (const row of result.rows) {
        map[row.fingerprint] = {
          pushCount: row.push_count || 0,
          lastPushedAt: row.last_pushed_at ? row.last_pushed_at.toISOString?.() || row.last_pushed_at : null
        };
      }

      return map;
    } finally {
      client.release();
    }
  }

  async getRecentPushLogs(limit: number = 50, includeContent: boolean = false, offset: number = 0, deduplicate: boolean = false): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      // 如果需要去重，使用DISTINCT ON (fingerprint)只保留每个fingerprint的最新记录
      const query = deduplicate ? `
        SELECT DISTINCT ON (log.fingerprint)
               log.id,
               log.job_id,
               log.fingerprint,
               log.pushed_at,
               log.layer,
               log.is_fallback,
               log.result,
               log.strategy_snapshot,
               log.raw_content,
               log.processed_content,
               stats.title,
               stats.link,
               stats.source,
               stats.category,
               stats.push_count,
               stats.metadata
          FROM news_push_log AS log
          LEFT JOIN news_push_stats AS stats
            ON stats.fingerprint = log.fingerprint
         WHERE log.fingerprint IS NOT NULL
         ORDER BY log.fingerprint, log.pushed_at DESC
         LIMIT $1 OFFSET $2
      ` : `
        SELECT log.id,
               log.job_id,
               log.fingerprint,
               log.pushed_at,
               log.layer,
               log.is_fallback,
               log.result,
               log.strategy_snapshot,
               log.raw_content,
               log.processed_content,
               stats.title,
               stats.link,
               stats.source,
               stats.category,
               stats.push_count,
               stats.metadata
          FROM news_push_log AS log
          LEFT JOIN news_push_stats AS stats
            ON stats.fingerprint = log.fingerprint
         ORDER BY log.pushed_at DESC
         LIMIT $1 OFFSET $2
      `;

      const result = await client.query(query, [limit, offset]);

      return result.rows.map((row) => {
        const base = {
          id: row.id,
          jobId: row.job_id,
          fingerprint: row.fingerprint,
          pushedAt: row.pushed_at?.toISOString?.() || row.pushed_at,
          layer: row.layer || null,
          isFallback: row.is_fallback ?? null,
          result: row.result || null,
          strategySnapshot: row.strategy_snapshot || null,
          title: row.title || undefined,
          link: row.link || undefined,
          source: row.source || undefined,
          category: row.category || undefined,
          pushCount: row.push_count || 0,
          metadata: row.metadata || null
        };

        // 根据includeContent参数决定是否包含完整内容
        if (includeContent) {
          return {
            ...base,
            rawContent: row.raw_content || null,
            processedContent: row.processed_content || null
          };
        }

        return base;
      });
    } finally {
      client.release();
    }
  }

  /**
   * 关闭数据库连接池
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('🐘 PostgreSQL连接池已关闭');
  }
}

// 单例实例
let postgresDatabase: PostgresDatabase | null = null;

export function getPostgresDatabase(): PostgresDatabase {
  if (!postgresDatabase) {
    postgresDatabase = new PostgresDatabase({
      connectionString: process.env.DATABASE_URL,
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'quote0_cache',
      user: process.env.POSTGRES_USER || 'quote0_user',
      password: process.env.POSTGRES_PASSWORD || 'quote0_password'
    });
  }
  return postgresDatabase;
}
