# ADR-0001：调度任务变更接口的架构演进

- **状态（Status）**：Accepted — Phase 1 实施待定（候选时机：与下次涉及 SchedulerPage 的需求合并）
- **日期（Date）**：2026-05-16
- **决策者**：lcolok + Claude（指挥官模式）
- **相关变更**：v1.0.33（producer/consumer 解耦）以来 multi-source-rotation 的 `rss_sources` 多次"消失"

---

## 1. 上下文（Context）

### 1.1 触发事件

2026-05-16 v1.0.36 部署后用户反馈"订阅源又变回一个了"。排查根因：

- `news_scheduler_jobs.rss_sources` 列是 jsonb，多源轮播模式靠该列非空触发
- 每次从 `annotation-web/SchedulerPage` 编辑 `multi-source-rotation` 任意属性（如 enabled toggle / interval 修改）
- 前端发 PUT `/api/news/scheduler/jobs/:id`，body 是 form 字段
- **SchedulerPage form 完全没有 `rss_sources` 输入项**（grep `rss` 在该文件返回 0 结果）
- → PUT body 不包含 `rss_sources` → 后端 `upsertSchedulerJob` 拿到 `undefined` → SQL `$7 = job.rssSources || null` → INSERT 写 NULL
- → `ON CONFLICT (id) DO UPDATE SET rss_sources = EXCLUDED.rss_sources` 把 DB 现有 rss_sources 清空

### 1.2 这不是孤立 bug

这是 **HTTP PUT 语义被错用**的具体表现：

- **PUT 的 RFC 7231 语义**：客户端必须提供资源完整状态，缺失字段语义=该字段被清空
- **PATCH 的 RFC 5789 语义**：客户端只传变化字段，未传字段保留原值
- 当前 `PUT /jobs/:id` 同时被用于"勾选某开关"和"完整替换配置"两类场景 → 语义混淆

任何被前端 form 漏掉的字段（不光是 rss_sources）都会被这条 PUT 路径清空。属于**结构性陷阱**。

### 1.3 与未来产品方向的关系

quote0-mcp 长期演进方向：
- 当前 = 单设备（E-Ink 296×152）新闻+天气推送
- 未来 = 多设备内容生产+分发中心（E-Ink + 标签机打印机 + ...）

未来场景下"变更接口正确性"的需求会显著放大：
- 多设备 → 配置变更频率上升
- 多客户端（Web / 手机 / 自动化 API）并发改同一资源 → 漏字段/竞争更频繁
- 业务规模化后可能需要审计 trail（"昨天 14:00 这次标签机失败的指令谁发的"）

---

## 2. 候选方案（Options Considered）

| 层级 | 方案 | 本质 | 工程量 | 长期影响 |
|---|---|---|---|---|
| ①  表面 | 后端 SQL 用 COALESCE 保留未传字段 | PUT 行为偷换成 PATCH | ★ 一文件 ~10 行 | API 语义混乱，调用方猜不准 |
| ②  正式协议 | 拆 PUT 和 PATCH 端点，前端编辑用 PATCH | 符合 HTTP RFC | ★★ 后端 ~15 行 + 前端 ~5 行 | 干净止血，符合 REST 主流实践 |
| ③  更底层 | Command 风格端点（每动作独立 POST） | 端点签名 = 意图，物理不可能漏字段 | ★★★ 后端 30-40 行 + 前端拆 form | 接口语义最精确，扩展时每个动作显式 |
| ④  极致 | CQRS + Event Sourcing | 所有变更=显式 Command/Event，状态由事件 fold | ★★★★★ 1-2 周重构 | 完整审计 + 时间旅行 + 多客户端协同 |

### 2.1 各方案的具体形态

**方案 ①（COALESCE 守门）**：
```sql
ON CONFLICT (id) DO UPDATE SET
  rss_sources = COALESCE(EXCLUDED.rss_sources, news_scheduler_jobs.rss_sources)
```
PUT 端点保持，但行为变成"未传字段保留"。**违反 HTTP 规范**——其他调用方（含未来的）会以为 PUT 真的全替换，调试困难。

