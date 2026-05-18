# ADR-0005：文字标签 — 预定义 Widget 模板库 + 多字体 + LLM 智能填充

- **状态（Status）**：Proposed — v1.4.0 待实施
- **日期（Date）**：2026-05-18
- **决策者**：lcolok + Claude（指挥官模式）
- **相关变更**：取代 v1.0.39 Phase D 的 SVG-only 路线；**正式废弃 ADR-0003**（React 组件动态生成 + AST sandbox，从未实施且已被实测证伪）；为 v2.0.0 版本系统（label_projects + revisions tree + fork）铺地基

---

## 1. 上下文（Context）

### 1.1 触发事件

2026-05-18 用户实测 v1.3.5 后反馈文字标签生成结果（用户附图）：

> 标题「我听广播剧啦」+ 左侧装饰喇叭图标 → **图标与「我」字直接重叠**，半个字被装饰盖住。

用户进一步指出：「当前文字标签的生成逻辑是不是还是 svg 呢，它似乎没有利用到 react 的排版优势？」

事实确认：是。v1.0.39 Phase D（commit `d321e82`）部署的 `LLMLabelGenerator.generate()` 至今未变 —— LLM 一次性输出 SVG 字符串（含手算坐标的 `<rect>` `<circle>` `<text>`）→ sharp 渲染。**未使用任何 layout engine**。

### 1.2 SVG-only 路线根本局限（已被实测证伪）

ADR-0003 §1.2 一年前预测过：

> 自适应是 LLM 责任：长文案 / 短文案 / 中英混排 / 数字大小 全靠 LLM prompt 一次性算好；**遇到边界 case 易溢出 / 重叠**

实测验证：
- LLM 决定"喇叭图标 cx=24 r=18"（占横向 6-42 像素）+ "标题从 x=40 起"
- 实际「我」字宽度 ≈ 40px（72px 字号），跨 x=40 到 x=80
- → 与 6-42 区间重叠 2 像素 → 视觉上"半个字被盖"

这是**纯数学错误**，不是 LLM 智能不够 —— 是没有 layout engine 自动协调元素 bounding box。SVG 字符串扁平结构本身没有 flexbox/grid 这种"声明意图"的语义。

### 1.3 ADR-0003 React 组件动态生成方案为什么不选

ADR-0003 提议 LLM 输出 JSX 字符串 + AST 白名单 sandbox + satori 渲染。优点：保留 LLM 创造力。缺点：

1. **LLM 写 JSX 一样会算错 layout**（hardcoded width: 320 / padding: 16 / flex 分配不当）
2. **AST sandbox 工程量大**（~200 行白名单 visitor + 拒绝 case 处理）
3. **新依赖 `@babel/parser` + `@babel/standalone` ~2MB**
4. **不能预览 widget 库给用户选**（每次都"惊喜盒子"）

**核心洞察**：用户痛点不是"想要 LLM 创造任意 layout"，而是"想要标签好看 + 不重叠 + 多样化"。**预定义 5-8 个高质量 React widget 让 LLM 仅填 props** 完全覆盖 90% 用例，工程量小 100 倍，零 layout 风险。

### 1.4 用户长期愿景（v2.0.0 路线）

讨论中用户给了远期方向：

> 标签像 git 仓库，每次"再生成 / 给意见"= 新 revision；revision 之间形成树（fork / branch）；用户可以「让我看 v1 和 v3 一起对比」「fork v2 改一下图标」「打印当前主线」。

这是 LLM 协作迭代设计范式（类 ChatGPT canvas / Cursor）的具体应用。但工程量 ~1500 行（DB 重构 + 对话历史 + chat UI + revision tree 可视化），不能塞进 v1.4.0。

本 ADR 仅做 v1.4.0：**单 revision 模式 + widget+字体基础**，DB schema **预留 parent_revision_id 列**为 v2.0.0 兼容（v1.4.0 写 NULL，v2.0.0 时启用语义）。

### 1.5 字体单一限制的体验问题

v1.0.39 至 v1.3.5 期间所有文字标签强制使用 Smiley Sans Oblique（得意黑斜体）。用户希望：

- 价签 / 公告 / 庄重场景 → 正体黑体（不要斜）
- 诗词 / 文学 / 优雅场景 → 楷体
- 时尚 / 标识 → 仍用得意黑

v1.4.0 引入 3 字体起步 + LLM 推荐机制 + 用户 override。

---

## 2. 关键设计抉择（Key Design Choices）

