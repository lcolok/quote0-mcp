/**
 * 标注系统API - 为AX质量评估器提供人工标注功能
 * 优化版：直接使用news_push_log作为单一数据源
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { Client } from 'pg';

// 类型定义
interface NewsItem {
  id: number;
  title: string;
  source: string;
  description?: string;
  link?: string;
  publish_time?: string;
  category?: string;
  image_path?: string;
  annotation_status: 'pending' | 'annotating' | 'completed' | 'skipped';
  fingerprint?: string;
  raw_content?: any;
  processed_content?: any;
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

  // 新增：优化后的内容（用于训练）
  optimized_title?: string;      // 优化后的标题
  optimized_summary?: string;    // 优化后的摘要
  optimized_content?: string;    // 优化后的正文（可选）
}

// 创建Hono应用
const app = new Hono();
const postgres = getPostgresDatabase();

/**
 * 获取待标注新闻列表（直接从push_log）
 */
app.get('/api/annotation/news', async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const category = c.req.query('category');

    const client = await postgres.getClient();
    try {
      // 直接查询news_push_log
      let query = `
        SELECT
          npl.id,
          npl.raw_content->>'title' as title,
          npl.raw_content->>'source' as source,
          npl.processed_content->>'message' as description,
          npl.raw_content->>'link' as link,
          COALESCE(
            (npl.raw_content->>'publishTime')::timestamp,
            npl.pushed_at
          ) as publish_time,
          COALESCE(nps.category, 'technology') as category,
          npl.image_path,
          npl.annotation_status,
          npl.raw_content->>'fingerprint' as fingerprint,
          npl.raw_content,
          npl.processed_content
        FROM news_push_log npl
        LEFT JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
        WHERE npl.annotation_status = $1
          AND npl.raw_content->>'title' IS NOT NULL
          AND npl.raw_content->>'title' != ''
      `;

      const params: any[] = [status];

      if (category) {
        query += ` AND nps.category = $${params.length + 1}`;
        params.push(category);
      }

      query += ` ORDER BY npl.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await client.query<NewsItem>(query, params);

      // 获取总数
      let countQuery = `
        SELECT COUNT(*)
        FROM news_push_log npl
        LEFT JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
        WHERE npl.annotation_status = $1
          AND npl.raw_content->>'title' IS NOT NULL
          AND npl.raw_content->>'title' != ''
      `;
      const countParams: any[] = [status];

      if (category) {
        countQuery += ' AND nps.category = $2';
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
      // 查询news_push_log
      const newsResult = await client.query<NewsItem>(`
        SELECT
          npl.id,
          npl.raw_content->>'title' as title,
          npl.raw_content->>'source' as source,
          npl.processed_content->>'message' as description,
          npl.raw_content->>'link' as link,
          COALESCE(
            (npl.raw_content->>'publishTime')::timestamp,
            npl.pushed_at
          ) as publish_time,
          COALESCE(nps.category, 'technology') as category,
          npl.image_path,
          npl.annotation_status,
          npl.raw_content->>'fingerprint' as fingerprint,
          npl.raw_content,
          npl.processed_content
        FROM news_push_log npl
        LEFT JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
        WHERE npl.id = $1
      `, [id]);

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
            reason, tags, annotator, difficulty, confidence,
            optimized_title, optimized_summary, optimized_content
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          annotation.confidence,
          annotation.optimized_title,
          annotation.optimized_summary,
          annotation.optimized_content
        ]);

        // 更新push_log状态为completed
        await client.query(
          'UPDATE news_push_log SET annotation_status = $1 WHERE id = $2',
          ['completed', newsId]
        );

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
 * 快速标注（点赞/点踩）
 */
app.post('/api/annotation/news/:id/quick', async (c) => {
  try {
    const newsId = parseInt(c.req.param('id'), 10);
    const { action } = await c.req.json() as { action: 'like' | 'dislike' };

    // 快速标注映射
    const mapping = {
      like: {
        overall_score: 80,
        category: 'high' as const,
        should_filter: false,
        reason: '快速标注：高质量内容'
      },
      dislike: {
        overall_score: 20,
        category: 'low' as const,
        should_filter: true,
        reason: '快速标注：低质量内容'
      }
    };

    const annotationData = mapping[action];

    const client = await postgres.getClient();
    try {
      await client.query('BEGIN');

      // 插入标注
      const result = await client.query<QualityAnnotation>(`
        INSERT INTO quality_annotations (
          news_id, overall_score, category, should_filter,
          reason, annotator
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        newsId,
        annotationData.overall_score,
        annotationData.category,
        annotationData.should_filter,
        annotationData.reason,
        'quick-annotator'
      ]);

      // 更新push_log状态为completed
      await client.query(
        'UPDATE news_push_log SET annotation_status = $1 WHERE id = $2',
        ['completed', newsId]
      );

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
    console.error('❌ 快速标注失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

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

      // 重置push_log状态为pending
      await client.query(
        'UPDATE news_push_log SET annotation_status = $1 WHERE id = $2',
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
      // 直接查询导出样本（包含优化内容）
      let query = `
        SELECT
          npl.raw_content->>'title' as original_title,
          npl.raw_content->>'link' as link,
          npl.raw_content->>'description' as original_description,
          npl.raw_content->>'content' as original_content,
          npl.processed_content->>'title' as processed_title,
          npl.processed_content->>'message' as processed_summary,
          qa.overall_score,
          qa.category as quality_level,
          qa.should_filter,
          qa.reason,
          qa.tags,
          qa.annotator,
          qa.created_at,
          qa.optimized_title,
          qa.optimized_summary,
          qa.optimized_content
        FROM quality_annotations qa
        INNER JOIN news_push_log npl ON qa.news_id = npl.id
        WHERE qa.is_latest = true
          AND qa.overall_score >= $1
          AND qa.overall_score <= $2
        ORDER BY qa.created_at DESC
      `;

      const params: any[] = [minScore, maxScore];

      if (limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(limit);
      }

      const result = await client.query(query, params);

      return c.json(result.rows);
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
 * 清空所有待标注新闻数据（将状态重置为pending）
 */
app.delete('/api/annotation/news/pending', async (c) => {
  try {
    const client = await postgres.getClient();
    try {
      // 不删除数据，只重置状态
      const result = await client.query(
        `UPDATE news_push_log SET annotation_status = 'pending' WHERE annotation_status != 'completed' RETURNING id`
      );

      return c.json({
        success: true,
        data: {
          resetCount: result.rowCount || 0
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ 重置待标注数据失败:', error);
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
      // 进度统计
      const progressResult = await client.query(`
        SELECT
          COUNT(*)::INTEGER as total_count,
          COUNT(*) FILTER (WHERE annotation_status = 'pending')::INTEGER as pending_count,
          COUNT(*) FILTER (WHERE annotation_status = 'completed')::INTEGER as completed_count,
          COUNT(*) FILTER (WHERE annotation_status = 'skipped')::INTEGER as skipped_count,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE annotation_status = 'completed') / NULLIF(COUNT(*), 0),
            1
          )::FLOAT as completion_rate
        FROM news_push_log
        WHERE raw_content->>'title' IS NOT NULL
          AND raw_content->>'title' != ''
      `);

      // 质量分布
      const distributionResult = await client.query(`
        SELECT
          qa.category as quality_level,
          COUNT(*)::INTEGER as count,
          ROUND(AVG(qa.overall_score)::numeric, 1)::FLOAT as avg_score,
          MIN(qa.overall_score)::INTEGER as min_score,
          MAX(qa.overall_score)::INTEGER as max_score
        FROM quality_annotations qa
        WHERE qa.is_latest = true
        GROUP BY qa.category
        ORDER BY
          CASE qa.category
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
          END
      `);

      return c.json({
        success: true,
        data: {
          progress: progressResult.rows[0],
          qualityDistribution: distributionResult.rows
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
        qa.*,
        npl.raw_content->>'title' as news_title
      FROM quality_annotations qa
      INNER JOIN news_push_log npl ON qa.news_id = npl.id
    `;

    const params: any[] = [];

    if (newsId) {
      query += ' WHERE qa.news_id = $1';
      params.push(parseInt(newsId, 10));
    }

    query += ` ORDER BY qa.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
            reason, tags, annotator, difficulty, confidence,
            optimized_title, optimized_summary, optimized_content
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          annotation.confidence,
          annotation.optimized_title,
          annotation.optimized_summary,
          annotation.optimized_content
        ]);

        // 更新状态
        await client.query(
          'UPDATE news_push_log SET annotation_status = $1 WHERE id = $2',
          ['completed', annotation.news_id]
        );

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

export default app;
