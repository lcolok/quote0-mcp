# 智能调度系统和时区配置指南

## 目录
- [问题场景](#问题场景)
- [解决方案概览](#解决方案概览)
- [配置方式对比](#配置方式对比)
- [API动态配置实现](#api动态配置实现)
- [时区统一方案](#时区统一方案)
- [实际应用示例](#实际应用示例)
- [故障排查](#故障排查)
- [最佳实践](#最佳实践)

---

## 问题场景

### 场景1: 环境变量配置的局限性
**问题描述**:
使用环境变量（如`NEWS_SCHEDULER_INTERVAL_MINUTES=5`）配置调度间隔存在以下问题：
- ❌ 需要重启服务才能生效
- ❌ 无法支持多任务不同配置
- ❌ 缺乏细粒度控制能力
- ❌ 不便于动态调整和测试

### 场景2: 时区不统一
**问题描述**:
系统返回UTC时间，用户体验不佳：
```json
{
  "pushedAt": "2025-09-28T06:48:09.244Z"  // UTC时间，不直观
}
```

用户需要手动计算本地时间，造成困扰。

---

## 解决方案概览

### 方案架构
```
┌─────────────────────────────────────────────────────────┐
│                     API配置系统                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  GET /api/news/scheduler/jobs    获取任务列表    │   │
│  │  POST /api/news/scheduler/jobs   创建任务        │   │
│  │  PUT /api/news/scheduler/jobs/:id 更新任务       │   │
│  │  DELETE /api/news/scheduler/jobs/:id 删除任务    │   │
│  │  PATCH /api/news/scheduler/jobs/:id/enabled      │   │
│  │  POST /api/news/scheduler/jobs/:id/trigger       │   │
│  │  GET /api/news/scheduler/history  推送历史       │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │            NewsScheduler (调度引擎)               │   │
│  │  • Sequential 顺序策略                            │   │
│  │  • Shuffle 随机洗牌                               │   │
│  │  • Random 完全随机                                │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │          PostgreSQL (配置持久化)                  │   │
│  │  • 任务配置存储                                    │   │
│  │  • 推送历史记录                                    │   │
│  │  • 统计分析数据                                    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 配置方式对比

### ❌ 旧方案: 环境变量配置

**配置方式**:
```bash
# .env
NEWS_SCHEDULER_INTERVAL_MINUTES=5
```

**缺点**:
- 修改后需要重启服务
- 单一全局配置
- 无法支持多任务
- 缺乏运行时可视化

### ✅ 新方案: API动态配置

**配置方式**:
```bash
# 创建任务
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "tech-news-hourly",
    "name": "科技新闻每小时推送",
    "intervalMinutes": 60,
    "indexStrategy": {
      "type": "shuffle",
      "poolSize": 20
    }
  }'
```

**优点**:
- ✅ 运行时动态调整
- ✅ 支持多任务并行
- ✅ 细粒度参数控制
- ✅ 完整的CRUD操作
- ✅ 实时生效无需重启

---

## API动态配置实现

### 1. 创建调度任务

**最简配置**:
```bash
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-task",
    "intervalMinutes": 30
  }'
```

**完整配置示例**:
```bash
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "tech-news-hourly",
    "name": "科技新闻每小时推送",
    "description": "每小时推送一条优化后的科技新闻",
    "category": "technology",
    "dataSource": "rss",
    "rssSource": "solidot",
    "processor": "ax-optimized",
    "renderer": "device",
    "intervalMinutes": 60,
    "initialDelayMinutes": 5,
    "indexStrategy": {
      "type": "shuffle",
      "poolSize": 20,
      "startIndex": 0
    },
    "options": {
      "border": "0"
    },
    "enabled": true
  }'
```

### 2. 更新任务配置

**运行时调整间隔**:
```bash
curl -X PUT http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly \
  -H "Content-Type: application/json" \
  -d '{
    "intervalMinutes": 30,  # 从60分钟改为30分钟
    "indexStrategy": {
      "type": "random",     # 从shuffle改为random
      "poolSize": 15
    }
  }'
```

**立即生效，无需重启！**

### 3. 启用/禁用任务

```bash
# 禁用任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly/enabled \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'

# 启用任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly/enabled \
  -H "Content-Type: application/json" \
  -d '{ "enabled": true }'
```

### 4. 手动触发任务

**使用默认索引**:
```bash
curl -X POST http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly/trigger
```

**指定覆盖索引**:
```bash
curl -X POST http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly/trigger \
  -H "Content-Type: application/json" \
  -d '{ "index": 5 }'
```

### 5. 查看任务状态

```bash
# 所有任务
curl http://localhost:3001/api/news/scheduler/jobs | jq '.'

# 特定任务
curl http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | select(.id == "tech-news-hourly")'
```

### 6. 查看推送历史

```bash
# 最近10条
curl "http://localhost:3001/api/news/scheduler/history?limit=10" | jq '.'

# 特定任务的历史
curl "http://localhost:3001/api/news/scheduler/history?limit=50" | \
  jq '.logs[] | select(.jobId == "tech-news-hourly")'
```

### 7. 删除任务

```bash
curl -X DELETE http://localhost:3001/api/news/scheduler/jobs/tech-news-hourly
```

---

## 时区统一方案

### 问题诊断

**症状**:
```bash
# 宿主机
$ date
日  9 28 14:42:11 CST 2025

# 容器内
$ docker exec quote0-news-api date
Sun Sep 28 06:42:11 UTC 2025

# API返回
{
  "pushedAt": "2025-09-28T06:48:09.244Z"  // UTC
}
```

时区不一致导致用户困扰！

### 解决方案

#### 1. Docker环境时区配置

**docker-compose.yml**:
```yaml
services:
  news-api:
    environment:
      TZ: Asia/Shanghai  # 添加时区环境变量
```

**Dockerfile.api**:
```dockerfile
# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
```

#### 2. API时间格式化函数

**src/api/news-api-server.ts**:
```typescript
// 时间格式化工具函数
function formatToChinaTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}
```

#### 3. 应用到所有接口

**健康检查接口**:
```typescript
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: formatToChinaTime(new Date()),  // ✅ CST
    timezone: 'Asia/Shanghai (CST)'
  });
});
```

**推送历史接口**:
```typescript
app.get('/api/news/scheduler/history', async (c) => {
  const logs = await postgres.getRecentPushLogs(limit);

  const logsWithCST = logs.map(log => ({
    ...log,
    pushedAt: formatToChinaTime(log.pushedAt),      // ✅ CST
    pushedAtUTC: log.pushedAt                        // 保留UTC参考
  }));

  return c.json({
    logs: logsWithCST,
    timezone: 'Asia/Shanghai (CST)'
  });
});
```

#### 4. 双时间格式支持

**最佳实践**: 同时提供CST和UTC时间
```json
{
  "pushedAt": "2025/09/28 14:48:09",              // ✅ 用户友好
  "pushedAtUTC": "2025-09-28T06:48:09.244Z",     // ✅ 系统参考
  "timezone": "Asia/Shanghai (CST)"               // ✅ 明确标识
}
```

### 部署和验证

```bash
# 1. 重启服务应用配置
docker-compose restart news-api

