# 标签批量管理（Label Batch）施工 Spec

> 目标：在**完全不改动现有单条标签生成管线**的前提下，新增一个「批次管理层」，
> 用来把一批盲盒系列名批量过 `generate-image`，并提供小批量试跑 / 调提示词 / 重试 / 大批量放量 / 审查打印。
>
> 设计原则一句话：**batch 只增加「管理能力」，生成路径 100% 复用现有 endpoint。**

---

## 0. 绝对边界（违反即返工）

**禁止改动以下文件/逻辑**（生成管线，原样复用）：
- `src/api/label-jobs-worker.ts`（worker、租约、重试、结果写回）—— 一行都不动
- `src/react-widgets/services/image-label-generator.ts` / `prompt-orchestrator.ts` / `text-label-generator.ts`
- `labels` 表、`label_jobs` 表、`image_presets` 表的现有列与 CHECK 约束 —— **零 ALTER**

batch 层只做三件事，全部架在现有契约上：
1. **放量** = 把每个 item 渲染成 prompt → 走现有 enqueue 契约（INSERT `label_jobs`，与 `generate-image` 完全一致）。
2. **审查** = 用记下的 `job_id` join `label_jobs` 拿状态、join `labels` 拿 `pngUrl`。
3. **批量动作**（重试 / 审批 / 打印）= 循环调现有 per-label 逻辑。

---

## 1. 数据模型（2 张新表，放进 `getCreateTablesSQL()`）

位置：`src/react-widgets/core/postgres-database.ts` 的 `getCreateTablesSQL()` 返回串里，
追加在 `labels` 表定义之后（约 line 782 之前）。**用 `CREATE TABLE IF NOT EXISTS`，启动幂等自动建。不要写任何 ALTER。**

```sql
CREATE TABLE IF NOT EXISTS label_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  generator       text NOT NULL DEFAULT 'image'
                  CHECK (generator IN ('image','widget','svg')),
  model           text,                          -- image: sd5 / sd5-3k / nb2 / nbp / gpt2
  preset_id       uuid REFERENCES image_presets(id) ON DELETE SET NULL,
  target_id       text NOT NULL DEFAULT 'label-T40x20-320',
  prompt_template text NOT NULL,                 -- 含 {{name}} 占位符
  template_rev    int  NOT NULL DEFAULT 1,       -- 每次改模板 +1，驱动幂等键
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','running','review','done','archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS label_batch_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid NOT NULL REFERENCES label_batches(id) ON DELETE CASCADE,
  idx            int  NOT NULL,                  -- 批内顺序（试跑取前 N 用）
  name           text NOT NULL,                  -- 系列名，模板 {{name}} 的值
  vars           jsonb,                          -- 可选结构化变量 {year, ip, ...}，模板可引用
  ref_image_urls jsonb,                          -- 可选 per-item 参考图（图生图）
  job_id         uuid,                           -- 最近一次入队的 label_jobs.id
  label_id       uuid REFERENCES labels(id) ON DELETE SET NULL,  -- 当前产出（job 成功后回填）
  review         text NOT NULL DEFAULT 'pending'
                 CHECK (review IN ('pending','approved','rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, idx)
);

CREATE INDEX IF NOT EXISTS label_batch_items_batch_idx ON label_batch_items(batch_id);
```

> `extractRequiredTableNames()` 会自动从 `CREATE TABLE IF NOT EXISTS` 抓表名进健康白名单，无需手动改白名单。

---

## 2. 复用接缝：抽一个 enqueue helper（唯一对 labels-api 的小改）

新建 `src/react-widgets/core/label-job-queue.ts`：

```ts
import { getPostgresDatabase } from './postgres-database.js';

export interface EnqueueResult {
  jobId: string; state: string; createdAt: Date; deduped: boolean;
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
```

