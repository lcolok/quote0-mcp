/**
 * Fast read model for the annotation/review console.
 *
 * A review subject is a stable content fingerprint. `news_push_log` is delivery
 * history and can contain hundreds of thousands of rows for only a few thousand
 * subjects, so list/count queries must start from `news_push_stats` and touch
 * only the latest delivery for the small page selected first.
 */

export interface ReviewQueryable {
  query<T = any>(text: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ReviewCursor {
  pushedAt: string;
  fingerprint: string;
}

export interface ReviewListOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
  search?: string;
  includeTotal?: boolean;
}

export interface ReviewSubjectSummaryRow {
  id: number;
  fingerprint: string;
  title: string | null;
  original_title: string | null;
  link: string | null;
  source: string | null;
  category: string | null;
  push_count: number;
  image_path: string | null;
  pushed_at: Date | string;
  cursor_pushed_at: string;
  job_id: string | null;
  layer: string | null;
  annotation_status: 'pending' | 'annotating' | 'completed' | 'skipped' | null;
  signature: string | null;
  producer: string | null;
  contract_version: string | null;
}

export interface ReviewListResult {
  rows: ReviewSubjectSummaryRow[];
  hasMore: boolean;
  nextCursor: string | null;
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

export async function listReviewSubjectSummaries(
  client: ReviewQueryable,
  options: ReviewListOptions = {},
): Promise<ReviewListResult> {
  const limit = normalizeLimit(options.limit);
  const cursor = decodeReviewCursor(options.cursor);
  if (options.cursor && !cursor) throw new Error('无效的分页游标');

  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ["s.title IS NOT NULL", "s.title <> ''", 's.last_pushed_at IS NOT NULL'];

  const search = options.search?.trim();
  if (search) {
    const p = bind(`%${search}%`);
    where.push(`(s.title ILIKE ${p} OR s.source ILIKE ${p} OR s.category ILIKE ${p})`);
  }
  if (cursor) {
    const pushedAt = bind(cursor.pushedAt);
    const fingerprint = bind(cursor.fingerprint);
    where.push(`(
      s.last_pushed_at < ${pushedAt}::timestamp
      OR (s.last_pushed_at = ${pushedAt}::timestamp AND s.fingerprint < ${fingerprint})
    )`);
  }

  const pageLimit = bind(limit + 1);
  const offsetSql = !cursor && options.offset
    ? ` OFFSET ${bind(Math.max(0, Math.trunc(options.offset)))}`
    : '';

  // Critical shape: page the ~10k subject table FIRST, then perform at most
  // limit+1 latest-delivery lookups. Do not lateral-join all subjects first.
  const result = await client.query<ReviewSubjectSummaryRow>(`
    WITH subjects AS MATERIALIZED (
      SELECT
        s.fingerprint,
        s.title,
        s.link,
        s.source,
        s.category,
        s.push_count,
        s.last_pushed_at
      FROM news_push_stats AS s
      WHERE ${where.join('\n        AND ')}
      ORDER BY s.last_pushed_at DESC, s.fingerprint DESC
      LIMIT ${pageLimit}${offsetSql}
    )
    SELECT
      latest_log.id,
      subjects.fingerprint,
      COALESCE(latest_log.processed_title, subjects.title) AS title,
      COALESCE(latest_log.original_title, subjects.title) AS original_title,
      subjects.link,
      subjects.source,
      subjects.category,
      subjects.push_count,
      latest_log.image_path,
      subjects.last_pushed_at AS pushed_at,
      to_char(subjects.last_pushed_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_pushed_at,
      latest_log.job_id,
      latest_log.layer,
      latest_log.annotation_status,
      latest_log.signature,
      latest_log.producer,
      latest_log.contract_version
    FROM subjects
    JOIN LATERAL (
      SELECT
        id,
        image_path,
        job_id,
        layer,
        annotation_status,
        raw_content->>'title' AS original_title,
        processed_content->>'title' AS processed_title,
        processed_content->>'signature' AS signature,
        processed_content->'metadata'->>'producer' AS producer,
        processed_content->'metadata'->>'contractVersion' AS contract_version
      FROM news_push_log
      WHERE fingerprint = subjects.fingerprint
      ORDER BY pushed_at DESC, id DESC
      LIMIT 1
    ) AS latest_log ON true
    ORDER BY subjects.last_pushed_at DESC, subjects.fingerprint DESC
  `, params);

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  const nextCursor = hasMore && last?.cursor_pushed_at
    ? encodeReviewCursor({ pushedAt: last.cursor_pushed_at, fingerprint: last.fingerprint })
    : null;

  let total: number | undefined;
  if (options.includeTotal) {
    const countParams: unknown[] = [];
    const countBind = (value: unknown): string => {
      countParams.push(value);
      return `$${countParams.length}`;
    };
    const countWhere = ["title IS NOT NULL", "title <> ''", 'last_pushed_at IS NOT NULL'];
    if (search) {
      const p = countBind(`%${search}%`);
      countWhere.push(`(title ILIKE ${p} OR source ILIKE ${p} OR category ILIKE ${p})`);
    }
    const count = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM news_push_stats
      WHERE ${countWhere.join('\n        AND ')}
    `, countParams);
    total = Number.parseInt(count.rows[0]?.count || '0', 10);
  }

  return { rows, hasMore, nextCursor, ...(total === undefined ? {} : { total }) };
}

export async function getStableReviewStatistics(client: ReviewQueryable) {
  // `quality_annotations` is tiny and keyed by delivery id in the current schema.
  // Resolve those annotated deliveries to stable fingerprints, then join against
  // the ~10k subject table. This avoids scanning JSONB in ~340k delivery rows.
  const progress = await client.query<{
    total_count: number;
    pending_count: number;
    completed_count: number;
    skipped_count: number;
    completion_rate: number;
  }>(`
    WITH annotated_fingerprints AS MATERIALIZED (
      SELECT DISTINCT npl.fingerprint
      FROM quality_annotations AS qa
      JOIN news_push_log AS npl ON npl.id = qa.news_id
      WHERE qa.is_latest = true
        AND npl.fingerprint IS NOT NULL
    )
    SELECT
      COUNT(*)::INTEGER AS total_count,
      COUNT(*) FILTER (WHERE af.fingerprint IS NULL)::INTEGER AS pending_count,
      COUNT(*) FILTER (WHERE af.fingerprint IS NOT NULL)::INTEGER AS completed_count,
      0::INTEGER AS skipped_count,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE af.fingerprint IS NOT NULL) / NULLIF(COUNT(*), 0),
        1
      )::FLOAT AS completion_rate
    FROM news_push_stats AS s
    LEFT JOIN annotated_fingerprints AS af ON af.fingerprint = s.fingerprint
    WHERE s.title IS NOT NULL AND s.title <> ''
  `);

  const distribution = await client.query(`
    SELECT
      qa.category AS quality_level,
      COUNT(*)::INTEGER AS count,
      ROUND(AVG(qa.overall_score)::numeric, 1)::FLOAT AS avg_score,
      MIN(qa.overall_score)::INTEGER AS min_score,
      MAX(qa.overall_score)::INTEGER AS max_score
    FROM quality_annotations AS qa
    WHERE qa.is_latest = true
    GROUP BY qa.category
    ORDER BY CASE qa.category WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END
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
