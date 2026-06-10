# Claude 开发备忘录

## 📚 文档导航

### 配置和部署指南
- **[智能调度系统和时区配置指南](docs/Scheduler-And-Timezone-Configuration-Guide.md)** - API动态配置、时区统一、调度策略选择
- **[新闻质量标注系统使用指南](docs/Annotation-System-Guide.md)** - 可视化标注界面、样本集构建、AX训练数据导出
- [天气组件使用指南](docs/WEATHER_WIDGET_GUIDE.md) - 天气小组件配置和使用
- [MindReset图像API文档](docs/MINDRESET_IMAGE_API.md) - 设备推送接口说明

### 架构和设计文档
- [项目结构说明](docs/PROJECT_STRUCTURE.md) - 完整项目结构和模块说明
- [架构重构计划](docs/ARCHITECTURE_REFACTORING_PLAN.md) - 系统架构演进路线
- [动态城市服务架构](docs/DYNAMIC_CITY_SERVICE_ARCHITECTURE.md) - 城市数据动态化设计
- [新闻处理架构演进](docs/News-Processing-Architecture-Evolution.md) - 新闻系统模块化重构

### 高级特性
- [AX框架深入指南](docs/AX-Framework-Deep-Dive.md) - AX优化器原理和使用
- [AX快速参考](docs/AX-Quick-Reference.md) - AX常用命令和示例
- [AX质量评估器改进方案](docs/AX-Quality-Evaluator-Proposal.md) - 基于人工标注的质量评估系统设计

## 🚀 快速开始

### 首次使用（全新机器）
```bash
# 一键自动化部署所有服务
bun setup

# 检查服务状态
bun check

# 查看运行中的服务
bun status
```

### 服务管理
```bash
# 启动所有服务
docker-compose up -d

# 停止所有服务  
docker-compose down

# 重启服务
docker-compose restart

# 查看服务日志
docker-compose logs -f
```

## 快捷命令

### CLI方式 - 小组件生成和发送
```bash
# 天气组件
bun widget weather 花都
bun widget weather 海珠区 0 amap

# 新闻组件（模块化架构）
bun widget:modular-news technology rss passthrough 1 json
bun widget:modular-news technology rss basic-llm 3 device  
bun widget:modular-news technology rss ax-optimized 5 device

# 传统新闻组件
bun widget news technology
bun widget news finance 0 mock
```

### 标注系统 - 构建AX训练样本
```bash
# 访问标注Web界面
open http://localhost:3002

# 1. 导入RSS新闻数据（通过API）
curl -X POST http://localhost:3001/api/annotation/news/import/rss \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "rssSource": "solidot",
    "count": 10,
    "startIndex": 0
  }'

# 2. 通过Web界面进行人工标注
# 访问 http://localhost:3002/annotate

# 3. 导出训练样本
curl -s http://localhost:3001/api/annotation/samples/export?minScore=0&maxScore=100

# 4. 查看标注统计
curl -s http://localhost:3001/api/annotation/statistics
```

### API方式 - HTTP接口调用（推荐）
```bash
# 健康检查
curl -s http://localhost:3001/api/health

# AX优化新闻处理和设备推送
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "dataSource": "rss", 
    "processor": "ax-optimized",
    "index": 1,
    "renderer": "device"
  }'

# JSON格式输出（用于调试）
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "dataSource": "rss",
    "processor": "ax-optimized", 
    "index": 2,
    "renderer": "json"
  }'

# API文档查看
curl -s http://localhost:3001/api/docs
```

### 原始命令（带环境变量）
如果需要使用原始命令：
```bash
MINDRESET_DEVICE_ID=E4B063CC0F10 MINDRESET_DEVICE_SECRET=dot_app_pVMhvUteeDqAnibZQtMofYnkJuyaMjEXzgcohArxPyJbEJgnYPTpUcRsalPnEDyr node dist/image-sender/interfaces/cli/cli-main.js send "图片路径" 0
```

## 项目结构

### API服务（容器化）
- `src/api/server.ts` - API服务器启动入口
- `src/api/news-api-server.ts` - Hono REST API实现
- `Dockerfile.api` - API服务容器化配置
- `docker-compose.yml` - 完整服务编排

### 插件系统
- `src/react-widgets/core/widget-plugin.ts` - 插件接口定义
- `src/react-widgets/core/widget-registry.ts` - 插件注册表
- `src/react-widgets/core/widget-cli-engine.ts` - 通用CLI执行引擎
- `src/react-widgets/core/processing-modules.ts` - 处理模块（含AX优化器）

### 已实现组件
- `src/react-widgets/plugins/weather-plugin.ts` - 天气组件插件
- `src/react-widgets/plugins/news-plugin.ts` - 新闻组件插件
- `src/react-widgets/plugins/modular-news-plugin.ts` - 模块化新闻插件

