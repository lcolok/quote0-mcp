# Quote0 统一显示编排：真实工作区集成与验证交接

日期：2026-09-15（开发机 Asia/Shanghai）

## 结论与边界

用户原话：`devspace应该已经可用了，请您落码`。

本轮通过 Devspace 在真实 Quote0 工作区完成一个**默认关闭、按设备显式启用的统一显示后端集成**。不再只有沙箱候选：策略、PostgreSQL 持久状态、新闻/天气/备忘候选适配、旧写入口隔离、Pull 帧发布、刷新 ACK、worker 启动及诊断 API 均已进入实际源码。

最终默认单测：442 pass / 1 existing skip / 0 fail，8126 expectations，443 tests / 56 files。独立 PostgreSQL 集成：24 pass / 0 fail / 0 skip，77 expectations。TypeScript 构建与 git diff --check 通过。

**没有部署，没有启用任何生产设备，没有运行生产迁移，没有 Commit/Push/Merge。** 完成的是已验证的后端首个垂直集成，不是“线上根治完成”。固件回传协议、真实 HTTP/物理刷新与切换验证仍是启用门。

## 工作区与原有资产

- Alias：`/Users/friday/github/_worktrees/quote0-solidot-governance-20260821`
- Real path：`/Volumes/Mac Mini M4 Plus APFS/GitHub/_worktrees/quote0-solidot-governance-20260821`
- Devspace workspaceId：`ws_21a96c67-8bf3-42d9-82ef-40597cf67f21`
- Remote：`https://github.com/lcolok/quote0-mcp.git`
- Branch：`main`
- HEAD：`3d959819688e085fc383102a035ea1a7be50b120`，未改变。
- 不要退回 `/Users/friday/github/quote0-mcp` 的旧 detached 快照施工。

开工前有三份未跟踪资产，结束时 SHA256 完全未变：

| 路径 | SHA256 |
|---|---|
| docs/QUOTE0-SOLIDOT-EXPOSURE-AUDIT-20260915.md | 40fde2c803d404bdc77586ecb40e9ad87312b8dd00cf62cfa0ca565a3c9bd97e |
| docs/QUOTE0-ROTATION-REPETITION-AUDIT-20260915.md | 7283b4e3b5c7c6cc3dcb2f3d0f3604c34bea8a1a028c5ce595688bda205b8c37 |
| scripts/audit-news-rotation.py | de751f4d21f2df528cad7c7de655b2709b6d8af0a7bb10c48800ccbf9d558dd6 |

当前所有新增和修改仍在工作区；未暂存。包依赖、锁文件、生产 manifest 和版本号未改变。

## 动态上下文重建与事实来源

Preflight：tlens `v0.3.0-5-g3ddb3aa`，skldr `0.3.62+passwd-home.e191bc4`。开工时 tlens backend healthy；中途 timeline/search/chunk 请求及 skldr search 返回 EOF，随后 doctor 明确显示 backend 不健康。没有将 EOF 误报为 Quote0 缺陷。结束前再次 doctor 已恢复 healthy（20880 sessions / 242467 chunks），skldr search 重新返回当前审计 ctx-9UBp。

本轮成功回读了 `ctx-9UBp`，并审阅用户上传的隔离候选包及其交接。其他已知历史锚点来自本会话先前已读取的证据：

- `ctx-Ejzu`：Solidot 曝光下降与 6h tier 饥饿。
- `ctx-9UBp`：连续三播、同稿高重复与离线模型边界。
- `ctx-nWX0`：旧新闻-only 离线回放脚本，不可冒充混流验收。
- `ctx-LKx7`：来源、freshness、soft-budget 旧策略。
- `ctx-syK8`：天气历史上保留 mixed 路径。
- tlens `454e847a-a997-422a-8462-f9dad1771478:0`：旧无限 LRU 的原始目标。
- tlens `7cc3c5c4-1381-420f-bf99-317baea4c4db:10`：天气/备忘独立调度原始证据；本轮新回读因 EOF 未成功，不声称新取得。

部分组合工具调用（包括追加 memo 行级锁的 edit）被工具安全层拦截，未绕过；被拦截的改动不算已实施。

Devspace register_intent / record_decision 返回 `recorded=false: no MCP session id available`；因此意图和决策在此落档，而非假称 journal 已记录。

