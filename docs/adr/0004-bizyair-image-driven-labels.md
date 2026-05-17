# ADR-0004：BizyAir AI 图像驱动的热敏标签

- **状态（Status）**：Proposed — Phase F 待实施
- **日期（Date）**：2026-05-18
- **决策者**：lcolok + Claude（指挥官模式）
- **相关变更**：在 ADR-0002（多目标渲染抽象）/ ADR-0003（Phase E React 组件驱动）之外**新开一条独立创作管线**；与 Phase E 完全解耦、并行存在；不影响 v1.0.39 已部署能力

---

## 1. 上下文（Context）

### 1.1 触发事件

2026-05-18 用户在阅读 `ctx-tvny`（Copilot API 服务端点总览，含 BizyAir CLI 图像生成 NBP/NB2/SD5/GPT-Image-2）后提出：

> "接下来我觉得可以把 bizyair/v1/cli/ 的做图的能力集成到我们的标签制作系统当中，作为另外一种智能创作标签的补充，看应该如何设计。"

经三轮澄清问答后定型为：

- ✅ **混合双模式**：UI 顶部 tab 区分「📝 文字标签」（Phase E 路线）和「🖼️ 图像标签」（Phase F 路线），后端 source_type 区分
- ✅ **用户选模型**：暴露 SD5 / NB2 / NBP / GPT-Image-2 全部 4 个模型给用户在 dropdown 选
- ✅ **不加风格前缀**：保持 prompt 用户原意，不在服务端自动注入"黑白线条/高对比度"等风格约束

### 1.2 当前 LLM-SVG / 待实施 React 组件路线的覆盖盲区

Phase D（svg-only，已部署）与 Phase E（component+props，proposed）都基于「LLM 生成可文字渲染的矢量描述」。**矢量路径不擅长以下场景**：

| 场景 | 矢量 LLM 路径 | AI 图像路径 |
|---|---|---|
| 装饰性图标 / 卡通形象 | 用户需自己描述形状结构，LLM 用 `<path>` 拼接，效果不稳定 | AI 一句 prompt 即出图，下采样 + dither 后保留主体轮廓 |
| 写实 logo / 摄影感画面 | 矢量本质无法表达 | 唯一可行路径 |
| 中文书法 / 艺术字 | LLM 字体仅"得意黑"一种，限制大 | AI 模型如 NBP 可生成毛笔/印章风格汉字 |
| 跨语言风俗符号 / 文化元素 | LLM SVG 描述能力有限 | AI 训练数据自带丰富视觉风格 |

Phase F 补足这块覆盖盲区。

### 1.3 硬前提验证（已通过）

部署前预先在懒猫 v1.0.39 news-api 容器内验证（避免后期发现网络不通）：

```bash
lcctl remote docker exec mefridayquote0-mcp-news-api-1 \
  curl -sS --max-time 8 -o /dev/null -w "HTTP=%{http_code} TIME=%{time_total}s\n" \
  https://copilot.logic.heiyu.space/health
# → HTTP=200 TIME=0.028583s ✅

lcctl remote docker exec mefridayquote0-mcp-news-api-1 \
  curl -sS https://copilot.logic.heiyu.space/providers/bizyair/v1/cli/health
# → {"status":"ok"} ✅
```

**结论**：Copilot 网关在懒猫容器内通过 Surge fake-ip（198.18.x.x 段）正常解析，28ms 极低延迟。Phase F 后端可直接 fetch 网关，无需额外网络配置或 API Key 注入（网关自动注入上游 Key）。

### 1.4 与 Phase E 的顺序关系

经讨论拍板：**先 F 后 E**。

理由：
- Phase F 路线**简单**（无 JSX sandbox / 无 AST 白名单 / 无 babel 重型依赖），实现 ≈ 500 行
- Phase E ADR-0003 已 commit（`6ef485c`），设计沉淀不会丢
- Phase F 先上能让用户**立刻拿到"AI 出图打印"的物理产物**，验证"图像 → dither → 热敏"链路的真实视觉效果，反过来约束 Phase E 是否要把图像作为组件 prop 二次集成
- 两条路线 DB 层在 `source_type` 列上自然区分，互不干扰

---

## 2. 关键设计抉择（Key Design Choices）

### 2.1 dual-mode 完全解耦（决策：独立管线，不嵌入 Phase E）

