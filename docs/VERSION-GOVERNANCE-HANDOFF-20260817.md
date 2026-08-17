# Quote0 版本治理阶段交接 — 2026-08-17

## 工作区 / Git 边界

- Workspace: `/Users/friday/github/quote0-mcp-trmnl`
- Remote: `git@github.com:lcolok/quote0-mcp.git`
- 当前分支: `chore/version-governance`
- HEAD: `866119c3c99a24ea9f17b133a6d72fba6761ae7d`
- `origin/main`: `ee4ca46df994862901aa34038540b01dc007b6b3`
- HEAD 比 `origin/main` 超前 10 commits。
- 已建立本地生产快照 ref: `release/v1.21.71 -> 866119c3c99a24ea9f17b133a6d72fba6761ae7d`
- 未 commit / 未 push / 未 merge / 未 rebase / 未部署本次治理改动。
- 主 checkout 的原有 Annotation/AX/Evaluation WIP 未触碰。

## 用户目标

治理 Quote0 当前生产版本与 Git SSoT、release manifest、各服务镜像版本和运行时版本身份之间的失配，避免再次出现“生产已经跑了新版本，但 Git/health 不知道它是谁”的状态。

## DCR / 历史证据

Binary preflight:

- `tlens version`: v0.2.9-50-g49ed60e
- `tlens doctor backend`: remote healthy
- `skldr version`: 0.3.62

高价值历史 refs:

- `ctx-serK` — v1.21.67 Inventory Auto Research Canary 生产交接
- `ctx-rIUa` — TRMNL Framework 3.2 重评
- `ctx-Q8ys` — v1.21.68 Review selected-state 修复
- `ctx-LKdP` — v1.21.59 Review Integration 生产交接

没有找到一个已经归档的 v1.21.71 Git SSoT 收口结论，因此以当前 Git、生产容器和 SHA 实测作为最高优先级事实。

## 当前生产事实

生产镜像矩阵实测：

- app envelope: `1.21.71`
- news-api: `v1.21.71`
- annotation-web: `v1.21.68`
- label-web: `v1.21.29`
- PostgreSQL / Redis / MinIO / app 等全部 healthy。

这类组件版本错位是有意的部分发布，不应强制所有服务同步 bump。

### 生产源码身份验真

以下当前本地 HEAD 文件 SHA256 与运行中 `news-api:v1.21.71` 容器逐文件完全一致：

- `src/react-widgets/core/trmnl-adaptive-renderer.ts`
- `src/api/trmnl-canary-api.ts`
- `src/api/research-canary-worker.ts`
- `src/api/research-canary.ts`
- `src/api/news-api-server.ts`

因此 `866119c` 所在提交链可以被判定为当前 v1.21.71 的真实生产源码谱系。

### 发现的运行时版本谎报

生产 `/api/health` 实测仍返回：

```json
{"status":"healthy","service":"Modular News API","version":"1.0.0"}
```

而运行镜像实际是 `news-api:v1.21.71`。根因是 `/`、`/api/health`、`/api/docs` 三处长期硬编码 `1.0.0`。

## 已完成治理

### 1. 固定生产 release 身份

建立本地不可漂移意图的 release ref：

```text
release/v1.21.71 -> 866119c3c99a24ea9f17b133a6d72fba6761ae7d
```

治理代码单独位于 `chore/version-governance`，避免将后续治理改动混入 v1.21.71 生产快照 ref。

### 2. 新增 release version gate

新增：

- `scripts/check-release-version.ts`
- `scripts/check-release-version.test.ts`

规则：

- 顶层 release envelope 必须是 SemVer。
- production 自建镜像必须使用 `vX.Y.Z`。
- component 版本不得超前于 envelope。
- 至少一个 component 必须等于 envelope，防 ghost release。
- 允许 annotation/label 等未重建组件继续 pin 老版本。

三层 gate：

