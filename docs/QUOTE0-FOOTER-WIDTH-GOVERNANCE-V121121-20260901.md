# Quote0 E-Ink Footer 物理字宽治理 · v1.21.121 · 2026-09-01

## 用户问题

用户提供生产深链接：

`/annotate?v=1&view=content&mode=content&target=eink-296x152&pane=preview&subject=2454eed4099a7caa9f31970ce9297181&delivery=366235`

并指出底部文字明显错版。

目标不是特判这一条，而是找出 296×152 footer 在真实像素字体下的系统性溢出根因，建立可泛化的单行物理布局约束，并让该历史深链接立即显示修复后的 PNG。

## 工作区 / Git 边界

- Worktree: `/Users/friday/github/_worktrees/quote0-device-ip-heal-20260824`
- Branch: `feat/eink-large-target-layout-20260825`
- Base HEAD: `d5dfb664440b505ac77e0b49f3dafecb5dcf07bb`
- Remote: `https://github.com/lcolok/quote0-mcp.git`
- 本轮未 commit / push / merge / rebase / reset / stash / clean。
- 保留工作区此前 v1.21.114–120 未提交治理改动及既有 corpus replay WIP。

## DCR

Preflight：

- tlens `v0.2.9-89-g7dcb97e`
- tlens backend healthy
- skldr `0.3.62+introspect.d35e07a`

关键历史：

- `ctx-LKx7`：v1.21.118 Publisher / discovery / Neuromancer footer provenance。
- `ctx-ZqNJ`：296×152 Current visual grammar 的 footer 基准为 16px 高、12px 字体、14px line-height。

## 精确生产样本

Delivery `366235`：

- fingerprint: `2454eed4099a7caa9f31970ce9297181`
- inventory: `19053`
- processed title: `UGA研究：蓝光最损害细节分辨力`
- publisher: `research.uga.edu`
- discovery: `Hacker News`
- Research: Neuromancer
- evidence source count: 1
- old image path: `/widgets/news/2026/08/31/news_0_1788175742879.png`

旧 footer selector 在 296×152 下选择：

`来源: research.uga.edu · Neuromancer研究·1证据源`

## 根因：字符宽度 heuristic 与真实 Fusion Pixel 字体不一致

296×152 footer：

- canvas width = 296px
- footer horizontal padding = 8px
- 可用文字宽度 = 288px
- footer font = Fusion Pixel 12px
- 旧预算 = 48 half-width units

旧 `footerTextUnits()` 只把 CJK / 全角 Unicode range 算 2 units，其它字符算 1 unit。因此 `·`（U+00B7 MIDDLE DOT）被错误算成 1 unit。

使用本机 HarfBuzz `hb-shape` 对项目真实字体 `fusion-pixel-12px-monospaced-zh_hans.otf.ttf` 做实际 shaping：

- ASCII glyph advance = 6px
- 中文 glyph advance = 12px
- U+00B7 `·` advance = **12px**

因此旧算法把两个 `·` 各少算 6px，总共低估 12px。

真实旧 footer 宽度 = **300px**，而可用宽度只有 **288px**。

Satori 因此发生换行；footer 容器只有 16px，高度不足容纳第二行，于是形成第二行残片 / 裁切，看起来就是用户所说的“底部文字错版”。

## 系统性审计

对最近 200 条真实 production processed deliveries 用旧 selector 做反事实审计，并按真实 Fusion Pixel half/full-width 模型重新计算：

- 样本：200
- 旧 selector 实际超宽：**12 条**

典型：

- `research.uga.edu` / UGA 蓝光新闻：50 units > 48
- `dreamstation.systems` / NAT 新闻：50 units > 48

因此不是单条异常，而是 footer fitting 模型缺陷。

## 永久修复

文件：`src/react-widgets/components/SatoriNewsWidget.tsx`

### 1. 物理字宽模型

Fusion Pixel 小屏路径改为保守且与真实字体一致：

- ASCII (`<=0x7f`) = 1 half-unit
- 所有 non-ASCII = 2 half-units

这正确覆盖 `·` 等不属于 CJK range 但在中文像素字体里占全角宽度的 glyph。

### 2. 语义降级而不是直接丢信息

新增 compact Research candidate：

`来源: <publisher> · Neuromancer·N证据源`

因此 366235 现在确定性选择：

`来源: research.uga.edu · Neuromancer·1证据源`

它保留 Publisher、Neuromancer 身份和证据源数量，只删除低优先级“研究”二字与 discovery 层。