### AX框架与训练数据
- `ax-framework/models/production/latest.json` - AX优化器预训练模型
- `ax-framework/compiled/ax-training-data.js` - 快速训练数据集
- `src/react-widgets/services/ax-optimized-news-processor-simplified.ts` - AX处理器实现

### 字体系统
- 使用智能字体选择算法，支持8px/10px/12px像素字体
- 16px显示使用8px基础字体进行2x整数倍缩放

## 🔧 故障排除

### 常见问题

#### API服务无法从宿主环境访问
**症状**: `curl: (52) Empty reply from server` 或连接被重置
**原因**: API服务绑定到localhost而非0.0.0.0
**解决方案**:
```bash
# 确保docker-compose.yml中有以下环境变量
environment:
  HOST: 0.0.0.0  # 允许外部访问
  PORT: 3001

# 重启服务应用配置
docker-compose restart news-api
```

#### AX优化器错误诊断
**症状**: AX优化处理失败，错误信息不清楚
**现在提供详细错误信息**:
- `无法连接LLM服务: Connection error. (请检查baseURL是否正确: xxx)` - 检查LLM_BASE_URL
- `LLM API认证失败: 401 Unauthorized (请检查API密钥是否正确)` - 检查LLM_API_KEY
- `预训练模型未找到，使用基础数据进行快速训练...` - 训练数据缺失，自动降级

#### 通用故障排除
```bash
# 命令卡住无响应
bun check                    # 检查服务状态
bun setup                    # 重新部署服务

# 服务连接失败
docker-compose logs          # 查看服务日志
docker-compose logs news-api # 查看API服务日志
docker-compose restart      # 重启服务

# 模块健康检查
bun widget:modular-news --health

# 查看网络诊断
bun widget:diagnostics

# API服务健康检查
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/api/health/modules
```

