# Claude 开发备忘录

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
- PostgreSQL: 25432 (映射到容器内5432)
- MinIO API: 29000 (映射到容器内9000)
- MinIO Console: 29001 (映射到容器内9001)  
- Redis: 26379 (映射到容器内6379)

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