不做「LLM 出组件时自动决定是否调 BizyAir 配图」的二阶 LLM 编排。理由：

1. 用户已明确"混合双模式"——前端 tab 选择，后端 source_type 区分，**用户驱动模式选择 替代 LLM 决策模式选择**
2. 二阶编排（LLM 决定调图 → BizyAir 生成 → LLM 二次出组件用图）成本与延迟 ≈ 3 倍，复杂度高
3. Phase F 与 Phase E 落地节奏不同步，硬耦合会让 Phase F 无法独立上线

后续若实测 Phase F + Phase E 都稳定，**Phase G 可考虑融合**（image 作为 component prop），届时再开 ADR。

### 2.2 三栈共存（决策：`source_type` 列 + dispatcher）

`labels` 表增加 `source_type` 列，枚举 `'svg' | 'component' | 'image'`，老数据默认 `'svg'` 兼容 v1.0.39。

| source_type | 渲染路径 | 数据列 |
|---|---|---|
| `'svg'` | `llm-label-generator.svgToBitmap(svg, target)` | `svg` 列保留 LLM 原始输出 |
| `'component'`（Phase E） | `jsx-sandbox` → satori → bitmap-packer | `component_code` + `current_props` |
| `'image'`（Phase F） | MinIO 下载 1-bit PNG → bitmap-packer | `png_path`（1-bit PNG）+ `source_image_url`（BizyAir 原图 OSS 链接） |

Print / regenerate 端点用单 switch dispatcher，**禁止再多分支** —— 避免菱形继承层级。

### 2.3 4 模型暴露给用户（决策：dropdown 显式选择，不智能路由）

UI dropdown 4 选项 + 显式标注耗时与画质特征：

| 选项 label | 内部 model | 耗时 | 适用场景 |
|---|---|---|---|
| `SD5 2K · 21s · 便宜` | `sd5` | ~21s | 默认首选，中文 prompt 友好 |
| `SD5 3K · 31s · 高清` | `sd5-3k` | ~31s | 中文 prompt 想要更高细节 |
| `NB2 4K · 60s · 画面完整` | `nb2` | ~60s | 想要超宽/超长画幅 |
| `NBP 4K · 80s · 最高画质` | `nbp` | ~80s | 写实摄影感、最高质量 |
| `GPT-Image-2 · 多比例` | `gpt2` | ~? | OpenAI 最新模型，自动 T2I/I2I，多种 aspect_ratio |

**理由**：
- 不做"LLM 决定用哪个模型"的智能路由（增加成本和延迟，且不一定准）
- 不做"按图像复杂度自动降级 SD5 → NBP"（视觉质量是主观的）
- **用户自己尝试 → 看真实出纸效果 → 形成偏好** 是最快的反馈循环

### 2.4 不加风格前缀（决策：prompt 完全保留用户原意）

后端 **不** 在 BizyAir prompt 前自动拼接 "black and white line art, high contrast, minimalist icon" 等约束。理由：

- 用户已明确否决"强制加风格前缀"
- 不同模型对相同 prompt 的解读差异本就是用户尝试的乐趣
- 真出现"四色照片 dither 后稀烂"的体验问题，UI 的**双预览**（见 §2.5）会立刻让用户看到 → 自然学会下次改 prompt

但 **保留 UI 侧"风格 hint 按钮"**（V2 可加）：点击「黑白线条」按钮后**在 prompt 输入框追加文字**让用户看到追加结果，**仍由用户自由编辑**。这是 UI 教学，不是服务端强制。Phase F MVP 不实现此按钮。

### 2.5 双预览 UX（决策：原图 + dither 后实物效果同屏并列）

`ImageDesignPanel` 生成成功后必须显示**两张图**：

```
┌─────────────────────┐  ┌─────────────────────┐
│ BizyAir 原图 (4K)   │  │ 实际出纸效果（dither）│
│                     │  │                     │
│   (彩色/灰度全细节)  │  │   (1-bit 320×160 抖动)│
└─────────────────────┘  └─────────────────────┘
       仅预览                  打印按钮 →
```

**理由**：
- "网页好看，打出来糊"是 1-bit 热敏不可调和的本质问题
- 让用户在打印前**立刻看到**真实视觉效果，避免浪费纸 / 浪费墨
- 教育用户形成对"哪些 prompt 适合热敏"的直觉

