import { Hono } from 'hono';
import sharp from 'sharp';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import {
  createTurn,
  ensureBatchItemSession,
  getSessionTree,
  selectTurn,
} from '../react-widgets/core/label-session-store.js';
import { enqueueLabelJob } from '../react-widgets/core/label-job-queue.js';
import { randomUUID } from 'node:crypto';
import { getActiveLLMConfig } from '../react-widgets/core/llm-config.js';
import {
  multimodalLLMClient,
  imageUrlToBase64,
  type VisionContentPart,
} from '../react-widgets/services/multimodal-llm-client.js';

const labelSessionsApp = new Hono();

function pngUrlOf(pngPath: string | null): string | null {
  return pngPath ? `/api/minio-proxy/${pngPath}` : null;
}

/** turn 对外状态:无 job 但有 label = 同步轮已完成;其余映射 job.state */
function turnState(jobState: string | null, hasLabel: boolean): string {
  if (!jobState) return hasLabel ? 'succeeded' : 'pending';
  if (jobState === 'queued') return 'pending';
  if (jobState === 'running') return 'running';
  if (jobState === 'succeeded') return hasLabel ? 'succeeded' : 'running';
  return jobState; // failed
}

// ============ POST /ensure —— 惰性建 session(旧 item 合成 root turn) ============
labelSessionsApp.post('/ensure', async (c) => {
  try {
    const body = await c.req.json<{ subjectType: string; subjectId: string }>();
    if (body.subjectType !== 'batch_item' || !body.subjectId) {
      return c.json({ success: false, error: '仅支持 subjectType=batch_item 且 subjectId 必填' }, 400);
    }
    const r = await ensureBatchItemSession(body.subjectId);
    return c.json({ success: true, sessionId: r.sessionId, currentTurnId: r.currentTurnId });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/ensure 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ GET /:id —— session 树(join job 状态 + label) ============
labelSessionsApp.get('/:id', async (c) => {
  try {
    const tree = await getSessionTree(c.req.param('id'));
    if (!tree) return c.json({ success: false, error: 'session 不存在' }, 404);
    const s = tree.session;
    const mapTurn = (row: any) => ({
      id: row.id,
      parentTurnId: row.parent_turn_id,
      turnKind: row.turn_kind,
      genMode: row.gen_mode,
      userFeedback: row.user_feedback,
      refImageUrls: row.ref_image_urls ?? [],
      params: row.params,
      // agent 的确认回复 + planner 决策存在 params.planner(零 schema 改动)
      agentReply: row.params?.planner?.reply ?? null,
      effectivePrompt: row.effective_prompt,
      effectivePromptZh: row.effective_prompt_zh ?? null,
      jobId: row.job_id,
      state: turnState(row.job_state, !!row.l_id),
      lastError: row.job_error ?? null,
      label: row.l_id
        ? {
            id: row.l_id,
            pngUrl: pngUrlOf(row.png_path),
            status: row.label_status,
            sourceImageUrl: row.source_image_url ?? null,
          }
        : null,
      createdAt: row.created_at,
    });
    return c.json({
      success: true,
      session: {
        id: s.id,
        subjectType: s.subject_type,
        subjectId: s.subject_id,
        currentTurnId: s.current_turn_id,
        createdAt: s.created_at,
      },
      turns: tree.turns.map(mapTurn),
      recycledTurns: (tree.recycledTurns ?? []).map(mapTurn),
    });
  } catch (error) {
    console.error('❌ GET /api/label-sessions/:id 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

interface CandidateRef {
  url: string;
  label: string;
  source: 'history' | 'upload' | 'input';
  selected: boolean;
}

/** 一条重生成路径:从哪个版本 fork(fresh 时 baseTurnId=null,全新起点不继承)、模式、最小上下文、prompt */
interface PlanPath {
  id: string;
  label: string;
  recommended: boolean;
  strategy: 'clean-restart' | 'incremental' | 'fresh';
  baseTurnId: string | null;
  baseVersionNo: number | null;
  mode: 'img2img' | 'rewrite';
  prompt: string;
  promptZh: string;
  rationale: string;
  candidateRefs: CandidateRef[];
}

interface ClarifyChoice {
  id: string;
  label: string;
  description: string;
}

interface PlanResult {
  kind: 'clarify' | 'paths';
  reply: string;
  reasoning: string | null;
  question?: string;
  choices?: ClarifyChoice[];
  paths?: PlanPath[];
}

/** 取父版本(含 AI 原图 source_image_url)与 session 内候选参考图 */
async function loadParentTurn(sessionId: string, parentTurnId: string) {
  const pool = getPostgresDatabase().getPool();
  const r = await pool.query(
    `SELECT t.id, t.params, t.effective_prompt,
            l.id AS label_id, l.png_path, l.source_image_url
       FROM label_gen_turns t
       LEFT JOIN label_jobs j ON j.id = t.job_id
       LEFT JOIN labels l ON l.id = COALESCE(t.label_id, j.label_id)
      WHERE t.id = $1 AND t.session_id = $2`,
    [parentTurnId, sessionId]
  );
  return r.rows[0] ?? null;
}

// ============ POST /:id/plan —— 意图规划(只分析,不建 turn、不入队) ============
// agent 看整棵 session 树 + 候选图,自动判 模式(img2img/rewrite)、动态选参考图、
// 重写 prompt,并产出一句给用户的确认话。前端据此渲染交互式确认面板。
labelSessionsApp.post('/:id/plan', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const body = await c.req.json<{
      parentTurnId?: string | null;
      feedback: string;
      refImageUrls?: string[];
      fresh?: boolean;
      clarifications?: string[];
    }>();
    if (!body.feedback || !body.feedback.trim())
      return c.json({ success: false, error: 'feedback 必填' }, 400);

    if (body.parentTurnId) {
      const focused = await loadParentTurn(sessionId, body.parentTurnId);
      if (!focused) return c.json({ success: false, error: '聚焦版本不存在或不属于该 session' }, 404);
    }

    const plan = await planPaths({
      sessionId,
      focusedTurnId: body.parentTurnId ?? null,
      feedback: body.feedback.trim(),
      userUploads: body.refImageUrls ?? [],
      fresh: !!body.fresh,
      clarifications: Array.isArray(body.clarifications) ? body.clarifications : [],
    });
    return c.json({ success: true, ...plan });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/plan 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/turns —— refine:基于任意父版本生成新版本(fork 天然支持) ============
// 两种调用形态:
//  A) 确认后执行(推荐):带 effectivePrompt + 最终 refImageUrls + agentReply(来自 /plan,前端可改)
//  B) 旧式直发(向后兼容):无 effectivePrompt,rewrite 在本端口同步调 LLM 重写、img2img 拼父原图
labelSessionsApp.post('/:id/turns', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const body = await c.req.json<{
      parentTurnId?: string | null;
      feedback: string;
      refImageUrls?: string[];
      genMode: 'img2img' | 'rewrite';
      model?: string;
      presetId?: string | null;
      clientRequestId?: string;
      // 确认后执行形态(来自 /plan,前端可编辑)
      effectivePrompt?: string;
      effectivePromptZh?: string;
      agentReply?: string;
      plannerReasoning?: string;
    }>();
    if (!body.feedback || !body.feedback.trim())
      return c.json({ success: false, error: 'feedback 必填' }, 400);
    if (!['img2img', 'rewrite'].includes(body.genMode))
      return c.json({ success: false, error: 'genMode 取值非法(img2img|rewrite)' }, 400);

    const feedback = body.feedback.trim();
    const confirmed = typeof body.effectivePrompt === 'string' && body.effectivePrompt.trim().length > 0;
    // 无 parentTurnId = 全新起点(不继承任何现有版本的像素/prompt,新建一棵 root 树)
    const isFresh = !body.parentTurnId;
    const extraParams: Record<string, any> = {};

    let parent: any = null;
    if (!isFresh) {
      parent = await loadParentTurn(sessionId, body.parentTurnId!);
      if (!parent) return c.json({ success: false, error: '父版本不存在或不属于该 session' }, 404);
    }

    // 生成配置:有父版沿用父版 params;全新起点从本批次/session 取默认(只切图像血缘,保打印尺寸/模型)
    const pParams = parent?.params ?? {};
    let model = body.model ?? pParams.model;
    let presetId = body.presetId !== undefined ? body.presetId : (pParams.presetId ?? null);
    let targetId = pParams.targetId;
    if (isFresh || !model || !targetId) {
      const def = await sessionGenDefaults(sessionId);
      model = model ?? def.model;
      presetId = presetId ?? def.presetId;
      targetId = targetId ?? def.targetId;
    }
    model = model ?? 'sd5';
    targetId = targetId ?? 'label-T40x20-320';

    let effectivePrompt: string;
    let effectivePromptZh: string | null = null;
    let refs: string[];

    if (isFresh) {
      // 全新起点:只用用户上传图(img2img)或纯描述(rewrite),零继承现有版本
      refs = body.refImageUrls ?? [];
      if (body.genMode === 'img2img' && refs.length === 0)
        return c.json(
          { success: false, error: '全新起点的图生图至少需要一张你上传的参考图,或改用「重写」纯文生图' },
          400
        );
      effectivePrompt = confirmed ? body.effectivePrompt!.trim() : feedback;
    } else if (body.genMode === 'img2img') {
      // 确认形态:前端传来的最终参考图列表即权威(候选里含父原图,用户可勾选/取消)
      // 旧式形态:写死「父原图 + 用户新传图」
      if (confirmed) {
        refs = body.refImageUrls ?? [];
        // img2img 必须至少有一张底图;若用户把所有图都取消了,回落到父原图
        if (refs.length === 0) {
          if (!parent.source_image_url)
            return c.json(
              { success: false, error: '父版本没有 AI 原图(source_image_url),无法图生图微调,请改用「重写」模式' },
              400
            );
          refs = [parent.source_image_url];
        }
        effectivePrompt = body.effectivePrompt!.trim();
      } else {
        if (!parent.source_image_url) {
          return c.json(
            { success: false, error: '父版本没有 AI 原图(source_image_url),无法图生图微调,请改用「重写」模式' },
            400
          );
        }
        refs = [parent.source_image_url, ...(body.refImageUrls ?? [])];
        effectivePrompt = feedback;
      }
    } else {
      refs = body.refImageUrls ?? [];
      if (confirmed) {
        // planner(/plan)已重写好,直接采用前端确认/编辑过的 prompt
        effectivePrompt = body.effectivePrompt!.trim();
      } else {
        try {
          const r = await rewritePromptViaLLM(parent, feedback);
          effectivePrompt = r.prompt;
          effectivePromptZh = r.promptZh;
        } catch (e) {
          // LLM 不可用时降级:父 prompt + 调整指令直接拼接
          console.warn('⚠️ rewrite LLM 调用失败,降级拼接:', e instanceof Error ? e.message : e);
          effectivePrompt = `${parent.effective_prompt ?? ''}\n\nAdjustment: ${feedback}`.trim();
          effectivePromptZh = feedback;
          extraParams.rewriteDegraded = true;
        }
      }
    }

    // planner 决策(确认回复 + 推理)落账到 params.planner —— 对话流显示 + 溯源,零 schema 改动
    if (body.agentReply || body.plannerReasoning || confirmed) {
      extraParams.planner = {
        reply: body.agentReply ?? null,
        reasoning: body.plannerReasoning ?? null,
        confirmed,
      };
    }

    const res = await createTurn({
      sessionId,
      parentTurnId: body.parentTurnId ?? null,
      turnKind: isFresh ? 'root' : 'refine',
      genMode: body.genMode,
      userFeedback: feedback,
      refImageUrls: body.refImageUrls ?? null,
      params: { model, presetId, targetId, ...(isFresh ? { fresh: true } : {}), ...extraParams },
      effectivePrompt,
      effectivePromptZh: body.effectivePromptZh ?? effectivePromptZh ?? null,
      clientRequestId: body.clientRequestId ?? null,
      enqueue: {
        jobType: 'image',
        payload: {
          prompt: effectivePrompt,
          model,
          targetId,
          presetId: presetId ?? undefined,
          refImageUrls: refs,
          tags: await batchTagsOf(sessionId),
        },
      },
    });
    return c.json(
      { success: true, turnId: res.turnId, jobId: res.jobId, deduped: res.deduped },
      res.deduped ? 200 : 201
    );
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/turns 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/translate-prompt —— 中译英(编辑中文 prompt → 生图友好的英文) ============
labelSessionsApp.post('/:id/translate-prompt', async (c) => {
  try {
    const body = await c.req.json<{ promptZh?: string }>();
    const promptZh = (body.promptZh ?? '').trim();
    if (!promptZh) return c.json({ success: false, error: 'promptZh 不能为空' }, 400);
    const { prompt, promptZh: outZh } = await translatePromptZhToEn(promptZh);
    return c.json({ success: true, prompt, promptZh: outZh });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/translate-prompt 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/select —— 移动当前版本指针(undo/redo/选 fork 分支) ============
labelSessionsApp.post('/:id/select', async (c) => {
  try {
    const body = await c.req.json<{ turnId: string }>();
    if (!body.turnId) return c.json({ success: false, error: 'turnId 必填' }, 400);
    const r = await selectTurn(c.req.param('id'), body.turnId);
    return c.json({ success: true, labelId: r.labelId });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/select 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/turns/:turnId/retry —— 原地重试失败 turn(同 payload 重入队,不新建版本) ============
labelSessionsApp.post('/:id/turns/:turnId/retry', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const turnId = c.req.param('turnId');
    const db = getPostgresDatabase();
    // 取该 turn 现有 job 的 payload(含已解析的 effective prompt / 参考图 / model)
    const r = await db.getPool().query(
      `SELECT j.job_type, j.payload
         FROM label_gen_turns t JOIN label_jobs j ON j.id = t.job_id
        WHERE t.id = $1 AND t.session_id = $2 LIMIT 1`,
      [turnId, sessionId]
    );
    if (r.rows.length === 0)
      return c.json({ success: false, error: 'turn 或其 job 不存在,无法重试' }, 404);
    const { job_type, payload } = r.rows[0];
    // 同 payload 重新入队(新 clientRequestId 避免幂等去重)
    const { jobId } = await enqueueLabelJob({
      jobType: job_type,
      payload,
      clientRequestId: randomUUID(),
    });
    // 原地把该 turn 的 job 指针换成新 job,清掉旧 label
    await db.getPool().query(
      `UPDATE label_gen_turns SET job_id = $1, label_id = NULL WHERE id = $2`,
      [jobId, turnId]
    );
    // 让该 turn 成为当前 + 同步 batch item 指针到新 job(复用 selectTurn)
    await selectTurn(sessionId, turnId);
    return c.json({ success: true, jobId });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/turns/:turnId/retry 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ DELETE /:id/turns/:turnId —— 软删除(标记 deleted_at,进回收站,不真删);删当前版则指针移到最近剩余版 ============
labelSessionsApp.delete('/:id/turns/:turnId', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const turnId = c.req.param('turnId');
    const pool = getPostgresDatabase().getPool();
    // 该 session 活跃 turn(按时间升序)
    const all = await pool.query(
      `SELECT id FROM label_gen_turns WHERE session_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [sessionId]
    );
    if (!all.rows.some((r) => r.id === turnId))
      return c.json({ success: false, error: 'turn 不存在或不属于该 session' }, 404);
    if (all.rows.length <= 1)
      return c.json({ success: false, error: '不能删除最后一个版本' }, 400);
    // 是否删的是当前采用版
    const sess = await pool.query(
      `SELECT current_turn_id FROM label_sessions WHERE id = $1`,
      [sessionId]
    );
    const wasCurrent = sess.rows[0]?.current_turn_id === turnId;
    // 软删除(FK: parent_turn_id/label_id/job_id 均 ON DELETE SET NULL,不级联误删)
    await pool.query(`UPDATE label_gen_turns SET deleted_at = now() WHERE id = $1 AND session_id = $2`, [turnId, sessionId]);
    let currentTurnId: string | null = sess.rows[0]?.current_turn_id ?? null;
    if (wasCurrent) {
      const remain = all.rows.filter((r) => r.id !== turnId);
      const newCurrentTurnId = remain[remain.length - 1].id; // 最近的剩余版
      currentTurnId = newCurrentTurnId;
      await selectTurn(sessionId, newCurrentTurnId); // 修指针 + 同步 batch item
    }
    return c.json({ success: true, currentTurnId });
  } catch (error) {
    console.error('❌ DELETE /api/label-sessions/:id/turns/:turnId 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

// ============ POST /:id/turns/:turnId/restore —— 从回收站恢复一个版本 ============
labelSessionsApp.post('/:id/turns/:turnId/restore', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const turnId = c.req.param('turnId');
    const pool = getPostgresDatabase().getPool();
    const r = await pool.query(
      `UPDATE label_gen_turns SET deleted_at = NULL
        WHERE id = $1 AND session_id = $2 AND deleted_at IS NOT NULL`,
      [turnId, sessionId]
    );
    if (r.rowCount === 0) return c.json({ success: false, error: '回收的版本不存在' }, 404);
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ POST /api/label-sessions/:id/turns/:turnId/restore 失败:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '未知错误' }, 500);
  }
});

/** batch_item 主体的 session 继续沿用 batch:/item: tags,保持标签可按批次检索 */
async function batchTagsOf(sessionId: string): Promise<string[]> {
  const pool = getPostgresDatabase().getPool();
  const r = await pool.query(
    `SELECT i.id AS item_id, i.batch_id
       FROM label_sessions s
       JOIN label_batch_items i ON i.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'batch_item'`,
    [sessionId]
  );
  if (!r.rows[0]) return [];
  return [`batch:${r.rows[0].batch_id}`, `item:${r.rows[0].item_id}`];
}

/** 全新起点取生成配置:batch_item 用本批次默认,否则取 session 内最近一轮 params(只保打印尺寸/模型,不继承图像) */
async function sessionGenDefaults(
  sessionId: string
): Promise<{ model: string; presetId: string | null; targetId: string }> {
  const pool = getPostgresDatabase().getPool();
  const b = await pool.query(
    `SELECT b.model, b.preset_id, b.target_id
       FROM label_sessions s
       JOIN label_batch_items i ON i.id = s.subject_id
       JOIN label_batches b ON b.id = i.batch_id
      WHERE s.id = $1 AND s.subject_type = 'batch_item'`,
    [sessionId]
  );
  if (b.rows[0]) {
    return {
      model: b.rows[0].model ?? 'sd5',
      presetId: b.rows[0].preset_id ?? null,
      targetId: b.rows[0].target_id ?? 'label-T40x20-320',
    };
  }
  const t = await pool.query(
    `SELECT params FROM label_gen_turns WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  const p = t.rows[0]?.params ?? {};
  return {
    model: p.model ?? 'sd5',
    presetId: p.presetId ?? null,
    targetId: p.targetId ?? 'label-T40x20-320',
  };
}

/** 把 MinIO png_path / 任意可达 URL 转 base64 data URL(多模态 LLM 只吃 inline base64) */
async function pngPathToBase64(pngPath: string): Promise<string> {
  const bucket = process.env.MINIO_BUCKET || 'quote0-images';
  const endpoint = process.env.MINIO_ENDPOINT || 'minio';
  const port = process.env.MINIO_PORT || '9000';
  return imageUrlToBase64(`http://${endpoint}:${port}/${bucket}/${pngPath}`);
}

interface SessionVersion {
  versionNo: number;
  turnId: string;
  feedback: string | null;
  mode: string | null;
  kind: string;
  pngPath: string | null;
  srcUrl: string | null;
  refImageUrls: string[];
  state: string;
}

/**
 * 上下文工程规划器:看整棵版本树(含产物图)+ 用户新请求,产出 2-3 条「重生成路径」并推荐最优。
 * 核心是避免 GIGO —— 在已叠加多层 img2img 的脏版本上继续堆叠会累积漂移,
 * 因此 planner 可建议「从更干净的早期版本 fork 重开」+ 喂最小纯净上下文,而非一味全塞。
 * LLM 不可用 / 解析失败时降级为确定性双路径(当前叠加 + 从最早版干净重开)。
 */
async function planPaths(opts: {
  sessionId: string;
  focusedTurnId: string | null;
  feedback: string;
  userUploads: string[];
  fresh?: boolean;
  clarifications?: string[];
}): Promise<PlanResult> {
  const { sessionId, focusedTurnId, feedback, userUploads, fresh, clarifications } = opts;
  const db = getPostgresDatabase();
  const pool = db.getPool();

  // ---- 全 session 版本(按时间序,带产物图与状态) ----
  const vRes = await pool.query(
    `SELECT t.id, t.user_feedback, t.gen_mode, t.turn_kind, t.created_at, t.ref_image_urls,
            l.id AS l_id, l.png_path, l.source_image_url, j.state AS job_state
       FROM label_gen_turns t
       LEFT JOIN label_jobs j ON j.id = t.job_id
       LEFT JOIN labels l ON l.id = COALESCE(t.label_id, j.label_id)
      WHERE t.session_id = $1
      ORDER BY t.created_at ASC, t.id ASC`,
    [sessionId]
  );
  const versions: SessionVersion[] = vRes.rows.map((r: any, i: number) => ({
    versionNo: i + 1,
    turnId: r.id,
    feedback: r.user_feedback,
    mode: r.gen_mode,
    kind: r.turn_kind,
    pngPath: r.png_path,
    srcUrl: r.source_image_url,
    refImageUrls: Array.isArray(r.ref_image_urls) ? r.ref_image_urls : [],
    state: turnState(r.job_state, !!r.l_id),
  }));
  const focusedV =
    versions.find((v) => v.turnId === focusedTurnId) ?? versions[versions.length - 1];
  const byVersionNo = new Map(versions.map((v) => [v.versionNo, v]));

  // ---- 候选上下文池:全 session 去重产物原图 + 用户上传(语义标签) ----
  const seen = new Set<string>();
  const candidates: { url: string; label: string; source: 'history' | 'upload' | 'input' }[] = [];
  versions.forEach((v) => {
    if (v.srcUrl && !seen.has(v.srcUrl)) {
      seen.add(v.srcUrl);
      const tag = v.feedback ? `·${v.feedback.slice(0, 14)}` : v.kind === 'root' ? '·初始' : '';
      candidates.push({ url: v.srcUrl, label: `v${v.versionNo} 产物原图${tag}`, source: 'history' });
    }
  });
  // 用户输入/历史上传的参考图(各轮 ref_image_urls,如最初喂进去的输入照片)—— 以前漏扫,现纳入候选
  versions.forEach((v) => {
    v.refImageUrls.forEach((u) => {
      if (u && !seen.has(u)) {
        seen.add(u);
        candidates.push({ url: u, label: `🖼 输入参考图(v${v.versionNo})`, source: 'input' });
      }
    });
  });
  // 本轮显式 staged(上传框新图 + 参考图池勾选的现有图)—— 强制纳入,用户选了就一定用
  const stagedSet = new Set<string>();
  userUploads.forEach((u) => {
    if (!u) return;
    stagedSet.add(u);
    if (!seen.has(u)) {
      seen.add(u);
      candidates.push({ url: u, label: '你本轮选的参考图', source: 'upload' });
    }
  });

  const refsForPath = (urls: Set<string>): CandidateRef[] =>
    candidates.map((c) => ({ ...c, selected: urls.has(c.url) }));

  // ---- 启发式降级:全新起点(有上传图/fresh 时)+ 当前叠加 + 干净重开 ----
  const fallback = (): PlanResult => {
    const cleanV = versions.find((v) => v.srcUrl) ?? versions[0];
    const paths: PlanPath[] = [];
    // 全新起点(不继承现有版本)
    if (fresh || userUploads.length) {
      const mode: 'img2img' | 'rewrite' = userUploads.length ? 'img2img' : 'rewrite';
      paths.push({
        id: 'fresh',
        label: mode === 'img2img' ? '全新起点 · 只用你的图' : '全新起点 · 纯描述',
        recommended: !!fresh,
        strategy: 'fresh',
        baseTurnId: null,
        baseVersionNo: null,
        mode,
        prompt: feedback,
        promptZh: feedback,
        rationale: '不继承任何现有版本的像素/prompt,从你的图或描述全新起一棵树。',
        candidateRefs: refsForPath(new Set(userUploads)),
      });
    }
    // 当前叠加
    if (focusedV) {
      const base = focusedV;
      const mode: 'img2img' | 'rewrite' = base.srcUrl ? 'img2img' : 'rewrite';
      const sel = new Set<string>(userUploads);
      if (mode === 'img2img' && base.srcUrl) sel.add(base.srcUrl);
      paths.push({
        id: 'incremental',
        label: `当前叠加 · 基于 v${base.versionNo}`,
        recommended: false,
        strategy: 'incremental',
        baseTurnId: base.turnId,
        baseVersionNo: base.versionNo,
        mode,
        prompt: feedback,
        promptZh: feedback,
        rationale: '在你当前所在版本上微调,保留已有全部改动(可能叠加噪声)。',
        candidateRefs: refsForPath(sel),
      });
    }
    // 干净重开(若有比 focused 更早的干净版)
    if (cleanV && focusedV && cleanV.versionNo < focusedV.versionNo) {
      const sel = new Set<string>(userUploads);
      if (cleanV.srcUrl) sel.add(cleanV.srcUrl);
      paths.push({
        id: 'clean-restart',
        label: `干净重开 · 基于 v${cleanV.versionNo}`,
        recommended: false,
        strategy: 'clean-restart',
        baseTurnId: cleanV.turnId,
        baseVersionNo: cleanV.versionNo,
        mode: cleanV.srcUrl ? 'img2img' : 'rewrite',
        prompt: feedback,
        promptZh: feedback,
        rationale: '从更早、未叠加多层修改的干净版本重做,避免 GIGO。',
        candidateRefs: refsForPath(sel),
      });
    }
    if (paths.length && !paths.some((p) => p.recommended)) paths[0].recommended = true;
    return {
      kind: 'paths',
      reply: '（自动判断,未经 AI 规划)已列出可选路径,请选择。',
      reasoning: null,
      paths,
    };
  };

  let llmConfig;
  try {
    llmConfig = await getActiveLLMConfig(db);
  } catch {
    return fallback();
  }

  // ---- 版本表(文本)+ 候选池(文本)+ 各版产物图(最多 6 张供 VLM 判洁净度) ----
  const versionTable = versions
    .map(
      (v) =>
        `v${v.versionNo} [${v.kind}/${v.mode ?? '-'}] state=${v.state} hasBase=${
          v.srcUrl ? 'yes' : 'no'
        }${v.versionNo === focusedV?.versionNo ? ' <= 当前聚焦' : ''} feedback: ${
          v.feedback ? JSON.stringify(v.feedback) : '(none)'
        }`
    )
    .join('\n');
  const candList = candidates.map((c, i) => `[${i}] ${c.label} (${c.source})`).join('\n');

  const systemPrompt = `You are a requirement-clarifying planner for an iterative 1-bit thermal-label image editor.
The label evolved across versions (a tree, with images). Repeatedly stacking img2img on an already-edited version accumulates artifacts and drift — garbage-in-garbage-out. You are given the FULL history: every version's feedback + images, the user's ORIGINAL input image(s), and any prior clarifications. Read ALL of it to understand the user's LATEST-stage intent.

Given the user's LATEST request, choose ONE response kind:

A) "clarify" — ONLY when the request is genuinely AMBIGUOUS and you cannot confidently decide how to proceed (unclear which element to change, conflicting goals, several equally-plausible directions). Ask ONE short question and offer a FLEXIBLE number of concrete choices — between 2 and 5, exactly as many as the situation needs (NOT a fixed count). Never clarify when the request is already clear.

B) "paths" — when the request is clear enough to act. Propose a FLEXIBLE number of DISTINCT regeneration paths: give just 1 if the best action is obvious; give more ONLY when there are genuinely different worthwhile approaches. Do NOT pad to a fixed number, do NOT invent redundant variants. Each path:
  - baseVersion: which version number to fork from, OR 0 for a FRESH START (brand-new root, inherits NO existing pixels/prompt).
  - mode: "img2img" (preserve composition; needs a base image) or "rewrite" (regenerate from a fresh prompt).
  - useRefIndices: ADDITIONAL refs YOU choose for THIS path, kept MINIMAL (img2img on an existing base → include that base's own image; fresh → ONLY user-provided images source=upload/input, never an AI product). IMPORTANT — two distinct image roles: (1) EVERY image shown to you above is CONTEXT for understanding the evolution, NOT necessarily a generation ref. (2) Generation refs = images actually fed to the image model. Any candidate labeled "你本轮选的参考图" (source=upload) is a HARD ref the USER explicitly requires; it is ALWAYS sent regardless of your indices — do not bother listing it. When the user staged NO such pick, it is up to YOU to choose the right generation ref(s) via useRefIndices.
  - prompt: rewrite → full English prompt (<200 words, pure black&white, bold solid shapes, no gradients/grayscale), ALWAYS sent to the image model; img2img → concise English change instruction.
  - promptZh: Simplified Chinese summary (50-100 chars) of the SAME intent as "prompt", for human reading/editing. Must be present for every path.
  Strategy values you MAY use as appropriate (none mandatory): "incremental" (refine the focused version), "clean-restart" (fork an earlier cleaner version to dodge GIGO), "fresh" (baseVersion 0). Use ONLY the ones that genuinely apply to this request. Mark the single best path recommended:true.

Output ONLY a JSON object, no markdown fence:
{
  "kind": "clarify" | "paths",
  "reply": "一句简体中文总览(你的判断与理由)",
  "question": "(仅 kind=clarify)一句简体中文澄清问题",
  "choices": [ { "label": "简体中文选项", "description": "一句简体中文说明" } ],
  "paths": [ { "label": "简体中文标签", "recommended": true, "strategy": "incremental|clean-restart|fresh", "baseVersion": 0, "mode": "img2img|rewrite", "useRefIndices": [0], "prompt": "...", "promptZh": "...", "rationale": "一句简体中文取舍" } ]
}
(kind=clarify 时只填 question+choices(2-5 个);kind=paths 时只填 paths(1-N 个,按需))`;

  const content: VisionContentPart[] = [
    { type: 'text', text: `Version history (oldest first):\n${versionTable}` },
  ];
  // 实测(2026-06-14):张数不是问题 —— 50 张真实标签图(单张仅 ~2.7KB,共 180KB)仍 200 OK。
  // 之前的 400 根因被误判成「图片数硬上限」,真根因是【某张图解码失败拖垮整批】(代理 prepare image failed)。
  // 故上限放宽到 30(纯为控 token 成本,VLM 看图按 token 计费),并在下方对每张做 sharp 本地重编码剔坏图。
  // 理解层优先级:最新版 + 聚焦版 + 原始输入图 + 本轮 staged,再从新到旧补足;超出上限的版本靠全量文字版本表兜底。
  const latestV = versions[versions.length - 1];
  const MAX_IMAGES = 30;
  const seenImg = new Set<string>();
  const imgItems: { label: string; get: () => Promise<string> }[] = [];
  const addVer = (v?: SessionVersion) => {
    if (!v || !v.pngPath || seenImg.has(v.pngPath)) return;
    seenImg.add(v.pngPath);
    const tag = [
      v.versionNo === latestV?.versionNo ? 'latest' : '',
      v.versionNo === focusedV?.versionNo ? 'focused' : '',
    ]
      .filter(Boolean)
      .join(',');
    imgItems.push({
      label: `v${v.versionNo} image${tag ? ' (' + tag + ')' : ''}`,
      get: () => pngPathToBase64(v.pngPath!),
    });
  };
  addVer(latestV);
  addVer(focusedV);
  for (const c of candidates) {
    if (c.source !== 'input' || seenImg.has(c.url)) continue;
    seenImg.add(c.url);
    imgItems.push({ label: `${c.label} (user's original input)`, get: () => imageUrlToBase64(c.url) });
  }
  userUploads.forEach((u, i) => {
    if (seenImg.has(u)) return;
    seenImg.add(u);
    imgItems.push({ label: `staged reference #${i + 1}`, get: () => imageUrlToBase64(u) });
  });
  for (let i = versions.length - 1; i >= 0; i--) addVer(versions[i]); // 其余从新到旧补足
  for (const it of imgItems.slice(0, MAX_IMAGES)) {
    try {
      const raw = await it.get();
      const m = /^data:[^;]+;base64,(.+)$/.exec(raw);
      if (!m) continue;
      // 本地 sharp 重 decode→encode 成标准 PNG:坏图(损坏/异常格式)在本地就 throw → 跳过该张,
      // 绝不塞进请求 —— 否则代理对单张坏图会把【整批】判成 400 prepare image failed(静默降级根因)。
      const png = await sharp(Buffer.from(m[1], 'base64')).png().toBuffer();
      const safe = `data:image/png;base64,${png.toString('base64')}`;
      content.push({ type: 'text', text: `\n${it.label}:` });
      content.push({ type: 'image_url', image_url: { url: safe } });
    } catch {
      /* 取不到 / sharp 解不开(坏图)→ 跳过该张,不拖垮整批 */
    }
  }
  const clarifyBlock =
    clarifications && clarifications.length
      ? `\nAlready-resolved clarifications (do NOT ask these again; act on them):\n${clarifications
          .map((c, i) => `${i + 1}. ${c}`)
          .join('\n')}`
      : '';
  content.push({
    type: 'text',
    text: `\nAvailable reference images (choose by index, keep MINIMAL):\n${
      candList || '(none)'
    }\n\nCurrently focused version: ${
      focusedV ? 'v' + focusedV.versionNo : '(none, empty session)'
    }\nLatest version: ${latestV ? 'v' + latestV.versionNo : '(none)'}${
      fresh ? '\nThe user explicitly asked for a FRESH START — prefer a "fresh" path.' : ''
    }${clarifyBlock}\n\nUSER's LATEST request: "${feedback}"\n\nReturn the JSON now:`,
  });

  let parsed: any = null;
  let rawText = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const res = await multimodalLLMClient.chat(llmConfig, {
        systemPrompt,
        messages: [{ role: 'user', content }],
        maxTokens: 2000,
        temperature: 0.3,
      });
      rawText = res.text;
      parsed = parseLooseJson(res.text);
    } catch (e) {
      console.warn(`⚠️ planner 第 ${attempt + 1} 次调用/解析失败:`, e instanceof Error ? e.message : e);
      parsed = null;
    }
  }
  if (!parsed) {
    console.warn('⚠️ planner 两次都失败,降级启发式。raw 前 200 字:', rawText.slice(0, 200));
    return fallback();
  }

  // 澄清问答:VLM 觉得需求模糊,动态反问用户(选项数量灵活 2-5)
  if (
    parsed.kind === 'clarify' &&
    parsed.question &&
    Array.isArray(parsed.choices) &&
    parsed.choices.length
  ) {
    return {
      kind: 'clarify',
      reply:
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : '我需要先和你确认一下:',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : null,
      question: String(parsed.question).trim(),
      choices: parsed.choices.slice(0, 5).map((ch: any, i: number) => ({
        id: `c${i}`,
        label: typeof ch?.label === 'string' && ch.label.trim() ? ch.label.trim() : `选项 ${i + 1}`,
        description: typeof ch?.description === 'string' ? ch.description.trim() : '',
      })),
    };
  }

  if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) {
    console.warn('⚠️ planner 返回既非有效 clarify 也无 paths,降级。raw:', rawText.slice(0, 200));
    return fallback();
  }

  const paths: PlanPath[] = [];
  for (const p of parsed.paths.slice(0, 6)) {
    const wantsFresh = p.strategy === 'fresh' || Number(p.baseVersion) === 0;
    const bv = wantsFresh ? null : byVersionNo.get(Number(p.baseVersion));
    if (!wantsFresh && !bv) continue; // baseVersion 给了但无效 → 跳过(防误建)

    const picked = new Set<number>(
      Array.isArray(p.useRefIndices) ? p.useRefIndices.filter((n: any) => Number.isInteger(n)) : []
    );
    const sel = new Set<string>();
    candidates.forEach((c, i) => {
      if (picked.has(i)) sel.add(c.url);
    });

    let mode: 'img2img' | 'rewrite' = p.mode === 'rewrite' ? 'rewrite' : 'img2img';
    if (wantsFresh) {
      // 全新起点:只能用用户提供的图(input/upload),绝不纳入 AI 产物(history),避免血缘
      candidates.forEach((c) => {
        if (c.source === 'history') sel.delete(c.url);
      });
      // 用户本轮 staged 的非产物图强制纳入
      stagedSet.forEach((u) => {
        const c = candidates.find((x) => x.url === u);
        if (c && c.source !== 'history') sel.add(u);
      });
      const userImgs = candidates.filter((c) => c.source !== 'history');
      if (mode === 'img2img' && ![...sel].length && userImgs.length)
        userImgs.forEach((c) => sel.add(c.url));
      if (mode === 'img2img' && ![...sel].length) mode = 'rewrite'; // 没有可用用户图 → 纯文生图
    } else {
      // 用户本轮 staged 的图(参考图池勾选/上传)强制纳入,选了就一定用
      stagedSet.forEach((u) => sel.add(u));
      if (mode === 'img2img' && !bv!.srcUrl) mode = 'rewrite'; // 无底图不能图生图
      // img2img 至少要有一张底图:planner 没选就补上基准版自己的原图
      if (mode === 'img2img' && bv!.srcUrl && ![...sel].length) sel.add(bv!.srcUrl);
    }

    const prompt = typeof p.prompt === 'string' && p.prompt.trim() ? p.prompt.trim() : feedback;
    const promptZh = typeof p.promptZh === 'string' && p.promptZh.trim() ? p.promptZh.trim() : feedback;
    const strategy: PlanPath['strategy'] = wantsFresh
      ? 'fresh'
      : p.strategy === 'clean-restart'
        ? 'clean-restart'
        : 'incremental';
    const defaultLabel = wantsFresh
      ? mode === 'img2img'
        ? '全新起点 · 只用你的图'
        : '全新起点 · 纯描述'
      : `${strategy === 'clean-restart' ? '干净重开' : '当前叠加'} · 基于 v${bv!.versionNo}`;
    paths.push({
      id: `${strategy}-${wantsFresh ? 'fresh' : 'v' + bv!.versionNo}-${paths.length}`,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : defaultLabel,
      recommended: !!p.recommended,
      strategy,
      baseTurnId: wantsFresh ? null : bv!.turnId,
      baseVersionNo: wantsFresh ? null : bv!.versionNo,
      mode,
      prompt,
      promptZh,
      rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
      candidateRefs: refsForPath(sel),
    });
  }
  if (paths.length === 0) return fallback();
  // 兜底:无论 planner 是否主动给,总附加一条「全新起点」路径 —— 作为用户主动另起新树的稳定入口
  // (前端已去掉独立的「全新起点」按钮,改由这里保证每次规划的多方案里都含此选项)。
  if (!paths.some((p) => p.strategy === 'fresh' || !p.baseTurnId)) {
    const hasUserImg = userUploads.length > 0;
    paths.push({
      id: `fresh-always-${paths.length}`,
      label: hasUserImg ? '全新起点 · 只用你的图' : '全新起点 · 纯描述',
      recommended: false,
      strategy: 'fresh',
      baseTurnId: null,
      baseVersionNo: null,
      mode: hasUserImg ? 'img2img' : 'rewrite',
      prompt: feedback,
      promptZh: feedback,
      rationale: '不继承任何现有版本的像素/prompt,从你的图或纯描述全新起一棵树。',
      candidateRefs: refsForPath(new Set(userUploads)),
    });
  }
  if (!paths.some((p) => p.recommended)) paths[0].recommended = true;

  return {
    kind: 'paths',
    reply:
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : '已为你规划好重生成路径,请选择。',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : null,
    paths,
  };
}

/** 容错解析 LLM 返回的 JSON(剥 markdown 围栏、取第一个 {...}) */
function parseLooseJson(text: string): any {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** 中译英：用户编辑的中文 prompt → 生图友好的英文 prompt（+ 回填规范化中文）。 */
async function translatePromptZhToEn(promptZh: string): Promise<{ prompt: string; promptZh: string }> {
  const db = getPostgresDatabase();
  const llmConfig = await getActiveLLMConfig(db);
  const systemPrompt = `You are an expert image-generation prompt engineer for 1-bit thermal label printing.
The user wrote/edited a prompt in Simplified Chinese. Translate and refine it into a model-friendly English prompt, preserving the user's intent EXACTLY — do not add, remove, or invent subjects.
Rules:
1. Output ONLY a JSON object, no markdown fence:
   {"prompt":"<English prompt under 200 words, pure black&white, bold solid shapes, no gradients/grayscale>","promptZh":"<the user's Chinese intent cleaned up, 50-100 chars>"}
2. "prompt" is sent directly to the image-generation model, so keep it model-friendly English.
3. "promptZh" is shown back to the human; keep it faithful to the user's input.`;
  const content: VisionContentPart[] = [
    { type: 'text', text: `User's Chinese prompt: "${promptZh}"\n\nWrite the English image-generation prompt now:` },
  ];
  const res = await multimodalLLMClient.chat(llmConfig, {
    systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: 800,
    temperature: 0.3,
  });
  try {
    const parsed = JSON.parse(res.text.trim());
    const prompt = typeof parsed.prompt === 'string' && parsed.prompt.trim() ? parsed.prompt.trim() : res.text.trim();
    const outZh = typeof parsed.promptZh === 'string' && parsed.promptZh.trim() ? parsed.promptZh.trim() : promptZh;
    return { prompt, promptZh: outZh };
  } catch {
    return { prompt: res.text.trim(), promptZh };
  }
}

/** rewrite 模式(旧式直发路径):多模态 LLM 看父版本图 + 父 prompt + 祖先 feedback 链,重写新 prompt */
async function rewritePromptViaLLM(
  parent: { id: string; effective_prompt: string | null; png_path: string | null },
  feedback: string
): Promise<{ prompt: string; promptZh: string }> {
  const db = getPostgresDatabase();
  const llmConfig = await getActiveLLMConfig(db);

  // 祖先 feedback 链(最多取最近 5 条,旧→新)
  const chainRes = await db.getPool().query(
    `WITH RECURSIVE chain AS (
       SELECT t.id, t.parent_turn_id, t.user_feedback, 0 AS depth
         FROM label_gen_turns t WHERE t.id = $1
       UNION ALL
       SELECT p.id, p.parent_turn_id, p.user_feedback, c.depth + 1
         FROM label_gen_turns p JOIN chain c ON p.id = c.parent_turn_id
        WHERE c.depth < 10
     )
     SELECT user_feedback FROM chain WHERE user_feedback IS NOT NULL ORDER BY depth DESC`,
    [parent.id]
  );
  const history: string[] = chainRes.rows.map((r: any) => r.user_feedback).slice(-5);

  const systemPrompt = `You are an expert image-generation prompt engineer for 1-bit thermal label printing.
Given the CURRENT prompt (and optionally the image it produced), plus the user's adjustment request,
write a NEW prompt pair that keeps everything the user did not ask to change and applies the requested adjustment.
Rules:
1. Output ONLY a JSON object, no markdown fence:
   {"prompt":"<English prompt under 200 words, pure black&white, bold solid shapes, no gradients/grayscale>","promptZh":"<Simplified Chinese 50-100 chars, same intent, for human reading/editing>"}
2. "prompt" is sent directly to the image-generation model, so keep it model-friendly English.
3. "promptZh" is shown to the human user; it must express the same intent as "prompt" in concise Simplified Chinese.`;

  const content: VisionContentPart[] = [
    { type: 'text', text: `CURRENT prompt: "${parent.effective_prompt ?? '(unknown)'}"` },
  ];
  if (parent.png_path) {
    try {
      const b64 = await pngPathToBase64(parent.png_path);
      content.push({ type: 'text', text: '\nImage produced by the current prompt:' });
      content.push({ type: 'image_url', image_url: { url: b64 } });
    } catch {
      // 拿不到图就纯文本重写
    }
  }
  if (history.length > 0) {
    content.push({
      type: 'text',
      text: `\nEarlier adjustment history (oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
    });
  }
  content.push({
    type: 'text',
    text: `\nUSER's new adjustment request: "${feedback}"\n\nWrite the new image-generation prompt now:`,
  });

  const res = await multimodalLLMClient.chat(llmConfig, {
    systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: 800,
    temperature: 0.4,
  });
  try {
    const parsed = JSON.parse(res.text.trim());
    const prompt = typeof parsed.prompt === 'string' && parsed.prompt.trim() ? parsed.prompt.trim() : res.text.trim();
    const promptZh = typeof parsed.promptZh === 'string' && parsed.promptZh.trim() ? parsed.promptZh.trim() : feedback;
    return { prompt, promptZh };
  } catch {
    return { prompt: res.text.trim(), promptZh: feedback };
  }
}

export default labelSessionsApp;
