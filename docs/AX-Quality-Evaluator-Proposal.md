# 🚀 基于AX框架的质量评估器改进方案

**提出时间**: 2025/10/02
**目标**: 使用AX框架 + 人工标注样本集，构建更准确的新闻质量评估器

---

## 🎯 为什么要用AX框架？

### 当前方案的问题

**直接LLM评估** (news-quality-evaluator.ts):
```typescript
// 当前做法：用prompt描述评估标准
const prompt = `
请评估新闻质量，维度包括：
1. 新闻性 (0-100): 重要事件 vs 个人博客
2. 实用性 (0-100): 参考价值 vs 娱乐八卦
...
`;

// 问题：LLM对"重要事件"的理解可能与您的期望不同
```

**核心问题**:
1. ❌ **标准模糊**: "重要事件"、"参考价值"等概念难以精确传达
2. ❌ **无法验证**: 不知道LLM是否真正理解了您的标准
3. ❌ **无法改进**: 发现错误后只能调整prompt，效果有限
4. ❌ **边界不稳定**: 对于60分附近的边界案例，判断不一致

### AX框架的优势

**Few-Shot Learning + 自动优化**:
```typescript
// AX做法：用实际样本教LLM什么是好新闻
const trainingData = [
  {
    input: {
      title: "OpenAI发布GPT-5，性能提升10倍",
      source: "Ars Technica"
    },
    output: {
      score: 92,
      shouldFilter: false,
      reason: "重大技术突破，影响深远"
    }
  },
  {
    input: {
      title: "Learn React With Me - Day 5",
      source: "DEV Community"
    },
    output: {
      score: 25,
      shouldFilter: true,
      reason: "个人学习日志，无新闻价值"
    }
  },
  // ... 更多实际样本
];

// AX会自动：
// 1. 从样本中学习评估模式
// 2. 优化prompt使其符合样本标准
// 3. 对新内容进行一致的评估
```

**核心优势**:
1. ✅ **标准精确**: 通过实际样本定义"好"与"坏"
2. ✅ **可验证**: 可以用测试集验证准确率
3. ✅ **可改进**: 添加新样本持续优化
4. ✅ **边界清晰**: 基于样本学习，边界更稳定

---

## 📊 实施方案

### 第一阶段：构建样本集 (人工标注)

#### 1.1 从现有评估结果中筛选样本

**高质量样本** (score ≥ 75):
```json
{
  "title": "OpenAI准备建造的数据中心消耗的电力相当于纽约和圣迭戈",
  "source": "奇客Solidot",
  "humanScore": 90,
  "humanReason": "重大科技新闻，具体数据支撑，广泛关注",
  "shouldFilter": false
}
```

**中等质量样本** (score 55-74):
```json
{
  "title": "北京市首笔数字人民币担保贷款落地",
  "source": "36氪",
  "humanScore": 66,
  "humanReason": "有新闻价值但信息密度低，区域性较强",
  "shouldFilter": false
}
```

**低质量样本** (score < 55):
```json
{
  "title": "Learn Bash Scripting With Me 🚀 - Day 8",
  "source": "DEV Community",
  "humanScore": 20,
  "humanReason": "个人学习日志，完全无新闻价值",
  "shouldFilter": true
}
```

#### 1.2 样本集结构

**推荐规模**:
- 总样本数: 100-200条
- 高质量 (≥75分): 30-40条
- 中等质量 (55-74分): 40-50条
- 低质量 (<55分): 30-40条

**分布建议**:
- 每个RSS源至少10条样本
- 包含各种典型的低质量模式（学习日志、PR稿、社区通知等）
- 包含边界案例（58-62分范围）

**存储格式**:
```typescript
// ax-framework/training-data/quality-evaluation-samples.json
{
  "version": "1.0.0",
  "createdAt": "2025-10-02",
  "samples": [
    {
      "id": 1,
      "input": {
        "title": "...",
        "source": "...",
        "description": "..." // 可选
      },
      "output": {
        "score": 85,
        "category": "high",
        "shouldFilter": false,
        "reason": "...",
        "dimensions": {
          "newsValue": 90,
          "practicality": 80,
          "density": 85,
          "timeliness": 90,
          "universality": 80
        },
        "tags": ["科技新闻", "重大事件"]
      },
      "metadata": {
        "annotator": "human",
        "annotatedAt": "2025-10-02",
        "difficulty": "easy" // easy/medium/hard
      }
    }
  ]
}
```

