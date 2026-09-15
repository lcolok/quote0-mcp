# Quote0 统一显示 Governor · eink-2 生产 Canary · v1.21.131

日期：2026-09-15（Asia/Shanghai）

## 结论

Quote0 的新闻重复、Solidot 长静默、天气独立抢屏三类问题，已从“分别调定时器”推进到同一套 per-device display governor，并在真实生产 `eink-2` 完成单设备 canary。

当前生产版本：**v1.21.131**。`eink-2` 由 governor 接管；`eink-4` 等其它设备保持 legacy 路径。没有全量切换。

已验证：

- 面板刷新完成 ACK 才算曝光；HTTP/enqueue 不算。
- 同稿 45min 冷却先于来源公平；不再存在“播满 3 次”优先。
- 新闻/天气共享同一显示时序；最低停留从 panel ACK 起算 60s。
- 天气真实插播不会立即被新闻覆盖。
- 受治理设备的 legacy delivery / Push / frame-cache 写入被隔离，无双写。
- 24h legacy `succeeded` delivery 会幂等导入为已看/冷却/来源基线，避免切换后把旧稿全部误判为首次展示。
- Solidot 在历史基线导入后重新由正常 `rotation` 选中，且未绕过冷却。

本文形成于 Git 收口前；随后用户已授权执行本轮 Commit。Push、Merge 仍未授权，也未扩大到其它设备。最终 commit hash 以 Git / skldr commit closure 为准。

## 工作区 / Git

- Workspace: `/Users/friday/github/_worktrees/quote0-solidot-governance-20260821`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- Branch: `main`
- HEAD / origin/main: `3d959819688e085fc383102a035ea1a7be50b120`
- 工作区保持 dirty，所有 governor 代码和发版 manifest 尚未提交。

开工前已有三份未跟踪资产保持原 SHA256：

- `docs/QUOTE0-SOLIDOT-EXPOSURE-AUDIT-20260915.md`: `40fde2c8...d97e`
- `docs/QUOTE0-ROTATION-REPETITION-AUDIT-20260915.md`: `7283b4e3...b8c37`
- `scripts/audit-news-rotation.py`: `de751f4d...58dd6`

## Dynamic Context Rebuild

- tlens: `v0.3.0-7-g2f313f1`，backend healthy。
- skldr: `0.3.62+passwd-home.e191bc4`。
- 关键历史：`ctx-Ejzu`（Solidot 曝光下降）、`ctx-9UBp`（重复审计）、`ctx-nWX0`（离线策略模型）、`ctx-seKr`（统一显示真实后端集成）、`ctx-LKdP`（Quote0 验证后自动部署授权）。
- Devspace `record_decision` 因无 MCP session id 返回 recorded=false；决策以本报告和 skldr 为准。

## 本轮新增治理

### 1. 备忘并发撤销线性化

`loadAdmittedPeriodic()` 对 memo publication 使用 `FOR SHARE OF gc,j,m`，并发 `memos.enabled=false` / delete 会等待 publication admission 事务结束。真实 PostgreSQL 测试证明 writer 在 reader 持锁期间阻塞。

### 2. 显式安全释放

`DisplayGovernorStore.release(deviceId)` + `scripts/release-display-governor.ts`：

- 设备仍在 allowlist 时拒绝释放；
- 有 pending governor publication 时拒绝；
- 有 legacy leased delivery 时拒绝；
- 获取 endpoint + device 独占 advisory lock；
- 写 `released` 审计事件；
- 删除 ownership state，但保留最后一帧，避免屏幕空白；
- release 后 legacy writer 才重新获得许可。

### 3. Legacy 曝光基线导入

Canary 首轮发现 governor 新状态从 0 开始，会把 24h 内 legacy 已播新闻误当“首次展示”。v1.21.131 新增 `importLegacyNewsExposureHistory()`：

- 只读每设备最近 24h `device_deliveries.state='succeeded'`；
- 每篇取最后成功时间；
- 稳定映射到 `news:<fingerprint>` exposure/content key；
- 合并 `lastByContent / lastByExposure / lastBySource`，只取更晚证据；
- 记录 `legacy-history-imported`，幂等重复执行返回 0；
- 新 governor ACK 仍是后续唯一强曝光真相，legacy 只作为切换基线。

生产 v1.21.131 启动实测：`legacy exposure baseline imported=70`。

## 验证

### 本地/隔离验证

最终代码在版本 bump 前完成：

- `bun test`: **442 pass / 1 existing skip / 0 fail**，8126 expectations，443 tests / 56 files。
- `bun run test:display-governor:pg`: **28 pass / 0 fail / 0 skip**，99 expectations，真实 PostgreSQL 临时集群。
- governor 核心/目录专项：**70 pass / 0 fail**。
- TypeScript build: PASS。
- `git diff --check`: PASS。
- release-version v1.21.131: 5 pass / 0 fail。

PG 覆盖包括：并发唯一预留、状态/帧/事件原子发布、回滚、NOTIFY、刷新 ACK、迟到/重复/CRC 错误 ACK、restart 持久状态、Push/cache/endpoint alias fencing、切换 drain、显式 release、memo 行锁、legacy history import 幂等和 cooldown 生效。

## 生产分阶段发布

### v1.21.129 — 非接管阶段

目的：先铺代码/schema，不启用设备。

