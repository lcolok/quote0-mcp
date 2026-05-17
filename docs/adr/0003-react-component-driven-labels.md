# ADR-0003：LLM 动态生成 React 组件 + props 的标签管理系统

- **状态（Status）**：Proposed — Phase E 待实施
- **日期（Date）**：2026-05-18
- **决策者**：lcolok + Claude（指挥官模式）
- **相关变更**：承接 ADR-0002 Phase D（LLM-Gen 标签，v1.0.39 已部署）的能力升级；不影响 ADR-0001/0002 的现有架构

---

## 1. 上下文（Context）

### 1.1 触发事件

2026-05-18 凌晨用户在 v1.0.39 的 web UI 实测时提出方向矫正：

> "我希望走万能自适应，其实是要走 react 的模式的，而不能纯 svg 的，svg 只能做当中的符号元素的，这样才能充分灵活"

后续在讨论 widget 实现策略时进一步澄清：

> "能不能设定成基于用户提出的需求动态创建呢，而不需要一开始就内置？"

### 1.2 当前 LLM 直出 SVG 路线的局限

Phase D（commit `d321e82`）的 `LLMLabelGenerator` 让 LLM 一次性产出整张 SVG（含数据 inline），存 DB 后即固定，存在几个根本限制：

| 限制 | 表现 |
|---|---|
| 不可参数化复用 | 同一"价签"模板出 100 个商品 = 调 100 次 LLM；每次构图都可能漂移 |
| 二创门槛偏高 | 用户要改"番茄 9.9"→"黄瓜 6.6" 必须找到 SVG 里两处文字位置手动改；或重 prompt |
| 自适应是 LLM 责任 | 长文案 / 短文案 / 中英混排 / 数字大小 全靠 LLM prompt 一次性算好；遇到边界 case 易溢出 |
| 装饰元素 重于 内容 | LLM 把"圆角边框""分隔线""图标"和"数据"平等对待写在同一 SVG 里，导致内容变动必须重出整张图 |

### 1.3 既有 React widget 框架是天然底盘

项目已有完整的 React 函数组件 + props + satori 渲染管线：

- `src/react-widgets/components/LabelWidget.tsx`（Phase B）—— 已是 props-driven 单大字布局
- `src/react-widgets/components/SatoriNewsWidget.tsx` / `SatoriWeatherWidget.tsx` —— 复杂多元素自适应布局参考
- `src/react-widgets/core/satori-renderer.ts` —— JSX → SVG 渲染
- `src/react-widgets/core/thermal-label-rendering-module.ts`（Phase B）—— satori → PNG → 1-bit pack 已闭环
- `assets/fonts/smiley-sans/`（Phase B）—— 得意黑字体已注册 + sharp/librsvg 自动 fontconfig

新增能力只需在这套框架上加 **"LLM 输出 JSX 字符串 → 沙箱化 → React.createElement 树 → 喂现有 satori 管线"** 一层薄适配，**不重写渲染内核**。

### 1.4 用户 prompt 后续矫正

讨论中用户明确否定了几个看似自然的方案：

1. ❌ **预内置 widget 库**（开发者写 LabelPriceTag / LabelQRCard 等组件，LLM 选 widgetId + 填 props）—— 用户认为应让 LLM 动态创建，不要一开始就内置
2. ❌ **AX 闭环 + 多轮迭代**（生成 → 评估 → 重生成）—— Phase D 已证明 LLM 单 pass 输出质量够，不要重型化
3. ❌ **JSON DSL**（结构化字段表达组件） —— 限制 LLM 创造力
4. ✅ **LLM 出 React 函数组件代码 + 默认 props**，每条 label 独立组件，无复用池

---

## 2. 关键设计抉择（Key Design Choices）

### 2.1 LLM 输出格式（决策：JSON `{component, defaultProps}`）

LLM 单次调用输出严格 JSON：

```json
{
  "component": "({title, price, unit}) => <div style={{display:'flex', width:320, height:160, backgroundColor:'#fff', padding:8}}><span style={{fontFamily:'Smiley Sans Oblique', fontSize:48}}>{title}</span><span>¥{price}{unit}</span></div>",
  "defaultProps": { "title": "番茄", "price": 9.9, "unit": "元" }
}
```

- `component` 字段：React 函数组件 JSX 字符串，签名 `(props) => JSX`
- `defaultProps` 字段：与 component 参数列表对应的默认值
- 两者一同存 DB（同一 row），保证"组件 + 数据"配套

**理由**：让 LLM 一次过给"模板 + 数据"两件事，复用语义清晰；DB 单 row 自洽，不依赖外部模板表。

