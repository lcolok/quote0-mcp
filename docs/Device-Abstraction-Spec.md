# 标签设备化抽象 Spec（Device Abstraction）

> 状态：Phase 1 大部分已施工（schema/kind/capabilities/OutputSink/deviceId 路由均已上线）；
> 2026-07-18 补上 `push_devices.dpi` 静态属性 + niimbotSink 按设备 dpi 动态重算 px，
> 替代不稳定的 BLE 运行时侦测（`niimbot-client.ts` 那条 legacy 路径未动，仍走 env + BLE）。
> **回溯影响**：`niimbot-main` 设 `dpi=300`（B1 Pro 实测机头 DPI）后，不只新尺寸，
> 连既有默认 40×20 标签的打印像素也从 320×160（203dpi 换算）变成 472×236（300dpi 换算）——
> 这是修正历史尺寸偏差，不是新 bug；真实机型 DPI 务必和硬件确认后再改 push_devices.dpi。
> Phase 2（前端设备选择 UI）、Phase 3（能力校验/多设备并发）仍待施工。
> 日期：2026-06-15
> 背景来源：会话编辑器打印按钮需求 → 深挖出"设备=尺寸+输出通道，必须在生成时绑定"的架构问题

## 1. 目标

把"标签打印"从**硬编码单设备 niimbot** 升级成**完整设备化**：

- 设备有**明确分类(kind)**，每类对应**可做的行为(capabilities)**（热敏打印机→打印贴纸；墨水屏→推送显示）。
- 设备 = **尺寸 profile(RenderTarget)** + **输出通道(sink)**，二者绑定。
- **选设备发生在生成阶段**（决定尺寸+通道），不是打印时——因为不同设备尺寸比例不同，**图无法跨设备复用**（这是核心约束，必须从根上锁住）。
- 输出时按 `label.target_id` 的 kind **自动路由**到对的通道，且设备 kind 必须匹配 target.kind，杜绝"尺寸不对硬塞"。

## 2. 现状（2026-06-15 调研结论）

**两套完全分离的系统**：

| 系统 | 位置 | 有无分类 | 用途 |
|------|------|---------|------|
| **RenderTarget**（尺寸+渲染规格）| `src/react-widgets/core/render-targets.ts` + `render_targets` 表(`postgres-database.ts:780`) | ✅ 有 `kind`('eink'\|'thermal-label') | 指导图像生成尺寸 |
| **push_devices**（物理硬件端点）| `push_devices` 表(`postgres-database.ts:230`) + `src/api/devices-api.ts` | ❌ 无 kind、无 capabilities | 墨水屏/新闻推送的硬件列表 |

- 内置 RenderTarget 两个：`EINK_TARGET`(296×152, kind=eink)、`LABEL_T40X20_TARGET`(320×160, kind=thermal-label)。`render-targets.ts:13/23`。
- `labels.target_id` / `label_batches.target_id` 已绑定 RenderTarget（默认 `label-T40x20-320`）。批次创建已接受 `targetId` 参数(`label-batches-api.ts:36/60`)，但**前端 BatchCreatePage 没暴露选择**，永远默认 niimbot 标签尺寸。
- **标签打印完全独立硬编码**：`label-batches-api.ts:391` 的 `POST /:id/print` 用 `body.niimbotEndpoint || process.env.NIIMBOT_ENDPOINT`，**不走 push_devices 表**，无设备选择。
- **三套推送路由各自为政**：memo 用 `memos.target_renderer`('device'|'local-eink'|'both')；标签用 endpoint 硬编码；news 用 `NEWS_SCHEDULER_EXTRA_RENDERERS` env。
- **两套 sink 接口不一致**（待统一）：
  - `niimbotPush.push(bitmap, target, endpoint, opts)` — `niimbot-push-module.ts:16`，接 RenderTarget + endpoint，**有 503 退避重试**(已强化 v1.18.15)。
  - `pushToEinkDevice(device, bitmap)` — `eink-converter.ts`，接 EinkDevice，遍历 enabled push_devices，**无重试**。
  - MindReset 云端：`device-pusher.ts` 的 `pushToMindReset`（走 send-server-dither CLI）。
- 前端已有 `MemoTargetSelector.tsx`（渲染器类型 3 选 1，非具体设备）；`devices-api.ts` 有设备 CRUD（GET/POST/PATCH/DELETE `/api/devices`），但字段无 kind/capabilities。

## 3. 设备化设计

### 3.1 统一设备模型（扩展 push_devices）

```
设备 Device {
  id, name, base_url, token, enabled, width, height,   // 现有
  kind: 'thermal-printer' | 'eink-local' | 'eink-cloud',  // 新增:分类
  capabilities: string[],   // 新增:可做行为, 如 ['print'] / ['display']
}
```

### 3.2 分类 → 行为 → 通道 映射

| kind | 可做行为 capability | 输出 sink | 匹配 RenderTarget.kind |
|------|--------------------|-----------|----------------------|
| `thermal-printer`(niimbot) | `print`(出贴纸) | NiimbotSink | `thermal-label` |
| `eink-local`(ESP32-C3 墨水屏) | `display`(推送显示) | EinkSink | `eink` |
| `eink-cloud`(MindReset 云屏) | `display` | MindResetSink | `eink` |

### 3.3 统一 OutputSink 接口

