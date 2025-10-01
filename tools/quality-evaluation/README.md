# 📊 新闻内容质量评估工具

灵活、强大的新闻推送质量评估工具，支持多种评估模式和详细的分析报告。

## ✨ 特性

- 🎯 **多种评估模式**：最近N条、全量、时间范围、按RSS源
- 📊 **详细统计分析**：质量分布、按源分析、趋势分析
- 📝 **自动生成报告**：Markdown格式，包含详细数据和建议
- ⚡ **批量处理**：支持大规模评估（数千条记录）
- 🔧 **灵活配置**：支持配置文件和命令行参数
- 📈 **深度洞察**：识别低质量源、推荐优化方向

## 📦 安装

```bash
cd tools/quality-evaluation
npm install
# 或
bun install
```

## 🚀 快速开始

### 环境变量

创建 `.env` 文件或设置环境变量：

```bash
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://api.example.com"
export LLM_MODEL="gpt-5-mini"  # 可选
export NEWS_API_URL="http://localhost:3001"  # 可选
```

### 基本用法

```bash
# 评估最近20条
bunx tsx src/cli.ts recent

# 评估最近50条
bunx tsx src/cli.ts recent -n 50

# 评估全部历史记录
bunx tsx src/cli.ts all

# 评估指定时间范围
bunx tsx src/cli.ts range --from 2025-09-01 --to 2025-09-30

# 评估特定RSS源
bunx tsx src/cli.ts source -s "Ars Technica" "36氪"

# 查看配置
bunx tsx src/cli.ts config
```

## 📖 命令详解

### 1. recent - 评估最近N条

评估最近推送的N条记录。

```bash
bunx tsx src/cli.ts recent [options]

选项:
  -n, --limit <number>   评估数量 (默认: 20)
  -c, --config <path>    配置文件路径
  --no-report            不保存报告
```

**示例**:

```bash
# 评估最近100条
bunx tsx src/cli.ts recent -n 100

# 评估最近50条，不保存报告
bunx tsx src/cli.ts recent -n 50 --no-report
```

### 2. all - 全量评估

评估全部推送历史记录（可能需要较长时间）。

```bash
bunx tsx src/cli.ts all [options]

选项:
  -b, --batch <number>   批次大小 (默认: 50)
  -c, --config <path>    配置文件路径
  --no-report            不保存报告
```

**示例**:

```bash
# 全量评估，批次大小100
bunx tsx src/cli.ts all -b 100

# 全量评估（使用默认批次大小）
bunx tsx src/cli.ts all
```

**注意**: 全量评估可能需要较长时间和较多API调用费用，请谨慎使用。

### 3. range - 时间范围评估

评估指定时间范围内的推送记录。

```bash
bunx tsx src/cli.ts range [options]

选项:
  --from <date>          开始日期 (YYYY-MM-DD)
  --to <date>            结束日期 (YYYY-MM-DD)
  -b, --batch <number>   批次大小 (默认: 50)
  -c, --config <path>    配置文件路径
  --no-report            不保存报告
```

**示例**:

```bash
# 评估9月份的所有推送
bunx tsx src/cli.ts range --from 2025-09-01 --to 2025-09-30

# 评估最近7天
bunx tsx src/cli.ts range --from 2025-09-24

# 评估9月1日之前的所有推送
bunx tsx src/cli.ts range --to 2025-09-01
```

### 4. source - 按RSS源评估

评估特定RSS源的所有推送记录。

```bash
bunx tsx src/cli.ts source [options]

选项:
  -s, --sources <sources...>  RSS源名称（可指定多个）
  -b, --batch <number>        批次大小 (默认: 50)
  -c, --config <path>         配置文件路径
  --no-report                 不保存报告
```

**示例**:

```bash
# 评估单个源
bunx tsx src/cli.ts source -s "Ars Technica"

# 评估多个源
bunx tsx src/cli.ts source -s "Ars Technica" "36氪" "Hacker News"

# 评估DEV Community（检查是否应该移除）
bunx tsx src/cli.ts source -s "DEV Community"
```

### 5. config - 查看配置

显示当前配置。

```bash
bunx tsx src/cli.ts config [options]

选项:
  -c, --config <path>    配置文件路径
```

## ⚙️ 配置

### 配置文件

创建 `evaluation-config.json`：