### 2.2 JSX 沙箱化方案（决策：`@babel/standalone` + AST 白名单 + `new Function`）

为什么需要沙箱：LLM 输出的 JSX 是字符串，要变成可调用的 React 元素工厂。`eval` / `new Function` 不加约束会执行任意代码（包括读 process.env / 发请求 / 写文件）。

**实施步骤**：

1. `@babel/parser` parse JSX 字符串到 AST
2. **AST 白名单 visitor** 遍历，拒绝任何非白名单节点
3. `@babel/standalone` 把白名单过的 AST transform 成 `React.createElement(...)` 调用树
4. `new Function('React', 'props', \`return (${code})(props)\`)(React, props)` 调用得到 React 元素
5. 元素喂 satori → PNG → 1-bit pack（复用现有管线）

**AST 白名单**（精确列表）：

允许：
- `Program` / `ExpressionStatement` / `ArrowFunctionExpression`（顶层一个，签名 props）/ `BlockStatement` / `ReturnStatement`
- `JSXElement` / `JSXOpeningElement` / `JSXClosingElement` / `JSXAttribute` / `JSXExpressionContainer` / `JSXText` / `JSXFragment` / `JSXIdentifier`
- `Identifier`（仅允许引用 props 解构出来的 局部变量 或 props 本身）
- `Literal` / `StringLiteral` / `NumericLiteral` / `BooleanLiteral` / `NullLiteral` / `TemplateLiteral` / `TemplateElement`
- `ObjectExpression` / `ObjectProperty` / `ArrayExpression`
- `MemberExpression`（仅 `props.X` 或 `X.Y` 形式访问局部对象，禁止链上有全局 Identifier 如 `process` / `window` / `global` / `globalThis`）
- `BinaryExpression`（仅 `+` 用于字符串拼接 / 简单数学）
- `ConditionalExpression`（三元）
- `LogicalExpression`（`&&` / `||` / `??`）

禁止：
- 任何 `CallExpression` 除非 callee 是 React.createElement（babel transform 后才出现，由我们注入）
- `FunctionDeclaration` / `FunctionExpression` 内层函数（只允许顶层一个 ArrowFunction）
- `VariableDeclaration` / `VariableDeclarator`（无局部状态）
- `ImportDeclaration` / `ExportDeclaration` / `ImportExpression`
- `AssignmentExpression` / `UpdateExpression`（无副作用）
- `NewExpression` / `ThrowStatement` / `TryStatement`
- `WhileStatement` / `ForStatement` / `DoWhileStatement`（无循环）
- `SpreadElement` 除了在 JSXAttribute 中作为 `{...props}`（受限允许）
- 任何 Identifier 引用 `process` / `window` / `global` / `globalThis` / `eval` / `Function` / `require` / `import` / `fetch` / `XMLHttpRequest` / `Buffer` / `console` 等全局

**第三方依赖**：`@babel/parser` + `@babel/traverse` + `@babel/standalone`（项目当前未装，需 `bun add`）。

**回退**：任一节点不在白名单 → 渲染失败，返回 HTTP 400 + `{ stage: 'sandbox', violations: [...] }`，UI 可点重新生成。

### 2.3 兼容老数据（决策：`schema_version` 列 + 渲染分支）

Phase D 已生成的少量 svg-only label（v1.0.39 deepseek 出的 1-2 条测试数据）不丢弃。`labels` 表新增 `schema_version int DEFAULT 2`：

- `schema_version = 1` → 老数据，渲染走现有 SVG 路径（直接 sharp render `labels.svg`）。UI 仅允许查看 / 重打 / 归档，**不可编辑 props 或 component**
- `schema_version = 2` → 新数据，渲染走 `component_code + current_props` 路径

不做老数据迁移（手动重生成成本远低于工程化迁移）。

### 2.4 复用 vs 独立（决策：每条 label 独立 component_code）

每次用户输入 prompt → LLM 出一个独立的 `{component, defaultProps}` → DB 单 row。**不做 widget 池 / 模板分类 / embedding 相似度匹配**。

但保留"以此为模板"的二创路径：UI 列表页点击"以此为模板"按钮 → 跳到新建页 + 预填同 `component_code` + 用户改 `props` JSON → 保存为新 row。这样**用户驱动的复用** 替代 **算法驱动的复用**，简单可控。

---

## 3. DB Schema 演进

`src/react-widgets/core/postgres-database.ts:getCreateTablesSQL()` 末尾的 `CREATE TABLE IF NOT EXISTS labels (...)` 之后追加 ALTER 块（用 ALTER 因为 CREATE TABLE IF NOT EXISTS 不会修改已存在表）：

