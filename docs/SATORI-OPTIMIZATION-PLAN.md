# Satori 镜像深度优化方案

## 📊 当前镜像分析 (1.2 GB)

### 系统依赖 (733 MB)
```
fonts-noto-cjk      ~150 MB  ❌ Satori 不需要
python3             ~80 MB   ❌ 不需要
libcairo-dev        ~40 MB   ❌ 不需要
libpango-dev        ~25 MB   ❌ 不需要
libjpeg-dev         ~15 MB   ❌ 不需要
libgif-dev          ~8 MB    ❌ 不需要
make, g++           ~30 MB   ❌ 不需要
其他系统库          ~385 MB  ⚠️ 部分可精简
```

### node_modules (307 MB)
```
react-icons         83 MB    ❌ 已用文本 emoji 替代
typescript          23 MB    ❌ 生产环境不需要
sqlite3             23 MB    ❌ 项目用 PostgreSQL
chromium-bidi       14 MB    ❌ Puppeteer 相关
puppeteer-core      12 MB    ❌ Puppeteer 相关
canvas              4.2 MB   ❌ Satori 不需要
@types/*            3.4 MB   ❌ 生产环境不需要
devtools-protocol   3.3 MB   ❌ Puppeteer 相关
node-gyp            2.6 MB   ❌ 生产环境不需要
tsx                 4 MB     ❌ 生产环境不需要
其他不必要依赖      ~20 MB   ❌ 可移除
─────────────────────────────────────────
可移除总计          ~170 MB
```

## 🎯 优化方案

### 方案 1: 激进优化 (目标 350 MB)

**系统依赖优化 (-533 MB)**
- 移除 fonts-noto-cjk (-150 MB)
- 移除 python3 (-80 MB)
- 移除 libcairo-dev, libpango-dev, libjpeg-dev, libgif-dev (-88 MB)
- 移除 make, g++ (-30 MB)
- 使用更小的基础镜像 node:22-alpine (-200 MB)

**node_modules 优化 (-170 MB)**
- 移除 react-icons, typescript, sqlite3, puppeteer 等
- 使用精简版 package.satori.json
- 只安装生产依赖

**预估结果**
```
当前:     1.2 GB
优化后:   ~350 MB
节省:     850 MB (71%)
```

### 方案 2: 保守优化 (目标 500 MB)

**系统依赖优化 (-300 MB)**
- 保留 node:22-slim 基础镜像
- 移除 fonts-noto-cjk, python3, 编译工具
- 保留必要的运行时库

**node_modules 优化 (-170 MB)**
- 同方案 1

**预估结果**
```
当前:     1.2 GB
优化后:   ~500 MB
节省:     700 MB (58%)
```

## 📁 已创建的优化文件

1. **Dockerfile.base.satori** - 精简版基础镜像
2. **package.satori.json** - 精简版依赖配置
3. **Dockerfile.api.satori** - 优化版应用镜像构建
4. **scripts/build-satori.sh** - 自动化构建脚本

## 🚀 执行步骤

### 方案 1: 激进优化

```bash
# 1. 构建优化版基础镜像
docker build -t dev.logic.heiyu.space/library/node:22-slim-bun-satori \
  -f Dockerfile.base.satori .

# 2. 推送基础镜像
docker push dev.logic.heiyu.space/library/node:22-slim-bun-satori

# 3. 构建应用镜像
docker build -t dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori \
  -f Dockerfile.api.satori .

# 4. 推送应用镜像
docker push dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori

# 5. 在 LC03 上部署
lcctl remote docker pull dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori
./scripts/start-news-api.sh v1.0.3-satori
```

### 方案 2: 使用 Alpine 基础镜像 (更激进)

```bash
# 创建 Alpine 版本的 Dockerfile.base
cat > Dockerfile.base.alpine << 'EOF'
FROM node:22-alpine

RUN apk add --no-cache \
    ca-certificates \
    curl \
    && wget -qO- https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app
EOF

# 构建
docker build -t dev.logic.heiyu.space/library/node:22-alpine-bun \
  -f Dockerfile.base.alpine .
```

## ⚠️ 注意事项

1. **依赖检查**: 移除 react-icons 前，确保所有组件都已改用文本 emoji
2. **SQLite**: 确认项目完全不使用 SQLite（检查代码中是否有 import sqlite）
3. **Canvas**: 确认 Satori 完全替代了 canvas 的功能
4. **测试**: 优化后需要完整测试所有功能

## 📈 预期效果

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 镜像大小 | 1.2 GB | 350 MB | -71% |
| 推送时间 | ~2 min | ~30 sec | -75% |
| 启动时间 | ~10 sec | ~5 sec | -50% |
| 内存占用 | 516 MiB | ~300 MiB | -42% |