### 2.1 预定义 widget 模板（决策：开发者写 React 组件 + LLM 仅决策 id + props）

废弃 ADR-0003 的"LLM 动态出 JSX"路线。每个 widget 是开发者写的 React 函数组件，编译进 bundle，**LLM 不再生成代码**。

理由：
1. **零 layout 风险**：widget 内部用 satori flexbox，元素位置由开发者一次写对
2. **可预览**：UI 上每个 widget 有缩略图，用户点击试用
3. **易扩展**：未来加新 widget = 写新 React 文件 + 注册到 registry，~80 行代码
4. **轻量**：无 AST sandbox / 无 babel / 无新 npm 依赖
5. **复用性**：v2.0.0 fork 时可继承同一 widget 改 props

trade-off：失去 LLM "无界创造"。但用户已确认这个 trade-off 可接受。

### 2.2 LLM 一次性 JSON 输出（决策：`{widgetId, props, iconSvg, fontFamily}`）

LLM 单次调用输出严格 JSON：

```jsonc
{
  "widgetId": "text-with-icon",
  "fontFamily": "smiley-sans",
  "props": {
    "title": "我听广播剧啦",
    "subtitle": "唔好讲嘢 · 请保持安静",
    "iconSvg": "<svg viewBox='0 0 24 24'><path d='M3 9v6h4l5 5V4L7 9H3z' fill='currentColor'/></svg>"
  }
}
```

- `widgetId`: 4 个枚举值（text-single / text-two-lines / text-with-icon / price-tag）
- `fontFamily`: 3 个枚举值（smiley-sans / lxgw-wenkai / alibaba-puhuiti）
- `props`: widget 自身的字段，每个 widget 有 JSON schema 声明
- `iconSvg` *(仅 text-with-icon)*：LLM 当场生成的 viewBox=24 小 SVG，注入到 widget 内 icon slot

理由：单次调用 ~3-5s 简单结构化输出，比 ADR-0003 多轮 LLM 调用便宜+快。

### 2.3 SVG 限制在 widget 内 icon 元素（决策：dangerouslySetInnerHTML 受 layout 约束）

继承用户反馈"SVG 作为单个元素生成的要素，不能作为核心"。具体：

- Widget 用 React flex / grid 布局负责整体位置（不重叠）
- 在 widget 内有专门的"icon slot"（固定尺寸 32×32 或 48×48），通过 `dangerouslySetInnerHTML={{ __html: iconSvg }}` 注入 LLM 生成的小 SVG
- icon SVG 严格约束 `viewBox="0 0 24 24"`，**LLM 在 24×24 坐标系内自由发挥**，不会越过 slot 边界
- iconSvg 经过 `sanitizeSVG()` 过滤 `<script>` / `<foreignObject>` / `on*=` 事件等（**复用现有 llm-label-generator.ts:sanitizeSVG 逻辑**）

理由：保留"LLM 创造装饰图案"的能力，同时绝对避免重叠（icon 永远只占 slot 大小）。

### 2.4 4 widget + 3 字体起步（决策：覆盖 90% 用例不追求全面）

#### Widget 清单

| widgetId | 描述 | props | 视觉示意 |
|---|---|---|---|
| `text-single` | 单行大字居中 | `text` | "会议室 A" |
| `text-two-lines` | 主标题 + 副标题（垂直堆叠居中） | `title`, `subtitle` | "会议室 A" / "2F-201" |
| `text-with-icon` | 左 icon + 右文字（解决用户截图的重叠 case） | `title`, `subtitle`, `iconSvg` | 🔇 + "请保持安静" |
| `price-tag` | 商品价签：标题 + 大数字价格 + 单位 | `title`, `price`, `unit` | "番茄" / "¥9.9 元" |

每个 widget 是 ~80-120 行 React 组件，内部用 satori-compatible 内联 CSS flexbox。

#### 字体清单

| family | 文件 | 协议 | 1-bit 适配 | 推荐场景 |
|---|---|---|---|---|
| `smiley-sans` | SmileySans-Oblique.ttf（已有） | OFL | ✅ 粗笔画 | 时尚 / 标识 / 个性 |
| `lxgw-wenkai` | LXGWWenKai-Bold.ttf（新增） | OFL | ✅ Bold 版笔画粗 | 诗词 / 文学 / 优雅 |
| `alibaba-puhuiti` | AlibabaPuHuiTi-3-105-Heavy.ttf（新增） | SIL OFL | ✅ Heavy 笔画极粗 | 公告 / 价签 / 庄重 |