```json
{
  "api": {
    "baseUrl": "http://localhost:3001",
    "timeout": 30000
  },
  "llm": {
    "model": "gpt-5-mini",
    "scoreThreshold": 60
  },
  "evaluation": {
    "batchSize": 50,
    "maxConcurrent": 5,
    "retryAttempts": 3
  },
  "output": {
    "reportFormat": "markdown",
    "saveToFile": true,
    "reportDir": "./reports",
    "includeDetails": true
  }
}
```

### 使用自定义配置

```bash
bunx tsx src/cli.ts recent -c ./my-config.json
```

## 📊 报告格式

评估完成后会在 `reports/` 目录生成Markdown报告，包含：

1. **总体统计**：推送数、平均分、质量分布
2. **质量分布**：高/中/低价值比例
3. **过滤建议**：建议保留/过滤的比例
4. **按RSS源分析**：每个源的详细表现
5. **详细分析**：
   - 低价值内容列表（建议过滤）
   - 高价值内容列表（保留）
6. **优化建议**：应该移除/保留的RSS源

报告示例：

```
reports/
├── evaluation_recent_2025-10-01T20-15-30.md
├── evaluation_all_2025-10-01T21-00-00.md
└── evaluation_range_2025-10-01T21-30-00.md
```

## 🎯 使用场景

### 1. 日常质量监控

每天评估最近推送：

```bash
bunx tsx src/cli.ts recent -n 100
```

### 2. RSS源选择

评估某个RSS源是否值得保留：

```bash
bunx tsx src/cli.ts source -s "DEV Community"
```

如果过滤率>70%，建议移除。

### 3. 历史质量分析

分析某段时间的内容质量：

```bash
bunx tsx src/cli.ts range --from 2025-09-01 --to 2025-09-30
```

### 4. 全面质量审计

评估全部历史记录：

```bash
bunx tsx src/cli.ts all -b 100
```

**警告**: 这可能需要很长时间和较多API调用费用。

### 5. 对比不同RSS源

```bash
# 评估Ars Technica
bunx tsx src/cli.ts source -s "Ars Technica"

# 评估DEV Community
bunx tsx src/cli.ts source -s "DEV Community"

# 对比报告
```

## 💡 最佳实践

### 1. 定期评估

建议每周运行一次全面评估：

```bash
# 每周日运行
bunx tsx src/cli.ts all -b 100
```

### 2. 新RSS源试用期

添加新RSS源后，评估其前100条推送：

```bash
bunx tsx src/cli.ts source -s "新RSS源名称"
```

如果平均分<55或过滤率>60%，考虑移除。

### 3. 优化阈值调整

如果发现过滤过于严格或宽松，可以调整阈值：

```json
{
  "llm": {
    "scoreThreshold": 70  // 更严格
  }
}
```

### 4. 批次大小调整

- 小数据集（<100条）：使用默认批次大小50
- 中等数据集（100-1000条）：批次大小50-100
- 大数据集（>1000条）：批次大小100-200

```bash
bunx tsx src/cli.ts all -b 100
```

## 🔧 故障排除

### API连接错误

```
❌ API请求失败: 500 Internal Server Error
```

**解决**:
1. 检查API服务是否运行：`curl http://localhost:3001/api/health`
2. 检查`NEWS_API_URL`环境变量
3. 查看API日志：`docker-compose logs news-api`

### LLM API错误

```
❌ LLM API认证失败
```

**解决**:
1. 检查`LLM_API_KEY`和`LLM_BASE_URL`
2. 验证API密钥有效性
3. 检查API配额和限流

### 内存不足

```
JavaScript heap out of memory
```

**解决**:
1. 减小批次大小：`-b 20`
2. 使用时间范围而非全量评估
3. 增加Node内存限制：`NODE_OPTIONS=--max-old-space-size=4096`

## 📈 性能

| 评估数量 | 批次大小 | 预计时间 | API调用数 |
|---------|---------|---------|-----------|
| 20条 | 50 | 15秒 | 20 |
| 100条 | 50 | 1分钟 | 100 |
| 500条 | 100 | 5分钟 | 500 |
| 1000条 | 100 | 10分钟 | 1000 |
| 全量(5000条) | 100 | 50分钟 | 5000 |

**注意**: 实际时间取决于API响应速度和网络状况。

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可

MIT License

---

**工具版本**: 1.0.0
**最后更新**: 2025-10-01