然后把 `labels-api.ts` 里 `/generate-image`、`/generate-text` 两处的「idempotency 查重 + INSERT label_jobs」替换成调用 `enqueueLabelJob()`（行为完全等价，仅去重）。
**这是唯一对现有 api 的改动，且不碰生成逻辑本身。** 若想更保守，batch 也可直接复制那段 INSERT（与 `labels-api.ts:178-194` 完全一致），但推荐抽 helper 防漂移。

模板渲染 helper（同文件或单独放）：

```ts
/** {{key}} → vars[key]，缺失变量替空串 */
export function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '').toString());
}
```

---

## 3. 后端接口（新建 `src/api/label-batches-api.ts`，挂 `/api/label-batches`）

挂载：`src/api/news-api-server.ts` 第 292 行 `app.route('/api/labels', labelsApp)` 旁加：
```ts
import labelBatchesApp from './label-batches-api.js';
app.route('/api/label-batches', labelBatchesApp);
```

### 3.1 `POST /api/label-batches` — 创建批次
```
body: {
  name: string,
  generator?: 'image',                 // 默认 'image'
  model: 'sd5'|'sd5-3k'|'nb2'|'nbp'|'gpt2',
  presetId?: string,                   // image_presets.id；不传/'none' 走系统热敏默认
  targetId?: string,
  promptTemplate: string,              // 含 {{name}}
  items: Array<{ name: string, vars?: object, refImageUrls?: string[] }>
}
→ 事务：INSERT label_batches（status='draft', template_rev=1）
       + 批量 INSERT label_batch_items（idx 按数组顺序 0..N-1）
返回 { success, id }
```

### 3.2 `GET /api/label-batches` — 列表（带进度）
对每个 batch 聚合 items 状态计数：
```sql
SELECT b.*, 
  count(i.*) FILTER (WHERE i.label_id IS NOT NULL) AS done,
  count(i.*) AS total
FROM label_batches b LEFT JOIN label_batch_items i ON i.batch_id=b.id
WHERE b.status != 'archived' GROUP BY b.id ORDER BY b.created_at DESC
```
返回 `[{ id, name, status, counts:{total,done,...}, createdAt }]`

### 3.3 `GET /api/label-batches/:id` — 详情（前端主轮询入口）
一次 join 把每个 item 的实时状态解出来：
```sql
SELECT i.*, j.state AS job_state, j.last_error,
       l.png_path, l.status AS label_status, l.updated_at AS label_updated_at
FROM label_batch_items i
LEFT JOIN label_jobs j ON j.id = i.job_id
LEFT JOIN labels    l ON l.id = COALESCE(i.label_id, j.label_id)
WHERE i.batch_id = $1 ORDER BY i.idx ASC
```
- **回填**：对 `j.state='succeeded' AND i.label_id IS NULL` 的行，`UPDATE label_batch_items SET label_id=j.label_id`（让后续 print/approve 直接用 label_id，不再依赖 job）。
- 返回结构：
```
{ batch: {...}, items: [{
    id, idx, name, review,
    state: 'pending'|'running'|'succeeded'|'failed',   // 由 job_state 推导；无 job_id → 'pending'
    lastError,
    label: { id, pngUrl, status } | null              // pngUrl = `/api/minio-proxy/${png_path}`
}]}
```

### 3.4 `PATCH /api/label-batches/:id` — 改配置（调提示词）
可改 `name / model / presetId / targetId / promptTemplate`。
**若 `promptTemplate` 变化 → `template_rev = template_rev + 1`**（保证下次 run 是新幂等键、会真正重生成）。

### 3.5 `POST /api/label-batches/:id/run` — 放量（核心）
```
body: { scope: 'sample' | 'all' | { itemIds: string[] }, sampleSize?: number=3 }
```
解析目标 items：
- `sample` → 按 idx 升序、`label_id IS NULL` 的前 `sampleSize` 个
- `all`    → 所有 `label_id IS NULL`（已成功的不重复烧）
- `itemIds`→ 显式指定

