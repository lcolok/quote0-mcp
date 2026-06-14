# Label 会话式版本树(Session/Turn)设计规格

> 日期:2026-06-11 · 状态:v1 实施中
> 前置:docs/Label-Batch-Management-Spec.md(批量管理薄层,v1.17.9 已上线)

## 0. 动机

批量标签生成后,用户需要对单张标签做多轮迭代:补充文字/图片上下文 → 生成新版本 → 不满意可 undo / 从任意历史版本 fork。这本质是「多轮对话 session」:每张图都是某轮对话的产物,必须可溯源、可编辑。

同时要求**所有生成路径收敛到同一条脊柱**,避免未来多轨分叉。

## 1. 概念模型

```
label_session(会话)   = 一张标签的完整迭代历史(锚定 batch_item 或 standalone 单条设计)
label_gen_turn(轮)    = 一轮生成:输入上下文(feedback 文字 + 参考图 + 参数) → 产物(label)
turn.parent_turn_id   = 树结构;从任意祖先节点继续生成 = 天然 fork
session.current_turn_id = 「当前版本」指针;undo/redo/选分支 = 移动指针(非破坏,永不删除)
```

**为什么 turn 不建在 labels 表上**(虽然 labels.parent_revision_id 已存在):
1. 失败轮也是历史——label 行只在 job 成功时 INSERT,失败的生成在 labels 上没有节点;turn 行入队即建,join `label_jobs.state` 即可展示失败轮 + 错误信息。
2. 零管线改动——turn 表完全由 API 层读写,worker/generators/orchestrator 不动。
3. 语义吻合——turn 承载「本轮用户补充了什么上下文」,这正是溯源要看的。

## 2. 架构不变式(红线)

> **任何会产生或改变标签像素的操作,必须经过 `createTurn()`(src/react-widgets/core/label-session-store.ts),不允许任何端点绕过它直接入队 label_jobs 或直接写 labels。**

`createTurn()` 职责:turn 落账(完整输入上下文)→ 注入 `session:`/`turn:` tags → 入队(异步)或直挂 labelId(同步)→ 推进 session 指针 → 同步 batch_item 的 job_id/label_id(打印/审批零改动)。

## 3. 数据模型(getMigrationStatements 末尾追加,幂等)

```sql
label_sessions(
  id, subject_type('batch_item'|'standalone'), subject_id,
  current_turn_id → label_gen_turns, created_at, updated_at)
  -- 部分唯一索引:batch_item 主体一 item 一 session(并发 ensure 防双建)

label_gen_turns(
  id, session_id → label_sessions(CASCADE), parent_turn_id 自引用,
  turn_kind('root'|'refine'|'redither'|'decoration'),
  gen_mode('template'|'img2img'|'rewrite'|NULL),
  user_feedback, ref_image_urls jsonb, params jsonb{model,presetId,targetId,...},
  effective_prompt,             -- 真正送出的最终 prompt(完整可溯源)
  job_id → label_jobs(异步路径), label_id → labels(同步路径直填),
  client_request_id UNIQUE(防双击), created_at)

label_batch_items + session_id → label_sessions
```

产物解析恒走 `COALESCE(t.label_id, j.label_id)`;turn 状态 = job.state 映射(无 job 且有 label = succeeded)。

## 4. 生成模式(全走现有管线,worker 无感知)

| 模式 | 适用 | 走法 |
|------|------|------|
| img2img 微调 | 保持构图微调 | refImageUrls = [父版本 source_image_url(BizyAir OSS 公网原图)] + 用户新参考图;prompt = feedback 原文 → orchestrator 现有 direct_image_to_image 模式 |
| rewrite 重写 | 风格大改 | API 层同步调多模态 LLM(看父版本图 + 父 prompt + 祖先 feedback 链 + 新 feedback)重写 prompt → 纯文生图入队;LLM 不可用时降级为「父 prompt + Adjustment: feedback」拼接(params.rewriteDegraded=true) |

父版本无 source_image_url(widget/svg 路径产物)时 img2img 返回 400,前端自动落到 rewrite。

## 5. API

```
POST /api/label-sessions/ensure                 {subjectType:'batch_item', subjectId}
     → 惰性建 session;旧 item 有生成历史时合成 root turn(零迁移脚本,打开即建账)
GET  /api/label-sessions/:id                    → {session, turns[]}(join job 状态 + label 缩略图)
POST /api/label-sessions/:id/turns              refine {parentTurnId, feedback, refImageUrls?, genMode, model?, presetId?, clientRequestId}
POST /api/label-sessions/:id/select             {turnId} 移动指针(undo/redo/选 fork 分支)
```

已收敛的既有路径(v1):
- `POST /labels/generate-image` / `generate-text` → 建 standalone session + root turn(响应新增 sessionId/turnId,向后兼容)
- batch `run`/`retry`(enqueueItems)→ 每 item ensure session + root/refine turn(genMode='template'),幂等键不变
- 编辑器 refine → 上述 turns 接口

v2 待归位:SVG 同步路径(`/labels/generate`,turn.job_id 为空 label_id 直填)、`/labels/:id/regenerate` 别名化、redither/decoration 派生轮(顺手修「换 dither 丢上一版」)、「我的标签」列表切 sessions 视角、batch itemState 对无 job 的同步 turn 显示 pending 的小瑕疵。

## 6. 前端(label-web)

BatchDetailPage 点图 → 全屏 SessionEditorDialog(URL `?item=<id>` 可刷新/分享):
- 左:当前版本大图(失败轮显示错误);底部版本时间线(横向缩略图,v1..vN,fork 节点标 `↳v<parent>`,点任意节点 = select 指针)
- 右:对话流(每轮 feedback + 参考图 + 产物缩略图/失败态)+ 输入区(feedback 文字 + RefImageUploader + img2img/rewrite 模式切换 + 生成)
- ←/→ 键盘与按钮切换聚焦 item(输入框聚焦时不抢按键)
- 轮询:session tree 2s(有 pending/running 轮时)
- 新文件:types/session.ts、api/sessions.ts、components/SessionEditorDialog.tsx

## 7. 已知取舍

- generate-image/text 的 clientRequestId 重试会留下一个空 standalone session(turn 去重命中、session 先建)——纯账面冗余,不影响功能。
- refine 非幂等(同一意图可多次生成),幂等仅靠前端 crypto.randomUUID() 防双击。
- rewrite 模式 API 同步调 LLM(数秒),前端 axios timeout 放宽到 120s。
- 大批量 worker 吞吐(每 5s 领 1 job)仍是已知瓶颈,本期不动。