Context Brief：真正目标是可读的多内容轮播，不是追求每分钟成功投递计数；质量与 Research 门禁不放松；原有三份资产受保护；新代码围绕每设备显示权和已确认曝光建立最小集成。所有当前实现判断以源码与可重复测试为准。

## 新执行链

```text
新闻：既有 RSS / Research / 质量门 → content_inventory
天气：既有任务获取天气 → latest-only structured candidate（真实观测时间 TTL）
备忘：既有任务选择备忘 → immutable PNG candidate
                         ↓
              每设备统一 Governor
      选片预留 → 渲染 → 原子发布 → 刷新 ACK
                         ↓
       唯一被批准的 device_frames 快照 → Pull v2
                         ↓
       confirmed-refresh 曝光历史 / 最低停留 / 冷却
```

受治理设备的普通 Push 被拦截；首个版本没有把不可靠的旧 Push 成功伪装为面板刷新。未纳管设备、MindReset 云屏和打印类路径保留原有行为。候选治理范围是本地、单色、单平面、带鉴权和可验证刷新 ACK 的 E-Ink 设备。

### 策略规则

- 保留质量 HOLD、Research compatible policy、24h 有效期；不沿用全局 6h 硬优先层。
- 同稿冷却先于来源公平；没有“未播满三次就立即重播”的规则。
- 普通新稿、来源等待与周期卡一起选择；天气逾期超出预算后获得有限展示机会，避免冷启动旧稿 backlog 长期占先。
- 最低停留从匹配的刷新完成 ACK 开始，而不是从渲染/入队/HTTP 成功开始。
- 天气插播不会清空新闻曝光；天气值或抓取时间变化不会跳过城市展示间隔。
- 无可播内容就显式 HOLD，不暗中绕过冷却。
- 新闻当前用稳定 article identity；没有伪称已完成跨来源事件聚类或“实质更新”的语义判定。

### 持久状态与帧一致性

新增三表：`display_governor_states`、`display_governor_candidates`、`display_governor_events`，通过现有 initialize 的 additive migration 接入。

每设备使用 PostgreSQL 行锁串行选择、发布和 ACK。渲染在事务外，发布前再次检查预约与候选准入。发布事务同时提交：JSON 状态、精确位图字节、frame ID/CRC、事件、事务性 NOTIFY。帧表是可轮询恢复的 latest-value outbox，NOTIFY 丢失不等于丢帧。

旧 frame ID 是位图内容 SHA 的短前缀，同像素复播会复用标识。新发布使用每次独立的 16-hex wire token，符合现有服务器解析语法；logical plan generation、位图 SHA256、CRC 分别承担代次、内容一致性、链路校验职责。旧代次 ACK、CRC 不一致、failed、超时或重复 ACK 都不能推进曝光。

`getDeviceFrame` 在一个 SELECT 快照里同时读取帧和 governor state，未被批准的帧不对 Pull 暴露。ACK 超时保持 uncertain，不回退发出更旧帧。

### 旧入口与切换

- 新闻/天气/备忘 enqueue 对受治理设备不再产生旧投递。
- 旧 worker 认领排除受治理设备，执行前也再检查。
- `upsertDeviceFrame` 与物理 `pushToEinkDevice` 增加集中隔离。
- 普通写者在整个副作用期间持有共享 advisory transaction lock，enrollment 取独占锁；防止检查后、发送前发生切换。
- 物理 Push 也检查 endpoint 别名；另一个 ID 指向同一已纳管物理 endpoint 时不能绕过隔离，也不能作为第二个 Governor 重复纳管。
- 启用时有 180s 保守 drain，并继续检查旧 leased delivery；不强行杀掉在途发送。
- 归属写入 DB 后即持久存在。移除环境变量仅表示暂停，不是自动把设备还给旧写者。

### 天气数据语义

AMAP 的无时区时间按 +08:00 解析，缺失、非法、过期或明显未来观测被拒绝。TTL 为真实观测后 120 分钟，不以本次 fetch 时间续命。同城市最新值覆盖候选，不累积为多条普通新闻。实际天气渲染使用目标设备几何。

## 修改文件

