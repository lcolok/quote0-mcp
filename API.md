# 📡 模块化新闻处理API

基于Hono框架构建的高性能新闻处理API，支持完全容器化部署。

## 🚀 快速开始

### 一键部署

```bash
# 克隆项目并部署
git clone https://github.com/lcolok/quote0-mcp.git
cd quote0-mcp
bun install
bun api:deploy
```

部署完成后，API将在 `http://localhost:3001` 运行。

### 手动启动

```bash
# 开发模式
bun api:dev

# 生产模式  
bun api:start

# 容器化部署
docker-compose up -d news-api
```

## 📋 API端点

### 🔍 健康检查

```http
GET /api/health
```

响应：
```json
{
  "status": "healthy",
  "timestamp": "2025-08-31T18:15:09.191Z",
  "service": "Modular News API",
  "version": "1.0.0"
}
```

### 📡 获取RSS源列表

```http
GET /api/news/sources
GET /api/news/sources?category=technology
```

响应：
```json
{
  "sources": {
    "technology": [
      {"id": "solidot", "name": "Solidot", "description": "奇客的资讯，重要的东西"},
      {"id": "sspai", "name": "少数派", "description": "高效工作，品质生活"},
      {"id": "cnbeta", "name": "cnBeta", "description": "中文业界资讯站"}
    ],
    "business": [
      {"id": "36kr", "name": "36氪", "description": "创投媒体平台"}
    ]
  },
  "total": 11,
  "categories": ["technology", "business", "design", "programming"]
}
```

### 🎯 处理新闻请求

```http
POST /api/news/process
Content-Type: application/json

{
  "category": "technology",
  "dataSource": "rss", 
  "rssSource": "sspai",
  "processor": "ax-optimized",
  "index": 7,
  "renderer": "device",
  "options": {
    "force": false,
    "border": "0"
  }
}
```

响应：
```json
{
  "success": true,
  "data": {
    "imageUrl": "http://localhost:29000/quote0-images/widgets/news/...",
    "deviceResult": "推送成功"
  },
  "metadata": {
    "processingTime": 23800,
    "workflow": "rss -> ax-optimized -> device",
    "nodeTimings": {
      "datasource": 602,
      "processing": 20682,
      "rendering": 2516
    }
  }
}
```

## 📚 参数说明

### 🔧 请求参数

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `category` | string | `technology` | 新闻分类：`technology`、`finance`、`sports` |
| `dataSource` | string | `mock` | 数据源：`rss`、`mock`、`api`、`hackernews` |
| `rssSource` | string | `solidot` | RSS订阅源（当dataSource=rss时） |
| `processor` | string | `passthrough` | 处理器：`passthrough`、`basic-llm`、`ax-optimized` |
| `index` | number | `0` | 新闻条目索引 |
| `renderer` | string | `news` | 渲染器：`news`、`json`、`device` |

### 📡 可用RSS源

**科技资讯 (technology):**
- `solidot` - 奇客Solidot
- `sspai` - 少数派  
- `cnbeta` - cnBeta
- `pingwest` - PingWest
- `techcrunch` - TechCrunch
- `arstechnica` - Ars Technica

**商业财经 (business):**
- `36kr` - 36氪
- `reuters-tech` - 路透社科技

**设计创意 (design):**
- `designer-news` - Designer News

**开发者 (programming):**
- `github-trending` - GitHub Trending
- `dev-to` - DEV Community

## 💡 使用示例

### 基础使用

```bash
# 获取可用RSS源
curl http://localhost:3001/api/news/sources

# 使用Mock数据快速测试
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{"dataSource": "mock", "renderer": "json"}'
```

### RSS新闻处理

```bash
# 获取少数派最新科技资讯
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "dataSource": "rss",
    "rssSource": "sspai",
    "processor": "passthrough",
    "index": 0,
    "renderer": "json"
  }'
```

### AI优化处理

```bash
# 使用AX优化处理器处理新闻并推送到设备
curl -X POST http://localhost:3001/api/news/process \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "dataSource": "rss",
    "rssSource": "solidot",
    "processor": "ax-optimized",
    "index": 3,
    "renderer": "device"
  }'
```

### 批量处理

```bash
# 处理多个不同源的新闻
for source in solidot sspai cnbeta; do
  curl -X POST http://localhost:3001/api/news/process \
    -H "Content-Type: application/json" \
    -d "{\"rssSource\": \"$source\", \"renderer\": \"device\"}"
done
```

## 🐳 容器化部署

### Docker Compose服务栈

```yaml
services:
  news-api:      # 新闻API服务 (端口3001)
  postgres:      # 数据库 (端口25432) 
  minio:         # 对象存储 (端口29000)
  redis:         # 缓存 (端口26379)
```

### 管理命令

```bash
# 查看服务状态
docker-compose ps

# 查看API日志
docker-compose logs -f news-api

# 停止所有服务
docker-compose down

# 重启API服务
docker-compose restart news-api
```

## 🔄 替代CLI命令

API提供完整的CLI功能替代：

| CLI命令 | API等价调用 |
|---------|-------------|
| `bun widget:modular-news technology rss ax-optimized 7 device sspai` | `POST /api/news/process` 附带相应参数 |

## 🔧 故障排除

### 常见问题

1. **API无响应**
   ```bash
   # 检查服务状态
   curl http://localhost:3001/api/health
   
   # 查看日志
   docker-compose logs news-api
   ```

2. **字体渲染问题**
   ```bash
   # 检查MinIO服务
   curl http://localhost:29001
   
   # 重启API服务
   docker-compose restart news-api
   ```

3. **设备推送失败**
   - 检查设备配置环境变量
   - 确认设备ID和密钥正确
   - 查看API日志获取详细错误信息

## 🌟 特性

- ✅ **完全容器化** - 一键部署，环境隔离
- ✅ **高性能** - 基于Bun和Hono构建 
- ✅ **类型安全** - 完整的TypeScript支持
- ✅ **多RSS源** - 支持11个预设RSS订阅源
- ✅ **AI处理** - 集成LLM和AX框架优化
- ✅ **设备推送** - 支持MindReset设备推送
- ✅ **缓存系统** - Redis缓存提升性能
- ✅ **监控就绪** - 完整的健康检查和日志

## 📞 支持

- 📚 完整文档：访问 `/api/docs`
- 🐛 问题反馈：提交到项目Issues
- 💬 讨论：项目Discussions