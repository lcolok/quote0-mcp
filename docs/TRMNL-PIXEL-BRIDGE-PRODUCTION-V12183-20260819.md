# Quote0 v1.21.83 内容渲染治理与 TRMNL Pixel Bridge 生产交接

日期：2026-08-19（Asia/Shanghai）

## 1. 工作区与 Git 边界

- 工作区：`/Users/friday/.devspace/worktrees/quote0-mcp-trmnl-5e18fa6a`
- Remote：`https://github.com/lcolok/quote0-mcp.git`
- 基线 HEAD：`70013dedb60882cbccd5f4047b692a97dbf7310f`
- 基线 ref：`release/v1.21.82` / `fix/eink-long-poll-v1.21.82`
- 当前状态：detached HEAD，工作区 dirty
- 未执行：commit、push、merge、rebase、release ref 创建
- 主工作区 `/Users/friday/github/quote0-mcp` 的既有未提交改动未触碰
- 旧 v1.21.80 候选工作树 `/Users/friday/.devspace/worktrees/quote0-mcp-trmnl-4d944b08` 未触碰

当前变更分层：

- staged：11 个内容渲染 / Review / E2E 文件，约 `1696 insertions / 27 deletions`
- unstaged：`lazycat/lzc-manifest.yml` 与 `src/api/release-version.test.ts` 的 v1.21.83 release envelope 更新
- 本交接文件为新增报告

## 2. 用户目标与验收标准

用户要求继续治理 Quote0 服务的“内容渲染”问题。实际目标收敛为：

1. 恢复最近 TRMNL / Adaptive / Pixel Bridge 渲染主线；
2. 避免把旧候选覆盖到更新的生产设备协议；
3. 让 Review 展示真正的物理 1-bit 位平面，而非浏览器缩放预览；
4. 明确区分“原生尺寸 point-to-point”与“和 Current 位平面相同”；
5. 保持 Current/Satori 为真实 E-Ink 推屏权威；
6. 用真实生产内容、全仓测试、移动/桌面 E2E 和生产回放验证；
7. 按既有部署授权完成生产部署，但不擅自提交或推送 Git。

## 3. Dynamic Context Rebuild

环境预检：

- `tlens v0.2.9-50-g49ed60e`
- `tlens doctor backend`：healthy
- `skldr 0.3.62`

高价值归档：

- `ctx-4a9C`：v1.21.80 物理 1-bit Review / Pixel Bridge 候选
- `ctx-hw3R`：296×152 line-height / footer baseline 收敛及位平面一致证据
- `ctx-Q8C`：TRMNL News Recipe 候选治理
- `ctx-Dz6I`：v1.21.77 TRMNL 性能、pinned local assets、部署与正确性陷阱

关键运行事实纠正：归档最后写着生产仍在较旧版本，但实际容器、健康接口和 Git ref 表明生产已经是 `v1.21.82`，并包含 E-Ink long-poll / displayed ACK 治理。因此不能直接部署 v1.21.80，否则会造成设备协议和 release 身份回退。

## 4. 实施决策

### 4.1 以 v1.21.82 为基线前移渲染候选

将 v1.21.80 中与内容渲染相关的改动前移到 v1.21.82，而不是部署旧候选。保留并验证 `src/api/eink-pull-protocol.ts` 与 v1.21.82 完全一致。

### 4.2 不复制旧 Dockerfile 方案

旧候选 Dockerfile 会在构建阶段重新从 TRMNL 下载 Framework 资产。当前 v1.21.82 源码和镜像链路已经把 pinned 资产纳入 `assets/`，重复下载会扩大外部依赖和构建面，故明确舍弃。

### 4.3 不为 296×128 / 热敏目标强制 bit-exact

生产多尺寸回放证明这些目标都已做到原生尺寸、无 resize、无页面 overflow。它们与 Current 的位平面不同，原因是 TRMNL 实测 region / padding / typography 与 Current `target.newsLayout` 不同，而不是缩放错误。

若按目标注入 Current 几何以追求相同 SHA，Pixel Bridge 将不再满足“复用 TRMNL layout，只替换 raster”的契约，并会隐性形成第二套布局逻辑。因此：

- 296×152 普通新闻的 bit-exact 作为已验证回归性质；
- 其他目标以原生点对点、信息保留、可读性和人工评审为门控；
- 不把“与 A 相同”错误定义为 point-to-point。

## 5. 实际代码改动

### 后端 / 渲染