```sql
-- Phase E (ADR-0003): React 组件驱动标签
ALTER TABLE labels ADD COLUMN IF NOT EXISTS component_code text;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS default_props jsonb;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS current_props jsonb;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS schema_version int NOT NULL DEFAULT 2;
```

注意 v1.0.36 `requiredTables` 仅抽取 `CREATE TABLE IF NOT EXISTS` 表名不会感知 ALTER，自动 schema 检查兼容。

`svg` 列保留（不动）：
- v1 数据：svg 有值，component_code/props NULL
- v2 数据：component_code/props 有值，svg 仍写入（由 satori 渲染后产出的 SVG 字符串）便于"原图查看"和"导出 .svg"

---

## 4. API 契约变更

### 4.1 `POST /api/labels/generate` 输出新增字段

```jsonc
{
  "success": true,
  "id": "...",
  "schemaVersion": 2,
  "componentCode": "({title}) => <div>...</div>",
  "defaultProps": { "title": "..." },
  "currentProps": { "title": "..." },   // = defaultProps，可后续 update
  "svg": "<svg>...</svg>",              // 由 satori 一次渲染产出
  "pngUrl": "/api/minio-proxy/labels/<id>.png",
  // ... 现有字段（targetId / status / llmModel / llmLatencyMs / createdAt）
}
```

### 4.2 新端点 `POST /api/labels/:id/update-props`

```jsonc
// Request
{ "props": { "title": "黄瓜", "price": 6.6 } }

// Response
{
  "success": true,
  "id": "...",
  "currentProps": { ... },
  "svg": "<svg>...</svg>",      // 新渲染的 SVG
  "pngUrl": "/api/minio-proxy/labels/<id>.png",  // 新 PNG 覆盖上传
  "updatedAt": "..."
}
```

行为：拿 `component_code` + 新 `props` → sandbox → satori → 新 PNG 覆盖 MinIO 同路径 → UPDATE labels `current_props` / `svg` / `updated_at`。**不影响 `default_props`**（保留 LLM 初次出图意图）。

### 4.3 新端点 `POST /api/labels/:id/update-component`

```jsonc
// Request
{ "componentCode": "({title}) => <div>...</div>" }
```

行为：替换 `component_code`，用 `current_props` 重新渲染。**高级用户二创路径**，UI 默认折叠。

### 4.4 现有端点适配

- `POST /:id/print`：若 `schema_version = 2` 则用 `component_code + current_props` 重新走 sandbox → satori → 1-bit pack；若 = 1 则用旧 `svg` 直渲（兼容）
- `POST /:id/regenerate`：v2 调 LLM 出新的 `{component, props}`；v1 调 LLM 出新 SVG（兼容）
- `GET /:id` / `GET /`：返回字段包含 `schemaVersion` / `componentCode` / `defaultProps` / `currentProps`

---

## 5. 前端 UX 设计

### 5.1 设计页（DesignPage）增加输出区

生成成功后展示：
- PNG 预览（同 v1.0.39）
- 折叠展开「Props 数据」JSON 编辑器（默认展开）— 实时编辑触发 update-props
- 折叠展开「组件代码」textarea（默认折叠）— 编辑后点「应用并重渲染」触发 update-component

### 5.2 详情页（DetailPage）

补加 PropsEditor + ComponentCodeViewer：
- props JSON 编辑器（react-json-edit-react 或 monaco 简化，~150KB）
- 「保存 props 并重新渲染」按钮（调 update-props，UI 即时刷新 PNG）
- 「组件代码」textarea（只读默认 / 点「编辑」进入可编辑模式 → 调 update-component）

### 5.3 列表页（HistoryPage）

每个 LabelCard 加「以此为模板」按钮（仅 v2 显示）：
- 点击跳 `/?templateFrom=<id>`
- 设计页读 query 后预填 component + props，让用户调整 props 再提交（不调 LLM，零延迟创建新 label）

### 5.4 新依赖（前端 label-web）

- `react-json-edit-react`（~120KB）或 `react-json-view-lite`（更轻 ~40KB）做 props 编辑
- 不引入 monaco（太重 2MB+），组件代码 textarea 用 `<textarea>` 配 syntax highlight CSS（够用）

---

## 6. 沙箱设计补充（实施细节）

### 6.1 字段 normalize

LLM 输出可能有的常见偏差，server 端在 sandbox 前 normalize：