对每个目标 item：
```ts
const prompt = renderTemplate(batch.prompt_template, { name: item.name, ...(item.vars ?? {}) });
const { jobId } = await enqueueLabelJob({
  jobType: 'image',
  clientRequestId: `batch:${batch.id}:item:${item.id}:rev${batch.template_rev}`,  // 幂等
  payload: {
    prompt,
    model: batch.model,
    targetId: batch.target_id,
    presetId: batch.preset_id ?? undefined,        // undefined → worker 用系统热敏默认
    refImageUrls: item.ref_image_urls ?? [],
    tags: [`batch:${batch.id}`, `item:${item.id}`], // 可按分组捞回
  },
});
await db.query(`UPDATE label_batch_items SET job_id=$1, label_id=NULL, updated_at=now() WHERE id=$2`, [jobId, item.id]);
```
最后 `UPDATE label_batches SET status='running'`。返回每个 item 的 jobId。

> **大批量吞吐**：worker 现状每 5s 领 1 个 job（`label-jobs-worker.ts` TICK_MS）。这是**现有管线的独立调优项**，与本 spec 解耦；若放量后觉得慢，再单独把 worker 改成「单 tick 并发领 N 个」。**本期不要动 worker。**

### 3.6 `POST /api/label-batches/:id/retry` — 重试
```
body: { scope: 'failed' | { itemIds: string[] } }
```
`failed` = job_state='failed' 或（有 job 但无 label）的 items。
重试**用 `clientRequestId: null`（全新 job，不走幂等）**，逻辑同 run 的入队，更新 `job_id`。
（job 级 3 次自动重试 worker 已自带；这里是耗尽后的人工再试。）

### 3.7 `POST /api/label-batches/:id/items/:itemId/review` — 单条审批
```
body: { review: 'approved' | 'rejected' }
→ UPDATE label_batch_items SET review=$1
（rejected 可选：同时软删除其 label，复用 DELETE /api/labels/:id 逻辑；本期可不做）
```

### 3.8 `POST /api/label-batches/:id/print` — 批量打印
```
body: { scope: 'approved' | { itemIds }, niimbotEndpoint?: string }
```
取目标 items 中有 `label_id` 的，**逐个复用现有打印逻辑**（抽 `labels-api.ts` 的 `/:id/print` 核心为 `printLabel(id, endpoint)` helper，或在 batch 内顺序 fetch 调 `/api/labels/:id/print`）。打印是物理串行，顺序执行即可。
全部 approved 打印完 → `UPDATE label_batches SET status='done'`。

---

## 4. 前端（label-web）

### 4.1 新增文件
- `src/types/batch.ts` — `LabelBatch`、`LabelBatchItem`、`BatchItemState` 等（字段对齐 §3.3 返回）。
- `src/api/batches.ts` — `batchesApi`：`create / list / get / patch / run / retry / review / print`（仿 `src/api/labels.ts` 的 axios 封装风格）。
- `src/pages/BatchListPage.tsx` — 批次卡片列表 + 进度条 + 「新建批次」按钮。
- `src/pages/BatchCreatePage.tsx`（或弹窗）— 表单：name、model `<Select>`、风格预设 `<StylePresetGrid>`(复用)、模板 `<Textarea>`（占位提示 `用 {{name}} 引用系列名`）、items `<Textarea>`（每行一个系列名，提交时按 `\n` split→去空行→映射成 `items[]`）。
- `src/pages/BatchDetailPage.tsx` — 见 §4.2。

### 4.2 BatchDetailPage 布局
- **顶部条**：可编辑模板 `<Textarea>` + model/preset 选择器（复用 `LlmModelSelector` 思路 + `StylePresetGrid`）+ 按钮 `[试运行前3] [放量运行] [重试失败]` + 进度计数（done/failed/pending/running）。改模板后点保存 → `PATCH`（template_rev 自增）。
- **网格**：复用 `LabelCard` 平铺每个 item；
  - item 有 `label` → 正常渲染 PNG；
  - `state='pending'/'running'` → loading 态；`state='failed'` → 失败态 + `lastError` tooltip。
  - 每卡操作：`重新生成`（调 `/labels/:id/regenerate` 复用）、`通过`/`打回`（调 review）。
  - **新增**多选 checkbox（现有 `LabelCard` 无多选，需加一个 `selectable` + `onSelect` prop，或包一层 wrapper）。