**为什么不选思源黑体 / Noto Sans CJK**：文件 14-20MB 太大（容器镜像膨胀），且粗黑体 LXGW Bold 与阿里普惠 Heavy 视觉上已经覆盖了 use case。

**为什么不选霞鹜文楷 Regular**：1-bit 二值化对细笔画太残忍，Regular 版会糊。坚持只选 Bold/Heavy 系列。

### 2.5 async fire-and-forget 模式（决策：仿 Phase F generate-image）

虽然 LLM 调用 ~3-5s 比 BizyAir 21-80s 快，但 UI 体验上**保留与图像标签一致的 polling 模式**：

- `POST /generate-text` 立刻 INSERT row(status='generating') + 返回 id
- 后台 setImmediate 调 LLM + satori 渲染 + UPDATE row
- 前端 polling 直到 status='draft'
- 失败 UPDATE status='failed' + last_error

理由：UX 统一性 > 一点点延迟。用户的 ImageDesignPanel 已经 polling，TextDesignPanel 沿用相同 hook。

### 2.6 DB schema 为 v2.0.0 留空间（决策：预建 parent_revision_id 列）

```sql
ALTER TABLE labels ADD COLUMN IF NOT EXISTS widget_props jsonb;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS font_family text;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS parent_revision_id uuid REFERENCES labels(id);
ALTER TABLE labels ADD COLUMN IF NOT EXISTS icon_svg text;
-- source_type CHECK constraint 加 'widget' 第 4 栈
```

- v1.4.0 时所有 widget 类型 row：`source_type='widget'`, `source_model=widgetId`, `widget_props={...}`, `font_family='...'`, `icon_svg=<svg/>`, `parent_revision_id=NULL`
- v2.0.0 时 fork 行为 = INSERT 新 row + `parent_revision_id=<parent>`；revision tree 通过递归 query 重建

**不抽 label_projects 表**：v1.4.0 仍是单 row = 单标签语义。v2.0.0 时再拆 projects 出来需要一次 schema 重构。这里接受 v2.0.0 时**会有一次** label_projects 表加新 + 数据迁移的成本，换取 v1.4.0 上线快。

### 2.7 字体注册扩展（决策：复用 FontRegistry 现有 auto-discovery）

`src/react-widgets/core/font-registry.ts` 已经实现 `assets/fonts/<family>/*.ttf` 自动加载。v1.4.0 只需：

1. 下载 2 个新字体文件到 `assets/fonts/lxgw-wenkai/LXGWWenKai-Bold.ttf` 和 `assets/fonts/alibaba-puhuiti/AlibabaPuHuiTi-3-105-Heavy.ttf`
2. **零代码改动 FontRegistry**
3. Dockerfile.api 已经 `COPY assets/`，容器内自动可用

唯一加的：**dev macOS 系统字体注册**（参考 handoff ctx-p4Fk §3.3 / Phase D 的 smiley-sans `cp ~/Library/Fonts/`）。

---

## 3. DB Schema 演进

在 `src/react-widgets/core/postgres-database.ts:getMigrationStatements()` 末尾追加：

```typescript
// ADR-0005 (v1.4.0): widget 模板库 + 字体 + v2.0.0 revision 预留
`ALTER TABLE labels ADD COLUMN IF NOT EXISTS widget_props jsonb`,
`ALTER TABLE labels ADD COLUMN IF NOT EXISTS font_family text`,
`ALTER TABLE labels ADD COLUMN IF NOT EXISTS icon_svg text`,
`ALTER TABLE labels ADD COLUMN IF NOT EXISTS parent_revision_id uuid REFERENCES labels(id)`,
// source_type CHECK constraint 扩展加 'widget' 第 4 栈
`DO $$
 BEGIN
   IF EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = 'labels_status_check'
   ) THEN
     ALTER TABLE labels DROP CONSTRAINT labels_status_check;
   END IF;
   -- 注意：status CHECK 已经在 v1.2.1 时 DROP 重建过含 generating/failed
   -- 此处不再触碰 status，仅文档说明现状为 6 值
 END $$`,
// 注：source_type 在 v1.2.0 时是 'svg'/'image' 两值无 CHECK constraint
// v1.4.0 通过 application 层逻辑约束，不在 DB 加 CHECK（保持灵活，避免重 migration）
```

旧数据兼容：
- v1.0.39-v1.3.5 的 SVG-only 行：`source_type='svg'`, `widget_props=NULL`, `font_family=NULL`, `icon_svg=NULL`，**保留可查看 + 可重打印**（走 v1.0.39 兼容渲染分支）
- v1.2-v1.3.5 的 image 行：`source_type='image'`, 字段全保留

