# Quote0 内容工作流架构

## 目标

把“内容生产”“人工评审”“运行控制”拆成三个明确边界，避免把离线质量评估、阻塞式 HITL 和运维控制台混为一体。

```text
RSS / API
   ↓
规范化 + fingerprint 去重
   ↓
content_inventory（内容事实）
   ↓
prompt-profile（一次结构化 LLM 调用）
   ↓
渲染与投递 ─────────────→ news_push_log（投递证据）
   ↓
人工评审 ───────────────→ quality_annotations.fingerprint（评审决策）
   ↓
离线留出集评估 → 人工批准 → 显式发布新 profile
```

## 三个边界

### 1. 内容生产面

- `content_inventory` 是可生产、可重放内容的权威状态。
- `news_push_stats.fingerprint` 是现阶段评审列表的稳定主体索引。
- `news_push_log` 只记录某次投递的输入、输出和图片，不再承担内容实体或评审任务表的职责。
- 新任务应使用 `prompt-profile`；`ax-optimized` 只为已有数据库配置保留。

### 2. 评审与评估面

- 人工决策以 `quality_annotations.fingerprint` 绑定稳定内容。
- `news_id` 保留为“评审时看到的具体投递证据”，用于复现，不作为主体键。
- 同一 fingerprint 只有一个 `is_latest=true` 决策；历史版本仍保留。
- 点赞/点踩是人工决策，不会立即改变生产 prompt，也不叫在线 HITL 训练。

### 3. 运行控制面

- 调度任务、LLM provider、设备、素材库和投递历史属于运维控制。
- 这些页面不应与人工质量决策共享生命周期或状态机。
- 第二阶段应把 HTTP API、scheduler、producer worker、delivery worker 拆为独立进程；本阶段不改变部署拓扑。

## Web/API 性能约束

- 列表 API 从 `news_push_stats` 读取轻量投影，每个 fingerprint 只关联最新投递。
- 列表默认不返回 `raw_content` / `processed_content`；用户选中记录后再调用详情 API。
- 评审主列表使用 `(last_pushed_at, fingerprint)` 游标，不使用深 OFFSET。
- 首屏需要总数时才执行 COUNT；后续游标页不重复计数。
- 页面数据 30 秒内视为新鲜，仅在重新聚焦或明确写入后刷新，不做隐藏标签页轮询。
- Web 路由按页面拆包，避免首屏加载训练、设备、素材库等所有管理代码。

## 质量声明

`qualityScore` 目前只允许表示可复算的机械约束合规率，并通过
`processingMetadata.qualityMetric = "constraint-compliance"` 明示语义。它不代表事实正确性、新闻价值或人工偏好。

Prompt profile 的质量提升必须来自独立留出集：

1. 按 fingerprint 划分示例集和留出集，禁止泄漏；
2. 基线与候选使用相同输入、模型和采样设置；
3. 记录事实一致性、长度合规、失败率、延迟、成本和盲评偏好；
4. 预先定义通过阈值；
5. 保留评估 artifact 和人工批准记录后才能发布。

没有上述证据时，只能说“配置发生变化”，不能说“质量得到提升”。

## 兼容迁移

- 数据库初始化会回填历史 `quality_annotations.fingerprint`，并把同一内容的旧重复 latest 决策降为历史版本。
- API `/api/scheduler/push-history` 保留 offset 参数供旧页面使用，同时提供 `cursor`、`nextCursor`、`includeContent`。
- `/training` 重定向到 `/evaluation`；旧训练/激活 API 返回 HTTP 410。
- 当前生产 artifact 路径暂时不变，下一阶段再迁移目录和删除未使用的 AX 实验代码。

## 下一阶段

1. 为 prompt profile 建立独立评估 runner 和不可变评估 artifact。
2. 把评审主体从 `news_push_stats` 最终迁移到 `content_inventory`，补齐非投递内容的抽样评审。
3. 拆分 API 与 worker 进程，给 scheduler/worker 增加租约、幂等键和队列背压。
4. 在生产只读副本上运行 `EXPLAIN (ANALYZE, BUFFERS)`，验证新列表/统计查询后再部署迁移。
