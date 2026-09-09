# Quote0 Adaptive Layout Framework v1

## 目标

同一份语义内容只描述“是什么、哪个信息更重要”，不携带固定画布坐标或设备模板。运行时由 `RenderTarget` 提供真实宽高/DPI/介质，Adaptive Layout Engine 生成可审计的布局计划，再由 Satori / TRMNL 等 backend 渲染。

```text
Direct / Neuromancer / Memo / Label content
                ↓
         AdaptiveDocument
                ↓
       Adaptive Layout Engine
                ↓
        AdaptiveLayoutPlan
          ↙             ↘
   Satori backend    TRMNL backend
      fast-ish         fidelity
          ↘             ↙
            PNG / 1-bit
                ↓
            RenderTarget
```

布局决策属于 Quote0；TRMNL 是 fidelity runtime，不拥有领域数据；Satori 是另一 renderer backend，不拥有布局策略。

## v1 IR

核心文件：`src/react-widgets/core/adaptive-layout.ts`。

### AdaptiveDocument

当前 v1 支持文本节点：

- `eyebrow`
- `title`
- `body`
- `keyword`
- `meta`
- `footer`

节点携带 renderer-neutral constraints：

- `priority`: critical / high / medium / low
- `minLines`
- `preferredLines`
- `optional`
- `overflow`: fit / clamp / omit
- `baseFontPx`
- `minFontPx`

### AdaptiveLayoutPlan

每次布局都会产出可审计计划：

- layout engine version
- document / target identity
- density tier
- padding / gap / fontScale
- 每个节点的 visible / clampLines / fontPx / estimatedHeight
- hidden / visible node ids
- fit decisions
- overflowRisk

Plan 是 renderer-independent 的 SSoT。backend 不允许拿另一个 target 的 plan 静默拉伸。

## Runtime density policy

v1 不按 target 名称维护模板表，只按运行时几何派生 density：

- `micro`: 高度 <= 80px 或宽度 <= 180px
- `compact`: 高度 <= 132px
- `standard`: 高度 <= 190px
- `comfortable`: 更大画布

这是连续 RenderTarget 模型上的第一层离散策略，不是 SKU 模板。

以当前真实 Neuromancer/MCP 样本为例：

| Target | Density | 可见节点 |
|---|---|---|
| 160×64 / T20×8 | micro | title, body, keyword |
| 296×128 | compact | title, body, keyword, meta, footer |
| 296×152 | standard | eyebrow, title, body, keyword, meta, footer |
| 320×160 / T40×20 | standard | 全部 |
| 400×240 / runtime T50×30 | comfortable | 全部 |

因此目标变化时不是“整张模板同比缩小”，而是语义节点按优先级自动省略/收缩。

## Fit 顺序

v1 planner 使用确定性顺序：

1. 由 density 限制各 role 的最大行数和低价值节点可见性；
2. 根据宽度、字体和 CJK/ASCII visual units 估算换行；
3. 必要时压缩 gap；
4. 从低优先级开始减少 clamp lines；
5. 仍放不下时省略 optional 节点；
6. 最后在受限范围内降低 fontScale；
7. 仍无法满足才标 `overflowRisk=true`。

TRMNL 的 Clamp / Content Limiter 作为真实 DOM runtime 的第二层保险，不替代 Quote0 planner。

## Backend 1 — TRMNL Framework 3.2

`src/react-widgets/core/trmnl-adaptive-renderer.ts`

- pinned Framework 3.2.0
- Chromium fidelity path
- runtime custom target dimensions
- CJK Fusion Pixel font
- 使用同一 `AdaptiveLayoutPlan` 决定 node visibility / clamp / typography / gap
- canary API 返回 `layoutPlan`
- API status 返回 `layoutEngine=adaptive-layout/v1`

安全边界：Layout Plan 含用户文本，因此不把完整 plan JSON 注入 inline browser script；只在服务端结果中回传。

## Backend 2 — Satori