---

## 4. API 契约

### 4.1 新端点 `POST /api/labels/generate-text`

```jsonc
// Request
{
  "prompt": "请保持安静的提示卡，配个安静图标",
  "targetId": "label-T40x20-320",          // 可选
  "tags": ["公告"],                         // 可选
  "preferredWidget": "text-with-icon",     // 可选，用户 override
  "preferredFont": "lxgw-wenkai"           // 可选，用户 override
}

// Response 201（立刻返回，async fire-and-forget）
{
  "success": true,
  "id": "...",
  "status": "generating",
  "sourceType": "widget",
  "prompt": "...",
  "targetId": "...",
  "createdAt": "..."
}

// 后台完成后 UPDATE row：
// status='draft', widget_props={...}, font_family='...', icon_svg='<svg>',
// source_model=widgetId, png_path, llm_latency_ms
```

### 4.2 新端点 `GET /api/labels/widgets`（catalog）

```jsonc
{
  "widgets": [
    {
      "id": "text-single",
      "displayName": "单行大字",
      "description": "适合简短的招牌、门牌、命令",
      "thumbnailUrl": "/api/minio-proxy/widgets/text-single.png",
      "propsSchema": [
        { "name": "text", "type": "string", "required": true, "maxLength": 12 }
      ]
    },
    { "id": "text-two-lines", ... },
    { "id": "text-with-icon", ... },
    { "id": "price-tag", ... }
  ]
}
```

缩略图是 dev 时一次性预先用 sample props 渲染 widget 得到的 PNG，放 MinIO 或者 dist 中。

### 4.3 新端点 `GET /api/labels/fonts`（catalog）

```jsonc
{
  "fonts": [
    { "family": "smiley-sans", "displayName": "得意黑", "description": "活泼斜体黑体", "thumbnailUrl": "/api/minio-proxy/fonts/smiley-sans.png" },
    { "family": "lxgw-wenkai", "displayName": "霞鹜文楷 Bold", "description": "书法楷体" },
    { "family": "alibaba-puhuiti", "displayName": "阿里普惠 Heavy", "description": "庄重黑体" }
  ]
}
```

### 4.4 现有端点 `POST /:id/print` 增加 widget 分支

dispatcher 加 `'widget'` case：

```typescript
case 'widget':
  // 从 MinIO 下载 dither 后 PNG → packFromPng（与 image 路径一致）
  const pngObj = await imageStorage.getClient().getObject(MINIO_BUCKET, label.png_path);
  // ... 读 chunks → packFromPng
```

实际上 widget 与 image 路径都是"PNG 已存 MinIO，print 时下载 + repack"，dispatcher 简化为 `if (label.source_type !== 'svg') { /* PNG path */ }`。

### 4.5 现有端点 `POST /:id/regenerate` 增加 widget 分支

```typescript
case 'widget':
  // 调 text-label-generator.regenerate(prompt, preferredWidget, preferredFont, target)
  // 用原 prompt + 原 widget/font preference（如果有）重新调 LLM
```

---

## 5. 后端实施细节

### 5.1 新模块：`src/react-widgets/components/labels/*.tsx`（4 widget）

每个 widget 是 `(props) => JSX` 函数组件，用 satori-compatible 内联 CSS（不能用 className，satori 不支持外部 CSS）。

参考：现有 `LabelWidget.tsx`（Phase B 单大字，69 行）+ `SatoriNewsWidget.tsx`（171 行复杂版示例）。

### 5.2 新模块：`src/react-widgets/core/widget-registry.ts`（~80 行）

```typescript
export interface WidgetMeta {
  id: string;
  displayName: string;
  description: string;
  propsSchema: Array<{ name: string; type: 'string' | 'number'; required: boolean; maxLength?: number }>;
  component: React.ComponentType<any>;
  defaultProps: Record<string, any>;
}

export const WIDGETS: Record<string, WidgetMeta> = {
  'text-single': { id: 'text-single', component: TextSingle, propsSchema: [...], ... },
  // ...
};

export function getWidget(id: string): WidgetMeta | undefined { ... }
export function listWidgets(): Array<Omit<WidgetMeta, 'component'>> { ... }
```

### 5.3 新模块：`src/react-widgets/services/text-label-generator.ts`（~150 行）