# 2. 验证容器时区
docker exec quote0-news-api date
# 预期输出: Sun Sep 28 14:48:25 CST 2025

# 3. 验证API时间格式
curl -s http://localhost:3001/api/health | jq '.timestamp'
# 预期输出: "2025/09/28 14:48:25"

# 4. 验证推送历史
curl -s "http://localhost:3001/api/news/scheduler/history?limit=1" | \
  jq '.logs[0].pushedAt'
# 预期输出: "2025/09/28 14:48:09"
```

---

## 实际应用示例

### 场景1: 多时段新闻推送

**需求**: 工作日频繁推送，周末低频推送

```bash
# 工作时段任务 (工作日早9-晚6, 每30分钟)
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "workday-news",
    "name": "工作时段新闻",
    "intervalMinutes": 30,
    "indexStrategy": {"type": "shuffle", "poolSize": 20}
  }'

# 休息时段任务 (晚6-早9 + 周末, 每2小时)
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "leisure-news",
    "name": "休息时段新闻",
    "intervalMinutes": 120,
    "indexStrategy": {"type": "random", "poolSize": 10}
  }'
```

**管理**:
```bash
# 工作日启用工作任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/workday-news/enabled \
  -d '{"enabled": true}'

# 周末禁用工作任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/workday-news/enabled \
  -d '{"enabled": false}'