---

### 第二阶段：实现AX质量评估器

#### 2.1 创建新文件

**位置**: `src/react-widgets/services/ax-quality-evaluator.ts`

**核心实现**:
```typescript
import { OpenAI } from 'openai';

export interface QualityTrainingExample {
  input: {
    title: string;
    source: string;
    description?: string;
  };
  output: {
    score: number;
    category: 'high' | 'medium' | 'low';
    shouldFilter: boolean;
    reason: string;
    dimensions: {
      newsValue: number;
      practicality: number;
      density: number;
      timeliness: number;
      universality: number;
    };
    tags: string[];
  };
}

export class AxQualityEvaluator {
  private trainingData: QualityTrainingExample[] = [];
  private optimizedInstruction: string = '';

  constructor(private options: {
    apiKey: string;
    baseURL: string;
    model: string;
  }) {}

  /**
   * 加载训练样本
   */
  async loadTrainingSamples(filepath: string) {
    const fs = await import('fs/promises');
    const data = await fs.readFile(filepath, 'utf-8');
    const samples = JSON.parse(data);
    this.trainingData = samples.samples;
    console.log(`✅ 已加载 ${this.trainingData.length} 个训练样本`);
  }

  /**
   * 优化评估指令 (类似AX的optimize过程)
   */
  async optimizeInstruction() {
    // 使用训练数据优化instruction
    // 这里简化实现，实际AX会做更复杂的优化

    const goodExamples = this.trainingData
      .filter(ex => !ex.output.shouldFilter)
      .slice(0, 5);

    const badExamples = this.trainingData
      .filter(ex => ex.output.shouldFilter)
      .slice(0, 5);

    this.optimizedInstruction = `
你是专业的新闻质量评估专家。请参考以下示例学习评估标准：

【高质量新闻示例】
${goodExamples.map((ex, i) => `
示例${i + 1}:
标题: ${ex.input.title}
来源: ${ex.input.source}
评分: ${ex.output.score}分
理由: ${ex.output.reason}
`).join('\n')}

【低质量内容示例】
${badExamples.map((ex, i) => `
示例${i + 1}:
标题: ${ex.input.title}
来源: ${ex.input.source}
评分: ${ex.output.score}分
理由: ${ex.output.reason}
`).join('\n')}

【评估标准】
根据以上示例，评估新闻时重点关注：
1. 是否是真正的新闻事件（而非个人博客、学习日志）
2. 是否有实质性信息（而非空洞PR稿、社区通知）
3. 是否对读者有价值（而非娱乐、购物导向）
4. 是否具有时效性（而非旧闻、教程汇总）
5. 是否受众广泛（而非小众话题、区域新闻）

【评分参考】
- 90-100分: 重大新闻，广泛影响
- 75-89分: 优质内容，有价值
- 60-74分: 一般内容，可以保留
- 55-59分: 边界案例，谨慎判断
- <55分: 低质量，应该过滤

请严格按照示例的标准进行评估。
`;

    console.log(`✅ 评估指令已优化`);
  }

  /**
   * 使用优化后的指令评估新闻
   */
  async evaluate(news: {
    title: string;
    source: string;
    description?: string;
  }) {
    const client = new OpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL
    });

    // 构建few-shot prompt
    const prompt = `
${this.optimizedInstruction}

【待评估新闻】
标题: ${news.title}
来源: ${news.source}
${news.description ? `摘要: ${news.description}` : ''}