新增实现：
- src/api/display-governor.ts
- src/api/display-governor-config.ts
- src/api/display-governor-store.ts
- src/api/display-governor-ownership.ts
- src/api/display-governor-catalog.ts
- src/api/display-governor-worker.ts
- src/react-widgets/core/display-governor-schema.ts

新增验证：
- src/api/display-governor.test.ts
- src/api/display-governor-catalog.test.ts
- src/api/display-governor.pg.test.ts
- src/api/test-support/legacy-ownership-db.ts
- scripts/test-display-governor-pg.ts

接入修改：
- src/api/news-scheduler.ts：天气/备忘 candidate 与旧 consumer owned 跳过，不伪增全局 replay。
- src/api/delivery-enqueue.ts：排除 governed targets，显式返回 governed 数。
- src/api/device-delivery-worker.ts：旧 claim/执行排除 governed。
- src/api/device-frame-cache.ts：旧 cache writer fencing 与批准帧读取。
- src/api/device-frame-ack.ts：真实 governor ACK 状态入口。
- src/api/eink-converter.ts：普通 Push 隔离与 endpoint 别名保护。
- src/api/news-api-server.ts：只读 /api/display-governor/status、ACK 回应语义、禁用设备不提供帧/ACK。
- src/api/server.ts：启动显式 opt-in worker。
- src/react-widgets/core/postgres-database.ts：additive DDL 接入。
- src/api/eink-push-serialization.test.ts / eink-status-single-probe.test.ts：补足 DB 事务桩，原协议断言全部保留。
- bunfig.toml / package.json：独立 PG profile，不把外部数据库混进默认单测。

## 验证命令与结果

1. 开工基线 `bun test`：372 pass / 1 existing skip / 0 fail，373 tests / 54 files。
2. 初版真实核心 `bun test src/api/display-governor.test.ts`：53 pass / 0 fail；之后补了冷启动天气防饥饿测试，最终核心 54 项。
3. 中间全量曾出现 11 fail：旧协议测试的 DB 桩没有 Pool.connect。补真实事务桩契约后通过；没有删除断言或放宽运行时 fail-closed。
4. 最终 `bun test`：442 pass / 1 skip / 0 fail，8126 expectations，443 tests / 56 files。唯一 skip 为既有 RSS source-health PG outbox 测试，与新 PG suite 分开。
5. `bun run test:display-governor:pg`：最终 24 pass / 0 fail / 0 skip，77 expectations。运行真实 PostgreSQL 15.17 Homebrew，临时集群仅监听 127.0.0.1，数据库名 q0_display_governor_test，测试 schema 随机生成，测试后删除自己的 schema 并停止自己的集群。
6. `./node_modules/.bin/tsc -p tsconfig.build.json`：exit 0，实际生成 dist 编译产物。
7. `git diff --check`：exit 0；原有三份资产 SHA 完全一致。

最终默认测试工具完整日志：
`/var/folders/65/1n699dtj34q9crxh12fq5h4c0000gn/T/pi-bash-71fd907c356c40da.log`

最终 PG 集群诊断目录：
`/var/folders/65/1n699dtj34q9crxh12fq5h4c0000gn/T/q0-governor-pg-3fzjnr`
端口 53251；测试后 pg_ctl stop exit=0。该路径不代表还有后台服务。保留停止后的临时数据和日志供追踪，没有大范围 rm。

PG runner 首两次启动失败，日志为 `postmaster became multithreaded during startup`，明确提示 LC_ALL。仅给本测试子进程设置 LC_ALL=C / LANG=C 后解决；没有修改机器全局 locale。这是测试环境问题，不是项目生产数据库故障。

### 真实 PG 已覆盖

并发两 worker 唯一预留、帧/状态/审计原子提交及失败回滚、NOTIFY 实际字段契约、重复 ACK 不延长停留、进程重建后状态保持、旧 wire token 与 CRC/failed/late ACK 拒绝、普通 Push/cache 覆盖拦截、物理 endpoint alias 拦截、DB 故障拒绝副作用、切换等待旧写者、drain/leased 保护、只 supersede 旧未租赁任务、渲染失败不造成功、真实新闻/天气/备忘准入 SQL、渲染期间 snapshot/HOLD 改变拒绝发布、worker→真实事务→真实帧读取→ACK 的纵向调用。

