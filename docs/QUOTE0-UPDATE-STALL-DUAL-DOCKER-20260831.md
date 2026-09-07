# Quote0 “似乎不更新”运行态治理 · 2026-08-31

## 用户反馈

用户在 v1.21.116 / Research policy v12 上线后观察到墨水屏“似乎不更新”。本轮以生产运行态、真实 device delivery 和板端 `/status` 为 SSoT，不把 scheduler 日志或 canary 单独视为屏幕已刷新证明。

## 工作区

- Repo: `https://github.com/lcolok/quote0-mcp.git`
- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- 生产版本：Quote0 `1.21.116`
- Research policy：`quote0-research-triage/v12`
- 本轮没有修改源码，没有 commit/push/merge/rebase/reset/clean。

## Dynamic Context Rebuild

Preflight：

- tlens `v0.2.9-89-g7dcb97e`
- tlens backend healthy
- skldr `0.3.62+introspect.d35e07a`

关键历史：

- `ctx-86cn`：v1.21.116 真实推送质量治理
- `ctx-KI15`：2026-06-02 consumer LRU 无限循环复播，历史目标是“没新料也保持墨水屏持续换画面”
- `ctx-rIGJ`：8 核心 RSS × producer 10min，单源平均约 80min 抓取一次；no-fresh 不回填旧闻
- `ctx-x6Wo`：LazyCat 双 Docker socket/daemon 坑；pkgm 应使用 `lzc-docker`，普通 SSH `docker` 不是应用运行 daemon

## 关键纠偏：LazyCat 有两个 Docker daemon

本轮开始时误用普通 `docker`（默认 `/var/run/docker.sock`）检查生产，看到只有系统容器、没有 Quote0，并错误推断 Quote0 实例消失。

考古后确认：

- 普通/default Docker：不是 pkgm 应用运行态
- LazyCat/pkgm Docker：应使用 `/lzcsys/bin/lzc-docker`
- Quote0 7 个容器实际上一直在 `lzc-docker` daemon 中运行并 healthy
- `lzc-logging-driver` 也存在于正确 daemon

以后在 LC03 检查 LazyCat 应用容器、network、plugin、restart policy 必须使用：

```bash
/lzcsys/bin/lzc-docker ...
```

应用启停使用：

```bash
/lzcsys/bin/lpk-manager stop <pkg>
/lzcsys/bin/lpk-manager start <pkg>
```

不得用普通 `docker compose` 去操作 pkgm 生成的 compose。

## 本轮误操作副作用与修复

在尚未完成上述双-daemon纠偏前，曾用普通/default Docker 在：

`/lzcsys/data/system/pkgm/run/me.friday.quote0-mcp`

尝试 `docker compose up -d`。

该操作于约 17:12 创建了错误 daemon 的 network：

- name: `mefridayquote0-mcp_default`
- default-daemon network id: `8373b69de877...`
- subnet: `172.19.0.0/16`
- gateway: `172.19.0.1`
- containers: 0
- bridge option: `lzc-br-9e5975d9`

而正确 lzc-docker Quote0 network 当时也指定同一个 Linux bridge 名 `lzc-br-9e5975d9`，但真实配置应为：

- subnet: `172.28.3.64/26`
- gateway: `172.28.3.65`

因为两个 daemon 共用宿主机 Linux network namespace，错误 network 把共享 bridge 地址改成了 `172.19.0.1/16`。Quote0 news-api 容器仍把 `172.28.3.65` 当默认网关，因此 17:12 后容器主动访问 LAN 设备失效。

现场证据：

- LC03 宿主机可正常 `ping 192.168.31.130` / `curl /status`
- Quote0 news-api 容器访问 `192.168.31.130:80` timeout
- 服务器到板子的 direct push 从约 17:12 开始 connection/timeout
- 板子主动向 Quote0 pull 仍可工作，因此出现“pull 200 但 push 失败”的非对称现象

受控修复：

1. `/lzcsys/bin/lpk-manager stop me.friday.quote0-mcp`
2. 普通/default daemon 删除仅本轮创建且 0-container 的错误 `mefridayquote0-mcp_default`
3. `/lzcsys/bin/lpk-manager start me.friday.quote0-mcp`
4. pkgm/lzc-docker 重建正确 network

修复后真实 bridge：

- `lzc-br-b617af68`
- `172.28.3.65/26`

news-api 容器随后可直接 `curl http://192.168.31.130/status`。

## 物理刷新恢复证明

修复网络后：

- 17:25:11，delivery `108500`，content `19044` → `eink-2` succeeded
- 板端 `last_push_trace_id=d108500-a1`
- 17:25:52，content `19045` → `eink-2` succeeded
- 17:26:55，content `19043` → `eink-2` succeeded
- 后续自然 delivery 持续成功