- `src/api/renderer-physical-preview.ts`
  - 复用生产 `pngTo1BitBitmap()`；
  - 将 MSB-first 位平面重新展开为原生 PNG；
  - 报告 source / target geometry、是否 resize、位平面字节数与 SHA-256。
- `src/api/renderer-physical-preview.test.ts`
  - 位序、round-trip 与 resize 语义回归。
- `src/react-widgets/core/trmnl-adaptive-renderer.ts`
  - 补充 eyebrow / footer 可见文本；
  - 补充 region box-model 与 eyebrow typography 测量；
  - 为 Pixel Bridge 提供 terminalize 后的真实布局数据。
- `src/react-widgets/core/trmnl-satori-pixel-renderer.tsx`
  - 复用 TRMNL DOM measurement；
  - 将 region / padding / typography 量化到整数像素；
  - 使用 Satori + Fusion Pixel 进行低灰阶点阵栅格化；
  - 不新增独立内容布局引擎。
- `src/react-widgets/core/trmnl-satori-pixel-renderer.test.tsx`
- `src/react-widgets/core/trmnl-satori-pixel-renderer.visual.test.ts`
  - 标准 / micro geometry、字号、低灰阶、target mismatch fail-closed；
  - 296×152 典型普通新闻最终位平面与 Current/Satori bit-for-bit 相同。
- `src/api/renderer-review-service.tsx`
  - Review 升级为 `renderer-review/v3`；
  - A / B / B2 / frozen reference 均附带真实物理位平面预览；
  - B2 标记 experimental，且 `changesPhysicalDelivery=false`。

### 标注前端

- `annotation-web/src/components/RendererReviewPanel.tsx`
  - 展示 Current、TRMNL News Recipe、Pixel Bridge；
  - 原生 1× 像素预览，`imageRendering: pixelated`；
  - 展示 POINT-TO-POINT / RESIZED、位平面大小与 SHA；
  - 明示 B2 与 B 共用 layout，主 A/B 投票仍仅比较 A/B；
  - Current/Satori 保持生产权威。
- `annotation-web/src/components/AnnotationPage.tsx`
  - 接入 Renderer Review 模式、目标切换、评审草稿与保存。
- `annotation-web/src/api/client.ts`
  - 新增 Review v3 API 客户端。
- `annotation-web/e2e/mobile-shell.spec.ts`
  - 覆盖 390px 移动端与 1440px 桌面三栏 Renderer Review。

### Release

- `lazycat/lzc-manifest.yml`：app、annotation-web、news-api 更新到 `v1.21.83`；label-web 保持 `v1.21.29`。
- `src/api/release-version.test.ts`：期望 `1.21.83`。

## 6. 验证证据

### 聚焦回归

```text
21 pass
0 fail
146 expects
```

覆盖：

- TRMNL adaptive HTML / target profile
- Pixel Bridge snap plan / visual raster
- 物理位平面 preview
- Renderer content adapter
- v1.21.82 E-Ink long-poll / displayed ACK parser

### Annotation Web

- `bun run build`：PASS，1602 modules transformed
- Playwright：
  - mobile WebKit 390×844：PASS
  - desktop Chromium 1440×900：PASS
  - 2 个不适用的交叉 project：按设计 skipped

### 全仓 release gate

```text
base image digest guard PASS
version pre-release governance PASS
git diff --check PASS
229 pass
0 fail
7005 expects
TypeScript production build PASS
```

预发布治理仅报告预期警告：dirty worktree、尚无 exact release ref、尚未被 origin 表示。这些是 Git 收口缺口，不是测试失败。

### 部署前真实生产内容回放

使用生产 DB 当天三条内容：

- `347852`：美青少年吸烟率降至1.4%新低
- `347849`：RFC9234部署：两T1剥OTC
- `347848`：NVDA读模型输出异常需规范化

三条均满足：

- Review v3
- candidate 与 B2 为原生 296×152
- 无 resize
- B2 最终位平面 SHA 与 Current 完全相同

## 7. 构建与部署

为规避旧 `--service` 路线把 conditional image 误解析成 `latest`，使用显式 Dockerfile + tag 的单服务 remote-build。

### 镜像

- annotation-web `v1.21.83`
  - registry digest：`sha256:399e3da8e9d06b75a17c6746dcdf1241f5254b6571e24798f22117942bd68159`
- news-api `v1.21.83`
  - registry digest：`sha256:e4cc3d9facd64e56021395163a65bae7b89a3d5be144d51975a1208dcde2c7ca`