`src/react-widgets/core/adaptive-satori-renderer.tsx`

- 使用同一 plan
- child block 高度由 `clampLines × lineHeight` 决定
- overflow hidden 做 fast-path clip
- plan target identity 不匹配时 fail closed，禁止 silent stretch
- `SatoriRenderer` 暴露 pipeline metrics：font init / Satori SVG / Resvg init / Resvg render
- Adaptive backend 只把当前 Plan 实际需要的 8/10/12px font families 传给 Satori
- Resvg 显式 `loadSystemFonts:false`：Satori 已 `embedFont:true`，避免每张 PNG 无意义扫描宿主系统字体

这证明 Adaptive IR 不是 TRMNL 专用抽象，也恢复了真正的低延迟 fast path。

## 真实矩阵 Harness

运行：

```bash
bun run adaptive:smoke
```

脚本：`scripts/adaptive-layout-matrix-smoke.ts`。

同一个真实 Neuromancer/MCP 内容一次跑 5 个 target × 2 backend。

2026-08-18 当前实测：

- 5/5 target 的 Satori/TRMNL `AdaptiveLayoutPlan` 完全一致
- 10/10 PNG 尺寸精确匹配目标
- 5/5 TRMNL DOM horizontal/vertical overflow = false
- 10/10 PNG 都可真实 pack 为目标长度的 MSB-first 1-bit bitmap
- 10/10 packed bitmap 非空，foreground bounds 均留在目标画布内部
- TRMNL Framework runtime build = `plugins.js v3.2.0`

Satori 性能治理前，真实热态约 1.8–3.0s/张。分段 profiler 证明瓶颈几乎完全在 `new Resvg(svg)`：

- font init：热态约 0ms
- Satori React→SVG：约 3–18ms
- Resvg constructor：Bun 热态约 1.7–1.8s；Node 热态约 0.82–0.89s
- 真正 `resvg.render()`：约 1–3ms

根因是 Resvg 默认加载宿主系统字体；Satori 已经 `embedFont:true`，该工作完全冗余。设置 `font.loadSystemFonts=false` 后：

- Bun 冷态：约 42–77ms（含字体/Satori warm-up）
- Bun 热态：当前 5-target matrix 约 **4.6–18.4ms/张**
- 原有生产 `SatoriNewsWidget.render` 隔离子进程回归从约 1.9–2.1s 降到约 100ms（该数字包含 Bun 子进程启动）
- PNG/1-bit 回归全部通过

TRMNL fidelity path 仍约 3.3–4.2s，且偶有更高网络长尾；因此现在“**Satori fast / TRMNL fidelity**”不再只是架构假设，而有当前实测支撑。

## 与 Neuromancer 的职责边界

Neuromancer 应输出语义内容和证据，不输出物理布局：

```text
title
summary/body
claims / sources
highlights / keywords
importance / contentClass
```

Quote0 adapter 再生成 `AdaptiveDocument`。

当前已经落地 `renderableNewsToAdaptiveDocument()`：直接消费既有 `RenderableDataItem` / Neuromancer Research Receipt，映射 title/message/highlights/source/receipt counts；`publishTime` 明确不进入布局 IR，物理宽高也不进入内容 adapter。

因此 296×128、296×152、不同热敏纸宽高不需要 Neuromancer 分别重写 prompt，也不应该让模型决定字号和坐标。

## Production Shadow Renderer

`src/react-widgets/core/adaptive-shadow-renderer.ts` 已把 Adaptive Satori 接到真实 `renderSingleEinkTarget()` 之后，但仍保持**非权威旁路**：

```text
real RenderableNews
  ↓
旧 SatoriNewsWidget → primary PNG → frame / device delivery（唯一权威结果）
  │
  └─ setImmediate → bounded shadow queue (concurrency=1)
                    ↓
             AdaptiveDocument
                    ↓
             AdaptiveLayoutPlan
                    ↓
             Adaptive Satori PNG
                    ↓
           两侧都 pack 为 1-bit
                    ↓
      adaptive_render_shadow_runs evidence
```

