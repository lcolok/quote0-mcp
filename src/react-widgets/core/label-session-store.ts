import { getPostgresDatabase } from './postgres-database.js';
import { enqueueLabelJob, renderTemplate } from './label-job-queue.js';

/**
 * 会话式版本树总账(docs/Label-Session-Editor-Spec.md)
 *
 * 架构不变式:任何会产生/改变标签像素的操作必须经过 createTurn(),
 * 不允许端点绕过它直接入队 label_jobs 或直接写 labels。
 */

export interface CreateTurnOpts {
  sessionId: string;
  parentTurnId?: string | null;
  turnKind: 'root' | 'refine' | 'redither' | 'decoration';
  genMode?: 'template' | 'img2img' | 'rewrite' | null;
  userFeedback?: string | null;
  refImageUrls?: string[] | null;
  params?: Record<string, any> | null;
  effectivePrompt?: string | null;
  effectivePromptZh?: string | null;
  clientRequestId?: string | null;
  /** 异步路径:入队 label_jobs(createTurn 自动注入 session:/turn: tags) */
  enqueue?: { jobType: 'image' | 'widget'; payload: Record<string, any> } | null;
  /** 同步路径:已有产物 label 直接挂上 */
  labelId?: string | null;
}

export interface CreateTurnResult {
  turnId: string;
  jobId: string | null;
  jobState: string | null;
  jobCreatedAt: Date | null;
  deduped: boolean;
}

async function findTurnByRequestId(clientRequestId: string): Promise<CreateTurnResult | null> {
  const pool = getPostgresDatabase().getPool();
  const r = await pool.query(
    `SELECT t.id, t.job_id, j.state AS job_state, j.created_at AS job_created_at
       FROM label_gen_turns t
       LEFT JOIN label_jobs j ON j.id = t.job_id
      WHERE t.client_request_id = $1`,
    [clientRequestId]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    turnId: row.id,
    jobId: row.job_id,
    jobState: row.job_state,
    jobCreatedAt: row.job_created_at,
    deduped: true,
  };
}

export async function createTurn(opts: CreateTurnOpts): Promise<CreateTurnResult> {
  const pool = getPostgresDatabase().getPool();

  if (opts.clientRequestId) {
    const dup = await findTurnByRequestId(opts.clientRequestId);
    if (dup) return dup;
  }

  const ins = await pool.query(
    `INSERT INTO label_gen_turns
       (session_id, parent_turn_id, turn_kind, gen_mode, user_feedback,
        ref_image_urls, params, effective_prompt, effective_prompt_zh, label_id, client_request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
     ON CONFLICT (client_request_id) DO NOTHING
     RETURNING id`,
    [
      opts.sessionId,
      opts.parentTurnId ?? null,
      opts.turnKind,
      opts.genMode ?? null,
      opts.userFeedback ?? null,
      opts.refImageUrls && opts.refImageUrls.length ? JSON.stringify(opts.refImageUrls) : null,
      opts.params ? JSON.stringify(opts.params) : null,
      opts.effectivePrompt ?? null,
      opts.effectivePromptZh ?? null,
      opts.labelId ?? null,
      opts.clientRequestId ?? null,
    ]
  );

  const turnId: string | undefined = ins.rows[0]?.id;
  if (!turnId) {
    // 并发撞 client_request_id:复用已存在的 turn
    const again = opts.clientRequestId ? await findTurnByRequestId(opts.clientRequestId) : null;
    if (!again) throw new Error('createTurn: turn 插入失败且无法按 client_request_id 找回');
    return again;
  }

  let jobId: string | null = null;
  let jobState: string | null = null;
  let jobCreatedAt: Date | null = null;
  if (opts.enqueue) {
    const payload: Record<string, any> = { ...opts.enqueue.payload };
    payload.tags = [
      ...(Array.isArray(payload.tags) ? payload.tags : []),
      `session:${opts.sessionId}`,
      `turn:${turnId}`,
    ];
    const res = await enqueueLabelJob({
      jobType: opts.enqueue.jobType,
      payload,
      clientRequestId: opts.clientRequestId ?? null,
    });
    jobId = res.jobId;
    jobState = res.state;
    jobCreatedAt = res.createdAt;
    await pool.query(`UPDATE label_gen_turns SET job_id = $1 WHERE id = $2`, [jobId, turnId]);
  }

  // 新 turn 即当前版本(undo = select 回父节点)
  await pool.query(
    `UPDATE label_sessions SET current_turn_id = $1, updated_at = now() WHERE id = $2`,
    [turnId, opts.sessionId]
  );
  await syncBatchItemPointer(opts.sessionId, jobId, opts.labelId ?? null);

  return { turnId, jobId, jobState, jobCreatedAt, deduped: false };
}

