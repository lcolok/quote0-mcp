# 推送策略与运行日志优化方案（草案）

> 编写日期：2025-10-12

## 目标

1. **持续推送**：即便在 RSS 暂无新内容时，也能保证轮播不断电。
2. **优先新鲜度**：有最新文章时应优先推送，避免被复播淹没。
3. **调优友好**：所有影响策略的参数可配置、可观察、可调试。
4. **全景记录**：调度过程的每一步都可追溯，便于分析与复盘。
5. **展示清晰**：前端明确呈现“推送时间 / 来源发布时间”，避免对时间线的误解。

## 一、推送策略引擎升级

### 1. 分层过滤（命中层级）

| 层级 | 说明 | 推荐参数（可调） |
| ---- | ---- | ---------------- |
| **严格层** | 优先最新候选 | `cooldownHoursStrict = 6`、`maxPushCountStrict = 3`、`recentFingerprintsLimitStrict = 10` |
| **宽松层** | 放宽阈值 | `cooldownHoursRelaxed = 3`、`maxPushCountRelaxed = 6`、`recentFingerprintsLimitRelaxed = 5` |
| **复播层** | 兜底复播轮播顺序 | `fallbackRepeatLimit = 2`、允许直接顺序复播 |

分层逻辑执行流程：

1. `selectCandidateStrict()`
   - 满足冷却、推送次数、最近去重条件 → 直接推送。
2. `selectCandidateRelaxed()`
   - 放宽次数 & 去重长度，只保留冷却条件 → 命中则推送。
3. `fallbackCandidate()`
   - 按轮播顺序直接拿下一篇（标记为复播）。
   - 仍需更新 `push_count`、`recentFingerprints`，避免立刻重复。

若某层为空，需在运行日志中记录“原因”（cooldown 超时、次数上限等），供后续分析。

### 2. 源轮换与失败处理

* 每次成功推送后轮换至下一 RSS 源。
* 对每个源维护 `failureCount`：
  - 若在严格层 + 宽松层连续失败 ≥ `sourceFailureSkipThreshold`（建议 3），则暂时跳过该源一个周期。
* 复播层的成功也视为一次成功推送，用于重置 `failureCount`。

### 3. 最近指纹去重

* 将 `recentFingerprints` 长度设为可配置（建议默认 10），用于“最近不重复”。
* 复播层仍需写入 `recentFingerprints`，但可开启“宽松窗口”——若长度超出则自动截断。

### 4. 推送状态持久化

`news_scheduler_jobs.state` 内保存：

```json
{
  "nextIndex": 12,
  "lastIndex": 11,
  "shuffledOrder": [5, 2, 8, ...],
  "shuffledPointer": 3,
  "recentFingerprints": ["abc", "def", ...],
  "failureCount": {
    "36kr": 0,
    "hackernews": 2
  }
}
```

## 二、全景运行日志方案

### 1. 新增 `scheduler_run_history` 表

```sql
CREATE TABLE scheduler_run_history (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  run_started_at TIMESTAMPTZ NOT NULL,
  run_finished_at TIMESTAMPTZ,
  source TEXT,
  layer TEXT,                      -- strict / relaxed / fallback
  candidate_id BIGINT,
  candidate_fingerprint TEXT,
  candidate_publish_time TIMESTAMPTZ,
  candidate_process_time TIMESTAMPTZ,
  push_time TIMESTAMPTZ,
  push_status TEXT,                -- success / skipped / failed
  push_reason TEXT,                -- 准确描述过滤/失败原因
  push_count_before INTEGER,
  push_count_after INTEGER,
  cooling_elapsed INTERVAL,
  metadata JSONB
);
```

### 2. 记录策略执行过程

* 每跑一个候选就写一条日志：
  - `layer`、`push_reason`（如 `cooldown`, `recent`, `maxPushCount`, `fallback` 等）
  - 该候选的 `publish_time`、`process_time`（来自 `processNews()`）
  - 推送前后的 `push_count`、距上次推送的间隔。
* 成功或失败后更新 `push_status` / `push_reason`。

### 3. `news_push_log` 补充字段

新增：

* `layer`：记录命中层级。
* `is_fallback`：是否复播。
* `strategy_snapshot`：推送时策略参数的 JSON 快照（用于后续调参回放）。

### 4. API 扩展

* `/api/scheduler/push-history?includeRunMeta=true` → 附带最近运行日志。
* `/api/scheduler/metrics` → 汇总展示：层级命中率、平均冷却、复播次数等。

## 三、前端展示调整

1. 在列表与详情中并列呈现：
   - **推送时间（CST）**
   - **来源发布时间（RSS，CST 显示）**
2. 增加“调度日志”视图：列出最近 N 次运行的 `layer`、`push_reason`、候选来源、推送耗时等。
3. badge 标记：
   - `新品`（严格层命中）
   - `复播`（fallback 层命中）
4. 可视化（后续）：柱状图/折线图展示每日各层命中数、平均延迟。

## 四、策略参数配置化

新增配置文件（例如 `config/scheduler-strategy.json`）：

```json
{
  "cooldownHoursStrict": 6,
  "maxPushCountStrict": 3,
  "recentFingerprintsLimitStrict": 10,
  "cooldownHoursRelaxed": 3,
  "maxPushCountRelaxed": 6,
  "recentFingerprintsLimitRelaxed": 5,
  "fallbackRepeatLimit": 2,
  "sourceFailureSkipThreshold": 3
}
```

支持在 `.env` 里重写，方便快速调参。

## 五、实施步骤

1. **Schema 变更**：新增表、字段，数据迁移脚本。
2. **调度器代码重构**：
   - 引入分层过滤函数。
   - 更新状态持久化（包含 `recentFingerprints` 等）。
   - 写入 `scheduler_run_history`。
3. **前端更新**：
   - 时间展示统一使用 CST。
   - 新增调度日志视图 / 推送详情增强。
4. **配置 & 部署**：
   - 将策略参数抽离至配置文件。
   - 更新部署脚本支持新配置。
5. **验证**：
   - 测试环境运行 ≥ 2 小时，检查日志表数据。
   - 观察“无人新稿”场景下的复播表现。
6. **监控指标**：
   - 层级命中率、最长冷却时间、复播占比等。

## 六、后续优化思路

1. **自动调参**：基于历史数据做简单 KPI 优化（例如目标复播率 < 30%）。
2. **源权重**：按源设置不同冷却/优先级，甚至动态调整。
3. **A/B 测试**：拆分任务，比较策略组合效果。
4. **智能预测**：探测各 RSS 源的更新频度，预测下一篇出现的时间，进一步优化轮播顺序。
5. **手动干预接口**：允许运营手动触发/跳过某源或某条内容。

---

> 说明：本方案为 v1 草案，后续在实施过程中如遇特殊情况，可再开会议调整参数或架构。欢迎在 `docs/` 中追加补充记录。