### 服务端口
- **新闻API服务**: 3001 (http://localhost:3001)
- **标注Web应用**: 3002 (http://localhost:3002) - 可视化标注界面
- PostgreSQL: 25432 (映射到容器内5432)
- MinIO API: 29000 (映射到容器内9000)
- MinIO Console: 29001 (映射到容器内9001)
- Redis: 26379 (映射到容器内6379)

## ⚠️ 懒猫微服部署重要注意事项

### 🚫 禁止手动启动容器
**绝对不要**在懒猫微服上使用 `docker run` 手动启动容器！

```bash
# ❌ 错误做法 - 手动启动容器
lcctl remote docker run -d --name mefridayquote0-mcp-news-api-1 ...

# ❌ 也别用 lcctl project release —— 本项目 manifest 在子目录 lazycat/，
#    它认不到、会到处探路烧光步数报「假失败」（详见下方「正确的部署流程」）

# ✅ 正确做法 - 零本地 docker：lcctl 盒子端构建 + lzc-cli 打包装（见下）
```

### 为什么必须通过懒猫部署？

| 功能 | 手动 docker run | 懒猫正式部署 |
|------|-----------------|--------------|
| 服务发现 | ❌ 懒猫不认识 | ✅ 自动注册 |
| 健康检查 | ❌ 不经过懒猫 | ✅ 统一监控 |
| 网络管理 | ❌ 独立网络 | ✅ 懒猫管理 |
| 配置管理 | ❌ 手动传入 | ✅ lzc-manifest.yml |
| 状态显示 | ❌ 显示"状态错误" | ✅ 正常显示 |

### 正确的部署流程：零本地 docker，lcctl 盒子端构建（2026-06-11 实测跑通 v1.17.9）

> 🚫 **永远不要本地 `docker build`/`docker push`**。Mac 上 `docker build --platform linux/amd64` + push 会撞两个坑，都是「本地构建」错路的副产物：
> 1. **keychain 锁**：非交互会话（Claude/agent 的 Bash）下 docker 凭据助手读不到钥匙串 → push 必失败，**解锁也没用**。
> 2. **bun SIGILL**：Apple Silicon 上 QEMU 模拟 x86 跑 `bun run build`/`vite build` 报 `CPU lacks AVX` + 段错误，`--network=host` 救不了。
>
> 盒子本身是原生 amd64（无 QEMU、无本地 keychain），盒子端构建+推这两个坑根本不出现。「远程 bun install 卡死」是**已被推翻的旧结论**——只对本地朴素 docker build 默认 bridge 网络成立，对 lcctl `remote-build` 的 buildkit 路径**不成立**（盒子上 bun install 正常）。详见 memory `feedback_lazycat_deploy_no_local_docker` / `feedback_bun_macos_lan_socket_bug`。

> ⚠️ **lcctl 114 的一键 `project deploy`/`release` 对本项目的 lazycat-subdir 布局都坏**（manifest 字段推断逐个崩 package-id→version→target-image-repo、多服务自动发现认不出 `#@build` 条件块的 3 个服务）。只有 `plan-release` 的分析是对的；执行得走**单服务 `remote-build` + lzc-cli 打包装**。每条命令带 `TMPDIR=/tmp`（macOS 长 $TMPDIR 撑爆 lzc-cli SSH ControlPath 104 字节）。

```bash
# 0. 先问正门拿命令蓝本（只分析、零副作用）
TMPDIR=/tmp lcctl project plan-release --path . --host root@logic.heiyu.space

# 1. bump 版本（必须在 lazycat/ 里跑才认得 manifest）；只 bump version + 停在旧版本号的镜像(news-api)
cd lazycat && TMPDIR=/tmp lcctl project bump --version <X.Y.Z>
#    ⚠️ 改了 label-web/annotation-web 的话，手动把它们的正式 image tag 也补成 <X.Y.Z>
#       bump 只动停在旧版本号的镜像；同 tag 不变 → pkgm 不 recreate 容器 → 新代码不上线（trap #8）

# 2. 盒子端单服务构建+推（每个改过的镜像一条，从仓库根跑，--no-cache 必带防 trap #10 缓存全 hit）
TMPDIR=/tmp lcctl project remote-build --ssh root@logic.heiyu.space --no-cache \
  -dockerfile Dockerfile.api -tag dev.logic.heiyu.space/friday/quote0-mcp-api:<X.Y.Z> -context .
TMPDIR=/tmp lcctl project remote-build --ssh root@logic.heiyu.space --no-cache \
  -dockerfile Dockerfile.lazycat -tag dev.logic.heiyu.space/friday/quote0-label-web:<X.Y.Z> -context label-web
#    push 看到新内容层是 `Pushed`（而非全 `Layer already exists`）才算新代码进了镜像

# 3. 打包 lpk + 安装（lcctl release 的 manifest 推断对 subdir 布局会崩，改用底层 lzc-cli）
cd lazycat && TMPDIR=/tmp lzc-cli project build                       # 出 me.friday.quote0-mcp-v<X.Y.Z>.lpk
TMPDIR=/tmp lzc-cli lpk install me.friday.quote0-mcp-v<X.Y.Z>.lpk

# 4. 验证新代码真上线（防 trap #10）——app 容器跑在 lzc-docker，容器名 mefridayquote0-mcp-<svc>-1
ssh root@logic.heiyu.space "docker -H unix:///lzcsys/run/lzc-docker/docker.sock \
  exec mefridayquote0-mcp-news-api-1 curl -s localhost:3001/api/<新端点>"
```

### 教训记录
- **2026-05-12 — 禁止手动 docker run**
  - 问题：手动启动容器导致懒猫显示"状态错误"
  - 原因：懒猫的服务发现机制不认识手动启动的容器
  - 解决：必须通过懒猫正式部署（上方 4 步流程）
- **2026-06-04 — `lcctl project release` 不认子目录 manifest（假失败）**
  - 问题：用 `lcctl project release` 部署，撞 100 步上限报 `exit 1`/`failed`
  - 原因：本项目 manifest 在 `lazycat/` 子目录，`lcctl project release` 在根目录找不到，反复探路烧光步数；这是「假失败」，部署可能已成功
  - 解决：改用上方流程；收到 failed 先 tail 输出找成功信号
- **2026-06-11 — 「必须本地构建」是错的，已纠正为零本地 docker（部署 v1.17.9）**
  - 问题：照旧文档「本地构建 amd64」走，撞 ① `docker push` keychain 锁（非交互会话读不到钥匙串，解锁无效）② Apple Silicon QEMU 跨架构 build bun 报 `CPU lacks AVX` + SIGILL 段错误
  - 原因：这两个坑全是「本地构建」错路的副产物；盒子原生 amd64 构建根本不出现。「远程 bun install 卡死」是被推翻的旧结论，只对本地朴素 docker build 成立
  - 解决：弃本地 docker，走上方 lcctl 盒子端**单服务 `remote-build`**（盒子构建+推）+ `lzc-cli project build`/`lpk install`。注意 lcctl 114 的一键 `deploy`/`release` 对 subdir 布局都坏，只 `plan-release` 分析可信

## 开发规范

### 新组件开发流程
1. 创建组件React文件：`src/react-widgets/components/XxxWidget.tsx`
2. 创建插件实现：`src/react-widgets/plugins/xxx-plugin.ts`
3. 在CLI中注册插件
4. 测试和优化

### 字体使用
- 所有组件使用 `FontLoader.getFusionPixelFontFamily()` 
- 字体大小使用16px以获得最佳清晰度（8px基础字体×2）
- 行高设置为字体大小+2px（如16px字体用18px行高）

### 模块化架构参数说明
```
bun widget:modular-news <category> <dataSource> <processor> <index> <renderer>
```
- **category**: 新闻分类 (technology, finance, sports, etc.)
- **dataSource**: 数据源 (rss, mock, api, hackernews)  
- **processor**: 处理器 (passthrough, basic-llm, ax-optimized)
- **index**: RSS索引位置 (0-N)
- **renderer**: 渲染器 (json, news, device)