### 2.6 1-bit PNG 单一存储 + bitmap 按需 unpack（决策：复用 Phase D 存储模式）

不在 DB 多存 `bitmap_buffer` 列（避免 jsonb / bytea 序列化开销）。

生成时：BizyAir 原图 → sharp 缩放 + dither → 1-bit PNG（黑白二值）→ MinIO 上传 → `png_path` 列存路径。

打印时：`POST /:id/print` 下载 png_path 的 PNG → `bitmap-packer.packFromPng(pngBuffer, target)` 现场 pack（MSB-first / bit=1=burn / 行步距 widthPx/8，与 Phase B 字节序契约一致）。

**理由**：
- Phase D 已验证 PNG 存 MinIO + 按需 unpack 模式稳定，复用之
- 1-bit PNG 极小（320×160 ≈ 1KB），MinIO 存储成本可忽略
- bitmap pack 是纯算法（<100ms），不需要持久化中间产物
- **删除整列数据**比 sharp 重算成本更低 —— 数据完整性优先

### 2.7 source_image_url 永久 OSS 链接（决策：信任 BizyAir 上游永久性）

BizyAir 文档明确「`urls`: 生成图片的永久 OSS 链接（不过期）」。后端将其原样写入 `source_image_url` 列，**不另存大图到自己的 MinIO**。

理由：
- 4K 大图 1-5MB，本机 MinIO 存储压力大且无 CDN
- BizyAir OSS 是阿里云上海，国内访问极快
- 如果哪天 BizyAir 失效，原图丢失也只是失去「再次 dither 不同尺寸」的便利，**核心打印 PNG 仍在本机 MinIO** —— 不影响重打

**风险记录**：若长期失效率不可接受，后续可在 ImageLabelGenerator 增加「下载 + 双写本机 MinIO」逻辑，无需 schema 改动。

---

## 3. DB Schema 演进

`src/react-widgets/core/postgres-database.ts:getCreateTablesSQL()` 末尾 `CREATE TABLE IF NOT EXISTS labels (...)` 之后追加：

```sql
-- Phase F (ADR-0004): BizyAir 图像驱动标签
ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'svg';
ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_model text;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS source_image_url text;
```

| 列 | 类型 | 用途 |
|---|---|---|
| `source_type` | text NOT NULL DEFAULT 'svg' | 'svg' / 'component' / 'image' 三栈区分；老数据自动是 'svg' |
| `source_model` | text NULL | image 行存 'sd5' / 'nb2' / 'nbp' / 'gpt2'；其他行 NULL |
| `source_image_url` | text NULL | image 行存 BizyAir 返回的原图 OSS URL；其他行 NULL |

**注意**：v1.0.36 `requiredTables` 仅抽取 `CREATE TABLE IF NOT EXISTS` 表名，**不感知 ALTER**，自动 schema 校验兼容。

**Phase E 与 Phase F 列共存策略**：
- Phase E ADR-0003 §3 的 4 列（`component_code` / `default_props` / `current_props` / `schema_version`）若 Phase E 先于 Phase F 落地，则 Phase F migration 直接追加；若 Phase F 先落地（本次），Phase E migration 也只需追加，不冲突

---

## 4. API 契约

### 4.1 新端点 `POST /api/labels/generate-image`

```jsonc
// Request
{
  "prompt": "一只可爱的卡通猫咪图标，圆润的线条",
  "model": "sd5",                     // 'sd5' | 'sd5-3k' | 'nb2' | 'nbp' | 'gpt2'
  "targetId": "label-T40x20-320",    // 可选，默认 LABEL_T40X20_TARGET
  "tags": ["icon", "cat"],            // 可选
  "modelOptions": {                   // 可选，透传 BizyAir CLI
    "aspect_ratio": "1:1",
    "seed": 0
  }
}

// Response 201
{
  "success": true,
  "id": "...",
  "sourceType": "image",
  "sourceModel": "sd5",
  "sourceImageUrl": "https://bizyair-prod.oss-cn-shanghai.aliyuncs.com/outputs/xxx.jpg",
  "pngPath": "labels/<id>.png",
  "pngUrl": "/api/minio-proxy/labels/<id>.png",
  "targetId": "label-T40x20-320",
  "prompt": "...",
  "bizyairLatencyMs": 21340,
  "status": "draft"
}

// Response 4xx/5xx
{
  "success": false,
  "stage": "bizyair" | "download" | "dither" | "minio" | "db",
  "error": "..."
}
```