- label-web 保持 `v1.21.29`

两镜像均使用 no-cache 远端构建并成功 push。news-api 仅出现 Dockerfile `FROM ... as` 大小写风格 warning，无构建错误。

### LPK

- 文件：`lazycat/me.friday.quote0-mcp-v1.21.83.lpk`
- SHA-256：`be686b890e1cd248b889307a1bf0b1530f37578565167910f3b9bb53fb3f18dd`
- 安装结果：`Installation successful!`

LPK 构建仍报告现有 legacy LPK v1 / App Store lint 债务。本次不迁移 package layout，以免将渲染修复扩大成包格式迁移。

## 8. 生产验收

### 健康与运行身份

- `/api/health.version = 1.21.83`
- news-api、annotation-web、label-web、postgres、minio、redis、app sidecar 全部 healthy
- 六个长生命周期服务 restart policy 均恢复为 `unless-stopped`
- 缓存 Review 请求：HTTP 200，约 `0.223s`
- 安装后日志：无 fatal / panic / unhandled / uncaught error
- TRMNL 预热：`3770.07ms`，`assetSource=local-pinned`

### 本地候选与运行容器源码 SHA 一致

- `renderer-review-service.tsx`
  - `034e0100d436960ef85de623493b660a9003d7b885be64f25223a6bd525f4dbb`
- `renderer-physical-preview.ts`
  - `95f0fde358119311c74c05124bf4addce8e010b1b50958086c2dd9755e7c5332`
- `trmnl-adaptive-renderer.ts`
  - `9266da23e2028772c423fdb50077b9352d27b81a0084c1b71429f13f37387c62`
- `trmnl-satori-pixel-renderer.tsx`
  - `8857bc589453ffbfb05c9d7fda97de255b04b61b7c766d19c2da8bf9c4a930fd`
- v1.21.82 `eink-pull-protocol.ts` 保留并一致
  - `ca7c4af554d3af6feea306900bc61a0e5025eeaf619e3fad3d5f7f72d848d340`

Annotation 生产 bundle 包含 `Pixel Bridge` 和 `POINT-TO-POINT` 标记。

### 296×152 真实线上回放

三条真实内容均满足：

- `renderer-review/v3`
- visible title 与请求内容一致
- `assetSource=local-pinned`
- `pageReused=true`
- candidate `pointToPoint=true`
- candidate `resizeApplied=false`
- 位平面大小 `5624B`
- B2 `pointToPoint=true`
- B2 plane SHA 与 Current plane SHA 完全相同
- `changesPhysicalDelivery=false`
- Current lifecycle：`authoritative`
- TRMNL lifecycle：`canary`

B2 单独栅格耗时约 `16.93ms / 26.70ms / 20.82ms`。

### 多尺寸边界

对同一真实内容生产回放：

- 296×128：原生、无 resize、无 overflow、4736B
- 320×160：原生、无 resize、无 overflow、6400B
- 160×64：原生、无 resize、无 overflow、1280B；micro 模式去 footer，并按 recipe 截短正文
- 400×240 runtime thermal：原生、无 resize、无 overflow、12000B

这些尺寸的 B2 与 Current/legacy projection 不要求位平面相同；其差异属于布局实验，不属于缩放伪 point-to-point。

### 人工评审完整性

`adaptive_layout_reviews` 中 `renderer-comparison/trmnl-news-recipe-v1` 行数为 `0`。部署和验收没有插入任何伪造的人类偏好。

## 9. 明确未完成 / 风险

- 当前生产源码已部署但尚未 Git commit / push / release ref 收口，因此不能宣称远端 Git 已可复现 v1.21.83。
- Pixel Bridge 仍是 Review-only experimental B2，不是物理推屏权威。
- TRMNL Browser B 的抗锯齿位平面仍与 Current 不同；B2 的意义是保留 TRMNL layout，同时使用点阵 raster。
- 296×128 与热敏尺寸需要真实人工评价信息保留、阅读性和空间利用，不应以“和 Current SHA 相同”作为晋级标准。
- legacy LPK v1 / App Store lint 债务未在本阶段处理。

## 10. 下一步优先级

最高优先级是使用 `/annotate` 采集真实 A/B 人工评审，并按治理门槛检查普通新闻、Research、296×128 与 20×8 的信息保留和可读性。若 296×128 质量不足，应修改 TRMNL News Recipe 的连续适配规则，而不是向 Pixel Bridge 注入 Current 的目标特判。
