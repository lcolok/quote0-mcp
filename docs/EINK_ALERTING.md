# E-Ink Device Health Alerts

quote0 的 E-Ink 告警不是“每次 delivery 失败就推 Bark”，而是基于 `device_runtime_state.health` 的**状态迁移**通知。

## 触发语义

| 迁移 | 通知 |
|---|---|
| `healthy/unknown → degraded` | warning |
| `healthy/degraded/unknown → offline` | critical |
| `healthy/degraded/unknown → misconfigured` | critical |
| `degraded/offline/misconfigured → healthy` | recovery / info |
| 同状态 | 不通知 |
| `offline/misconfigured → degraded` | 不通知，仍未完全恢复 |

`delivery-policy.ts` 本身已有连续失败阈值，因此单次网络抖动不会直接产生 degraded/offline 通知。

## Outbox 设计

健康状态更新与 `device_health_alerts` enqueue 在同一个 PostgreSQL 事务中；Bark HTTP 请求不在 delivery worker 内执行。

独立 `device health alert worker`：

1. 从 outbox 用 `FOR UPDATE SKIP LOCKED + lease` 认领；
2. 同一设备严格按事件 ID 串行，避免 recovery 比 failure 先送达；
3. 发送成功 → `sent`；
4. 发送失败 → `retry_wait`，按 1m → 5m → 15m → 1h 退避；
5. 5 次耗尽 → `dead`；
6. 进程崩溃后 lease 过期可重新认领。

告警 outbox 是**旁路**。enqueue SQL 即使失败，delivery/runtime state 仍必须成功提交；实现使用 PostgreSQL SAVEPOINT 隔离该失败。

## 配置

LazyCat manifest 只声明占位符，不保存真实 device key：

```text
BARK_ALERTS_ENABLED=true
BARK_DEVICE_KEY=<set-via-lazycat-console>
BARK_BASE=https://bark.logic.heiyu.space
BARK_GROUP=quote0-eink
```

`BARK_DEVICE_KEY` 必须通过部署环境/懒猫控制台注入。代码会把空值和 `<set-via-lazycat-console>` 视为未配置。

未配置 Bark 时，状态迁移仍会以 `skipped` 写入 outbox，记录“为什么没有通知”，但不会积压永远发不掉的 pending 事件。

## Bark 请求

发送采用 POST `application/x-www-form-urlencoded`，显式检查：

- HTTP 必须 2xx；
- 若响应是 JSON 且包含 `code`，必须为 `200`；
- critical 事件携带 `level=critical`、`volume=5`；
- device key 不写日志、不进入告警正文。

## 只读运维 API

```text
GET /api/device-alerts
GET /api/device-alerts?device_id=eink-2&state=retry_wait
GET /api/device-alerts?level=critical
GET /api/device-alerts/status
```

`/api/device-alerts/status` 只返回：

- `barkConfigured: true/false`
- 各 outbox state 数量

不会返回 device key 或 Bark URL 中的凭据。

## 故障处理

- `pending/retry_wait` 持续增长：检查 Bark 网络、base URL、device key。
- `dead` 增长：Bark 已连续失败到重试耗尽，需要人工处理。
- `skipped` 增长且 `barkConfigured=false`：部署环境尚未配置 Bark。
- delivery 正常但 Bark outbox 异常：不要把通知故障误判为设备投递故障，两条链路故意解耦。

## 尚未包含

当前实现不自动发送每日 Bark self-test。后续若启用生产 Bark，应再增加独立 channel self-test/heartbeat；不要用伪造设备故障来测试通知链路。