```typescript
export class TextLabelGenerator {
  async generate(prompt: string, target: RenderTarget, llmCfg: ActiveLLMConfig, override?: { widgetId?: string; fontFamily?: string }): Promise<TextLabelGenResult> {
    // 1. system prompt: 列出 widgetCatalog + fontCatalog + 输出 JSON 严格 schema 约束
    // 2. 调 LLM 拿 {widgetId, props, iconSvg?, fontFamily}
    // 3. 如果 override 存在，覆盖 LLM 选择
    // 4. sanitize iconSvg（复用 sanitizeSVG 逻辑）
    // 5. 用 satori 渲染 React.createElement(getWidget(widgetId).component, {...props}) → SVG
    // 6. sharp dither → 1-bit pack（复用 bitmap-packer.packFromPng）
    return { widgetId, props, iconSvg, fontFamily, pngBuffer, bitmapBuffer, llmLatencyMs, llmModel };
  }
}
```

### 5.4 新 endpoint 在 `src/api/labels-api.ts`

- `POST /generate-text` async 模式（仿 generate-image）
- `GET /widgets` 返回 widget catalog（不含 component 字段，仅元数据）
- `GET /fonts` 返回字体 catalog

---

## 6. 前端实施细节

### 6.1 `label-web/src/components/TextDesignPanel.tsx`（新，~200 行）

代替 DesignPage 文字标签 tab 内现有的 `<PromptInput>` 简单流程。新流程：

```
┌─ Prompt textarea ────────────────────────────────┐
│ 请保持安静的提示卡，配个安静图标                  │
└──────────────────────────────────────────────────┘
┌─ Widget 选择（可选，默认 LLM 自动）─────────────┐
│ [自动] [单行] [双行] [图标+文字] [价签]         │  ← shadcn Tabs/ToggleGroup
└──────────────────────────────────────────────────┘
┌─ 字体选择（可选，默认 LLM 自动）────────────────┐
│ [自动] [得意黑] [霞鹜文楷] [阿里普惠]            │
└──────────────────────────────────────────────────┘
[生成]
```

提交后走标准 polling：generating 卡片出现在右侧 inline 历史 + 主区域显示状态。

### 6.2 改 `label-web/src/api/labels.ts` 加 3 方法

- `generateText(req)` → POST /generate-text
- `fetchWidgets()` → GET /widgets
- `fetchFonts()` → GET /fonts

### 6.3 改 `label-web/src/types/label.ts` 扩字段

`Label.widgetProps?` / `fontFamily?` / `iconSvg?` / `parentRevisionId?`。

### 6.4 改 `LabelCard.tsx` 加 widget 类型徽章

`sourceType === 'widget'` → 显示对应 widget displayName 徽章。

### 6.5 改 `DetailPage.tsx` 显示 widget metadata

widget 行额外显示：widget id、props（JSON 编辑器可选）、字体、icon SVG 预览。

---

## 7. 不在范围（Out of Scope，明确放到 v2.0.0+）

- ❌ **revision tree 版本系统**（label_projects + parent_revision_id 启用语义 + fork UI + chat-style feedback 迭代） → v2.0.0
- ❌ **更多 widget**（5+ 个，比如 list 列表 / table 表格 / QR code 容器） → v1.5.0+
- ❌ **更多字体**（思源黑体 / Noto Sans CJK / 像素体 + 多字重） → v1.5.0+
- ❌ **用户自定义 widget 上传**（JSX/编译进 bundle）→ v3.0.0 远期
- ❌ **widget props 微调 UI**（让用户在结果出来后改 title/subtitle 即时重渲染）→ v2.0.0
- ❌ **ADR-0003 JSX sandbox 路线**（彻底废弃，本 ADR 取代它）
- ❌ **打印机自适应分辨率 + 实时状态**（依赖 ESP32 端配合，等用户回家） → v1.5.0

---

## 8. 工程量预估