1. `bun run version:check` — pre-release gate；允许 dirty / 缺 ref，但给警告。
2. `bun run version:check:ref` — commit 后 snapshot gate；要求工作区 clean 且当前 HEAD 有精确 `release/vX.Y.Z` ref。
3. `bun run version:check:remote` — remote SSoT gate；要求工作区 clean，并用实时 `git ls-remote` 确认远端 `release/vX.Y.Z` 精确指向当前 HEAD。

`package.json` 新增：

- `version:check`
- `version:check:ref`
- `version:check:remote`
- `release:gate`

`release:gate` = base image digest guard + pre-release version gate + unit tests + TS build。

### 3. 修复 news-api 运行时版本身份

新增：

- `src/api/release-version.ts`
- `src/api/release-version.test.ts`

修改：

- `Dockerfile.api` 在构建 news-api 时复制当时的 `lazycat/lzc-manifest.yml` 进镜像。
- `/`、`/api/health`、`/api/docs` 不再硬编码 `1.0.0`，改为读取 build-time manifest 的 release version。

这个设计支持部分发布：如果以后 app envelope 升级但没有重建 news-api，旧 news-api 镜像仍报告它真正构建时的版本，而不会谎报新 envelope。

### 4. 文档化

新增：

- `docs/VERSION-GOVERNANCE.md`

明确了 release envelope / component pin / release ref / remote SSoT 的职责和推荐发布顺序。

## 当前工作区改动

Tracked modified:

- `Dockerfile.api`
- `package.json`
- `src/api/news-api-server.ts`

New:

- `docs/VERSION-GOVERNANCE.md`
- `docs/VERSION-GOVERNANCE-HANDOFF-20260817.md`
- `scripts/check-release-version.ts`
- `scripts/check-release-version.test.ts`
- `src/api/release-version.ts`
- `src/api/release-version.test.ts`

## 验证

Focused version tests:

```text
10 pass / 0 fail / 13 expects
```

AX build:

```text
bun run build:ax-framework -> PASS
```

Full release gate:

```text
base image digest guard -> PASS
pre-release version gate -> PASS
bun test -> 200 pass / 0 fail / 6844 expects
TypeScript build -> PASS
git diff --check -> PASS
```

Negative gates are intentionally failing now:

```text
bun run version:check:ref -> exit 1
原因：本次治理改动尚未 commit，工作区 dirty。

bun run version:check:remote -> exit 1
原因：工作区 dirty，且远端 release/v1.21.71 尚未精确指向 866119c。
```

这些失败是版本治理正在正确阻止“未提交/未远端收口就宣称 release 完成”。

## 失败路线 / 纠正

1. 最初版本门禁直接强制本地 release ref 存在，会让下一版“先 bump、后 commit”陷入循环依赖。已拆成 pre-release / ref / remote 三层 gate。
2. 不能仅依赖本地 `origin/*` tracking ref 判断远端是否收口，因为可能 stale。remote gate 改为实时 `git ls-remote`。
3. 没有直接部署 health.version 修复。原因：若把当前未提交改动直接 remote-build 上生产，会再次制造“生产源码无法由 Git 重建”的同类治理债，违背本任务目标。

## 仍未知 / 阻塞

- 当前生产 v1.21.71 的 10 个本地 commits 尚未进入远端 Git SSoT。
- 本次治理代码尚未 commit，因此不能建立下一版精确 release ref，也不应部署。
- `origin/main` 仍停在 `ee4ca46`；是否直接合并整条生产线到 main，需要单独 Git 授权和冲突审查。

## 下一步最高优先级

需要用户明确授权 Git 操作后：

1. 将当前治理改动整理为下一版 release（建议 v1.21.72），先 bump envelope + `news-api` image tag。
2. `bun run release:gate`。
3. commit。
4. 建立 `release/v1.21.72` 精确 ref；`version:check:ref` 必须 PASS。
5. push 生产历史 `release/v1.21.71` 与新 `release/v1.21.72`/对应分支；`version:check:remote` 必须 PASS。
6. 只在远端 Git 可重建后 remote-build + LPK install v1.21.72。
7. 生产验收必须确认 `/api/health.version == 1.21.72`、镜像 tag、源码 SHA 三者一致。
8. 再单独决定是否 merge 到 `origin/main`。
