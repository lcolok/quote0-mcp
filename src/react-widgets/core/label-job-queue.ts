import { getPostgresDatabase } from './postgres-database.js';

export interface EnqueueResult {
  jobId: string;
  state: string;
  createdAt: Date;
  deduped: boolean;
}

/** 统一的 label_jobs 入队（generate-image / generate-text / batch 三方共用） */
export async function enqueueLabelJob(opts: {
  jobType: 'image' | 'widget';
  payload: Record<string, any>;
  clientRequestId?: string | null;
}): Promise<EnqueueResult> {
  const db = getPostgresDatabase();
  if (opts.clientRequestId) {
    const dup = await db.getPool().query(
      `SELECT id, state, created_at FROM label_jobs WHERE client_request_id = $1`,
      [opts.clientRequestId]
    );
    if (dup.rows[0]) {
      const r = dup.rows[0];
      return { jobId: r.id, state: r.state, createdAt: r.created_at, deduped: true };
    }
  }
  const ins = await db.getPool().query(
    `INSERT INTO label_jobs (job_type, payload, client_request_id)
     VALUES ($1, $2::jsonb, $3) RETURNING id, state, created_at`,
    [opts.jobType, JSON.stringify(opts.payload), opts.clientRequestId ?? null]
  );
  const r = ins.rows[0];
  return { jobId: r.id, state: r.state, createdAt: r.created_at, deduped: false };
}

/** {{key}} → vars[key]，缺失变量替空串 */
export function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '').toString());
}