**方案 ②（PUT + PATCH 分离）**：
```
PUT   /api/news/scheduler/jobs/:id   完整替换；body 必须完整
PATCH /api/news/scheduler/jobs/:id   局部更新；只传变化字段（SQL 用 COALESCE）
```
前端 SchedulerPage 现有编辑路径改发 PATCH。符合 HTTP 第一性原理。

**方案 ③（Command 风格端点）**：
```
POST /api/news/scheduler/jobs/:id/enable     body 必填 {enabled: boolean}
POST /api/news/scheduler/jobs/:id/sources    body 必填 {rssSources: string[]}
POST /api/news/scheduler/jobs/:id/interval   body 必填 {intervalMs: number}
POST /api/news/scheduler/jobs/:id/strategy   body 必填 {indexStrategy: ...}
```
每个端点 = 一个原子意图，请求体的字段是命令的核心参数（不传 = 400）。**物理上不可能"漏传清空"**。

**方案 ④（CQRS + Event Sourcing）**：
```
当前架构                          CQRS + Event Sourcing
─────────────────                 ──────────────────────────────────
PUT /jobs/:id                     POST /commands
  ↓                                 ↓
UPDATE jobs                       校验 → INSERT INTO events (append-only)
  ↓                                 ↓
done                              fold events → 重建 jobs_snapshot (read model)
                                    ↓
                                  done
状态 = DB 快照                     状态 = events 序列的 fold 结果
```

新增设施：
- `events` 表（append-only，含 aggregate_id / event_type / payload / sequence_no / occurred_at）
- `jobs_snapshot` read model（events fold 重建）
- Command bus + 6-8 个 Command handler
- 启动时 event replay
- 与现有 producer/consumer 调度器集成（producer/consumer 也得改为发 Command）

---

## 3. 决策（Decision）

### 3.1 选定方向：**渐进式三阶段演进**（不二选一）

| Phase | 方案 | 触发时机 | 状态 |
|---|---|---|---|
| Phase 1 | 方案 ② PUT + PATCH 分离 | **现在或下次涉及 SchedulerPage 时合并实施** | 候选 |
| Phase 2 | 方案 ③ Command 风格端点 | 标签机集成后 / 配置变更频率显著上升时 | 待定 |
| Phase 3 | 方案 ④ CQRS + Event Sourcing | 需要审计 trail / 多客户端并发 / 业务规模化时 | 待定 |

### 3.2 关键洞察：每阶段独立可用且不会浪费下一阶段

- Phase 1 的 PATCH endpoint 在 Phase 2 后可保留（或重命名为 Command），代码不浪费
- Phase 2 的 Command handler 在 Phase 3 改用 Event 写入时直接复用——把 `UPDATE jobs SET ...` 换成 `INSERT INTO events ... + apply to read model`
- 每一步都解决该阶段的真实痛点，不为下一步硬铺路

### 3.3 拒绝方案 ①（COALESCE 守门）的理由

虽然代价最小，但它**偷换 HTTP PUT 语义**：未来任何新调用方都会困惑"这个 PUT 是真的全替换吗？"。短期方便，长期是技术债。

### 3.4 不在今天实施 Phase 1 的理由（如果选择推迟）

- 2026-05-16 已累计部署 11 个版本（v1.0.26 → v1.0.36），团队（指挥官+用户）疲劳度高
- 用户已知道根因，可手动避免（不要从 UI 编辑 multi-source-rotation）
- 等下次本就需要改 SchedulerPage 时合并 PATCH 实施，可以节省一个独立部署周期

---

## 4. 后果（Consequences）

### 4.1 正面

