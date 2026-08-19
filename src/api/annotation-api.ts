/**
 * 内容评审 API。
 * fingerprint 是稳定评审主体；news_push_log 仅保留为具体投递证据。
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { decodeReviewCursor, getReviewStatistics, listReviewSubjects, type ReviewStatus } from './review-store.js';

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
  fingerprint?: string;
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

  // 人工参考改写（用于离线评估，不触发自动训练）
  optimized_title?: string;      // 优化后的标题
  optimized_summary?: string;    // 优化后的摘要
  optimized_content?: string;    // 优化后的正文（可选）
}

// 创建Hono应用
const app = new Hono();
const postgres = getPostgresDatabase();

/**
 * 获取稳定内容主体列表。默认仅返回轻量投影，正文请按 id 获取详情。
 */
app.get('/api/annotation/news', async (c) => {
  try {
    const requestedStatus = c.req.query('status') || 'pending';
    if (requestedStatus !== 'pending' && requestedStatus !== 'completed') {
      return c.json({ success: false, error: 'status 必须是 pending 或 completed' }, 400);
    }
    const status = requestedStatus as ReviewStatus;
    const parsedLimit = parseInt(c.req.query('limit') || '50', 10);
    const parsedOffset = parseInt(c.req.query('offset') || '0', 10);
    const limit = Math.min(200, Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit));
    const offset = Math.max(0, Number.isNaN(parsedOffset) ? 0 : parsedOffset);
    const cursor = c.req.query('cursor');
    const includeContent = c.req.query('includeContent') === 'true';
    if (cursor && !decodeReviewCursor(cursor)) {
      return c.json({ success: false, error: '无效的分页游标' }, 400);
    }

    const client = await postgres.getClient();
    try {
      const result = await listReviewSubjects(client, {
        status,
        limit,
        offset,
        cursor,
        category: c.req.query('category'),
        search: c.req.query('search'),
        includeContent,
        includeTotal: c.req.query('includeTotal') === 'true' || !cursor,
      });

      const rows: NewsItem[] = result.rows.map((row) => ({
        id: row.id,
        title: row.title || '未知标题',
        source: row.source || row.job_id || 'unknown',
        description: includeContent
          ? row.processed_content?.message || row.raw_content?.description
          : undefined,
        link: row.link || undefined,
        publish_time: row.pushed_at ? new Date(row.pushed_at).toISOString() : undefined,
        category: row.category || 'technology',
        image_path: row.image_path || undefined,
        annotation_status: row.annotation_status,
        fingerprint: row.fingerprint,
        ...(includeContent ? {
          raw_content: row.raw_content,
          processed_content: row.processed_content,
        } : {}),
      }));

      return c.json({
        success: true,
        data: rows,
        pagination: {
          ...(result.total === undefined ? {} : { total: result.total }),
          limit,
          offset,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
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
          npl.fingerprint,
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

      // 评审决策按稳定 fingerprint 读取；news_id 仅为兼容兜底。
      const annotationResult = await client.query<QualityAnnotation>(
        `SELECT *
         FROM quality_annotations
         WHERE is_latest = true
           AND (fingerprint = $1 OR (fingerprint IS NULL AND news_id = $2))
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [news.fingerprint, id]
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

        const subjectResult = await client.query<{ fingerprint: string }>(
          `SELECT npl.fingerprint
           FROM news_push_log npl
           JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
           WHERE npl.id = $1
           FOR UPDATE OF nps`,
          [newsId]
        );
        if (!subjectResult.rows[0]?.fingerprint) {
          await client.query('ROLLBACK');
          return c.json({ success: false, error: '新闻不存在或缺少稳定内容标识' }, 404);
        }
        const fingerprint = subjectResult.rows[0].fingerprint;

        await client.query(
          `UPDATE quality_annotations
           SET is_latest = false, updated_at = CURRENT_TIMESTAMP
           WHERE fingerprint = $1 AND is_latest = true`,
          [fingerprint]
        );

        // news_id 固定本次评审所见的证据；fingerprint 固定评审主体。
        const result = await client.query<QualityAnnotation>(`
          INSERT INTO quality_annotations (
            news_id, fingerprint, version, overall_score, category, should_filter,
            news_value, practicality, density, timeliness, universality,
            reason, tags, annotator, difficulty, confidence,
            optimized_title, optimized_summary, optimized_content
          ) VALUES (
            $1, $2,
            (SELECT COALESCE(MAX(version), 0) + 1 FROM quality_annotations WHERE fingerprint = $2),
            $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          )
          RETURNING *
        `, [
          newsId,
          fingerprint,
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

        // 兼容旧消费者的状态字段；权威状态来自 quality_annotations。
        const r = await client.query(
          `UPDATE news_push_log
           SET annotation_status = 'completed'
           WHERE fingerprint = $1
             AND annotation_status = 'pending'
           RETURNING id`,
          [fingerprint]
        );
        console.log(`✅ 批量更新 ${r.rowCount} 条同 fingerprint 的 push_log`);

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

    if (action !== 'like' && action !== 'dislike') {
      return c.json({ success: false, error: 'action 必须是 like 或 dislike' }, 400);
    }

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

      const subjectResult = await client.query<{ fingerprint: string }>(
        `SELECT npl.fingerprint
         FROM news_push_log npl
         JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
         WHERE npl.id = $1
         FOR UPDATE OF nps`,
        [newsId]
      );
      if (!subjectResult.rows[0]?.fingerprint) {
        await client.query('ROLLBACK');
        return c.json({ success: false, error: '新闻不存在或缺少稳定内容标识' }, 404);
      }
      const fingerprint = subjectResult.rows[0].fingerprint;

      await client.query(
        `UPDATE quality_annotations
         SET is_latest = false, updated_at = CURRENT_TIMESTAMP
         WHERE fingerprint = $1 AND is_latest = true`,
        [fingerprint]
      );

      // 插入标注
      const result = await client.query<QualityAnnotation>(`
        INSERT INTO quality_annotations (
          news_id, fingerprint, version, overall_score, category, should_filter,
          reason, annotator
        ) VALUES (
          $1, $2,
          (SELECT COALESCE(MAX(version), 0) + 1 FROM quality_annotations WHERE fingerprint = $2),
          $3, $4, $5, $6, $7
        )
        RETURNING *
      `, [
        newsId,
        fingerprint,
        annotationData.overall_score,
        annotationData.category,
        annotationData.should_filter,
        annotationData.reason,
        'quick-annotator'
      ]);

      // 按 fingerprint 批量更新所有同源 push_log
      const r = await client.query(
        `UPDATE news_push_log
         SET annotation_status = 'completed'
         WHERE fingerprint = $1
           AND annotation_status = 'pending'
         RETURNING id`,
        [fingerprint]
      );
      console.log(`✅ 批量更新 ${r.rowCount} 条同 fingerprint 的 push_log`);

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

      const annotationResult = await client.query<{
        news_id: number;
        fingerprint: string | null;
        is_latest: boolean;
      }>(
        `SELECT qa.news_id, COALESCE(qa.fingerprint, npl.fingerprint) AS fingerprint, qa.is_latest
         FROM quality_annotations qa
         LEFT JOIN news_push_log npl ON npl.id = qa.news_id
         WHERE qa.id = $1`,
        [annotationId]
      );

      if (annotationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({
          success: false,
          error: '标注不存在'
        }, 404);
      }

      const deleted = annotationResult.rows[0];

      // 删除标注
      await client.query('DELETE FROM quality_annotations WHERE id = $1', [annotationId]);

      if (deleted.is_latest && deleted.fingerprint) {
        const restored = await client.query(
          `UPDATE quality_annotations
           SET is_latest = true, updated_at = CURRENT_TIMESTAMP
           WHERE id = (
             SELECT id FROM quality_annotations
             WHERE fingerprint = $1
             ORDER BY created_at DESC, id DESC
             LIMIT 1
           )
           RETURNING id`,
          [deleted.fingerprint]
        );
        if (restored.rows.length === 0) {
          await client.query(
            `UPDATE news_push_log SET annotation_status = 'pending' WHERE fingerprint = $1`,
            [deleted.fingerprint]
          );
        }
      }

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
 * 导出可追溯评审样本（用于离线评估，不会自动进入生产配置）
 */
app.get('/api/annotation/samples/export', async (c) => {
  try {
    const minScore = Number.isNaN(parseInt(c.req.query('minScore') || '0', 10)) ? 0 : parseInt(c.req.query('minScore') || '0', 10);
    const maxScore = Number.isNaN(parseInt(c.req.query('maxScore') || '100', 10)) ? 100 : parseInt(c.req.query('maxScore') || '100', 10);
    const limit = c.req.query('limit') ? (Number.isNaN(parseInt(c.req.query('limit')!, 10)) ? null : parseInt(c.req.query('limit')!, 10)) : null;

    const client = await postgres.getClient();
    try {
      // 直接查询导出样本（包含优化内容）
      let query = `
        SELECT
          qa.news_id,
          COALESCE(qa.fingerprint, npl.fingerprint) AS fingerprint,
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
    console.error('❌ 导出评审样本失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * 兼容旧客户端。待评审状态现在由“是否存在最新决策”派生，不再批量改写投递日志。
 */
app.delete('/api/annotation/news/pending', async (c) => {
  return c.json({
    success: true,
    data: { resetCount: 0 },
    message: '待评审状态由稳定内容决策自动计算，无需重置投递日志',
  });
});

/**
 * 获取标注统计
 */
app.get('/api/annotation/statistics', async (c) => {
  try {
    const client = await postgres.getClient();
    try {
      const statistics = await getReviewStatistics(client);

      return c.json({
        success: true,
        data: statistics
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
    const limit = Number.isNaN(parseInt(c.req.query('limit') || '50', 10)) ? 50 : parseInt(c.req.query('limit') || '50', 10);
    const offset = Number.isNaN(parseInt(c.req.query('offset') || '0', 10)) ? 0 : parseInt(c.req.query('offset') || '0', 10);

    let query = `
      SELECT
        qa.*,
        npl.raw_content->>'title' as news_title
      FROM quality_annotations qa
      INNER JOIN news_push_log npl ON qa.news_id = npl.id
    `;

    const params: any[] = [];

    if (newsId) {
      query += ` WHERE (
        qa.fingerprint = (SELECT fingerprint FROM news_push_log WHERE id = $1)
        OR (qa.fingerprint IS NULL AND qa.news_id = $1)
      )`;
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
        const subjectResult = await client.query<{ fingerprint: string }>(
          `SELECT npl.fingerprint
           FROM news_push_log npl
           JOIN news_push_stats nps ON nps.fingerprint = npl.fingerprint
           WHERE npl.id = $1
           FOR UPDATE OF nps`,
          [annotation.news_id]
        );
        const fingerprint = subjectResult.rows[0]?.fingerprint;
        if (!fingerprint) throw new Error(`新闻 ${annotation.news_id} 不存在或缺少稳定内容标识`);

        await client.query(
          `UPDATE quality_annotations
           SET is_latest = false, updated_at = CURRENT_TIMESTAMP
           WHERE fingerprint = $1 AND is_latest = true`,
          [fingerprint]
        );

        const result = await client.query<QualityAnnotation>(`
          INSERT INTO quality_annotations (
            news_id, fingerprint, version, overall_score, category, should_filter,
            news_value, practicality, density, timeliness, universality,
            reason, tags, annotator, difficulty, confidence,
            optimized_title, optimized_summary, optimized_content
          ) VALUES (
            $1, $2,
            (SELECT COALESCE(MAX(version), 0) + 1 FROM quality_annotations WHERE fingerprint = $2),
            $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          )
          RETURNING *
        `, [
          annotation.news_id,
          fingerprint,
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
          `UPDATE news_push_log
           SET annotation_status = 'completed'
           WHERE fingerprint = $1 AND annotation_status = 'pending'`,
          [fingerprint]
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
