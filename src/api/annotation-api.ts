/**
 * 标注系统API - 为AX质量评估器提供人工标注功能
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { Client } from 'pg';

// 类型定义
interface NewsRawData {
  id: number;
  title: string;
  source: string;
  description?: string;
  link?: string;
  publish_time?: string;
  data_source: string;
  category?: string;
  rss_index?: number;
  annotation_status: 'pending' | 'annotating' | 'completed' | 'skipped';
  created_at: string;
  updated_at: string;
}

interface QualityAnnotation {
  id?: number;
  news_id: number;
  overall_score: number;
  category: 'high' | 'medium' | 'low';
  should_filter: boolean;
  news_value?: number;
  practicality?: number;
  density?: number;
  timeliness?: number;
  universality?: number;
  reason: string;
  tags?: string[];
  annotator?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  confidence?: number;
}

interface ImportRSSRequest {
  category: string;
  rssSource: string;
  count?: number;  // 导入多少条
  startIndex?: number;
}

// 创建Hono应用
const app = new Hono();
const postgres = getPostgresDatabase();

/**
 * 获取待标注新闻列表
 */
app.get('/api/annotation/news', async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const category = c.req.query('category');

    let query = `
      SELECT
        id, title, source, description, link, publish_time,
        data_source, category, rss_index, image_path,
        annotation_status, created_at, updated_at
      FROM news_raw_data
      WHERE annotation_status = $1
    `;

    const params: any[] = [status];

    if (category) {
      query += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const client = await postgres.getClient();
    try {
      const result = await client.query<NewsRawData>(query, params);

      // 获取总数
      let countQuery = 'SELECT COUNT(*) FROM news_raw_data WHERE annotation_status = $1';
      const countParams: any[] = [status];
      if (category) {
        countQuery += ' AND category = $2';
        countParams.push(category);
      }
      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count, 10);

      return c.json({
        success: true,
        data: result.rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + result.rows.length < total
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 获取新闻列表失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 获取单条新闻详情（含已有标注）
 */
app.get('/api/annotation/news/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);

    const client = await postgres.getClient();
    try {
      // 获取新闻数据
      const newsResult = await client.query<NewsRawData>(
        'SELECT * FROM news_raw_data WHERE id = $1',
        [id]
      );

      if (newsResult.rows.length === 0) {
        return c.json({
          success: false,
          error: '新闻不存在'
        }, 404);
      }

      const news = newsResult.rows[0];

      // 获取最新标注（如果有）
      const annotationResult = await client.query<QualityAnnotation>(
        'SELECT * FROM quality_annotations WHERE news_id = $1 AND is_latest = true',
        [id]
      );

      return c.json({
        success: true,
        data: {
          news,
          annotation: annotationResult.rows[0] || null
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 获取新闻详情失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 提交标注
 */
app.post('/api/annotation/news/:id/annotate',
  validator('json', (value, c) => {
    const body = value as QualityAnnotation;

    // 基本参数验证
    if (typeof body.overall_score !== 'number' || body.overall_score < 0 || body.overall_score > 100) {
      return c.json({
        success: false,
        error: '综合评分必须在0-100之间'
      }, 400);
    }

    if (!['high', 'medium', 'low'].includes(body.category)) {
      return c.json({
        success: false,
        error: '分类必须是 high, medium 或 low'
      }, 400);
    }

    if (!body.reason || body.reason.trim().length === 0) {
      return c.json({
        success: false,
        error: '必须提供标注理由'
      }, 400);
    }

    return body;
  }),
  async (c) => {
    try {
      const newsId = parseInt(c.req.param('id'), 10);
      const annotation = await c.req.json() as QualityAnnotation;

      const client = await postgres.getClient();
      try {
        await client.query('BEGIN');

        // 插入标注
        const result = await client.query<QualityAnnotation>(`
          INSERT INTO quality_annotations (
            news_id, overall_score, category, should_filter,
            news_value, practicality, density, timeliness, universality,
            reason, tags, annotator, difficulty, confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `, [
          newsId,
          annotation.overall_score,
          annotation.category,
          annotation.should_filter,
          annotation.news_value,
          annotation.practicality,
          annotation.density,
          annotation.timeliness,
          annotation.universality,
          annotation.reason,
          annotation.tags || [],
          annotation.annotator || 'human',
          annotation.difficulty,
          annotation.confidence
        ]);

        await client.query('COMMIT');

        return c.json({
          success: true,
          data: result.rows[0]
        }, 201);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ 提交标注失败:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }, 500);
    }
  }
);

/**
 * 更新标注
 */
app.put('/api/annotation/annotations/:id', async (c) => {
  try {
    const annotationId = parseInt(c.req.param('id'), 10);
    const updates = await c.req.json() as Partial<QualityAnnotation>;

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      // 构建动态更新语句
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (updates.overall_score !== undefined) {
        updateFields.push(`overall_score = $${paramCount++}`);
        values.push(updates.overall_score);
      }
      if (updates.category) {
        updateFields.push(`category = $${paramCount++}`);
        values.push(updates.category);
      }
      if (updates.should_filter !== undefined) {
        updateFields.push(`should_filter = $${paramCount++}`);
        values.push(updates.should_filter);
      }
      if (updates.news_value !== undefined) {
        updateFields.push(`news_value = $${paramCount++}`);
        values.push(updates.news_value);
      }
      if (updates.practicality !== undefined) {
        updateFields.push(`practicality = $${paramCount++}`);
        values.push(updates.practicality);
      }
      if (updates.density !== undefined) {
        updateFields.push(`density = $${paramCount++}`);
        values.push(updates.density);
      }
      if (updates.timeliness !== undefined) {
        updateFields.push(`timeliness = $${paramCount++}`);
        values.push(updates.timeliness);
      }
      if (updates.universality !== undefined) {
        updateFields.push(`universality = $${paramCount++}`);
        values.push(updates.universality);
      }
      if (updates.reason) {
        updateFields.push(`reason = $${paramCount++}`);
        values.push(updates.reason);
      }
      if (updates.tags) {
        updateFields.push(`tags = $${paramCount++}`);
        values.push(updates.tags);
      }
      if (updates.difficulty) {
        updateFields.push(`difficulty = $${paramCount++}`);
        values.push(updates.difficulty);
      }
      if (updates.confidence !== undefined) {
        updateFields.push(`confidence = $${paramCount++}`);
        values.push(updates.confidence);
      }

      updateFields.push(`version = version + 1`);

      values.push(annotationId);

      const query = `
        UPDATE quality_annotations
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount} AND is_latest = true
        RETURNING *
      `;

      const result = await client.query<QualityAnnotation>(query, values);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({
          success: false,
          error: '标注不存在或不是最新版本'
        }, 404);
      }

      await client.query('COMMIT');

      return c.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 更新标注失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 删除标注
 */
app.delete('/api/annotation/annotations/:id', async (c) => {
  try {
    const annotationId = parseInt(c.req.param('id'), 10);

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      // 获取news_id用于重置状态
      const newsIdResult = await client.query(
        'SELECT news_id FROM quality_annotations WHERE id = $1',
        [annotationId]
      );

      if (newsIdResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({
          success: false,
          error: '标注不存在'
        }, 404);
      }

      const newsId = newsIdResult.rows[0].news_id;

      // 删除标注
      await client.query('DELETE FROM quality_annotations WHERE id = $1', [annotationId]);

      // 重置新闻状态为pending
      await client.query(
        'UPDATE news_raw_data SET annotation_status = $1 WHERE id = $2',
        ['pending', newsId]
      );

      await client.query('COMMIT');

      return c.json({
        success: true,
        message: '标注已删除'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 删除标注失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 导出训练样本
 */
app.get('/api/annotation/samples/export', async (c) => {
  try {
    const minScore = parseInt(c.req.query('minScore') || '0', 10);
    const maxScore = parseInt(c.req.query('maxScore') || '100', 10);
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : null;

    const client = await postgres.getClient();
    try {
      const result = await client.query(
        'SELECT export_training_samples($1, $2, $3)',
        [minScore, maxScore, limit]
      );

      const samples = result.rows[0].export_training_samples;

      return c.json(samples);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 导出训练样本失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 从历史记录导入新闻数据（推荐）
 */
app.post('/api/annotation/news/import/history', async (c) => {
  try {
    const body = await c.req.json() as {
      source?: 'cache' | 'push_log';
      category?: string;
      limit?: number;
      minDate?: string;
    };

    const {
      source = 'cache',
      category,
      limit = 50,
      minDate
    } = body;

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      let importedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      // 根据来源选择查询
      let query = '';
      const params: any[] = [];
      let paramIndex = 1;

      if (source === 'cache') {
        query = `
          SELECT DISTINCT ON (title, source_name)
            title,
            source_name as source,
            source as original_source,
            message as description,
            link,
            publish_time,
            category_name as category,
            index_num as rss_index,
            image_path
          FROM news_cache
          WHERE 1=1
        `;
      } else {
        query = `
          SELECT DISTINCT ON (nps.title, nps.source)
            nps.title as title,
            nps.source as source,
            'push_log' as original_source,
            npl.result->>'message' as description,
            nps.link as link,
            npl.pushed_at as publish_time,
            nps.category as category,
            NULL::integer as rss_index
          FROM news_push_log npl
          JOIN news_push_stats nps ON npl.fingerprint = nps.fingerprint
          WHERE 1=1
        `;
      }

      // 添加过滤条件
      if (category) {
        if (source === 'cache') {
          query += ` AND category_name = $${paramIndex++}`;
        } else {
          query += ` AND nps.category = $${paramIndex++}`;
        }
        params.push(category);
      }

      if (minDate) {
        if (source === 'cache') {
          query += ` AND publish_time >= $${paramIndex++}`;
        } else {
          query += ` AND npl.pushed_at >= $${paramIndex++}`;
        }
        params.push(minDate);
      }

      if (source === 'cache') {
        query += ` ORDER BY title, source_name, publish_time DESC`;
      } else {
        query += ` ORDER BY nps.title, nps.source, npl.pushed_at DESC`;
      }
      query += ` LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await client.query(query, params);

      console.log(`📥 从${source}获取到${result.rows.length}条历史新闻`);

      // 导入到news_raw_data
      for (const row of result.rows) {
        try {
          // 尝试查找已有的推送图片
          let imagePath: string | null = null;

          // 提取真实的 data_source
          let dataSource = 'unknown';
          if (row.original_source) {
            // 从 original_source 提取类型，例如 "rss_solidot" -> "rss"
            if (row.original_source.startsWith('rss_')) {
              dataSource = 'rss';
            } else if (row.original_source === 'push_log') {
              dataSource = 'push_log';
            } else {
              dataSource = row.original_source.split('_')[0] || 'unknown';
            }
          }

          // 直接从 news_cache 读取 image_path（推送时已保存）
          if (source === 'cache' && row.image_path) {
            imagePath = row.image_path;
            console.log(`✅ 从数据库读取历史图片: ${imagePath}`);
          }

          const insertResult = await client.query<{ id: number }>(`
            INSERT INTO news_raw_data (
              title, source, description, link, publish_time,
              data_source, category, rss_index, image_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (title, source, publish_time) DO UPDATE SET
              image_path = COALESCE(EXCLUDED.image_path, news_raw_data.image_path),
              rss_index = COALESCE(EXCLUDED.rss_index, news_raw_data.rss_index),
              data_source = COALESCE(EXCLUDED.data_source, news_raw_data.data_source)
            RETURNING id
          `, [
            row.title,
            row.source,
            row.description,
            row.link,
            row.publish_time,
            dataSource, // 使用提取的真实数据源
            row.category,
            row.rss_index,
            imagePath
          ]);

          if (insertResult.rows.length > 0) {
            importedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          errors.push(`${row.title}: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }

      await client.query('COMMIT');

      return c.json({
        success: true,
        data: {
          importedCount,
          skippedCount,
          totalProcessed: result.rows.length,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 从历史记录导入失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 清空所有待标注新闻数据（保留已标注的）
 */
app.delete('/api/annotation/news/pending', async (c) => {
  try {
    const client = await postgres.getClient();
    try {
      const result = await client.query(
        `DELETE FROM news_raw_data WHERE annotation_status = 'pending' RETURNING id`
      );

      return c.json({
        success: true,
        data: {
          deletedCount: result.rowCount || 0
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 清空待标注数据失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 从RSS导入新闻数据
 */
app.post('/api/annotation/news/import/rss', async (c) => {
  try {
    const body = await c.req.json() as ImportRSSRequest;
    const { category, rssSource, count = 10, startIndex = 0 } = body;

    // 使用现有的RSS数据源模块
    const { RSSDataSource } = await import('../react-widgets/modules/data-sources/rss-source.js');
    const rssDataSource = new RSSDataSource();

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      let importedCount = 0;
      const errors: string[] = [];

      for (let i = startIndex; i < startIndex + count; i++) {
        try {
          const newsData = await rssDataSource.fetchNews({
            category,
            index: i,
            rssSource
          });

          // 导入到数据库
          const result = await client.query<{ id: number }>(`
            SELECT import_rss_news($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            newsData.title,
            newsData.signature || rssSource,
            newsData.message || null,
            newsData.link || null,
            newsData.publishTime || new Date(),
            category,
            i,
            JSON.stringify(newsData)
          ]);

          const newId = result.rows[0].import_rss_news;
          if (newId > 0) {
            importedCount++;
          }
        } catch (error) {
          errors.push(`索引${i}: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }

      await client.query('COMMIT');

      return c.json({
        success: true,
        data: {
          importedCount,
          requestedCount: count,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 导入RSS新闻失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 获取标注统计
 */
app.get('/api/annotation/statistics', async (c) => {
  try {
    const client = await postgres.getClient();
    try {
      // 获取进度统计
      const progressResult = await client.query(
        'SELECT * FROM get_annotation_progress()'
      );

      // 获取质量分布
      const distributionResult = await client.query(
        'SELECT * FROM quality_distribution'
      );

      // 获取按分类统计
      const categoryResult = await client.query(
        'SELECT * FROM annotation_statistics'
      );

      return c.json({
        success: true,
        data: {
          progress: progressResult.rows[0],
          qualityDistribution: distributionResult.rows,
          categoryStatistics: categoryResult.rows
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 获取统计信息失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 获取标注历史
 */
app.get('/api/annotation/history', async (c) => {
  try {
    const newsId = c.req.query('newsId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    let query = `
      SELECT
        h.*,
        n.title as news_title
      FROM annotation_history h
      INNER JOIN news_raw_data n ON h.news_id = n.id
    `;

    const params: any[] = [];

    if (newsId) {
      query += ' WHERE h.news_id = $1';
      params.push(parseInt(newsId, 10));
    }

    query += ` ORDER BY h.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const client = await postgres.getClient();
    try {
      const result = await client.query(query, params);

      return c.json({
        success: true,
        data: result.rows,
        pagination: {
          limit,
          offset,
          count: result.rows.length
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 获取标注历史失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 批量标注（一次提交多条）
 */
app.post('/api/annotation/batch', async (c) => {
  try {
    const annotations = await c.req.json() as QualityAnnotation[];

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      const results: QualityAnnotation[] = [];

      for (const annotation of annotations) {
        const result = await client.query<QualityAnnotation>(`
          INSERT INTO quality_annotations (
            news_id, overall_score, category, should_filter,
            news_value, practicality, density, timeliness, universality,
            reason, tags, annotator, difficulty, confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `, [
          annotation.news_id,
          annotation.overall_score,
          annotation.category,
          annotation.should_filter,
          annotation.news_value,
          annotation.practicality,
          annotation.density,
          annotation.timeliness,
          annotation.universality,
          annotation.reason,
          annotation.tags || [],
          annotation.annotator || 'human',
          annotation.difficulty,
          annotation.confidence
        ]);

        results.push(result.rows[0]);
      }

      await client.query('COMMIT');

      return c.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 批量标注失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 渲染新闻预览图（实时渲染）
 */
app.post('/api/annotation/news/:id/render-preview', async (c) => {
  try {
    const newsId = parseInt(c.req.param('id'), 10);

    const client = await postgres.getClient();
    try {
      // 获取新闻数据
      const newsResult = await client.query<NewsRawData>(`
        SELECT * FROM news_raw_data WHERE id = $1
      `, [newsId]);

      if (newsResult.rows.length === 0) {
        return c.json({
          success: false,
          error: '新闻不存在'
        }, 404);
      }

      const news = newsResult.rows[0];

      // 动态导入渲染模块
      const { NewsWidget } = await import('../react-widgets/components/NewsWidget.js');
      const { minioWidgetRenderer } = await import('../react-widgets/core/minio-widget-renderer.js');
      const React = await import('react');
      const fs = await import('fs/promises');
      const path = await import('path');

      // 初始化渲染器
      await minioWidgetRenderer.initialize();

      // 准备新闻数据
      const newsData = {
        title: news.title,
        message: news.description || news.title,
        signature: `${news.source}`,
        source: news.data_source,
        publishTime: news.publish_time?.toString() || new Date().toISOString(),
        category: news.category || 'news',
        link: news.link
      };

      // 渲染组件为图片
      const imageBuffer = await minioWidgetRenderer.renderToImage(
        React.createElement(NewsWidget, {
          data: newsData,
          border: '#ffffff'
        }),
        {
          format: 'png',
          quality: 100,
          backgroundColor: '#ffffff'
        }
      );

      // 保存到本地
      const timestamp = Date.now();
      const filename = `preview_${newsId}_${timestamp}.png`;
      const dirPath = './processed-images/widgets/news';
      await fs.mkdir(dirPath, { recursive: true });

      const imagePath = path.join(dirPath, filename);
      await fs.writeFile(imagePath, imageBuffer);

      // 返回相对路径（用于前端访问）
      const relativePath = `/images/${filename}`;

      // 更新数据库中的image_path（使用Web访问路径）
      await client.query(`
        UPDATE news_raw_data SET image_path = $1 WHERE id = $2
      `, [relativePath, newsId]);

      console.log(`✅ 新闻预览图已生成: ${imagePath} -> ${relativePath}`);

      return c.json({
        success: true,
        data: {
          imagePath: relativePath,
          localPath: imagePath
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 渲染预览图失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

export default app;