请返回JSON格式评估结果：
{
  "score": 综合评分(0-100),
  "category": "high" | "medium" | "low",
  "shouldFilter": true/false,
  "reason": "评估理由（50字内）",
  "dimensions": {
    "newsValue": 新闻性评分,
    "practicality": 实用性评分,
    "density": 信息密度评分,
    "timeliness": 时效性评分,
    "universality": 普适性评分
  },
  "tags": ["标签1", "标签2"]
}
`;

    const response = await client.chat.completions.create({
      model: this.options.model,
      messages: [
        { role: 'system', content: '你是专业的新闻质量评估专家' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return result;
  }

  /**
   * 验证评估器准确率
   */
  async validateAccuracy(testSamples: QualityTrainingExample[]) {
    let correct = 0;
    let total = testSamples.length;

    for (const sample of testSamples) {
      const predicted = await this.evaluate(sample.input);

      // 检查分类是否正确（±10分容差）
      if (Math.abs(predicted.score - sample.output.score) <= 10) {
        correct++;
      }
    }

    const accuracy = (correct / total) * 100;
    console.log(`📊 验证准确率: ${accuracy.toFixed(1)}% (${correct}/${total})`);
    return accuracy;
  }
}
```

---

### 第三阶段：集成到评估工具

#### 3.1 修改 `tools/quality-evaluation/src/evaluator.ts`

```typescript
import { AxQualityEvaluator } from '../../../src/react-widgets/services/ax-quality-evaluator.js';

export class FlexibleNewsEvaluator {
  private axEvaluator?: AxQualityEvaluator;
  private useAx: boolean = false;

  async initialize(options: {
    useAx?: boolean;
    trainingSamplesPath?: string;
  }) {
    if (options.useAx) {
      this.axEvaluator = new AxQualityEvaluator({
        apiKey: this.config.llmApiKey,
        baseURL: this.config.llmBaseURL,
        model: this.config.llmModel
      });

      await this.axEvaluator.loadTrainingSamples(
        options.trainingSamplesPath ||
        'ax-framework/training-data/quality-evaluation-samples.json'
      );

      await this.axEvaluator.optimizeInstruction();
      this.useAx = true;

      console.log('✅ AX质量评估器已启用');
    }
  }

  async evaluate(news: NewsInput): Promise<QualityEvaluation> {
    if (this.useAx && this.axEvaluator) {
      // 使用AX评估器
      return await this.axEvaluator.evaluate(news);
    } else {
      // 使用原有的直接LLM评估
      return await this.legacyEvaluate(news);
    }
  }
}
```

#### 3.2 CLI支持

```bash
# 使用AX评估器
bunx tsx src/cli.ts recent -n 30 --use-ax

# 使用自定义样本集
bunx tsx src/cli.ts recent -n 30 --use-ax --samples ./my-samples.json
```

---

## 📊 预期效果

### 准确率提升

| 指标 | 当前方案 | AX方案 | 提升 |
|------|---------|--------|------|
| 高质量识别准确率 | ~75% | ~90% | +15% |
| 低质量识别准确率 | ~80% | ~95% | +15% |
| 边界案例一致性 | ~60% | ~85% | +25% |
| 评估标准吻合度 | 中等 | 高 | 显著提升 |

### 可持续改进

**迭代流程**:
```
1. 运行评估，收集结果
   ↓
2. 人工检查错误案例
   ↓
3. 将错误案例添加到训练集
   ↓
4. 重新优化AX评估器
   ↓
5. 验证准确率提升
   ↓
回到步骤1
```

**长期收益**:
- 每次迭代准确率提升2-5%
- 评估标准越来越符合您的需求
- 边界案例处理越来越准确

---

## 🛠️ 实施步骤

### Step 1: 构建初始样本集 (1-2小时)

```bash
# 1. 查看现有评估报告
cat tools/quality-evaluation/reports/evaluation_all_*.md

# 2. 人工标注100条样本
# 创建文件：ax-framework/training-data/quality-evaluation-samples.json

# 3. 标注示例
{
  "samples": [
    {
      "input": { "title": "...", "source": "..." },
      "output": {
        "score": 85,
        "shouldFilter": false,
        "reason": "重大科技新闻，信息量大"
      }
    },
    // ... 继续标注
  ]
}
```

### Step 2: 实现AX评估器 (2-3小时)