```ts
interface OutputSink {
  kind: DeviceKind;
  send(bitmap: Buffer, device: Device, target: RenderTarget): Promise<{ ok: boolean; status?: number; error?: string }>;
}
// NiimbotSink(包现有 niimbotPush) / EinkSink(包 pushToEinkDevice) / MindResetSink
// 注册表按 device.kind 选 sink
```

### 3.4 设备 ↔ target 关联（核心约束）

- 生成：批次/会话创建时**选设备** → 取设备的 target → 按 target 尺寸渲染 → `label.target_id` 落定。
- 输出：按 `label.target_id` 找 RenderTarget；选定设备的 `kind` **必须匹配** `target.kind`，否则拒绝（"`thermal-label` 的图不能发 eink-display"）。
- `target_id`(逻辑/生成规格) 与 `device_id`(物理/输出硬件) **保持分离但通过 kind 校验关联**：一个 label 可由多台同 kind 设备输出。

## 4. 分阶段实施

### Phase 1 — 后端设备分类化 + 统一路由
1. **schema**：`push_devices` 加 `kind`、`capabilities` 列。
   ⚠️ **必须走独立 migration runner**——`postgres-database.ts` 的建表是 `CREATE TABLE IF NOT EXISTS`（if-missing-only），对已存在的表**永不执行 ALTER**，新列加不上。见 memory `feedback_quote0_schema_migration_trap`。
2. `devices-api.ts` 的 POST/PATCH 接受 kind/capabilities；DB 接口 `createPushDevice`/`updatePushDevice` 同步。
3. 新建 `src/react-widgets/core/output-sinks.ts`：`OutputSink` 接口 + NiimbotSink/EinkSink/MindResetSink + 按 kind 的注册表/路由。
4. 打印/推送统一入口：`label-batches-api.ts` 的 `/print` 从 `endpoint` 参数改 `deviceId`，查 push_devices → 取 kind → 校验匹配 target.kind → 经 sink 发送。保留 env 兜底。
5. 为现有 niimbot 打印机、ESP32 墨水屏在 push_devices 表里建初始设备记录（含 kind）。

### Phase 2 — 前端设备 UI
1. `BatchCreatePage` 加设备选择器（按 kind 过滤，选设备 → 决定 targetId）。
2. 设备管理页/`devices-api` 前端加 kind/capabilities 编辑。
3. 会话编辑器 `SessionEditorDialog` 加输出按钮：**按设备 kind 显示行为名**（thermal-printer→"打印"，eink→"推送到屏"）。复用统一组件。
4. 抽出 `<DeviceActionButton>`/`<PrintController>` 组件，batch 页和会话编辑器共用，含失败列表反馈。

### Phase 3 — 能力校验 + 多设备
1. 能力校验：输出前校验 `device.capabilities` 含所需 action。
2. 多设备并发推送（一张图发多台同 kind 设备）。
3. 统一 memo/news/标签 三套路由到同一设备体系（可选，大改）。

## 5. 关键陷阱（务必遵守）

- **schema migration 坑**：加列必须独立 migration runner，不能只改 `CREATE TABLE IF NOT EXISTS`。委派施工必塞此约束。见 `feedback_quote0_schema_migration_trap`。
- **漏打根因（已部分止血 v1.18.15）**：
  - 固件侧 P0：ESP32 `niimbot` app 打印队列深度仅 2（`orchestrator.h:118 kQueueDepth=2` + raw_slots=2），批量发 3+ 个第 3 个起 503 "queue full"。**根治要把队列 2→8 并烧录**，走 `/Users/friday/github/esp32-health-station/src/apps/niimbot`（C②，未做）。
  - 服务端已止血：`niimbot-push-module.ts` 503 改成 2/4/6/8/10s 退避重试 6 次（覆盖固件队列等待窗口）；打印 API 打印前回填 label_id；前端显示失败列表。
- **部署**：lazycat-subdir 布局，走 CLAUDE.md「正确的部署流程」+ memory `feedback_lazycat_deploy_no_local_docker`。每次 bump 后**对齐 api+label-web 镜像 tag**（只改一端就把另一端 tag 改回上一个存在版本）。
- **设备语义别混**：niimbot=打印贴纸(出纸)，eink=屏显(不出纸)，是不同行为，不能笼统当"打印多设备"。

## 6. 关键文件索引

| 关注点 | 文件:行号 |
|--------|----------|
| RenderTarget 定义(有 kind) | `src/react-widgets/core/render-targets.ts:1-35` |
| render_targets 表 | `src/react-widgets/core/postgres-database.ts:780` |
| push_devices 表(待加 kind) | `src/react-widgets/core/postgres-database.ts:230` |
| labels.target_id | `src/react-widgets/core/postgres-database.ts:801` |
| 标签打印 API(待改 deviceId) | `src/api/label-batches-api.ts:391` |
| niimbot sink(503 强重试已上线) | `src/react-widgets/core/niimbot-push-module.ts:16` |
| eink sink | `src/api/eink-converter.ts` |
| MindReset/统一推送 | `src/api/device-pusher.ts` |
| 设备 CRUD API(待加 kind) | `src/api/devices-api.ts` |
| 批次创建(待加设备选择) | `label-web/src/pages/BatchCreatePage.tsx` |
| memo 设备选择器(可参考) | `label-web/src/components/MemoTargetSelector.tsx` |
| 会话编辑器(待加输出按钮) | `label-web/src/components/SessionEditorDialog.tsx` |
| ESP32 niimbot 固件(队列深度 C②) | `/Users/friday/github/esp32-health-station/src/apps/niimbot/printer/orchestrator.h:118` |