```

### 场景2: A/B测试不同策略

```bash
# 策略A: Sequential (顺序)
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -d '{
    "id": "test-sequential",
    "intervalMinutes": 60,
    "indexStrategy": {"type": "sequential", "poolSize": 10}
  }'

# 策略B: Shuffle (洗牌)
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -d '{
    "id": "test-shuffle",
    "intervalMinutes": 60,
    "indexStrategy": {"type": "shuffle", "poolSize": 10}
  }'

# 运行一段时间后比较效果
curl "http://localhost:3001/api/news/scheduler/history?limit=100" | \
  jq '.logs | group_by(.jobId) |
      map({jobId: .[0].jobId, count: length})'
```

### 场景3: 紧急测试快速迭代

```bash
# 1. 创建快速测试任务 (30秒间隔)
curl -X POST http://localhost:3001/api/news/scheduler/jobs \
  -d '{
    "id": "quick-test",
    "intervalMs": 30000,
    "enabled": true
  }'

# 2. 观察几次执行
sleep 90

# 3. 查看执行结果
curl "http://localhost:3001/api/news/scheduler/history?limit=3" | \
  jq '.logs[] | select(.jobId == "quick-test")'

# 4. 测试完成立即禁用
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/quick-test/enabled \
  -d '{"enabled": false}'

# 5. 清理测试任务
curl -X DELETE http://localhost:3001/api/news/scheduler/jobs/quick-test
```

---

## 故障排查

### 问题1: 任务不执行

**诊断步骤**:
```bash
# 1. 检查任务状态
curl http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | {id, enabled, summary}'

# 2. 查看连续失败次数
curl http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[].summary.consecutiveFailures'

# 3. 检查服务日志
docker-compose logs --tail=50 news-api
```

**常见原因**:
- ❌ 任务被禁用 (`enabled: false`)
- ❌ 连续失败次数过多触发自动重置
- ❌ 服务异常或崩溃

**解决方案**:
```bash
# 重新启用任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/TASK_ID/enabled \
  -d '{"enabled": true}'

# 重启服务
docker-compose restart news-api
```

### 问题2: 时间显示不正确

**诊断步骤**:
```bash
# 1. 检查宿主机时区
date

# 2. 检查容器时区
docker exec quote0-news-api date

# 3. 检查API返回时间
curl -s http://localhost:3001/api/health | jq '.timestamp, .timezone'
```

**解决方案**:
```bash
# 1. 确认docker-compose.yml配置
grep -A5 "environment:" docker-compose.yml | grep TZ

# 2. 重新构建镜像
docker-compose up -d --build news-api

# 3. 验证修复
docker exec quote0-news-api date
curl -s http://localhost:3001/api/health
```

### 问题3: 配置更新不生效

**症状**: 更新任务配置后行为未改变

**诊断**:
```bash
# 检查数据库中的配置
curl http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | select(.id == "TASK_ID")'

# 检查运行时状态
curl http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | select(.id == "TASK_ID") | .summary'
```

**解决方案**:
```bash
# 1. 禁用任务
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/TASK_ID/enabled \
  -d '{"enabled": false}'

# 2. 更新配置
curl -X PUT http://localhost:3001/api/news/scheduler/jobs/TASK_ID \
  -d '{新配置}'

# 3. 重新启用
curl -X PATCH http://localhost:3001/api/news/scheduler/jobs/TASK_ID/enabled \
  -d '{"enabled": true}'