### 3. 极长 Publisher hard clamp

如果所有候选都超宽，不再直接返回原 publisher；新增 `truncateFooterToUnits()`，按同一物理字宽预算截断并保留 `…`。

因此未来即使出现异常长 hostname，也不会制造第二行。

### 4. CSS / Satori 物理不变量

Footer container 强制：

- `height = 16px`
- `boxSizing = border-box`
- `flexShrink = 0`
- `minWidth = 0`
- `overflow = hidden`
- `whiteSpace = nowrap`

Footer child span：

- `maxWidth = 100%`
- `overflow = hidden`
- `whiteSpace = nowrap`

这形成双保险：即使未来 fitting 逻辑再次回归，footer 也只能安全裁切，不能再扩成第二行破版。

## 回归测试

`src/react-widgets/components/SatoriNewsWidget.render.test.tsx` 新增：

1. 真实 delivery 366235 footer 必须选择 compact 单行版本；
2. 极长 publisher 必须 deterministic ellipsis clamp；
3. footer 16px / nowrap / overflow 物理 contract 在隔离 Bun subprocess 中验证。

第三项必须放在隔离 subprocess，因为仓库已有测试使用 Bun `mock.module()`，其 process-global mock 会污染后续直接组件调用；这与 `ctx-ZqNJ` 记录的 Adaptive v2 测试坑一致。没有通过删除/弱化测试绕过。

最终完整 gate：

- `bun test`: **342 pass / 1 skip / 0 fail**
- expectations: **7483**
- 唯一 skip：既有 real PostgreSQL RSS source-health outbox
- `bun run build`: PASS
- `git diff --check`: PASS

## 发布

App release: **1.21.121**

- news-api: `dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.121`
- registry digest: `sha256:3871770b608f8f548c9cddb76d169e5931d6d4ef7238ce9aaa5c126f518321bf`
- annotation-web 保持 `v1.21.120`
- label-web 保持 `v1.21.29`

LPK install 成功。

Production `/api/health`：

- healthy
- version `1.21.121`
- Research `quote0-research-triage/v12`
- Phase A/B local-qwen
- structured-inference
- fallback none

安装后 7 个 Quote0 容器均运行，7 个 RestartPolicy 全部恢复 `unless-stopped`。

## 历史预览修复

仅部署 renderer 代码不足，因为 `/annotate` 的历史 preview 使用 `news_push_log.image_path` 的旧 PNG。

用生产 `v1.21.121` news-api 容器：

- 读取 inventory `19053` 的完整 `processed_content`（保留 metadata / DisplayProvenance / Research Receipt）
- 直接调用当前 `news` renderer 296×152 重渲染
- 新 MinIO path：`/widgets/news/2026/09/01/news_0_1788192443443.png`

在切换 DB 前对旧/新 PNG 底部 16 行做 raw pixel 检查：

旧 PNG：

- 第一段 dark ink: y=136–143
- y=144–146 = 0 dark pixels
- 第二段残片: y=147–151

即明显的“两段/第二行裁切”形态。

新 PNG：

- y=136–139 = 0
- 单一连续 footer ink band: y=140–150
- y=151 = 0

证明换行残片消失。

随后进行最小、可追踪的 DB 修复：

- `content_inventory.id=19053.image_path` → new PNG，保证以后 replay 正确；
- **仅** `news_push_log.id=366235.image_path` → new PNG，让用户给出的精确深链接立即修好；
- 其它历史 delivery 不批量覆盖，以保留历史视觉快照。

## 生产浏览器验收

通过 SSH tunnel 直连真实 production annotation-web（只绕过 LazyCat SSO；API 仍走真实 news-api），打开用户原始 query。

验证：

- title: `UGA研究：蓝光最损害细节分辨力`
- delivery: `366235`
- subject: `2454eed4099a7caa9f31970ce9297181`
- preview src: `/api/minio-proxy/widgets/news/2026/09/01/news_0_1788192443443.png`
- natural image size: 296×152

生产 `buildNewsFooterText()` 对 inventory 19053 的实际输出：

`来源: research.uga.edu · Neuromancer·1证据源`

## 设备安全

安装后 E-Ink delivery 持续成功：

- eink-2 health: healthy
- consecutive_failures: 0
- last_success_at: `2026-09-01 00:09:20 +08`
- 最近多条 device_deliveries 均 succeeded

## Git 边界

未 commit / push。部署来自当前经过验证的 dirty worktree；此前 v1.21.114–120 资产和本轮 v1.21.121 改动均仍在工作区。