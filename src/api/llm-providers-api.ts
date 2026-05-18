import { Hono } from 'hono';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { invalidateLLMConfigCache } from '../react-widgets/core/llm-config.js';

const app = new Hono();
const postgres = getPostgresDatabase();

// 辅助：检查 active 引用
async function isProviderActive(providerId: number): Promise<boolean> {
  const r = await postgres.getPool().query(
    'SELECT 1 FROM llm_active_setting WHERE active_provider_id = $1',
    [providerId]
  );
  return r.rows.length > 0;
}

async function isModelActive(modelId: number): Promise<boolean> {
  const r = await postgres.getPool().query(
    'SELECT 1 FROM llm_active_setting WHERE active_model_id = $1',
    [modelId]
  );
  return r.rows.length > 0;
}

// GET /api/llm/providers
app.get('/api/llm/providers', async (c) => {
  try {
    const providersResult = await postgres.getPool().query(
      'SELECT * FROM llm_providers ORDER BY created_at DESC'
    );
    const modelsResult = await postgres.getPool().query(
      'SELECT * FROM llm_models ORDER BY created_at DESC'
    );
    const providers = providersResult.rows.map((p: any) => ({
      ...p,
      models: modelsResult.rows.filter((m: any) => m.provider_id === p.id),
    }));
    return c.json({ success: true, data: providers });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /api/llm/providers
app.post('/api/llm/providers', async (c) => {
  try {
    const body = await c.req.json();
    const { slug, display_name, base_url, api_key, api_type = 'openai-completions', enabled = true } = body;
    if (!slug || !display_name || !base_url || !api_key) {
      return c.json({ success: false, error: '缺少必填字段' }, 400);
    }
    const result = await postgres.getPool().query(
      `INSERT INTO llm_providers (slug, display_name, base_url, api_key, api_type, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [slug, display_name, base_url, api_key, api_type, enabled]
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// PUT /api/llm/providers/:id
app.put('/api/llm/providers/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json();
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const key of ['slug', 'display_name', 'base_url', 'api_key', 'api_type', 'enabled']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(body[key]);
      }
    }
    if (fields.length === 0) {
      return c.json({ success: false, error: '无更新字段' }, 400);
    }
    values.push(id);
    const result = await postgres.getPool().query(
      `UPDATE llm_providers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'Provider 不存在' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /api/llm/providers/:id
app.delete('/api/llm/providers/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (await isProviderActive(id)) {
      return c.json({ success: false, error: '该 provider 当前处于激活状态，无法删除' }, 400);
    }
    await postgres.getPool().query('DELETE FROM llm_providers WHERE id = $1', [id]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /api/llm/providers/:id/models
app.post('/api/llm/providers/:id/models', async (c) => {
  try {
    const providerId = parseInt(c.req.param('id'), 10);
    const body = await c.req.json();
    const { model_id, display_name, context_window, max_tokens, reasoning, enabled = true } = body;
    if (!model_id || !display_name) {
      return c.json({ success: false, error: '缺少必填字段' }, 400);
    }
    const result = await postgres.getPool().query(
      `INSERT INTO llm_models (provider_id, model_id, display_name, context_window, max_tokens, reasoning, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [providerId, model_id, display_name, context_window, max_tokens, reasoning, enabled]
    );
    return c.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// PUT /api/llm/providers/:pid/models/:mid
app.put('/api/llm/providers/:pid/models/:mid', async (c) => {
  try {
    const providerId = parseInt(c.req.param('pid'), 10);
    const modelId = parseInt(c.req.param('mid'), 10);
    const body = await c.req.json();
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const key of ['model_id', 'display_name', 'context_window', 'max_tokens', 'reasoning', 'enabled']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(body[key]);
      }
    }
    if (fields.length === 0) {
      return c.json({ success: false, error: '无更新字段' }, 400);
    }
    values.push(providerId);
    values.push(modelId);
    const result = await postgres.getPool().query(
      `UPDATE llm_models SET ${fields.join(', ')} WHERE provider_id = $${idx} AND id = $${idx + 1} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: 'Model 不存在' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /api/llm/providers/:pid/models/:mid
app.delete('/api/llm/providers/:pid/models/:mid', async (c) => {
  try {
    const modelId = parseInt(c.req.param('mid'), 10);
    if (await isModelActive(modelId)) {
      return c.json({ success: false, error: '该 model 当前处于激活状态，无法删除' }, 400);
    }
    await postgres.getPool().query('DELETE FROM llm_models WHERE id = $1', [modelId]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /api/llm/active
app.get('/api/llm/active', async (c) => {
  try {
    const result = await postgres.getPool().query(`
      SELECT s.active_provider_id, s.active_model_id, p.slug as provider_slug, m.model_id as model_id_str
      FROM llm_active_setting s
      LEFT JOIN llm_providers p ON p.id = s.active_provider_id
      LEFT JOIN llm_models m ON m.id = s.active_model_id
      WHERE s.id = 1
    `);
    if (result.rows.length === 0) {
      return c.json({ success: true, data: null });
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /api/llm/active
app.post('/api/llm/active', async (c) => {
  try {
    const body = await c.req.json();
    const { provider_id, model_id } = body;
    if (!provider_id || !model_id) {
      return c.json({ success: false, error: '缺少 provider_id 或 model_id' }, 400);
    }
    await postgres.getPool().query(
      `INSERT INTO llm_active_setting (id, active_provider_id, active_model_id)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET active_provider_id = $1, active_model_id = $2, updated_at = CURRENT_TIMESTAMP`,
      [provider_id, model_id]
    );
    invalidateLLMConfigCache();
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /api/llm/test
app.post('/api/llm/test', async (c) => {
  try {
    const body = await c.req.json();
    const { provider_id, model_id } = body;
    if (!provider_id || !model_id) {
      return c.json({ success: false, error: '缺少 provider_id 或 model_id' }, 400);
    }

    const providerResult = await postgres.getPool().query(
      'SELECT * FROM llm_providers WHERE id = $1',
      [provider_id]
    );
    const modelResult = await postgres.getPool().query(
      'SELECT * FROM llm_models WHERE id = $1',
      [model_id]
    );
    if (providerResult.rows.length === 0 || modelResult.rows.length === 0) {
      return c.json({ success: false, error: 'Provider 或 Model 不存在' }, 404);
    }

    const provider = providerResult.rows[0];
    const model = modelResult.rows[0];

    const { OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: provider.api_key, baseURL: provider.base_url });

    const start = Date.now();
    let responseText = '';
    try {
      const completion = await client.chat.completions.create({
        model: model.model_id,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      });
      responseText = completion.choices[0]?.message?.content || '';
      const latency = Date.now() - start;
      return c.json({ success: true, latency_ms: latency, response: responseText });
    } catch (err: any) {
      const latency = Date.now() - start;
      return c.json({ success: false, latency_ms: latency, response: '', error: err.message });
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /api/llm/catalog —— enabled provider+model 合并扁平列表（v1.4.4 ModelSelector 用）
app.get('/api/llm/catalog', async (c) => {
  try {
    const result = await postgres.getPool().query(`
      SELECT
        p.id AS provider_id, p.slug AS provider_slug, p.display_name AS provider_display_name,
        p.api_type, m.id AS model_db_id, m.model_id, m.display_name AS model_display_name,
        m.context_window, m.max_tokens, m.reasoning
      FROM llm_models m
      JOIN llm_providers p ON p.id = m.provider_id
      WHERE p.enabled = true AND m.enabled = true
      ORDER BY p.id, m.id
    `);
    return c.json({
      success: true,
      models: result.rows.map((r) => ({
        providerId: r.provider_id,
        providerSlug: r.provider_slug,
        providerDisplayName: r.provider_display_name,
        modelDbId: r.model_db_id,
        modelId: r.model_id,
        modelDisplayName: r.model_display_name,
        contextWindow: r.context_window,
        maxTokens: r.max_tokens,
        reasoning: r.reasoning,
      })),
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export { app as llmProvidersApp };