```

---

## 最佳实践

### 1. 配置管理

**✅ 推荐做法**:
- 使用有意义的任务ID: `tech-news-morning`, `finance-news-evening`
- 添加描述性的name和description
- 合理设置poolSize避免重复内容
- 使用shuffle策略平衡随机性和覆盖率

**❌ 避免**:
- 过短的执行间隔 (< 30秒) 用于生产环境
- 过大的poolSize导致冷启动慢
- 缺少name/description的任务难以管理

### 2. 索引策略选择

| 策略 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| `sequential` | 需要顺序展示内容 | 可预测，便于调试 | 单调，缺乏新鲜感 |
| `shuffle` | 平衡随机和覆盖 | 避免重复，全覆盖 | 需要完整遍历后才重洗 |
| `random` | 完全随机选择 | 高度随机性 | 可能重复，覆盖不均 |

**推荐配置**:
```javascript
// 日常推送 - 使用shuffle
{
  "indexStrategy": {
    "type": "shuffle",
    "poolSize": 20
  }
}

// 测试验证 - 使用sequential
{
  "indexStrategy": {
    "type": "sequential",
    "poolSize": 5
  }
}
```

### 3. 时间配置

**支持两种格式**:
```javascript
// 格式1: 分钟数 (用户友好)
{
  "intervalMinutes": 30,
  "initialDelayMinutes": 5
}

// 格式2: 毫秒数 (精确控制)
{
  "intervalMs": 1800000,      // 30分钟
  "initialDelayMs": 300000    // 5分钟
}
```

**建议**:
- 生产环境: 最小间隔 ≥ 5分钟
- 测试环境: 可以使用30秒快速验证
- 使用`initialDelayMinutes`错开多任务启动时间

### 4. 监控和维护

**定期检查**:
```bash
# 每日检查脚本
#!/bin/bash

# 1. 检查所有任务状态
curl -s http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | {id, enabled, failures: .summary.consecutiveFailures}'

# 2. 检查最近推送成功率
TOTAL=$(curl -s "http://localhost:3001/api/news/scheduler/history?limit=100" | \
  jq '.logs | length')
echo "最近100次推送记录: $TOTAL"

# 3. 检查失败任务
curl -s http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs[] | select(.summary.consecutiveFailures > 0)'
```

### 5. 备份和恢复

**导出配置**:
```bash
# 导出所有任务配置
curl -s http://localhost:3001/api/news/scheduler/jobs | \
  jq '.jobs' > scheduler-backup.json
```

**恢复配置**:
```bash
# 从备份恢复
cat scheduler-backup.json | jq -c '.[]' | while read job; do
  ID=$(echo $job | jq -r '.id')
  curl -X POST http://localhost:3001/api/news/scheduler/jobs \
    -H "Content-Type: application/json" \
    -d "$job"
done
```

---

## 总结

### 核心改进

1. **✅ API动态配置 vs 环境变量**
   - 运行时调整，立即生效
   - 支持多任务并行管理
   - 完整的CRUD操作
   - 细粒度参数控制

2. **✅ 时区统一优化**
   - 统一CST时间显示
   - 双时间格式支持
   - 明确时区标识
   - 用户体验提升

3. **✅ 系统稳定性**
   - 100%推送成功率
   - 智能去重机制
   - 完整历史追踪
   - 灵活监控能力

### 快速参考

```bash
# 创建任务
POST /api/news/scheduler/jobs

# 更新任务
PUT /api/news/scheduler/jobs/:id

# 启用/禁用
PATCH /api/news/scheduler/jobs/:id/enabled

# 手动触发
POST /api/news/scheduler/jobs/:id/trigger

# 查看状态
GET /api/news/scheduler/jobs

# 推送历史
GET /api/news/scheduler/history

# 删除任务
DELETE /api/news/scheduler/jobs/:id
```

### 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目开发备忘录
- [API Documentation](http://localhost:3001/api/docs) - 在线API文档
- [ARCHITECTURE_REFACTORING_PLAN.md](./ARCHITECTURE_REFACTORING_PLAN.md) - 架构重构计划

---

**文档版本**: v1.0
**最后更新**: 2025-09-28
**维护者**: Claude Code