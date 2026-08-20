# Quote0 v1.21.85 — 40×20 / 20×8 热敏标题黑条治理与生产观察

日期：2026-08-19（Asia/Shanghai）

## 工作区与 Git 边界

- 工作区：`/Users/friday/.devspace/worktrees/quote0-mcp-trmnl-5e18fa6a`
- Remote：`https://github.com/lcolok/quote0-mcp.git`
- 基线 HEAD：`70013dedb60882cbccd5f4047b692a97dbf7310f`
- 当前状态：detached HEAD、dirty；保留 v1.21.83/v1.21.84 累积渲染改动
- 未执行：commit、push、merge、rebase、release ref
- 本阶段生产版本：`v1.21.85`

## 用户观察

用户指出 40×20 mm（320×160）与 20×8 mm（160×64）目标的标题黑条面积异常。

观察成立。异常不是 PNG resize、页面 overflow 或 1-bit 转换错误，而是 Browser 布局测量与最终 Pixel Bridge 字体之间存在换行判定漂移。

## 根因证据

生产 v1.21.84 的真实内容中：

### 40×20 mm

典型一行标题：

- `主题工坊教程：建主题课程`
- `Snowflake CoCo AI降本指南`

旧结果：

```text
Browser 标题字号/行高：26 / 28.08 px
最终 Pixel 字号/行高：24 / 26 px
Browser 判断：2 行
Pixel 实际占用：1 行
标题 region：64 px
最后一个白色标题字形行：y=28
尾部纯黑空白：35 px
合理一行高度：34 px
```

### 20×8 mm

同一类标题旧结果：

```text
Browser 标题字号/行高：13 / 13.65 px
最终 Pixel 字号/行高：12 / 14 px
Browser 判断：2 行
Pixel 实际占用：1 行
标题 region：31 px
最后一个白色标题字形行：y=14
尾部纯黑空白：16 px
合理一行高度：18 px
```

真正需要两行的标题（例如 `金融科技SaaS单密钥聊天集成评测`）确实占满两行，因此不能简单把所有目标标题高度固定为一行。

## 被否决的路线

### 1. Pixel Bridge 渲染后裁掉黑条

否决原因：只能裁切图像，不能把释放出的高度重新交给正文；会破坏 TRMNL layout authority 与内容容量。

### 2. 按 40×20 / 20×8 SKU 写死标题高度

否决原因：短标题与长标题需要一行/两行动态切换；SKU 特判会重新产生第二套布局逻辑，也无法泛化到 runtime thermal 尺寸。

### 3. 恢复 terminalized DOM 跨内容 mutation

否决原因：历史 v1.21.76 已证明会把预热页或上一条内容串到后续主体；本阶段仍保持每次完整 `page.setContent()`。

## 最小修复

### TRMNL News Recipe v2

`src/react-widgets/core/trmnl-adaptive-renderer.ts`

在 `terminalize()` 之前：

1. 读取 Framework 响应式 CSS 计算出的 eyebrow/title/body/footer 字号与行高；
2. 使用现有 `selectOptimalFont()` 映射到最终 Fusion Pixel 可复现字号；
3. 使用物理像素字体的 canonical 行高：`snappedFontPx + 2`；
4. 将量化后的字号/行高以 inline important 写回当前新页面；
5. 再运行 TRMNL `terminalize()`，让换行、Clamp、Content Limiter 和 region 测量基于最终物理字体。

版本：

```text
quote0-news-recipe/v2
trmnl-framework-browser/v3.2.0+quote0-news-v2
trmnl-layout-satori-pixel/v2
renderer-governance/v3
renderer-review/v5
renderer-self-check/v2
```

这不是跨内容 DOM 复用。每条内容仍然经过全新 HTML、字体 readiness、Framework 初始化和 terminalize。

## 新增标题黑条自检

`src/api/renderer-review-service.tsx`

新增 `measureTitleBarUtilization()`，直接检查最终物理 1-bit plane：

- 在 title region 中按物理 line box 扫描白色标题字形；
- 计算实际占用标题行数；
- 计算内容需要的标题高度；
- 报告多余纯黑行、裁切行与允许的量化容差；
- 多余黑尾或裁切会令 physical candidate self-check FAIL。

Review UI 现在显示：

```text
标题黑条：PASS / FAIL
实际高度 / 内容需要高度
标题行数
多余纯黑像素行
裁切风险
```

## 验证

### 聚焦测试

```text
21 pass
0 fail
151 expects
TypeScript build PASS
```

新增或覆盖：

- 26px Browser → 24px Pixel、13px → 12px 的量化；
- 64px 两行 region + 一行物理字形会被 self-check 拒绝；
- 34px 一行 region 通过；
- standard / micro Pixel Bridge；
- 296×152 Current bit-exact regression。