```bash
# 1. 创建文件
touch src/react-widgets/services/ax-quality-evaluator.ts

# 2. 实现核心逻辑（参考上面的代码）

# 3. 测试基本功能
bunx tsx -e "
import { AxQualityEvaluator } from './src/react-widgets/services/ax-quality-evaluator.js';
const evaluator = new AxQualityEvaluator({...});
await evaluator.loadTrainingSamples('...');
await evaluator.optimizeInstruction();
const result = await evaluator.evaluate({...});
console.log(result);
"
```

### Step 3: 集成到评估工具 (1小时)

```bash
# 1. 修改 evaluator.ts 支持AX模式
# 2. 添加CLI参数 --use-ax
# 3. 测试完整流程

bunx tsx src/cli.ts recent -n 30 --use-ax
```

### Step 4: 验证和优化 (持续)

```bash
# 1. 运行评估，对比准确率
bunx tsx src/cli.ts recent -n 100 --use-ax

# 2. 人工检查错误案例
# 3. 添加到训练集
# 4. 重新优化
# 5. 验证提升
```

---

## 💡 高级特性

### 1. 自动数据增强

```typescript
// 自动生成边界案例的变体
function augmentTrainingSamples(samples) {
  const augmented = [];

  samples.forEach(sample => {
    // 原始样本
    augmented.push(sample);

    // 生成轻微变体（测试鲁棒性）
    if (sample.output.score >= 55 && sample.output.score <= 65) {
      augmented.push({
        ...sample,
        input: {
          ...sample.input,
          title: paraphrase(sample.input.title) // 改写标题
        }
      });
    }
  });

  return augmented;
}
```

### 2. A/B测试

```typescript
// 对比当前方案 vs AX方案
async function compareEvaluators(newsList) {
  const results = {
    legacy: await legacyEvaluator.evaluateBatch(newsList),
    ax: await axEvaluator.evaluateBatch(newsList)
  };

  // 计算差异
  const disagreement = results.legacy.filter((r, i) =>
    Math.abs(r.score - results.ax[i].score) > 10
  );

  console.log(`分歧案例: ${disagreement.length}/${newsList.length}`);
  return disagreement;
}
```

### 3. 主动学习

```typescript
// 识别不确定的案例，请求人工标注
async function activeLearn(newsList) {
  const results = await axEvaluator.evaluateBatch(newsList);

  // 找出评分在55-65分的边界案例
  const uncertainCases = results.filter(r =>
    r.score >= 55 && r.score <= 65
  );

  console.log(`发现 ${uncertainCases.length} 个不确定案例，建议人工标注`);
  return uncertainCases;
}
```

---

## 📈 成功指标

### 短期目标 (1周内)

- [ ] 构建100条标注样本
- [ ] 实现基础AX评估器
- [ ] 验证准确率 ≥ 85%
- [ ] 集成到CLI工具

### 中期目标 (1个月内)

- [ ] 样本集扩展到200-300条
- [ ] 准确率提升至 ≥ 90%
- [ ] 建立持续标注流程
- [ ] A/B测试验证效果

### 长期目标 (3个月内)

- [ ] 准确率稳定在 ≥ 95%
- [ ] 完全替代当前评估器
- [ ] 支持多语言评估
- [ ] 支持自定义评估维度

---

## 🎯 总结

### 为什么这个方案有价值？

1. **解决核心问题**: 当前评估标准由LLM理解，不可控；AX方案由人工样本定义，完全可控

2. **持续改进**: 不是一次性优化，而是可以持续添加样本改进的系统

3. **透明可验证**: 可以用测试集验证准确率，知道评估器的真实表现

4. **符合实际需求**: 评估标准完全由您的实际样本定义，不是LLM的"想象"

### 建议优先级

**高优先级**:
- ✅ 构建初始样本集（这是基础）
- ✅ 实现简化版AX评估器
- ✅ 验证准确率提升

**中优先级**:
- 集成到现有工具
- A/B测试对比
- 建立标注流程

**低优先级**:
- 数据增强
- 主动学习
- 高级特性

---

**下一步**: 是否开始构建样本集？我可以：
1. 从现有评估报告中提取候选样本
2. 提供标注工具/脚本
3. 帮您实现第一版AX评估器