/** batch_item 主体:把 item 的 job_id/label_id 同步到指针所指 turn(既有打印/审批/详情回填零改动) */
async function syncBatchItemPointer(
  sessionId: string,
  jobId: string | null,
  labelId: string | null
): Promise<void> {
  const pool = getPostgresDatabase().getPool();
  await pool.query(
    `UPDATE label_batch_items i
        SET job_id = COALESCE($2, i.job_id), label_id = $3, updated_at = now()
       FROM label_sessions s
      WHERE s.id = $1 AND s.subject_type = 'batch_item' AND i.id = s.subject_id`,
    [sessionId, jobId, labelId]
  );
}

/** batch item 的 session 惰性创建;旧 item 有生成历史时合成 root turn(零迁移脚本) */
export async function ensureBatchItemSession(
  itemId: string
): Promise<{ sessionId: string; currentTurnId: string | null }> {
  const pool = getPostgresDatabase().getPool();
  const iRes = await pool.query(
    `SELECT i.id, i.name, i.vars, i.ref_image_urls, i.job_id, i.label_id, i.session_id,
            b.id AS batch_id, b.prompt_template, b.template_rev, b.model, b.preset_id, b.target_id
       FROM label_batch_items i
       JOIN label_batches b ON b.id = i.batch_id
      WHERE i.id = $1
      LIMIT 1`,
    [itemId]
  );
  const it = iRes.rows[0];
  if (!it) throw new Error(`batch item 不存在: ${itemId}`);

  if (it.session_id) {
    const s = await pool.query(`SELECT current_turn_id FROM label_sessions WHERE id = $1`, [
      it.session_id,
    ]);
    return { sessionId: it.session_id, currentTurnId: s.rows[0]?.current_turn_id ?? null };
  }

  const sIns = await pool.query(
    `INSERT INTO label_sessions (subject_type, subject_id)
     VALUES ('batch_item', $1)
     ON CONFLICT (subject_type, subject_id) WHERE subject_type = 'batch_item' DO NOTHING
     RETURNING id`,
    [itemId]
  );
  let sessionId: string | undefined = sIns.rows[0]?.id;
  if (!sessionId) {
    // 并发 ensure:复用已存在的 session
    const again = await pool.query(
      `SELECT id, current_turn_id FROM label_sessions
        WHERE subject_type = 'batch_item' AND subject_id = $1`,
      [itemId]
    );
    if (!again.rows[0]) throw new Error('ensureBatchItemSession: session 创建失败且找不回');
    await pool.query(
      `UPDATE label_batch_items SET session_id = $1, updated_at = now() WHERE id = $2`,
      [again.rows[0].id, itemId]
    );
    return { sessionId: again.rows[0].id, currentTurnId: again.rows[0].current_turn_id ?? null };
  }

  // 旧 item 已有生成历史 → 合成 root turn 入账
  let currentTurnId: string | null = null;
  if (it.job_id || it.label_id) {
    let labelId: string | null = it.label_id;
    if (!labelId && it.job_id) {
      const j = await pool.query(`SELECT label_id FROM label_jobs WHERE id = $1`, [it.job_id]);
      labelId = j.rows[0]?.label_id ?? null;
    }
    const prompt = renderTemplate(it.prompt_template ?? '', {
      name: it.name,
      ...(it.vars ?? {}),
    });
    const t = await pool.query(
      `INSERT INTO label_gen_turns
         (session_id, turn_kind, gen_mode, ref_image_urls, params, effective_prompt, job_id, label_id)
       VALUES ($1, 'root', 'template', $2::jsonb, $3::jsonb, $4, $5, $6)
       RETURNING id`,
      [
        sessionId,
        it.ref_image_urls && it.ref_image_urls.length ? JSON.stringify(it.ref_image_urls) : null,
        JSON.stringify({
          model: it.model,
          presetId: it.preset_id ?? null,
          targetId: it.target_id,
          templateRev: it.template_rev,
        }),
        prompt,
        it.job_id ?? null,
        labelId,
      ]
    );
    currentTurnId = t.rows[0].id;
    await pool.query(
      `UPDATE label_sessions SET current_turn_id = $1, updated_at = now() WHERE id = $2`,
      [currentTurnId, sessionId]
    );
  }

  await pool.query(
    `UPDATE label_batch_items SET session_id = $1, updated_at = now() WHERE id = $2`,
    [sessionId, itemId]
  );
  return { sessionId, currentTurnId };
}