- 顶层 `({props}) => ...` vs `(props) => ...` 都允许
- `React.Fragment` / `<></>` 允许
- 单行 JSX 表达式 vs `return (<JSX>)`  block 都允许

### 6.2 props 类型约束

`defaultProps` 字段仅允许：`string` / `number` / `boolean` / `null` / 嵌套 object 数组（仍约束叶子为前面 3 种）。**禁止 function / Date / Symbol**。

### 6.3 字体兜底

LLM 可能忘记写 `fontFamily: 'Smiley Sans Oblique'`，server 端可在 sandbox 后遍历 React 元素树注入默认 fontFamily（如果未指定）。

---

## 7. 不在范围（Out of Scope）

- ❌ widget 模板池 / 库 / 分类系统（每条 label 独立 component）
- ❌ embedding 相似度匹配复用模板
- ❌ AX 框架多轮闭环（Phase D 已证明单 pass 够）
- ❌ 用户裸手写 JSX（必须通过 LLM 生成或从已有 label 复用）
- ❌ 多用户 / 权限 / 团队共享模板（labels 表无 owner 列，懒猫 SSO 透传未集成）
- ❌ 老 v1 svg-only 数据自动迁移到 v2 component
- ❌ 组件代码 syntax highlight 编辑器（用 textarea 简化）
- ❌ component_code 版本历史（每次 update-component 直接覆盖）

---

## 8. 工程量预估（实施时参考）

| 模块 | 改动 | 预估行数 |
|---|---|---|
| DB schema | ALTER 加 4 列 | ~10 行 SQL |
| LLM service | system prompt 改 + 输出解析 JSON + 调用 sandbox | ~120 行重写 |
| Sandbox module | 新建 `src/react-widgets/core/jsx-sandbox.ts`（parse + AST visitor + transform + new Function） | ~200 行 |
| Renderer 分支 | thermal-label-rendering 加 v1/v2 分支 | ~40 行 |
| labels-api 适配 | 5 现有端点 + 2 新端点（update-props / update-component） | ~150 行 |
| 前端 label-web | DetailPage props 编辑器 / 「以此为模板」 / 列表 v1-v2 区分 | ~250 行 |
| 新依赖 | `@babel/parser` `@babel/traverse` `@babel/standalone` + `react-json-view-lite` | ~3MB 新增 |
| Dockerfile.api | 无（依赖已经 bun install） | 0 |

**合计 ≈ 770 行跨 8 文件 + 3-4 个新 npm 依赖。**

实施分两轮 Kimi（并行）：
- **轮 1（后端）**：DB schema + jsx-sandbox + LLMLabelGenerator 重写 + 5+2 端点适配
- **轮 2（前端）**：DetailPage props 编辑器 + 「以此为模板」流 + v1-v2 兼容渲染

指挥官整合 manifest + 部署 v1.1.0（注意 minor bump 表达"新能力块"语义，非 patch）。

---

## 9. 风险与回退

### 9.1 主要风险

| 风险 | 缓解 |
|---|---|
| LLM 出的 JSX 频繁触发 AST 白名单拒绝 | 通过 system prompt + few-shot 收紧 LLM 输出；监控 sandbox 失败率 |
| 组件代码 bug 让用户重渲染时崩 | sandbox 失败时回退到 default_props 重渲染；UI 提示用户重新生成 |
| props 编辑器 UX 复杂 | MVP 用最轻量的 react-json-view-lite，复杂场景明确说明 textarea 编辑 raw JSON |
| `@babel/standalone` 体积 ~2MB 拖慢 cold start | 仅 server 端用，不进前端 bundle；server 已是长生命容器，影响可忽略 |

### 9.2 回退路径

如果 Phase E 部署后实测发现 LLM 输出 JSX 质量稳定性不达预期：
1. Schema 不动，labels 表 v1/v2 共存
2. LLM service 回退到出纯 SVG（v1 路径）
3. UI 仍可展示 v2 老数据 + props 编辑功能

不需要 DB 数据迁移即可回退。

---

## 10. 相关引用

- ADR-0002 §3 三阶段路线图 — Phase D 已落地 LLM-Gen 单 pass SVG
- commit `d321e82` Phase D 初版（v1.0.39 部署）
- commit `bedd6b3` 字段对齐 bug fix（待合并到 Phase E v1.1.0）
- Phase D 报告 `/tmp/report-phase-d-backend.md` / `/tmp/report-phase-d-frontend.md`
- POC 脚本 `scripts/poc-llm-label.ts`（v1.0.39 已 commit）— Phase E 实施时可作为 prompt 工程参考
- Phase B `LabelWidget.tsx` — props-driven 组件参考实现
