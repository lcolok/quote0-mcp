# Quote0 v1.21.84 Renderer 正式部署观察报告

日期：2026-08-19（Asia/Shanghai）

## 工作区 / Git 边界

- 工作区：`/Users/friday/.devspace/worktrees/quote0-mcp-trmnl-5e18fa6a`
- Remote：`https://github.com/lcolok/quote0-mcp.git`
- 基线 HEAD：`70013dedb60882cbccd5f4047b692a97dbf7310f`
- 当前工作区：detached HEAD、dirty
- 未执行：commit、push、merge、rebase、release ref
- 本轮未重复覆盖同一 `v1.21.84` tag；运行容器已经是此前完成构建和 LPK 安装的正式 `v1.21.84`，本轮验证运行镜像身份后直接进入观察窗。

## 正式部署身份

运行容器：

- `news-api`: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.84`
  - local image id: `sha256:d83e272a8e6428f56247bb8a707b443085f9cd94631934c52644022022025131`
  - health: healthy
  - restart policy: `unless-stopped`
- `annotation-web`: `dev.logic.heiyu.space/friday/quote0-annotation-web:v1.21.84`
  - local image id: `sha256:a8371f0c55ad1c461cf9ce115e0f71d8c6240023bc3409fdd3aca06f87f5766f`
  - health: healthy
  - restart policy: `unless-stopped`
- `/api/health.version = 1.21.84`
- app sidecar、label-web、PostgreSQL、MinIO、Redis 均 healthy。

## 观察方法

### Renderer 正确性观察

连续四轮、每轮间隔约 45 秒：

1. 查询生产健康接口；
2. 获取最新四条真实 review subject；
3. 对每条调用：
   - `GET /api/review/renderers/:id?targetId=eink-296x152`
4. 记录：
   - physical self-check status；
   - A/B 是否 exact；
   - XOR changedPixels；
   - point-to-point / resize；
   - Browser Probe 状态与差异；
   - candidate / browser render time。

观察期间共覆盖 6 条不同真实新闻：

- `347978` GitHub加固安全策略引争议
- `347979` 欧委会2022平台前瞻研究
- `347980` 孔雀盈利后涨价18%
- `347981` 数据库安全连接六层防护详解
- `347982` 美警惕中国太空计划威胁
- `347983` Claude Code误判弃查Cilium夺

### 稳定性观察

随后执行三轮稳定性采样、每轮约 30 秒：

- news-api / annotation-web CPU、内存、PIDs；
- 最新真实 subject 的 Renderer Review HTTP 延迟；
- Renderer / TRMNL / Pixel Bridge 日志扫描。

## 正确性结果

6 条真实内容、所有观察轮次均满足：

```text
physical self-check = pass
exactVsPrimary = true
changedPixels = 0
pointToPoint = true
resizeApplied = false
```

即主 B 候选 `trmnl-layout-satori-pixel/v1` 的最终物理 1-bit plane 与 Current/Satori byte-for-byte 一致。

Browser Probe 均被正确排除出 A/B：

```text
browserProbe.status = rejected
```

Browser 1-bit 差异范围：

- changed pixels：`2,970 .. 7,922`
- changed ratio：`6.60% .. 17.61%`

这证明新的治理语义正常工作：Browser 负责 TRMNL layout measurement，但其 antialiased raster 不再冒充物理候选。

## 延迟观察

新鲜 subject 首次 Review：

- 约 `0.55s .. 1.38s`
- 部分日志端到端首次请求约 `0.66s .. 2.0s`

相同 subject 缓存命中：

- 约 `0.09s .. 0.23s`
- 最后一次直接测量：`0.217s`

观察结论：交互缓存路径稳定；首次 Browser measurement 仍是主要延迟源，但没有 correctness regression 或请求失败。

## 资源观察

三次 news-api 采样：

```text
CPU:    0.44% / 3.86% / 0.49%
Memory: 612.7 / 623.1 / 619.5 MiB（limit 1 GiB）
PIDs:   207 / 208 / 206
```

annotation-web：

```text
CPU:    0.00%
Memory: 13.73 .. 13.75 MiB（limit 128 MiB）
PIDs:   17
```

短观察窗内没有持续单向内存或 PID 增长证据。news-api 的约 620 MiB / 206+ PID 主要来自 Chromium renderer 进程族，属于仍需关注的 P1 资源成本，但当前没有接近 1 GiB limit 或 OOM 迹象。

## 日志结论

观察窗内：

- 无 Renderer A/B 失败；
- 无 self-check fail；
- 无 TRMNL / Pixel Bridge fatal、panic、unhandled 或 uncaught error；
- 所有 Renderer Review 请求均 HTTP 200。

发现两类既有设备投递连接告警：

- `eink-1`（客厅 e-ink）connection retry；
- `eink-3`（S3 2.66寸墨水屏新板）connection retry。

两台设备目前仍为 enabled；告警与 Renderer v1.21.84 无关，未影响 `eink-2` 或 Review 服务。本轮不擅自禁用设备。

## 结论

`v1.21.84` 已处于正式生产运行状态，Renderer 治理在真实滚动内容上通过：

- 主候选是 Pixel Bridge，而非 Browser raster；
- 最终物理位平面自检真实执行 XOR；
- 6 条真实内容全部 A/B `changedPixels=0`；
- Browser Probe 的 6.60%–17.61% 差异被如实暴露并排除；
- 服务健康、缓存路径稳定、观察窗内无 renderer error。

## 风险 / 下一步

1. Git 尚未 commit / push / release ref 收口，生产源码的远端可复现性仍未完成。
2. Browser 首次 measurement 约 0.55–1.38s，news-api Chromium 常驻约 620 MiB / 206+ PIDs；下一阶段可治理 measurement/cache/worker 资源生命周期，但不得恢复曾导致串内容的 terminalized DOM mutation 路线。
3. `eink-1` 与 `eink-3` 的持续 connection retry 应作为独立设备运维任务治理。
