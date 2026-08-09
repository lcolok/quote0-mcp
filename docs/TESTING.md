# Testing Profiles

quote0 的测试分成三层，避免把可重复单测、外部依赖集成测试和人工/live smoke 混在同一个 `bun test` 结果里。

## 1. Unit gate（默认）

```bash
bun test
# 或
bun run test:unit
```

默认由根目录 `bunfig.toml` 管理：

- 只从 `src/` 发现测试，避免扫描 `dist/` 编译产物；
- 排除需要真实 PostgreSQL / MinIO 的 integration tests；
- 排除 `src/react-widgets/tests/` 下历史遗留的手工/live weather smoke 脚本。

这是本地开发和 main 合入前的快速确定性门槛。

## 2. Main gate

```bash
bun run test:gate
```

顺序执行：

1. deterministic unit suite；
2. `bun run build`。

`build` 会先清理 `dist/`，且 `tsconfig.build.json` 不再把 `*.test.ts` 编译进 `dist/`，从生成物层面消除测试重复发现。

## 3. Integration profile

```bash
bun run test:integration
```

当前 integration 范围：

- `src/api/device-delivery-worker.pg.test.ts` — 真实 PostgreSQL delivery/lease/migration；同时覆盖 `minio-image` 预渲染 delivery 的 nullable content_id、source/version 幂等，以及 `payload_error` 不污染设备健康度；
- `src/api/device-health-alerts.pg.test.ts` — 真实 PostgreSQL 健康状态迁移 outbox/lease/重试/旁路保护；
- `src/api/device-frame-cache.test.ts` — 真实 PostgreSQL frame cache；
- `src/api/news-api-server.test.ts` — 需要真实 MinIO 的 API/render 路径。

执行前会运行 TCP preflight，只检查依赖是否可达，不打印数据库密码或其他 secret。默认本地依赖可通过：

```bash
docker compose up -d postgres minio
```

也可以使用：

- `TEST_DATABASE_URL`
- `MINIO_ENDPOINT`
- `MINIO_PORT`

指向隔离的测试服务。

Integration 依赖不可达时应明确失败，而不是把未执行的检查计成“通过”。

## 4. EPD1 / E-Ink focused gate

```bash
bun run test:eink
```

用于 EPD1、delivery policy、ACK/CRC、设备故障隔离相关开发的窄回归。当前也覆盖预渲染 delivery payload 的 SHA-256 内容寻址与路径校验，防止 weather/Memo 队列化后出现可变 MinIO 引用或任意 URL/path 读取。

## 5. Full gate

```bash
bun run test:all
```

顺序为：unit → integration → build。只应在 PostgreSQL / MinIO 已明确准备好时使用。

## 6. Live / manual smoke

`src/react-widgets/tests/` 下的天气/API脚本属于人工或 live smoke，不属于 Bun unit suite。继续使用项目现有的显式脚本，例如：

```bash
bun widget:test
bun widget:test-api
bun widget:test-amap
bun widget:test-multi
```

这类测试可能访问公网或读取本地 `.env`，不应成为 deterministic main gate 的隐式依赖。
