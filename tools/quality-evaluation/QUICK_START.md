# 🚀 快速开始指南

## 📦 一次性设置

```bash
cd tools/quality-evaluation

# 安装依赖
bun install

# 设置环境变量
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://api.example.com"
```

## 🎯 常用命令

### 1. 评估最近20条（快速检查）

```bash
bunx tsx src/cli.ts recent
```

### 2. 评估最近100条（日常监控）

```bash
bunx tsx src/cli.ts recent -n 100
```

### 3. 评估全部历史（深度分析）⚠️

```bash
bunx tsx src/cli.ts all
```

**警告**: 如果历史记录很多（如5000+条），这可能需要：
- ⏱️ **很长时间**：约50分钟
- 💰 **较多费用**：5000次API调用
- 💾 **较多内存**：建议增加Node内存

**✅ 已优化**: 现已支持自动分页获取，无200条限制！

建议先用时间范围评估：

```bash
# 评估最近7天
bunx tsx src/cli.ts range --from 2025-09-24

# 评估最近一个月
bunx tsx src/cli.ts range --from 2025-09-01
```

### 4. 评估特定RSS源

```bash
# 检查DEV Community是否应该移除
bunx tsx src/cli.ts source -s "DEV Community"

# 对比多个源
bunx tsx src/cli.ts source -s "Ars Technica" "36氪" "Hacker News"
```

### 5. 评估指定时间范围

```bash
# 评估9月份
bunx tsx src/cli.ts range --from 2025-09-01 --to 2025-09-30

# 评估最近一周
bunx tsx src/cli.ts range --from 2025-09-24
```

## 📊 查看报告

报告自动保存在 `reports/` 目录：

```bash
ls -lt reports/  # 查看最新报告

# 查看最新报告
cat reports/$(ls -t reports/ | head -1)
```

## 💡 推荐工作流

### 每日监控

```bash
# 每天评估最近100条
bunx tsx src/cli.ts recent -n 100
```

### 每周分析

```bash
# 每周日评估上周的推送
bunx tsx src/cli.ts range --from $(date -d "7 days ago" +%Y-%m-%d)
```

### 新RSS源评估

添加新RSS源后：

```bash
# 评估这个源的所有推送
bunx tsx src/cli.ts source -s "新RSS源名称"

# 如果平均分<55或过滤率>60%，考虑移除
```

### 全面审计

```bash
# 方案1: 全量评估（如果推送数<1000）
bunx tsx src/cli.ts all

# 方案2: 分批评估（推荐）
bunx tsx src/cli.ts range --from 2025-09-01 --to 2025-09-15
bunx tsx src/cli.ts range --from 2025-09-16 --to 2025-09-30
```

## 🎓 实战示例

### 示例1: 找出最差的RSS源

```bash
# 评估全部或最近500条
bunx tsx src/cli.ts recent -n 500

# 查看报告中的"按RSS源分析"部分
# 找出过滤率>70%的源，建议移除
```

### 示例2: 评估修改效果

```bash
# 移除低质量源前
bunx tsx src/cli.ts recent -n 100

# 移除DEV Community后
bunx tsx src/cli.ts recent -n 100

# 对比两次报告的平均分和过滤率
```

### 示例3: 定期质量报告

```bash
#!/bin/bash
# weekly-report.sh

DATE=$(date +%Y-%m-%d)
echo "生成 $DATE 的质量报告..."

cd tools/quality-evaluation

# 评估最近7天
bunx tsx src/cli.ts range --from $(date -d "7 days ago" +%Y-%m-%d)

# 复制报告到归档目录
mkdir -p archives
cp reports/$(ls -t reports/ | head -1) archives/weekly_report_$DATE.md

echo "报告已保存到 archives/weekly_report_$DATE.md"
```

## ⚙️ 高级配置

### 创建自定义配置

```bash
# 创建配置文件
cat > evaluation-config.json <<EOF
{
  "api": {
    "baseUrl": "http://localhost:3001"
  },
  "llm": {
    "model": "gpt-5-mini",
    "scoreThreshold": 70
  },
  "evaluation": {
    "batchSize": 100
  },
  "output": {
    "reportDir": "./my-reports"
  }
}
EOF

# 使用自定义配置
bunx tsx src/cli.ts recent -c ./evaluation-config.json
```

### 调整评估阈值

默认阈值是60分，可以调整：

```json
{
  "llm": {
    "scoreThreshold": 70  // 更严格：只保留70分以上
  }
}
```

或

```json
{
  "llm": {
    "scoreThreshold": 50  // 更宽松：保留50分以上
  }
}
```

## 🔧 故障排除

### 问题1: 内存不足

```bash
# 增加Node内存限制
NODE_OPTIONS=--max-old-space-size=4096 bunx tsx src/cli.ts all
```

### 问题2: API超时

```bash
# 减小批次大小
bunx tsx src/cli.ts all -b 20
```

### 问题3: 评估太慢

```bash
# 使用时间范围代替全量
bunx tsx src/cli.ts range --from 2025-09-01
```

## 📈 理解报告

### 平均分含义

- **70+**: 优秀，继续保持
- **55-69**: 一般，可以保留但建议优化
- **<55**: 较差，建议移除或降权

### 过滤率含义

- **<30%**: 质量良好
- **30-60%**: 需要关注
- **>60%**: 建议移除

### 质量评级

- 🏆 **优秀**: 平均分≥70
- ⚠️ **一般**: 平均分55-69
- ❌ **较差**: 平均分<55

## 🎯 决策参考

### 是否移除RSS源？

同时满足以下条件建议移除：
- ❌ 平均分 < 55
- ❌ 过滤率 > 60%
- ❌ 高价值内容 < 10%

### 是否保留RSS源？

满足以下任一条件建议保留：
- ✅ 平均分 ≥ 70
- ✅ 过滤率 < 30%
- ✅ 高价值内容 > 30%

---

**需要帮助？** 查看完整文档：`README.md`