- image: `quote0-mcp-api:v1.21.129`
- registry digest: `sha256:3f4d097b5dfc2835dc1b3196f8e1951d89e27df9d08f678579e3f7eb2caf5d9b`
- LPK 安装成功。
- 7 容器 healthy；六长期服务 restart policy 恢复 `unless-stopped`。
- 三张 governor 表创建成功；`display_governor_states=0`。
- eink-2 legacy ACK 持续正常。
- 关键源码本地/容器 SHA 一致。

### v1.21.130 — eink-2 Canary

显式配置：

- `QUOTE0_DISPLAY_GOVERNOR_DEVICES=eink-2`
- min dwell 1min
- news cooldown 45min
- weather/memo interval 30min
- source silence target 60min

image digest: `sha256:2102cb94df8cfd25c16824aed97c1058342ba23f2996c945253479a406353e26`

固件门：过去 30min `eink-2` 有 23 条 ACK，22 条为 current_match+CRC verified displayed；固件 `driver-board-hybrid-v2`，刷新约 2058–2064ms。

切换：

- 22:33:27 `enrolled`，180s drain。
- drain 内 state 为 `uncertain-refresh` HOLD，屏幕保持原帧。
- 切换后 `device_deliveries` 对 eink-2 新增数始终 **0**；eink-4 继续 legacy 新增。

首次真实 governor 帧：

- 22:36:28 published
- 22:36:42 refresh-confirmed，frame/CRC 匹配，refresh 2063ms。

随后多轮均为不同新闻，刷新间隔约 65–70s。

真实天气：手工触发 `weather-guangzhou` 仅用于 canary 验收；AMAP observation `2026-09-15 22:30:52+08`，阴 24°C，TTL 至 00:30:52。

- 22:47:43 `periodic-due` weather published
- 22:47:45 refresh-confirmed
- 下一篇新闻 22:48:49 才 published

天气实际保护约 **63s**，旧系统曾观测天气后 0.486s 被新闻覆盖，本次已消除。

v1.21.130 观察汇总：20 次 `refresh-confirmed` = 20 个不同 exposure；weather 1；重复 exposure 0；最小确认间隔 **64.775s**，平均 **67.983s**。

### v1.21.131 — Cold-start history 补丁

image digest: `sha256:a10d85d7512a5563cf52cf6d8e5c0e9ef7d98ff81b06cb3d809e1bced3068c6c`

- 启动导入 70 篇 legacy 成功展示历史；事件只写一次。
- 现有 governor generation/current 状态保持，不重置。
- 切换后 legacy delivery 仍为 0。
- 本地和生产 `display-governor-store/worker/catalog/ownership`、manifest SHA 完全一致。
- 7 容器 healthy，restart policy `unless-stopped`。
- 错误扫描无 fatal/panic/unhandled/governor error；仅有预期 `legacy exposure baseline imported=70`。

历史导入后真实行为：

- generation 21：真正新候选先以 `first-display` 展示。
- generation 22：Solidot `inventory 20193` 以正常 `rotation` 展示。
- 该 Solidot 旧链路上一次成功为 21:47:55；新 governor ACK 为 23:00:25，相隔约 **72.5min**，大于 45min cooldown，未通过“来源公平”绕过同稿冷却。
- frame `e08fdd79d9b9d56b`，current_match=true，crc_verified=true，refresh=2059ms。

## 当前生产事实

- Production: v1.21.131。
- Governor-owned: `eink-2` only。
- Legacy: `eink-4` 等其它设备。
- Exposure SSoT: `display_governor_events.event='refresh-confirmed'`。
- eink-2 legacy `device_deliveries` after cutover: 0。
- 质量 / Research v13 / terminal-tool 未改变。

## 风险 / 未完成

1. 当前只有 eink-2 canary；未证明 800×480 eink-4 在相同策略下视觉和时序同样合适。
2. 45min news cooldown、30min weather interval、60min source silence 是当前候选生产参数；已有 canary 证据，但不是长期 A/B 最优值。
3. 跨来源“同一事件不同 URL”事件级去重仍未实现；当前 exposure identity 仍是稳定 article identity。
4. Producer low-water 仍是旧 `freshEligible` 逻辑，尚未切到“未首播/冷却后可播/来源覆盖”供给指标。
5. 长期管理 UI 仍应迁移到 confirmed-refresh 指标；旧 delivery 数不能用于判断 eink-2 是否停播。
6. 本文初稿形成时生产代码来自 dirty worktree remote-build；随后用户已授权将本轮变更 Commit，Push 仍是独立授权边界。

## 回滚

不要直接降回不知道 ownership 的旧镜像。

安全路径：先发布同代码但移除 `QUOTE0_DISPLAY_GOVERNOR_DEVICES=eink-2`，再在新容器执行：

`bun scripts/release-display-governor.ts --device eink-2 --confirm`

release 会保留最后一帧并恢复 legacy writer 权限。真实 release 原语已在 PG 中测试，但本次 canary 未触发回滚，因为全部门禁通过。

## 下一步

P0：继续保留 eink-2 单设备生产观察，并将 confirmed-refresh 重复率、每小时 unique exposure、来源静默和天气停留纳入状态页。

P1：在获得一段稳定观察数据后，再以相同固件/ACK门验证 eink-4；不要直接全量切换。

P1：本轮 Commit 已获用户授权执行；Push / Merge 仍需单独授权。
