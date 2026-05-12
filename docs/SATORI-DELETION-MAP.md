# Satori 镜像优化 - 待删地图

## 📊 总览

| 类别 | 当前大小 | 可删除 | 需确认 | 保留 |
|------|----------|--------|--------|------|
| 系统依赖 | 733 MB | 348 MB | 0 | 385 MB |
| node_modules | 307 MB | 147 MB | 83 MB | 77 MB |
| **总计** | **1.2 GB** | **495 MB** | **83 MB** | **622 MB** |

---

## ✅ 确定可以删除 (495 MB)

### 系统依赖 (348 MB)

| 包名 | 大小 | 删除原因 |
|------|------|----------|
| fonts-noto-cjk | ~150 MB | Satori 使用 TTF 字体，不需要系统 CJK 字体 |
| python3 | ~80 MB | 项目无 Python 依赖 |
| libcairo-dev | ~40 MB | Canvas 渲染库，Satori 不需要 |
| libpango-dev | ~25 MB | 文本排版库，Satori 内置 |
| libjpeg-dev | ~15 MB | JPEG 处理，Satori 输出 PNG |
| libgif-dev | ~8 MB | GIF 处理，Satori 不需要 |
| make, g++ | ~30 MB | 编译工具，生产环境不需要 |

### node_modules (147 MB)

| 包名 | 大小 | 删除原因 | 代码引用状态 |
|------|------|----------|--------------|
| typescript | 23 MB | 生产环境不需要 | devDependency |
| sqlite3 + sqlite | 28 MB | 项目用 PostgreSQL | `news-database.ts` 未被引用 |
| puppeteer-core | 12 MB | Satori 替代 | API 未使用 |
| chromium-bidi | 14 MB | Puppeteer 依赖 | API 未使用 |
| devtools-protocol | 3.3 MB | Puppeteer 依赖 | API 未使用 |
| canvas | 4.2 MB | Satori 替代 | 只在 image-sender 使用 |
| @types/* | 3.4 MB | 生产环境不需要 | devDependency |
| tsx | 4 MB | 生产环境不需要 | devDependency |
| node-gyp | 2.6 MB | 编译工具 | 生产不需要 |
| dockerode | ~5 MB | API 未使用 | 需确认 |
| tar-fs | ~2 MB | API 未使用 | 需确认 |
| 其他小包 | ~45 MB | 需逐个确认 | - |

---

## ⚠️ 需要确认才能删除 (83 MB)

### react-icons (83 MB)

**当前状态**:
- ❌ `SatoriWeatherWidget.tsx` - 已改用文本 emoji
- ❌ `SatoriNewsWidget.tsx` - 不使用图标
- ✅ `WeatherWidget.tsx` - 仍使用 react-icons
- ✅ `MaximizedWeatherWidget.tsx` - 仍使用 react-icons
- ✅ `SmartMaximizedWeatherWidget.tsx` - 仍使用 react-icons
- ✅ `EnhancedMiniWeatherWidget.tsx` - 仍使用 react-icons

**问题**: 
- 这些旧的 WeatherWidget 组件是否还在使用？
- 如果只用 Satori 版本，可以删除
- 如果还需要旧版本渲染（非 E-ink 场景），需要保留

**建议**:
```bash
# 检查哪些地方引用了旧的 WeatherWidget
rg "WeatherWidget" src --type ts | grep -v Satori | grep -v test
```

---

## ❌ 不能删除 (77 MB)

| 包名 | 大小 | 用途 |
|------|------|------|
| @resvg/resvg-js | 8.5 MB | SVG → PNG 渲染 |
| satori | 5.4 MB | 核心渲染引擎 |
| react | 6.4 MB | Satori 需要 |
| react-dom | 6.4 MB | Satori 需要 |
| openai | 11 MB | LLM API |
| @ax-llm/ax | 6.8 MB | AX 优化器 |
| pg | 8 MB | PostgreSQL |
| @redis | 11 MB | Redis 缓存 |
| hono | 2.6 MB | HTTP 框架 |
| minio | 2.4 MB | 对象存储 |
| rss-parser | 1.9 MB | RSS 解析 |
| zod | 5.1 MB | 数据验证 |
| @modelcontextprotocol | 8.3 MB | MCP 协议 |
| 其他必要包 | ~15 MB | 辅助功能 |

---

## 🎯 决策清单

### 请确认以下问题：

1. **react-icons (83 MB)**
   - [ ] 旧的 WeatherWidget 组件是否还在使用？
   - [ ] 是否需要支持非 E-ink 设备的渲染？
   - [ ] 如果删除，是否接受用文本 emoji 替代所有图标？

2. **image-sender 模块**
   - [ ] `src/image-sender/` 是否还需要？
   - [ ] 如果不需要，可以一起删除 canvas 依赖

3. **其他依赖**
   - [ ] dockerode 是否在 API 中使用？
   - [ ] tar-fs 是否在 API 中使用？
   - [ ] weathercityid 是否在 API 中使用？

---

## 📋 执行计划

### 阶段 1: 确定删除 (495 MB)
```bash
# 1. 更新 Dockerfile.base.satori（移除系统依赖）
# 2. 更新 package.satori.json（移除确定删除的依赖）
# 3. 重新构建镜像
```

### 阶段 2: 确认后删除 (83 MB)
```bash
# 根据您的确认，决定是否移除 react-icons
```

### 阶段 3: 验证测试
```bash
# 1. 构建优化版镜像
# 2. 部署到 LC03
# 3. 测试所有功能
# 4. 对比资源使用
```

---

## 📈 预期结果

| 方案 | 镜像大小 | 节省 |
|------|----------|------|
| 当前 | 1.2 GB | - |
| 阶段 1 后 | ~700 MB | 42% |
| 阶段 2 后 | ~620 MB | 48% |

---

## 💡 建议

如果您暂时无法确认，可以：

1. **先执行阶段 1** - 删除确定可以删除的 495 MB
2. **保留 react-icons** - 等确认后再决定
3. **创建两个版本**:
   - `v1.0.3-satori` - 最小版本（删除 react-icons）
   - `v1.0.3-satori-full` - 保留 react-icons 的版本

这样您可以先享受 42% 的镜像缩小，同时保留灵活性。