/** DesignPage 等单条设计场景:每次全新生成 = 一个新 standalone session */
export async function createStandaloneSession(): Promise<string> {
  const pool = getPostgresDatabase().getPool();
  const r = await pool.query(
    `INSERT INTO label_sessions (subject_type) VALUES ('standalone') RETURNING id`
  );
  return r.rows[0].id;
}

export interface SessionTreeRows {
  session: any;
  turns: any[];
  recycledTurns: any[];
}

export async function getSessionTree(sessionId: string): Promise<SessionTreeRows | null> {
  const pool = getPostgresDatabase().getPool();
  const s = await pool.query(
    `SELECT id, subject_type, subject_id, current_turn_id, created_at
       FROM label_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!s.rows[0]) return null;
  const cols = `t.id, t.parent_turn_id, t.turn_kind, t.gen_mode, t.user_feedback,
            t.ref_image_urls, t.params, t.effective_prompt, t.effective_prompt_zh, t.job_id, t.created_at,
            j.state AS job_state, j.last_error AS job_error,
            l.id AS l_id, l.png_path, l.status AS label_status, l.source_image_url`;
  const joins = `FROM label_gen_turns t
       LEFT JOIN label_jobs j ON j.id = t.job_id
       LEFT JOIN labels l ON l.id = COALESCE(t.label_id, j.label_id)`;
  const t = await pool.query(
    `SELECT ${cols} ${joins}
      WHERE t.session_id = $1 AND t.deleted_at IS NULL
      ORDER BY t.created_at ASC, t.id ASC`,
    [sessionId]
  );
  const recycled = await pool.query(
    `SELECT ${cols} ${joins}
      WHERE t.session_id = $1 AND t.deleted_at IS NOT NULL
      ORDER BY t.deleted_at DESC`,
    [sessionId]
  );
  return { session: s.rows[0], turns: t.rows, recycledTurns: recycled.rows };
}

/** 移动「当前版本」指针(undo/redo/选 fork 分支),并同步 batch item */
export async function selectTurn(
  sessionId: string,
  turnId: string
): Promise<{ labelId: string | null }> {
  const pool = getPostgresDatabase().getPool();
  const t = await pool.query(
    `SELECT t.id, t.job_id, COALESCE(t.label_id, j.label_id) AS resolved_label_id
       FROM label_gen_turns t
       LEFT JOIN label_jobs j ON j.id = t.job_id
      WHERE t.id = $1 AND t.session_id = $2`,
    [turnId, sessionId]
  );
  const row = t.rows[0];
  if (!row) throw new Error('turn 不存在或不属于该 session');
  await pool.query(
    `UPDATE label_sessions SET current_turn_id = $1, updated_at = now() WHERE id = $2`,
    [turnId, sessionId]
  );
  await pool.query(
    `UPDATE label_batch_items i
        SET job_id = $2, label_id = $3, updated_at = now()
       FROM label_sessions s
      WHERE s.id = $1 AND s.subject_type = 'batch_item' AND i.id = s.subject_id`,
    [sessionId, row.job_id, row.resolved_label_id]
  );
  return { labelId: row.resolved_label_id ?? null };
}