| 模块 | 文件 | 预估行数 | 改动类型 |
|---|---|---|---|
| 后端 4 widget React | `src/react-widgets/components/labels/{text-single,text-two-lines,text-with-icon,price-tag}.tsx` | ~400 行 | 新建 |
| 后端 widget-registry | `src/react-widgets/core/widget-registry.ts` | ~80 行 | 新建 |
| 后端 text-label-generator | `src/react-widgets/services/text-label-generator.ts` | ~150 行 | 新建 |
| 后端 labels-api 适配 | `src/api/labels-api.ts` | +150 行 | 3 新端点 + dispatcher |
| 后端 schema migration | `src/react-widgets/core/postgres-database.ts` | +10 行 | 加 4 条 migration |
| **后端合计** | 7 文件 | **~790 行** | 1 路 Kimi |
| 前端 types/api | `label-web/src/types/label.ts` + `api/labels.ts` | +25 行 | 字段扩展 |
| 前端 TextDesignPanel | `label-web/src/components/TextDesignPanel.tsx` | ~200 行 | 新建 |
| 前端 DesignPage 重构文字 tab | `pages/DesignPage.tsx` | +30 行 | 替换 PromptInput |
| 前端 LabelCard 适配 | `components/LabelCard.tsx` | +10 行 | widget 徽章 |
| 前端 DetailPage 适配 | `pages/DetailPage.tsx` | +20 行 | widget metadata 显示 |
| **前端合计** | 5 文件 | **~285 行** | 1 路 Kimi |
| **总计** | **12 文件** | **~1075 行** | 2 路 Kimi 并行 |

字体 + 缩略图准备（指挥官手动）：
- 下载 LXGWWenKai-Bold.ttf（OFL）+ AlibabaPuHuiTi-3-105-Heavy.ttf（SIL OFL）
- 放到 `assets/fonts/lxgw-wenkai/` + `assets/fonts/alibaba-puhuiti/`
- cp 到 `~/Library/Fonts/` for dev
- 预渲染 4 个 widget thumbnail PNG（sample props）+ 3 个 font sample PNG

---

## 9. 风险与回退

### 9.1 主要风险

| 风险 | 缓解 |
|---|---|
| LLM 输出非合法 JSON | text-label-generator try-catch，回退 default widget+default props，status='failed' + lastError |
| LLM 选错 widget（PriceTag 用于公告） | 用户可手动 override widget；规模化后看实测命中率决定是否加 LLM 二次校验 |
| iconSvg 包含恶意脚本 | 复用 sanitizeSVG 黑名单（script/foreignObject/on*=/javascript:） |
| satori 渲染 widget 时字体加载失败 | FontRegistry 已有 cache 机制 + 警告 log；fallback 到 system-ui |
| 4 widget 覆盖不了某些 use case（用户写诗想三行均匀） | v1.5.0 加新 widget，~80 行 1 个 |
| schema migration ALTER 加 parent_revision_id REFERENCES 触发 FK 检查 | 仅 NULL 值不触发 FK；现有数据无影响 |

### 9.2 回退路径

如果 v1.4.0 部署后 widget 路径有严重问题：

1. 前端临时禁用 TextDesignPanel 的 widget 选择，回退到现有 PromptInput → POST /generate (v1.0.39 路径仍可用)
2. 后端保留 generate 端点（不删），完全兼容老数据
3. DB schema 加的列不回滚（IF NOT EXISTS 设计幂等）

完全无 breaking change。

---

## 10. 相关引用

- ADR-0001 调度 API 动态配置
- ADR-0002 多目标渲染抽象（Phase A/B/C）
- **~~ADR-0003 LLM 动态生成 React 组件（Proposed → 本 ADR 正式废弃，未实施）~~**
- ADR-0004 BizyAir 图像驱动标签（v1.2.0 部署）
- commit `d321e82` Phase D LLM-Gen v1.0.39（即将被取代）
- handoff ctx-p4Fk Phase D 后期 + 字体注册 § 3.3
- v1.0.36 schema 自动检查机制 `extractRequiredTableNames`
- 用户截图 v1.3.5 实测：标题/装饰重叠（2026-05-18）

---

## 11. v1.4.0 验收 Happy Path

```
1. dev 本机 cp 字体到 ~/Library/Fonts/（lxgw + alibaba）
2. lcctl 部署 v1.4.0 全套（含 2 新字体文件 + 缩略图 PNG）
3. 浏览器访问 https://labels-quote0.logic.heiyu.space/
4. 选「📝 文字标签」tab
5. prompt 输入: "我听广播剧啦，请保持安静"
6. widget+字体都不指定（让 LLM 自动选）
7. 点生成 → 立刻看到右侧列表里出现 generating 卡片
8. 等 ~3-5s → 卡片变 draft 显示 PNG 预览
9. **预期：text-with-icon widget，左侧 SVG 喇叭 icon 受 slot 约束不与文字重叠，字体 LLM 选了得意黑或阿里普惠 Heavy**
10. 点打印 → 真机出第 8 张标签，物理上图标与文字明显分离
11. 老 SVG 数据（v1.0.39 时期）仍可在历史页查看 + 重打印
```

成功标准：用户截图同 prompt 复现的标签，icon 与文字**视觉上不重叠**。
