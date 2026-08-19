/**
 * Read model for human content review.
 *
 * A review subject is a stable news fingerprint. Delivery rows are evidence
 * and rendering history; they are not review entities. List queries therefore
 * start from news_push_stats and touch only the latest delivery per subject.
 */

export type ReviewStatus = 'pending' | 'completed';

export interface ReviewQueryable {
  query<T = any>(text: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ReviewCursor {
  pushedAt: string;
  fingerprint: string;
}

export interface ReviewListOptions {
  limit?: number;
  cursor?: string;
  offset?: number;
  search?: string;
  category?: string;
  status?: ReviewStatus;
  includeContent?: boolean;
  includeTotal?: boolean;
}

export interface ReviewSubjectRow {
  id: number;
  fingerprint: string;
  title: string | null;
  original_title: string | null;
  link: string | null;
  source: string | null;
  category: string | null;
  push_count: number;
  image_path: string | null;
  pushed_at: Date | string | null;
  pushed_at_utc: Date | string | null;
  /** Canonical database wall-clock value used only for keyset pagination. */
  cursor_pushed_at: string | null;
  job_id: string | null;
  annotation_status: ReviewStatus;
  annotation_id: number | null;
  overall_score: number | null;
  raw_content?: Record<string, any> | null;
  processed_content?: Record<string, any> | null;
}

export interface ReviewListResult {
  rows: ReviewSubjectRow[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(200, Math.max(1, Math.trunc(limit!)));
}

export function encodeReviewCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeReviewCursor(value?: string): ReviewCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ReviewCursor>;
    if (!parsed.pushedAt || !parsed.fingerprint || Number.isNaN(Date.parse(parsed.pushedAt))) return null;
    return { pushedAt: parsed.pushedAt, fingerprint: parsed.fingerprint };
  } catch {
    return null;
  }
}

export async function listReviewSubjects(
  client: ReviewQueryable,
  options: ReviewListOptions = {},
): Promise<ReviewListResult> {
  const limit = normalizeLimit(options.limit);
  const cursor = decodeReviewCursor(options.cursor);
  if (options.cursor && !cursor) throw new Error('无效的分页游标');

  const params: any[] = [];
  const where: string[] = ["s.title IS NOT NULL", "s.title <> ''"];
  const bind = (value: any): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (options.search?.trim()) {
    const p = bind(`%${options.search.trim()}%`);
    where.push(`(s.title ILIKE ${p} OR s.source ILIKE ${p} OR s.category ILIKE ${p})`);
  }
  if (options.category) where.push(`s.category = ${bind(options.category)}`);
  if (options.status === 'completed') where.push('latest_decision.id IS NOT NULL');
  if (options.status === 'pending') where.push('latest_decision.id IS NULL');
  if (cursor) {
    const pushedAt = bind(cursor.pushedAt);
    const fingerprint = bind(cursor.fingerprint);
    where.push(`(
      s.last_pushed_at < ${pushedAt}::timestamp
      OR (s.last_pushed_at = ${pushedAt}::timestamp AND s.fingerprint < ${fingerprint})
    )`);
  }

  const contentColumns = options.includeContent
    ? ', latest_log.raw_content, latest_log.processed_content'
    : '';
  const lateralContentColumns = options.includeContent
    ? ', raw_content, processed_content'
    : '';
  const limitParam = bind(limit + 1);
  const offsetSql = !cursor && options.offset
    ? ` OFFSET ${bind(Math.max(0, Math.trunc(options.offset)))}`
    : '';

  const query = `
    SELECT
      latest_log.id,
      s.fingerprint,
      COALESCE(latest_log.processed_title, s.title) AS title,
      COALESCE(latest_log.original_title, s.title) AS original_title,
      s.link,
      s.source,
      s.category,
      s.push_count,
      latest_log.image_path,
      s.last_pushed_at AS pushed_at,
      s.last_pushed_at AT TIME ZONE 'UTC' AS pushed_at_utc,
      to_char(s.last_pushed_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_pushed_at,
      latest_log.job_id,
      CASE WHEN latest_decision.id IS NULL THEN 'pending' ELSE 'completed' END AS annotation_status,
      latest_decision.id AS annotation_id,
      latest_decision.overall_score
      ${contentColumns}
    FROM news_push_stats AS s
    JOIN LATERAL (
      SELECT
        id,
        image_path,
        job_id,
        raw_content->>'title' AS original_title,
        processed_content->>'title' AS processed_title
        ${lateralContentColumns}
      FROM news_push_log
      WHERE fingerprint = s.fingerprint
      ORDER BY pushed_at DESC, id DESC
      LIMIT 1
    ) AS latest_log ON true
    LEFT JOIN LATERAL (
      SELECT id, overall_score
      FROM quality_annotations
      WHERE fingerprint = s.fingerprint AND is_latest = true
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) AS latest_decision ON true
    WHERE ${where.join('\n      AND ')}
    ORDER BY s.last_pushed_at DESC NULLS LAST, s.fingerprint DESC
    LIMIT ${limitParam}${offsetSql}
  `;

  const result = await client.query<ReviewSubjectRow>(query, params);
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  const pushedAt = last?.cursor_pushed_at || null;
  const nextCursor = hasMore && last && pushedAt
    ? encodeReviewCursor({ pushedAt, fingerprint: last.fingerprint })
    : null;

  let total: number | undefined;
  if (options.includeTotal) {
    const countParams: any[] = [];
    const countWhere: string[] = ["s.title IS NOT NULL", "s.title <> ''"];
    const countBind = (value: any): string => {
      countParams.push(value);
      return `$${countParams.length}`;
    };
    if (options.search?.trim()) {
      const p = countBind(`%${options.search.trim()}%`);
      countWhere.push(`(s.title ILIKE ${p} OR s.source ILIKE ${p} OR s.category ILIKE ${p})`);
    }
    if (options.category) countWhere.push(`s.category = ${countBind(options.category)}`);
    if (options.status === 'completed') {
      countWhere.push(`EXISTS (
        SELECT 1 FROM quality_annotations qa
        WHERE qa.fingerprint = s.fingerprint AND qa.is_latest = true
      )`);
    }
    if (options.status === 'pending') {
      countWhere.push(`NOT EXISTS (
        SELECT 1 FROM quality_annotations qa
        WHERE qa.fingerprint = s.fingerprint AND qa.is_latest = true
      )`);
    }
    const countResult = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM news_push_stats AS s
      WHERE ${countWhere.join('\n        AND ')}
    `, countParams);
    total = Number.parseInt(countResult.rows[0]?.count || '0', 10);
  }

  return { rows, nextCursor, hasMore, ...(total === undefined ? {} : { total }) };
}

export async function getReviewStatistics(client: ReviewQueryable) {
  const progress = await client.query<{
    total_count: number;
    pending_count: number;
    completed_count: number;
    skipped_count: number;
    completion_rate: number;
  }>(`
    WITH latest_decisions AS (
      SELECT DISTINCT ON (fingerprint) fingerprint
      FROM quality_annotations
      WHERE is_latest = true AND fingerprint IS NOT NULL
      ORDER BY fingerprint, created_at DESC, id DESC
    )
    SELECT
      COUNT(*)::INTEGER AS total_count,
      COUNT(*) FILTER (WHERE d.fingerprint IS NULL)::INTEGER AS pending_count,
      COUNT(*) FILTER (WHERE d.fingerprint IS NOT NULL)::INTEGER AS completed_count,
      0::INTEGER AS skipped_count,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE d.fingerprint IS NOT NULL) / NULLIF(COUNT(*), 0),
        1
      )::FLOAT AS completion_rate
    FROM news_push_stats s
    LEFT JOIN latest_decisions d ON d.fingerprint = s.fingerprint
    WHERE s.title IS NOT NULL AND s.title <> ''
  `);

  const distribution = await client.query(`
    WITH latest_decisions AS (
      SELECT DISTINCT ON (fingerprint) fingerprint, category, overall_score
      FROM quality_annotations
      WHERE is_latest = true AND fingerprint IS NOT NULL
      ORDER BY fingerprint, created_at DESC, id DESC
    )
    SELECT
      category AS quality_level,
      COUNT(*)::INTEGER AS count,
      ROUND(AVG(overall_score)::numeric, 1)::FLOAT AS avg_score,
      MIN(overall_score)::INTEGER AS min_score,
      MAX(overall_score)::INTEGER AS max_score
    FROM latest_decisions
    GROUP BY category
    ORDER BY CASE category WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END
  `);

  return {
    progress: progress.rows[0] || {
      total_count: 0,
      pending_count: 0,
      completed_count: 0,
      skipped_count: 0,
      completion_rate: 0,
    },
    qualityDistribution: distribution.rows,
  };
}