### 4.2 新端点 `POST /api/labels/:id/redither`（仅 image 行）

无 body。行为：用 `source_image_url` 重新下载原图 + 重新 dither + 覆盖 MinIO PNG。**不重调 BizyAir**（零额外成本）。

适用场景：未来调 dither 算法 / 切换 render_target 尺寸 / 修 sharp 渲染 bug 时批量重刷。

### 4.3 现有端点适配（dispatcher 模式）

#### `POST /:id/print` 增加 source_type 分支

```typescript
switch (label.source_type) {
  case 'svg':
    bitmap = await llmLabelGenerator.svgToBitmap(label.svg, target);
    break;
  case 'image':
    const pngBuffer = await downloadFromMinio(label.png_path);
    bitmap = await bitmapPacker.packFromPng(pngBuffer, target);
    break;
  case 'component':
    // Phase E 实施时补
    throw new Error('component source_type 在 Phase E 实施后才支持');
}
```

#### `POST /:id/regenerate` 增加 source_type 分支

```typescript
switch (label.source_type) {
  case 'svg':
    // 现有：用原 prompt 调 LLM 出新 SVG
    break;
  case 'image':
    // 用原 prompt + source_model 重调 BizyAir
    result = await imageLabelGenerator.generate(label.prompt, label.source_model, target);
    break;
}
```

#### `GET /` 和 `GET /:id` 输出

`rowToLabel` 加 3 个字段映射：
```typescript
sourceType: row.source_type,
sourceModel: row.source_model,
sourceImageUrl: row.source_image_url,
```

老 svg-only 行返回 `sourceType: 'svg'` + 另两个 NULL，前端不渲染图像专属 UI。

---

## 5. 前端 UX 设计（label-web）

### 5.1 DesignPage 改造（拆 tab）

顶部加 2 tab，把现有 Phase D 内容**包进**「文字标签」tab，「图像标签」是新 tab：

```
┌──────────────────────────────────────┐
│ [📝 文字标签]  [🖼️ 图像标签 ]        │
├──────────────────────────────────────┤
│  当前选中 tab 的 panel               │
└──────────────────────────────────────┘
```

未来 Phase E 落地时，「文字标签」tab 内部可再拆「SVG 模式」「组件模式」二级子 tab 或自动选 component 模式 —— 不在 Phase F 范围。

### 5.2 新组件 `ImageDesignPanel.tsx`

```
┌──────────────────────────────────────┐
│ Prompt: [_____________________]      │
│                                      │
│ 模型: [SD5 2K · 21s · 便宜    ▾]    │
│                                      │
│ ▸ 高级选项（aspect_ratio / seed）   │
│                                      │
│ [🎨 生成图像]                        │
├──────────────────────────────────────┤
│ ┌──────────┐  ┌──────────┐          │
│ │ 原图预览 │  │ dither   │          │
│ │ (4K)     │  │ 实物效果 │          │
│ └──────────┘  └──────────┘          │
│                                      │
│ [🖨️ 打印到 niimbot]   [💾 保存]     │
└──────────────────────────────────────┘
```

### 5.3 HistoryPage 改造

LabelCard 上对 `sourceType === 'image'` 的行显示 🖼️ 徽章 + model 名称（`SD5 2K` 等）。

「以此为模板」按钮对 image 行 → 跳 `/?templateFrom=<id>` → DesignPage 切到「图像标签」tab + 预填 prompt + 预选 model（**不复用 OSS 原图，重调 BizyAir**，因为同 prompt 出图本就有创作价值；用户也可在跳转后改 prompt）。

### 5.4 DetailPage 改造

对 image 行：
- 显示 sourceImageUrl 原图 + png_path dither 图对比
- 加「🔄 重新 dither（不调 AI）」按钮调 `POST /:id/redither`
- 加「🎨 重新生成（调 AI）」按钮调 `POST /:id/regenerate`（沿用现有按钮，dispatcher 自动走 BizyAir 分支）

### 5.5 无新依赖

UI 用现有 React + TailwindCSS 实现 tab / dropdown / 图片预览，不引入新 npm 包。

---

## 6. 后端实施细节

### 6.1 新模块：`src/react-widgets/services/bizyair-client.ts`（~80 行）