- **底部批量操作条**（新增组件 `BatchActionBar`）：全选 / 重试失败 / 批量审批 / 批量打印。
- **轮询**：`status==='running'` 时 React Query `refetchInterval: 2000` 拉 `GET /api/label-batches/:id`（一次拿全部 item 状态，替代 N 次 job 轮询）。

### 4.3 路由 & 导航（`src/App.tsx`）
```tsx
import BatchListPage from '@/pages/BatchListPage';
import BatchDetailPage from '@/pages/BatchDetailPage';
import { Layers } from 'lucide-react';
// 导航加： <NavLink to="/batches" icon={<Layers className="h-4 w-4" />} label="批量" />
// 路由加： <Route path="/batches" element={<BatchListPage />} />
//          <Route path="/batches/:id" element={<BatchDetailPage />} />
```

### 4.4 复用组件清单
`LabelCard` · `StatusBadge` · `StylePresetGrid` · `LlmModelSelector` · `RefImageUploader`（per-item 参考图，可选）· `AlertDialog`（打印/重试确认）。

---

## 5. 用户工作流（验收时照此走一遍）

1. 新建批次「潮流玩具盲盒分类标签」，粘贴 22 行系列名，模板写 `{{name}}`，选 model + 热敏预设 → 创建。
2. **试运行前 3** → 看网格出图 → 不满意 → 改模板/换预设（template_rev+1）→ **重试这 3 个** → 满意。
3. **放量运行** → 剩余 19 个入队，网格陆续出图。
4. 失败的点 **重试失败**；丑的单卡 **重新生成**；好的 **通过**。
5. 多选 approved → **批量打印** 到 niimbot。

---

## 6. 验收清单（必须逐条跑）

1. **构建**：`bun run build`（或 tsc）通过；`git diff` 确认 `label-jobs-worker.ts` / `image-label-generator.ts` / `prompt-orchestrator.ts` **零改动**。
2. **建表**：重启 API（触发 `initialize()`）→ `\dt` 确认 `label_batches`、`label_batch_items` 已建；确认对 `labels`/`label_jobs` **无任何 ALTER**。
3. **端到端**：curl 创建 3 item 批次 → `run scope=sample` → 轮询 `GET /:id` 直到 items 出 `label.pngUrl` → 浏览器打开 pngUrl 确认是 1-bit 热敏图。
4. **幂等**：同 template_rev 重复 `run sample` → `label_jobs` 不新增重复行（deduped）。
5. **重试**：`retry scope=failed` → 产生**新** job（clientRequestId=null）→ 最终出图。
6. **打印**：`print scope=approved` → 复用现有 print，对应 label `print_count` 自增、`status='printed'`。
7. **前端**：导航「批量」→ 新建 → 试跑 → 网格 → 多选 → 批量审批 → 批量打印，全程无报错。

---

## 7. 给 Kimi 的提示词必塞要点

- 严格遵守 §0 边界：**不改生成管线**（worker / generators / 现有表结构）。
- 新表只进 `getCreateTablesSQL()`（启动幂等自动建）；**本期不需要任何 ALTER**，故不碰 `getMigrationStatements()`；若你发现非加列不可，必须放进 `getMigrationStatements()` 数组（那里才会每次启动执行）。
- 复用 enqueue：抽 `enqueueLabelJob()`，让 generate-image/generate-text 也走它（去重逻辑等价替换，不改 payload 形状）。
- 幂等键规则：初次 run 用 `batch:{bid}:item:{iid}:rev{rev}`；retry 用 `null`。
- tags 注入 `['batch:'+bid, 'item:'+iid]`。
- 前端尽量拼现有组件，只新写 3 页 + 1 个 ActionBar + 给 LabelCard 加多选 prop。
