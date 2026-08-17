# Quote0 版本治理

## 目标

Quote0 的应用版本、各自建服务镜像版本、Git 提交谱系和真实生产状态必须能互相解释、可复现、可追溯。

版本治理不要求所有服务镜像每次都同步 bump。Quote0 经常只发布一个服务，例如只更新 `news-api` 或只更新 `annotation-web`。因此顶层 `version` 是本次发布的 **release envelope**，各服务镜像可以有意保持旧版本。

## 版本规则

1. `lazycat/lzc-manifest.yml` 的顶层 `version` 必须是 SemVer `X.Y.Z`。
2. production 分支中的自建镜像必须使用不可歧义的 `vX.Y.Z` tag，禁止 `latest`。
3. `news-api`、`annotation-web`、`label-web` 的生产镜像版本不得高于 release envelope。
4. 每个 release 至少有一个自建镜像版本与 release envelope 完全一致；否则是只有 manifest bump、没有实际发布对象的 ghost release。
5. 老组件允许继续 pin 在旧版本。例如 app `1.21.71` 可以同时运行 `news-api 1.21.71`、`annotation-web 1.21.68`、`label-web 1.21.29`。
6. 每个已经成为生产事实的 release 必须有明确 Git ref：`release/vX.Y.Z`。不得让生产源码只存在于 detached HEAD。
7. pre-release 门禁只校验版本矩阵，不要求 ref 已存在；否则“先 bump、后 commit”会形成无法通过的循环依赖。
8. commit 后建立 `release/vX.Y.Z` 精确快照 ref；remote release gate 要求 `origin/release/vX.Y.Z` **精确指向当前 release commit**，不能用“某个远端分支碰巧包含它”替代版本身份。
9. 工作区脏时不能通过 remote release gate，因为未提交源码无法由远端 Git 重建。

## 当前 v1.21.71

当前生产 envelope：`1.21.71`。

组件矩阵：

- `news-api`: `v1.21.71` — 本次 release owner
- `annotation-web`: `v1.21.68` — 有意 pin
- `label-web`: `v1.21.29` — 有意 pin

### 运行时版本身份

旧 `news-api` 的 `/`、`/api/health`、`/api/docs` 长期硬编码返回 `1.0.0`，与真实镜像版本无关。版本治理后，`Dockerfile.api` 会把构建当时的 `lazycat/lzc-manifest.yml` 复制进镜像，API 从这份 build-time manifest 读取版本。

这样在部分发布时语义仍然正确：例如 app envelope 升到 `1.21.72` 但没有重建 `news-api`，继续运行的旧 `news-api:v1.21.71` 镜像仍会报告 `1.21.71`，而不会误报新的 app envelope。

生产 `news-api` 的关键 Research/TRMNL/API 源码已经用 SHA256 与本地 `866119c3c99a24ea9f17b133a6d72fba6761ae7d` 做过逐文件比对，结果一致。因此该提交链可以作为 v1.21.71 的真实生产源码谱系。

本地 release ref：

```text
release/v1.21.71 -> 866119c3c99a24ea9f17b133a6d72fba6761ae7d
```

当前仍需单独授权后完成的最后一步，是让这条 release 谱系进入远端 Git SSoT；在此之前 `version:check:remote` 应当保持失败，不能把本机 release ref 误报成已经远端收口。

## 命令

本地静态版本门禁：

```bash
bun run version:check
```

检查：

- release envelope SemVer
- production 自建镜像版本
- 组件版本不得超前
- 至少一个 release owner
- release ref / Git 远端覆盖状态（pre-release 阶段缺失时仅警告）

commit 后的 release 快照门禁：

```bash
bun run version:check:ref
```

要求当前 HEAD 已有精确的 `release/vX.Y.Z` 本地或远端 ref。

远端 SSoT 门禁：

```bash
bun run version:check:remote
```

除了版本矩阵规则，还要求：

- 工作区干净
- `origin/release/vX.Y.Z` 精确指向当前 HEAD

`origin/main` 是否已经合入可以独立治理，但不能代替 release ref 的版本身份。remote gate 使用 `git ls-remote` 实时读取远端 ref，不依赖可能过期的本地 `origin/*` tracking 状态。

完整 release gate：

```bash
bun run release:gate
```

它依次运行：

1. base image digest 守卫
2. 本地版本治理守卫
3. 单元测试 + TypeScript build

## 推荐发布流程

```text
实现/验证
  -> 决定本次 release owner
  -> bump 顶层 version
  -> 只 bump 本次真正重建的自建镜像
  -> bun run release:gate                # pre-release，可在未提交状态运行
  -> 经用户授权 commit
  -> 建立 release/vX.Y.Z 精确 ref
  -> bun run version:check:ref
  -> 经用户授权 push release ref/branch
  -> bun run version:check:remote
  -> remote-build / lpk install          # 此时生产来源已可由远端 Git 重建
  -> 生产源码 SHA / 镜像版本 / health.version 验真
  -> 按需要再经授权 merge main
  -> skldr handoff
```

不要为了“版本看起来整齐”而无意义地给未重建服务换 tag。组件版本落后于 envelope 是允许且有意义的，它准确表达了生产镜像的来源。