`device_runtime_state` 最终恢复：

- `device_id=eink-2`
- `health=healthy`
- `consecutive_failures=0`
- `last_success_at=2026-08-31 17:31:09+08`

板端 `/status`：

- `wifi_healthy=true`
- `last_push_error=""`
- `last_push_trace_id=d108521-a1`（后续仍在变化）

因此“物理屏幕完全不更新”的即时故障已恢复。

## 为什么用户同时感觉“总是那几条”

运行态证明 consumer 并没有停止，每 60 秒都在消费；但 v12 policy 切换把旧 v10/v11 Research 成品退出 replay 后，初始 current-policy pool 只有 3 条：

- 19043 Bun 1.4
- 19044 n8n monitor
- 19045 NAT

这三条被历史“无限 LRU”策略反复轮播：

- 19043 replay_count 曾达到 17 / max_replays=3
- 19044 replay_count 曾达到 17 / max_replays=3
- 19045 replay_count 曾达到 12 / max_replays=3

这不是近期回归：Git commit `09e4f1d` 明确在 2026-06 将 fallback 从 `replay_count < max_replays` 改为纯 LRU 无限循环，以解决当时“屏幕间隔很久才更新一次”的用户问题。因此 `max_replays` 字段目前只是历史残留语义，不能简单恢复 hard cap，否则没新货时会让屏幕停在最后一帧。

## Producer 没有停

自然 producer 仍是 10min aggregate cadence，历史设计为 8 个 core source，单源平均约 80min 抓取一次，避免把 RSS 压力放大。

最近自然运行：

- 16:57 HN → stored `19045`
- 17:07 Ars → `producer:no_fresh_candidate`
- 17:17 InfoQ → fetch_error

所以“10分钟一个 source slot + 某源 no-fresh”可能让下一个真正有新货的源等待较久。

## 受控补池与新新闻证明

在网络恢复后进行受控 producer 触发，继续遵守 producer 互斥与 v12 Research gate，得到新鲜内容：

### inventory 19046 · InfoQ

Raw：
`不抢最贵GPU，专捡“没人要”的算力：前英伟达工程师搞出一套“拾荒者”打法`

v12 Research 17:29:33 完成：

- Final title: `Sail Research获8000万美元融资`
- Message: `Sail Research正式结束隐身模式，宣布完成8000万美元融资；该公司由前英伟达工程师创立，旨在构建面向AI Agent的高效率基础设施；Sail Research的技术策略聚焦于利用非顶级GPU资源，以大幅降低AI推理成本。`
- toolCalls=8
- evidenceChars=8000
- policy=v12

17:29:55：`eink-2` delivery `108515` succeeded。

### inventory 19047 · DEV.to

Raw：`Eight Frames Said Fail. Twenty-Four Said Pass.`

Final：

- title: `预注册未定采样帧数致判定反转`
- message: `作者复盘YouTube Shorts实验发现，预注册规则未固定采样参数导致同一剪辑在8帧下判定失败、24帧下判定通过；修正分母定义错误后合规率调整为1/1，后续新增案例使比率升至2/2，作者指出缺乏自动调用机制的检查器易被遗忘。`
- Research completed
- toolCalls=3 = 2 crawl + 1 search

17:30:54：`eink-2` physical delivery `108518` succeeded。

因此当前 v12 合格池已扩到至少 5 条，且 19046 / 19047 是新鲜新闻，不是三条历史循环。

## Restart policy

`lpk-manager stop/start` 后 7 个 Quote0 容器的 restart policy 被重置为 `no`。已再次全部恢复并验证：

`unless-stopped`

## 当前裁定

用户“似乎不更新”的感觉来自两层叠加：

1. **即时物理链路故障**：本轮误用 default Docker 创建 bridge 冲突后，news-api → LAN 主动 push 在约 17:12–17:25 间失效；已明确归因并修复，真机连续成功证明恢复。
2. **内容层视觉重复**：v12 切换后 current-policy pool 初期仅 3 条，而历史无限 LRU 每分钟复播，肉眼像“没新内容”。Producer 实际仍在工作；受控补池已新增 19046/19047 并真机展示。

## 暂不修改的设计

本轮不直接恢复 `replay_count < max_replays` hard cap，因为无限 LRU 是 2026-06 为避免“无新货时屏幕长时间静止”明确做出的历史产品决策。

后续更合理的架构改进候选是：在 current-policy pool 很小时，对 producer 的 `no_fresh_candidate` 做**受预算限制的跨源 scan-ahead**，而不是提升长期 producer cadence，也不是靠三条无限循环。但该策略需要重新定义 RSS fetch budget，不在本轮未经充分验证时贸然上线。

## 未执行

- 无源码修改
- 无 Git commit/push
- 无 DB 历史记录删除/覆盖
- 无生产数据迁移