### 全仓 Release Gate

```text
232 pass
0 fail
7020 expects
base image digest guard PASS
version governance PASS
git diff --check PASS
production TypeScript build PASS
```

### Annotation Web

```text
build PASS（1602 modules）
mobile WebKit PASS
desktop Chromium PASS
2 个交叉 project 按设计 skipped
```

### 本地真实 Chrome + TRMNL + Pixel 矩阵

十组中英文混排标题在两个热敏目标均通过：

#### 40×20

```text
一行标题：title 34 / body 109 / footer 17
两行标题：title 60 / body 83 / footer 17
所有样本 excessRows = 0
所有样本 titleBar = pass
```

#### 20×8

```text
一行标题：title 18 / body 46 / footer 0
两行标题：title 32 / body 32 / footer 0
所有样本 excessRows = 0
所有样本 titleBar = pass
```

296×152 的 Inkive 与 KMP 样本继续保持最终 plane 与 Current/Satori byte-for-byte 相同。

## 构建与部署

### 镜像

- annotation-web `v1.21.85`
  - registry digest：`sha256:3734bd9b35014c8970a705118a19a9201a302b0599cad6b934df8f587524fd10`
  - running image id：`sha256:320e31bd55e596337791ebb3610aa6a1d49d6187f964e6c8e5da8ff18444ae17`
- news-api `v1.21.85`
  - registry digest：`sha256:791eb38dc6acffb18f66dd503ab4a5444ccc9eaa8537f90f92d2d0f189e8d96e`
  - running image id：`sha256:1f0aa32e2dfa971d092fec93789e7f25505dcfffd224f20b1723d10956616fe0`

### LPK

- `lazycat/me.friday.quote0-mcp-v1.21.85.lpk`
- SHA-256：`8d5ffee0e089c078ee17a12215f4208e0ef73c34a197ab5afea06e11cf4527cc`
- 安装结果：`Installation successful!`

LPK 仍有既有 legacy v1 / App Store lint 债务，本阶段没有扩大到包格式迁移。

## 生产验收

### 运行状态

- `/api/health.version = 1.21.85`
- news-api、annotation-web、label-web、app sidecar、PostgreSQL、MinIO、Redis 全部 healthy
- 六个长生命周期服务 restart policy：`unless-stopped`
- 本地候选与运行 news-api 关键源码 SHA 完全一致
- Annotation bundle 包含 `标题黑条` UI 标记
- 新 comparison cohort 人工评审行数：`0`，没有伪造偏好

### 旧问题样本回放

#### 40×20

```text
348002 主题工坊教程：建主题课程
  title 34 / required 34 / 1 line / excess 0 / PASS

347999 Snowflake CoCo AI降本指南
  title 34 / required 34 / 1 line / excess 0 / PASS

348000 金融科技SaaS单密钥聊天集成评测
  title 60 / required 60 / 2 lines / excess 0 / PASS

347998 阿里云野心不在Agent Builder
  title 60 / required 60 / 2 lines / excess 0 / PASS
```

#### 20×8

```text
348002 / 347999
  title 18 / required 18 / 1 line / excess 0 / PASS

348000 / 347998
  title 32 / required 32 / 2 lines / excess 0 / PASS
```

所有样本均：

```text
pointToPoint = true
resizeApplied = false
criticalOverflow = false
physicalCandidate.status = pass
```

40×20 在上述样本中同时与 Current legacy projection `XOR=0`；20×8 保留 micro recipe 的不同内容语义，因此不要求与 legacy projection exact。

### 滚动观察

部署后连续三轮观察最新真实新闻，覆盖：

- Palomar建Lean数学验证库
- 越南晚唐沉船视频讲解
- 超级强国非超级智能
- Meta申请人脸识录专利
- 人类睡眠何处出错

两个目标全部：

```text
titleBar = pass
excessRows = 0
clippedRows = 0
physical candidate = pass
pointToPoint = true
overflow = false
```

缓存延迟：

```text
40×20：0.212s
20×8：0.116s
```

资源快照：

```text
news-api       717 MiB / 1 GiB，201 PIDs
annotation-web 13.62 MiB / 128 MiB，17 PIDs
```

观察窗内无 Renderer A/B、title-bar self-check、panic、fatal、OOM、unhandled 或 uncaught error。

## 当前边界与下一步

- 20×8 的正文空间天然非常有限；本次只消除了错误黑尾，未宣称长标题 + 长正文的信息保留已经达到最终质量。
- Browser/Chromium 常驻约 717 MiB，仍是独立 P1 资源治理项。
- 生产源码尚未 commit / push / 创建 `release/v1.21.85` ref，远端 Git 可复现性仍未收口。
