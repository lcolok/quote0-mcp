# Satori 镜像深度优化 - 依赖分析报告

## ✅ 安全移除的依赖

### 1. SQLite (23 MB) ✅
**状态**: 安全移除
- `news-database.ts` 引用了 sqlite3，但没有被任何其他文件导入
- 项目使用 PostgreSQL 作为主数据库

### 2. Canvas (4.2 MB) ✅
**状态**: 安全移除
- 只在 `src/image-sender/` 目录下使用
- API 服务 (`src/api/`) 没有引用 image-sender
- Satori 已完全替代 canvas 的渲染功能

### 3. react-icons (83 MB) ✅
**状态**: 安全移除
- 旧的 `WeatherWidget.tsx` 使用 react-icons
- 新的 `SatoriWeatherWidget.tsx` 使用文本 emoji
- 渲染模块已改用 Satori 组件

### 4. Puppeteer 相关 (29.3 MB) ✅
**状态**: 安全移除
- puppeteer-core (12 MB)
- chromium-bidi (14 MB)
- devtools-protocol (3.3 MB)
- Satori 不需要浏览器渲染

### 5. 开发依赖 (30.4 MB) ✅
**状态**: 生产环境不需要
- typescript (23 MB)
- @types/* (3.4 MB)
- tsx (4 MB)

### 6. 编译工具 (32.6 MB) ✅
**状态**: 生产环境不需要
- node-gyp (2.6 MB)
- make, g++ (30 MB)

## ❌ 不可移除的依赖

### 1. @resvg/resvg-js (8.5 MB)
**原因**: Satori 渲染 SVG 需要

### 2. satori (5.4 MB)
**原因**: 核心渲染引擎

### 3. react + react-dom (12.8 MB)
**原因**: Satori 需要 React 组件

### 4. openai (11 MB)
**原因**: LLM API 调用

### 5. @ax-llm/ax (6.8 MB)
**原因**: AX 优化器核心

### 6. pg (8 MB)
**原因**: PostgreSQL 数据库连接

### 7. redis (11 MB)
**原因**: Redis 缓存

### 8. minio (2.4 MB)
**原因**: MinIO 对象存储

## 📊 优化统计

### 依赖移除统计
| 类别 | 包名 | 大小 | 状态 |
|------|------|------|------|
| 数据库 | sqlite3, sqlite | 28 MB | ✅ 移除 |
| 渲染 | canvas | 4.2 MB | ✅ 移除 |
| 图标 | react-icons | 83 MB | ✅ 移除 |
| 浏览器 | puppeteer-core, chromium-bidi, devtools-protocol | 29.3 MB | ✅ 移除 |
| 开发 | typescript, @types/*, tsx | 30.4 MB | ✅ 移除 |
| 编译 | node-gyp | 2.6 MB | ✅ 移除 |
| **总计** | | **177.5 MB** | |

### 系统依赖移除统计
| 包名 | 大小 | 状态 |
|------|------|------|
| fonts-noto-cjk | ~150 MB | ✅ 移除 |
| python3 | ~80 MB | ✅ 移除 |
| libcairo-dev | ~40 MB | ✅ 移除 |
| libpango-dev | ~25 MB | ✅ 移除 |
| libjpeg-dev | ~15 MB | ✅ 移除 |
| libgif-dev | ~8 MB | ✅ 移除 |
| make, g++ | ~30 MB | ✅ 移除 |
| **总计** | **~348 MB** | |

## 🎯 最终预估

| 项目 | 当前 | 优化后 | 节省 |
|------|------|--------|------|
| 系统依赖 | 733 MB | ~385 MB | 348 MB (47%) |
| node_modules | 307 MB | ~130 MB | 177 MB (58%) |
| 应用代码 | 12 MB | 12 MB | 0 |
| **总计** | **1.2 GB** | **~527 MB** | **~673 MB (56%)** |

## 🚀 构建命令

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

# 5. 在 LC03 部署
lcctl remote docker pull dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori
./scripts/start-news-api.sh v1.0.3-satori
```