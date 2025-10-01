# 🏷️ 新闻质量标注系统使用指南

**版本**: 1.0.0
**创建时间**: 2025-10-02

---

## 📋 目录

- [系统概述](#系统概述)
- [快速开始](#快速开始)
- [架构说明](#架构说明)
- [使用流程](#使用流程)
- [API文档](#api文档)
- [数据库结构](#数据库结构)
- [故障排除](#故障排除)

---

## 系统概述

### 目的

为AX框架的质量评估器构建高质量的人工标注样本集，解决直接LLM评估的标准模糊、无法验证等问题。

### 核心功能

1. **可视化标注界面** - 直观的Web界面，支持评分、维度评估、标签添加
2. **数据导入** - 从RSS源批量导入新闻数据
3. **标注管理** - CRUD操作、历史追踪、版本控制
4. **统计分析** - 实时查看标注进度和质量分布
5. **样本导出** - 导出为AX框架训练格式

---

## 快速开始

### 1. 启动服务

```bash
# 启动所有服务（包括标注系统）
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 2. 访问标注系统

- **标注Web应用**: http://localhost:3002
- **API服务**: http://localhost:3001
- **API文档**: http://localhost:3001/api/docs

### 3. 基本工作流

1. **导入数据**: 访问 http://localhost:3002/import，从RSS源导入新闻
2. **开始标注**: 访问 http://localhost:3002/annotate，逐条标注新闻
3. **查看统计**: 访问 http://localhost:3002/statistics，查看标注进度
4. **导出样本**: 访问 http://localhost:3002/export，导出训练数据

---

## 架构说明

### 技术栈

**前端**:
- React 18 + TypeScript
- Vite (构建工具)
- TailwindCSS (样式)
- TanStack Query (数据获取)
- React Router (路由)

**后端**:
- Hono (API框架)
- PostgreSQL (数据存储)
- Bun (运行时)

**部署**:
- Docker + Docker Compose
- Nginx (前端静态文件服务)

### 服务端口

- `3001` - API服务器
- `3002` - 标注Web应用
- `25432` - PostgreSQL数据库
- `29000` - MinIO API
- `29001` - MinIO Console
- `26379` - Redis

### 网络架构

```
                  ┌──────────────────┐
                  │   浏览器访问      │
                  │ localhost:3002   │
                  └─────────┬────────┘
                            │
                  ┌─────────▼────────┐
                  │  annotation-web  │
                  │   (Nginx:80)     │
                  └─────────┬────────┘
                            │ /api/* 代理
                  ┌─────────▼────────┐
                  │    news-api      │
                  │   (Hono:3001)    │
                  └─────────┬────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ┌─────▼─────┐     ┌────▼─────┐     ┌────▼─────┐
    │ PostgreSQL│     │  Redis   │     │  MinIO   │
    │  :5432    │     │  :6379   │     │  :9000   │
    └───────────┘     └──────────┘     └──────────┘
           │
    quote0-network (Docker bridge network)
```

---

## 使用流程

### 第一步：导入新闻数据

#### 通过Web界面导入

1. 访问 http://localhost:3002/import
2. 选择分类（科技、商业等）
3. 选择RSS源（Solidot、少数派等）
4. 设置导入数量和起始索引
5. 点击"开始导入"

#### 通过API导入

```bash
curl -X POST http://localhost:3001/api/annotation/news/import/rss \
  -H "Content-Type: application/json" \
  -d '{
    "category": "technology",
    "rssSource": "solidot",
    "count": 10,
    "startIndex": 0
  }'
```

### 第二步：标注新闻

#### Web界面标注

1. 访问 http://localhost:3002/annotate
2. 查看新闻预览（标题、来源、摘要）
3. 填写标注表单：
   - **综合评分** (0-100): 拖动滑块评分
   - **五维度评分**:
     - 新闻性: 是否为真正的新闻事件
     - 实用性: 对读者的参考价值
     - 信息密度: 信息量和深度
     - 时效性: 新闻的时效价值
     - 普适性: 受众广度
   - **标注理由**: 简要说明（50字内）
   - **标签**: 添加关键词标签
   - **难度**: 标注难度（简单/中等/困难）
   - **信心度**: 标注信心（0-100%）
4. 提交后自动跳转到下一条

#### 评分标准参考

**高质量 (≥75分)**:
- 重大新闻事件
- 信息量大、有深度
- 受众广泛
- 时效性强

**中等质量 (55-74分)**:
- 有一定新闻价值
- 信息适中
- 受众较广或专业性较强

**低质量 (<55分)**:
- 个人博客、学习日志
- PR稿、营销内容
- 娱乐八卦
- 旧闻、教程汇总

### 第三步：查看统计

访问 http://localhost:3002/statistics 查看：

- 总新闻数
- 待标注数量
- 已完成数量
- 完成率
- 质量分布（高/中/低）
- 按分类统计

### 第四步：导出训练样本

1. 访问 http://localhost:3002/export
2. 设置导出参数：
   - 评分范围（如只导出高质量样本：75-100）
   - 数量限制（可选）
3. 点击"导出为JSON"
4. 下载的JSON文件可直接用于AX训练

---

## API文档

### 标注相关API

#### 获取待标注新闻列表

```http
GET /api/annotation/news?status=pending&limit=50&offset=0
```

**参数**:
- `status`: pending | annotating | completed | skipped
- `limit`: 返回数量
- `offset`: 偏移量
- `category`: 可选，按分类过滤

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "OpenAI发布GPT-5",
      "source": "Solidot",
      "description": "...",
      "annotation_status": "pending",
      ...
    }
  ],
  "pagination": {
    "total": 100,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

#### 提交标注

```http
POST /api/annotation/news/:id/annotate
Content-Type: application/json

{
  "overall_score": 85,
  "category": "high",
  "should_filter": false,
  "news_value": 90,
  "practicality": 80,
  "density": 85,
  "timeliness": 90,
  "universality": 80,
  "reason": "重大科技新闻，信息量大",
  "tags": ["AI", "GPT", "科技突破"],
  "difficulty": "easy",
  "confidence": 90
}
```

#### 导出训练样本

```http
GET /api/annotation/samples/export?minScore=75&maxScore=100&limit=100
```

**响应**:
```json
{
  "version": "1.0.0",
  "createdAt": "2025-10-02T10:00:00Z",
  "samples": [
    {
      "id": 1,
      "input": {
        "title": "...",
        "source": "...",
        "description": "..."
      },
      "output": {
        "score": 85,
        "category": "high",
        "shouldFilter": false,
        "reason": "...",
        "dimensions": { ... },
        "tags": [ ... ]
      },
      "metadata": {
        "annotator": "human",
        "annotatedAt": "...",
        "difficulty": "easy"
      }
    }
  ]
}
```

### 完整API列表

查看完整API文档: http://localhost:3001/api/docs

---

## 数据库结构

### 核心表

**news_raw_data** - 原始新闻数据
```sql
- id (主键)
- title (标题)
- source (来源)
- description (摘要)
- annotation_status (标注状态)
- created_at (创建时间)
```

**quality_annotations** - 质量标注
```sql
- id (主键)
- news_id (关联新闻)
- overall_score (综合评分)
- category (high/medium/low)
- should_filter (是否过滤)
- news_value, practicality, density, timeliness, universality (五维度)
- reason (标注理由)
- tags (标签数组)
- is_latest (是否最新版本)
```

**annotation_history** - 标注历史
```sql
- id (主键)
- annotation_id (关联标注)
- snapshot (历史快照 JSONB)
- change_type (create/update/delete)
- created_at (创建时间)
```

### 实用视图

- `pending_annotations` - 待标注新闻
- `annotated_news` - 已标注新闻
- `annotation_statistics` - 标注统计
- `quality_distribution` - 质量分布

### 实用函数

- `import_rss_news()` - 导入RSS新闻
- `export_training_samples()` - 导出训练样本
- `get_annotation_progress()` - 获取标注进度

---

## 故障排除

### 服务无法启动

```bash
# 查看服务日志
docker-compose logs annotation-web
docker-compose logs news-api

# 重启服务
docker-compose restart annotation-web
```

### Web应用无法连接API

1. 检查nginx配置中的代理设置
2. 确认news-api服务正常运行
3. 检查Docker网络连接

```bash
# 检查网络
docker network inspect quote0-network

# 测试API连接
docker exec quote0-annotation-web wget -qO- http://news-api:3001/api/health
```

### 数据库连接失败

```bash
# 检查数据库状态
docker-compose logs postgres

# 检查数据库连接
docker exec quote0-postgres pg_isready -U quote0_user
```

### 重置数据库

```bash
# 停止服务
docker-compose down

# 删除数据卷
docker volume rm quote0-mcp_postgres_data

# 重新启动
docker-compose up -d
```

---

## 最佳实践

### 标注建议

1. **样本多样性**: 从不同RSS源导入，确保样本多样化
2. **边界案例**: 重点标注55-65分的边界案例
3. **标注一致性**: 参考已有标注保持标准一致
4. **理由清晰**: 标注理由要简洁明确
5. **定期导出**: 完成一定数量后及时导出备份

### 样本集规模建议

- **初始版本**: 100-200条样本
  - 高质量 (≥75分): 30-40条
  - 中等质量 (55-74分): 40-50条
  - 低质量 (<55分): 30-40条

- **生产版本**: 300-500条样本
  - 覆盖所有主要RSS源
  - 包含各种低质量模式
  - 充分的边界案例

---

## 相关文档

- [AX质量评估器改进方案](./AX-Quality-Evaluator-Proposal.md)
- [项目结构说明](./PROJECT_STRUCTURE.md)
- [API服务文档](http://localhost:3001/api/docs)

---

**下一步**: 开始标注样本 → 构建训练集 → 训练AX评估器 → 验证准确率