- **本 ADR 即决策记录**，未来在 SchedulerPage 或 jobs API 上做改动时直接按 Phase 1 实施
- 路线图明示了"什么时候做什么"——Phase 2 不是空想，是写明了触发条件（标签机集成）
- 类比"装修预埋水电"：今天不强行装智能家居，但布线时留好空间

### 4.2 负面/风险

- 在 Phase 1 实施前，用户**必须避免**从 annotation-web/SchedulerPage 编辑 `multi-source-rotation`（任何编辑都会清空 rss_sources）
  - 缓解：可在 SchedulerPage 的 multi-source-rotation 行上加 readonly 锁标 + 警告 tooltip（< 5 行前端改动，零侵入）
- 路线图本身可能因为业务方向变化失效——如果标签机集成被取消，Phase 2 就不需要做了
- 多客户端场景（Phase 3 适用条件）现在还是单一 annotation-web，本 ADR 假设 quote0 未来会上多客户端，这是一个 assumption

### 4.3 度量是否进入 Phase 2 / Phase 3 的信号

进入 Phase 2 的信号（满足任意一个）：
- 第二种设备类型（如标签机）接入生产
- 出现 ≥ 3 次"前端 form 漏字段导致后端数据被清空"类问题
- 一次性写 N 个不相关字段的 PUT 出现明显并发问题

进入 Phase 3 的信号：
- 出现客户合同/法规要求完整审计 trail
- 出现"需要回到 2 天前的配置"的实际场景
- 客户端类型 ≥ 3（如 Web + iOS + 自动化 API）

---

## 5. 替代方案（Alternatives Considered）

### 5.1 完全不修，靠规约

约定"不要从 UI 改 multi-source-rotation"。**拒绝**——这是把 bug 的代价转嫁到操作纪律上，违反"代码层加固优先"原则（参考 [feedback_delegation_quality memory]）。

### 5.2 立刻上 CQRS

工程量 1-2 周，今天 11 个版本部署已疲劳，且当前场景（单设备、单客户端、低变更频率）不需要 CQRS 的核心收益。**拒绝**——属于"为假设的未来设计"，违反 commander persona 的"don't design for hypothetical future requirements"原则。

### 5.3 改 PUT 为 strict-replace（前端必须传完整 body）

类似 Phase 1 但反方向——让前端永远传完整 body 而不是引入 PATCH。**部分采纳**——Phase 1 的"PUT 保留完整替换语义"正是这个想法的一半。但只靠规约让前端永远传完整 body 会让前端代码 form state 管理复杂化，所以引入 PATCH 是更平衡的方案。

### 5.4 用 GraphQL/tRPC 把整层接口替换

跨度太大，与现有 Hono REST API 不兼容。**拒绝**——不在本 ADR 范围。

---

## 6. 实施清单（如果决定实施 Phase 1）

```
1. 后端 src/api/news-api-server.ts
   - 新增 PATCH /api/news/scheduler/jobs/:id 端点
   - 调用 postgres.patchSchedulerJob(id, partial) 方法（新加）

2. 后端 src/react-widgets/core/postgres-database.ts
   - 新增 patchSchedulerJob(id, partial): SQL 用 COALESCE 模式
     UPDATE news_scheduler_jobs SET
       enabled = COALESCE($2, enabled),
       interval_ms = COALESCE($3, interval_ms),
       ... 每个可选字段都 COALESCE
     WHERE id = $1

3. 前端 annotation-web/src/components/SchedulerPage.tsx
   - 把"保存"按钮的 fetch 调用从 PUT 改为 PATCH
   - body 只包含 form 上确实存在的字段（不要硬塞 rss_sources: undefined）

4. 验收
   - 修改一个 job 的 enabled toggle → DB rss_sources 仍保留
   - 修改 multi-source-rotation 的 interval → DB rss_sources 仍保留
   - PUT 接口保留完整替换语义（用于未来配置导入场景）
```

---

## 7. 修订记录

- **2026-05-16**：v1 创建，决策 Phase 1 待实施 + Phase 2/3 路线图