```typescript
export interface BizyAirRequest {
  prompt: string;
  model: 'sd5' | 'sd5-3k' | 'nb2' | 'nbp' | 'gpt2';
  options?: Record<string, any>;  // 透传给 CLI 的额外字段
}

export interface BizyAirResponse {
  imageUrl: string;      // urls[0]
  elapsedMs: number;
  rawResponse: any;
}

export class BizyAirClient {
  private baseUrl = process.env.COPILOT_BIZYAIR_BASE_URL
    ?? 'https://copilot.logic.heiyu.space/providers/bizyair/v1/cli';

  async generate(req: BizyAirRequest): Promise<BizyAirResponse> {
    const endpoint = `${this.baseUrl}/${req.model === 'sd5-3k' ? 'sd5' : req.model}`;
    const payload = this.buildPayload(req);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),  // 120s 上限（NBP 4K high 实测 80s）
    });

    if (!res.ok) {
      throw new Error(`BizyAir HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json() as any;
    if (!data.urls?.[0]) {
      throw new Error(`BizyAir 返回无 urls: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { imageUrl: data.urls[0], elapsedMs: data.elapsed_ms ?? 0, rawResponse: data };
  }

  private buildPayload(req: BizyAirRequest): any {
    const base: any = { prompt: req.prompt, ...req.options };
    if (req.model === 'sd5-3k') base.size = '3K';
    if (req.model === 'sd5' && !base.size) base.size = '2K';
    if ((req.model === 'nb2' || req.model === 'nbp') && !base.resolution) base.resolution = '4K';
    return base;
  }
}

export const bizyairClient = new BizyAirClient();
```

### 6.2 新模块：`src/react-widgets/services/image-label-generator.ts`（~120 行）

```typescript
export interface ImageLabelGenResult {
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  sourceImageUrl: string;
  bizyairLatencyMs: number;
}

export class ImageLabelGenerator {
  async generate(
    prompt: string,
    model: BizyAirRequest['model'],
    target: RenderTarget,
    options?: Record<string, any>
  ): Promise<ImageLabelGenResult> {
    // 1. 调 BizyAir
    const bizyairResult = await bizyairClient.generate({ prompt, model, options });

    // 2. 下载原图（OSS）
    const imgRes = await fetch(bizyairResult.imageUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!imgRes.ok) {
      throw new Error(`下载 OSS 原图失败 HTTP ${imgRes.status}`);
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());

    // 3. sharp 缩放 + 灰度化 + threshold + dither
    const pngBuffer = await sharp(originalBuffer)
      .resize(target.widthPx, target.heightPx, {
        fit: 'contain',
        background: '#ffffff',
      })
      .grayscale()
      .threshold(128)  // MVP 用 threshold；后续可换 Floyd-Steinberg dither
      .png()
      .toBuffer();

    // 4. 1-bit pack（MSB-first / bit=1=burn）
    const bitmapBuffer = await bitmapPacker.packFromPng(pngBuffer, target);

    return {
      pngBuffer,
      bitmapBuffer,
      sourceImageUrl: bizyairResult.imageUrl,
      bizyairLatencyMs: bizyairResult.elapsedMs,
    };
  }
}

export const imageLabelGenerator = new ImageLabelGenerator();
```

### 6.3 新模块：`src/react-widgets/core/bitmap-packer.ts`（~40 行）

从 `llm-label-generator.svgToBitmap` 抽出"sharp threshold + 1-bit pack"那部分，重命名为 `packFromPng`，供 svg / image 两条路径共用：

```typescript
export const bitmapPacker = {
  async packFromPng(pngBuffer: Buffer, target: RenderTarget): Promise<Buffer> {
    const { data: raw } = await sharp(pngBuffer)
      .grayscale()
      .threshold(128)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bytesPerRow = target.widthPx / 8;
    const bitmapBuffer = Buffer.alloc(bytesPerRow * target.heightPx);
    for (let y = 0; y < target.heightPx; y++) {
      for (let x = 0; x < target.widthPx; x++) {
        if (raw[y * target.widthPx + x] === 0) {
          const byteIdx = y * bytesPerRow + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          bitmapBuffer[byteIdx] |= 1 << bitIdx;
        }
      }
    }
    return bitmapBuffer;
  },
};
```

`llm-label-generator.svgToBitmap` 内部改为先 sharp 渲染 SVG → PNG，再调 `bitmapPacker.packFromPng`，**保持公开签名不变**。

### 6.4 `labels-api.ts` 修改清单

| 操作 | 位置 | 改动 |
|---|---|---|
| 加 rowToLabel 字段 | 19-44 行 | 加 sourceType / sourceModel / sourceImageUrl 3 字段映射 |
| 加新端点 generate-image | 124 行后 | 新增 `POST /generate-image` 完整实现 |
| 加新端点 redither | 同上 | 新增 `POST /:id/redither` 完整实现 |
| 改 print 端点 | 187-266 行 | 加 source_type switch dispatcher |
| 改 regenerate 端点 | 269-329 行 | 加 source_type switch dispatcher |
| `GET /` 列表 SQL | 134 行 | SELECT 加 source_type / source_model 字段（不需要 source_image_url 列表不显示） |

---

## 7. 不在范围（Out of Scope）

- ❌ Floyd-Steinberg dither（MVP 用 threshold；视觉效果验证后再决定是否升级算法）
- ❌ 风格 hint 按钮（V2 可加；Phase F 仅暴露纯 prompt 输入）
- ❌ 图像 + 文字 混合排版（image label 是纯图，文字叠加属于 Phase E component+image 融合，留 Phase G）
- ❌ image 的 prompt 模板库 / few-shot 提示（用户自由探索）
- ❌ BizyAir 失败重试 / 模型自动降级（一次失败直接报错给前端，用户改 prompt 或换模型重试）
- ❌ image 大图 OSS 双写本机 MinIO（信任 BizyAir 永久链接）
- ❌ image 行的 component_code 字段（Phase E 列与 Phase F 列各自 NULL 不交叉）
- ❌ AX 闭环优化 image prompt（无质量评估器）
- ❌ 多 render_target 同时出图（用户一次只能选一个尺寸，后续可加 redither 切尺寸）

---

## 8. 工程量预估与实施清单

| 模块 | 文件 | 预估行数 | 改动类型 |
|---|---|---|---|
| 后端 schema migration | `postgres-database.ts:getCreateTablesSQL` | +6 行 SQL | 追加 ALTER |
| 后端 bizyair-client | `src/react-widgets/services/bizyair-client.ts` | ~80 行 | 新建 |
| 后端 image-label-generator | `src/react-widgets/services/image-label-generator.ts` | ~120 行 | 新建 |
| 后端 bitmap-packer 抽出 | `src/react-widgets/core/bitmap-packer.ts` | ~40 行 | 新建 |
| 后端 svgToBitmap 重构 | `src/react-widgets/services/llm-label-generator.ts` | ~10 行 | 内部改用 bitmap-packer |
| 后端 labels-api 6 处改动 | `src/api/labels-api.ts` | +150 行 | 加端点 + dispatcher |
| **后端合计** | 5 文件改动 | **~400 行** | 1 轮 Kimi |
| 前端 types | `label-web/src/types/label.ts` | +5 行 | 加 3 字段 |
| 前端 DesignPage tab 拆分 | `label-web/src/pages/DesignPage.tsx` | +30 行重构 | 包现有 + tab |
| 前端 ImageDesignPanel | `label-web/src/components/ImageDesignPanel.tsx` | ~150 行 | 新建 |
| 前端 LabelCard 徽章 | `label-web/src/components/LabelCard.tsx` | +10 行 | 加 source_type 徽章 |
| 前端 HistoryPage 模板 | `label-web/src/pages/HistoryPage.tsx` | +5 行 | image 行的 templateFrom 跳转 |
| 前端 DetailPage redither | `label-web/src/pages/DetailPage.tsx` | +20 行 | 加 redither 按钮 |
| **前端合计** | 6 文件改动 | **~220 行** | 1 轮 Kimi |
| **总计** | **11 文件** | **~620 行** | 2 轮 Kimi 并行 |

### 实施分工（指挥官按此拆 Kimi prompt）

**轮 1（后端）prompt 关键点**：
- 严禁 plan mode + git 红线 + 不动 Phase B/C/D 已落地 8 文件（仅 import）
- 不改 lzc-manifest.yml + 不动字体 + 不动 niimbot-push-module 签名
- Bun macOS LAN bug 警告（dev 验收必须用容器内 curl）
- 必跑验收：`docker compose build` + 容器内 `curl POST /api/labels/generate-image` 真出图 + niimbot 真出纸

**轮 2（前端）prompt 关键点**：
- 严禁 plan mode + git 红线 + 不动 PR Phase D 现有页面行为
- DesignPage tab 拆分**必须把现有内容包进文字 tab，零行为变更**
- 双预览 UI 必须实现（原图 + dither）
- 必跑验收：`bun run build` + 浏览器手测 happy path

### 部署节奏

`lazycat/lzc-manifest.yml` bump `1.0.39 → 1.2.0`（minor 表新能力块；跳过 v1.1.0 留给 Phase E）+ news-api / label-web 双 image v1.2.0 + lcctl remote-build + lpk install。

---

## 9. 风险与回退

### 9.1 主要风险

| 风险 | 缓解 |
|---|---|
| Copilot 网关偶发故障 | 后端记录 stage='bizyair' 错误，前端显示「网关暂时不可用，稍后重试」；不做自动重试避免重复扣费 |
| dither 后图像辨识度差 | 双预览 UX 让用户即时看到；用户可重 prompt 或换模型；不在 MVP 引入算法切换 |
| BizyAir OSS 链接长期失效 | 影响仅限「重新 dither」/ 「按尺寸重切」；核心打印 PNG 已在本机 MinIO，可继续重打；后续可加双写 |
| sharp grayscale + threshold 比 dither 视觉差 | MVP 接受；用户实测反馈如果集中抱怨"成块黑/白"，第二迭代换 Floyd-Steinberg |
| 用户连点 4 模型生成 4 张烧钱 | UI dropdown 标注耗时，间接提示成本；后端不限流（信任用户） |
| BizyAir API 上游变更（增删字段） | bizyair-client `buildPayload` 集中维护；上游字段变化只改一处 |

### 9.2 回退路径

如果 Phase F 部署后实测有严重问题（dither 完全无法看 / BizyAir 经常超时 / niimbot 出纸异常）：

1. 前端：在 ImageDesignPanel 顶部 banner 提示「图像模式临时关闭」+ 禁用生成按钮（不改后端，不丢数据）
2. 后端：`POST /generate-image` 端点直接 503 关闭（保留打印/查看路径让历史数据可用）
3. 老 svg / image 数据**共存不冲突**，可独立使用

完全无需 schema migration 回滚。

---

## 10. 相关引用

- **ADR-0002** §3 三阶段路线图 + Phase D（v1.0.39）已落地 LLM-Gen 单 pass SVG
- **ADR-0003** Phase E React 组件驱动（proposed，Phase F 后实施）
- **ctx-tvny** Copilot API 服务端点总览（BizyAir CLI 4 模型详细参数表）
- commit `d321e82` Phase D 初版（v1.0.39 部署）
- commit `bedd6b3` labels-api 字段对齐 bug fix（与 Phase F 一起 v1.2.0 部署）
- commit `6ef485c` ADR-0003 设计文档
- handoff `ctx-p4Fk` quote0-mcp Phase D 完成 + Bun macOS LAN bug 实证 + Phase E 设计沉淀
- `feedback_bun_macos_lan_socket_bug.md` —— Phase F dev 验收必须走容器内 curl
- `feedback_delegation_quality.md` —— Phase F 委派 Kimi 必塞 5+5 项

---

## 11. 验收 Happy Path（部署后真机测试）

```
1. 浏览器访问 https://labels-quote0.logic.heiyu.space/
2. 点顶部 「🖼️ 图像标签」 tab
3. prompt 输入「一只可爱的卡通猫咪图标，圆润的线条」
4. model dropdown 选「SD5 2K · 21s · 便宜」
5. 点 「🎨 生成图像」
6. 等 ~21 秒，看到原图 + dither 双预览并列显示
7. 点 「🖨️ 打印到 niimbot」
8. niimbot 真机出第 7 张标签（图像类型）
9. 换 NB2 4K + 「一座日式神社」prompt，等 60 秒，打印第 8 张
10. 换 GPT-Image-2 + 「a coffee logo, minimal」prompt，打印第 9 张
11. 详情页点「🔄 重新 dither」验证不调 AI 的快速重渲染
12. 历史页点 cat 标签的「以此为模板」→ 改 prompt 为「一只可爱的卡通小狗」→ 验证跳转 + 预填
13. 检查 labels 表行：source_type 'image' / source_model 正确 / source_image_url 是 bizyair OSS URL
```