PG 纵向测试使用合成位图替代实际外部 MinIO/物理面板；没有声称物理显示或真实生产天气取得成功。

### 合成混流已覆盖

六小时新闻+周期天气共用同一状态机，5s tick，检查最低停留、文章冷却、天气出现与旧来源可选。它不是生产混流数据回放。此前 news-only 回放中的收益不能外推成新系统真实上线收益。

## 配置（仅示例；本轮没有应用）

```text
QUOTE0_DISPLAY_GOVERNOR_DEVICES=<explicit-test-device-id>
QUOTE0_DISPLAY_MIN_DWELL_MINUTES=1
QUOTE0_DISPLAY_NEWS_COOLDOWN_MINUTES=45
QUOTE0_DISPLAY_WEATHER_INTERVAL_MINUTES=30
QUOTE0_DISPLAY_MEMO_INTERVAL_MINUTES=30
QUOTE0_DISPLAY_SOURCE_SILENCE_MINUTES=60
```

无名单则不启用新 worker。名单不接受 wildcard，错误配置 fail closed。分钟参数必须整数 1..1440 且冷却不少于停留。它们是首轮候选配置，不是已验证的最优生产参数。

诊断入口：`GET /api/display-governor/status`（未加入 manifest public_path；保持现有入口鉴权边界）。返回每设备 current/pending、generation、保护期限、决策与错误。新曝光真相是 `display_governor_events.event='refresh-confirmed'`，不是旧 consumer success/replay_count。

## 生产启用前必须完成 / 未验证部分

1. **固件契约**：真实测试板必须回传服务器给的 opaque 16-hex frame ID、正确 CRC，并且只在面板刷新完成后报 displayed；不能仅靠服务器 parser 兼容就宣布固件兼容。重复像素新代次、延迟旧 ACK、长轮询重连都要实测。
2. **真实端到端**：实际 HTTP GET/ACK、AMAP observation 字段、MinIO/Satori 新闻与天气渲染、296×152 和 800×480 真机完整跑通；本轮没有启动生产服务或推真实板。
3. **切换/暂停/释放**：本实现提供持久归属和暂停语义，尚无经验证的生产一键释放命令。不要仅删除名单后回滚旧镜像（旧镜像不知道 ownership 表），也不要并行运行旧无 fencing 的进程。释放必须由显式授权的操作流程在所有旧/新 worker 停止且请求排空后处理，并保留审计。
4. **备忘并发撤销**：当前重验锁定 catalog/job，memo 本体通过 EXISTS 检查。追加锁住 memo 行的 edit 被工具拦截且未应用；在启用备忘前补齐并发 disabled/delete 测试与行锁，不应宣称所有实体撤销都已线性化。
5. **渲染 IO 与生命周期**：预约过期会拒绝迟到发布，但不等于可以取消所有底层渲染/MinIO Promise；长时间卡死的 IO、跨设备隔离、worker 停机排空需要进一步故障注入。已有 stop 函数用 epoch 防止停止后的新发布，但未新增全应用 SIGTERM 排空重构。
6. **旧管理 UI**：新事件/状态有后端诊断，尚未将旧推送历史与 device_runtime_state 的展示全面改造成 confirmed-refresh 投影。灰度时不要用旧 delivery 数量下降误判为停播。
7. **后续产品层**：真实跨来源事件聚类、重大更新版本判断、按未展示供给补池、Solidot relay 全量覆盖核对、合适的长期事件归档/保留策略未在此轮完成。

上线验收应至少断言：同稿冷却不被天气或来源公平重置；天气最低停留从 ACK 计时；新旧通道无双写；服务重启后历史不丢；断线重连只拿被批准帧；旧/重复 ACK 不推进状态；质量与研究准入仍生效。只读 shadow/合成通过不能替代真实灰度。

## 继任者第一步

先读本报告和当前 git diff，确认仍在上述主线 worktree；保留三份既有审计资产。运行 `bun test`、`bun run test:display-governor:pg`、`./node_modules/.bin/tsc -p tsconfig.build.json`。优先完成一个明确测试设备的固件/HTTP/物理刷新契约验证，再考虑版本化发布和 opt-in；不要直接全量启用。