安全/治理约束：

- `QUOTE0_ADAPTIVE_SHADOW_ENABLED` 显式开关；当前候选 manifest 设为 true，但未部署前不影响生产。
- queue 默认 32、最大 256；满时 drop，不反压真实 delivery。
- 用 `setImmediate` 而不是 microtask，让生产调用方的 Promise continuation / 物理推送先获得执行机会。
- 单并发 shadow；pending 重复去重；成功 key 有 bounded 2048-entry 进程内缓存；DB 还有 `shadow_key UNIQUE` 作为最终幂等边界。
- shadow failure 持久化为 `failed`，但不 throw 回真实渲染/推送调用方。
- `shadow_key` 基于语义 content fingerprint + target + layout/renderer version，不使用 `publishTime`；URL 去掉 hash/常见 tracking 参数。
- 详细 LayoutPlan/正文证据 API 不在 LazyCat `public_path`，继续由 SSO 边界保护。

持久证据表 `adaptive_render_shadow_runs` 保存：

- content/subject/target identity
- device ids
- layout plan
- primary/shadow Satori pipeline metrics
- primary/shadow 1-bit burn density + bounds
- `comparison_metrics`：burn delta / ratio、render latency delta / ratio
- primary PNG path、error/state

可观测 API：

```text
GET /api/renderers/adaptive/shadow/status
GET /api/renderers/adaptive/shadow/recent?limit=20
```

异步 `content_inventory → delivery worker` 重建 `RenderableDataItem` 时现在保留 `processed.highlights` 与 `metadata.researchReceipt`，并兼容旧行从 `raw_content.researchReceipt` 回收，避免 Neuromancer Research 在 shadow 层被错误降级为普通 RSS。

真实 shadow smoke：

```bash
bun run adaptive:shadow:smoke
```

对同一 Neuromancer/MCP 内容分别跑 296×128 / 296×152 的旧 primary + Adaptive shadow：

- 2/2 completed
- 两侧 1-bit packed bytes 全部精确且非空
- 296×128：primary burn ratio ≈ 0.2407，Adaptive ≈ 0.0765；Adaptive 少 6222 个 burn bits
- 296×152：primary ≈ 0.2478，Adaptive ≈ 0.0946；Adaptive 少 6891 个 burn bits
- 该差异主要来自旧卡黑底 title banner；它是打印/视觉成本代理，**不是自动质量结论**，必须交给后续 E-Ink/打印 A-B Review。

## 与旧 NewsLayoutSpec 的关系

`RenderTarget.newsLayout` / `deriveNewsLayout()` 仍是当前生产 SatoriNewsWidget 的兼容路径，不在 v1 中删除。

Adaptive v1 是新 seam：先通过 canary / harness 验证，再逐个消费者迁移。禁止为了“统一”一次性重写现有 production news / weather / label pipeline。

## 下一阶段

已完成的原 P0：

- Satori pipeline profiler + fast-path 根因修复
- visual/1-bit matrix 基础指标（packed length / burn density / foreground bounds）
- `RenderableDataItem` / Neuromancer Research → `AdaptiveDocument` adapter

接下来：

已完成的原 P0：production shadow renderer、持久 A/B evidence、bounded 非阻塞队列、observability API、Neuromancer metadata fidelity。

P0：部署后只观察 shadow 数据，不改变物理输出；积累真实新闻按 target/source/content-class 的 burn/render/overflow 分布，并建立异常阈值。

P1：把热敏 label content 接入同一 IR，验证未知 runtime paper size 不需要新增模板。

P1：补视觉 golden / 人工 A-B Review，评价 fast Satori 与 TRMNL fidelity 的信息保留、字体观感、1-bit 清晰度，而不是把像素差异误当错误。

P2：根据真实 Review/打印/E-Ink 反馈优化 density/priority policy；反馈作用于一个 Adaptive Layout policy，而不是分别调多个 renderer 模板。
